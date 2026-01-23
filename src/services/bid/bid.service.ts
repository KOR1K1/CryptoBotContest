import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bid, BidDocument } from '../../models/bid.schema';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { User, UserDocument } from '../../models/user.schema';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { BalanceService } from '../balance/balance.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';

// userId передается отдельно, не в DTO, чтобы брать из JWT
export interface PlaceBidDto {
  auctionId: string;
  amount: number;
  currentRound: number; // Passed from AuctionService to avoid circular dependency
}

// для ботов userId можно в теле запроса
export interface PlaceBidBotDto {
  userId: string; // Allowed for bots
  auctionId: string;
  amount: number;
  currentRound: number;
}

// работа со ставками
// не трогает раунды, выбор победителей, выплаты - это в AuctionService
@Injectable()
export class BidService {
  private readonly logger = new Logger(BidService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private balanceService: BalanceService,
    private redisLockService: RedisLockService,
  ) {}

  // проверка требований к ставке
  // баланс не проверяем здесь, это в placeBid (там учитываются существующие ставки)
  async validateBid(
    auctionId: string,
    userId: string,
    amount: number,
  ): Promise<AuctionDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Bid amount must be positive');
    }

    const auction = await this.auctionModel.findById(auctionId).exec();
    if (!auction) {
      throw new NotFoundException(`Auction with ID ${auctionId} not found`);
    }

    if (auction.status !== AuctionStatus.RUNNING) {
      throw new BadRequestException(
        `Auction is not running. Current status: ${auction.status}`,
      );
    }

    if (amount < auction.minBid) {
      throw new BadRequestException(
        `Bid amount ${amount} is below minimum bid ${auction.minBid}`,
      );
    }

    // Balance check is done separately in placeBid to handle existing bids correctly
    // (check delta for increases, full amount for new bids)

    return auction;
  }

  // проверяем есть ли уже активная ставка у юзера в этом аукционе
  async preventDuplicateActiveBid(
    userId: string,
    auctionId: string,
  ): Promise<BidDocument | null> {
    const existingBid = await this.bidModel
      .findOne({
        userId,
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .exec();

    return existingBid;
  }

  // размещение или увеличение ставки
  // если нет активной ставки - создаем, если есть - увеличиваем сумму
  // все в транзакции для атомарности
  async placeBid(userId: string, dto: PlaceBidDto): Promise<BidDocument> {
    const { auctionId, amount, currentRound } = dto;

    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 50;

    const userLockKey = `user:${userId}`;
    const useRedisLocks = this.redisLockService.isLockServiceAvailable();

    if (useRedisLocks) {
      // блокируем только на уровне юзера, не аукциона
      return this.redisLockService.withLock(
        userLockKey,
        async () => {
          return this.executePlaceBidTransaction(userId, dto, null, MAX_RETRIES, RETRY_DELAY_MS);
        },
        5,
        { maxRetries: 1, retryDelayMs: 10 },
      );
    } else {
      return this.executePlaceBidTransaction(userId, dto, null, MAX_RETRIES, RETRY_DELAY_MS);
    }
  }

  // транзакция размещения ставки
  // все валидации внутри транзакции чтобы избежать race conditions
  private async executePlaceBidTransaction(
    userId: string,
    dto: PlaceBidDto,
    existingBid: BidDocument | null, // DEPRECATED: kept for compatibility, always null
    maxRetries: number,
    retryDelayMs: number,
  ): Promise<BidDocument> {
    const { auctionId, amount, currentRound } = dto;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const session = await this.connection.startSession();

      try {
        let result: BidDocument;

        await session.withTransaction(
          async () => {
          // все валидации внутри транзакции
          const auction = await this.auctionModel
            .findById(auctionId)
            .session(session)
            .exec();

          if (!auction) {
            throw new NotFoundException(`Auction with ID ${auctionId} not found`);
          }

          if (auction.status !== AuctionStatus.RUNNING) {
            throw new BadRequestException(
              `Auction is not running. Current status: ${auction.status}`,
            );
          }

          if (amount < auction.minBid) {
            throw new BadRequestException(
              `Bid amount ${amount} is below minimum bid ${auction.minBid}`,
            );
          }

          const existingBidInTx = await this.bidModel
            .findOne({
              userId,
              auctionId,
              status: BidStatus.ACTIVE,
            })
            .session(session)
            .exec();

          const user = await this.userModel
            .findById(userId)
            .session(session)
            .exec();

          if (!user) {
            throw new NotFoundException(`User with ID ${userId} not found`);
          }

          const amountToCheck = existingBidInTx
            ? amount - existingBidInTx.amount // Only check additional funds needed
            : amount; // Check full amount for new bid

          if (user.balance < amountToCheck) {
            throw new BadRequestException(
              existingBidInTx
                ? `Insufficient balance. Need additional ${amountToCheck} to increase bid from ${existingBidInTx.amount} to ${amount}`
                : `Insufficient balance for bid of ${amount}. Available: ${user.balance}`,
            );
          }

          if (existingBidInTx && amount <= existingBidInTx.amount) {
            throw new BadRequestException(
              `New bid amount ${amount} must be greater than existing bid ${existingBidInTx.amount}. Bids can only be increased.`,
            );
          }

          if (existingBidInTx) {
            const delta = amount - existingBidInTx.amount;

            await this.balanceService.lockFunds(
              userId,
              delta,
              existingBidInTx._id.toString(),
              `Increase bid from ${existingBidInTx.amount} to ${amount}`,
              session,
            );

            const updatedBid = await this.bidModel
              .findByIdAndUpdate(
                existingBidInTx._id,
                {
                  amount,
                  roundIndex: currentRound,
                  updatedAt: new Date(),
                },
                { new: true, session },
              )
              .exec();

            if (!updatedBid) {
              throw new InternalServerErrorException('Failed to update bid');
            }

            result = updatedBid;

            this.logger.log(
              `Increased bid for user ${userId} in auction ${auctionId}: ${existingBidInTx.amount} -> ${amount}`,
            );
          } else {
            const createdBid = await this.bidModel.create(
              [
                {
                  userId,
                  auctionId,
                  amount,
                  roundIndex: currentRound,
                  status: BidStatus.ACTIVE,
                },
              ],
              { session },
            );

            if (!createdBid || createdBid.length === 0) {
              throw new InternalServerErrorException('Failed to create bid');
            }

            const newBid = createdBid[0];

            await this.balanceService.lockFunds(
              userId,
              amount,
              newBid._id.toString(),
              `Lock funds for new bid of ${amount}`,
              session,
            );

            const fetchedBid = await this.bidModel
              .findById(newBid._id)
              .session(session)
              .exec();

            if (!fetchedBid) {
              throw new InternalServerErrorException('Failed to fetch created bid');
            }

            result = fetchedBid;

            this.logger.log(
              `Placed new bid for user ${userId} in auction ${auctionId}: ${amount}`,
            );
          }
        },
        {
          maxTimeMS: 5000,
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        });

        await session.endSession();
        return result!;
      } catch (error) {
        await session.endSession();
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryableError =
          error instanceof Error &&
          (error.message.includes('Write conflict') ||
            error.message.includes('TransientTransactionError') ||
            error.message.includes('UnknownTransactionCommitResult') ||
            error.message.includes('WriteConflict') ||
            error.message.includes('catalog changes') ||
            error.message.includes('Unable to write to collection') ||
            error.message.includes('Please retry your operation'));

        // Don't retry known business logic errors
        if (
          error instanceof NotFoundException ||
          error instanceof BadRequestException ||
          error instanceof ConflictException
        ) {
          throw error;
        }

        // If not retryable or max retries reached, throw error
        if (!isRetryableError || attempt >= maxRetries) {
          if (
            error instanceof InternalServerErrorException ||
            !isRetryableError
          ) {
            throw error;
          }

          // Max retries reached for retryable error
          this.logger.error(
            `Failed to place bid after ${maxRetries} attempts for user ${userId} in auction ${auctionId}:`,
            lastError,
          );
          const errorMessage = lastError.message || 'Unknown error occurred';
          throw new InternalServerErrorException(
            `Failed to place bid after ${maxRetries} retries: ${errorMessage}`,
          );
        }

        // Retry with exponential backoff + jitter for better distribution
        // Formula: baseDelay * (2^attempt) + random(0-50ms) to avoid thundering herd
        const exponentialDelay = retryDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 50; // Random 0-50ms to spread retries
        const totalDelay = Math.min(exponentialDelay + jitter, 2000); // Cap at 2s max delay
        
        this.logger.warn(
          `Retry ${attempt}/${maxRetries} for bid placement (user ${userId}, auction ${auctionId}): ${lastError.message}, delay: ${totalDelay.toFixed(0)}ms`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, totalDelay),
        );
      }
    }

    // Should never reach here, but TypeScript requires return
    const errorMessage = lastError?.message || 'Unknown error occurred';
    throw new InternalServerErrorException(
      `Failed to place bid: ${errorMessage}`,
    );
  }

  async getActiveBidsForAuction(auctionId: string): Promise<BidDocument[]> {
    const activeBids = await this.bidModel
      .find({
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 })
      .exec();

    return activeBids;
  }

  // топ N активных ставок, используем limit чтобы не грузить все
  async getTopActiveBids(
    auctionId: string,
    limit: number = 3,
  ): Promise<BidDocument[]> {
    const { User, UserSchema } = await import('../../models/user.schema');
    const userModel = this.bidModel.db.model('User', UserSchema);

    const topBids = await this.bidModel
      .find({
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 }) // amount DESC, createdAt ASC (for tie-breaking)
      .limit(limit)
      .exec();

    return Promise.all(
      topBids.map(async (bid) => {
        const user = await userModel.findById(bid.userId).exec();
        (bid as any).username = user?.username || 'Unknown';
        return bid;
      }),
    );
  }

  // позиция юзера в рейтинге активных ставок
  async getUserPosition(
    auctionId: string,
    userId: string,
  ): Promise<{ position: number | null; amount: number | null }> {
    // First, get user's active bid
    const userBid = await this.bidModel
      .findOne({
        auctionId,
        userId,
        status: BidStatus.ACTIVE,
      })
      .exec();

    if (!userBid) {
      return { position: null, amount: null };
    }

    // считаем ставки лучше чем у юзера (больше сумма или та же но раньше создана)
    const betterBidsCount = await this.bidModel.countDocuments({
      auctionId,
      status: BidStatus.ACTIVE,
      $or: [
        { amount: { $gt: userBid.amount } }, // Higher amount
        {
          amount: userBid.amount,
          createdAt: { $lt: userBid.createdAt }, // Same amount, earlier created
        },
      ],
    });

    return {
      position: betterBidsCount + 1,
      amount: userBid.amount,
    };
  }

  async getUserActiveBid(
    userId: string,
    auctionId: string,
  ): Promise<BidDocument | null> {
    return this.preventDuplicateActiveBid(userId, auctionId);
  }

  async getUserBids(
    userId: string,
    status?: BidStatus,
  ): Promise<BidDocument[]> {
    const query: { userId: string; status?: BidStatus } = { userId };
    if (status) {
      query.status = status;
    }

    return this.bidModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getBidById(bidId: string): Promise<BidDocument> {
    const bid = await this.bidModel.findById(bidId).exec();
    if (!bid) {
      throw new NotFoundException(`Bid with ID ${bidId} not found`);
    }
    return bid;
  }
}


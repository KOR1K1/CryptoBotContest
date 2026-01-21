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
import { BidStatus } from '../../common/enums/bid-status.enum';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { BalanceService } from '../balance/balance.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';

export interface PlaceBidDto {
  userId: string;
  auctionId: string;
  amount: number;
  currentRound: number; // Passed from AuctionService to avoid circular dependency
}

/**
 * BidService
 *
 * Handles bid placement and validation
 * Does NOT handle:
 * - Round logic (handled by AuctionService)
 * - Winner selection (handled by AuctionService)
 * - Payouts/refunds (handled by AuctionService)
 *
 * Responsibilities:
 * - Validate bid requirements
 * - Place new bids or increase existing bids
 * - Prevent duplicate active bids
 * - Query active bids
 */
@Injectable()
export class BidService {
  private readonly logger = new Logger(BidService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    private balanceService: BalanceService,
    private redisLockService: RedisLockService,
  ) {}

  /**
   * Validate bid requirements
   * Checks auction status and minimum bid
   * Does NOT check balance (balance check is done separately in placeBid to handle existing bids)
   *
   * @param auctionId Auction ID
   * @param userId User ID (for potential future checks)
   * @param amount Bid amount
   * @returns Auction document if valid
   * @throws NotFoundException if auction not found
   * @throws BadRequestException if validation fails
   */
  async validateBid(
    auctionId: string,
    userId: string,
    amount: number,
  ): Promise<AuctionDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Bid amount must be positive');
    }

    // Check auction exists and is running
    const auction = await this.auctionModel.findById(auctionId).exec();
    if (!auction) {
      throw new NotFoundException(`Auction with ID ${auctionId} not found`);
    }

    if (auction.status !== AuctionStatus.RUNNING) {
      throw new BadRequestException(
        `Auction is not running. Current status: ${auction.status}`,
      );
    }

    // Check minimum bid requirement
    if (amount < auction.minBid) {
      throw new BadRequestException(
        `Bid amount ${amount} is below minimum bid ${auction.minBid}`,
      );
    }

    // Balance check is done separately in placeBid to handle existing bids correctly
    // (check delta for increases, full amount for new bids)

    return auction;
  }

  /**
   * Check if user already has an active bid in this auction
   * Used to prevent duplicate active bids (one ACTIVE bid per user per auction)
   *
   * @param userId User ID
   * @param auctionId Auction ID
   * @returns Existing active bid if found, null otherwise
   */
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

  /**
   * Place a bid or increase existing bid
   *
   * Rules:
   * - If user has no active bid: create new bid
   * - If user has active bid: increase amount (newAmount > oldAmount)
   * - All operations are atomic via MongoDB transactions
   * - Uses BalanceService for fund locking
   *
   * @param dto PlaceBidDto with userId, auctionId, amount, currentRound
   * @returns Created or updated bid document
   * @throws BadRequestException if validation fails
   * @throws ConflictException if bid cannot be placed
   */
  async placeBid(dto: PlaceBidDto): Promise<BidDocument> {
    const { userId, auctionId, amount, currentRound } = dto;

    // Check for existing bid first to validate correctly
    const existingBid = await this.preventDuplicateActiveBid(userId, auctionId);

    if (existingBid) {
      // Validate: new amount must be greater than existing
      if (amount <= existingBid.amount) {
        throw new BadRequestException(
          `New bid amount ${amount} must be greater than existing bid ${existingBid.amount}. Bids can only be increased.`,
        );
      }
    }

    // Validate auction status and minimum bid (check full amount)
    // Note: validateBid checks full amount for minBid requirement
    // Balance check is done separately below to handle existing bids correctly
    const auction = await this.validateBid(auctionId, userId, amount);

    // For balance validation: check delta if increasing, full amount if new
    const amountToCheck = existingBid
      ? amount - existingBid.amount // Only check additional funds needed
      : amount; // Check full amount for new bid

    // Validate balance: check delta if increasing existing bid, full amount if new bid
    const hasBalance = await this.balanceService.validateBalance(
      userId,
      amountToCheck,
    );
    if (!hasBalance) {
      throw new BadRequestException(
        existingBid
          ? `Insufficient balance. Need additional ${amountToCheck} to increase bid from ${existingBid.amount} to ${amount}`
          : `Insufficient balance for bid of ${amount}`,
      );
    }

    // Retry configuration for transaction conflicts
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 100; // Initial delay, increases exponentially

    // Use Redis lock for user-level concurrency control (optional, falls back to MongoDB transactions)
    const userLockKey = `user:${userId}`;
    const auctionLockKey = `auction:${auctionId}`;

    // Try to acquire Redis locks (optional - if Redis unavailable, continue with MongoDB transactions only)
    const useRedisLocks = this.redisLockService.isLockServiceAvailable();

    if (useRedisLocks) {
      // Use Redis lock to prevent concurrent bid operations for same user/auction
      return this.redisLockService.withLock(
        userLockKey,
        async () => {
          return this.redisLockService.withLock(
            auctionLockKey,
            async () => {
              return this.executePlaceBidTransaction(dto, existingBid, MAX_RETRIES, RETRY_DELAY_MS);
            },
            10, // 10 seconds TTL for auction lock
            { maxRetries: 2, retryDelayMs: 50 },
          );
        },
        10, // 10 seconds TTL for user lock
        { maxRetries: 2, retryDelayMs: 50 },
      );
    } else {
      // Fallback: Use MongoDB transactions only (works fine for most scenarios)
      return this.executePlaceBidTransaction(dto, existingBid, MAX_RETRIES, RETRY_DELAY_MS);
    }
  }

  /**
   * Execute bid placement transaction (extracted for reuse with/without Redis locks)
   * 
   * @param dto PlaceBidDto
   * @param existingBid Existing bid if any
   * @param maxRetries Maximum retry attempts
   * @param retryDelayMs Initial retry delay
   * @returns Created or updated bid document
   */
  private async executePlaceBidTransaction(
    dto: PlaceBidDto,
    existingBid: BidDocument | null,
    maxRetries: number,
    retryDelayMs: number,
  ): Promise<BidDocument> {
    const { userId, auctionId, amount, currentRound } = dto;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const session = await this.connection.startSession();

      try {
        let result: BidDocument;

        await session.withTransaction(async () => {
        // Re-check existing bid within transaction (for consistency)
        const existingBidInTx = await this.bidModel
          .findOne({
            userId,
            auctionId,
            status: BidStatus.ACTIVE,
          })
          .session(session)
          .exec();

        if (existingBidInTx) {
          // Increase existing bid
          // Double-check amount is greater (defensive programming)
          if (amount <= existingBidInTx.amount) {
            throw new BadRequestException(
              `New bid amount ${amount} must be greater than existing bid ${existingBidInTx.amount}. Bids can only be increased.`,
            );
          }

          const delta = amount - existingBidInTx.amount;

          // Lock additional funds via BalanceService
          await this.balanceService.lockFunds(
            userId,
            delta,
            existingBidInTx._id.toString(),
            `Increase bid from ${existingBidInTx.amount} to ${amount}`,
            session,
          );

          // Update bid
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
          // Create new bid
          // Lock funds via BalanceService
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

          // Lock funds after bid creation (to get bidId for reference)
          await this.balanceService.lockFunds(
            userId,
            amount,
            newBid._id.toString(),
            `Lock funds for new bid of ${amount}`,
            session,
          );

          // Fetch the complete bid document
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
        });

        await session.endSession();
        return result!;
      } catch (error) {
        await session.endSession();
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable (transaction conflicts)
        const isRetryableError =
          error instanceof Error &&
          (error.message.includes('Write conflict') ||
            error.message.includes('TransientTransactionError') ||
            error.message.includes('UnknownTransactionCommitResult') ||
            error.message.includes('WriteConflict'));

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

        // Retry with exponential backoff
        this.logger.warn(
          `Retry ${attempt}/${maxRetries} for bid placement (user ${userId}, auction ${auctionId}): ${lastError.message}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs * attempt),
        );
      }
    }

    // Should never reach here, but TypeScript requires return
    const errorMessage = lastError?.message || 'Unknown error occurred';
    throw new InternalServerErrorException(
      `Failed to place bid: ${errorMessage}`,
    );
  }

  /**
   * Get all active bids for an auction
   * Used by AuctionService for winner selection
   *
   * @param auctionId Auction ID
   * @returns Array of active bid documents, sorted by amount DESC, createdAt ASC
   */
  async getActiveBidsForAuction(auctionId: string): Promise<BidDocument[]> {
    const activeBids = await this.bidModel
      .find({
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 }) // amount DESC, createdAt ASC (for tie-breaking)
      .exec();

    return activeBids;
  }

  /**
   * Get top N active bids for an auction (optimized for dashboard)
   * Uses limit to avoid loading all bids into memory
   *
   * @param auctionId Auction ID
   * @param limit Number of top bids to return (default: 3)
   * @returns Array of top bid documents with user populated, sorted by amount DESC, createdAt ASC
   */
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

    // Populate user data (attach username for convenience)
    return Promise.all(
      topBids.map(async (bid) => {
        const user = await userModel.findById(bid.userId).exec();
        (bid as any).username = user?.username || 'Unknown';
        return bid;
      }),
    );
  }

  /**
   * Calculate user position in active bids ranking
   * Uses MongoDB aggregation for efficient counting
   *
   * @param auctionId Auction ID
   * @param userId User ID
   * @returns User position (1-based, null if no active bid), user bid amount
   */
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

    // Count bids that are "better" than user's bid
    // Better = higher amount OR same amount with earlier createdAt
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

    // Position is count + 1 (1-based)
    return {
      position: betterBidsCount + 1,
      amount: userBid.amount,
    };
  }

  /**
   * Get active bid for a specific user in an auction
   * Helper method for checking user's current bid
   *
   * @param userId User ID
   * @param auctionId Auction ID
   * @returns Active bid if exists, null otherwise
   */
  async getUserActiveBid(
    userId: string,
    auctionId: string,
  ): Promise<BidDocument | null> {
    return this.preventDuplicateActiveBid(userId, auctionId);
  }

  /**
   * Get all bids for a user (across all auctions)
   * Useful for user history
   *
   * @param userId User ID
   * @param status Optional status filter
   * @returns Array of bid documents
   */
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

  /**
   * Get bid by ID
   *
   * @param bidId Bid ID
   * @returns Bid document
   * @throws NotFoundException if bid not found
   */
  async getBidById(bidId: string): Promise<BidDocument> {
    const bid = await this.bidModel.findById(bidId).exec();
    if (!bid) {
      throw new NotFoundException(`Bid with ID ${bidId} not found`);
    }
    return bid;
  }
}


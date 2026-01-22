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

/**
 * PlaceBidDto (internal interface for BidService)
 * 
 * Note: userId is now passed as a separate parameter, not in DTO
 * This ensures userId comes from JWT token, not from request body
 */
export interface PlaceBidDto {
  auctionId: string;
  amount: number;
  currentRound: number; // Passed from AuctionService to avoid circular dependency
}

/**
 * PlaceBidBotDto (for bot simulation)
 * 
 * Used for bot endpoints where userId can be provided in body
 * (for testing and simulation purposes)
 */
export interface PlaceBidBotDto {
  userId: string; // Allowed for bots
  auctionId: string;
  amount: number;
  currentRound: number;
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
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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
   * Place a bid or increase existing bid (for authenticated users)
   *
   * Rules:
   * - If user has no active bid: create new bid
   * - If user has active bid: increase amount (newAmount > oldAmount)
   * - All operations are atomic via MongoDB transactions
   * - Uses BalanceService for fund locking
   *
   * OPTIMIZED: All validations are done INSIDE transaction to avoid race conditions
   * and reduce number of database queries (critical for performance).
   *
   * @param userId User ID (from JWT token, not from request body)
   * @param dto PlaceBidDto with auctionId, amount, currentRound
   * @returns Created or updated bid document
   * @throws BadRequestException if validation fails
   * @throws ConflictException if bid cannot be placed
   */
  async placeBid(userId: string, dto: PlaceBidDto): Promise<BidDocument> {
    const { auctionId, amount, currentRound } = dto;

    // Retry configuration for transaction conflicts
    // Optimized for high concurrency: more retries with exponential backoff
    // Top projects handle 100k+ concurrent bids with 5-10 retries
    const MAX_RETRIES = 5; // Increased from 3 to 5 for better conflict handling
    const RETRY_DELAY_MS = 50; // Reduced initial delay for faster retries (was 100ms)

    // Use Redis lock for user-level concurrency control (optional, falls back to MongoDB transactions)
    // OPTIMIZED: Only user-level lock (not auction-level) for better performance
    const userLockKey = `user:${userId}`;

    // Try to acquire Redis locks (optional - if Redis unavailable, continue with MongoDB transactions only)
    const useRedisLocks = this.redisLockService.isLockServiceAvailable();

    if (useRedisLocks) {
      // Use Redis lock to prevent concurrent bid operations for same user
      // OPTIMIZED: Only user lock, not auction lock (MongoDB transactions handle auction-level concurrency)
      return this.redisLockService.withLock(
        userLockKey,
        async () => {
          return this.executePlaceBidTransaction(userId, dto, null, MAX_RETRIES, RETRY_DELAY_MS);
        },
        5, // Reduced TTL to 5 seconds for faster release
        { maxRetries: 1, retryDelayMs: 10 }, // Faster retry
      );
    } else {
      // Fallback: Use MongoDB transactions only (works fine for most scenarios)
      return this.executePlaceBidTransaction(userId, dto, null, MAX_RETRIES, RETRY_DELAY_MS);
    }
  }

  /**
   * Execute bid placement transaction (extracted for reuse with/without Redis locks)
   * 
   * OPTIMIZED: All validations are done INSIDE transaction to:
   * 1. Avoid race conditions
   * 2. Reduce number of database queries (critical for performance)
   * 3. Ensure atomicity of all checks and operations
   * 
   * @param userId User ID (from JWT token)
   * @param dto PlaceBidDto (without userId)
   * @param existingBid DEPRECATED: Always pass null, will be checked inside transaction
   * @param maxRetries Maximum retry attempts
   * @param retryDelayMs Initial retry delay
   * @returns Created or updated bid document
   */
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

        // CRITICAL: Set transaction timeout to prevent long-running transactions
        // Default MongoDB transaction timeout is 60s, but we set it to 5s for faster failure and less blocking
        await session.withTransaction(
          async () => {
            // ✅ OPTIMIZED: All validations INSIDE transaction (critical for performance)
          
          // 1. Validate auction (inside transaction)
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

          // 2. Check existing bid (inside transaction)
          const existingBidInTx = await this.bidModel
            .findOne({
              userId,
              auctionId,
              status: BidStatus.ACTIVE,
            })
            .session(session)
            .exec();

          // 3. Validate balance (inside transaction)
          const user = await this.userModel
            .findById(userId)
            .session(session)
            .exec();

          if (!user) {
            throw new NotFoundException(`User with ID ${userId} not found`);
          }

          // Calculate amount to check (delta if increasing, full if new)
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

          // 4. Validate amount increase (if existing bid)
          if (existingBidInTx && amount <= existingBidInTx.amount) {
            throw new BadRequestException(
              `New bid amount ${amount} must be greater than existing bid ${existingBidInTx.amount}. Bids can only be increased.`,
            );
          }

          // 5. Execute operation (inside same transaction)
          if (existingBidInTx) {
            // Increase existing bid
            const delta = amount - existingBidInTx.amount;

            // Lock additional funds
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
            // OPTIMIZED: Create bid first, then lock funds (bidId needed for reference)
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

            // Lock funds (using bidId as reference)
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
        },
        {
          // CRITICAL: Transaction timeout to prevent blocking
          // maxTimeMS: 5000 = 5 seconds max transaction time
          // This prevents long-running transactions from blocking others
          maxTimeMS: 5000,
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        });

        await session.endSession();
        return result!;
      } catch (error) {
        await session.endSession();
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable (transaction conflicts and transient errors)
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


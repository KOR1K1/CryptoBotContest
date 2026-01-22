import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import {
  AuctionRound,
  AuctionRoundDocument,
} from '../../models/auction-round.schema';
import { Bid, BidDocument } from '../../models/bid.schema';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { BidStatus } from '../../common/enums/bid-status.enum';
import { BidService } from '../bid/bid.service';
import { BalanceService } from '../balance/balance.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';

export interface CreateAuctionDto {
  giftId: string;
  totalGifts: number;
  totalRounds: number;
  roundDurationMs: number;
  minBid: number;
}

export interface WinnerResult {
  bidId: string;
  userId: string;
  amount: number;
  roundIndex: number;
}

/**
 * AuctionService
 *
 * Core business logic for auction management:
 * - Auction lifecycle (start, rounds, finalize)
 * - Winner selection (deterministic algorithm)
 * - Round management
 * - Bid carry-over between rounds
 *
 * Does NOT directly mutate balances - uses BalanceService
 * Does NOT place bids - uses BidService
 */
@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(AuctionRound.name)
    private auctionRoundModel: Model<AuctionRoundDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private bidService: BidService,
    private balanceService: BalanceService,
    private redisLockService: RedisLockService,
  ) {}

  /**
   * Create a new auction
   * Auction is created in CREATED status and must be started separately
   *
   * @param dto CreateAuctionDto
   * @returns Created auction document
   */
  async createAuction(dto: CreateAuctionDto): Promise<AuctionDocument> {
    const { giftId, totalGifts, totalRounds, roundDurationMs, minBid } = dto;

    // Validate parameters
    if (totalGifts <= 0 || totalRounds <= 0) {
      throw new BadRequestException(
        'totalGifts and totalRounds must be positive',
      );
    }

    if (roundDurationMs < 1000) {
      throw new BadRequestException(
        'roundDurationMs must be at least 1000ms (1 second)',
      );
    }

    if (minBid <= 0) {
      throw new BadRequestException('minBid must be positive');
    }

    const auction = await this.auctionModel.create({
      giftId,
      status: AuctionStatus.CREATED,
      totalGifts,
      totalRounds,
      currentRound: 0,
      roundDurationMs,
      minBid,
    });

    this.logger.log(`Created auction ${auction._id} with ${totalRounds} rounds`);

    return auction;
  }

  /**
   * Start an auction
   * Creates the first round and transitions auction to RUNNING status
   *
   * @param auctionId Auction ID
   * @returns Started auction document
   */
  async startAuction(auctionId: string): Promise<AuctionDocument> {
    const session = await this.connection.startSession();

    try {
      let result: AuctionDocument;

      await session.withTransaction(async () => {
        // Find auction
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status !== AuctionStatus.CREATED) {
          throw new BadRequestException(
            `Auction must be in CREATED status to start. Current: ${auction.status}`,
          );
        }

        // Calculate gifts per round
        const giftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);

        // Create first round
        const now = new Date();
        const roundEndsAt = new Date(now.getTime() + auction.roundDurationMs);

        await this.auctionRoundModel.create(
          [
            {
              auctionId: auction._id.toString(),
              roundIndex: 0,
              startedAt: now,
              endsAt: roundEndsAt,
              winnersCount: 0,
              closed: false,
            },
          ],
          { session },
        );

        // Update auction status
        const updatedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              status: AuctionStatus.RUNNING,
              startedAt: now,
              currentRound: 0,
            },
            { new: true, session },
          )
          .exec();

        if (!updatedAuction) {
          throw new InternalServerErrorException('Failed to start auction');
        }

        result = updatedAuction;

        this.logger.log(
          `Started auction ${auctionId}, round 0 ends at ${roundEndsAt.toISOString()}`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error starting auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to start auction: ${errorMessage}`,
      );
    }
  }

  /**
   * Calculate winners for current round
   * Deterministic algorithm: sort by amount DESC, createdAt ASC
   *
   * @param auctionId Auction ID
   * @param currentRound Round index
   * @param giftsPerRound Number of gifts to award
   * @param session Optional MongoDB session (for transaction consistency)
   * @returns Array of winner bid documents
   */
  async calculateWinners(
    auctionId: string,
    currentRound: number,
    giftsPerRound: number,
    session?: ClientSession,
  ): Promise<BidDocument[]> {
    // CRITICAL PERFORMANCE FIX: Use .limit() instead of loading all bids
    // For millions of bids, loading all into memory is impossible
    // MongoDB will use index { auctionId: 1, status: 1, amount: -1, createdAt: 1 } efficiently
    // Only load the top N winners directly from database
    
    const winners = await this.bidModel
      .find({
        auctionId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1, createdAt: 1 }) // amount DESC, createdAt ASC (for tie-breaking)
      .limit(giftsPerRound) // CRITICAL: Only load top N, not all bids
      .session(session || null)
      .exec();

    if (winners.length === 0) {
      this.logger.warn(`No active bids found for auction ${auctionId}`);
      return [];
    }

    // Sorting ensures deterministic ordering:
    // - amount DESC (highest first)
    // - createdAt ASC (earliest first for tie-breaking)
    // Same inputs → same results (deterministic)
    // MongoDB handles sorting + limit efficiently using index

    this.logger.log(
      `Calculated ${winners.length} winners for auction ${auctionId}, round ${currentRound} (out of top ${giftsPerRound} requested)`,
    );

    return winners;
  }

  /**
   * Close current round
   * Selects winners, marks them as WON, processes payouts
   * 
   * Uses Redis lock for distributed locking (optional, falls back to MongoDB transactions)
   *
   * @param auctionId Auction ID
   * @returns Closed round document and winners
   */
  async closeCurrentRound(auctionId: string): Promise<{
    round: AuctionRoundDocument;
    winners: WinnerResult[];
  }> {
    // Use Redis lock for round closing (prevents concurrent round closures across instances)
    const roundLockKey = `round:${auctionId}`;
    const useRedisLocks = this.redisLockService.isLockServiceAvailable();

    if (useRedisLocks) {
      return this.redisLockService.withLock(
        roundLockKey,
        async () => {
          return this.executeCloseRoundTransaction(auctionId);
        },
        60, // 60 seconds TTL (round closing can take time with many bids)
        { maxRetries: 1, retryDelayMs: 500 },
      );
    } else {
      // Fallback: Use MongoDB transactions only
      return this.executeCloseRoundTransaction(auctionId);
    }
  }

  /**
   * Execute round closing transaction (extracted for reuse with/without Redis locks)
   * 
   * @param auctionId Auction ID
   * @returns Closed round document and winners
   */
  private async executeCloseRoundTransaction(auctionId: string): Promise<{
    round: AuctionRoundDocument;
    winners: WinnerResult[];
  }> {
    const session = await this.connection.startSession();

    try {
      let result: {
        round: AuctionRoundDocument;
        winners: WinnerResult[];
      };

      await session.withTransaction(async () => {
        // Find auction and current round
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status !== AuctionStatus.RUNNING) {
          throw new BadRequestException(
            `Auction must be RUNNING to close round. Current: ${auction.status}`,
          );
        }

        const currentRound = await this.auctionRoundModel
          .findOne({
            auctionId,
            roundIndex: auction.currentRound,
          })
          .session(session)
          .exec();

        if (!currentRound) {
          throw new NotFoundException(
            `Round ${auction.currentRound} not found for auction ${auctionId}`,
          );
        }

        if (currentRound.closed) {
          throw new BadRequestException(
            `Round ${auction.currentRound} is already closed`,
          );
        }

        // Calculate gifts per round
        // Important: Rounds are for anti-sniping only. Total gifts to award = totalGifts.
        // We never award more than totalGifts across all rounds.
        const isLastRound = auction.currentRound === auction.totalRounds - 1;
        
        // Calculate how many gifts were already awarded in previous rounds
        const previousRounds = await this.auctionRoundModel
          .find({
            auctionId,
            roundIndex: { $lt: auction.currentRound },
            closed: true,
          })
          .session(session)
          .exec();

        const alreadyAwarded = previousRounds.reduce(
          (sum, r) => sum + r.winnersCount,
          0,
        );

        const remainingGifts = auction.totalGifts - alreadyAwarded;
        
        // If all gifts already awarded, no more winners in this round
        if (remainingGifts <= 0) {
          // Close round with 0 winners
          const updatedRound = await this.auctionRoundModel
            .findByIdAndUpdate(
              currentRound._id,
              {
                closed: true,
                winnersCount: 0,
                updatedAt: new Date(),
              },
              { new: true, session },
            )
            .exec();

          if (!updatedRound) {
            throw new InternalServerErrorException('Failed to close round');
          }

          // If all gifts are awarded, auction should be finalized
          // This can happen if gifts were awarded in previous rounds
          // Note: We don't finalize here because this method only closes rounds
          // The scheduler will detect this and finalize the auction
          // But we mark the auction for finalization by checking in the scheduler
          
          result = {
            round: updatedRound,
            winners: [],
          };
          return;
        }
        
        let giftsPerRound: number;
        if (isLastRound) {
          // For last round, award all remaining gifts
          giftsPerRound = remainingGifts;
        } else {
          // For non-last rounds, use even distribution but never exceed remaining gifts
          // This ensures we don't award more than totalGifts total
          const baseGiftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);
          giftsPerRound = Math.min(baseGiftsPerRound, remainingGifts);
        }

        // Calculate winners (within transaction for consistency)
        const winnerBids = await this.calculateWinners(
          auctionId,
          auction.currentRound,
          giftsPerRound,
          session,
        );

        // Mark winners as WON and process payouts
        const winners: WinnerResult[] = [];
        for (const bid of winnerBids) {
          // Idempotency check: verify bid is still ACTIVE (may have been processed already)
          const currentBid = await this.bidModel
            .findById(bid._id)
            .session(session)
            .exec();

          if (!currentBid) {
            this.logger.warn(
              `Bid ${bid._id} not found - may have been deleted, skipping`,
            );
            continue;
          }

          if (currentBid.status !== BidStatus.ACTIVE) {
            this.logger.warn(
              `Bid ${bid._id} is already ${currentBid.status}, skipping payout (idempotency)`,
            );
            // Bid already processed, add to winners list but skip payout
            winners.push({
              bidId: bid._id.toString(),
              userId: bid.userId.toString(),
              amount: bid.amount,
              roundIndex: bid.roundIndex,
            });
            continue;
          }

          // Update bid status to WON and record the round it won in (for carry-over: roundIndex=placed, wonInRoundIndex=won)
          const updatedBid = await this.bidModel
            .findByIdAndUpdate(
              bid._id,
              {
                status: BidStatus.WON,
                wonInRoundIndex: auction.currentRound,
                updatedAt: new Date(),
              },
              { new: true, session },
            )
            .exec();

          if (!updatedBid) {
            throw new InternalServerErrorException(
              `Failed to update bid ${bid._id} to WON status`,
            );
          }

          // Process payout (deduct from locked balance)
          // Winner pays for the gift - funds are deducted from lockedBalance
          // Use bidId as referenceId for idempotency (each bid paid once)
          await this.balanceService.payout(
            bid.userId.toString(),
            bid.amount,
            bid._id.toString(), // Use bidId as referenceId for idempotency
            `Payout for winning bid in round ${auction.currentRound}`,
            session,
          );

          winners.push({
            bidId: bid._id.toString(),
            userId: bid.userId.toString(),
            amount: bid.amount,
            roundIndex: bid.roundIndex,
          });
        }

        // Update round as closed
        const updatedRound = await this.auctionRoundModel
          .findByIdAndUpdate(
            currentRound._id,
            {
              closed: true,
              winnersCount: winners.length,
              updatedAt: new Date(),
            },
            { new: true, session },
          )
          .exec();

        if (!updatedRound) {
          throw new InternalServerErrorException('Failed to close round');
        }

        result = {
          round: updatedRound,
          winners,
        };

        this.logger.log(
          `Closed round ${auction.currentRound} for auction ${auctionId}, ${winners.length} winners`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error closing round for auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to close round: ${errorMessage}`,
      );
    }
  }

  /**
   * Advance to next round
   * Creates new round and updates auction currentRound
   * Active bids (non-winners) automatically carry over
   *
   * @param auctionId Auction ID
   * @returns Updated auction and new round
   */
  async advanceRound(auctionId: string): Promise<{
    auction: AuctionDocument;
    round: AuctionRoundDocument;
  }> {
    const session = await this.connection.startSession();

    try {
      let result: {
        auction: AuctionDocument;
        round: AuctionRoundDocument;
      };

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status !== AuctionStatus.RUNNING) {
          throw new BadRequestException(
            `Auction must be RUNNING to advance round. Current: ${auction.status}`,
          );
        }

        const nextRoundIndex = auction.currentRound + 1;

        if (nextRoundIndex >= auction.totalRounds) {
          throw new BadRequestException(
            `Cannot advance: auction has only ${auction.totalRounds} rounds (0-based, current: ${auction.currentRound})`,
          );
        }

        // Update roundIndex for all active bids (carry-over)
        // This marks them as participating in the new round
        await this.bidModel
          .updateMany(
            {
              auctionId,
              status: BidStatus.ACTIVE,
            },
            {
              $set: {
                roundIndex: nextRoundIndex,
                updatedAt: new Date(),
              },
            },
            { session },
          )
          .exec();

        // Create new round
        const now = new Date();
        const roundEndsAt = new Date(now.getTime() + auction.roundDurationMs);

        const newRound = await this.auctionRoundModel.create(
          [
            {
              auctionId: auction._id.toString(),
              roundIndex: nextRoundIndex,
              startedAt: now,
              endsAt: roundEndsAt,
              winnersCount: 0,
              closed: false,
            },
          ],
          { session },
        );

        if (!newRound || newRound.length === 0) {
          throw new InternalServerErrorException('Failed to create new round');
        }

        // Update auction currentRound
        const updatedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              currentRound: nextRoundIndex,
            },
            { new: true, session },
          )
          .exec();

        if (!updatedAuction) {
          throw new InternalServerErrorException('Failed to update auction');
        }

        result = {
          auction: updatedAuction,
          round: newRound[0],
        };

        this.logger.log(
          `Advanced auction ${auctionId} to round ${nextRoundIndex}`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error advancing round for auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to advance round: ${errorMessage}`,
      );
    }
  }

  /**
   * Finalize auction after last round
   * Closes the last round if not closed, then refunds all remaining active bids
   *
   * @param auctionId Auction ID
   * @returns Finalized auction document
   */
  async finalizeAuction(auctionId: string): Promise<AuctionDocument> {
    const session = await this.connection.startSession();

    try {
      let result: AuctionDocument;

      await session.withTransaction(async () => {
        const auction = await this.auctionModel
          .findById(auctionId)
          .session(session)
          .exec();

        if (!auction) {
          throw new NotFoundException(`Auction ${auctionId} not found`);
        }

        if (auction.status === AuctionStatus.COMPLETED) {
          // Already finalized, return as-is
          result = auction;
          return;
        }

        if (
          auction.status !== AuctionStatus.RUNNING &&
          auction.status !== AuctionStatus.FINALIZING
        ) {
          throw new BadRequestException(
            `Auction must be RUNNING or FINALIZING to finalize. Current: ${auction.status}`,
          );
        }

        // Check if last round is closed, if not - close it first
        const currentRound = await this.auctionRoundModel
          .findOne({
            auctionId,
            roundIndex: auction.currentRound,
          })
          .session(session)
          .exec();

        if (currentRound && !currentRound.closed) {
          // Close the last round first
          const isLastRound = auction.currentRound === auction.totalRounds - 1;
          if (isLastRound) {
            // Calculate remaining gifts for last round
            const previousRounds = await this.auctionRoundModel
              .find({
                auctionId,
                roundIndex: { $lt: auction.currentRound },
                closed: true,
              })
              .session(session)
              .exec();

            const alreadyAwarded = previousRounds.reduce(
              (sum, r) => sum + r.winnersCount,
              0,
            );

            const giftsPerRound = Math.max(0, auction.totalGifts - alreadyAwarded);

            const winnerBids = await this.calculateWinners(
              auctionId,
              auction.currentRound,
              giftsPerRound,
              session,
            );

            // Mark winners and process payouts (idempotent)
            for (const bid of winnerBids) {
              // Idempotency check: verify bid is still ACTIVE
              const currentBid = await this.bidModel
                .findById(bid._id)
                .session(session)
                .exec();

              if (!currentBid || currentBid.status !== BidStatus.ACTIVE) {
                if (currentBid) {
                  this.logger.log(
                    `Bid ${bid._id} already ${currentBid.status}, skipping (idempotency)`,
                  );
                }
                continue;
              }

              // Update bid status to WON and record wonInRoundIndex (for /auctions/:id/rounds)
              await this.bidModel
                .findByIdAndUpdate(
                  bid._id,
                  {
                    status: BidStatus.WON,
                    wonInRoundIndex: auction.currentRound,
                    updatedAt: new Date(),
                  },
                  { new: true, session },
                )
                .exec();

              // Process payout (use bidId as referenceId for idempotency)
              await this.balanceService.payout(
                bid.userId.toString(),
                bid.amount,
                bid._id.toString(), // Use bidId for idempotency
                `Payout for winning bid in final round ${auction.currentRound}`,
                session,
              );
            }

            // Close the round
            await this.auctionRoundModel
              .findByIdAndUpdate(
                currentRound._id,
                {
                  closed: true,
                  winnersCount: winnerBids.length,
                  updatedAt: new Date(),
                },
                { session },
              )
              .exec();
          }
        }

        // Transition to FINALIZING if not already
        // Note: auction.status can be RUNNING or FINALIZING at this point
        // If RUNNING, transition to FINALIZING; if already FINALIZING, keep it
        if (auction.status === AuctionStatus.RUNNING) {
          await this.auctionModel
            .findByIdAndUpdate(
              auctionId,
              {
                status: AuctionStatus.FINALIZING,
              },
              { session },
            )
            .exec();
        }
        // If already FINALIZING, no need to update (idempotency)

        // CRITICAL PERFORMANCE FIX: Use batch processing for refunds
        // Instead of loading all millions of bids, process in batches using cursor
        // This prevents memory exhaustion and allows for better transaction handling
        
        const BATCH_SIZE = 1000; // Process 1000 bids at a time
        let refundedCount = 0;
        let hasMore = true;
        let lastBidId: string | null = null;

        while (hasMore) {
          // Build query: get next batch of active bids
          const query: any = {
            auctionId,
            status: BidStatus.ACTIVE,
          };
          
          // Use cursor pagination for efficient batching
          if (lastBidId) {
            query._id = { $gt: lastBidId };
          }

          // Get batch of bids to process
          const activeBidsBatch = await this.bidModel
            .find(query)
            .sort({ _id: 1 }) // Sort by _id for cursor pagination
            .limit(BATCH_SIZE)
            .session(session)
            .exec();

          if (activeBidsBatch.length === 0) {
            hasMore = false;
            break;
          }

          // Process batch
          for (const bid of activeBidsBatch) {
            // Idempotency check: verify bid is still ACTIVE (may have been processed by another instance)
            const currentBid = await this.bidModel
              .findOne({
                _id: bid._id,
                auctionId,
                status: BidStatus.ACTIVE,
              })
              .session(session)
              .exec();

            if (!currentBid) {
              // Bid already processed or deleted, skip (idempotency)
              this.logger.debug(`Bid ${bid._id} not found or already processed, skipping refund`);
              continue;
            }

            // Mark bid as REFUNDED first (atomically) to prevent double processing
            const updatedBid = await this.bidModel
              .findByIdAndUpdate(
                bid._id,
                {
                  status: BidStatus.REFUNDED,
                  updatedAt: new Date(),
                },
                { new: true, session },
              )
              .exec();

            if (!updatedBid) {
              // Another process might have updated it, skip (idempotency)
              this.logger.debug(`Bid ${bid._id} update failed (may be processed already), skipping refund`);
              continue;
            }

            // Process refund (use bidId as referenceId for idempotency)
            await this.balanceService.refund(
              bid.userId.toString(),
              bid.amount,
              bid._id.toString(), // Use bidId as referenceId - one refund per bid
              `Refund for non-winning bid after auction completion`,
              session,
            );

            refundedCount++;
            lastBidId = bid._id.toString();
          }

          // If batch was smaller than BATCH_SIZE, we're done
          if (activeBidsBatch.length < BATCH_SIZE) {
            hasMore = false;
          }

          // Log progress for large refunds
          if (refundedCount % 10000 === 0) {
            this.logger.log(
              `Processed ${refundedCount} refunds for auction ${auctionId} (batch processing)`,
            );
          }
        }

        this.logger.log(
          `Completed refund processing for auction ${auctionId}: ${refundedCount} bids refunded`,
        );

        // Mark auction as COMPLETED
        const finalizedAuction = await this.auctionModel
          .findByIdAndUpdate(
            auctionId,
            {
              status: AuctionStatus.COMPLETED,
              endsAt: new Date(),
            },
            { new: true, session },
          )
          .exec();

        if (!finalizedAuction) {
          throw new InternalServerErrorException('Failed to finalize auction');
        }

        result = finalizedAuction;

        this.logger.log(
          `Finalized auction ${auctionId}, refunded ${refundedCount} bids`,
        );
      });

      await session.endSession();
      return result!;
    } catch (error) {
      await session.endSession();

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error(`Error finalizing auction ${auctionId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to finalize auction: ${errorMessage}`,
      );
    }
  }

  /**
   * Get all auctions
   *
   * @returns Array of all auction documents
   */
  async getAllAuctions(): Promise<AuctionDocument[]> {
    return this.auctionModel.find().sort({ createdAt: -1 }).exec();
  }

  /**
   * Get auction by ID
   *
   * @param auctionId Auction ID
   * @returns Auction document
   */
  async getAuctionById(auctionId: string): Promise<AuctionDocument> {
    const auction = await this.auctionModel.findById(auctionId).exec();
    if (!auction) {
      throw new NotFoundException(`Auction ${auctionId} not found`);
    }
    return auction;
  }

  /**
   * Get current round for auction
   *
   * @param auctionId Auction ID
   * @returns Current round document
   */
  async getCurrentRound(
    auctionId: string,
  ): Promise<AuctionRoundDocument | null> {
    const auction = await this.getAuctionById(auctionId);
    return this.auctionRoundModel
      .findOne({
        auctionId,
        roundIndex: auction.currentRound,
      })
      .exec();
  }

  /**
   * Get all rounds for auction
   *
   * @param auctionId Auction ID
   * @returns Array of round documents
   */
  async getAuctionRounds(auctionId: string): Promise<AuctionRoundDocument[]> {
    return this.auctionRoundModel
      .find({ auctionId })
      .sort({ roundIndex: 1 })
      .exec();
  }

  /**
   * Calculate gifts per round for current round (for display purposes)
   * Uses the same logic as closeCurrentRound but without transaction
   *
   * @param auctionId Auction ID
   * @returns Object with giftsPerRound and remainingGifts
   */
  async calculateGiftsPerRoundForDisplay(
    auctionId: string,
  ): Promise<{ giftsPerRound: number; remainingGifts: number; alreadyAwarded: number }> {
    const auction = await this.getAuctionById(auctionId);
    const isLastRound = auction.currentRound === auction.totalRounds - 1;

    // Calculate how many gifts were already awarded in previous rounds
    const previousRounds = await this.auctionRoundModel
      .find({
        auctionId,
        roundIndex: { $lt: auction.currentRound },
        closed: true,
      })
      .exec();

    const alreadyAwarded = previousRounds.reduce(
      (sum, r) => sum + r.winnersCount,
      0,
    );

    const remainingGifts = auction.totalGifts - alreadyAwarded;

    let giftsPerRound: number;
    if (isLastRound) {
      giftsPerRound = Math.max(0, remainingGifts);
    } else {
      const baseGiftsPerRound = Math.ceil(auction.totalGifts / auction.totalRounds);
      giftsPerRound = Math.min(baseGiftsPerRound, Math.max(0, remainingGifts));
    }

    return {
      giftsPerRound,
      remainingGifts: Math.max(0, remainingGifts),
      alreadyAwarded,
    };
  }
}


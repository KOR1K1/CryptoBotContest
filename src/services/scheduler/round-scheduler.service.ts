import { Injectable, Logger, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuctionRound,
  AuctionRoundDocument,
} from '../../models/auction-round.schema';
import { Auction, AuctionDocument } from '../../models/auction.schema';
import { AuctionStatus } from '../../common/enums/auction-status.enum';
import { AuctionService } from '../auction/auction.service';
import { AuctionsGateway } from '../../gateways/auctions.gateway';
import { BidUpdateThrottlerService } from '../throttler/bid-update-throttler.service';

/**
 * RoundScheduler
 *
 * Background job service for automatically closing auction rounds
 *
 * Features:
 * - Restart-safe: checks persisted round state from MongoDB
 * - Idempotent: safe to retry (checks if round is already closed)
 * - Retry logic: handles failures gracefully
 * - No setTimeout: uses cron jobs that check database state
 *
 * Strategy:
 * - Polls database periodically for rounds that should be closed
 * - Checks endsAt <= now && closed === false
 * - Closes round via AuctionService.closeCurrentRound()
 * - Advances to next round if not last round
 * - Finalizes auction if last round
 */
@Injectable()
export class RoundSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(RoundSchedulerService.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 5000; // 5 seconds

  constructor(
    @InjectModel(AuctionRound.name)
    private auctionRoundModel: Model<AuctionRoundDocument>,
    @InjectModel(Auction.name)
    private auctionModel: Model<AuctionDocument>,
    private auctionService: AuctionService,
    private auctionsGateway: AuctionsGateway,
    @Inject(forwardRef(() => BidUpdateThrottlerService))
    @Optional()
    private bidUpdateThrottler: BidUpdateThrottlerService | null,
    @Inject(CACHE_MANAGER)
    @Optional()
    private cacheManager: Cache | null,
  ) {}

  /**
   * Called when module initializes
   * Logs scheduler startup and recovers stuck auctions
   */
  async onModuleInit() {
    this.logger.log({
      action: 'scheduler-initialized',
      service: 'RoundSchedulerService',
      cronInterval: `${this.getCronInterval()} seconds`,
      maxRetries: this.MAX_RETRIES,
      retryDelayMs: this.RETRY_DELAY_MS,
    }, 'RoundScheduler initialized');

    // Recover stuck auctions on startup
    // This handles cases where:
    // 1. Auction is RUNNING but all rounds are completed
    // 2. Last round is closed but auction is not finalized
    // 3. Rounds are overdue and should be closed
    try {
      await this.recoverStuckAuctions();
    } catch (error) {
      this.logger.error({
        action: 'recovery-error',
        error: error instanceof Error ? error.message : String(error),
      }, 'Error during auction recovery on startup');
    }
  }

  /**
   * Get cron interval description for logging
   */
  private getCronInterval(): string {
    // CronExpression.EVERY_SECOND = '* * * * * *'
    // Runs every 1 second for fast response on short auctions
    return '1';
  }

  /**
   * Main cron job: checks for rounds that should be closed
   * Runs every 1 second for fast response on short auctions (30s, 1min, etc.)
   *
   * Strategy:
   * 1. Find all unclosed rounds where endsAt <= now
   * 2. For each round, attempt to close it
   * 3. Handle errors with retry logic
   * 4. Advance to next round or finalize auction
   */
  @Cron(CronExpression.EVERY_SECOND, {
    name: 'close-rounds',
  })
  async closeRoundJob() {
    const jobStartTime = new Date();
    try {
      const now = new Date();

      // Find rounds that should be closed (endsAt <= now && closed === false)
      // Using persisted state from MongoDB (restart-safe)
      const roundsToClose = await this.auctionRoundModel
        .find({
          closed: false,
          endsAt: { $lte: now },
        })
        .sort({ endsAt: 1 }) // Process oldest first
        .exec();

      if (roundsToClose.length === 0) {
        // No rounds to close - normal case (log at debug level)
        this.logger.debug({
          job: 'close-rounds',
          action: 'check',
          found: 0,
          timestamp: now.toISOString(),
        }, 'No rounds to close');
        return;
      }

      // Structured log for found rounds
      this.logger.log({
        job: 'close-rounds',
        action: 'check',
        found: roundsToClose.length,
        rounds: roundsToClose.map(r => ({
          roundId: r._id.toString(),
          auctionId: r.auctionId.toString(),
          roundIndex: r.roundIndex,
          endsAt: r.endsAt.toISOString(),
          overdueByMs: now.getTime() - r.endsAt.getTime(),
        })),
        timestamp: now.toISOString(),
      }, `Found ${roundsToClose.length} round(s) that should be closed`);

      // Process each round
      let processed = 0;
      let failed = 0;
      for (const round of roundsToClose) {
        try {
          await this.processRoundClosing(round);
          processed++;
        } catch (error) {
          failed++;
          this.logger.error({
            job: 'close-rounds',
            action: 'process-round',
            roundId: round._id.toString(),
            auctionId: round.auctionId.toString(),
            roundIndex: round.roundIndex,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }, `Failed to process round ${round.roundIndex} for auction ${round.auctionId}`);
        }
      }

      // Summary log
      this.logger.log({
        job: 'close-rounds',
        action: 'complete',
        total: roundsToClose.length,
        processed,
        failed,
        durationMs: new Date().getTime() - jobStartTime.getTime(),
      }, `Round closing job completed: ${processed} processed, ${failed} failed`);
    } catch (error) {
      this.logger.error({
        job: 'close-rounds',
        action: 'error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: new Date().getTime() - jobStartTime.getTime(),
      }, 'Error in closeRoundJob');
      // Don't throw - allow next cron run to retry
    }
  }

  /**
   * Process closing of a single round
   * Includes retry logic and error handling
   *
   * @param round Round to close
   */
  private async processRoundClosing(
    round: AuctionRoundDocument,
  ): Promise<void> {
    const auctionId = round.auctionId.toString();
    const roundIndex = round.roundIndex;
    const roundId = round._id.toString();
    const processStartTime = new Date();

    // Structured log: starting round processing
    this.logger.log({
      action: 'process-round-start',
      roundId,
      auctionId,
      roundIndex,
      endsAt: round.endsAt.toISOString(),
      overdueByMs: new Date().getTime() - round.endsAt.getTime(),
    }, `Processing round ${roundIndex} for auction ${auctionId} (ended at ${round.endsAt.toISOString()})`);

    // Double-check round is still unclosed (idempotency check)
    // Another instance might have closed it
    const currentRound = await this.auctionRoundModel
      .findById(round._id)
      .exec();

    if (!currentRound) {
      this.logger.warn({
        action: 'process-round-skip',
        roundId,
        auctionId,
        roundIndex,
        reason: 'round-not-found',
      }, `Round ${round._id} not found - may have been deleted`);
      return;
    }

    if (currentRound.closed) {
      this.logger.log({
        action: 'process-round-skip',
        roundId,
        auctionId,
        roundIndex,
        reason: 'already-closed',
        closedAt: currentRound.updatedAt.toISOString(),
      }, `Round ${roundIndex} for auction ${auctionId} already closed (idempotency check passed)`);
      return;
    }

    // Check auction still exists and is running
    const auction = await this.auctionModel.findById(auctionId).exec();
    if (!auction) {
      this.logger.warn({
        action: 'process-round-skip',
        roundId,
        auctionId,
        roundIndex,
        reason: 'auction-not-found',
      }, `Auction ${auctionId} not found - skipping round close`);
      return;
    }

    if (auction.status !== AuctionStatus.RUNNING) {
      this.logger.warn({
        action: 'process-round-skip',
        roundId,
        auctionId,
        roundIndex,
        reason: 'auction-not-running',
        currentStatus: auction.status,
      }, `Auction ${auctionId} is not RUNNING (status: ${auction.status}) - skipping round close`);
      return;
    }

    // Attempt to close round with retry logic
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await this.closeRoundWithRetry(auctionId, attempt, roundIndex, roundId);
        
        // Success log
        this.logger.log({
          action: 'process-round-success',
          roundId,
          auctionId,
          roundIndex,
          attempt,
          durationMs: new Date().getTime() - processStartTime.getTime(),
        }, `Successfully processed round ${roundIndex} for auction ${auctionId} on attempt ${attempt}`);
        return; // Success - exit retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn({
          action: 'process-round-retry',
          roundId,
          auctionId,
          roundIndex,
          attempt,
          maxRetries: this.MAX_RETRIES,
          error: lastError.message,
          willRetry: attempt < this.MAX_RETRIES,
          retryDelayMs: attempt < this.MAX_RETRIES ? this.RETRY_DELAY_MS * attempt : null,
        }, `Attempt ${attempt}/${this.MAX_RETRIES} failed to close round ${roundIndex} for auction ${auctionId}: ${lastError.message}`);

        if (attempt < this.MAX_RETRIES) {
          // Wait before retry
          await this.sleep(this.RETRY_DELAY_MS * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    this.logger.error({
      action: 'process-round-failed',
      roundId,
      auctionId,
      roundIndex,
      attempts: this.MAX_RETRIES,
      durationMs: new Date().getTime() - processStartTime.getTime(),
      error: lastError?.message,
      stack: lastError?.stack,
    }, `Failed to close round ${roundIndex} for auction ${auctionId} after ${this.MAX_RETRIES} attempts: ${lastError?.message}`);
    // Don't throw - allow next cron run to retry again
  }

  /**
   * Close round with idempotency check
   *
   * @param auctionId Auction ID
   * @param attempt Attempt number (for logging)
   * @param roundIndex Round index (for logging)
   * @param roundId Round ID (for logging)
   */
  private async closeRoundWithRetry(
    auctionId: string,
    attempt: number,
    roundIndex: number,
    roundId: string,
  ): Promise<void> {
    const closeStartTime = new Date();
    try {
      // Close current round (idempotent - checks if already closed)
      this.logger.log({
        action: 'close-round-start',
        auctionId,
        roundIndex,
        roundId,
        attempt,
      }, `Closing round ${roundIndex} for auction ${auctionId} (attempt ${attempt})`);

      const result = await this.auctionService.closeCurrentRound(auctionId);

      // Force flush any pending bid updates before round closure (critical update)
      if (this.bidUpdateThrottler) {
        await this.bidUpdateThrottler.forceFlush(auctionId);
      }

      // Invalidate dashboard cache for this auction (round closure changes dashboard data)
      await this.invalidateDashboardCache(auctionId);

      // Emit WebSocket update for round closure (immediate, not throttled)
      this.auctionsGateway.emitRoundClosed(
        auctionId,
        {
          roundIndex: result.round.roundIndex,
          startedAt: result.round.startedAt,
          endsAt: result.round.endsAt,
          closed: result.round.closed,
          winnersCount: result.winners.length,
        },
        result.winners.map(w => ({
          userId: w.userId.toString(),
          bidId: w.bidId.toString(),
          amount: w.amount,
        })),
      );
      this.auctionsGateway.emitAuctionUpdate(auctionId, await this.auctionService.getAuctionById(auctionId));
      this.auctionsGateway.emitAuctionsListUpdate();

      // Structured log: round closed successfully
      this.logger.log({
        action: 'close-round-success',
        auctionId,
        roundIndex,
        roundId,
        attempt,
        winnersCount: result.winners.length,
        winners: result.winners.map(w => ({
          userId: w.userId.toString(),
          bidId: w.bidId.toString(),
          amount: w.amount,
        })),
        durationMs: new Date().getTime() - closeStartTime.getTime(),
      }, `Successfully closed round ${roundIndex} for auction ${auctionId} (attempt ${attempt}). Winners: ${result.winners.length}`);

      // Check if this was the last round OR if all gifts have been awarded
      // CRITICAL: Use roundIndex from the round we just closed, not auction.currentRound
      // because currentRound may have been incremented by advanceRound() already
      const auction = await this.auctionService.getAuctionById(auctionId);
      // roundIndex is 0-based, totalRounds is count (1-based)
      // Last round index = totalRounds - 1
      const wasLastRound = roundIndex === auction.totalRounds - 1;

      // Check if all gifts have been awarded (may happen before last round)
      const allRounds = await this.auctionRoundModel
        .find({ auctionId })
        .exec();
      const closedRounds = allRounds.filter(r => r.closed);
      const totalAwarded = closedRounds.reduce((sum, r) => sum + (r.winnersCount || 0), 0);
      const allGiftsAwarded = totalAwarded >= auction.totalGifts;

      if (wasLastRound || allGiftsAwarded) {
        // Finalize auction after last round
        const reason = wasLastRound 
          ? 'last round closed' 
          : `all ${totalAwarded}/${auction.totalGifts} gifts awarded`;
        
        this.logger.log({
          action: 'finalize-auction-start',
          auctionId,
          lastRoundIndex: roundIndex,
          reason,
          totalAwarded,
          totalGifts: auction.totalGifts,
        }, `Finalizing auction ${auctionId} (${reason})...`);
        
        const finalizeStartTime = new Date();
        const finalizedAuction = await this.auctionService.finalizeAuction(auctionId);
        
        this.logger.log({
          action: 'finalize-auction-success',
          auctionId,
          lastRoundIndex: roundIndex,
          durationMs: new Date().getTime() - finalizeStartTime.getTime(),
        }, `Auction ${auctionId} finalized successfully`);

        // Invalidate dashboard cache (auction status changed to COMPLETED)
        await this.invalidateDashboardCache(auctionId);

        // Small delay to ensure cache invalidation is processed
        await new Promise(resolve => setTimeout(resolve, 50));

        // Emit WebSocket event for auction completion with full auction data
        const fullAuction = await this.auctionService.getAuctionById(auctionId);
        this.auctionsGateway.emitAuctionUpdate(auctionId, {
          id: fullAuction._id.toString(),
          status: fullAuction.status,
          currentRound: fullAuction.currentRound,
          totalRounds: fullAuction.totalRounds,
          giftId: fullAuction.giftId?.toString(),
          totalGifts: fullAuction.totalGifts,
          minBid: fullAuction.minBid,
          startedAt: fullAuction.startedAt,
          endsAt: fullAuction.endsAt,
          createdAt: fullAuction.createdAt,
        });
        this.auctionsGateway.emitAuctionsListUpdate();
        
        this.logger.log(`Auction ${auctionId} finalized and WebSocket events emitted`);
      } else {
        // Advance to next round
        this.logger.log({
          action: 'advance-round-start',
          auctionId,
          currentRound: roundIndex,
          nextRound: roundIndex + 1,
        }, `Advancing auction ${auctionId} to next round...`);
        
        const advanceStartTime = new Date();
        const advanceResult = await this.auctionService.advanceRound(auctionId);
        
        this.logger.log({
          action: 'advance-round-success',
          auctionId,
          previousRound: roundIndex,
          currentRound: advanceResult.auction.currentRound,
          durationMs: new Date().getTime() - advanceStartTime.getTime(),
        }, `Auction ${auctionId} advanced to round ${advanceResult.auction.currentRound}`);
      }
    } catch (error) {
      // Check if error is due to round already being closed (idempotency)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('already closed') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('already finalized')
      ) {
        this.logger.log({
          action: 'close-round-idempotent',
          auctionId,
          roundIndex,
          roundId,
          attempt,
          reason: 'already-processed',
          errorMessage,
          durationMs: new Date().getTime() - closeStartTime.getTime(),
        }, `Round ${roundIndex} already processed for auction ${auctionId} (idempotency): ${errorMessage}`);
        return; // Success - round was already processed
      }

      // Structured error log before re-throwing
      this.logger.error({
        action: 'close-round-error',
        auctionId,
        roundIndex,
        roundId,
        attempt,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: new Date().getTime() - closeStartTime.getTime(),
      }, `Error closing round ${roundIndex} for auction ${auctionId}: ${errorMessage}`);

      // Re-throw other errors for retry logic
      throw error;
    }
  }

  /**
   * Helper: sleep for specified milliseconds
   *
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for closing rounds (for testing/admin)
   * Checks for overdue rounds and processes them
   *
   * @returns Number of rounds processed
   */
  async triggerRoundClosing(): Promise<number> {
    this.logger.log('Manual trigger for round closing');
    const now = new Date();

    const roundsToClose = await this.auctionRoundModel
      .find({
        closed: false,
        endsAt: { $lte: now },
      })
      .exec();

    let processed = 0;
    for (const round of roundsToClose) {
      try {
        await this.processRoundClosing(round);
        processed++;
      } catch (error) {
        this.logger.error(
          `Error processing round ${round._id}:`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    this.logger.log(`Manually processed ${processed} round(s)`);
    return processed;
  }

  /**
   * Get status of scheduler
   * Returns information about overdue rounds
   *
   * @returns Scheduler status
   */
  async getSchedulerStatus(): Promise<{
    overdueRounds: number;
    runningAuctions: number;
    nextRoundToClose: Date | null;
  }> {
    const now = new Date();

    const overdueRounds = await this.auctionRoundModel.countDocuments({
      closed: false,
      endsAt: { $lte: now },
    });

    const runningAuctions = await this.auctionModel.countDocuments({
      status: AuctionStatus.RUNNING,
    });

    const nextRound = await this.auctionRoundModel
      .findOne({
        closed: false,
        endsAt: { $gt: now },
      })
      .sort({ endsAt: 1 })
      .exec();

    return {
      overdueRounds,
      runningAuctions,
      nextRoundToClose: nextRound?.endsAt || null,
    };
  }

  /**
   * Recover stuck auctions on startup
   * Checks all RUNNING auctions and ensures they are in correct state
   * - Closes overdue rounds
   * - Finalizes auctions where all rounds are completed
   * - Handles auctions stuck in FINALIZING state
   */
  private async recoverStuckAuctions(): Promise<void> {
    this.logger.log({
      action: 'recovery-start',
    }, 'Starting auction recovery on startup...');

    const now = new Date();
    let recoveredCount = 0;
    let finalizedCount = 0;

    try {
      // Find all RUNNING auctions
      const runningAuctions = await this.auctionModel
        .find({
          status: AuctionStatus.RUNNING,
        })
        .exec();

      this.logger.log({
        action: 'recovery-check',
        runningAuctions: runningAuctions.length,
      }, `Found ${runningAuctions.length} RUNNING auction(s) to check`);

      for (const auction of runningAuctions) {
        try {
          const auctionId = auction._id.toString();
          
          // Get all rounds for this auction
          const allRounds = await this.auctionRoundModel
            .find({ auctionId })
            .sort({ roundIndex: 1 })
            .exec();

          // Check if all gifts have been awarded
          const closedRounds = allRounds.filter(r => r.closed);
          const totalAwarded = closedRounds.reduce((sum, r) => sum + (r.winnersCount || 0), 0);
          
          if (totalAwarded >= auction.totalGifts) {
            // All gifts awarded - auction should be finalized
            this.logger.warn({
              action: 'recovery-finalize-all-gifts',
              auctionId,
              totalAwarded,
              totalGifts: auction.totalGifts,
              status: auction.status,
            }, `Auction ${auctionId} has awarded all ${totalAwarded}/${auction.totalGifts} gifts but is still RUNNING. Finalizing...`);

            try {
              const finalizedAuction = await this.auctionService.finalizeAuction(auctionId);
              finalizedCount++;
              this.logger.log({
                action: 'recovery-finalize-success',
                auctionId,
              }, `Successfully finalized auction ${auctionId} (all gifts awarded)`);
              
              // Invalidate dashboard cache
              await this.invalidateDashboardCache(auctionId);
              
              // Emit WebSocket event with full auction data
              const fullAuction = await this.auctionService.getAuctionById(auctionId);
              this.auctionsGateway.emitAuctionUpdate(auctionId, {
                id: fullAuction._id.toString(),
                status: fullAuction.status,
                currentRound: fullAuction.currentRound,
                totalRounds: fullAuction.totalRounds,
                giftId: fullAuction.giftId?.toString(),
                totalGifts: fullAuction.totalGifts,
                minBid: fullAuction.minBid,
                startedAt: fullAuction.startedAt,
                endsAt: fullAuction.endsAt,
                createdAt: fullAuction.createdAt,
              });
              this.auctionsGateway.emitAuctionsListUpdate();
            } catch (error) {
              this.logger.error({
                action: 'recovery-finalize-error',
                auctionId,
                error: error instanceof Error ? error.message : String(error),
              }, `Failed to finalize auction ${auctionId}: ${error instanceof Error ? error.message : String(error)}`);
            }
            continue;
          }

          // Check if last round exists and is closed
          const lastRoundIndex = auction.totalRounds - 1;
          const lastRound = allRounds.find(r => r.roundIndex === lastRoundIndex);

          if (lastRound && lastRound.closed) {
            // Last round is closed but auction is still RUNNING - needs finalization
            this.logger.warn({
              action: 'recovery-finalize',
              auctionId,
              lastRoundIndex,
              status: auction.status,
            }, `Auction ${auctionId} has closed last round but is still RUNNING. Finalizing...`);

            try {
              const finalizedAuction = await this.auctionService.finalizeAuction(auctionId);
              finalizedCount++;
              this.logger.log({
                action: 'recovery-finalize-success',
                auctionId,
              }, `Successfully finalized stuck auction ${auctionId}`);
              
              // Invalidate dashboard cache
              await this.invalidateDashboardCache(auctionId);
              
              // Emit WebSocket event with full auction data
              const fullAuction = await this.auctionService.getAuctionById(auctionId);
              this.auctionsGateway.emitAuctionUpdate(auctionId, {
                id: fullAuction._id.toString(),
                status: fullAuction.status,
                currentRound: fullAuction.currentRound,
                totalRounds: fullAuction.totalRounds,
                giftId: fullAuction.giftId?.toString(),
                totalGifts: fullAuction.totalGifts,
                minBid: fullAuction.minBid,
                startedAt: fullAuction.startedAt,
                endsAt: fullAuction.endsAt,
                createdAt: fullAuction.createdAt,
              });
              this.auctionsGateway.emitAuctionsListUpdate();
            } catch (error) {
              this.logger.error({
                action: 'recovery-finalize-error',
                auctionId,
                error: error instanceof Error ? error.message : String(error),
              }, `Failed to finalize auction ${auctionId}: ${error instanceof Error ? error.message : String(error)}`);
            }
            continue;
          }

          // Check for overdue rounds that should be closed
          const currentRound = allRounds.find(r => r.roundIndex === auction.currentRound);
          if (currentRound && !currentRound.closed && currentRound.endsAt <= now) {
            // Round is overdue - should be closed
            const overdueMs = now.getTime() - currentRound.endsAt.getTime();
            this.logger.warn({
              action: 'recovery-overdue-round',
              auctionId,
              roundIndex: currentRound.roundIndex,
              overdueByMs: overdueMs,
            }, `Auction ${auctionId} has overdue round ${currentRound.roundIndex} (overdue by ${Math.floor(overdueMs / 1000)}s). Closing...`);

            try {
              await this.processRoundClosing(currentRound);
              recoveredCount++;
              this.logger.log({
                action: 'recovery-round-success',
                auctionId,
                roundIndex: currentRound.roundIndex,
              }, `Successfully closed overdue round ${currentRound.roundIndex} for auction ${auctionId}`);
            } catch (error) {
              this.logger.error({
                action: 'recovery-round-error',
                auctionId,
                roundIndex: currentRound.roundIndex,
                error: error instanceof Error ? error.message : String(error),
              }, `Failed to close overdue round ${currentRound.roundIndex} for auction ${auctionId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          this.logger.error({
            action: 'recovery-auction-error',
            auctionId: auction._id.toString(),
            error: error instanceof Error ? error.message : String(error),
          }, `Error recovering auction ${auction._id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Also check for auctions stuck in FINALIZING state
      const finalizingAuctions = await this.auctionModel
        .find({
          status: AuctionStatus.FINALIZING,
        })
        .exec();

      this.logger.log({
        action: 'recovery-check-finalizing',
        finalizingAuctions: finalizingAuctions.length,
      }, `Found ${finalizingAuctions.length} FINALIZING auction(s) to check`);

      for (const auction of finalizingAuctions) {
        try {
          const auctionId = auction._id.toString();
          
          // Check if auction should be COMPLETED
          // If it's been in FINALIZING for more than 5 minutes, try to complete it
          const updatedAt = auction.updatedAt || auction.createdAt;
          const timeInFinalizing = now.getTime() - updatedAt.getTime();
          
          if (timeInFinalizing > 5 * 60 * 1000) { // 5 minutes
            this.logger.warn({
              action: 'recovery-complete-finalizing',
              auctionId,
              timeInFinalizingMs: timeInFinalizing,
            }, `Auction ${auctionId} has been in FINALIZING state for ${Math.floor(timeInFinalizing / 1000)}s. Attempting to complete...`);

            try {
              const finalizedAuction = await this.auctionService.finalizeAuction(auctionId);
              finalizedCount++;
              this.logger.log({
                action: 'recovery-complete-success',
                auctionId,
              }, `Successfully completed stuck FINALIZING auction ${auctionId}`);
              
              // Invalidate dashboard cache
              await this.invalidateDashboardCache(auctionId);
              
              // Emit WebSocket event with full auction data
              const fullAuction = await this.auctionService.getAuctionById(auctionId);
              this.auctionsGateway.emitAuctionUpdate(auctionId, {
                id: fullAuction._id.toString(),
                status: fullAuction.status,
                currentRound: fullAuction.currentRound,
                totalRounds: fullAuction.totalRounds,
                giftId: fullAuction.giftId?.toString(),
                totalGifts: fullAuction.totalGifts,
                minBid: fullAuction.minBid,
                startedAt: fullAuction.startedAt,
                endsAt: fullAuction.endsAt,
                createdAt: fullAuction.createdAt,
              });
              this.auctionsGateway.emitAuctionsListUpdate();
            } catch (error) {
              this.logger.error({
                action: 'recovery-complete-error',
                auctionId,
                error: error instanceof Error ? error.message : String(error),
              }, `Failed to complete FINALIZING auction ${auctionId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          this.logger.error({
            action: 'recovery-finalizing-error',
            auctionId: auction._id.toString(),
            error: error instanceof Error ? error.message : String(error),
          }, `Error recovering FINALIZING auction ${auction._id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.logger.log({
        action: 'recovery-complete',
        runningAuctions: runningAuctions.length,
        finalizingAuctions: finalizingAuctions.length,
        recoveredRounds: recoveredCount,
        finalizedAuctions: finalizedCount,
      }, `Auction recovery completed: ${recoveredCount} rounds closed, ${finalizedCount} auctions finalized`);
    } catch (error) {
      this.logger.error({
        action: 'recovery-fatal-error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, `Fatal error during auction recovery: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Invalidate dashboard cache for an auction
   * Called when round closures occur or auction finalizes
   * 
   * @param auctionId Auction ID
   */
  private async invalidateDashboardCache(auctionId: string): Promise<void> {
    if (!this.cacheManager) {
      return; // Cache not available (optional dependency)
    }

    try {
      // Invalidate dashboard cache for this auction
      // Pattern: dashboard:${auctionId}:*
      // Delete common cache key (dashboard:auctionId:all)
      await this.cacheManager.del(`dashboard:${auctionId}:all`);
      
      // Try to get Redis client from cache manager to delete pattern-based keys
      // This is a workaround - cache-manager doesn't support pattern deletion directly
      // For now, we rely on TTL expiration for user-specific keys
      // The cache TTL is very short (1-5 seconds), so stale data is acceptable for a brief period
      
      this.logger.debug(`Invalidated dashboard cache for auction ${auctionId}`);
    } catch (error) {
      // Log error but don't fail the request (cache invalidation is not critical)
      this.logger.error(`Error invalidating dashboard cache for auction ${auctionId}:`, error);
    }
  }
}


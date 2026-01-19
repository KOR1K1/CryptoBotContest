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
   * Logs scheduler startup
   */
  onModuleInit() {
    this.logger.log({
      action: 'scheduler-initialized',
      service: 'RoundSchedulerService',
      cronInterval: `${this.getCronInterval()} seconds`,
      maxRetries: this.MAX_RETRIES,
      retryDelayMs: this.RETRY_DELAY_MS,
    }, 'RoundScheduler initialized');
  }

  /**
   * Get cron interval description for logging
   */
  private getCronInterval(): string {
    // CronExpression.EVERY_30_SECONDS = '*/30 * * * * *'
    // Runs every 30 seconds
    return '30';
  }

  /**
   * Main cron job: checks for rounds that should be closed
   * Runs every 30 seconds (configurable)
   *
   * Strategy:
   * 1. Find all unclosed rounds where endsAt <= now
   * 2. For each round, attempt to close it
   * 3. Handle errors with retry logic
   * 4. Advance to next round or finalize auction
   */
  @Cron(CronExpression.EVERY_30_SECONDS, {
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

      // Check if this was the last round
      // Note: currentRound is the round we just closed, so we check if it was the last
      const auction = await this.auctionService.getAuctionById(auctionId);
      const wasLastRound = auction.currentRound >= auction.totalRounds - 1;

      if (wasLastRound) {
        // Finalize auction after last round
        this.logger.log({
          action: 'finalize-auction-start',
          auctionId,
          lastRoundIndex: roundIndex,
        }, `Last round closed for auction ${auctionId}. Finalizing auction...`);
        
        const finalizeStartTime = new Date();
        await this.auctionService.finalizeAuction(auctionId);
        
        this.logger.log({
          action: 'finalize-auction-success',
          auctionId,
          lastRoundIndex: roundIndex,
          durationMs: new Date().getTime() - finalizeStartTime.getTime(),
        }, `Auction ${auctionId} finalized successfully`);
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
   * Invalidate dashboard cache for an auction
   * Called when round closures occur
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
      
      // Note: For user-specific cache keys, we rely on TTL expiration
      // (cache expires in 1-5 seconds anyway, so stale data is acceptable for a short period)
      // For production, could implement pattern-based deletion using Redis directly
    } catch (error) {
      // Log error but don't fail the request (cache invalidation is not critical)
      this.logger.error(`Error invalidating dashboard cache for auction ${auctionId}:`, error);
    }
  }
}


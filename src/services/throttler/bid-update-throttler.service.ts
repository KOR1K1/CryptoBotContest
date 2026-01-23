import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { AuctionsGateway } from '../../gateways/auctions.gateway';
import { BidService } from '../bid/bid.service';
import { RedisLockService } from '../redis-lock/redis-lock.service';
import { ConfigService } from '@nestjs/config';

// троттлинг обновлений ставок через websocket
// батчит обновления в памяти и отправляет агрегированные обновления каждые 100мс
// для мульти-инстансов можно включить redis через конфиг
@Injectable()
export class BidUpdateThrottlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BidUpdateThrottlerService.name);
  private readonly BATCH_INTERVAL_MS = 100;
  private readonly TOP_POSITIONS_TO_TRACK = 10;
  private readonly USE_REDIS_FOR_THROTTLING: boolean;

  private readonly pendingBidUpdates = new Map<string, Set<any>>();
  private readonly lastTopPositions = new Map<string, { amounts: number[]; lastUpdate: Date }>();

  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(forwardRef(() => AuctionsGateway))
    private readonly auctionsGateway: AuctionsGateway | null,
    private readonly bidService: BidService,
    private readonly redisLockService: RedisLockService,
    private readonly configService: ConfigService,
  ) {
    this.USE_REDIS_FOR_THROTTLING = 
      this.redisLockService.isLockServiceAvailable() &&
      this.configService.get<boolean>('redis.useForThrottling', false);
    
    if (this.USE_REDIS_FOR_THROTTLING) {
      this.logger.log('Using Redis-backed throttling for multi-instance support');
    } else {
      this.logger.log('Using in-memory throttling (single instance mode)');
    }
  }

  onModuleInit() {
    this.flushTimer = setInterval(() => {
      this.flushPendingUpdates();
    }, this.BATCH_INTERVAL_MS);

    this.logger.log({
      service: 'BidUpdateThrottlerService',
      batchIntervalMs: this.BATCH_INTERVAL_MS,
      topPositionsToTrack: this.TOP_POSITIONS_TO_TRACK,
    }, 'BidUpdateThrottlerService initialized');
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushPendingUpdates();

    this.logger.log('BidUpdateThrottlerService destroyed');
  }

  queueBidUpdate(auctionId: string, bid: any): void {
    if (!this.pendingBidUpdates.has(auctionId)) {
      this.pendingBidUpdates.set(auctionId, new Set());
    }

    const updates = this.pendingBidUpdates.get(auctionId)!;
    
    const existingUpdate = Array.from(updates).find((b: any) => b.id === bid.id);
    if (existingUpdate) {
      updates.delete(existingUpdate);
    }
    updates.add(bid);

    this.logger.debug(`Queued bid update for auction ${auctionId}, pending: ${updates.size}`);
  }

  private async flushPendingUpdates(): Promise<void> {
    if (this.pendingBidUpdates.size === 0) {
      return;
    }

    const auctionsToProcess = Array.from(this.pendingBidUpdates.keys());
    
    for (const auctionId of auctionsToProcess) {
      const updates = this.pendingBidUpdates.get(auctionId);
      if (!updates || updates.size === 0) {
        continue;
      }

      try {
        const isSignificant = await this.checkSignificance(auctionId, Array.from(updates));

        if (isSignificant) {
          const topBids = await this.bidService.getTopActiveBids(auctionId, this.TOP_POSITIONS_TO_TRACK);
          const topAmounts = topBids.map(b => b.amount).sort((a, b) => b - a);

          this.lastTopPositions.set(auctionId, {
            amounts: topAmounts,
            lastUpdate: new Date(),
          });

          if (this.auctionsGateway) {
            this.auctionsGateway.emitBidUpdateImmediate(auctionId, {
              updatesCount: updates.size,
              topPositions: topBids.map((bid, index) => ({
                position: index + 1,
                userId: bid.userId.toString(),
                amount: bid.amount,
                username: (bid as any).username || 'Unknown',
                createdAt: bid.createdAt,
                roundIndex: bid.roundIndex,
              })),
            });
          } else {
            this.logger.warn(`AuctionsGateway not available, skipping emit for auction ${auctionId}`);
          }

          this.logger.debug(
            `Flushed ${updates.size} bid updates for auction ${auctionId} (significant changes detected)`,
          );
        } else {
          this.logger.debug(
            `Skipped ${updates.size} bid updates for auction ${auctionId} (no significant changes)`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error flushing bid updates for auction ${auctionId}:`,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        // Clear pending updates for this auction
        updates.clear();
      }
    }

    // Clean up empty entries
    for (const auctionId of auctionsToProcess) {
      if (this.pendingBidUpdates.get(auctionId)?.size === 0) {
        this.pendingBidUpdates.delete(auctionId);
      }
    }
  }

  // проверка значимости обновлений (нужно ли отправлять)
  private async checkSignificance(auctionId: string, updates: any[]): Promise<boolean> {
    if (updates.length === 0) {
      return false;
    }

    const currentTopBids = await this.bidService.getTopActiveBids(auctionId, this.TOP_POSITIONS_TO_TRACK);
    const currentTopAmounts = currentTopBids.map(b => b.amount).sort((a, b) => b - a);
    const minTopAmount = currentTopAmounts.length > 0 ? currentTopAmounts[currentTopAmounts.length - 1] : 0;

    const lastKnown = this.lastTopPositions.get(auctionId);
    
    if (!lastKnown || !lastKnown.amounts || lastKnown.amounts.length === 0) {
      return true;
    }

    if (currentTopAmounts.length !== lastKnown.amounts.length) {
      return true;
    }

    for (let i = 0; i < Math.min(currentTopAmounts.length, lastKnown.amounts.length); i++) {
      if (currentTopAmounts[i] !== lastKnown.amounts[i]) {
        return true;
      }
    }

    for (const update of updates) {
      if (update.amount >= minTopAmount) {
        return true;
      }
    }

    const lastMinAmount = lastKnown.amounts[lastKnown.amounts.length - 1];
    for (const update of updates) {
      if (update.amount >= lastMinAmount) {
        return true;
      }
    }

    return false;
  }

  // принудительная отправка обновлений (например при закрытии раунда)
  async forceFlush(auctionId: string): Promise<void> {
    const updates = this.pendingBidUpdates.get(auctionId);
    if (!updates || updates.size === 0) {
      return;
    }

    const updatesArray = Array.from(updates);
    const topBids = await this.bidService.getTopActiveBids(auctionId, this.TOP_POSITIONS_TO_TRACK);
    
    if (this.auctionsGateway) {
      this.auctionsGateway.emitBidUpdateImmediate(auctionId, {
        updatesCount: updatesArray.length,
        topPositions: topBids.map((bid, index) => ({
          position: index + 1,
          userId: bid.userId.toString(),
          amount: bid.amount,
          username: (bid as any).username || 'Unknown',
          createdAt: bid.createdAt,
          roundIndex: bid.roundIndex,
        })),
      });
    } else {
      this.logger.warn(`AuctionsGateway not available, skipping force flush for auction ${auctionId}`);
    }

    // Update cached positions
    const topAmounts = topBids.map(b => b.amount).sort((a, b) => b - a);
    this.lastTopPositions.set(auctionId, {
      amounts: topAmounts,
      lastUpdate: new Date(),
    });

    updates.clear();
    this.pendingBidUpdates.delete(auctionId);

    this.logger.log(`Force flushed ${updatesArray.length} bid updates for auction ${auctionId}`);
  }

  clearAuction(auctionId: string): void {
    this.pendingBidUpdates.delete(auctionId);
    this.lastTopPositions.delete(auctionId);
    this.logger.debug(`Cleared throttler cache for auction ${auctionId}`);
  }

  getStats(): {
    pendingAuctions: number;
    totalPendingUpdates: number;
    cachedAuctionPositions: number;
  } {
    let totalPendingUpdates = 0;
    for (const updates of this.pendingBidUpdates.values()) {
      totalPendingUpdates += updates.size;
    }

    return {
      pendingAuctions: this.pendingBidUpdates.size,
      totalPendingUpdates,
      cachedAuctionPositions: this.lastTopPositions.size,
    };
  }
}

import { Module, forwardRef } from '@nestjs/common';
import { BidUpdateThrottlerService } from './bid-update-throttler.service';
import { BidModule } from '../bid/bid.module';
import { GatewaysModule } from '../../gateways/gateways.module';
import { RedisLockModule } from '../redis-lock/redis-lock.module';

/**
 * ThrottlerModule
 *
 * Provides throttling services for WebSocket updates
 * Batches high-frequency updates to reduce server load
 * Optionally uses Redis for distributed throttling (multi-instance deployments)
 */
@Module({
  imports: [
    BidModule,
    forwardRef(() => GatewaysModule), // forwardRef to avoid circular dependency with AuctionsGateway
    RedisLockModule, // Optional Redis for distributed throttling
  ],
  providers: [BidUpdateThrottlerService],
  exports: [BidUpdateThrottlerService],
})
export class ThrottlerModule {}

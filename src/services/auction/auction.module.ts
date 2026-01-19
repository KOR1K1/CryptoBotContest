import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionService } from './auction.service';
import { Auction, AuctionSchema } from '../../models/auction.schema';
import {
  AuctionRound,
  AuctionRoundSchema,
} from '../../models/auction-round.schema';
import { Bid, BidSchema } from '../../models/bid.schema';
import { BidModule } from '../bid/bid.module';
import { BalanceModule } from '../balance/balance.module';
import { RedisLockModule } from '../redis-lock/redis-lock.module';

/**
 * AuctionModule
 *
 * Provides AuctionService for auction lifecycle management
 * Depends on BidModule and BalanceModule
 * Optionally uses RedisLockModule for distributed locking (high-load scenarios)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
      { name: AuctionRound.name, schema: AuctionRoundSchema },
      { name: Bid.name, schema: BidSchema },
    ]),
    BidModule,
    BalanceModule,
    RedisLockModule, // Optional Redis locks for high-load scenarios
  ],
  providers: [AuctionService],
  exports: [AuctionService],
})
export class AuctionModule {}


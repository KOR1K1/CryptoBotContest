import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BidService } from './bid.service';
import { Bid, BidSchema } from '../../models/bid.schema';
import { Auction, AuctionSchema } from '../../models/auction.schema';
import { User, UserSchema } from '../../models/user.schema';
import { BalanceModule } from '../balance/balance.module';
import { RedisLockModule } from '../redis-lock/redis-lock.module';

/**
 * BidModule
 *
 * Provides BidService for bid placement and management
 * Depends on BalanceModule for fund operations
 * Optionally uses RedisLockModule for distributed locking (high-load scenarios)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: User.name, schema: UserSchema }, // Added for balance validation inside transaction
    ]),
    BalanceModule,
    RedisLockModule, // Optional Redis locks for high-load scenarios
  ],
  providers: [BidService],
  exports: [BidService],
})
export class BidModule {}


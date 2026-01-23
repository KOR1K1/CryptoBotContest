import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BidService } from './bid.service';
import { Bid, BidSchema } from '../../models/bid.schema';
import { Auction, AuctionSchema } from '../../models/auction.schema';
import { User, UserSchema } from '../../models/user.schema';
import { BalanceModule } from '../balance/balance.module';
import { RedisLockModule } from '../redis-lock/redis-lock.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BalanceModule,
    RedisLockModule,
  ],
  providers: [BidService],
  exports: [BidService],
})
export class BidModule {}


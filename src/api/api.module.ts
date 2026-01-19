import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from '../controllers/users/users.controller';
import { AuctionsController } from '../controllers/auctions/auctions.controller';
import { GiftsController } from '../controllers/gifts/gifts.controller';
import { User, UserSchema } from '../models/user.schema';
import { Gift, GiftSchema } from '../models/gift.schema';
import { Auction, AuctionSchema } from '../models/auction.schema';
import { Bid, BidSchema } from '../models/bid.schema';
import { BalanceModule } from '../services/balance/balance.module';
import { AuctionModule } from '../services/auction/auction.module';
import { BidModule } from '../services/bid/bid.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { ThrottlerModule } from '../services/throttler/throttler.module';

/**
 * ApiModule
 *
 * Provides REST API controllers
 * Aggregates all service modules
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Gift.name, schema: GiftSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: Bid.name, schema: BidSchema },
    ]),
    BalanceModule,
    AuctionModule,
    BidModule,
    GatewaysModule, // WebSocket gateway
    ThrottlerModule, // WebSocket throttling
  ],
  controllers: [UsersController, AuctionsController, GiftsController],
  exports: [],
})
export class ApiModule {}


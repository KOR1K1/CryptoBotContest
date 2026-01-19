import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User,
  UserSchema,
  Gift,
  GiftSchema,
  Auction,
  AuctionSchema,
  AuctionRound,
  AuctionRoundSchema,
  Bid,
  BidSchema,
  LedgerEntry,
  LedgerEntrySchema,
} from './index';

/**
 * Models module
 * Registers all Mongoose schemas
 * This module is imported globally in AppModule
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Gift.name, schema: GiftSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: AuctionRound.name, schema: AuctionRoundSchema },
      { name: Bid.name, schema: BidSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ModelsModule {}


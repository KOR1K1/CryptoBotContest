import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BidStatus } from '../common/enums/bid-status.enum';

export type BidDocument = Bid & Document;

/**
 * Bid model
 *
 * Represents a user's bid in an auction
 * Bids are NEVER deleted - they represent historical financial operations
 *
 * Status lifecycle:
 * - ACTIVE: Bid is active and participates in rounds
 * - WON: Bid won in a round, user received gift
 * - REFUNDED: Auction ended, bid was refunded
 *
 * Invariants:
 * - amount >= minBid (enforced by BidService)
 * - ACTIVE bids have funds locked in User.lockedBalance
 * - Only one ACTIVE bid per user per auction at a time (enforced by BidService)
 */
@Schema({
  timestamps: true,
  collection: 'bids',
})
export class Bid {
  @Prop({ required: true, type: 'ObjectId', ref: 'User' })
  userId!: string;

  @Prop({ required: true, type: 'ObjectId', ref: 'Auction' })
  auctionId!: string;

  /**
   * Round index when this bid was placed/updated
   * Used for tracking and audit
   */
  @Prop({ required: true, min: 0 })
  roundIndex!: number;

  /**
   * Round index in which this bid won (only for status=WON).
   * Differs from roundIndex when bid was carried over from an earlier round.
   * Used by /auctions/:id/rounds to list winners per round.
   */
  @Prop({ min: 0 })
  wonInRoundIndex?: number;

  /**
   * Bid amount (in Stars/internal currency)
   * Must be >= auction.minBid
   */
  @Prop({ required: true, min: 1 })
  amount!: number;

  /**
   * Current status of the bid
   */
  @Prop({
    required: true,
    type: String,
    enum: Object.values(BidStatus),
    default: BidStatus.ACTIVE,
  })
  status!: BidStatus;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const BidSchema = SchemaFactory.createForClass(Bid);

// Compound indexes for performance
BidSchema.index({ auctionId: 1, status: 1, amount: -1, createdAt: 1 }); // For winner selection (covering index)
BidSchema.index({ auctionId: 1, userId: 1, status: 1 }); // For user's active bid lookup
BidSchema.index({ userId: 1, status: 1 }); // For user's bids across auctions
BidSchema.index({ auctionId: 1, roundIndex: 1 }); // For round-specific queries
BidSchema.index({ auctionId: 1, status: 1, wonInRoundIndex: 1 }); // For /auctions/:id/rounds winners
// Removed { createdAt: -1 } - covered by compound index above

// Validation
BidSchema.pre('save', function (next) {
  if (this.amount <= 0) {
    next(new Error('Bid amount must be positive'));
  } else {
    next();
  }
});


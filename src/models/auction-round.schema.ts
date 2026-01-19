import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuctionRoundDocument = AuctionRound & Document;

/**
 * AuctionRound model
 *
 * Represents a single round within an auction
 * Each round has a fixed duration and awards a fixed number of winners
 *
 * Invariants:
 * - roundIndex >= 0
 * - startedAt < endsAt (when closed)
 * - winnersCount >= 0
 * - closed = true implies winnersCount is set
 */
@Schema({
  timestamps: true,
  collection: 'auction_rounds',
  // versionKey: '__v' is enabled by default for optimistic locking
})
export class AuctionRound {
  @Prop({ required: true, type: 'ObjectId', ref: 'Auction', index: true })
  auctionId!: string;

  /**
   * Round index within the auction (0-based)
   */
  @Prop({ required: true, min: 0, index: true })
  roundIndex!: number;

  /**
   * When this round started
   */
  @Prop({ required: true })
  startedAt!: Date;

  /**
   * When this round ends (should close)
   */
  @Prop({ required: true, index: true })
  endsAt!: Date;

  /**
   * Number of winners in this round
   * Set when round is closed
   */
  @Prop({ default: 0, min: 0 })
  winnersCount!: number;

  /**
   * Whether this round has been closed
   * Closed rounds have winners selected
   */
  @Prop({ required: true, default: false, index: true })
  closed!: boolean;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const AuctionRoundSchema = SchemaFactory.createForClass(AuctionRound);

// Compound indexes for performance
AuctionRoundSchema.index({ auctionId: 1, roundIndex: 1 }, { unique: true });
AuctionRoundSchema.index({ auctionId: 1, closed: 1 });
AuctionRoundSchema.index({ endsAt: 1, closed: 1 }); // For scheduler queries
AuctionRoundSchema.index({ createdAt: -1 });

// Validation: ensure round invariants
AuctionRoundSchema.pre('save', function (next) {
  if (this.endsAt <= this.startedAt) {
    next(new Error('endsAt must be after startedAt'));
  } else if (this.closed && this.winnersCount < 0) {
    next(new Error('winnersCount must be non-negative when closed'));
  } else {
    next();
  }
});


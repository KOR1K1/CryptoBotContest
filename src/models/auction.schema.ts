import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AuctionStatus } from '../common/enums/auction-status.enum';

export type AuctionDocument = Auction & Document;

/**
 * Auction model
 *
 * State machine: CREATED -> RUNNING -> FINALIZING -> COMPLETED
 *
 * Invariants:
 * - currentRound >= 0 && currentRound <= totalRounds
 * - totalGifts > 0
 * - totalRounds > 0
 * - minBid > 0
 * - roundDurationMs > 0
 */
@Schema({
  timestamps: true,
  collection: 'auctions',
  // versionKey: '__v' is enabled by default for optimistic locking
})
export class Auction {
  @Prop({ required: true, type: 'ObjectId', ref: 'Gift' })
  giftId!: string;

  /**
   * Auction status
   * State transitions handled by AuctionService
   */
  @Prop({
    required: true,
    type: String,
    enum: Object.values(AuctionStatus),
    default: AuctionStatus.CREATED,
  })
  status!: AuctionStatus;

  /**
   * Total number of gifts to distribute across all rounds
   */
  @Prop({ required: true, min: 1 })
  totalGifts!: number;

  /**
   * Total number of rounds in this auction
   */
  @Prop({ required: true, min: 1 })
  totalRounds!: number;

  /**
   * Current round index (0-based)
   * Starts at 0, increments as rounds complete
   */
  @Prop({ required: true, default: 0, min: 0 })
  currentRound!: number;

  /**
   * Duration of each round in milliseconds
   */
  @Prop({ required: true, min: 1000 }) // Minimum 1 second
  roundDurationMs!: number;

  /**
   * Minimum bid amount allowed
   */
  @Prop({ required: true, min: 1 })
  minBid!: number;

  /**
   * When auction started (first round)
   */
  @Prop()
  startedAt?: Date;

  /**
   * When auction will end (calculated from rounds)
   */
  @Prop()
  endsAt?: Date;

  /**
   * User ID who created this auction
   * Only the creator can start the auction
   */
  @Prop({ required: true, type: 'ObjectId', ref: 'User' })
  createdBy!: string;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const AuctionSchema = SchemaFactory.createForClass(Auction);

// Indexes for performance
AuctionSchema.index({ giftId: 1 });
AuctionSchema.index({ status: 1 });
AuctionSchema.index({ status: 1, currentRound: 1 });
AuctionSchema.index({ endsAt: 1 }); // For scheduler queries
AuctionSchema.index({ createdBy: 1 }); // For creator queries

// Validation: ensure auction invariants
AuctionSchema.pre('save', function (next) {
  if (this.currentRound > this.totalRounds) {
    next(new Error('currentRound cannot exceed totalRounds'));
  } else if (this.totalGifts <= 0 || this.totalRounds <= 0) {
    next(new Error('totalGifts and totalRounds must be positive'));
  } else if (this.minBid <= 0) {
    next(new Error('minBid must be positive'));
  } else if (this.roundDurationMs < 1000) {
    next(new Error('roundDurationMs must be at least 1000ms'));
  } else {
    next();
  }
});


import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { LedgerType } from '../common/enums/ledger-type.enum';

export type LedgerEntryDocument = LedgerEntry & Document;

/**
 * LedgerEntry model
 *
 * Immutable financial audit trail
 * EVERY balance operation MUST create a ledger entry
 *
 * This is the source of truth for all financial transactions
 * Used to:
 * - Audit all money movements
 * - Reconstruct balance history
 * - Prove financial integrity
 * - Recover from errors
 *
 * Invariants:
 * - amount > 0 (always positive, direction determined by type)
 * - referenceId points to related entity (Bid, Auction, etc.)
 * - Entries are NEVER modified or deleted
 */
@Schema({
  timestamps: true,
  collection: 'ledger_entries',
})
export class LedgerEntry {
  @Prop({ required: true, type: 'ObjectId', ref: 'User', index: true })
  userId!: string;

  /**
   * Type of ledger operation
   */
  @Prop({
    required: true,
    enum: Object.values(LedgerType),
    index: true,
  })
  type!: LedgerType;

  /**
   * Amount involved in this operation (always positive)
   * Direction determined by type:
   * - LOCK: decreases balance, increases lockedBalance
   * - UNLOCK: increases balance, decreases lockedBalance
   * - PAYOUT: decreases lockedBalance (winner pays)
   * - REFUND: increases balance, decreases lockedBalance
   */
  @Prop({ required: true, min: 0.01 }) // Minimum 0.01 to avoid rounding issues
  amount!: number;

  /**
   * Reference to related entity
   * - For LOCK/UNLOCK: bidId (ObjectId)
   * - For PAYOUT: auctionId or bidId (ObjectId)
   * - For REFUND: auctionId (ObjectId)
   * - For DEPOSIT: deposit reference (string, e.g., "deposit_xxx")
   */
  @Prop({ required: true, type: String, index: true })
  referenceId!: string;

  /**
   * Optional description for audit purposes
   */
  @Prop()
  description?: string;

  @Prop({ default: Date.now, index: true })
  createdAt!: Date;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

// Indexes for performance and audit queries
LedgerEntrySchema.index({ userId: 1, createdAt: -1 }); // User's transaction history
LedgerEntrySchema.index({ userId: 1, type: 1, createdAt: -1 }); // Filtered by type
LedgerEntrySchema.index({ referenceId: 1, type: 1 }); // Find entries by reference
LedgerEntrySchema.index({ createdAt: -1 }); // Chronological audit trail

// Immutability: prevent updates and deletes
LedgerEntrySchema.pre(['updateOne', 'findOneAndUpdate', 'deleteOne'], function (next) {
  next(new Error('Ledger entries are immutable and cannot be modified or deleted'));
});


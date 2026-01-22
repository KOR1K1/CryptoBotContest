import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

/**
 * User model
 *
 * Financial invariants:
 * - balance >= 0
 * - lockedBalance >= 0
 * - balance + lockedBalance = constant (unless external deposit/withdrawal)
 *
 * All balance mutations MUST go through BalanceService with transactions
 */
@Schema({
  timestamps: true,
  collection: 'users',
  // versionKey: '__v' is enabled by default for optimistic locking
  // Mongoose automatically tracks document version for optimistic concurrency control
})
export class User {
  @Prop({ required: true })
  username!: string;

  /**
   * Hashed password (bcrypt)
   * Not selected by default for security
   * Use .select('+password') to include in query
   */
  @Prop({ required: false, select: false })
  password?: string;

  /**
   * Email (optional, for future use)
   */
  @Prop({ required: false })
  email?: string;

  /**
   * Free balance available for bidding
   * Must be >= 0
   */
  @Prop({ required: true, default: 0, min: 0 })
  balance!: number;

  /**
   * Locked balance in active bids
   * Must be >= 0
   * Sum of all active bid amounts for this user
   */
  @Prop({ required: true, default: 0, min: 0 })
  lockedBalance!: number;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes for performance
UserSchema.index({ username: 1 }, { unique: true });
// Removed balance/lockedBalance indexes - not used in queries (only in updates)

// Validation: ensure balance invariants
UserSchema.pre('save', function (next) {
  if (this.balance < 0 || this.lockedBalance < 0) {
    next(new Error('Balance and lockedBalance must be non-negative'));
  } else {
    next();
  }
});


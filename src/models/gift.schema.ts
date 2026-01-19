import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GiftDocument = Gift & Document;

/**
 * Gift (digital product) model
 *
 * Represents a digital item that can be auctioned
 * Metadata allows extensibility for different gift types
 */
@Schema({
  timestamps: true,
  collection: 'gifts',
})
export class Gift {
  @Prop({ required: true })
  title!: string;

  @Prop()
  description?: string;

  @Prop()
  imageUrl?: string;

  /**
   * Base price or minimum value
   * Used for reference, not enforced in auction logic
   */
  @Prop({ required: true, min: 0 })
  basePrice!: number;

  /**
   * Total number of gifts available in auction
   * Must be > 0
   */
  @Prop({ required: true, min: 1 })
  totalSupply!: number;

  /**
   * Extended metadata for gift properties
   * Allows flexibility: rarity, model, category, etc.
   */
  @Prop({ type: Object, default: {} })
  metadata?: {
    rarity?: string;
    model?: string;
    category?: string;
    [key: string]: unknown;
  };

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const GiftSchema = SchemaFactory.createForClass(Gift);

// Indexes
GiftSchema.index({ title: 1 });
GiftSchema.index({ createdAt: -1 });


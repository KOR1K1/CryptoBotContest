import {
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsMongoId,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuctionDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the gift to auction',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  giftId!: string;

  @ApiProperty({
    description: 'Total number of gifts available in this auction',
    example: 10,
    minimum: 1,
    maximum: 1000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  totalGifts!: number;

  @ApiProperty({
    description: 'Total number of rounds in the auction',
    example: 3,
    minimum: 1,
    maximum: 20,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  totalRounds!: number;

  @ApiProperty({
    description: 'Duration of each round in milliseconds',
    example: 60000,
    minimum: 1000,
    maximum: 86400000,
  })
  @IsNumber()
  @IsInt()
  @Min(1000) // Minimum 1 second
  @Max(86400000) // Maximum 24 hours (86400000 ms)
  @Type(() => Number)
  roundDurationMs!: number;

  @ApiProperty({
    description: 'Minimum bid amount required',
    example: 100,
    minimum: 1,
    maximum: 1000000000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(1000000000) // Maximum 1 billion (reasonable upper limit)
  @Type(() => Number)
  minBid!: number;
}


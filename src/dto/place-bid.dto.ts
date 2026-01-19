import { IsNotEmpty, IsNumber, Min, Max, IsMongoId, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PlaceBidDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the user placing the bid',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'Bid amount (must be >= minBid and > current user bid if updating)',
    example: 150,
    minimum: 1,
    maximum: 1000000000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(1000000000) // Maximum 1 billion (reasonable upper limit)
  @Type(() => Number)
  amount!: number;
}


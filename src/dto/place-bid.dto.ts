import { IsNotEmpty, IsNumber, Min, Max, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// userId берется из JWT токена, не из тела запроса
export class PlaceBidDto {
  @ApiProperty({
    description: 'Bid amount (must be >= minBid and > current user bid if updating)',
    example: 150,
    minimum: 1,
    maximum: 1000000000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(1000000000)
  @Type(() => Number)
  amount!: number;
}


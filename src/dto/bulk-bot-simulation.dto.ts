import { IsNumber, IsInt, Min, Max, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BulkBotSimulationDto {
  @ApiProperty({
    description: 'Number of bots to create',
    example: 100,
    minimum: 1,
    maximum: 10000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  @IsNotEmpty()
  numBots!: number;

  @ApiProperty({
    description: 'Number of bids each bot will place',
    example: 10,
    minimum: 1,
    maximum: 1000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  @IsNotEmpty()
  bidsPerBot!: number;

  @ApiProperty({
    description: 'Minimum bid amount',
    example: 100,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsNotEmpty()
  minBid!: number;

  @ApiProperty({
    description: 'Maximum bid amount',
    example: 1000,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsNotEmpty()
  maxBid!: number;

  @ApiProperty({
    description: 'Initial balance for each bot',
    example: 100000,
    minimum: 0,
    default: 100000,
  })
  @IsNumber()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsNotEmpty()
  initialBalance!: number;
}

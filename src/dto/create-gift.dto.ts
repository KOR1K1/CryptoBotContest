import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsUrl,
  IsObject,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGiftDto {
  @ApiProperty({
    description: 'Title of the gift',
    example: 'Golden Trophy',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @Min(1)
  @Max(200)
  title!: string;

  @ApiPropertyOptional({
    description: 'Description of the gift',
    example: 'A beautiful golden trophy for winners',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @Max(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'URL to the gift image',
    example: 'https://example.com/images/trophy.png',
    maxLength: 500,
  })
  @IsUrl()
  @IsOptional()
  @Max(500)
  imageUrl?: string;

  @ApiProperty({
    description: 'Base price of the gift',
    example: 100,
    minimum: 0,
    maximum: 1000000000,
  })
  @IsNumber()
  @IsInt()
  @Min(0)
  @Max(1000000000) // Maximum 1 billion
  @Type(() => Number)
  basePrice!: number;

  @ApiProperty({
    description: 'Total supply of this gift available',
    example: 100,
    minimum: 1,
    maximum: 10000,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(10000) // Maximum 10,000 gifts per auction
  @Type(() => Number)
  totalSupply!: number;

  @ApiPropertyOptional({
    description: 'Additional metadata for the gift',
    example: { rarity: 'legendary', model: '3d_trophy', category: 'awards' },
  })
  @IsObject()
  @IsOptional()
  metadata?: {
    rarity?: string;
    model?: string;
    category?: string;
    [key: string]: unknown;
  };
}


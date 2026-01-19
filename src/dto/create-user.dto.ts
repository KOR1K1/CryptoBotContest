import { IsString, IsNotEmpty, MinLength, MaxLength, IsNumber, IsOptional, Min, Max, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    description: 'Unique username for the user',
    example: 'john_doe',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  username!: string;

  @ApiPropertyOptional({
    description: 'Initial balance for the user (defaults to 0)',
    example: 10000,
    minimum: 0,
    maximum: 1000000000,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(0)
  @Max(1000000000) // Maximum 1 billion (reasonable upper limit)
  @Type(() => Number)
  initialBalance?: number;
}


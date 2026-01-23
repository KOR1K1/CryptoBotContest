import { IsString, MinLength, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Username (must be unique)',
    example: 'john_doe',
    minLength: 3,
  })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  username!: string;

  @ApiProperty({
    description: 'Password (will be hashed)',
    example: 'securePassword123',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @ApiPropertyOptional({
    description: 'Email (optional)',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Initial balance (optional, for testing)',
    example: 10000,
    default: 0,
  })
  @IsOptional()
  initialBalance?: number;
}

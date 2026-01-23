import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'Username',
    example: 'john_doe',
  })
  @IsString()
  username!: string;

  @ApiProperty({
    description: 'Password',
    example: 'securePassword123',
  })
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password!: string;
}

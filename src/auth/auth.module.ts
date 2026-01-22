import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtGuard } from './guards/optional-jwt.guard';
import { User, UserSchema } from '../models/user.schema';
import { BalanceModule } from '../services/balance/balance.module';

/**
 * AuthModule
 * 
 * Provides authentication functionality:
 * - User registration and login
 * - JWT token generation and validation
 * - Guards for protecting endpoints
 */
@Module({
  imports: [
    // Passport module for authentication strategies
    PassportModule.register({ defaultStrategy: 'jwt' }),
    
    // JWT module with async configuration
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const expiresIn = configService.get<string>('jwt.expiresIn', '24h');
        return {
          secret: configService.get<string>('jwt.secret', 'default-secret-key'),
          signOptions: {
            expiresIn: expiresIn,
          },
        } as any;
      },
      inject: [ConfigService],
    }),
    
    // Mongoose module for User model
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    
    // Balance module for initial balance deposits
    BalanceModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    OptionalJwtGuard,
    JwtModule,
  ],
})
export class AuthModule {}

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsGateway } from './auctions.gateway';
import { ThrottlerModule } from '../services/throttler/throttler.module';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../models/user.schema';

@Module({
  imports: [
    forwardRef(() => ThrottlerModule), // forwardRef to avoid circular dependency
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), // For WebSocket authentication
    AuthModule, // For JWT authentication (exports JwtService and AuthService)
  ],
  providers: [AuctionsGateway],
  exports: [AuctionsGateway],
})
export class GatewaysModule {}

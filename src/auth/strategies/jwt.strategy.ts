import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { UserDocument } from '../../models/user.schema';

/**
 * JwtStrategy
 * 
 * Passport JWT strategy for validating JWT tokens
 * Extracts token from Authorization header and validates it
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret', 'default-secret-key'),
    });
  }

  /**
   * Validate JWT payload
   * Called automatically by Passport after token is verified
   * 
   * @param payload JWT payload (contains sub: userId, username)
   * @returns User document
   * @throws UnauthorizedException if user not found
   */
  async validate(payload: { sub: string; username: string }): Promise<UserDocument> {
    const user = await this.authService.validateUser(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}

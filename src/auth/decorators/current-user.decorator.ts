import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserDocument } from '../../models/user.schema';

/**
 * CurrentUser decorator
 * 
 * Extracts user from request (set by JwtAuthGuard)
 * 
 * Usage:
 * @Get('profile')
 * @UseGuards(JwtAuthGuard)
 * async getProfile(@CurrentUser() user: UserDocument) {
 *   return user;
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserDocument => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

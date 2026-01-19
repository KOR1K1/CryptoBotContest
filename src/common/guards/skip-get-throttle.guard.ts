import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom ThrottlerGuard that skips throttling for GET requests
 * 
 * This guard extends ThrottlerGuard but automatically skips rate limiting
 * for all GET requests (read-only operations), while still protecting
 * POST/PUT/DELETE requests (write operations).
 */
@Injectable()
export class SkipGetThrottleGuard extends ThrottlerGuard {
  /**
   * Override canActivate to skip throttling for GET requests
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Skip throttling for GET requests (read-only, safe)
    if (method === 'GET') {
      return true;
    }

    // Apply throttling for POST, PUT, DELETE, PATCH requests
    return super.canActivate(context);
  }
}

import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom ThrottlerGuard that skips throttling for GET requests.
 *
 * Additionally, it can skip throttling for **Bot Simulator** traffic
 * (load-testing) when requests include a dedicated header.
 */
@Injectable()
export class SkipGetThrottleGuard extends ThrottlerGuard {
  private readonly BOT_SIM_HEADER = 'x-bot-simulator';

  /**
   * Override canActivate to skip throttling for GET requests
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method;
    const url: string = request.originalUrl || request.url || '';

    // Skip throttling for GET requests (read-only, safe)
    if (method === 'GET') {
      return true;
    }

    // Skip throttling for Bot Simulator traffic (load testing) ONLY
    // when explicitly marked by a header.
    //
    // Default: enabled. Disable by setting BOT_SIMULATOR_SKIP_THROTTLE=false
    const botBypassEnabled = process.env.BOT_SIMULATOR_SKIP_THROTTLE !== 'false';
    const botHeaderValue = String(request.headers?.[this.BOT_SIM_HEADER] ?? '').toLowerCase();
    const isBotTraffic = botHeaderValue === '1' || botHeaderValue === 'true' || botHeaderValue === 'yes';

    // Restrict bypass to bot-specific endpoints only (so the rest of API stays protected)
    const isBotAllowedPath =
      (method === 'POST' && url.startsWith('/users')) ||
      (method === 'POST' && url.includes('/bids/bot'));

    if (botBypassEnabled && isBotTraffic && isBotAllowedPath) {
      return true;
    }

    // Apply throttling for POST, PUT, DELETE, PATCH requests
    return super.canActivate(context);
  }
}

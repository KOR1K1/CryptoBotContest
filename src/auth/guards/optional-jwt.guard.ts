import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

/**
 * OptionalJwtGuard
 * 
 * Guard for optional JWT authentication
 * If token is provided - validates it
 * If token is missing - allows request (for bots/simulators)
 * 
 * Usage:
 * @UseGuards(OptionalJwtGuard)
 * async endpoint(@CurrentUser() user?: UserDocument) { ... }
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Try to authenticate, but don't throw error if token is missing
    const result = super.canActivate(context);
    
    // If result is a Promise, catch errors and allow request
    if (result instanceof Promise) {
      return result.catch(() => {
        // If authentication fails (no token or invalid token), allow request anyway
        // The endpoint can check if user exists
        return true;
      }) as Promise<boolean>;
    }
    
    // If result is Observable, convert to Promise and catch
    if (result instanceof Observable) {
      return result.toPromise().then(() => true).catch(() => true) as Promise<boolean>;
    }
    
    // If result is boolean, return as is
    return result;
  }

  handleRequest(err: any, user: any, info: any) {
    // If there's an error or no user, return undefined instead of throwing
    // This allows the endpoint to handle optional authentication
    if (err || !user) {
      return undefined;
    }
    return user;
  }
}

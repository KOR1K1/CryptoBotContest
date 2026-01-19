import { Module, Global } from '@nestjs/common';
import { RedisLockService } from './redis-lock.service';

/**
 * RedisLockModule
 * 
 * Provides distributed locking using Redis
 * Can be used optionally for high-load scenarios
 */
@Global() // Make available globally
@Module({
  providers: [RedisLockService],
  exports: [RedisLockService],
})
export class RedisLockModule {}

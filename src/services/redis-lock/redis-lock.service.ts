import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/**
 * RedisLockService
 * 
 * Provides distributed locking using Redis SET NX EX pattern
 * Used for high-load scenarios where MongoDB transactions alone may not be enough
 * 
 * Lock pattern: SET lock:key value NX EX ttl
 * - NX: Only set if key doesn't exist
 * - EX: Set expiration time in seconds
 * 
 * Usage:
 * - lock:user:{userId} - Lock user operations
 * - lock:auction:{auctionId} - Lock auction operations
 * - lock:round:{auctionId}:{roundIndex} - Lock round closing operations
 * 
 * Benefits:
 * - Prevents concurrent operations across multiple server instances
 * - Reduces MongoDB transaction conflicts
 * - Improves performance under very high load (100k+ concurrent operations)
 */
@Injectable()
export class RedisLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private redisClient: RedisClientType | null = null;
  private readonly DEFAULT_LOCK_TTL_SECONDS = 30; // Default lock TTL: 30 seconds
  private readonly LOCK_PREFIX = 'lock:';
  private isEnabled = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisHost = this.configService.get<string>('redis.host', 'localhost');
    const redisPort = this.configService.get<number>('redis.port', 6379);

    try {
      // Create Redis client for direct access (separate from cache-manager)
      this.redisClient = createClient({
        socket: {
          host: redisHost,
          port: redisPort,
        },
      });

      this.redisClient.on('error', (err) => {
        this.logger.error(`Redis client error: ${err.message}`);
        this.isEnabled = false;
      });

      this.redisClient.on('connect', () => {
        this.logger.log(`Redis lock client connected: ${redisHost}:${redisPort}`);
        this.isEnabled = true;
      });

      await this.redisClient.connect();
    } catch (error) {
      this.logger.warn(
        `Redis lock service not available, falling back to MongoDB transactions only: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.isEnabled = false;
      // Continue without Redis locks - MongoDB transactions will handle concurrency
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
      this.logger.log('Redis lock client disconnected');
    }
  }

  /**
   * Acquire a distributed lock
   * 
   * @param key Lock key (will be prefixed with 'lock:')
   * @param ttlSeconds Lock TTL in seconds (default: 30)
   * @param retryOptions Optional retry configuration
   * @returns Lock token if acquired, null if failed
   */
  async acquireLock(
    key: string,
    ttlSeconds: number = this.DEFAULT_LOCK_TTL_SECONDS,
    retryOptions?: {
      maxRetries?: number;
      retryDelayMs?: number;
    },
  ): Promise<string | null> {
    if (!this.isEnabled || !this.redisClient) {
      // Redis not available - return null to fall back to MongoDB transactions
      return null;
    }

    const lockKey = `${this.LOCK_PREFIX}${key}`;
    const lockToken = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const maxRetries = retryOptions?.maxRetries ?? 0;
    const retryDelayMs = retryOptions?.retryDelayMs ?? 100;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // SET lock:key token NX EX ttl
        // Returns 'OK' if lock acquired, null if lock already exists
        const result = await this.redisClient.set(lockKey, lockToken, {
          NX: true, // Only set if not exists
          EX: ttlSeconds, // Expiration in seconds
        });

        if (result === 'OK') {
          this.logger.debug(`Acquired lock: ${lockKey}, token: ${lockToken}`);
          return lockToken;
        }

        // Lock already held by another process
        if (attempt < maxRetries) {
          await this.sleep(retryDelayMs * (attempt + 1)); // Exponential backoff
          continue;
        }

        return null; // Failed to acquire lock after retries
      } catch (error) {
        this.logger.error(`Error acquiring lock ${lockKey}:`, error);
        // On error, fall back to MongoDB transactions
        return null;
      }
    }

    return null;
  }

  /**
   * Release a distributed lock
   * Uses Lua script for atomic check-and-delete (prevents releasing someone else's lock)
   * 
   * @param key Lock key
   * @param lockToken Lock token (must match to release)
   * @returns true if released, false otherwise
   */
  async releaseLock(key: string, lockToken: string): Promise<boolean> {
    if (!this.isEnabled || !this.redisClient) {
      return false;
    }

    const lockKey = `${this.LOCK_PREFIX}${key}`;

    try {
      // Lua script: atomic check-and-delete
      // Only delete if token matches (prevents releasing someone else's lock)
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redisClient.eval(luaScript, {
        keys: [lockKey],
        arguments: [lockToken],
      });

      const released = result === 1;
      if (released) {
        this.logger.debug(`Released lock: ${lockKey}, token: ${lockToken}`);
      } else {
        this.logger.warn(`Failed to release lock ${lockKey} - token mismatch or lock expired`);
      }

      return released;
    } catch (error) {
      this.logger.error(`Error releasing lock ${lockKey}:`, error);
      return false;
    }
  }

  /**
   * Execute a function with a distributed lock
   * Automatically acquires and releases the lock
   * 
   * @param key Lock key
   * @param fn Function to execute
   * @param ttlSeconds Lock TTL in seconds
   * @param retryOptions Optional retry configuration
   * @returns Result of function execution
   * @throws Error if lock cannot be acquired
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = this.DEFAULT_LOCK_TTL_SECONDS,
    retryOptions?: {
      maxRetries?: number;
      retryDelayMs?: number;
    },
  ): Promise<T> {
    const lockToken = await this.acquireLock(key, ttlSeconds, retryOptions);

    if (!lockToken) {
      // If Redis locks not available, execute without lock (fallback to MongoDB transactions)
      if (!this.isEnabled) {
        this.logger.debug(`Redis locks not available, executing without lock: ${key}`);
        return fn();
      }
      throw new Error(`Failed to acquire lock: ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(key, lockToken);
    }
  }

  /**
   * Check if lock service is enabled and available
   * 
   * @returns true if Redis locks are available
   */
  isLockServiceAvailable(): boolean {
    return this.isEnabled && this.redisClient !== null;
  }

  /**
   * Helper: sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

import { CacheModuleOptions, CacheOptionsFactory } from '@nestjs/cache-manager';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';

/**
 * CacheConfigService
 * 
 * Configures Redis cache for NestJS CacheModule
 * Uses cache-manager-redis-yet adapter (compatible with cache-manager v7)
 */
@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  private readonly logger = new Logger(CacheConfigService.name);

  constructor(private configService: ConfigService) {}

  async createCacheOptions(): Promise<CacheModuleOptions> {
    // Get Redis configuration - read directly from process.env first, then fallback to config service
    // This ensures we get the correct value from docker-compose environment variables
    const redisHost = process.env.REDIS_HOST || this.configService.get<string>('redis.host', 'localhost');
    const redisPort = process.env.REDIS_PORT 
      ? parseInt(process.env.REDIS_PORT, 10) 
      : this.configService.get<number>('redis.port', 6379);
    const defaultTtl = this.configService.get<number>('redis.ttl', 3000); // Default TTL: 3 seconds (milliseconds)

    this.logger.log(`Attempting to connect to Redis at ${redisHost}:${redisPort}...`);

    try {
      // Use cache-manager-redis-yet which is compatible with cache-manager v7
      // For cache-manager-redis-yet v5.x, try both url and socket formats
      const redisUrl = `redis://${redisHost}:${redisPort}`;
      
      // Try url format first (recommended for v5)
      let store;
      try {
        store = await redisStore({
          url: redisUrl,
          ttl: defaultTtl, // TTL in milliseconds
        });
      } catch (urlError) {
        // Fallback to socket format if url doesn't work
        this.logger.debug(`URL format failed, trying socket format: ${urlError instanceof Error ? urlError.message : String(urlError)}`);
        store = await redisStore({
          socket: {
            host: redisHost,
            port: redisPort,
          },
          ttl: defaultTtl,
        });
      }

      this.logger.log(`✅ Redis cache configured successfully: ${redisHost}:${redisPort}, TTL: ${defaultTtl}ms`);
      this.logger.log(`   Store type: ${typeof store}, Store constructor: ${store?.constructor?.name || 'unknown'}`);

      return {
        store: store as any, // Type assertion for compatibility
        ttl: defaultTtl, // TTL in milliseconds
        max: 100, // Maximum number of items in cache (optional)
      };
    } catch (error) {
      // Fallback to memory store if Redis is not available
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️ Redis cache not available (${errorMessage}), falling back to memory store`);
      this.logger.warn(`   Attempted connection to: ${redisHost}:${redisPort}`);
      this.logger.warn(`   REDIS_HOST env: ${process.env.REDIS_HOST || 'not set'}`);
      this.logger.warn(`   Check that Redis container is running and accessible`);
      
      return {
        ttl: defaultTtl,
        max: 100,
      };
    }
  }
}

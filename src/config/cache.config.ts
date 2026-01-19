import { CacheModuleOptions, CacheOptionsFactory } from '@nestjs/cache-manager';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';

/**
 * CacheConfigService
 * 
 * Configures Redis cache for NestJS CacheModule
 * Uses cache-manager-redis-store adapter (compatible with cache-manager v7)
 */
@Injectable()
export class CacheConfigService implements CacheOptionsFactory {
  private readonly logger = new Logger(CacheConfigService.name);

  constructor(private configService: ConfigService) {}

  async createCacheOptions(): Promise<CacheModuleOptions> {
    const redisHost = this.configService.get<string>('redis.host', 'localhost');
    const redisPort = this.configService.get<number>('redis.port', 6379);
    const defaultTtl = this.configService.get<number>('redis.ttl', 3000); // Default TTL: 3 seconds (milliseconds)

    try {
      const store = await redisStore({
        host: redisHost,
        port: redisPort,
        ttl: defaultTtl, // TTL in milliseconds
      });

      this.logger.log(`Redis cache configured: ${redisHost}:${redisPort}, TTL: ${defaultTtl}ms`);

      return {
        store: store as any, // Type assertion for compatibility
        ttl: defaultTtl, // TTL in milliseconds
        max: 100, // Maximum number of items in cache (optional)
      };
    } catch (error) {
      // Fallback to memory store if Redis is not available
      this.logger.warn(`Redis cache not available, falling back to memory store: ${error instanceof Error ? error.message : String(error)}`);
      return {
        ttl: defaultTtl,
        max: 100,
      };
    }
  }
}

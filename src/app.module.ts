import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModelsModule } from './models/models.module';
import { SchedulerModule } from './services/scheduler/scheduler.module';
import { ApiModule } from './api/api.module';
import { GatewaysModule } from './gateways/gateways.module';
import { MonitoringModule } from './services/monitoring/monitoring.module';
import { RedisLockModule } from './services/redis-lock/redis-lock.module';
import { CacheConfigService } from './config/cache.config';
import configuration from './config/configuration';
import { SkipGetThrottleGuard } from './common/guards/skip-get-throttle.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>('logging.level', 'info'),
          transport:
            configService.get<string>('nodeEnv') === 'development'
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: false,
                    translateTime: 'SYS:standard',
                  },
                }
              : undefined,
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const maxPoolSize = configService.get<number>('mongodb.maxPoolSize', 50);
        const minPoolSize = configService.get<number>('mongodb.minPoolSize', 5);
        const maxIdleTimeMS = configService.get<number>('mongodb.maxIdleTimeMS', 30000);

        return {
          uri: configService.get<string>('MONGODB_URI'),
          // Enable MongoDB transactions (requires replica set)
          // Transactions are critical for financial operations
          retryWrites: true,
          retryReads: true,
          // Connection pool settings optimized for production
          // maxPoolSize: 50-100 for single server (handles 100k+ concurrent operations)
          // minPoolSize: 5-10 (keeps minimum connections ready to reduce latency)
          // maxIdleTimeMS: 30s (closes idle connections to free resources)
          maxPoolSize,
          minPoolSize,
          maxIdleTimeMS,
          // Additional pool optimization settings
          serverSelectionTimeoutMS: 5000, // Wait 5 seconds for server selection
          socketTimeoutMS: 45000, // Close socket after 45 seconds of inactivity
          heartbeatFrequencyMS: 10000, // Send heartbeat every 10 seconds to keep connections alive
        };
      },
    }),
    ModelsModule,
    SchedulerModule, // Background jobs for round closing
    ApiModule, // REST API endpoints
    GatewaysModule, // WebSocket gateways for real-time updates
    MonitoringModule, // MongoDB metrics and monitoring
    RedisLockModule, // Distributed locking with Redis (optional, falls back to MongoDB transactions)
    CacheModule.registerAsync({
      isGlobal: true, // Make cache available globally
      inject: [ConfigService],
      useClass: CacheConfigService,
    }),
    // Rate limiting configuration
    // Protects against DDoS and abuse
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'short',
            ttl: configService.get<number>('throttle.shortTtl', 1000), // 1 second window
            limit: configService.get<number>('throttle.shortLimit', 10), // 10 requests per second
          },
          {
            name: 'medium',
            ttl: configService.get<number>('throttle.mediumTtl', 10000), // 10 second window
            limit: configService.get<number>('throttle.mediumLimit', 50), // 50 requests per 10 seconds
          },
          {
            name: 'long',
            ttl: configService.get<number>('throttle.longTtl', 60000), // 1 minute window
            limit: configService.get<number>('throttle.longLimit', 200), // 200 requests per minute
          },
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Enable throttling globally, but skip GET requests automatically
    // GET requests are read-only and safe, POST/PUT/DELETE are protected
    {
      provide: APP_GUARD,
      useClass: SkipGetThrottleGuard,
    },
  ],
})
export class AppModule {
  // MonitoringModule is already imported above
  // MongoDBMetricsService will be available through dependency injection
}


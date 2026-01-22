import { Controller, Get, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

// MongoDBMetricsService will be injected via MonitoringModule (@Global)
// We use string token to avoid circular dependency issues with TypeScript module resolution
const MONGODB_METRICS_SERVICE = 'MongoDBMetricsService';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
    @Optional() @Inject(MONGODB_METRICS_SERVICE) private readonly mongoDBMetricsService?: any,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check', description: 'Returns service health status' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth() {
    return this.appService.getHealth();
  }

  /**
   * GET /metrics/mongodb
   * Get MongoDB memory and performance metrics
   * Useful for monitoring and health checks
   * 
   * @returns MongoDB metrics (memory, cache, connections, operations)
   */
  @Get('metrics/mongodb')
  @ApiOperation({ summary: 'Get MongoDB metrics', description: 'Returns MongoDB memory and performance metrics' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getMongoDBMetrics() {
    if (!this.mongoDBMetricsService || typeof this.mongoDBMetricsService.collectMetrics !== 'function') {
      return {
        error: 'MongoDB metrics service not available',
        timestamp: new Date().toISOString(),
      };
    }
    const metrics = await this.mongoDBMetricsService.collectMetrics();
    if (!metrics) {
      return {
        error: 'MongoDB metrics not available',
        timestamp: new Date().toISOString(),
      };
    }
    return {
      timestamp: new Date().toISOString(),
      ...metrics,
    };
  }

  /**
   * GET /metrics/mongodb/memory
   * Get MongoDB memory usage summary
   * Quick health check for memory usage
   * 
   * @returns MongoDB memory usage summary
   */
  @Get('metrics/mongodb/memory')
  async getMongoDBMemoryUsage() {
    if (!this.mongoDBMetricsService || typeof this.mongoDBMetricsService.getMemoryUsage !== 'function') {
      return {
        error: 'MongoDB metrics service not available',
        timestamp: new Date().toISOString(),
      };
    }
    const memoryUsage = await this.mongoDBMetricsService.getMemoryUsage();
    return {
      timestamp: new Date().toISOString(),
      ...memoryUsage,
    };
  }

  /**
   * GET /metrics/mongodb/pool
   * Get MongoDB connection pool usage summary
   * Quick health check for connection pool usage
   * 
   * @returns MongoDB connection pool usage summary
   */
  @Get('metrics/mongodb/pool')
  async getMongoDBConnectionPoolUsage() {
    if (!this.mongoDBMetricsService || typeof this.mongoDBMetricsService.getConnectionPoolUsage !== 'function') {
      return {
        error: 'MongoDB metrics service not available',
        timestamp: new Date().toISOString(),
      };
    }
    const poolUsage = await this.mongoDBMetricsService.getConnectionPoolUsage();
    return {
      timestamp: new Date().toISOString(),
      ...poolUsage,
    };
  }

  /**
   * GET /system/resources
   * Get detected system resources and configuration
   * Shows auto-detected values for MongoDB cache and connection pool
   * 
   * @returns System resources and configuration
   */
  @Get('system/resources')
  @ApiOperation({ 
    summary: 'Get system resources', 
    description: 'Returns detected system resources (RAM, CPU) and auto-detected MongoDB configuration' 
  })
  @ApiResponse({ status: 200, description: 'System resources retrieved successfully' })
  async getSystemResources() {
    const { SystemResources } = await import('./config/system-resources');
    const systemInfo = SystemResources.getSystemInfo();
    
    // Check if values were set via environment variables
    const cacheFromEnv = process.env.MONGO_WIREDTIGER_CACHE_SIZE_GB;
    const poolFromEnv = process.env.MONGO_MAX_POOL_SIZE;
    
    // Get configured values from ConfigService
    const configuredCache = this.configService.get<number>('mongodb.wiredTigerCacheSizeGB', systemInfo.mongoDBCache);
    const configuredMaxPool = this.configService.get<number>('mongodb.maxPoolSize', systemInfo.mongoDBPool.max);
    const configuredMinPool = this.configService.get<number>('mongodb.minPoolSize', systemInfo.mongoDBPool.min);
    
    return {
      timestamp: new Date().toISOString(),
      system: {
        totalRAM: `${systemInfo.totalRAM}GB`,
        availableRAM: `${systemInfo.availableRAM}GB`,
        cpuCores: systemInfo.cpuCores,
      },
      mongodb: {
        cache: {
          autoDetected: systemInfo.mongoDBCache,
          configured: configuredCache,
          source: cacheFromEnv ? 'environment' : 'auto-detected',
        },
        connectionPool: {
          autoDetected: {
            max: systemInfo.mongoDBPool.max,
            min: systemInfo.mongoDBPool.min,
          },
          configured: {
            max: configuredMaxPool,
            min: configuredMinPool,
          },
          source: poolFromEnv ? 'environment' : 'auto-detected',
        },
      },
      note: 'Values are auto-detected based on system resources. Set MONGO_WIREDTIGER_CACHE_SIZE_GB and MONGO_MAX_POOL_SIZE in .env to override.',
    };
  }
}


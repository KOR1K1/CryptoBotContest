import { Controller, Get, Optional, Inject } from '@nestjs/common';
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
}


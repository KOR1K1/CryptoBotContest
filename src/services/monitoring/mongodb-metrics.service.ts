import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';

/**
 * MongoDBMetricsService
 * 
 * Exports MongoDB memory and performance metrics for monitoring
 * Can be used with Prometheus or other monitoring systems
 * 
 * Metrics collected:
 * - WiredTiger cache size and usage
 * - Memory usage (resident, virtual, mapped)
 * - Connection count
 * - Query performance
 */
@Injectable()
export class MongoDBMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoDBMetricsService.name);
  private metricsInterval: NodeJS.Timeout | null = null;
  private readonly METRICS_INTERVAL_MS = 60000; // 1 minute

  constructor(
    @InjectConnection() private connection: Connection,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // Start collecting metrics periodically
    this.startMetricsCollection();
    this.logger.log('MongoDB metrics service initialized');
  }

  /**
   * Start collecting MongoDB metrics periodically
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        this.logger.error('Error collecting MongoDB metrics:', error);
      }
    }, this.METRICS_INTERVAL_MS);
  }

  /**
   * Collect MongoDB metrics
   * Returns metrics object that can be used with Prometheus or logging
   */
  async collectMetrics(): Promise<{
    wiredTigerCache: {
      maximumBytesConfigured: number;
      maximumBytesCurrentlyInCache: number;
      bytesReadIntoCache: number;
      bytesWrittenFromCache: number;
      cacheSizeGB: number;
    };
    memory: {
      residentMB: number;
      virtualMB: number;
      mappedMB: number;
      mappedWithJournalMB: number;
    };
    connections: {
      current: number;
      available: number;
      totalCreated: number;
      active: number;
    };
    connectionPool: {
      maxPoolSize: number;
      minPoolSize: number;
      currentPoolSize: number; // Estimated from server connections
      poolUsagePercent: number; // Current pool usage percentage
      isHealthy: boolean; // true if pool usage < 80%
    };
    operations: {
      insert: number;
      query: number;
      update: number;
      delete: number;
      getmore: number;
      command: number;
    };
    network: {
      bytesIn: number;
      bytesOut: number;
      numRequests: number;
    };
  } | null> {
    try {
      if (!this.connection.db) {
        this.logger.warn('MongoDB connection not available');
        return null;
      }

      const admin = this.connection.db.admin();

      // Get server status
      const serverStatus = await admin.serverStatus();

      // Extract WiredTiger cache metrics
      const wiredTigerCache = serverStatus.wiredTiger?.cache || {};
      const cacheSizeGB = this.configService.get<number>('mongodb.wiredTigerCacheSizeGB', 4);

      // Type guard for wiredTiger cache
      if (!serverStatus.wiredTiger || !serverStatus.wiredTiger.cache) {
        this.logger.warn('WiredTiger cache metrics not available');
        return null;
      }

      // Extract memory metrics
      const memory = serverStatus.mem || {};

      // Extract connection metrics
      const connections = serverStatus.connections || {};

      // Get connection pool configuration
      const maxPoolSize = this.configService.get<number>('mongodb.maxPoolSize', 50);
      const minPoolSize = this.configService.get<number>('mongodb.minPoolSize', 5);
      
      // Estimate current pool size from MongoDB server connections
      // Note: MongoDB server connections include all clients (our app + health checks + exporters)
      // We estimate our app's pool usage by looking at current connections
      // In a single-server setup, most connections should be from our app
      const currentPoolSize = Math.max(
        connections.current || 0,
        minPoolSize, // At least minPoolSize connections
      );
      
      // Calculate pool usage percentage
      const poolUsagePercent = maxPoolSize > 0 
        ? (currentPoolSize / maxPoolSize) * 100 
        : 0;

      // Extract operation metrics
      const operations = serverStatus.opcounters || {};

      // Extract network metrics
      const network = serverStatus.network || {};

      const metrics = {
        wiredTigerCache: {
          maximumBytesConfigured: wiredTigerCache['maximum bytes configured'] || 0,
          maximumBytesCurrentlyInCache: wiredTigerCache['maximum bytes currently in the cache'] || 0,
          bytesReadIntoCache: wiredTigerCache['bytes read into cache'] || 0,
          bytesWrittenFromCache: wiredTigerCache['bytes written from cache'] || 0,
          cacheSizeGB,
        },
        memory: {
          residentMB: memory.resident || 0,
          virtualMB: memory.virtual || 0,
          mappedMB: memory.mapped || 0,
          mappedWithJournalMB: memory.mappedWithJournal || 0,
        },
        connections: {
          current: connections.current || 0,
          available: connections.available || 0,
          totalCreated: connections.totalCreated || 0,
          active: connections.current || 0, // Active connections (same as current)
        },
        connectionPool: {
          maxPoolSize,
          minPoolSize,
          currentPoolSize,
          poolUsagePercent: Math.min(100, poolUsagePercent), // Cap at 100%
          isHealthy: poolUsagePercent < 80, // Healthy if pool usage < 80%
        },
        operations: {
          insert: operations.insert || 0,
          query: operations.query || 0,
          update: operations.update || 0,
          delete: operations.delete || 0,
          getmore: operations.getmore || 0,
          command: operations.command || 0,
        },
        network: {
          bytesIn: network.bytesIn || 0,
          bytesOut: network.bytesOut || 0,
          numRequests: network.numRequests || 0,
        },
      };

      // Log metrics (can be integrated with Prometheus later)
      this.logger.debug('MongoDB metrics collected', {
        cacheUsagePercent: metrics.wiredTigerCache.maximumBytesCurrentlyInCache > 0
          ? (metrics.wiredTigerCache.maximumBytesCurrentlyInCache / metrics.wiredTigerCache.maximumBytesConfigured) * 100
          : 0,
        memoryResidentMB: metrics.memory.residentMB,
        connectionsCurrent: metrics.connections.current,
        poolUsagePercent: metrics.connectionPool.poolUsagePercent,
        poolHealthy: metrics.connectionPool.isHealthy,
        poolCurrent: metrics.connectionPool.currentPoolSize,
        poolMax: metrics.connectionPool.maxPoolSize,
      });

      return metrics;
    } catch (error) {
      this.logger.error('Error collecting MongoDB metrics:', error);
      return null;
    }
  }

  /**
   * Get current MongoDB memory usage
   * Useful for health checks and monitoring
   */
  async getMemoryUsage(): Promise<{
    cacheUsagePercent: number;
    cacheSizeGB: number;
    cacheUsedGB: number;
    memoryResidentMB: number;
    isHealthy: boolean; // true if cache usage < 80%
  }> {
    const metrics = await this.collectMetrics();
    if (!metrics) {
      return {
        cacheUsagePercent: 0,
        cacheSizeGB: 0,
        cacheUsedGB: 0,
        memoryResidentMB: 0,
        isHealthy: false,
      };
    }

    const cacheUsagePercent =
      metrics.wiredTigerCache.maximumBytesConfigured > 0
        ? (metrics.wiredTigerCache.maximumBytesCurrentlyInCache /
            metrics.wiredTigerCache.maximumBytesConfigured) *
          100
        : 0;

    const cacheUsedGB = metrics.wiredTigerCache.maximumBytesCurrentlyInCache / (1024 * 1024 * 1024);

    return {
      cacheUsagePercent,
      cacheSizeGB: metrics.wiredTigerCache.cacheSizeGB,
      cacheUsedGB,
      memoryResidentMB: metrics.memory.residentMB,
      isHealthy: cacheUsagePercent < 80, // Healthy if cache usage < 80%
    };
  }

  /**
   * Get connection pool usage summary
   * Useful for monitoring and optimization
   */
  async getConnectionPoolUsage(): Promise<{
    maxPoolSize: number;
    minPoolSize: number;
    currentPoolSize: number;
    poolUsagePercent: number;
    activeConnections: number;
    availableConnections: number;
    isHealthy: boolean; // true if pool usage < 80%
  }> {
    const metrics = await this.collectMetrics();
    if (!metrics) {
      const maxPoolSize = this.configService.get<number>('mongodb.maxPoolSize', 50);
      const minPoolSize = this.configService.get<number>('mongodb.minPoolSize', 5);
      return {
        maxPoolSize,
        minPoolSize,
        currentPoolSize: 0,
        poolUsagePercent: 0,
        activeConnections: 0,
        availableConnections: 0,
        isHealthy: false,
      };
    }

    return {
      maxPoolSize: metrics.connectionPool.maxPoolSize,
      minPoolSize: metrics.connectionPool.minPoolSize,
      currentPoolSize: metrics.connectionPool.currentPoolSize,
      poolUsagePercent: metrics.connectionPool.poolUsagePercent,
      activeConnections: metrics.connections.current,
      availableConnections: metrics.connections.available,
      isHealthy: metrics.connectionPool.isHealthy,
    };
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    this.logger.log('MongoDB metrics service destroyed');
  }
}

import { Module, Global, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoDBMetricsService } from './mongodb-metrics.service';

/**
 * MonitoringModule
 *
 * Provides monitoring services for MongoDB and system metrics
 * Can be integrated with Prometheus, Grafana, or other monitoring systems
 */
@Global() // Make MongoDBMetricsService available globally
@Module({
  imports: [MongooseModule],
  providers: [
    MongoDBMetricsService,
    // Provide string token for dependency injection (to avoid import issues)
    {
      provide: 'MongoDBMetricsService',
      useExisting: MongoDBMetricsService,
    } as Provider,
  ],
  exports: [MongoDBMetricsService, 'MongoDBMetricsService'],
})
export class MonitoringModule {}

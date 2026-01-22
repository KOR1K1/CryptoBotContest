import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
const compression = require('compression');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);

  // Log auto-detected system resources (if not explicitly set in env)
  if (!process.env.MONGO_WIREDTIGER_CACHE_SIZE_GB || !process.env.MONGO_MAX_POOL_SIZE) {
    const { SystemResources } = await import('./config/system-resources');
    const systemInfo = SystemResources.getSystemInfo();
    
    const dockerInfo = systemInfo.isDocker
      ? ` (Docker container${systemInfo.dockerMemoryLimit ? `, memory limit: ${systemInfo.dockerMemoryLimit}GB` : ''}${systemInfo.dockerCPULimit ? `, CPU limit: ${systemInfo.dockerCPULimit}` : ''})`
      : '';
    
    logger.log({
      action: 'system-resources-detected',
      totalRAM: `${systemInfo.totalRAM}GB`,
      availableRAM: `${systemInfo.availableRAM}GB`,
      cpuCores: systemInfo.cpuCores,
      mongoDBCache: `${systemInfo.mongoDBCache}GB`,
      mongoDBPool: `${systemInfo.mongoDBPool.min}-${systemInfo.mongoDBPool.max}`,
      isDocker: systemInfo.isDocker,
      dockerMemoryLimit: systemInfo.dockerMemoryLimit,
      dockerCPULimit: systemInfo.dockerCPULimit,
    }, `Auto-detected system resources: ${systemInfo.totalRAM}GB RAM, ${systemInfo.cpuCores} CPU cores${dockerInfo}. MongoDB: ${systemInfo.mongoDBCache}GB cache, ${systemInfo.mongoDBPool.min}-${systemInfo.mongoDBPool.max} connections`);
  }

  // Security: Helmet for security headers
  // Protects against common vulnerabilities (XSS, clickjacking, etc.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for Swagger UI
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Allow inline scripts for Swagger UI
          imgSrc: ["'self'", 'data:', 'https:'], // Allow images from any HTTPS source
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Disable for Swagger UI compatibility
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resources
    }),
  );

  // Enable response compression (Gzip)
  app.use(compression({
    level: 6, // Compression level 1-9 (6 is good balance)
    filter: (req: any, res: any) => {
      // Skip compression for no-compression header
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Use default filter for JSON/text/html
      return compression.filter(req, res);
    },
  }));

  // CORS configuration
  // Production: Configure allowed origins via environment variable
  const allowedOrigins = configService.get<string>('cors.origins', 'http://localhost:3001,http://localhost:3000').split(',');
  const isDevelopment = configService.get<string>('nodeEnv', 'development') === 'development';

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl)
      if (!origin && isDevelopment) {
        return callback(null, true);
      }
      // Check if origin is in allowed list
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-bot-simulator'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
    maxAge: 86400, // 24 hours
  });

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger/OpenAPI configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Auction API')
    .setDescription(`
## Telegram Gift Auction Clone - Backend API

This API provides endpoints for a multi-round auction system with:
- **Auctions**: Create, start, and manage auctions
- **Bids**: Place and manage bids with carry-over support
- **Users**: User management with balance tracking
- **Gifts**: Gift catalog management

### Key Features
- **Financial Integrity**: Ledger-based accounting with full audit trail
- **Concurrency**: MongoDB transactions + optional Redis locks
- **Real-time**: WebSocket updates for bid changes
- **Rate Limiting**: Protected against DDoS and abuse

### Authentication
Currently, the API uses userId passed in request body for user identification.
Future versions will implement JWT-based authentication.
    `)
    .setVersion('1.0.0')
    .addTag('Auctions', 'Auction lifecycle management')
    .addTag('Users', 'User management and balance operations')
    .addTag('Gifts', 'Gift catalog management')
    .addTag('Health', 'Service health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'Auction API Documentation',
  });

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`Backend API is running on: http://localhost:${port}`);
  logger.log(`Swagger API docs available at: http://localhost:${port}/api/docs`);
  logger.log(`Frontend is available at: http://localhost:3001`);
}

bootstrap();


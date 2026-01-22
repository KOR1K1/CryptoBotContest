import { SystemResources } from './system-resources';

export default () => {
  // Auto-detect system resources if not explicitly set
  const systemInfo = SystemResources.getSystemInfo();
  
  // Use environment variables if set, otherwise auto-detect
  const mongoDBCacheSizeGB = process.env.MONGO_WIREDTIGER_CACHE_SIZE_GB
    ? parseInt(process.env.MONGO_WIREDTIGER_CACHE_SIZE_GB, 10)
    : systemInfo.mongoDBCache;
  
  const mongoDBPool = process.env.MONGO_MAX_POOL_SIZE
    ? {
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE, 10),
        minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '10', 10),
      }
    : {
        maxPoolSize: systemInfo.mongoDBPool.max,
        minPoolSize: systemInfo.mongoDBPool.min,
      };

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/auction_db',
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/auction_db',
      wiredTigerCacheSizeGB: mongoDBCacheSizeGB, // Auto-detected or from env
      // Auto-detected based on system resources:
      // - Small systems (<4GB RAM): 1GB cache, 20-30 connections
      // - Medium systems (4-16GB RAM): 2-8GB cache, 50-100 connections
      // - Large systems (16-64GB RAM): 16-32GB cache, 100-300 connections
      // - Very large systems (>64GB RAM): 32GB cache, 300-500 connections
      maxPoolSize: mongoDBPool.maxPoolSize, // Auto-detected or from env
      minPoolSize: mongoDBPool.minPoolSize, // Auto-detected or from env
      maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME_MS || '30000', 10), // Default: 30 seconds (30000ms)
      // Close idle connections after 30 seconds of inactivity
      // This prevents connection leaks and allows MongoDB to free up resources
    },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    ttl: parseInt(process.env.REDIS_TTL || '3000', 10), // Default TTL: 3 seconds
    useForThrottling: process.env.REDIS_USE_FOR_THROTTLING === 'true', // Enable Redis-backed throttling for multi-instance (default: false)
  },
  cache: {
    ttl: {
      dashboard: parseInt(process.env.CACHE_TTL_DASHBOARD || '1000', 10), // 1 second (shorter when RUNNING+no bids to pick up bot load faster)
      auctionDetails: parseInt(process.env.CACHE_TTL_AUCTION || '5000', 10), // 5 seconds for auction details
      topBids: parseInt(process.env.CACHE_TTL_TOP_BIDS || '1000', 10), // 1 second for top bids
      userPosition: parseInt(process.env.CACHE_TTL_USER_POSITION || '2000', 10), // 2 seconds for user position
    },
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  // Rate limiting configuration
  // Protects against DDoS and abuse
  throttle: {
    // Short window: high-frequency protection (per second)
    shortTtl: parseInt(process.env.THROTTLE_SHORT_TTL || '1000', 10), // 1 second
    shortLimit: parseInt(process.env.THROTTLE_SHORT_LIMIT || '10', 10), // 10 requests per second
    // Medium window: burst protection (per 10 seconds)
    mediumTtl: parseInt(process.env.THROTTLE_MEDIUM_TTL || '10000', 10), // 10 seconds
    mediumLimit: parseInt(process.env.THROTTLE_MEDIUM_LIMIT || '50', 10), // 50 requests per 10 seconds
    // Long window: sustained abuse protection (per minute)
    longTtl: parseInt(process.env.THROTTLE_LONG_TTL || '60000', 10), // 60 seconds
    longLimit: parseInt(process.env.THROTTLE_LONG_LIMIT || '200', 10), // 200 requests per minute
  },
  // CORS configuration
  // Production: Set CORS_ORIGINS environment variable with comma-separated origins
  // Example: CORS_ORIGINS=https://example.com,https://app.example.com
  cors: {
    origins: process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000',
  },
  };
}


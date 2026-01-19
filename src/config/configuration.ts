export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/auction_db',
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/auction_db',
    wiredTigerCacheSizeGB: parseInt(process.env.MONGO_WIREDTIGER_CACHE_SIZE_GB || '4', 10), // Default: 4GB (for development)
    // Production recommendation: 50% of available RAM
    // For 8GB RAM: 4GB
    // For 16GB RAM: 8GB
    // For 32GB RAM: 16GB
    // Connection Pool Configuration
    // Production recommendation: maxPoolSize 50-100 for single server, minPoolSize 5-10
    // For high load (100k+ bids/round): maxPoolSize 75-100, minPoolSize 10
    // For medium load (10k-100k bids/round): maxPoolSize 50-75, minPoolSize 5
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '50', 10), // Default: 50 (for development), Production: 50-100
    minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10), // Default: 5 (for development), Production: 5-10
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
      dashboard: parseInt(process.env.CACHE_TTL_DASHBOARD || '2000', 10), // 2 seconds for dashboard
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
});


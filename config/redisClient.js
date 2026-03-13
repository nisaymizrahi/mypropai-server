const redis = require('redis');

let redisClient;
const shouldSkipRedisConnection = process.env.SKIP_REDIS_CONNECT === '1';

const createNoopRedisClient = () => ({
  isReady: false,
  isOpen: false,
  async get() {
    return null;
  },
  async set() {
    return null;
  },
  async quit() {
    return null;
  },
  disconnect() {
    return null;
  },
  destroy() {
    return null;
  },
});

if (shouldSkipRedisConnection) {
  redisClient = createNoopRedisClient();
} else if (!process.env.REDIS_URL) {
  console.warn('REDIS_URL is not configured. Continuing without Redis token blocklisting.');
  redisClient = createNoopRedisClient();
} else {
  // Create the Redis client
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
  });

  // Set up event listeners for the connection
  redisClient.on('connect', () => {
    console.log('Connecting to Redis...');
  });

  redisClient.on('ready', () => {
    console.log('Redis client connected and ready to use.');
  });

  redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  // Connect lazily and fail soft so auth can still work without Redis.
  redisClient.connect().catch((err) => {
    console.error('Redis connection failed:', err);
  });
}

module.exports = redisClient;

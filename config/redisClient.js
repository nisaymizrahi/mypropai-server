const redis = require('redis');

// Create the Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

// Set up event listeners for the connection
redisClient.on('connect', () => {
  console.log('Connecting to Redis...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis client connected and ready to use.');
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Connect to the Redis server.
// We wrap this in an async function to use top-level await.
(async () => {
  await redisClient.connect();
})();


module.exports = redisClient;
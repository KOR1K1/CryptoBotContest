/**
 * High-Performance Bot Load Test Script
 * 
 * Bypasses browser HTTP connection pool limits by running directly in Node.js
 * Can generate 1000+ bots/second for true load testing
 * 
 * Usage:
 *   node scripts/bot-load-test.js <numBots> <bidsPerBot> [auctionId]
 * 
 * Examples:
 *   # Auto-find running auction
 *   node scripts/bot-load-test.js 10000 10
 *   
 *   # Use specific auction ID
 *   node scripts/bot-load-test.js 10000 10 507f1f77bcf86cd799439011
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
// Adaptive concurrency: start lower, adjust based on performance
const INITIAL_CONCURRENCY = parseInt(process.env.CONCURRENCY || '50', 10); // Start very conservative (was 100)
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '200', 10); // Max limit (was 300)
const MIN_CONCURRENCY = parseInt(process.env.MIN_CONCURRENCY || '10', 10); // Min limit (was 20)
const MIN_BID = parseInt(process.env.MIN_BID || '100', 10);
const MAX_BID = parseInt(process.env.MAX_BID || '1000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '200', 10); // Process in batches with pauses (was 500)
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '200', 10); // Pause between batches (was 100)

const botHeaders = { 'x-bot-simulator': '1', 'Content-Type': 'application/json' };

async function apiRequest(endpoint, options = {}) {
  try {
    // For GET requests to /auctions, don't require bot headers
    const useBotHeaders = options.method === 'POST' || endpoint.includes('/bids/bot');
    const headers = useBotHeaders 
      ? { ...botHeaders, ...options.headers }
      : { 'Content-Type': 'application/json', ...options.headers };
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    throw err;
  }
}

async function createBot(index) {
  const username = `bot_${Date.now()}_${index}`;
  try {
    // Use bot headers to bypass rate limiting for user creation
    const data = await apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify({ username, initialBalance: 100000 }),
      headers: botHeaders, // Add bot header to bypass throttling
    });
    return data;
  } catch (err) {
    console.error(`[Bot ${index}] Failed to create:`, err.message);
    return null;
  }
}

async function placeBid(bot, auctionId, amount, lastBidByBotAuction) {
  const key = `${bot.id}\t${auctionId}`;
  const lastAmt = lastBidByBotAuction.get(key);
  const bidAmount = lastAmt != null ? Math.floor(lastAmt) + 1 : amount;

  try {
    const data = await apiRequest(`/auctions/${auctionId}/bids/bot`, {
      method: 'POST',
      body: JSON.stringify({ userId: String(bot.id), amount: Math.floor(bidAmount) }),
    });
    lastBidByBotAuction.set(key, data.amount);
    return true;
  } catch (err) {
    return false;
  }
}

async function findRunningAuction() {
  try {
    const auctions = await apiRequest('/auctions');
    const runningAuction = auctions.find((a) => a.status === 'RUNNING');
    
    if (!runningAuction) {
      const allStatuses = [...new Set(auctions.map((a) => a.status))];
      throw new Error(
        `No running auction found. Available statuses: ${allStatuses.join(', ')}. ` +
        `Please start an auction first or provide a specific auction ID.`
      );
    }
    
    return runningAuction;
  } catch (err) {
    if (err.message.includes('No running auction')) {
      throw err;
    }
    throw new Error(`Failed to fetch auctions: ${err.message}`);
  }
}

async function runPool(tasks, limit, onProgress) {
  return new Promise((resolve) => {
    let idx = 0;
    let active = 0;
    let completed = 0;
    let errors = 0;
    const startTimes = new Map(); // Track task start times for performance monitoring

    const next = () => {
      if (idx === tasks.length && active === 0) {
        resolve({ completed, errors });
        return;
      }
      while (active < limit && idx < tasks.length) {
        const taskIdx = idx++;
        const fn = tasks[taskIdx];
        active++;
        startTimes.set(taskIdx, Date.now());
        
        fn()
          .then(() => {
            completed++;
            if (onProgress) {
              const duration = Date.now() - startTimes.get(taskIdx);
              onProgress({ completed, errors, active, duration });
            }
          })
          .catch(() => {
            errors++;
            if (onProgress) {
              onProgress({ completed, errors, active });
            }
          })
          .finally(() => {
            active--;
            startTimes.delete(taskIdx);
            next();
          });
      }
    };
    next();
  });
}

// Adaptive concurrency: adjust based on performance
function calculateAdaptiveConcurrency(stats, currentConcurrency) {
  const { avgDuration, errorRate, throughput } = stats;
  
  // If errors are high (>10%), reduce concurrency
  if (errorRate > 0.1) {
    return Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.7));
  }
  
  // If average duration is increasing (degradation), reduce
  if (avgDuration > 2000) { // >2s per task
    return Math.max(MIN_CONCURRENCY, Math.floor(currentConcurrency * 0.8));
  }
  
  // If performance is good and error rate is low, can increase slightly
  if (errorRate < 0.01 && avgDuration < 500 && currentConcurrency < MAX_CONCURRENCY) {
    return Math.min(MAX_CONCURRENCY, Math.floor(currentConcurrency * 1.1));
  }
  
  return currentConcurrency; // Keep current
}

async function main() {
  const numBots = parseInt(process.argv[2] || '1000', 10);
  const bidsPerBot = parseInt(process.argv[3] || '10', 10);
  const providedAuctionId = process.argv[4];

  // Find auction (auto-detect or use provided ID)
  let auctionId;
  let auctionInfo = null;

  if (providedAuctionId) {
    // Use provided auction ID
    auctionId = providedAuctionId;
    console.log(`🔍 Using provided auction ID: ${auctionId}`);
    try {
      auctionInfo = await apiRequest(`/auctions/${auctionId}`);
      console.log(`📋 Auction: ${auctionInfo.giftId || 'N/A'} (Status: ${auctionInfo.status})`);
    } catch (err) {
      console.error(`❌ Failed to fetch auction ${auctionId}: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Auto-find running auction
    console.log('🔍 Auto-detecting running auction...');
    try {
      auctionInfo = await findRunningAuction();
      auctionId = auctionInfo.id;
      console.log(`✅ Found running auction: ${auctionId}`);
      console.log(`📋 Auction: ${auctionInfo.giftId || 'N/A'} (Round ${(auctionInfo.currentRound || 0) + 1}/${auctionInfo.totalRounds || '?'})`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      console.error('\n💡 Tip: Start an auction first, or provide auction ID as 3rd argument:');
      console.error('   node scripts/bot-load-test.js 10000 10 <auction-id>');
      process.exit(1);
    }
  }

  console.log(`🚀 Starting load test: ${numBots} bots, ${bidsPerBot} bids/bot`);
  console.log(`⚙️  Initial Concurrency: ${INITIAL_CONCURRENCY} (adaptive: ${MIN_CONCURRENCY}-${MAX_CONCURRENCY})`);
  console.log(`⚙️  Batch size: ${BATCH_SIZE}, Batch delay: ${BATCH_DELAY_MS}ms`);
  console.log(`⚙️  API: ${API_BASE_URL}`);

  const startTime = Date.now();
  let botsCreated = 0;
  let bidsPlaced = 0;
  let firstError = null;
  const lastBidByBotAuction = new Map();

  // Get auction minBid
  const auctionMinBid = auctionInfo?.minBid || 100;
  console.log(`📊 Auction minBid: ${auctionMinBid}\n`);

  // Performance tracking for adaptive concurrency
  let currentConcurrency = INITIAL_CONCURRENCY;
  const performanceStats = {
    durations: [],
    errors: 0,
    total: 0,
    lastUpdate: Date.now(),
  };

  // Create bots and place bids
  const allTasks = Array.from({ length: numBots }, (_, i) => async () => {
    const taskStart = Date.now();
    let success = true;
    
    try {
      const bot = await createBot(i);
      if (!bot) {
        success = false;
        return;
      }

      botsCreated++;
      
      // Place bids for this bot
      for (let j = 0; j < bidsPerBot; j++) {
        const lo = Math.max(auctionMinBid, MIN_BID);
        const hi = Math.max(lo, MAX_BID);
        const amount = Math.max(lo, Math.round(lo + Math.random() * (hi - lo)));

        const bidSuccess = await placeBid(bot, auctionId, amount, lastBidByBotAuction);
        if (bidSuccess) bidsPlaced++;
      }
      
      const duration = Date.now() - taskStart;
      performanceStats.durations.push(duration);
      performanceStats.total++;
      
      // Update stats every 50 tasks
      if (performanceStats.total % 50 === 0) {
        const avgDuration = performanceStats.durations.slice(-100).reduce((a, b) => a + b, 0) / Math.min(100, performanceStats.durations.length);
        const errorRate = performanceStats.errors / performanceStats.total;
        const newConcurrency = calculateAdaptiveConcurrency(
          { avgDuration, errorRate, throughput: botsCreated / ((Date.now() - startTime) / 1000) },
          currentConcurrency
        );
        
        if (newConcurrency !== currentConcurrency) {
          currentConcurrency = newConcurrency;
          const elapsed = ((Date.now() - startTime) / 1000);
          const bidsRate = elapsed > 0 ? (bidsPlaced / elapsed).toFixed(1) : '0.0';
          console.log(`\n📊 Performance: avg=${avgDuration.toFixed(0)}ms, errors=${(errorRate * 100).toFixed(1)}%, bids=${bidsRate}/s, adjusting concurrency to ${currentConcurrency}`);
        }
      }
    } catch (err) {
      success = false;
      performanceStats.errors++;
      if (!firstError) firstError = err.message;
    }
    
    return success;
  });

  // Process in batches with adaptive concurrency
  console.log('🔄 Running concurrent tasks (adaptive concurrency)...\n');
  
  let processed = 0;
  const batchResults = [];
  
  while (processed < allTasks.length) {
    const batch = allTasks.slice(processed, processed + BATCH_SIZE);
    const batchStart = Date.now();
    
    const result = await runPool(batch, currentConcurrency, ({ completed, errors, active }) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const botsRate = elapsed > 0 ? (botsCreated / elapsed).toFixed(1) : '0.0';
      const bidsRate = elapsed > 0 ? (bidsPlaced / elapsed).toFixed(1) : '0.0';
      process.stdout.write(`\r✅ Progress: ${botsCreated}/${numBots} bots (${botsRate}/s), ${bidsPlaced} bids (${bidsRate}/s), active: ${active}, concurrency: ${currentConcurrency}`);
    });
    
    batchResults.push(result);
    processed += batch.length;
    
    // Pause between batches to let MongoDB/backend recover
    if (processed < allTasks.length && BATCH_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  const result = batchResults.reduce((acc, r) => ({
    completed: acc.completed + r.completed,
    errors: acc.errors + r.errors,
  }), { completed: 0, errors: 0 });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const botsPerSec = (botsCreated / elapsed).toFixed(1);
  const bidsPerSec = (bidsPlaced / elapsed).toFixed(1);
  const avgDuration = performanceStats.durations.length > 0
    ? (performanceStats.durations.reduce((a, b) => a + b, 0) / performanceStats.durations.length).toFixed(0)
    : '0';
  const errorRate = performanceStats.total > 0
    ? ((performanceStats.errors / performanceStats.total) * 100).toFixed(1)
    : '0';

  console.log('\n\n' + '='.repeat(70));
  console.log('📈 Load Test Results:');
  console.log('='.repeat(70));
  console.log(`⏱️  Total time: ${elapsed}s`);
  console.log(`👥 Bots created: ${botsCreated}/${numBots} (${botsPerSec} bots/s)`);
  console.log(`💰 Bids placed: ${bidsPlaced}/${numBots * bidsPerBot} (${bidsPerSec} bids/s)`);
  console.log(`✅ Success rate: ${((bidsPlaced / (numBots * bidsPerBot)) * 100).toFixed(1)}%`);
  console.log(`📊 Performance:`);
  console.log(`   - Avg task duration: ${avgDuration}ms`);
  console.log(`   - Error rate: ${errorRate}%`);
  console.log(`   - Final concurrency: ${currentConcurrency}`);
  if (firstError) {
    console.log(`❌ First error: ${firstError}`);
  }
  console.log('='.repeat(70));
  
  // Performance recommendations
  if (parseFloat(botsPerSec) < 20) {
    console.log('\n💡 Performance Tips:');
    console.log('   - System may be overloaded. Try reducing CONCURRENCY:');
    console.log('     CONCURRENCY=50 node scripts/bot-load-test.js ...');
    console.log('   - Increase BATCH_DELAY_MS to give backend more time:');
    console.log('     BATCH_DELAY_MS=200 node scripts/bot-load-test.js ...');
    console.log('   - Check MongoDB connection pool settings (maxPoolSize)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

import { useState } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from '../components/Toast';

const BotSimulatorPage = () => {
  const [numBots, setNumBots] = useState('5');
  const [bidsPerBot, setBidsPerBot] = useState('10');
  const [minBid, setMinBid] = useState('100');
  const [maxBid, setMaxBid] = useState('1000');
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    setStatus({ type: 'loading', message: 'Creating bots and placing bids...' });

    try {
      const botHeaders = { 'x-bot-simulator': '1' };

      // Get all auctions
      const auctions = await apiRequest('/auctions');
      const runningAuctions = auctions.filter(a => a.status === 'RUNNING');

      if (runningAuctions.length === 0) {
        setStatus({ type: 'error', message: 'No running auctions found. Please start an auction first.' });
        setRunning(false);
        return;
      }

      // Concurrency pool to speed up massive bot creation/placing
      const CONCURRENCY = 200; // tune as needed (e.g., 100 if backend allows)
      let botsCreated = 0;
      let bidsPlaced = 0;
      let firstError = null;
      const lastBidByBotAuction = new Map(); // key: "botId\tauctionId" -> amount

      const tasks = Array.from({ length: parseInt(numBots) }, (_, i) => async () => {
        const username = `bot_${Date.now()}_${i}`;
        let bot;
        try {
          bot = await apiRequest('/users', {
            method: 'POST',
            headers: botHeaders,
            data: {
              username,
              initialBalance: 100000,
            },
          });
          botsCreated++;
        } catch (err) {
          const msg = err?.message || String(err);
          if (!firstError) firstError = msg;
          console.error(`Error creating bot user ${username}:`, err);
          return; // Skip bidding for this bot
        }

        // Immediately place bids for this bot
        for (let j = 0; j < parseInt(bidsPerBot); j++) {
          const auction = runningAuctions[Math.floor(Math.random() * runningAuctions.length)];
          const key = `${String(bot.id)}\t${String(auction.id)}`;
          const lastAmt = lastBidByBotAuction.get(key);

          const bidAmount = lastAmt != null
            ? Math.floor(lastAmt) + 1
            : (() => {
                const lo = Math.max(auction.minBid ?? 100, parseFloat(minBid));
                const hi = Math.max(lo, parseFloat(maxBid));
                return Math.max(lo, Math.round(lo + Math.random() * (hi - lo)));
              })();

          try {
            const res = await apiRequest(`/auctions/${String(auction.id)}/bids/bot`, {
              method: 'POST',
              headers: botHeaders,
              data: { userId: String(bot.id), amount: Math.floor(bidAmount) },
            });
            bidsPlaced++;
            lastBidByBotAuction.set(key, res.amount);
          } catch (err) {
            const msg = err?.message || String(err);
            if (!firstError) firstError = msg;
            console.error(`Error placing bid for bot ${bot.username}:`, err);
          }
        }
      });

      // Run tasks with concurrency limit
      const runPool = async (fns, limit) => {
        return new Promise((resolve) => {
          let idx = 0;
          let active = 0;
          const next = () => {
            if (idx === fns.length && active === 0) return resolve(null);
            while (active < limit && idx < fns.length) {
              const fn = fns[idx++];
              active++;
              fn()
                .catch(() => {})
                .finally(() => {
                  active--;
                  next();
                });
            }
          };
          next();
        });
      };

      await runPool(tasks, CONCURRENCY);

      let message = `Bot simulation complete! Created ${botsCreated} bots and placed ${bidsPlaced} bids.`;
      if (bidsPlaced === 0 && firstError) {
        message += ` First error: ${firstError}`;
      }
      setStatus({ type: 'success', message });
      showToast(`Created ${botsCreated} bots and placed ${bidsPlaced} bids!`, bidsPlaced > 0 ? 'success' : 'error');
      
      // Trigger refresh
      window.dispatchEvent(new CustomEvent('refresh-auctions'));
    } catch (error) {
      const errorMessage = error.message || 'Error in bot simulation';
      setStatus({ type: 'error', message: errorMessage });
      showToast(`Bot simulation error: ${errorMessage}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page active">
      <div className="page-header">
        <h2>Bot Simulator</h2>
      </div>

      <div className="detail-section">
        <h3>Simulation Parameters</h3>
        <div className="form-group">
          <label>Number of Bots:</label>
          <input
            type="number"
            value={numBots}
            onChange={(e) => setNumBots(e.target.value)}
            min="1"
            max="50"
          />
        </div>
        <div className="form-group">
          <label>Bids per Bot:</label>
          <input
            type="number"
            value={bidsPerBot}
            onChange={(e) => setBidsPerBot(e.target.value)}
            min="1"
            max="100"
          />
        </div>
        <div className="form-group">
          <label>Min Bid Amount:</label>
          <input
            type="number"
            value={minBid}
            onChange={(e) => setMinBid(e.target.value)}
            min="1"
            step="0.01"
          />
        </div>
        <div className="form-group">
          <label>Max Bid Amount:</label>
          <input
            type="number"
            value={maxBid}
            onChange={(e) => setMaxBid(e.target.value)}
            min="1"
            step="0.01"
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleRun}
          disabled={running}
          style={{ marginTop: '16px' }}
        >
          {running ? 'Running Simulation...' : 'Run Bot Simulation'}
        </button>

        {status && (
          <div className={status.type} style={{ marginTop: '16px' }}>
            {status.message}
          </div>
        )}
      </div>
    </div>
  );
};

export default BotSimulatorPage;

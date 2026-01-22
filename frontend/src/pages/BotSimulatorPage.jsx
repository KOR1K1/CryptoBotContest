import { useState } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Tooltip from '../components/ui/Tooltip';

/**
 * BotSimulatorPage Component
 * 
 * Страница симулятора ботов с улучшенным дизайном
 */
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
      const CONCURRENCY = 200;
      let botsCreated = 0;
      let bidsPlaced = 0;
      let firstError = null;
      const lastBidByBotAuction = new Map();

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
          return;
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary mb-2">Bot Simulator</h1>
        <p className="text-text-secondary">
          Simulate multiple bots placing bids on running auctions for load testing
        </p>
      </div>

      {/* Simulation Parameters */}
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Simulation Parameters</h2>}>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Tooltip content="Number of bot users to create (1-50)">
              <Input
                label="Number of Bots"
                type="number"
                value={numBots}
                onChange={(e) => setNumBots(e.target.value)}
                min="1"
                max="50"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content="Number of bids each bot will place (1-100)">
              <Input
                label="Bids per Bot"
                type="number"
                value={bidsPerBot}
                onChange={(e) => setBidsPerBot(e.target.value)}
                min="1"
                max="100"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content="Minimum bid amount for each bot">
              <Input
                label="Min Bid Amount"
                type="number"
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                min="1"
                step="0.01"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content="Maximum bid amount for each bot">
              <Input
                label="Max Bid Amount"
                type="number"
                value={maxBid}
                onChange={(e) => setMaxBid(e.target.value)}
                min="1"
                step="0.01"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </Tooltip>
          </div>

          {/* Status Message */}
          {status && (
            <div className={`p-4 rounded-lg border ${
              status.type === 'success'
                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                : status.type === 'error'
                ? 'bg-status-error/10 border-status-error/30 text-status-error'
                : 'bg-status-info/10 border-status-info/30 text-status-info'
            }`}>
              <div className="flex items-center gap-2">
                {status.type === 'loading' && (
                  <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {status.type === 'success' && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {status.type === 'error' && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className="font-medium">{status.message}</span>
              </div>
            </div>
          )}

          {/* Run Button */}
          <Tooltip content="Start the bot simulation. This will create bots and place bids on running auctions.">
            <Button
              variant="primary"
              size="lg"
              onClick={handleRun}
              loading={running}
              disabled={running}
              className="w-full"
              leftIcon={
                running ? null : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )
              }
            >
              {running ? 'Running Simulation...' : 'Run Bot Simulation'}
            </Button>
          </Tooltip>
        </div>
      </Card>

      {/* Info Card */}
      <Card variant="outlined" className="p-6">
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <svg className="w-5 h-5 text-status-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How it works
          </h3>
          <ul className="space-y-2 text-sm text-text-secondary list-disc list-inside">
            <li>Creates multiple bot users with initial balance of 100,000</li>
            <li>Each bot places random bids on running auctions</li>
            <li>Bids are placed with amounts between Min and Max values</li>
            <li>Useful for load testing and demonstrating concurrent bid handling</li>
            <li>Results will appear in auctions and your bids page</li>
          </ul>
        </div>
      </Card>
    </div>
  );
};

export default BotSimulatorPage;

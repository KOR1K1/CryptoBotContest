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
      // Get all auctions
      const auctions = await apiRequest('/auctions');
      const runningAuctions = auctions.filter(a => a.status === 'RUNNING');

      if (runningAuctions.length === 0) {
        setStatus({ type: 'error', message: 'No running auctions found. Please start an auction first.' });
        setRunning(false);
        return;
      }

      // Create bots
      const botUsers = [];
      for (let i = 0; i < parseInt(numBots); i++) {
        const username = `bot_${Date.now()}_${i}`;
        const user = await apiRequest('/users', {
          method: 'POST',
          data: {
            username,
            initialBalance: 100000,
          },
        });
        botUsers.push(user);
      }

      setStatus({ type: 'success', message: `Created ${numBots} bots. Placing bids...` });

      // Place bids randomly
      let bidsPlaced = 0;
      for (const bot of botUsers) {
        for (let i = 0; i < parseInt(bidsPerBot); i++) {
          const auction = runningAuctions[Math.floor(Math.random() * runningAuctions.length)];
          const bidAmount = parseFloat(minBid) + Math.random() * (parseFloat(maxBid) - parseFloat(minBid));

          try {
            // Use /bids/bot endpoint for bot simulation (has higher rate limits)
            await apiRequest(`/auctions/${auction.id}/bids/bot`, {
              method: 'POST',
              data: {
                userId: bot.id,
                amount: bidAmount,
              },
            });
            bidsPlaced++;
          } catch (error) {
            console.error(`Error placing bid for bot ${bot.username}:`, error);
          }

          // Small delay between bids
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      setStatus({
        type: 'success',
        message: `Bot simulation complete! Created ${numBots} bots and placed ${bidsPlaced} bids.`,
      });
      showToast(`Created ${numBots} bots and placed ${bidsPlaced} bids!`, 'success');
      
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

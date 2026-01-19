import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';

const AuctionModal = ({ onClose, onCreated }) => {
  const [giftId, setGiftId] = useState('');
  const [totalGifts, setTotalGifts] = useState('2');
  const [totalRounds, setTotalRounds] = useState('3');
  const [roundDuration, setRoundDuration] = useState('60');
  const [minBid, setMinBid] = useState('100');
  const [gifts, setGifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadGifts();
  }, []);

  const loadGifts = async () => {
    try {
      const giftsData = await apiRequest('/gifts');
      setGifts(giftsData);
    } catch (error) {
      console.error('Error loading gifts:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await apiRequest('/auctions', {
        method: 'POST',
        data: {
          giftId,
          totalGifts: parseInt(totalGifts),
          totalRounds: parseInt(totalRounds),
          roundDurationMs: parseInt(roundDuration) * 1000,
          minBid: parseFloat(minBid),
        },
      });

      alert('Auction created successfully!');
      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create auction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal active" onClick={(e) => e.target.className === 'modal active' && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <h3>Create New Auction</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Gift:</label>
            <select value={giftId} onChange={(e) => setGiftId(e.target.value)} required>
              <option value="">Select a gift...</option>
              {gifts.map((gift) => (
                <option key={gift.id} value={gift.id}>
                  {gift.title}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Total Gifts:</label>
            <input
              type="number"
              value={totalGifts}
              onChange={(e) => setTotalGifts(e.target.value)}
              min="1"
              max="1000"
              required
            />
          </div>
          <div className="form-group">
            <label>Total Rounds:</label>
            <input
              type="number"
              value={totalRounds}
              onChange={(e) => setTotalRounds(e.target.value)}
              min="1"
              max="20"
              required
            />
          </div>
          <div className="form-group">
            <label>Round Duration (seconds):</label>
            <input
              type="number"
              value={roundDuration}
              onChange={(e) => setRoundDuration(e.target.value)}
              min="1"
              required
            />
          </div>
          <div className="form-group">
            <label>Minimum Bid:</label>
            <input
              type="number"
              value={minBid}
              onChange={(e) => setMinBid(e.target.value)}
              min="1"
              step="0.01"
              required
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuctionModal;

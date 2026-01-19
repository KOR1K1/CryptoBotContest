import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';

const AddGiftModal = ({ currentUserId, onClose, onAdded }) => {
  const [giftId, setGiftId] = useState('');
  const [bidAmount, setBidAmount] = useState('100');
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
    
    if (!currentUserId) {
      setError('Please select a user first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await apiRequest(`/users/${currentUserId}/inventory/add`, {
        method: 'POST',
        data: {
          giftId,
          bidAmount: parseFloat(bidAmount) || 100,
        },
      });

      alert('Gift added to inventory successfully!');
      onAdded();
    } catch (err) {
      setError(err.message || 'Failed to add gift');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal active" onClick={(e) => e.target.className === 'modal active' && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Add Gift to Inventory</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>
          This is a demo function to add gifts to inventory for testing purposes.
        </p>
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
            <label>Bid Amount (for display):</label>
            <input
              type="number"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
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
              {loading ? 'Adding...' : 'Add to Inventory'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddGiftModal;

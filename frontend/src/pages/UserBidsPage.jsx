import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from '../components/Toast';

const UserBidsPage = ({ currentUserId }) => {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBids = async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const bidsData = await apiRequest(`/users/${currentUserId}/bids`);
      setBids(bidsData);
    } catch (error) {
      console.error('Error loading bids:', error);
      setError(error.message);
      showToast(`Failed to load bids: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBids();
  }, [currentUserId]);

  if (!currentUserId) {
    return <div className="loading">Please select a user to view bids</div>;
  }

  if (loading) {
    return <div className="loading">Loading bids...</div>;
  }

  if (error) {
    return (
      <div className="page active">
        <div className="page-header">
          <h2>My Bids</h2>
          <button className="btn-primary" onClick={loadBids}>
            Retry
          </button>
        </div>
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--error)',
        }}>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Error loading bids</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page active">
      <div className="page-header">
        <h2>My Bids</h2>
        <button className="btn-primary" onClick={loadBids}>
          Refresh
        </button>
      </div>

      {bids.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>No bids yet</div>
          <div style={{ fontSize: '14px' }}>Place a bid on an auction to see it here!</div>
        </div>
      ) : (
        <div className="bids-list">
          {bids.map((bid) => (
            <div key={bid.id} className={`bid-item-enhanced ${bid.status === 'WON' ? 'top-bid' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: bid.status === 'WON'
                    ? 'linear-gradient(135deg, var(--success), rgba(16, 185, 129, 0.8))'
                    : bid.status === 'ACTIVE'
                    ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                    : 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontWeight: '700',
                  color: 'white',
                  flexShrink: 0,
                }}>
                  {bid.status === 'WON' ? 'W' : bid.status === 'ACTIVE' ? 'A' : 'R'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="bid-amount" style={{ fontSize: '22px', marginBottom: '4px' }}>
                    {bid.amount.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                    Auction: {bid.auctionId.substring(0, 8)}...
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Round {bid.roundIndex + 1} • {new Date(bid.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <span className={`bid-status ${bid.status.toLowerCase()}`} style={{ fontSize: '11px' }}>
                {bid.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserBidsPage;

import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import GiftModal from '../components/GiftModal';
import AuctionModal from '../components/AuctionModal';
import { showToast } from '../components/Toast';

const AuctionsPage = ({ onAuctionClick }) => {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [showAuctionModal, setShowAuctionModal] = useState(false);

  const loadAuctions = async () => {
    try {
      const auctionsData = await apiRequest('/auctions');
      
      // Get gift info and max bids for each auction
      const auctionsWithDetails = await Promise.all(
        auctionsData.map(async (auction) => {
          let giftInfo = {};
          try {
            giftInfo = await apiRequest(`/gifts/${auction.giftId}`);
          } catch (error) {
            // Silent fail for gift info - not critical
            console.warn('Error loading gift:', error);
          }

          let maxBid = 0;
          try {
            const bids = await apiRequest(`/auctions/${auction.id}/bids`);
            if (bids.length > 0) {
              maxBid = Math.max(...bids.map(b => b.amount));
            }
          } catch (error) {
            // Silent fail for bids - not critical
            console.warn('Error loading bids:', error);
          }

          return { ...auction, giftInfo, maxBid };
        })
      );

      setAuctions(auctionsWithDetails);
    } catch (error) {
      console.error('Error loading auctions:', error);
      showToast(`Failed to load auctions: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuctions();

    // Listen for refresh events from WebSocket
    const handleRefresh = () => {
      loadAuctions();
    };
    window.addEventListener('refresh-auctions', handleRefresh);

    return () => {
      window.removeEventListener('refresh-auctions', handleRefresh);
    };
  }, []);

  if (loading) {
    return <div className="loading">Loading auctions...</div>;
  }

  return (
    <div className="page active">
      <div className="page-header">
        <h2>Active Auctions</h2>
        <div>
          <button className="btn-secondary" onClick={() => setShowGiftModal(true)}>
            New Gift
          </button>
          <button className="btn-secondary" onClick={() => setShowAuctionModal(true)}>
            New Auction
          </button>
          <button className="btn-primary" onClick={loadAuctions}>
            Refresh
          </button>
        </div>
      </div>

      {auctions.length === 0 ? (
        <div className="loading">No auctions found. Create one using the buttons above.</div>
      ) : (
        <div className="auctions-grid">
          {auctions.map((auction) => {
            const statusClass = auction.status.toLowerCase();
            const roundInfo =
              auction.status === 'RUNNING'
                ? `Round ${auction.currentRound + 1}/${auction.totalRounds}`
                : auction.status;

            return (
              <div
                key={auction.id}
                className="auction-card"
                onClick={() => onAuctionClick(auction.id)}
              >
                {auction.giftInfo.imageUrl ? (
                  <img
                    src={auction.giftInfo.imageUrl}
                    alt={auction.giftInfo.title}
                    className="auction-card-image"
                    onError={(e) => {
                      e.target.parentElement.innerHTML = '<div class="auction-card-image">🎁</div>';
                    }}
                  />
                ) : (
                  <div className="auction-card-image">🎁</div>
                )}
                <div className="auction-card-content">
                  <h3>{auction.giftInfo.title || 'Auction'}</h3>
                  <span className={`status ${statusClass}`}>{auction.status}</span>
                  <div className="info">
                    <strong>Round:</strong> {roundInfo}
                  </div>
                  <div className="info">
                    <strong>Total Gifts:</strong> {auction.totalGifts}
                  </div>
                  <div className="info">
                    <strong>Min Bid:</strong> {auction.minBid}
                  </div>
                  {auction.maxBid > 0 && (
                    <div className="max-bid" style={{
                      marginTop: '12px',
                      padding: '12px',
                      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(129, 140, 248, 0.1))',
                      borderRadius: '10px',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                    }}>
                      <div className="max-bid-label">Current Max Bid</div>
                      <div className="max-bid-value" style={{ fontSize: '22px' }}>{auction.maxBid.toFixed(2)}</div>
                    </div>
                  )}
                {auction.status === 'RUNNING' && (
                  <div style={{
                    marginTop: '12px',
                    padding: '8px 12px',
                    background: 'rgba(16, 185, 129, 0.1)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'var(--success)',
                    fontWeight: '600',
                    textAlign: 'center',
                  }}>
                    🔴 LIVE
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showGiftModal && (
        <GiftModal
          onClose={() => setShowGiftModal(false)}
          onCreated={() => {
            setShowGiftModal(false);
            loadAuctions();
          }}
        />
      )}

      {showAuctionModal && (
        <AuctionModal
          onClose={() => setShowAuctionModal(false)}
          onCreated={() => {
            setShowAuctionModal(false);
            loadAuctions();
          }}
        />
      )}
    </div>
  );
};

export default AuctionsPage;

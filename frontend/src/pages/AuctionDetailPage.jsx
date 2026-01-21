import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../api/client';
import RoundsHistory from '../components/RoundsHistory';
import { showToast } from '../components/Toast';
import CircularProgress from '../components/CircularProgress';

const AuctionDetailPage = ({ auctionId, currentUserId, onBack }) => {
  const [dashboardData, setDashboardData] = useState(null);
  const [giftInfo, setGiftInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [bidResult, setBidResult] = useState(null);
  const [timeUntilRoundEnd, setTimeUntilRoundEnd] = useState(0);
  const [totalTimeRemaining, setTotalTimeRemaining] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (!auctionId) {
      setLoading(false);
      return;
    }

    try {
      // Use new optimized dashboard endpoint
      const url = `/auctions/${auctionId}/dashboard${currentUserId ? `?userId=${currentUserId}` : ''}`;
      const data = await apiRequest(url);
      setDashboardData(data);

      // Get gift info
      try {
        if (data.auction.giftId) {
          const gift = await apiRequest(`/gifts/${data.auction.giftId}`);
          setGiftInfo(gift || {});
        }
      } catch (error) {
        console.error('Error loading gift:', error);
        setGiftInfo({});
      }

      // Set initial bid amount
      if (data.auction.minBid) {
        const maxBid = data.topBids && data.topBids.length > 0 
          ? Math.max(...data.topBids.map(b => b.amount))
          : 0;
        const minBidToPlace = maxBid > 0 
          ? Math.max(data.auction.minBid, maxBid + 1) 
          : data.auction.minBid;
        setBidAmount(minBidToPlace.toFixed(2));
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      showToast(`Failed to load auction: ${error.message}`, 'error');
      setDashboardData(null);
      setGiftInfo({});
    } finally {
      setLoading(false);
    }
  }, [auctionId, currentUserId]);

  useEffect(() => {
    loadDashboard();

    // Page Visibility API: Optimize polling based on tab visibility
    // When tab is hidden or browser minimized: stop polling or increase interval significantly
    // When tab is visible: resume normal polling
    let refreshInterval = null;
    
    const ACTIVE_INTERVAL = 1000; // 1 second when tab is active (more reactive UI)
    const INACTIVE_INTERVAL = 30000; // 30 seconds when tab is hidden (or disable completely)
    
    const startPolling = (interval) => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      refreshInterval = setInterval(loadDashboard, interval);
    };

    const stopPolling = () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        // Tab is hidden or browser minimized - STOP polling completely
        stopPolling();
      } else {
        // Tab is visible again - resume normal polling
        loadDashboard(); // Immediate refresh when tab becomes visible
        startPolling(ACTIVE_INTERVAL);
      }
    };

    // Also handle window blur/focus events (for browser minimization)
    const handleWindowBlur = () => {
      // Browser window lost focus (minimized or switched to another app)
      stopPolling();
    };

    const handleWindowFocus = () => {
      // Browser window regained focus
      if (!document.hidden && document.visibilityState !== 'hidden') {
        loadDashboard(); // Immediate refresh
        startPolling(ACTIVE_INTERVAL);
      }
    };

    // Start with active interval (only if tab is visible)
    if (!document.hidden && document.visibilityState !== 'hidden') {
      startPolling(ACTIVE_INTERVAL);
    }

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for window blur/focus (for browser minimization)
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // Listen for refresh events from WebSocket (always active, regardless of tab visibility)
    const handleRefresh = () => {
      // Only refresh if tab is visible (to avoid unnecessary requests)
      if (!document.hidden && document.visibilityState !== 'hidden') {
        loadDashboard();
      }
    };

    const handleTopUpdate = (event) => {
      const data = event.detail;
      if (!data || data.auctionId !== auctionId) return;
      if (!data.topPositions || !Array.isArray(data.topPositions)) return;

      // Live-update only topBids for this auction to make UI more reactive
      // Limit to top 3 (backend sends top-10 for significance check, but UI shows only 3)
      setDashboardData((prev) => {
        if (!prev) return prev;
        const mappedTop = data.topPositions
          .slice(0, 3) // Only take top 3 for display
          .map((tp) => ({
            position: tp.position,
            userId: tp.userId,
            username: tp.username || 'Unknown',
            amount: tp.amount,
            createdAt: tp.createdAt || prev.currentRound?.startedAt || new Date().toISOString(),
            roundIndex:
              typeof tp.roundIndex === 'number'
                ? tp.roundIndex
                : prev.currentRound?.roundIndex ?? prev.auction?.currentRound ?? 0,
          }));

        return {
          ...prev,
          topBids: mappedTop,
        };
      });
    };

    window.addEventListener('refresh-auction', handleRefresh);
    window.addEventListener('auction-top-update', handleTopUpdate);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('refresh-auction', handleRefresh);
      window.removeEventListener('auction-top-update', handleTopUpdate);
    };
  }, [loadDashboard, auctionId]);

  // Update timers (only when tab is visible)
  useEffect(() => {
    if (!dashboardData?.currentRound) {
      setTimeUntilRoundEnd(0);
      setTotalTimeRemaining(0);
      return;
    }

    let timerInterval = null;

    const updateTimers = () => {
      // Only update timers if tab is visible (save resources when hidden)
      if (document.hidden || document.visibilityState === 'hidden') {
        return;
      }

      const now = Date.now();
      const endsAt = new Date(dashboardData.currentRound.endsAt).getTime();
      const roundRemaining = Math.max(0, endsAt - now);
      setTimeUntilRoundEnd(roundRemaining);
      setTotalTimeRemaining(dashboardData.currentRound.totalTimeRemainingMs || 0);
    };

    const stopTimers = () => {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    };

    const startTimers = () => {
      stopTimers();
      if (!document.hidden && document.visibilityState !== 'hidden') {
        updateTimers(); // Immediate update
        timerInterval = setInterval(updateTimers, 1000);
      }
    };

    // Pause timers when tab is hidden or browser minimized, resume when visible
    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        stopTimers();
      } else {
        startTimers(); // Tab became visible - start timers
      }
    };

    const handleWindowBlur = () => {
      stopTimers();
    };

    const handleWindowFocus = () => {
      if (!document.hidden && document.visibilityState !== 'hidden') {
        startTimers();
      }
    };

    // Start timers if tab is visible
    startTimers();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      stopTimers();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [dashboardData?.currentRound]);

  const formatTime = (ms) => {
    if (ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const handleStartAuction = async () => {
    try {
      await apiRequest(`/auctions/${auctionId}/start`, { method: 'POST' });
      showToast('Auction started successfully!', 'success');
      loadDashboard();
    } catch (error) {
      showToast(`Error starting auction: ${error.message}`, 'error');
    }
  };

  const handlePlaceBid = async () => {
    if (!currentUserId) {
      setBidResult({ type: 'error', message: 'Please select a user first' });
      return;
    }

    const amount = parseFloat(bidAmount);
    if (!amount || amount <= 0) {
      setBidResult({ type: 'error', message: 'Please enter a valid bid amount' });
      return;
    }

    setBidResult({ type: 'loading', message: 'Placing bid...' });

    try {
      await apiRequest(`/auctions/${auctionId}/bids`, {
        method: 'POST',
        data: {
          userId: currentUserId,
          amount,
        },
      });

      setBidResult({ type: 'success', message: 'Bid placed successfully!' });
      showToast('Bid placed successfully!', 'success');
      loadDashboard();
      setTimeout(() => setBidResult(null), 3000);
    } catch (error) {
      const errorMessage = error.message || 'Failed to place bid';
      setBidResult({ type: 'error', message: errorMessage });
      showToast(errorMessage, 'error');
    }
  };

  if (loading) {
    return (
      <div className="page active">
        <div className="loading">Loading auction details...</div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="page active">
        <div className="error">Auction not found</div>
      </div>
    );
  }

  const { auction, currentRound, gifts, topBids, userPosition } = dashboardData;

  return (
    <div className="page active">
      <div className="page-header">
        <button className="btn-secondary" onClick={onBack}>
          ← Back to Auctions
        </button>
        <button className="btn-primary" onClick={loadDashboard}>
          Refresh
        </button>
      </div>

      <div className="auction-detail" style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Gift Image & Title */}
        <div style={{
          width: '100%',
          maxWidth: '400px',
          height: '300px',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '24px',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {giftInfo.imageUrl ? (
            <img
              src={giftInfo.imageUrl}
              alt={giftInfo.title || 'Gift'}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No image</div>
          )}
        </div>
        <h2>{giftInfo.title || 'Auction'}</h2>
        {giftInfo.description && (
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
            {giftInfo.description}
          </p>
        )}
        <span className={`status ${auction.status.toLowerCase()}`}>{auction.status}</span>

        {/* Auction Info Table (Vertical Layout) */}
        <div className="detail-section" style={{ marginTop: '32px' }}>
          <h3>Auction Information</h3>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-card)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
            }}>
              <strong>Time Started:</strong> {currentRound?.startedAt ? formatDateTime(currentRound.startedAt) : 'N/A'}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
            }}>
              <strong>Time Ending:</strong> {currentRound?.endsAt ? formatDateTime(currentRound.endsAt) : 'N/A'}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
            }}>
              <strong>Current Round:</strong> {(auction.currentRound ?? 0) + 1} / {auction.totalRounds ?? 0}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
            }}>
              <strong>Total Gifts:</strong> {gifts?.totalGifts ?? 0}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
            }}>
              <strong>Already Awarded:</strong> {gifts?.alreadyAwarded ?? 0}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              color: 'var(--accent-secondary)',
              fontWeight: '600',
            }}>
              <strong>Remaining Gifts:</strong> {gifts?.remainingGifts ?? 0}
            </div>
            <div className="info" style={{
              padding: '16px 20px',
              color: 'var(--success)',
              fontWeight: '600',
            }}>
              <strong>Gifts Available This Round:</strong> {gifts?.giftsPerRound ?? 0}
              <div style={{ fontSize: '0.85em', opacity: 0.8, marginTop: '4px', fontWeight: '400' }}>
                (max winners if enough bids)
              </div>
            </div>
          </div>
        </div>

        {/* Top 3 Bids */}
        <div className="detail-section" style={{ marginTop: '24px' }}>
          <h3>Top 3 Participants</h3>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'var(--bg-card)',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
          }}>
            {topBids && topBids.length > 0 ? (
              topBids.map((bid, index) => {
                // Проверяем, является ли ставка из предыдущего раунда (carry-over)
                const isCarryOver = bid.roundIndex !== undefined && 
                                   auction.currentRound !== undefined &&
                                   bid.roundIndex < auction.currentRound;
                
                return (
                  <div
                    key={bid.userId}
                    className={`bid-item-enhanced ${index === 0 ? 'top-bid' : ''}`}
                    style={{
                      padding: '16px',
                      opacity: isCarryOver ? 0.85 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: index === 0
                          ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                          : 'var(--bg-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        fontSize: '18px',
                        color: 'white',
                        flexShrink: 0,
                      }}>
                        {index + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <div style={{ fontWeight: '600', fontSize: '16px' }}>
                            {bid.username}
                          </div>
                          {isCarryOver && (
                            <span className="badge" style={{ 
                              fontSize: '9px',
                              background: 'rgba(245, 158, 11, 0.2)',
                              color: 'var(--warning)',
                            }}>
                              FROM ROUND {bid.roundIndex + 1}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Bid placed {new Date(bid.createdAt).toLocaleString()}
                          {bid.roundIndex !== undefined && (
                            <span style={{ marginLeft: '8px' }}>
                              • Round {bid.roundIndex + 1}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent-secondary)', marginBottom: '4px' }}>
                        {bid.amount.toFixed(2)}
                      </div>
                      {index === 0 && (
                        <span className="badge badge-success" style={{ fontSize: '10px' }}>
                          LEADING
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>
                No bids yet
              </p>
            )}
          </div>
        </div>

        {/* User Position */}
        {currentUserId && userPosition && userPosition.position !== null && (
          <div className="detail-section" style={{ marginTop: '24px' }}>
            <h3>Your Position</h3>
            <div style={{
              background: userPosition.canWin ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              padding: '20px',
              borderRadius: '12px',
              border: `2px solid ${userPosition.canWin ? 'var(--success)' : 'var(--error)'}`,
            }}>
              <div style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
                Position: #{userPosition.position}
              </div>
              <div style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Your Bid: {userPosition.amount?.toFixed(2) || '0.00'}
              </div>
              {/* Показываем информацию о carry-over ставке */}
              {(() => {
                // Находим ставку пользователя в топ-списке для проверки roundIndex
                const userBidInTop = topBids?.find(b => b.userId === currentUserId);
                const isCarryOver = userBidInTop && 
                                   userBidInTop.roundIndex !== undefined && 
                                   auction.currentRound !== undefined &&
                                   userBidInTop.roundIndex < auction.currentRound;
                
                if (isCarryOver) {
                  return (
                    <div style={{ 
                      fontSize: '13px', 
                      color: 'var(--warning)', 
                      marginBottom: '12px',
                      padding: '8px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      borderRadius: '6px',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                    }}>
                      ⚠ This bid is from Round {userBidInTop.roundIndex + 1} (carried over to Round {auction.currentRound + 1})
                    </div>
                  );
                }
                return null;
              })()}
              {userPosition.canWin ? (
                <div style={{ color: 'var(--success)', fontWeight: '600', fontSize: '16px' }}>
                  ✓ You can win! (within top {gifts?.giftsPerRound ?? 0} winners)
                </div>
              ) : (
                <div style={{ color: 'var(--error)', fontWeight: '600', fontSize: '16px' }}>
                  ✗ You're outbid! (need to be in top {gifts?.giftsPerRound ?? 0} winners)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timing Info with Circular Progress */}
        {currentRound && (
          <div className="detail-section" style={{ marginTop: '24px' }}>
            <h3>Time Remaining</h3>
            <div style={{
              display: 'flex',
              gap: '32px',
              flexWrap: 'wrap',
              alignItems: 'center',
              background: 'var(--bg-card)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <CircularProgress
                  progress={
                    (() => {
                      if (!currentRound?.startedAt || !currentRound?.endsAt) {
                        return 0;
                      }
                      const now = Date.now();
                      const startedAt = new Date(currentRound.startedAt).getTime();
                      const endsAt = new Date(currentRound.endsAt).getTime();
                      const totalDuration = endsAt - startedAt;
                      if (totalDuration <= 0) return 100;
                      const elapsed = now - startedAt;
                      return Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
                    })()
                  }
                  size={100}
                  color="var(--warning)"
                />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Round Ends In</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--warning)' }}>
                    {formatTime(timeUntilRoundEnd)}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="stat-card">
                  <div className="stat-card-label">Minimum Bid</div>
                  <div className="stat-card-value" style={{ fontSize: '24px' }}>
                    {auction.minBid?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Total Time Remaining</div>
                  <div className="stat-card-value" style={{ fontSize: '20px', color: 'var(--accent-secondary)' }}>
                    {formatTime(totalTimeRemaining)}
                  </div>
                </div>
                {currentRound?.startedAt && currentRound?.endsAt && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Round Progress
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${(() => {
                            const startedAt = new Date(currentRound.startedAt).getTime();
                            const endsAt = new Date(currentRound.endsAt).getTime();
                            const total = endsAt - startedAt;
                            if (total <= 0) return 100;
                            const elapsed = Date.now() - startedAt;
                            return Math.max(0, Math.min(100, (elapsed / total) * 100));
                          })()}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Start Auction Button */}
        {auction.status === 'CREATED' && (
          <div className="detail-section" style={{ marginTop: '24px' }}>
            <button className="btn-primary" onClick={handleStartAuction} style={{ width: '100%' }}>
              Start Auction
            </button>
          </div>
        )}

        {/* Place Bid Form */}
        {auction.status === 'RUNNING' && currentUserId && (
          <div className="detail-section" style={{ marginTop: '24px' }}>
            <h3>Place Bid</h3>
            {topBids && topBids.length > 0 && (
              <div style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
                Current highest bid: <strong style={{ color: 'var(--accent-secondary)' }}>
                  {topBids[0].amount.toFixed(2)}
                </strong>
              </div>
            )}
            <div className="bid-form">
              <div className="form-group">
                <label>Bid Amount</label>
                <input
                  type="number"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  min={auction.minBid}
                  step="10"
                />
              </div>
              <button className="btn-primary" onClick={handlePlaceBid}>
                Place Bid
              </button>
            </div>
            {bidResult && (
              <div className={bidResult.type} style={{ marginTop: '12px' }}>
                {bidResult.message}
              </div>
            )}
          </div>
        )}

        {/* Rounds History */}
        <RoundsHistory auctionId={auctionId} currentRound={auction.currentRound} />
      </div>
    </div>
  );
};

export default AuctionDetailPage;

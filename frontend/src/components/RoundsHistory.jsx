import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from './Toast';

const RoundsHistory = ({ auctionId, currentRound }) => {
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRounds();
  }, [auctionId]);

  const loadRounds = async () => {
    if (!auctionId) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const roundsData = await apiRequest(`/auctions/${auctionId}/rounds`);
      setRounds(roundsData);
    } catch (error) {
      console.error('Error loading rounds:', error);
      setError(error.message);
      showToast(`Failed to load rounds: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="detail-section">
        <h3>Rounds History</h3>
        <div className="loading">Loading rounds...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="detail-section">
        <h3>Rounds History</h3>
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--error)' }}>
          <div style={{ marginBottom: '8px' }}>⚠️ Error loading rounds</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{error}</div>
          <button className="btn-secondary" onClick={loadRounds} style={{ marginTop: '12px' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (rounds.length === 0) {
    return (
      <div className="detail-section">
        <h3>Rounds History</h3>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>
          No rounds yet. Start the auction to begin rounds.
        </p>
      </div>
    );
  }

  return (
    <div className="detail-section">
      <h3>Rounds History</h3>
      <div className="round-timeline">
        {rounds.map((round, index) => {
          const isActive = round.roundIndex === currentRound && !round.closed;
          const isClosed = round.closed;
          
          return (
            <div
              key={round.id}
              className={`round-item-timeline ${isClosed ? 'closed' : ''} ${isActive ? 'active' : ''}`}
            >
              <div
                style={{
                  background: isActive
                    ? 'rgba(99, 102, 241, 0.1)'
                    : isClosed
                    ? 'rgba(16, 185, 129, 0.05)'
                    : 'rgba(30, 41, 59, 0.6)',
                  border: `1px solid ${
                    isActive
                      ? 'var(--accent-primary)'
                      : isClosed
                      ? 'var(--success)'
                      : 'rgba(255, 255, 255, 0.1)'
                  }`,
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
                      Round {round.roundIndex + 1}
                    </h4>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatDateTime(round.startedAt)} - {formatDateTime(round.endsAt)}
                    </div>
                  </div>
                  <div>
                    {isActive && (
                      <span className="badge badge-primary">Active</span>
                    )}
                    {isClosed && (
                      <span className="badge badge-success">Closed</span>
                    )}
                    {!isActive && !isClosed && (
                      <span className="badge" style={{ background: 'rgba(107, 114, 128, 0.2)', color: '#9ca3af' }}>
                        Pending
                      </span>
                    )}
                  </div>
                </div>

                {isClosed && round.winners && round.winners.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                      Winners ({round.winners.length}):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {round.winners.map((winner, winnerIndex) => {
                        const isCarryOver = winner.placedInRound != null && winner.placedInRound < round.roundIndex;
                        return (
                          <div
                            key={winner.userId}
                            style={{
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              borderRadius: '8px',
                              padding: '12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: '600', fontSize: '14px' }}>
                                #{winnerIndex + 1} - {winner.username}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                Won at {formatDateTime(winner.wonAt)}
                              </div>
                              {isCarryOver && (
                                <div style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '4px' }}>
                                  from Round {winner.placedInRound + 1} (carried over)
                                </div>
                              )}
                            </div>
                            <div style={{ fontSize: '18px', fontWeight: '700', color: 'var(--success)' }}>
                              {winner.bidAmount.toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isClosed && (!round.winners || round.winners.length === 0) && (
                  <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '14px' }}>
                    No winners in this round
                  </div>
                )}

                {isActive && (
                  <div style={{ marginTop: '12px', color: 'var(--accent-secondary)', fontSize: '14px', fontWeight: '500' }}>
                    Round in progress...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoundsHistory;

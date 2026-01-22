import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from './ui/Toast';
import Card from './ui/Card';
import Badge from './ui/Badge';
import Loading from './ui/Loading';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';

/**
 * RoundsHistory Component
 * 
 * Компонент для отображения истории раундов аукциона с улучшенным дизайном
 */
const RoundsHistory = ({ auctionId, currentRound }) => {
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Listen for refresh events from WebSocket
  useEffect(() => {
    loadRounds();

    const handleRefresh = (event) => {
      const eventAuctionId = event?.detail?.auctionId;
      if (!eventAuctionId || eventAuctionId === auctionId) {
        const forceRefresh = event?.detail?.force === true;
        if (forceRefresh) {
          setTimeout(() => {
            loadRounds();
          }, 200);
        } else {
          loadRounds();
        }
      }
    };

    window.addEventListener('refresh-rounds', handleRefresh);
    window.addEventListener('refresh-auction', handleRefresh);

    return () => {
      window.removeEventListener('refresh-rounds', handleRefresh);
      window.removeEventListener('refresh-auction', handleRefresh);
    };
  }, [auctionId]);

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  // Loading State
  if (loading) {
    return (
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Rounds History</h2>}>
        <div className="flex items-center justify-center py-8">
          <Loading.Spinner size="lg" />
        </div>
      </Card>
    );
  }

  // Error State
  if (error) {
    return (
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Rounds History</h2>}>
        <div className="text-center py-8 space-y-4">
          <div className="text-status-error text-4xl">⚠️</div>
          <div>
            <p className="text-text-primary font-semibold mb-2">Error loading rounds</p>
            <p className="text-text-secondary text-sm">{error}</p>
          </div>
          <Button variant="secondary" onClick={loadRounds}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  // Empty State
  if (rounds.length === 0) {
    return (
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Rounds History</h2>}>
        <div className="text-center py-8">
          <p className="text-text-secondary">No rounds yet. Start the auction to begin rounds.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Rounds History</h2>}>
      <div className="space-y-4">
        {rounds.map((round, index) => {
          const isActive = round.roundIndex === currentRound && !round.closed;
          const isClosed = round.closed;
          
          return (
            <div
              key={round.id}
              className={`p-5 rounded-lg border transition-all duration-fast ${
                isActive
                  ? 'bg-accent-primary/10 border-accent-primary/30'
                  : isClosed
                  ? 'bg-status-success/5 border-status-success/20'
                  : 'bg-bg-card border-border'
              }`}
            >
              {/* Round Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-text-primary">
                      Round {round.roundIndex + 1}
                    </h3>
                    {isActive && (
                      <Tooltip content="This round is currently active">
                        <Badge variant="success" size="sm">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 bg-status-success rounded-full animate-pulse"></span>
                            Active
                          </span>
                        </Badge>
                      </Tooltip>
                    )}
                    {isClosed && (
                      <Tooltip content="This round has been closed">
                        <Badge variant="success" size="sm">Closed</Badge>
                      </Tooltip>
                    )}
                    {!isActive && !isClosed && (
                      <Tooltip content="This round is pending">
                        <Badge variant="default" size="sm">Pending</Badge>
                      </Tooltip>
                    )}
                  </div>
                  <div className="text-sm text-text-muted">
                    <Tooltip content={`Started: ${formatDateTime(round.startedAt)}`}>
                      <span>{formatDateTime(round.startedAt)}</span>
                    </Tooltip>
                    {' - '}
                    <Tooltip content={`Ends: ${formatDateTime(round.endsAt)}`}>
                      <span>{formatDateTime(round.endsAt)}</span>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {/* Winners */}
              {isClosed && round.winners && round.winners.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                      Winners ({round.winners.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {round.winners.map((winner, winnerIndex) => {
                      const isCarryOver = winner.placedInRound != null && winner.placedInRound < round.roundIndex;
                      return (
                        <div
                          key={winner.userId}
                          className="flex items-center justify-between p-3 bg-status-success/10 border border-status-success/30 rounded-lg"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-text-primary">
                                #{winnerIndex + 1} - {winner.username}
                              </span>
                              {isCarryOver && (
                                <Tooltip content={`Bid was placed in Round ${winner.placedInRound + 1} and carried over`}>
                                  <Badge variant="warning" size="sm">
                                    Round {winner.placedInRound + 1}
                                  </Badge>
                                </Tooltip>
                              )}
                            </div>
                            <div className="text-xs text-text-muted">
                              <Tooltip content={formatDateTime(winner.wonAt)}>
                                Won at {formatDateTime(winner.wonAt)}
                              </Tooltip>
                            </div>
                          </div>
                          <div className="text-lg font-bold text-status-success ml-4">
                            {winner.bidAmount.toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* No Winners */}
              {isClosed && (!round.winners || round.winners.length === 0) && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-text-muted text-sm text-center py-2">No winners in this round</p>
                </div>
              )}

              {/* Active Round Indicator */}
              {isActive && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-accent-primary text-sm font-medium text-center">
                    Round in progress...
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default RoundsHistory;

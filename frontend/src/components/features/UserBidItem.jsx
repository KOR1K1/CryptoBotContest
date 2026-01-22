import { useNavigate } from 'react-router-dom';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

/**
 * UserBidItem Component
 * 
 * Компонент для отображения ставки пользователя в списке "My Bids"
 * 
 * @param {object} bid - Данные ставки
 */
const UserBidItem = ({ bid }) => {
  const navigate = useNavigate();

  const statusVariant = {
    'WON': 'success',
    'ACTIVE': 'info',
    'REFUNDED': 'default',
    'LOST': 'error',
  }[bid.status] || 'default';

  const statusIcon = {
    'WON': '✓',
    'ACTIVE': 'A',
    'REFUNDED': 'R',
    'LOST': '✗',
  }[bid.status] || '?';

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const handleClick = () => {
    if (bid.auctionId) {
      navigate(`/auctions/${bid.auctionId}`);
    }
  };

  return (
    <Card
      variant="elevated"
      hover={!!bid.auctionId}
      onClick={bid.auctionId ? handleClick : undefined}
      className="transition-all duration-fast"
    >
      <div className="flex items-center gap-4">
        {/* Status Icon */}
        <div
          className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg flex-shrink-0 ${
            bid.status === 'WON'
              ? 'bg-gradient-to-br from-status-success to-status-success/80 text-white'
              : bid.status === 'ACTIVE'
              ? 'bg-gradient-to-br from-accent-primary to-accent-secondary text-white'
              : 'bg-bg-tertiary text-text-primary'
          }`}
        >
          {statusIcon}
        </div>

        {/* Bid Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl font-bold text-text-primary">
              {bid.amount?.toFixed(2) || '0.00'}
            </span>
            <Tooltip content={`Status: ${bid.status}`}>
              <Badge variant={statusVariant} size="sm">
                {bid.status}
              </Badge>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            {bid.auctionId && (
              <Tooltip content={`Click to view auction ${bid.auctionId}`}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/auctions/${bid.auctionId}`);
                  }}
                  className="text-accent-primary hover:text-accent-hover transition-colors duration-fast"
                >
                  Auction: {bid.auctionId.substring(0, 8)}...
                </button>
              </Tooltip>
            )}
            {bid.roundIndex !== undefined && (
              <>
                <span>•</span>
                <Tooltip content={`Bid placed in Round ${bid.roundIndex + 1}`}>
                  <span>Round {bid.roundIndex + 1}</span>
                </Tooltip>
              </>
            )}
            <span>•</span>
            <Tooltip content={formatDateTime(bid.createdAt)}>
              <span>{formatDate(bid.createdAt)}</span>
            </Tooltip>
          </div>
        </div>

        {/* Action Icon */}
        {bid.auctionId && (
          <div className="flex-shrink-0">
            <Tooltip content="View auction">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Tooltip>
          </div>
        )}
      </div>
    </Card>
  );
};

export default UserBidItem;

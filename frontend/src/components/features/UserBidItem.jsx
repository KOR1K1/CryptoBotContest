import { useNavigate } from 'react-router-dom';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

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
    if (!dateString) return 'Н/Д';
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'Н/Д';
    return new Date(dateString).toLocaleString('ru-RU');
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
            <Tooltip content={`Статус: ${bid.status === 'WON' ? 'Выиграно' : bid.status === 'ACTIVE' ? 'Активна' : bid.status === 'REFUNDED' ? 'Возвращено' : bid.status === 'LOST' ? 'Проиграно' : bid.status}`}>
              <Badge variant={statusVariant} size="sm">
                {bid.status === 'WON' ? 'Выиграно' :
                 bid.status === 'ACTIVE' ? 'Активна' :
                 bid.status === 'REFUNDED' ? 'Возвращено' :
                 bid.status === 'LOST' ? 'Проиграно' : bid.status}
              </Badge>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            {bid.auctionId && (
              <Tooltip content={`Нажмите, чтобы просмотреть аукцион ${bid.auctionId}`}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/auctions/${bid.auctionId}`);
                  }}
                  className="text-accent-primary hover:text-accent-hover transition-colors duration-fast"
                >
                  Аукцион: {bid.auctionId.substring(0, 8)}...
                </button>
              </Tooltip>
            )}
            {bid.roundIndex !== undefined && (
              <>
                <span>•</span>
                <Tooltip content={`Ставка размещена в раунде ${bid.roundIndex + 1}`}>
                  <span>Раунд {bid.roundIndex + 1}</span>
                </Tooltip>
              </>
            )}
            <span>•</span>
            <Tooltip content={formatDateTime(bid.createdAt)}>
              <span>{formatDate(bid.createdAt)}</span>
            </Tooltip>
          </div>
        </div>

        {bid.auctionId && (
          <div className="flex-shrink-0">
            <Tooltip content="Просмотреть аукцион">
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

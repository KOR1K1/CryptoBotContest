import { useNavigate } from 'react-router-dom';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

/**
 * AuctionCard Component
 * 
 * Карточка аукциона с информацией о подарке, статусе и ставках
 * 
 * @param {object} auction - Данные аукциона
 */
const AuctionCard = ({ auction }) => {
  const navigate = useNavigate();

  const statusVariant = {
    'CREATED': 'default',
    'RUNNING': 'success',
    'FINALIZING': 'warning',
    'COMPLETED': 'info',
  }[auction.status] || 'default';

  const roundInfo =
    auction.status === 'RUNNING'
      ? `Round ${auction.currentRound + 1}/${auction.totalRounds}`
      : auction.status;

  const handleClick = () => {
    navigate(`/auctions/${auction.id}`);
  };

  return (
    <Card
      variant="elevated"
      hover={true}
      onClick={handleClick}
      className="overflow-hidden"
    >
      {/* Image Section */}
      <div className="relative w-full h-48 bg-bg-secondary overflow-hidden">
        {auction.giftInfo?.imageUrl ? (
          <img
            src={auction.giftInfo.imageUrl}
            alt={auction.giftInfo.title || 'Auction gift'}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
              const placeholder = e.target.parentElement.querySelector('.image-placeholder');
              if (placeholder) placeholder.style.display = 'flex';
            }}
          />
        ) : null}
        <div className="image-placeholder hidden w-full h-full items-center justify-center text-text-muted">
          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>

        {/* Live Badge */}
        {auction.status === 'RUNNING' && (
          <div className="absolute top-3 right-3">
            <Badge variant="success" size="sm">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-status-success rounded-full animate-pulse"></span>
                LIVE
              </span>
            </Badge>
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          <Badge variant={statusVariant} size="sm">
            {auction.status}
          </Badge>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-5 space-y-4">
        {/* Title */}
        <div>
          <h3 className="text-xl font-semibold text-text-primary mb-1 line-clamp-2">
            {auction.giftInfo?.title || 'Auction'}
          </h3>
          {auction.giftInfo?.description && (
            <p className="text-sm text-text-muted line-clamp-2">
              {auction.giftInfo.description}
            </p>
          )}
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Tooltip content={`Current round: ${auction.currentRound + 1} of ${auction.totalRounds}`}>
            <div className="flex flex-col">
              <span className="text-text-muted text-xs uppercase tracking-wide">Round</span>
              <span className="text-text-primary font-medium">{roundInfo}</span>
            </div>
          </Tooltip>

          <Tooltip content={`Total gifts available in this auction`}>
            <div className="flex flex-col">
              <span className="text-text-muted text-xs uppercase tracking-wide">Gifts</span>
              <span className="text-text-primary font-medium">{auction.totalGifts}</span>
            </div>
          </Tooltip>
        </div>

        {/* Min Bid */}
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-sm">Min Bid</span>
            <span className="text-text-primary font-semibold">{auction.minBid.toFixed(2)}</span>
          </div>
        </div>

        {/* Max Bid (if exists) */}
        {auction.maxBid > 0 && (
          <div className="p-4 bg-accent-primary/10 border border-accent-primary/30 rounded-lg">
            <Tooltip content="Current highest bid in this auction">
              <div className="flex flex-col">
                <span className="text-text-muted text-xs uppercase tracking-wide mb-1">Current Max Bid</span>
                <span className="text-accent-primary text-2xl font-bold">
                  {auction.maxBid.toFixed(2)}
                </span>
              </div>
            </Tooltip>
          </div>
        )}
      </div>
    </Card>
  );
};

export default AuctionCard;

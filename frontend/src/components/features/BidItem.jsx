import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

/**
 * BidItem Component
 * 
 * Компонент для отображения ставки в списке топ-участников
 * 
 * @param {object} bid - Данные ставки
 * @param {number} position - Позиция в рейтинге (1-based)
 * @param {number} currentRound - Текущий раунд аукциона
 * @param {boolean} isLeading - Является ли лидером
 */
const BidItem = ({ bid, position, currentRound, isLeading = false }) => {
  // Проверяем, является ли ставка из предыдущего раунда (carry-over)
  const isCarryOver = bid.roundIndex !== undefined && 
                     currentRound !== undefined &&
                     bid.roundIndex < currentRound;

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  return (
    <div
      className={`flex items-center justify-between p-4 rounded-lg border transition-all duration-fast ${
        isLeading
          ? 'bg-accent-primary/10 border-accent-primary/30'
          : 'bg-bg-card border-border hover:border-accent-primary/50'
      }`}
    >
      <div className="flex items-center gap-4 flex-1">
        {/* Position Badge */}
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${
            isLeading
              ? 'bg-gradient-to-br from-accent-primary to-accent-secondary text-white'
              : 'bg-bg-tertiary text-text-primary'
          }`}
        >
          {position}
        </div>

        {/* User Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-text-primary text-base truncate">
              {bid.username || 'Unknown'}
            </span>
            {isCarryOver && (
              <Tooltip content={`This bid was placed in Round ${bid.roundIndex + 1} and carried over to the current round`}>
                <Badge variant="warning" size="sm">
                  Round {bid.roundIndex + 1}
                </Badge>
              </Tooltip>
            )}
            {isLeading && (
              <Tooltip content="Current leading bid">
                <Badge variant="success" size="sm">
                  LEADING
                </Badge>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Tooltip content={formatDateTime(bid.createdAt)}>
              <span className="truncate">
                {new Date(bid.createdAt).toLocaleString()}
              </span>
            </Tooltip>
            {bid.roundIndex !== undefined && (
              <>
                <span>•</span>
                <Tooltip content={`Bid placed in Round ${bid.roundIndex + 1}`}>
                  <span>Round {bid.roundIndex + 1}</span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bid Amount */}
      <div className="text-right ml-4">
        <Tooltip content={`Bid amount: ${bid.amount.toFixed(2)}`}>
          <div className={`text-2xl font-bold ${isLeading ? 'text-accent-primary' : 'text-text-primary'}`}>
            {bid.amount.toFixed(2)}
          </div>
        </Tooltip>
      </div>
    </div>
  );
};

export default BidItem;

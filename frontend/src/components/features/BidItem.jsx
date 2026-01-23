import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

const BidItem = ({ bid, position, currentRound, isLeading = false }) => {
  const isCarryOver = bid.roundIndex !== undefined && 
                     currentRound !== undefined &&
                     bid.roundIndex < currentRound;

  const formatDateTime = (dateString) => {
    if (!dateString) return 'Н/Д';
    return new Date(dateString).toLocaleString('ru-RU');
  };

  return (
    <div
      className={`flex items-center justify-between p-3 sm:p-4 rounded-lg border transition-all duration-fast overflow-hidden ${
        isLeading
          ? 'bg-accent-primary/10 border-accent-primary/30'
          : 'bg-bg-card border-border hover:border-accent-primary/50'
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 overflow-hidden">
        <div
          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-base sm:text-lg flex-shrink-0 ${
            isLeading
              ? 'bg-gradient-to-br from-accent-primary to-accent-secondary text-white'
              : 'bg-bg-tertiary text-text-primary'
          }`}
        >
          {position}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1 sm:gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-text-primary text-sm sm:text-base truncate min-w-0">
              {bid.username || 'Unknown'}
            </span>
            {isCarryOver && (
              <Tooltip content={`Эта ставка была размещена в раунде ${bid.roundIndex + 1} и перенесена в текущий раунд`}>
                <Badge variant="warning" size="sm" className="flex-shrink-0">
                  Р{bid.roundIndex + 1}
                </Badge>
              </Tooltip>
            )}
            {isLeading && (
              <Tooltip content="Текущая лидирующая ставка">
                <Badge variant="success" size="sm" className="flex-shrink-0">
                  <span className="hidden sm:inline">ЛИДЕР</span>
                  <span className="sm:hidden">ТОП</span>
                </Badge>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2 text-xs text-text-muted flex-wrap">
            <Tooltip content={formatDateTime(bid.createdAt)}>
              <span className="truncate min-w-0">
                {new Date(bid.createdAt).toLocaleString('ru-RU')}
              </span>
            </Tooltip>
            {bid.roundIndex !== undefined && (
              <>
                <span className="flex-shrink-0">•</span>
                <Tooltip content={`Ставка размещена в раунде ${bid.roundIndex + 1}`}>
                  <span className="flex-shrink-0">Р{bid.roundIndex + 1}</span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-right ml-2 sm:ml-4 flex-shrink-0">
        <Tooltip content={`Сумма ставки: ${bid.amount.toFixed(2)}`}>
          <div className={`text-lg sm:text-2xl font-bold whitespace-nowrap ${isLeading ? 'text-accent-primary' : 'text-text-primary'}`}>
            {bid.amount.toFixed(2)}
          </div>
        </Tooltip>
      </div>
    </div>
  );
};

export default BidItem;

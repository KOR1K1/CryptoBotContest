import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

/**
 * TimerDisplay Component
 * 
 * Компонент для отображения таймеров аукциона
 * 
 * @param {number} timeUntilRoundEnd - Время до конца раунда в миллисекундах
 * @param {number} totalTimeRemaining - Общее оставшееся время в миллисекундах
 * @param {number} roundProgress - Прогресс раунда в процентах (0-100)
 * @param {number} minBid - Минимальная ставка
 */
const TimerDisplay = ({ 
  timeUntilRoundEnd, 
  totalTimeRemaining, 
  roundProgress = 0,
  minBid = 0 
}) => {
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

  const isUrgent = timeUntilRoundEnd < 60000; // Less than 1 minute

  return (
    <Card variant="elevated" className="p-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
        {/* Circular Progress Timer */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="44"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                className="text-bg-tertiary"
              />
              <circle
                cx="48"
                cy="48"
                r="44"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 44}`}
                strokeDashoffset={`${2 * Math.PI * 44 * (1 - roundProgress / 100)}`}
                className={isUrgent ? 'text-status-error' : 'text-status-warning'}
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className={`text-lg font-bold ${isUrgent ? 'text-status-error' : 'text-status-warning'}`}>
                  {formatTime(timeUntilRoundEnd)}
                </div>
                <div className="text-xs text-text-muted mt-1">Round Ends</div>
              </div>
            </div>
          </div>
          {isUrgent && (
            <Badge variant="error" size="sm">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-status-error rounded-full animate-pulse"></span>
                Urgent
              </span>
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full lg:w-auto">
          <Tooltip content="Minimum bid required to participate">
            <div className="p-4 bg-bg-secondary rounded-lg border border-border">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Minimum Bid</div>
              <div className="text-2xl font-bold text-text-primary">
                {minBid.toFixed(2)}
              </div>
            </div>
          </Tooltip>

          <Tooltip content="Total time remaining for the entire auction">
            <div className="p-4 bg-bg-secondary rounded-lg border border-border">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Total Remaining</div>
              <div className="text-xl font-bold text-accent-primary">
                {formatTime(totalTimeRemaining)}
              </div>
            </div>
          </Tooltip>
        </div>

        {/* Progress Bar */}
        <div className="w-full lg:w-auto lg:flex-1">
          <Tooltip content={`Round progress: ${Math.round(roundProgress)}%`}>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted uppercase tracking-wide">Round Progress</span>
                <span className="text-xs text-text-secondary">{Math.round(roundProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    isUrgent ? 'bg-status-error' : 'bg-status-warning'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, roundProgress))}%` }}
                />
              </div>
            </div>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
};

export default TimerDisplay;

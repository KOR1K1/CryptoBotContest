import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Tooltip from '../ui/Tooltip';

const GiftCard = ({ item }) => {
  const formatDate = (dateString) => {
    if (!dateString) return 'Н/Д';
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <Card variant="elevated" hover={false} className="overflow-hidden">
      <div className="relative w-full h-48 bg-bg-secondary overflow-hidden">
        {item.giftImageUrl ? (
          <img
            src={item.giftImageUrl}
            alt={item.giftTitle || 'Подарок'}
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>

        {/* Won Badge */}
        <div className="absolute top-3 right-3">
          <Tooltip content="Вы выиграли этот подарок на аукционе">
            <Badge variant="success" size="sm">
              ВЫИГРАНО
            </Badge>
          </Tooltip>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-text-primary mb-1 line-clamp-2">
            {item.giftTitle || 'Подарок'}
          </h3>
          {item.giftDescription && (
            <p className="text-sm text-text-secondary line-clamp-2">
              {item.giftDescription}
            </p>
          )}
        </div>

        {/* Won For Section */}
        <div className="p-4 bg-status-success/10 border border-status-success/30 rounded-lg">
          <Tooltip content="Сумма ставки, за которую вы выиграли этот подарок">
            <div className="flex flex-col">
              <span className="text-xs text-text-muted uppercase tracking-wide mb-1">Выиграно за</span>
              <span className="text-2xl font-bold text-status-success">
                {item.bidAmount?.toFixed(2) || '0.00'}
              </span>
            </div>
          </Tooltip>
        </div>

        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <Tooltip content={`Раунд ${item.roundIndex + 1} аукциона`}>
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Раунд {item.roundIndex + 1}</span>
              </div>
            </Tooltip>
            <Tooltip content={`Выиграно ${formatDate(item.wonAt)}`}>
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{formatDate(item.wonAt)}</span>
              </div>
            </Tooltip>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default GiftCard;

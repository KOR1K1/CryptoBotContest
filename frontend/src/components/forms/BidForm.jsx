import { useState } from 'react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Tooltip from '../ui/Tooltip';

/**
 * BidForm Component
 * 
 * Форма для размещения ставки с валидацией
 * 
 * @param {function} onSubmit - Callback при отправке формы (amount)
 * @param {number} minBid - Минимальная ставка
 * @param {number} currentMaxBid - Текущая максимальная ставка (опционально)
 * @param {boolean} loading - Состояние загрузки
 * @param {string} error - Сообщение об ошибке
 * @param {string} success - Сообщение об успехе
 */
const BidForm = ({ 
  onSubmit, 
  minBid = 0, 
  currentMaxBid = null,
  loading = false, 
  error = null,
  success = null
}) => {
  const [bidAmount, setBidAmount] = useState('');
  const [validationError, setValidationError] = useState(null);

  // Вычисляем рекомендуемую ставку
  const recommendedBid = currentMaxBid 
    ? Math.max(minBid, currentMaxBid + 1)
    : minBid;

  // Валидация ставки
  const validateBid = (value) => {
    const amount = parseFloat(value);
    
    if (!value || value.trim().length === 0) {
      setValidationError('Bid amount is required');
      return false;
    }
    
    if (isNaN(amount) || amount <= 0) {
      setValidationError('Bid amount must be a positive number');
      return false;
    }
    
    if (amount < minBid) {
      setValidationError(`Bid must be at least ${minBid.toFixed(2)}`);
      return false;
    }
    
    if (currentMaxBid && amount <= currentMaxBid) {
      setValidationError(`Bid must be higher than current max bid (${currentMaxBid.toFixed(2)})`);
      return false;
    }
    
    setValidationError(null);
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validateBid(bidAmount)) {
      return;
    }

    const amount = parseFloat(bidAmount);
    if (onSubmit) {
      onSubmit(amount);
    }
  };

  const handleQuickBid = (multiplier = 1) => {
    const quickAmount = (recommendedBid * multiplier).toFixed(2);
    setBidAmount(quickAmount);
    setValidationError(null);
  };

  return (
    <Card variant="elevated" className="p-6">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Current Max Bid Info */}
        {currentMaxBid !== null && currentMaxBid > 0 && (
          <div className="p-4 bg-accent-primary/10 border border-accent-primary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-sm">Current Highest Bid</span>
              <span className="text-accent-primary text-xl font-bold">
                {currentMaxBid.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Bid Amount Input */}
        <div>
          <Tooltip content={`Minimum bid: ${minBid.toFixed(2)}. ${currentMaxBid ? `Current max: ${currentMaxBid.toFixed(2)}` : ''}`} position="top">
            <Input
              label="Bid Amount"
              type="number"
              value={bidAmount}
              onChange={(e) => {
                setBidAmount(e.target.value);
                if (validationError) {
                  validateBid(e.target.value);
                }
              }}
              onBlur={(e) => validateBid(e.target.value)}
              placeholder={recommendedBid.toFixed(2)}
              min={minBid}
              step="0.01"
              required
              disabled={loading}
              error={!!validationError}
              errorMessage={validationError}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              aria-label="Bid Amount"
              aria-required="true"
              aria-invalid={!!validationError}
            />
          </Tooltip>
        </div>

        {/* Quick Bid Buttons */}
        <div className="flex flex-wrap gap-2">
          <Tooltip content="Set bid to minimum required">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleQuickBid(1)}
              disabled={loading}
            >
              Min ({minBid.toFixed(2)})
            </Button>
          </Tooltip>
          {currentMaxBid && (
            <>
              <Tooltip content="Set bid to beat current max by 1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleQuickBid(1)}
                  disabled={loading}
                >
                  Beat Max
                </Button>
              </Tooltip>
              <Tooltip content="Set bid to 1.5x of current max">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleQuickBid(1.5)}
                  disabled={loading}
                >
                  +50%
                </Button>
              </Tooltip>
              <Tooltip content="Set bid to 2x of current max">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleQuickBid(2)}
                  disabled={loading}
                >
                  x2
                </Button>
              </Tooltip>
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-3 bg-status-success/10 border border-status-success/30 rounded-lg text-status-success text-sm">
            {success}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={loading || !!validationError}
          className="w-full"
        >
          {loading ? 'Placing Bid...' : 'Place Bid'}
        </Button>
      </form>
    </Card>
  );
};

export default BidForm;

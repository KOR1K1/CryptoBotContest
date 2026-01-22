import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from './ui/Toast';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';
import Loading from './ui/Loading';

/**
 * AuctionModal Component
 * 
 * Модальное окно для создания нового аукциона с валидацией и улучшенным дизайном
 * 
 * @param {boolean} isOpen - Открыто ли модальное окно
 * @param {function} onClose - Callback для закрытия
 * @param {function} onCreated - Callback после успешного создания
 */
const AuctionModal = ({ isOpen, onClose, onCreated }) => {
  const [giftId, setGiftId] = useState('');
  const [totalGifts, setTotalGifts] = useState('2');
  const [totalRounds, setTotalRounds] = useState('3');
  const [roundDuration, setRoundDuration] = useState('60');
  const [minBid, setMinBid] = useState('100');
  const [gifts, setGifts] = useState([]);
  const [loadingGifts, setLoadingGifts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  // Загрузка списка подарков
  useEffect(() => {
    if (isOpen) {
      loadGifts();
    }
  }, [isOpen]);

  const loadGifts = async () => {
    setLoadingGifts(true);
    try {
      const giftsData = await apiRequest('/gifts');
      setGifts(giftsData);
    } catch (error) {
      console.error('Error loading gifts:', error);
      showToast('Failed to load gifts', 'error');
    } finally {
      setLoadingGifts(false);
    }
  };

  // Сброс формы при закрытии
  const handleClose = () => {
    if (!loading) {
      setGiftId('');
      setTotalGifts('2');
      setTotalRounds('3');
      setRoundDuration('60');
      setMinBid('100');
      setError('');
      setValidationErrors({});
      onClose();
    }
  };

  // Валидация отдельного поля
  const validateField = (field, value) => {
    const errors = { ...validationErrors };
    
    switch (field) {
      case 'giftId':
        if (!value || value.trim() === '') {
          errors.giftId = 'Please select a gift';
        } else {
          delete errors.giftId;
        }
        break;
      
      case 'totalGifts':
        const gifts = parseInt(value);
        if (isNaN(gifts) || gifts < 1 || gifts > 1000) {
          errors.totalGifts = 'Total gifts must be between 1 and 1000';
        } else {
          delete errors.totalGifts;
        }
        break;
      
      case 'totalRounds':
        const rounds = parseInt(value);
        if (isNaN(rounds) || rounds < 1 || rounds > 20) {
          errors.totalRounds = 'Total rounds must be between 1 and 20';
        } else {
          delete errors.totalRounds;
        }
        break;
      
      case 'roundDuration':
        const duration = parseInt(value);
        if (isNaN(duration) || duration < 1) {
          errors.roundDuration = 'Round duration must be at least 1 second';
        } else {
          delete errors.roundDuration;
        }
        break;
      
      case 'minBid':
        const bid = parseFloat(value);
        if (isNaN(bid) || bid < 1) {
          errors.minBid = 'Minimum bid must be at least 1';
        } else {
          delete errors.minBid;
        }
        break;
    }
    
    setValidationErrors(errors);
    return !errors[field];
  };

  // Валидация всей формы
  const validateForm = () => {
    const fields = ['giftId', 'totalGifts', 'totalRounds', 'roundDuration', 'minBid'];
    const values = { giftId, totalGifts, totalRounds, roundDuration, minBid };
    
    let isValid = true;
    fields.forEach(field => {
      if (!validateField(field, values[field])) {
        isValid = false;
      }
    });
    
    return isValid && Object.keys(validationErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!validateForm()) {
      setError('Please fix validation errors before submitting');
      return;
    }

    setLoading(true);

    try {
      await apiRequest('/auctions', {
        method: 'POST',
        data: {
          giftId,
          totalGifts: parseInt(totalGifts),
          totalRounds: parseInt(totalRounds),
          roundDurationMs: parseInt(roundDuration) * 1000,
          minBid: parseFloat(minBid),
        },
      });

      showToast('Auction created successfully!', 'success');
      handleClose();
      if (onCreated) {
        onCreated();
      }
    } catch (err) {
      const errorMsg = err.message || 'Failed to create auction';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      title="Create New Auction"
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
    >
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Gift Selection */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Gift <span className="text-status-error">*</span>
          </label>
          {loadingGifts ? (
            <div className="flex items-center justify-center p-8">
              <Loading.Spinner />
            </div>
          ) : (
            <Tooltip content="Select a gift to auction">
              <select
                value={giftId}
                onChange={(e) => {
                  setGiftId(e.target.value);
                  setError('');
                  if (validationErrors.giftId) {
                    validateField('giftId', e.target.value);
                  }
                }}
                onBlur={(e) => validateField('giftId', e.target.value)}
                required
                disabled={loading || loadingGifts}
                className={`w-full px-4 py-2 bg-bg-secondary border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all duration-fast ${
                  validationErrors.giftId
                    ? 'border-status-error focus:ring-status-error'
                    : 'border-border'
                }`}
              >
                <option value="">Select a gift...</option>
                {gifts.map((gift) => (
                  <option key={gift.id} value={gift.id}>
                    {gift.title}
                  </option>
                ))}
              </select>
            </Tooltip>
          )}
          {validationErrors.giftId && (
            <p className="mt-1 text-sm text-status-error">{validationErrors.giftId}</p>
          )}
        </div>

        {/* Total Gifts and Total Rounds */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Tooltip content="Number of gifts to be distributed (1-1000)">
            <Input
              label="Total Gifts"
              type="number"
              value={totalGifts}
              onChange={(e) => {
                setTotalGifts(e.target.value);
                setError('');
                if (validationErrors.totalGifts) {
                  validateField('totalGifts', e.target.value);
                }
              }}
              onBlur={(e) => validateField('totalGifts', e.target.value)}
              min="1"
              max="1000"
              required
              disabled={loading}
              error={!!validationErrors.totalGifts}
              errorMessage={validationErrors.totalGifts}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              }
            />
          </Tooltip>

          <Tooltip content="Number of rounds in the auction (1-20)">
            <Input
              label="Total Rounds"
              type="number"
              value={totalRounds}
              onChange={(e) => {
                setTotalRounds(e.target.value);
                setError('');
                if (validationErrors.totalRounds) {
                  validateField('totalRounds', e.target.value);
                }
              }}
              onBlur={(e) => validateField('totalRounds', e.target.value)}
              min="1"
              max="20"
              required
              disabled={loading}
              error={!!validationErrors.totalRounds}
              errorMessage={validationErrors.totalRounds}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
          </Tooltip>
        </div>

        {/* Round Duration and Minimum Bid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Tooltip content="Duration of each round in seconds">
            <Input
              label="Round Duration (seconds)"
              type="number"
              value={roundDuration}
              onChange={(e) => {
                setRoundDuration(e.target.value);
                setError('');
                if (validationErrors.roundDuration) {
                  validateField('roundDuration', e.target.value);
                }
              }}
              onBlur={(e) => validateField('roundDuration', e.target.value)}
              min="1"
              required
              disabled={loading}
              error={!!validationErrors.roundDuration}
              errorMessage={validationErrors.roundDuration}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </Tooltip>

          <Tooltip content="Minimum bid amount required">
            <Input
              label="Minimum Bid"
              type="number"
              value={minBid}
              onChange={(e) => {
                setMinBid(e.target.value);
                setError('');
                if (validationErrors.minBid) {
                  validateField('minBid', e.target.value);
                }
              }}
              onBlur={(e) => validateField('minBid', e.target.value)}
              min="1"
              step="0.01"
              required
              disabled={loading}
              error={!!validationErrors.minBid}
              errorMessage={validationErrors.minBid}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </Tooltip>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={loading || Object.keys(validationErrors).length > 0 || loadingGifts}
          >
            {loading ? 'Creating...' : 'Create Auction'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default AuctionModal;

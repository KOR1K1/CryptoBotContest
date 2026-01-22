import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from './ui/Toast';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';
import Loading from './ui/Loading';

/**
 * AddGiftModal Component
 * 
 * Модальное окно для добавления подарка в инвентарь пользователя (для тестирования)
 * 
 * @param {boolean} isOpen - Открыто ли модальное окно
 * @param {function} onClose - Callback для закрытия
 * @param {function} onAdded - Callback после успешного добавления
 */
const AddGiftModal = ({ isOpen, onClose, onAdded }) => {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [giftId, setGiftId] = useState('');
  const [bidAmount, setBidAmount] = useState('100');
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
      setBidAmount('100');
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
      
      case 'bidAmount':
        const amount = parseFloat(value);
        if (isNaN(amount) || amount < 1) {
          errors.bidAmount = 'Bid amount must be at least 1';
        } else {
          delete errors.bidAmount;
        }
        break;
    }
    
    setValidationErrors(errors);
    return !errors[field];
  };

  // Валидация всей формы
  const validateForm = () => {
    if (!currentUserId) {
      setError('Please log in to add gifts to inventory');
      return false;
    }

    const fields = ['giftId', 'bidAmount'];
    const values = { giftId, bidAmount };
    
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
      return;
    }

    setLoading(true);

    try {
      await apiRequest(`/users/${currentUserId}/inventory/add`, {
        method: 'POST',
        data: {
          giftId,
          bidAmount: parseFloat(bidAmount) || 100,
        },
      });

      showToast('Gift added to inventory successfully!', 'success');
      handleClose();
      if (onAdded) {
        onAdded();
      }
    } catch (err) {
      const errorMsg = err.message || 'Failed to add gift';
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
      size="md"
      title="Add Gift to Inventory"
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
    >
      <div className="space-y-6">
        {/* Info Message */}
        <div className="p-3 bg-status-info/10 border border-status-info/30 rounded-lg text-status-info text-sm">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>This is a demo function to add gifts to inventory for testing purposes.</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
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
              <Tooltip content="Select a gift to add to your inventory">
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

          {/* Bid Amount Input */}
          <Tooltip content="Bid amount for display purposes">
            <Input
              label="Bid Amount (for display)"
              type="number"
              value={bidAmount}
              onChange={(e) => {
                setBidAmount(e.target.value);
                setError('');
                if (validationErrors.bidAmount) {
                  validateField('bidAmount', e.target.value);
                }
              }}
              onBlur={(e) => validateField('bidAmount', e.target.value)}
              min="1"
              step="0.01"
              required
              disabled={loading}
              error={!!validationErrors.bidAmount}
              errorMessage={validationErrors.bidAmount}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </Tooltip>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-status-error text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
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
              disabled={loading || Object.keys(validationErrors).length > 0 || loadingGifts || !currentUserId}
            >
              {loading ? 'Adding...' : 'Add to Inventory'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default AddGiftModal;

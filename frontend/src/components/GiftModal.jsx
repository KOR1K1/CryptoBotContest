import { useState } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from './ui/Toast';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';

/**
 * GiftModal Component
 * 
 * Модальное окно для создания нового подарка с валидацией и улучшенным дизайном
 * 
 * @param {boolean} isOpen - Открыто ли модальное окно
 * @param {function} onClose - Callback для закрытия
 * @param {function} onCreated - Callback после успешного создания
 */
const GiftModal = ({ isOpen, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [basePrice, setBasePrice] = useState('100');
  const [totalSupply, setTotalSupply] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  // Validation limits
  const TITLE_MAX_LENGTH = 200;
  const DESCRIPTION_MAX_LENGTH = 1000;
  const IMAGE_URL_MAX_LENGTH = 500;

  // Сброс формы при закрытии
  const handleClose = () => {
    if (!loading) {
      setTitle('');
      setDescription('');
      setImageUrl('');
      setBasePrice('100');
      setTotalSupply('1');
      setError('');
      setValidationErrors({});
      onClose();
    }
  };

  // Валидация отдельного поля
  const validateField = (field, value) => {
    const errors = { ...validationErrors };
    
    switch (field) {
      case 'title':
        const trimmedTitle = value.trim();
        if (!trimmedTitle || trimmedTitle.length < 1) {
          errors.title = 'Title must be at least 1 character';
        } else if (trimmedTitle.length > TITLE_MAX_LENGTH) {
          errors.title = `Title must not exceed ${TITLE_MAX_LENGTH} characters`;
        } else {
          delete errors.title;
        }
        break;
      
      case 'description':
        if (value.trim().length > DESCRIPTION_MAX_LENGTH) {
          errors.description = `Description must not exceed ${DESCRIPTION_MAX_LENGTH} characters`;
        } else {
          delete errors.description;
        }
        break;
      
      case 'imageUrl':
        const trimmedUrl = value.trim();
        if (trimmedUrl && trimmedUrl.length > IMAGE_URL_MAX_LENGTH) {
          errors.imageUrl = `Image URL must not exceed ${IMAGE_URL_MAX_LENGTH} characters`;
        } else if (trimmedUrl && !/^https?:\/\/.+/.test(trimmedUrl)) {
          errors.imageUrl = 'Image URL must be a valid URL starting with http:// or https://';
        } else {
          delete errors.imageUrl;
        }
        break;
      
      case 'basePrice':
        const price = parseFloat(value);
        if (isNaN(price) || price < 0) {
          errors.basePrice = 'Base price must be a valid number >= 0';
        } else {
          delete errors.basePrice;
        }
        break;
      
      case 'totalSupply':
        const supply = parseInt(value);
        if (isNaN(supply) || supply < 1 || supply > 10000) {
          errors.totalSupply = 'Total supply must be between 1 and 10000';
        } else {
          delete errors.totalSupply;
        }
        break;
    }
    
    setValidationErrors(errors);
    return !errors[field];
  };

  // Валидация всей формы
  const validateForm = () => {
    const fields = ['title', 'description', 'imageUrl', 'basePrice', 'totalSupply'];
    const values = { title, description, imageUrl, basePrice, totalSupply };
    
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
      await apiRequest('/gifts', {
        method: 'POST',
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          basePrice: parseFloat(basePrice),
          totalSupply: parseInt(totalSupply),
        },
      });

      showToast('Gift created successfully!', 'success');
      handleClose();
      if (onCreated) {
        onCreated();
      }
    } catch (err) {
      const errorMsg = err.message || 'Failed to create gift';
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
      title="Create New Gift"
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title Input */}
        <Tooltip content={`Title must be 1-${TITLE_MAX_LENGTH} characters`}>
          <Input
            label={`Title (${title.length}/${TITLE_MAX_LENGTH})`}
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError('');
              if (validationErrors.title) {
                validateField('title', e.target.value);
              }
            }}
            onBlur={(e) => validateField('title', e.target.value)}
            placeholder="Gift title (1-200 characters)"
            required
            maxLength={TITLE_MAX_LENGTH}
            disabled={loading}
            error={!!validationErrors.title}
            errorMessage={validationErrors.title}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            }
          />
        </Tooltip>

        {/* Description Textarea */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Description (optional) ({description.length}/{DESCRIPTION_MAX_LENGTH})
          </label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError('');
              if (validationErrors.description) {
                validateField('description', e.target.value);
              }
            }}
            onBlur={(e) => validateField('description', e.target.value)}
            rows="3"
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder="Gift description (max 1000 characters)"
            disabled={loading}
            className={`w-full px-4 py-2 bg-bg-secondary border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all duration-fast ${
              validationErrors.description
                ? 'border-status-error focus:ring-status-error'
                : 'border-border'
            }`}
          />
          {validationErrors.description && (
            <p className="mt-1 text-sm text-status-error">{validationErrors.description}</p>
          )}
        </div>

        {/* Image URL Input */}
        <Tooltip content="Image URL must be a valid HTTP/HTTPS URL">
          <Input
            label={`Image URL (optional) (${imageUrl.length}/${IMAGE_URL_MAX_LENGTH})`}
            type="url"
            value={imageUrl}
            onChange={(e) => {
              setImageUrl(e.target.value);
              setError('');
              if (validationErrors.imageUrl) {
                validateField('imageUrl', e.target.value);
              }
            }}
            onBlur={(e) => validateField('imageUrl', e.target.value)}
            placeholder="https://example.com/image.jpg"
            maxLength={IMAGE_URL_MAX_LENGTH}
            disabled={loading}
            error={!!validationErrors.imageUrl}
            errorMessage={validationErrors.imageUrl}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
          />
        </Tooltip>

        {/* Base Price and Total Supply */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Tooltip content="Base price of the gift">
            <Input
              label="Base Price"
              type="number"
              value={basePrice}
              onChange={(e) => {
                setBasePrice(e.target.value);
                setError('');
                if (validationErrors.basePrice) {
                  validateField('basePrice', e.target.value);
                }
              }}
              onBlur={(e) => validateField('basePrice', e.target.value)}
              min="0"
              step="0.01"
              required
              disabled={loading}
              error={!!validationErrors.basePrice}
              errorMessage={validationErrors.basePrice}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </Tooltip>

          <Tooltip content="Total supply must be between 1 and 10000">
            <Input
              label="Total Supply"
              type="number"
              value={totalSupply}
              onChange={(e) => {
                setTotalSupply(e.target.value);
                setError('');
                if (validationErrors.totalSupply) {
                  validateField('totalSupply', e.target.value);
                }
              }}
              onBlur={(e) => validateField('totalSupply', e.target.value)}
              min="1"
              max="10000"
              required
              disabled={loading}
              error={!!validationErrors.totalSupply}
              errorMessage={validationErrors.totalSupply}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
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
            disabled={loading || Object.keys(validationErrors).length > 0}
          >
            {loading ? 'Creating...' : 'Create Gift'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default GiftModal;

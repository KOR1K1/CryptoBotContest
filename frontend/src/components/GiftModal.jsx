import { useState } from 'react';
import { apiRequest } from '../api/client';

const GiftModal = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [basePrice, setBasePrice] = useState('100');
  const [totalSupply, setTotalSupply] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Validation limits
  const TITLE_MAX_LENGTH = 200;
  const DESCRIPTION_MAX_LENGTH = 1000;
  const IMAGE_URL_MAX_LENGTH = 500;

  const validateForm = () => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedImageUrl = imageUrl.trim();

    if (!trimmedTitle || trimmedTitle.length < 1) {
      setError('Title must be at least 1 character');
      return false;
    }
    if (trimmedTitle.length > TITLE_MAX_LENGTH) {
      setError(`Title must not exceed ${TITLE_MAX_LENGTH} characters (current: ${trimmedTitle.length})`);
      return false;
    }
    if (trimmedDescription && trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
      setError(`Description must not exceed ${DESCRIPTION_MAX_LENGTH} characters (current: ${trimmedDescription.length})`);
      return false;
    }
    if (trimmedImageUrl && trimmedImageUrl.length > IMAGE_URL_MAX_LENGTH) {
      setError(`Image URL must not exceed ${IMAGE_URL_MAX_LENGTH} characters (current: ${trimmedImageUrl.length})`);
      return false;
    }
    if (trimmedImageUrl && !/^https?:\/\/.+/.test(trimmedImageUrl)) {
      setError('Image URL must be a valid URL starting with http:// or https://');
      return false;
    }
    const price = parseFloat(basePrice);
    if (isNaN(price) || price < 0) {
      setError('Base price must be a valid number >= 0');
      return false;
    }
    const supply = parseInt(totalSupply);
    if (isNaN(supply) || supply < 1 || supply > 10000) {
      setError('Total supply must be between 1 and 10000');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!validateForm()) {
      setLoading(false);
      return;
    }

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

      alert('Gift created successfully!');
      onCreated();
      onClose();
    } catch (err) {
      // Parse backend validation errors
      const errorMsg = err.message || 'Failed to create gift';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal active" onClick={(e) => e.target.className === 'modal active' && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Gift</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>
              Title: <span className="char-count">{title.length}/{TITLE_MAX_LENGTH}</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(''); // Clear error on input
              }}
              required
              maxLength={TITLE_MAX_LENGTH}
              placeholder="Gift title (1-200 characters)"
              className={title.length > TITLE_MAX_LENGTH ? 'error' : ''}
            />
            {title.length > TITLE_MAX_LENGTH && (
              <small className="error-text">Title exceeds maximum length of {TITLE_MAX_LENGTH} characters</small>
            )}
          </div>
          <div className="form-group">
            <label>
              Description (optional): <span className="char-count">{description.length}/{DESCRIPTION_MAX_LENGTH}</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setError('');
              }}
              rows="3"
              maxLength={DESCRIPTION_MAX_LENGTH}
              placeholder="Gift description (max 1000 characters)"
              className={description.length > DESCRIPTION_MAX_LENGTH ? 'error' : ''}
            />
            {description.length > DESCRIPTION_MAX_LENGTH && (
              <small className="error-text">Description exceeds maximum length of {DESCRIPTION_MAX_LENGTH} characters</small>
            )}
          </div>
          <div className="form-group">
            <label>
              Image URL (optional): <span className="char-count">{imageUrl.length}/{IMAGE_URL_MAX_LENGTH}</span>
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setError('');
              }}
              maxLength={IMAGE_URL_MAX_LENGTH}
              placeholder="https://example.com/image.jpg (max 500 characters)"
              className={imageUrl.length > IMAGE_URL_MAX_LENGTH ? 'error' : ''}
            />
            {imageUrl.length > IMAGE_URL_MAX_LENGTH && (
              <small className="error-text">Image URL exceeds maximum length of {IMAGE_URL_MAX_LENGTH} characters</small>
            )}
          </div>
          <div className="form-group">
            <label>Base Price:</label>
            <input
              type="number"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              min="0"
              step="0.01"
              required
            />
          </div>
          <div className="form-group">
            <label>Total Supply:</label>
            <input
              type="number"
              value={totalSupply}
              onChange={(e) => setTotalSupply(e.target.value)}
              min="1"
              required
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GiftModal;

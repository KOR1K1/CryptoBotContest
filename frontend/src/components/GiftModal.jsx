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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

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
    } catch (err) {
      setError(err.message || 'Failed to create gift');
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
            <label>Title:</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Gift title"
            />
          </div>
          <div className="form-group">
            <label>Description (optional):</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows="3"
              placeholder="Gift description"
            />
          </div>
          <div className="form-group">
            <label>Image URL (optional):</label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
            />
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

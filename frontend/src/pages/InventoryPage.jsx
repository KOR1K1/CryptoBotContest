import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import AddGiftModal from '../components/AddGiftModal';
import { showToast } from '../components/Toast';

const InventoryPage = ({ currentUserId }) => {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadInventory = async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const inventoryData = await apiRequest(`/users/${currentUserId}/inventory`);
      setInventory(inventoryData);
    } catch (error) {
      console.error('Error loading inventory:', error);
      setError(error.message);
      showToast(`Failed to load inventory: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, [currentUserId]);

  if (!currentUserId) {
    return (
      <div className="loading">Please select a user to view inventory</div>
    );
  }

  if (loading) {
    return <div className="loading">Loading inventory...</div>;
  }

  if (error) {
    return (
      <div className="page active">
        <div className="page-header">
          <h2>My Inventory</h2>
          <button className="btn-primary" onClick={loadInventory}>
            Retry
          </button>
        </div>
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--error)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Error loading inventory</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page active">
      <div className="page-header">
        <h2>My Inventory</h2>
        <button className="btn-primary" onClick={loadInventory}>
          Refresh
        </button>
      </div>

      {inventory.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
            No gifts in inventory yet
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            Win an auction to get gifts!
          </p>
          <button className="btn-secondary" onClick={() => setShowAddModal(true)}>
            Add Gift to Inventory (Demo)
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '16px' }}>
            <button className="btn-secondary" onClick={() => setShowAddModal(true)}>
              Add Gift to Inventory (Demo)
            </button>
          </div>
          <div className="inventory-grid">
            {inventory.map((item) => (
              <div key={item.bidId} className="inventory-item">
                {item.giftImageUrl ? (
                  <img
                    src={item.giftImageUrl}
                    alt={item.giftTitle}
                    className="inventory-item-image"
                    onError={(e) => {
                      e.target.parentElement.innerHTML = '<div class="inventory-item-image">🎁</div>';
                    }}
                  />
                ) : (
                  <div className="inventory-item-image">🎁</div>
                )}
                <div className="inventory-item-content">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h3 style={{ flex: 1 }}>{item.giftTitle}</h3>
                    <span className="badge badge-success" style={{ fontSize: '10px' }}>WON</span>
                  </div>
                  {item.giftDescription && (
                    <div className="description" style={{ marginBottom: '12px' }}>{item.giftDescription}</div>
                  )}
                  <div className="bid-info" style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginTop: '12px',
                  }}>
                    <div className="bid-info-label">Won for</div>
                    <div className="bid-info-value" style={{ color: 'var(--success)' }}>
                      {item.bidAmount.toFixed(2)}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border)',
                  }}>
                    Round {item.roundIndex + 1} • {new Date(item.wonAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showAddModal && (
        <AddGiftModal
          currentUserId={currentUserId}
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false);
            loadInventory();
          }}
        />
      )}
    </div>
  );
};

export default InventoryPage;

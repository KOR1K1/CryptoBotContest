import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import AddGiftModal from '../components/AddGiftModal';
import { showToast } from '../components/ui/Toast';
import GiftCard from '../components/features/GiftCard';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Loading from '../components/ui/Loading';
import Tooltip from '../components/ui/Tooltip';
import EmptyState from '../components/ui/EmptyState';

/**
 * InventoryPage Component
 * 
 * Страница инвентаря пользователя с улучшенным дизайном
 */
const InventoryPage = () => {
  const { user } = useAuth();
  const currentUserId = user?.id;
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
      setError(error.message || 'Failed to load inventory');
      showToast(`Failed to load inventory: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, [currentUserId]);

  // Loading State
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">My Inventory</h1>
            <p className="text-text-secondary">Loading your gifts...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} variant="elevated">
              <Loading.Skeleton variant="rectangular" height="h-48" className="mb-4" />
              <Loading.Skeleton variant="text" width="w-3/4" height="h-6" className="mb-2" />
              <Loading.Skeleton variant="text" width="w-1/2" height="h-4" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error State
  if (error && inventory.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">My Inventory</h1>
            <p className="text-text-secondary">Something went wrong</p>
          </div>
        </div>
        <Card variant="elevated" className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-status-error text-6xl">⚠️</div>
            <h2 className="text-2xl font-semibold text-text-primary">Failed to Load Inventory</h2>
            <p className="text-text-secondary">{error}</p>
            <Button
              variant="primary"
              onClick={loadInventory}
            >
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">My Inventory</h1>
          <p className="text-text-secondary">
            {inventory.length} {inventory.length === 1 ? 'gift' : 'gifts'} in your collection
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Tooltip content="Refresh inventory list">
            <Button
              variant="secondary"
              onClick={loadInventory}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              Refresh
            </Button>
          </Tooltip>
          
          <Tooltip content="Add a gift to your inventory (Demo)">
            <Button
              variant="primary"
              onClick={() => setShowAddModal(true)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              Add Gift
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Inventory Grid */}
      {inventory.length === 0 ? (
        <EmptyState
          icon="🎁"
          title="No Gifts Yet"
          message="Win an auction to get gifts! Your won gifts will appear here."
          action={
            <Tooltip content="Add a gift to your inventory for testing purposes">
              <Button
                variant="secondary"
                onClick={() => setShowAddModal(true)}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                }
              >
                Add Gift (Demo)
              </Button>
            </Tooltip>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {inventory.map((item) => (
            <GiftCard key={item.bidId} item={item} />
          ))}
        </div>
      )}

      {/* Add Gift Modal */}
      <AddGiftModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => {
          setShowAddModal(false);
          loadInventory();
        }}
      />
    </div>
  );
};

export default InventoryPage;

import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../components/ui/Toast';
import UserBidItem from '../components/features/UserBidItem';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Loading from '../components/ui/Loading';
import Tooltip from '../components/ui/Tooltip';
import EmptyState from '../components/ui/EmptyState';

/**
 * UserBidsPage Component
 * 
 * Страница со списком ставок пользователя с фильтрацией и улучшенным дизайном
 */
const UserBidsPage = () => {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [bids, setBids] = useState([]);
  const [filteredBids, setFilteredBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadBids = async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const bidsData = await apiRequest(`/users/${currentUserId}/bids`);
      setBids(bidsData);
    } catch (error) {
      console.error('Error loading bids:', error);
      setError(error.message || 'Failed to load bids');
      showToast(`Failed to load bids: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter bids by status
  useEffect(() => {
    let filtered = [...bids];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(bid => bid.status === statusFilter);
    }

    // Sort by created date (newest first)
    filtered.sort((a, b) => {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    setFilteredBids(filtered);
  }, [bids, statusFilter]);

  useEffect(() => {
    loadBids();
  }, [currentUserId]);

  // Loading State
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">My Bids</h1>
            <p className="text-text-secondary">Loading your bids...</p>
          </div>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i} variant="elevated">
              <div className="p-4">
                <Loading.Skeleton variant="text" width="w-1/4" height="h-6" className="mb-2" />
                <Loading.Skeleton variant="text" width="w-1/2" height="h-4" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error State
  if (error && bids.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">My Bids</h1>
            <p className="text-text-secondary">Something went wrong</p>
          </div>
        </div>
        <Card variant="elevated" className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-status-error text-6xl">⚠️</div>
            <h2 className="text-2xl font-semibold text-text-primary">Failed to Load Bids</h2>
            <p className="text-text-secondary">{error}</p>
            <Button
              variant="primary"
              onClick={loadBids}
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
          <h1 className="text-3xl font-bold text-text-primary mb-2">My Bids</h1>
          <p className="text-text-secondary">
            {filteredBids.length} {filteredBids.length === 1 ? 'bid' : 'bids'} found
            {statusFilter !== 'all' && ` (${bids.length} total)`}
          </p>
        </div>
        
        <Tooltip content="Refresh bids list">
          <Button
            variant="secondary"
            onClick={loadBids}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            Refresh
          </Button>
        </Tooltip>
      </div>

      {/* Status Filter */}
      <Card variant="outlined" className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Filter by Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              <option value="WON">Won</option>
              <option value="ACTIVE">Active</option>
              <option value="REFUNDED">Refunded</option>
              <option value="LOST">Lost</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Bids List */}
      {filteredBids.length === 0 ? (
        <EmptyState
          icon="💸"
          title="No Bids Found"
          message={
            statusFilter !== 'all'
              ? `No bids with status "${statusFilter}" found. Try changing the filter.`
              : 'You haven\'t placed any bids yet. Participate in an auction to see your bids here!'
          }
          action={
            statusFilter !== 'all' ? (
              <Tooltip content="Show all bids regardless of status">
                <Button
                  variant="secondary"
                  onClick={() => setStatusFilter('all')}
                >
                  Show All Bids
                </Button>
              </Tooltip>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredBids.map((bid) => (
            <UserBidItem key={bid.id} bid={bid} />
          ))}
        </div>
      )}
    </div>
  );
};

export default UserBidsPage;

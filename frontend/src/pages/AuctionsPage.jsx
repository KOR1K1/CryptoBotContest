import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import GiftModal from '../components/GiftModal';
import AuctionModal from '../components/AuctionModal';
import { showToast } from '../components/ui/Toast';
import AuctionCard from '../components/features/AuctionCard';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Loading from '../components/ui/Loading';
import Tooltip from '../components/ui/Tooltip';
import EmptyState from '../components/ui/EmptyState';

/**
 * AuctionsPage Component
 * 
 * Страница со списком всех аукционов с фильтрацией, сортировкой и улучшенным дизайном
 */
const AuctionsPage = () => {
  const [auctions, setAuctions] = useState([]);
  const [filteredAuctions, setFilteredAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [showAuctionModal, setShowAuctionModal] = useState(false);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const loadAuctions = async (forceRefresh = false) => {
    try {
      setError(null);
      // Add timestamp to bypass cache if force refresh
      const cacheBuster = forceRefresh ? `?_t=${Date.now()}` : '';
      const auctionsData = await apiRequest(`/auctions${cacheBuster}`);
      
      // Get gift info and max bids for each auction
      const auctionsWithDetails = await Promise.all(
        auctionsData.map(async (auction) => {
          let giftInfo = {};
          try {
            giftInfo = await apiRequest(`/gifts/${auction.giftId}`);
          } catch (error) {
            // Silent fail for gift info - not critical
            console.warn('Error loading gift:', error);
          }

          let maxBid = 0;
          try {
            const bids = await apiRequest(`/auctions/${auction.id}/bids`);
            if (bids.length > 0) {
              maxBid = Math.max(...bids.map(b => b.amount));
            }
          } catch (error) {
            // Silent fail for bids - not critical
            console.warn('Error loading bids:', error);
          }

          return { ...auction, giftInfo, maxBid };
        })
      );

      setAuctions(auctionsWithDetails);
    } catch (error) {
      console.error('Error loading auctions:', error);
      setError(error.message || 'Failed to load auctions');
      showToast(`Failed to load auctions: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort auctions
  useEffect(() => {
    let filtered = [...auctions];

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(auction => auction.status === statusFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'oldest':
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case 'highest-bid':
          return (b.maxBid || 0) - (a.maxBid || 0);
        case 'lowest-bid':
          return (a.maxBid || 0) - (b.maxBid || 0);
        case 'status':
          return a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });

    setFilteredAuctions(filtered);
  }, [auctions, statusFilter, sortBy]);

  useEffect(() => {
    loadAuctions();

    // Listen for refresh events from WebSocket
    const handleRefresh = (event) => {
      // Check if this is a forced refresh (e.g., when auction completes)
      const forceRefresh = event?.detail?.force === true;
      loadAuctions(forceRefresh);
    };
    window.addEventListener('refresh-auctions', handleRefresh);

    return () => {
      window.removeEventListener('refresh-auctions', handleRefresh);
    };
  }, []);

  // Loading State
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Active Auctions</h1>
            <p className="text-text-secondary">Loading auctions...</p>
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
  if (error && auctions.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Active Auctions</h1>
            <p className="text-text-secondary">Something went wrong</p>
          </div>
        </div>
        <Card variant="elevated" className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-status-error text-6xl">⚠️</div>
            <h2 className="text-2xl font-semibold text-text-primary">Failed to Load Auctions</h2>
            <p className="text-text-secondary">{error}</p>
            <Button
              variant="primary"
              onClick={() => {
                setLoading(true);
                loadAuctions(true);
              }}
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
          <h1 className="text-3xl font-bold text-text-primary mb-2">Active Auctions</h1>
          <p className="text-text-secondary">
            {filteredAuctions.length} {filteredAuctions.length === 1 ? 'auction' : 'auctions'} found
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content="Create a new gift item">
            <Button
              variant="secondary"
              onClick={() => setShowGiftModal(true)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              New Gift
            </Button>
          </Tooltip>
          
          <Tooltip content="Create a new auction">
            <Button
              variant="secondary"
              onClick={() => setShowAuctionModal(true)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
            >
              New Auction
            </Button>
          </Tooltip>
          
          <Tooltip content="Refresh auctions list">
            <Button
              variant="primary"
              onClick={() => {
                setLoading(true);
                loadAuctions(true);
              }}
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
      </div>

      {/* Filters and Sort */}
      <Card variant="outlined" className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Status Filter */}
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
              <option value="CREATED">Created</option>
              <option value="RUNNING">Running</option>
              <option value="FINALIZING">Finalizing</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest-bid">Highest Bid</option>
              <option value="lowest-bid">Lowest Bid</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Auctions Grid */}
      {filteredAuctions.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No Auctions Found"
          message={
            statusFilter !== 'all'
              ? `No auctions with status "${statusFilter}" found. Try changing the filter.`
              : 'No auctions available. Create one using the buttons above.'
          }
          action={
            statusFilter !== 'all' ? (
              <Tooltip content="Show all auctions regardless of status">
                <Button
                  variant="secondary"
                  onClick={() => setStatusFilter('all')}
                >
                  Show All Auctions
                </Button>
              </Tooltip>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAuctions.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      )}

      {/* Modals */}
      <GiftModal
        isOpen={showGiftModal}
        onClose={() => setShowGiftModal(false)}
        onCreated={() => {
          setShowGiftModal(false);
          loadAuctions(true);
        }}
      />

      <AuctionModal
        isOpen={showAuctionModal}
        onClose={() => setShowAuctionModal(false)}
        onCreated={() => {
          setShowAuctionModal(false);
          loadAuctions(true);
        }}
      />
    </div>
  );
};

export default AuctionsPage;

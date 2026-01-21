import { useState, useEffect } from 'react';
import { apiRequest } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import './index.css';

// Pages
import AuctionsPage from './pages/AuctionsPage';
import AuctionDetailPage from './pages/AuctionDetailPage';
import InventoryPage from './pages/InventoryPage';
import UserBidsPage from './pages/UserBidsPage';
import BotSimulatorPage from './pages/BotSimulatorPage';

// Components
import Header from './components/Header';
import NavBar from './components/NavBar';
import ToastContainer from './components/Toast';

function App() {
  const [currentPage, setCurrentPage] = useState('auctions');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentAuctionId, setCurrentAuctionId] = useState(null);
  const [users, setUsers] = useState([]);

  // WebSocket for auction updates
  const { on } = useWebSocket(currentPage === 'auction-detail' ? currentAuctionId : null);

  // Listen to WebSocket events
  useEffect(() => {
    if (!on) return;

    const unsubscribeBid = on('bid_update', (data) => {
      console.log('Bid update:', data);
      // Forward live top positions to detail page
      window.dispatchEvent(new CustomEvent('auction-top-update', { detail: data }));

      // Force refresh if on auction detail page (fallback for other fields)
      if (currentPage === 'auction-detail' && data.auctionId === currentAuctionId) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (currentPage === 'auctions') {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    const unsubscribeAuction = on('auction_update', (data) => {
      console.log('Auction update:', data);
      if (currentPage === 'auction-detail' && data.auctionId === currentAuctionId) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (currentPage === 'auctions') {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    const unsubscribeRound = on('round_closed', (data) => {
      console.log('Round closed:', data);
      if (currentPage === 'auction-detail' && data.auctionId === currentAuctionId) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (currentPage === 'auctions') {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    const unsubscribeList = on('auctions_list_update', () => {
      if (currentPage === 'auctions') {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    return () => {
      unsubscribeBid?.();
      unsubscribeAuction?.();
      unsubscribeRound?.();
      unsubscribeList?.();
    };
  }, [on, currentPage, currentAuctionId]);

  // Load users on mount
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const usersData = await apiRequest('/users');
      setUsers(usersData);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const handlePageChange = (page) => {
    if (page === 'auctions') {
      setCurrentAuctionId(null);
    }
    setCurrentPage(page);
  };

  const handleAuctionClick = (auctionId) => {
    setCurrentAuctionId(auctionId);
    setCurrentPage('auction-detail');
  };

  return (
    <div className="container">
      <Header
        users={users}
        currentUserId={currentUserId}
        onUserChange={setCurrentUserId}
        onUserCreated={loadUsers}
      />
      
      <NavBar currentPage={currentPage} onPageChange={handlePageChange} />

      <main>
        {currentPage === 'auctions' && (
          <AuctionsPage onAuctionClick={handleAuctionClick} />
        )}
        {currentPage === 'auction-detail' && (
          <AuctionDetailPage
            auctionId={currentAuctionId}
            currentUserId={currentUserId}
            onBack={() => handlePageChange('auctions')}
          />
        )}
        {currentPage === 'inventory' && (
          <InventoryPage currentUserId={currentUserId} />
        )}
        {currentPage === 'user-bids' && (
          <UserBidsPage currentUserId={currentUserId} />
        )}
        {currentPage === 'bot-simulator' && (
          <BotSimulatorPage />
        )}
      </main>

      <ToastContainer />
    </div>
  );
}

export default App;

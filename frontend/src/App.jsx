import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './index.css';

import AuctionsPage from './pages/AuctionsPage';
import AuctionDetailPage from './pages/AuctionDetailPage';
import InventoryPage from './pages/InventoryPage';
import UserBidsPage from './pages/UserBidsPage';
import BotSimulatorPage from './pages/BotSimulatorPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

import Header from './components/layout/Header';
import NavBar from './components/layout/NavBar';
import PageLayout from './components/layout/PageLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ToastContainer from './components/ui/Toast';

// обертка для websocket событий
function WebSocketWrapper({ children }) {
  const location = useLocation();
  const params = useParams();
  
  const auctionId = location.pathname.startsWith('/auctions/') && params.id 
    ? params.id 
    : null;
  
  const { on } = useWebSocket(auctionId);
  useEffect(() => {
    const handleUnauthorized = () => {
      window.location.href = '/login';
    };

    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!on) return;

    const isAuctionDetail = location.pathname.startsWith('/auctions/') && params.id;
    const isAuctionsList = location.pathname === '/auctions';

    const unsubscribeBid = on('bid_update', (data) => {
      console.log('Bid update:', data);
      window.dispatchEvent(new CustomEvent('auction-top-update', { detail: data }));

      if (isAuctionDetail && data.auctionId === params.id) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (isAuctionsList) {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    const unsubscribeAuction = on('auction_update', (data) => {
      console.log('Auction update received:', data);
      const isCompleted = data.auction?.status === 'COMPLETED';
      
      if (isAuctionDetail && data.auctionId === params.id) {
        console.log('Forcing refresh for auction detail page, completed:', isCompleted);
        window.dispatchEvent(new CustomEvent('refresh-auction', { 
          detail: { force: isCompleted } 
        }));
        window.dispatchEvent(new CustomEvent('refresh-rounds', { 
          detail: { auctionId: data.auctionId, force: isCompleted } 
        }));
      }
      if (isAuctionsList) {
        console.log('Forcing refresh for auctions list page, completed:', isCompleted);
        window.dispatchEvent(new CustomEvent('refresh-auctions', { 
          detail: { force: isCompleted } 
        }));
      }
    });

    const unsubscribeAuctionsList = on('auctions_list_update', (data) => {
      console.log('Auctions list update received:', data);
      if (isAuctionsList) {
        console.log('Forcing refresh for auctions list page (new auction created)');
        window.dispatchEvent(new CustomEvent('refresh-auctions', { 
          detail: { force: true } 
        }));
      }
    });

    const unsubscribeRound = on('round_closed', (data) => {
      console.log('Round closed:', data);
      if (isAuctionDetail && data.auctionId === params.id) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (isAuctionsList) {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    return () => {
      unsubscribeBid?.();
      unsubscribeAuction?.();
      unsubscribeRound?.();
      unsubscribeAuctionsList?.();
    };
  }, [on, location.pathname, params.id]);

  return children;
}

// основной layout для авторизованных страниц
function AppLayout({ children }) {
  return (
    <PageLayout>
      <Header />
      <NavBar />
      <main className="min-h-screen">
        {children}
      </main>
      <ToastContainer />
    </PageLayout>
  );
}


// все маршруты приложения
function AppRoutes() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    <WebSocketWrapper>
      <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to="/auctions" replace />
              ) : (
                <>
                  <LoginPage />
                  <ToastContainer />
                </>
              )
            }
          />
          <Route
            path="/register"
            element={
              isAuthenticated ? (
                <Navigate to="/auctions" replace />
              ) : (
                <>
                  <RegisterPage />
                  <ToastContainer />
                </>
              )
            }
          />

          <Route
            path="/auctions"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <AuctionsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/auctions/:id"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <AuctionDetailPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <InventoryPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/bids"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <UserBidsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/bot-simulator"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <BotSimulatorPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

        <Route
          path="/"
          element={
            <Navigate
              to={isAuthenticated ? '/auctions' : '/login'}
              replace
            />
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to={isAuthenticated ? '/auctions' : '/login'}
              replace
            />
          }
        />
      </Routes>
    </WebSocketWrapper>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

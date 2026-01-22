import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './index.css';

// Pages
import AuctionsPage from './pages/AuctionsPage';
import AuctionDetailPage from './pages/AuctionDetailPage';
import InventoryPage from './pages/InventoryPage';
import UserBidsPage from './pages/UserBidsPage';
import BotSimulatorPage from './pages/BotSimulatorPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Components
import Header from './components/layout/Header';
import NavBar from './components/layout/NavBar';
import PageLayout from './components/layout/PageLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ToastContainer from './components/ui/Toast';

/**
 * WebSocketWrapper Component
 * 
 * Обрабатывает WebSocket события для текущего маршрута
 */
function WebSocketWrapper({ children }) {
  const location = useLocation();
  const params = useParams();
  
  // Определяем, нужно ли подключаться к WebSocket для конкретного аукциона
  const auctionId = location.pathname.startsWith('/auctions/') && params.id 
    ? params.id 
    : null;
  
  const { on } = useWebSocket(auctionId);

  // Handle unauthorized events (401 errors)
  useEffect(() => {
    const handleUnauthorized = () => {
      window.location.href = '/login';
    };

    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  // Listen to WebSocket events
  useEffect(() => {
    if (!on) return;

    const isAuctionDetail = location.pathname.startsWith('/auctions/') && params.id;
    const isAuctionsList = location.pathname === '/auctions';

    const unsubscribeBid = on('bid_update', (data) => {
      console.log('Bid update:', data);
      // Forward live top positions to detail page
      window.dispatchEvent(new CustomEvent('auction-top-update', { detail: data }));

      // Force refresh if on auction detail page (fallback for other fields)
      if (isAuctionDetail && data.auctionId === params.id) {
        window.dispatchEvent(new CustomEvent('refresh-auction'));
      }
      if (isAuctionsList) {
        window.dispatchEvent(new CustomEvent('refresh-auctions'));
      }
    });

    const unsubscribeAuction = on('auction_update', (data) => {
      console.log('Auction update received:', data);
      // If auction status changed to COMPLETED, force immediate refresh
      const isCompleted = data.auction?.status === 'COMPLETED';
      
      // Always refresh if this is the current auction being viewed
      if (isAuctionDetail && data.auctionId === params.id) {
        console.log('Forcing refresh for auction detail page, completed:', isCompleted);
        // Force immediate refresh for completed auctions
        window.dispatchEvent(new CustomEvent('refresh-auction', { 
          detail: { force: isCompleted } 
        }));
        // Also refresh rounds history
        window.dispatchEvent(new CustomEvent('refresh-rounds', { 
          detail: { auctionId: data.auctionId, force: isCompleted } 
        }));
      }
      // Always refresh auctions list when any auction updates (especially when completed)
      if (isAuctionsList) {
        console.log('Forcing refresh for auctions list page, completed:', isCompleted);
        window.dispatchEvent(new CustomEvent('refresh-auctions', { 
          detail: { force: isCompleted } 
        }));
      }
    });

    // Listen for auctions list updates (when new auction is created)
    const unsubscribeAuctionsList = on('auctions_list_update', (data) => {
      console.log('Auctions list update received:', data);
      // Always refresh auctions list when new auction is created
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

/**
 * AppLayout Component
 * 
 * Основной layout для авторизованных страниц
 */
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


/**
 * AppRoutes Component
 * 
 * Определяет все маршруты приложения
 */
function AppRoutes() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  return (
    <WebSocketWrapper>
      <Routes>
          {/* Public routes */}
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

          {/* Protected routes */}
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

        {/* Default redirect */}
        <Route
          path="/"
          element={
            <Navigate
              to={isAuthenticated ? '/auctions' : '/login'}
              replace
            />
          }
        />

        {/* 404 - redirect to auctions or login */}
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

/**
 * App Component
 * 
 * Главный компонент приложения с роутингом
 */
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

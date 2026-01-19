import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client';
import UserModal from './UserModal';

const Header = ({ users, currentUserId, onUserChange, onUserCreated }) => {
  const [showUserModal, setShowUserModal] = useState(false);
  const [balance, setBalance] = useState({ balance: 0, lockedBalance: 0, total: 0 });
  const [selectedUsername, setSelectedUsername] = useState('None');
  const balanceIntervalRef = useRef(null);

  // Load balance when user changes
  const handleUserSelect = async (userId) => {
    onUserChange(userId);
    if (userId) {
      try {
        const user = users.find(u => u.id === userId);
        setSelectedUsername(user?.username || 'Unknown');
        
        const balanceData = await apiRequest(`/users/${userId}/balance`);
        setBalance(balanceData);
      } catch (error) {
        console.error('Error loading user balance:', error);
      }
    } else {
      setSelectedUsername('None');
      setBalance({ balance: 0, lockedBalance: 0, total: 0 });
    }
  };

  // Refresh balance periodically (only when tab is visible)
  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    // Clear any existing interval
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
      balanceIntervalRef.current = null;
    }

    const ACTIVE_INTERVAL = 5000; // 5 seconds when tab is active
    const INACTIVE_INTERVAL = 30000; // 30 seconds when tab is hidden (or disable)

    const refreshBalance = async () => {
      // Double-check: Skip refresh if tab is hidden (defensive check)
      if (document.hidden || document.visibilityState === 'hidden') {
        return;
      }

      try {
        const updated = await apiRequest(`/users/${currentUserId}/balance`);
        setBalance(updated);
      } catch (error) {
        console.error('Error refreshing balance:', error);
      }
    };

    const startPolling = (interval) => {
      // Clear existing interval first
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
      // Only start polling if tab is visible
      if (!document.hidden && document.visibilityState !== 'hidden') {
        balanceIntervalRef.current = setInterval(refreshBalance, interval);
      }
    };

    const stopPolling = () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        // Tab is hidden or browser minimized - STOP polling completely
        stopPolling();
      } else {
        // Tab is visible - resume normal polling
        refreshBalance(); // Immediate refresh when tab becomes visible
        startPolling(ACTIVE_INTERVAL);
      }
    };

    // Also handle window blur/focus events (for browser minimization)
    const handleWindowBlur = () => {
      // Browser window lost focus (minimized or switched to another app)
      stopPolling();
    };

    const handleWindowFocus = () => {
      // Browser window regained focus
      if (!document.hidden && document.visibilityState !== 'hidden') {
        refreshBalance(); // Immediate refresh
        startPolling(ACTIVE_INTERVAL);
      }
    };

    // Start with active interval (only if tab is visible)
    if (!document.hidden && document.visibilityState !== 'hidden') {
      startPolling(ACTIVE_INTERVAL);
    }

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for window blur/focus (for browser minimization)
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentUserId]);

  return (
    <header>
      <h1>🎁 Auction System Demo</h1>
      <div className="user-section">
        <div className="user-selector">
          <label>User:</label>
          <select
            value={currentUserId || ''}
            onChange={(e) => handleUserSelect(e.target.value)}
          >
            <option value="">Select User...</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username} (Balance: {user.balance.toFixed(2)})
              </option>
            ))}
          </select>
          <button onClick={() => setShowUserModal(true)}>New User</button>
        </div>
        {currentUserId && (
          <div className="balance-display" style={{
            display: 'flex',
            gap: '20px',
            flexWrap: 'wrap',
            padding: '16px',
            background: 'rgba(99, 102, 241, 0.1)',
            borderRadius: '12px',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}>
            <div className="balance-item">
              <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                💰 Balance
              </span>
              <span className="value" style={{ fontSize: '20px' }}>{balance.balance.toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔒 Locked
              </span>
              <span className="value" style={{ fontSize: '20px', color: balance.lockedBalance > 0 ? 'var(--warning)' : 'var(--accent-secondary)' }}>
                {balance.lockedBalance.toFixed(2)}
              </span>
            </div>
            <div className="balance-item">
              <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                📊 Total
              </span>
              <span className="value" style={{ fontSize: '20px', color: 'var(--success)' }}>
                {balance.total.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>
      
      {showUserModal && (
        <UserModal
          onClose={() => setShowUserModal(false)}
          onCreated={() => {
            setShowUserModal(false);
            onUserCreated();
          }}
        />
      )}
    </header>
  );
};

export default Header;

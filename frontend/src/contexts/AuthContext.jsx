import { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../api/client';

/**
 * AuthContext
 * 
 * Provides authentication state and methods throughout the app
 */
const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');
    
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error('Error loading saved auth:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
    
    setLoading(false);
  }, []);

  /**
   * Login user
   */
  const login = async (username, password) => {
    try {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        data: { username, password },
      });

      const { access_token, user: userData } = response;
      
      if (!access_token || !userData) {
        return { success: false, error: 'Invalid response from server' };
      }
      
      // Save to localStorage
      localStorage.setItem('auth_token', access_token);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Register new user
   */
  const register = async (username, password, email, initialBalance) => {
    try {
      const response = await apiRequest('/auth/register', {
        method: 'POST',
        data: { username, password, email, initialBalance },
      });

      const { access_token, user: userData } = response;
      
      if (!access_token || !userData) {
        return { success: false, error: 'Invalid response from server' };
      }
      
      // Save to localStorage
      localStorage.setItem('auth_token', access_token);
      localStorage.setItem('auth_user', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Logout user
   */
  const logout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  };

  /**
   * Get current user info from server
   */
  const refreshUser = async () => {
    if (!token) return;

    try {
      const userData = await apiRequest('/auth/me');
      setUser(userData);
      localStorage.setItem('auth_user', JSON.stringify(userData));
    } catch (error) {
      console.error('Error refreshing user:', error);
      // If 401, token is invalid - logout
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        logout();
      }
    }
  };

  const value = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    loading,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

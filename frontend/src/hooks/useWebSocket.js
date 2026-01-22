import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// Browser runs on host, so always use localhost:3000 (backend is exposed on host port 3000)
const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

export const useWebSocket = (auctionId = null) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef({});
  const previousAuctionIdRef = useRef(null);

  useEffect(() => {
    // Get token from localStorage
    const token = localStorage.getItem('auth_token');
    
    const socketInstance = io(`${WS_URL}/auctions`, {
      transports: ['websocket', 'polling'],
      // Send token in handshake.auth (preferred method)
      auth: token ? { token } : undefined,
      // Don't send token in query if we have it in auth (avoid duplication)
      // Only use query as fallback if no token in auth
      query: token ? {} : {},
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socketInstance.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
      if (auctionId) {
        socketInstance.emit('subscribe', { auctionId });
      }
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      setConnected(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setConnected(false);
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log('WebSocket reconnected after', attemptNumber, 'attempts');
      setConnected(true);
      if (auctionId) {
        socketInstance.emit('subscribe', { auctionId });
      }
    });

    setSocket(socketInstance);

    return () => {
      // Remove all listeners
      Object.keys(listenersRef.current).forEach((event) => {
        socketInstance.off(event, listenersRef.current[event]);
      });
      socketInstance.disconnect();
    };
  }, []);

  // Subscribe/unsubscribe when auctionId changes
  useEffect(() => {
    if (socket && connected) {
      // Unsubscribe from previous auction
      if (previousAuctionIdRef.current) {
        socket.emit('unsubscribe', { auctionId: previousAuctionIdRef.current });
      }
      
      // Subscribe to new auction
      if (auctionId) {
        socket.emit('subscribe', { auctionId });
        previousAuctionIdRef.current = auctionId;
      } else {
        previousAuctionIdRef.current = null;
      }
    }
  }, [socket, connected, auctionId]);

  const on = useCallback((event, callback) => {
    if (socket) {
      const handler = (data) => {
        callback(data);
      };
      socket.on(event, handler);
      listenersRef.current[event] = handler;
      return () => {
        socket.off(event, handler);
        delete listenersRef.current[event];
      };
    }
  }, [socket]);

  return { socket, connected, on };
};

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// определяем websocket url динамически по hostname
// чтобы работало с других устройств в сети (например айфон по IP)
function getWebSocketUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  
  const wsUrl = `${protocol}//${hostname}:3000`;
  
  console.log('[WebSocket] Current hostname:', hostname, 'WebSocket URL:', wsUrl);
  
  return wsUrl;
}

export const useWebSocket = (auctionId = null) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef({});
  const previousAuctionIdRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const wsUrl = getWebSocketUrl();
    
    const socketInstance = io(`${wsUrl}/auctions`, {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
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
      Object.keys(listenersRef.current).forEach((event) => {
        socketInstance.off(event, listenersRef.current[event]);
      });
      socketInstance.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socket && connected) {
      if (previousAuctionIdRef.current) {
        socket.emit('unsubscribe', { auctionId: previousAuctionIdRef.current });
      }
      
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

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// определяем websocket url динамически по hostname
// в продакшене используем относительный путь через nginx прокси (/socket.io)
// в деве - прямой порт для локальной сети
function getWebSocketUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isLocalNetwork = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  
  // если localhost или локальная сеть - используем прямой порт
  // иначе (продакшен) - относительный путь через nginx
  if (isLocalhost || isLocalNetwork) {
    const wsUrl = `${protocol}//${hostname}:3000`;
    console.log('[WebSocket] Development mode - direct port:', wsUrl);
    return wsUrl;
  } else {
    // продакшен: nginx проксирует /socket.io к бэкенду
    // используем тот же протокол и хост, но без порта
    const wsUrl = `${protocol}//${hostname}`;
    console.log('[WebSocket] Production mode - nginx proxy:', wsUrl);
    return wsUrl;
  }
}

export const useWebSocket = (auctionId = null) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef({});
  const previousAuctionIdRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const wsUrl = getWebSocketUrl();
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isLocalNetwork = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname);
    
    // Socket.IO логика:
    // Socket.IO клиент по умолчанию использует path='/socket.io'
    // Namespace /auctions добавляется к базовому URL
    // Итого: {baseUrl}/socket.io/auctions/...
    // - В деве: http://localhost:3000/socket.io/auctions/...
    // - В продакшене: https://domain.com/socket.io/auctions/... (Nginx проксирует /socket.io)
    const socketOptions = {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      query: token ? {} : {},
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    };
    
    const connectUrl = `${wsUrl}/auctions`;
    console.log('[WebSocket] Connecting to:', connectUrl, '(Socket.IO will use path /socket.io)');
    const socketInstance = io(connectUrl, socketOptions);

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

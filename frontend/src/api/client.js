import axios from 'axios';

// определяем api url динамически по hostname
// в продакшене используем относительный путь через nginx прокси (/api)
// в деве - прямой порт для локальной сети
function getApiBaseUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isLocalNetwork = /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  
  // если localhost или локальная сеть - используем прямой порт
  // иначе (продакшен) - относительный путь через nginx
  if (isLocalhost || isLocalNetwork) {
    const apiUrl = `${protocol}//${hostname}:3000`;
    console.log('[API Client] Development mode - direct port:', apiUrl);
    return apiUrl;
  } else {
    // продакшен: nginx проксирует /api к бэкенду
    const apiUrl = '/api';
    console.log('[API Client] Production mode - nginx proxy:', apiUrl);
    return apiUrl;
  }
}

export const apiClient = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getApiBaseUrl();
    
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.dispatchEvent(new CustomEvent('auth-unauthorized'));
    }
    return Promise.reject(error);
  }
);

export const apiRequest = async (endpoint, options = {}) => {
  try {
    const response = await apiClient({
      url: endpoint,
      ...options,
    });
    return response.data;
  } catch (error) {
    if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
      throw new Error('Network error: Cannot connect to server. Please check if backend is running.');
    }
    if (error.response) {
      const message = error.response?.data?.message || error.response?.data?.error || error.message || 'Request failed';
      throw new Error(message);
    }
    const message = error.message || 'Network error: Request failed';
    throw new Error(message);
  }
};

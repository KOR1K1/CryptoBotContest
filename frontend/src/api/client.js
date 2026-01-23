import axios from 'axios';

// определяем api url динамически по hostname
// чтобы работало с других устройств в сети
function getApiBaseUrl() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  const apiUrl = `${protocol}//${hostname}:3000`;
  
  console.log('[API Client] Current hostname:', hostname, 'API URL:', apiUrl);
  
  return apiUrl;
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

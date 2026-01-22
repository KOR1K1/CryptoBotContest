import axios from 'axios';

// Browser runs on host, so always use localhost:3000 (backend is exposed on host port 3000)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
apiClient.interceptors.request.use(
  (config) => {
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

// Handle 401 errors (unauthorized) - clear token and redirect to login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token is invalid or expired
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      // Dispatch event for App.jsx to handle redirect
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
    const message = error.response?.data?.message || error.message || 'Request failed';
    throw new Error(message);
  }
};

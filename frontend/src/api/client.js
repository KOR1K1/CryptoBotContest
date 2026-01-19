import axios from 'axios';

// Browser runs on host, so always use localhost:3000 (backend is exposed on host port 3000)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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

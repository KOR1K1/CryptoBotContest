import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    host: '0.0.0.0', // Allow external connections in Docker
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'cryptobot-contest-mrxmxr.bond',
      'www.cryptobot-contest-mrxmxr.bond',
      '.bond', // Allow all .bond subdomains
    ],
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://app:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

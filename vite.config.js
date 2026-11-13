import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.AQIRON_WEMMBU_API_PORT || 8787);

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('/node_modules/three/examples/jsm/')) return 'three-addons';
          if (normalized.includes('/node_modules/three/build/')) return 'three-core';
          if (normalized.includes('/node_modules/react-dom/') || normalized.includes('/node_modules/react/')) return 'react-vendor';
        }
      }
    }
  },
  preview: { host: '127.0.0.1' }
});

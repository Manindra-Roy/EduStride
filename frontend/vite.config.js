import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ensure .apk files always send Android package MIME headers so mobile browsers never rename them to .zip
const apkHeadersPlugin = () => ({
  name: 'apk-mime-headers',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.split('?')[0].toLowerCase().endsWith('.apk')) {
        const rawFilename = req.url.split('?')[0].split('/').pop() || 'EduStride.apk';
        const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'EduStride.apk';
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
      next();
    });
  }
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), apkHeadersPlugin()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'recharts-vendor': ['recharts'],
          'icons-vendor': ['lucide-react'],
          'socket-vendor': ['socket.io-client', 'axios']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true,
        secure: false
      }
    }
  }
});

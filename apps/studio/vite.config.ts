import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Studio dev server proxies /api → the OGF daemon (default :7621) so the
// new shadcn frontend reuses the existing backend untouched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 7630,
    proxy: {
      '/api': { target: 'http://localhost:7621', changeOrigin: true },
    },
  },
});

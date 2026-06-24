import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Studio dev server proxies /api → the OGF daemon (default :7621) so the
// new shadcn frontend reuses the existing backend untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Default 7630 for normal `npm run dev`; the preview harness overrides
    // via PORT so it can run a second instance on a free port.
    port: Number(process.env.PORT) || 7630,
    proxy: {
      '/api': { target: 'http://localhost:7621', changeOrigin: true },
    },
  },
});

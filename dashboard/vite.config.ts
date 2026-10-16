import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // The Express API (npm run dev:server) holds the GitHub token; the browser
    // only ever talks to /api on its own origin.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    // dist/server is the compiled API (tsc); dist/client is what it serves.
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});

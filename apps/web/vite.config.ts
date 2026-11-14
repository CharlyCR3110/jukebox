import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Loopback only: the dev/preview servers are never reachable from other machines.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173 },
});

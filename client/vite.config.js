import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Override with API_PROXY=http://localhost:xxxx npm run dev if the API runs elsewhere.
const API = process.env.API_PROXY ?? 'http://localhost:5001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API + WebSocket calls in dev so the httpOnly auth cookie just works.
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});

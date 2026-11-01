import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the SPA calls the relative path /api and Vite proxies it to the backend, so browser and API
// share one origin (required for the SameSite=Strict refresh cookie). Point it at your API with
// VITE_DEV_PROXY_TARGET (default http://localhost:4000).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000' },
    },
  };
});

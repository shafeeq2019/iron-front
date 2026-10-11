import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const serverPort = Number(process.env.SERVER_PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@iron/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: {
    host: true,
    port: 5173,
    proxy: { '/socket.io': { target: `http://localhost:${serverPort}`, ws: true }, '/api': `http://localhost:${serverPort}` },
  },
  preview: { host: true, proxy: { '/socket.io': { target: `http://localhost:${serverPort}`, ws: true }, '/api': `http://localhost:${serverPort}` } },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
});

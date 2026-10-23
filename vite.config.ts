import { defineConfig } from 'vite';

// Docker Desktop on Windows/macOS does not forward file system events into
// bind mounts reliably, so polling can be enabled through the environment.
const usePolling = process.env.VITE_USE_POLLING === 'true';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

import { defineConfig } from 'vite';

export default defineConfig({
  // Dev-Server: Auto-Reload bei Dateiänderungen
  server: {
    port: 3000,
    open: true,
  },
  // Preview-Server nach Build
  preview: {
    port: 3000,
  },
  // Build-Config: Vite-Build als Alternative zu build.sh
  build: {
    outDir: 'dist-vite',
    // Plain scripts (kein ES-Module-Bundling)
    rollupOptions: {
      input: 'index.html',
    },
  },
});

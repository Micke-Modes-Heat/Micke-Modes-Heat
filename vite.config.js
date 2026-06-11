import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    open: false,
  },
  preview: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/main.js',
      formats: ['iife'],
      name: 'App',
      fileName: 'app',
    },
    rollupOptions: {
      // Leaflet + html2canvas sind extern (kommen per CDN)
      external: ['leaflet'],
      output: {
        globals: { leaflet: 'L' },
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: false,
  },
});

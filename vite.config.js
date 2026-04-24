import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 3000,
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

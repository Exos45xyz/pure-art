import { defineConfig } from 'vite';

// three.js is most of the bundle; one file is fine for a single page.
export default defineConfig({
  build: { chunkSizeWarningLimit: 800 },
});

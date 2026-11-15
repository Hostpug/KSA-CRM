import { defineConfig } from 'astro/config';

// Static build: Express serves ../dist and the /api routes.
export default defineConfig({
  outDir: '../dist',
  build: {
    format: 'file', // /clients -> clients.html
    inlineStylesheets: 'never', // keeps the strict CSP (no inline styles)
  },
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 0 }, // no inline scripts/assets (CSP)
    server: {
      // `npm run dev:web` (Astro, :4321) talks to `npm run dev` (Express, :3000)
      proxy: { '/api': 'http://localhost:3000' },
    },
  },
});

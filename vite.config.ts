import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = (p: string) => resolve(import.meta.dirname, 'src/client', p);

export default defineConfig({
  root: 'src/client',
  server: {
    port: 5173,
    // note the trailing slash: '/api' alone would also capture the client's own /api.ts module
    proxy: {
      '/api/': 'http://localhost:8787',
      // on-chain mode (tee): the MagicBlock TEE RPC through our origin (no CORS), same ?token= query
      '/tee': { target: 'https://devnet-tee.magicblock.app', changeOrigin: true, rewrite: (p) => p.replace(/^\/tee\/?/, '/') },
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    // three pages: the landing page (/), the game (/play) and the back office (/admin)
    rollupOptions: { input: { main: page('index.html'), play: page('play/index.html'), admin: page('admin/index.html') } },
  },
});

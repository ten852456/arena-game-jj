import { defineConfig } from 'vite';

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
  },
});

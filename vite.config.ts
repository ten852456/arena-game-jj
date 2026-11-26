import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = (p: string) => resolve(import.meta.dirname, 'src/client', p);

export default defineConfig({
  root: 'src/client',
  plugins: [
    {
      // dev only: /play and /admin (no trailing slash, query kept) are their pages, as the production server does;
      // without this Vite serves the landing page there (and the landing page sends /play?… back to /play)
      name: 'page-dirs',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url) req.url = req.url.replace(/^\/(play|admin)(?=$|\?|#)/, '/$1/');
          next();
        });
      },
    },
  ],
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

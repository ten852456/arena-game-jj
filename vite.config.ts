import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/** the game version (package.json) for the client: release notes and the "new version" banner */
const VERSION = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version as string;

const page = (p: string) => resolve(import.meta.dirname, 'src/web', p);

export default defineConfig({
  root: 'src/web',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
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
    rollupOptions: {
      input: { main: page('index.html'), play: page('play/index.html'), admin: page('admin/index.html') },
      // perf pass: Phaser (~1.2 MB) in its own file, so a deploy only re-downloads the game's own code
      output: { manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined) },
    },
    chunkSizeWarningLimit: 1600,
  },
});

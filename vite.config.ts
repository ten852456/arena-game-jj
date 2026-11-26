import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/** the game version (package.json) for the client: release notes and the "new version" banner */
const VERSION = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version as string;

const page = (p: string) => resolve(import.meta.dirname, 'src/client', p);

export default defineConfig({
  root: 'src/client',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: {
    port: 5173,
    // note the trailing slash: '/api' alone would also capture the client's own /api.ts module
    proxy: { '/api/': 'http://localhost:8787' },
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

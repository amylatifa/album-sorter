import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/album-sorter/',
  plugins: [react()],
  server: {
    proxy: {
      '/api/musicbrainz': {
        target: 'https://musicbrainz.org',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/musicbrainz', '/ws/2/release-group/').replace(/query=/, 'fmt=json&limit=18&query='),
        headers: {
          'User-Agent': 'AlbumSorter/1.1.0 (https://album-sorter-amy-2026.bronze-elm-7740.chatgpt.site)',
          Accept: 'application/json',
        },
      },
    },
  },
});

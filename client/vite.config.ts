import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3017', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3017', ws: true, changeOrigin: true },
    },
  },
});

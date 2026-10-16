import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// base './' so the built site works from any folder or GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5199 },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
})

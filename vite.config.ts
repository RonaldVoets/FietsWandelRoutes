import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' zodat de app ook onder /FietsWandelRoutes/ (GitHub Pages) werkt
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
})

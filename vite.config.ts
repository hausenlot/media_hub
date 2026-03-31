import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  // server: {
  //   headers: {
  //     'Cross-Origin-Embedder-Policy': 'credentialless',
  //     'Cross-Origin-Opener-Policy': 'same-origin',
  //   },
  // },
})

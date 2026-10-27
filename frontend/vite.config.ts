import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// `--mode user` builds the public User app into dist-user (its own deployment); the default builds the staff
// Admin app into dist. src/main.tsx picks the app from VITE_APP, set here from the mode.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_APP': JSON.stringify(mode === 'user' ? 'user' : 'admin') },
  build: {
    outDir: mode === 'user' ? 'dist-user' : 'dist',
  },
}))

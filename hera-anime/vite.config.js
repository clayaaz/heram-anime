import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/anilist": {
        target: "https://graphql.anilist.co",
        changeOrigin: true,
        rewrite: () => "/",
      },
    },
  },
})


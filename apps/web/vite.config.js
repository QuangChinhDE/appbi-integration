import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const workspaceRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/app'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@modules': path.resolve(__dirname, '../../modules'),
      '@packages': path.resolve(__dirname, '../../packages'),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT || 3002),
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8010',
        changeOrigin: true,
      },
    },
    fs: {
      allow: [workspaceRoot],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
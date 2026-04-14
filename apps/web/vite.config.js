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
    port: 3000,
    host: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
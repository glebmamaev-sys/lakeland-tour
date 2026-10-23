import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// host: true — чтобы открывать с телефона в той же Wi-Fi сети
// base берётся из переменной окружения при сборке для GitHub Pages: VITE_BASE=/lakeland-tour/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { host: true, port: 5173 },
})

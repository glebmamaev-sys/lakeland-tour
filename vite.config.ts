import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

// dev-эндпоинт POST /__save?name=<файл> — сохраняет тело запроса в app/captures/ (съёмка из тура, Capture.tsx)
const saveCaptures = (): Plugin => ({
  name: 'save-captures',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      const name = basename(new URL(req.url ?? '/', 'http://x').searchParams.get('name') || 'capture.jpg')
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const dir = join(process.cwd(), 'captures'); mkdirSync(dir, { recursive: true })
        const file = join(dir, name); writeFileSync(file, Buffer.concat(chunks))
        res.setHeader('Content-Type', 'text/plain'); res.end(file)
      })
    })
  },
})

// host: true — чтобы открывать с телефона в той же Wi-Fi сети
// base берётся из переменной окружения при сборке для GitHub Pages: VITE_BASE=/lakeland-tour/
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), saveCaptures()],
  server: { host: true, port: 5173 },
})

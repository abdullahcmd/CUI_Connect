import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig } from 'vite'

// Same development certificate as the API (server/certs, made by `npm run cert`). When it exists, everything runs over HTTPS/WSS.
const key = '../server/certs/dev-key.pem', cert = '../server/certs/dev-cert.pem'
const tls = fs.existsSync(key) && fs.existsSync(cert)
const api = tls ? 'https://localhost:4000' : 'http://localhost:4000'

// The API and Socket.IO run on :4000; proxying keeps the browser on one origin (no CORS, one cookie-free token flow).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: tls ? { key: fs.readFileSync(key), cert: fs.readFileSync(cert) } : undefined,
    proxy: {
      '/api': { target: api, secure: false },
      '/socket.io': { target: api, ws: true, secure: false },
    },
  },
})

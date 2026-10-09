import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import { env } from './config/env.js'
import { connectDb } from './config/db.js'
import { createApp } from './app.js'
import { initSockets } from './sockets/index.js'
import { loadOrg } from './services/org.js'
import { expireDue } from './services/board.js'
import { runTicketJobs } from './services/tickets.js'
import { runDeadlineJobs } from './services/channels.js'
import { runAlumniJob } from './services/terms.js'
import { Message } from './models/index.js'

export async function start() {
  await connectDb()
  await loadOrg()
  const app = createApp()
  const tls = env.tlsKey && env.tlsCert && fs.existsSync(env.tlsKey) && fs.existsSync(env.tlsCert)
  if (env.isProd && !tls && process.env.BEHIND_TLS_PROXY !== 'true') throw new Error('Production needs TLS_KEY/TLS_CERT, or BEHIND_TLS_PROXY=true when nginx terminates HTTPS.')
  const server = tls ? https.createServer({ key: fs.readFileSync(env.tlsKey), cert: fs.readFileSync(env.tlsCert), minVersion: 'TLSv1.2' }, app) : http.createServer(app)
  await initSockets(server)

  // scheduled jobs: board expiry, ticket overdue/close, apply-by reminders, alumni deactivation, purge of removed messages
  const jobs = async () => {
    try {
      await expireDue(); await runTicketJobs(); await runDeadlineJobs(); await runAlumniJob()
      await Message.deleteMany({ deletedAt: { $ne: null }, purgeAt: { $lt: new Date() } })
    } catch (e) { console.error('job error', e.message) }
  }
  setInterval(jobs, 60_000).unref(); jobs()

  await new Promise((resolve) => server.listen(env.port, resolve))
  if (tls && env.httpRedirectPort) http.createServer((req, res) => { res.writeHead(301, { Location: `https://${(req.headers.host ?? 'localhost').split(':')[0]}:${env.port}${req.url}` }); res.end() }).listen(env.httpRedirectPort)
  console.log(`CUI Connect API + Socket.IO listening on ${tls ? 'https' : 'http'}://localhost:${env.port}${tls ? ' (TLS on)' : ' (plain HTTP: development only)'}`)
  return server
}

if (import.meta.url === `file://${process.argv[1]}`) start().catch((e) => { console.error(e); process.exit(1) })

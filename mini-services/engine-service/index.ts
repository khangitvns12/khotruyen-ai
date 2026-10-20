// ============================================================
// KhoTruyện AI — Engine service (port 3002)
// Background scraping + Gemini translation job engine.
// Runs FOREVER independent of the Next.js app / browser tabs.
// ============================================================

import { createServer } from 'http'
import { Server } from 'socket.io'

import { JobEngine } from './src/engine'
import { handleRest } from './src/router'
import { setIo, emitStats } from './src/emitter'
import { logs, logInfo, logWarn, logSuccess, logError } from './src/logger'

const PORT = 3002

const httpServer = createServer((req, res) => {
  void handleRest(req, res, engine)
})

// ---- socket.io (path /engine-io — NOT '/', that hijacks REST) ----
const io = new Server(httpServer, {
  path: '/engine-io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 2 * 1024 * 1024,
})

setIo(io)

io.on('connection', (socket) => {
  // catch-up: send current stats + recent logs to the newly connected client
  try {
    socket.emit('stats', engine.buildStats())
    socket.emit('logs', logs.slice(-50))
  } catch {
    /* ignore */
  }
  socket.on('error', (err) => logError(`Socket lỗi (${socket.id}): ${String(err)}`))
})

// ---- boot engine ----
const engine = new JobEngine()
engine.start()

// ---- periodic stats broadcast (engine also emits every 3s) ----
setInterval(() => {
  try {
    emitStats(engine.buildStats())
  } catch {
    /* ignore */
  }
}, 3000)

httpServer.listen(PORT, () => {
  logSuccess(`Engine online trên cổng ${PORT} — job chạy nền, độc lập với tab trình duyệt`)
  logInfo('Socket.io: /engine-io (client: io("/engine-io?XTransformPort=3002"))')
})

process.on('SIGTERM', () => {
  logWarn('Nhận SIGTERM — tắt engine service')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  logWarn('Nhận SIGINT — tắt engine service')
  httpServer.close(() => process.exit(0))
})


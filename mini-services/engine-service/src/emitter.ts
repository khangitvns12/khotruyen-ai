import type { Server } from 'socket.io'
import type { EngineStats, JobRow, LogEntry, NovelSummary } from './types'
import { jobDbToRow, getJob } from './db'
import { setLogBroadcast } from './logger'

let io: Server | null = null

export function setIo(server: Server) {
  io = server
  setLogBroadcast((entry) => emitLog(entry))
}

export function emit(event: string, data: unknown) {
  try {
    io?.emit(event, data)
  } catch {
    /* ignore */
  }
}

export function emitJob(jobId: string) {
  const row = getJob(jobId)
  if (!row) return
  emit('job', jobDbToRow(row))
}

export function emitNovel(novel: NovelSummary) {
  emit('novel', novel)
}

export function emitChapter(payload: {
  novelId: string
  idx: number
  status: string
  hasContent: boolean
  hasTranslated: boolean
}) {
  emit('chapter', payload)
}

export function emitStats(stats: EngineStats) {
  emit('stats', stats)
}

export function emitLog(entry: LogEntry) {
  emit('log', entry)
}

export function getIo(): Server | null {
  return io
}

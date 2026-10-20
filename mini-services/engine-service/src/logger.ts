import type { LogEntry, LogLevel } from './types'

const MAX_LOGS = 500

declare global {
  // eslint-disable-next-line no-var
  var __engineLogs: LogEntry[] | undefined
}

/** Ring buffer (survives hot reload via globalThis). */
export const logs: LogEntry[] =
  globalThis.__engineLogs ?? (globalThis.__engineLogs = [])

type Broadcast = (entry: LogEntry) => void
let broadcast: Broadcast | null = null

export function setLogBroadcast(fn: Broadcast | null) {
  broadcast = fn
}

export function log(level: LogLevel, msg: string): void {
  const entry: LogEntry = { ts: Date.now(), level, msg }
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
  const tag = level === 'info' ? 'INFO ' : level === 'warn' ? 'WARN ' : level === 'error' ? 'ERR  ' : 'OK   '
  console.log(`[${new Date(entry.ts).toISOString()}] [${tag}] ${msg}`)
  try {
    broadcast?.(entry)
  } catch {
    /* ignore broadcast errors */
  }
}

export const logInfo = (msg: string) => log('info', msg)
export const logWarn = (msg: string) => log('warn', msg)
export const logError = (msg: string) => log('error', msg)
export const logSuccess = (msg: string) => log('success', msg)

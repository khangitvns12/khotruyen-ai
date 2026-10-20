import { get } from './db'
import { DEFAULT_SETTINGS } from './types'
import type { AppSettings } from './types'
import { logWarn } from './logger'

/** Merge the DB `settings` row `app` (JSON) over DEFAULT_SETTINGS. */
export function loadSettings(): AppSettings {
  try {
    const row = get<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ?', 'app')
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch (e: unknown) {
    logWarn(`Không đọc được settings từ DB: ${(e as Error)?.message ?? e}`)
  }
  return { ...DEFAULT_SETTINGS }
}

export function hasActiveGeminiKeys(): boolean {
  const row = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM api_keys WHERE active = 1 AND status != 'error'"
  )
  return (row?.n ?? 0) > 0
}

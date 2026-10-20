// ============================================================
// Read/CRUD API helpers (mirror of the Next.js /api/* routes in
// src/app/api/** + src/lib/api-helpers.ts).
//
// Purpose: when the app is deployed to Vercel (remote-engine mode)
// the engine is the SINGLE source of truth — the Next.js routes
// simply relay requests here. These handlers MUST produce
// byte-identical JSON shapes (same envelopes, same Vietnamese
// error strings, same defaults/masking/validation) as the local
// Prisma-based routes.
//
// Keep in sync manually with src/lib/api-helpers.ts — the engine
// is a separate Bun project and cannot import from '@/lib/*'.
// ============================================================

import { all, get, run, now, uuid, novelRowToSummary } from './db'
import { DEFAULT_SETTINGS } from './types'
import type { ApiKeyView, AppSettings, NovelSummary, ChapterSummary, ChapterFull } from './types'

/** Error carrying an HTTP status (mirror of HttpError in api-helpers.ts). */
export class ApiHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ------------------------------------------------------------
// Raw row shapes (snake_case DB columns)
// ------------------------------------------------------------

interface ApiKeyRawRow {
  id: string
  provider: string
  label: string | null
  key_tail: string | null
  active: number
  usage_count: number
  error_count: number
  status: string
  last_used_at: number | null
  created_at: number
}

interface ChapterSummaryRow {
  id: string
  novel_id: string
  idx: number
  title: string
  status: string
  error: string | null
  hasContent: number
  hasTranslated: number
}

interface ChapterFullRow extends ChapterSummaryRow {
  source_url: string
  content: string | null
  translated: string | null
  scraped_at: number | null
  translated_at: number | null
}

// ------------------------------------------------------------
// Novels (mirror of listNovelSummaries / findNovelSummary)
// ------------------------------------------------------------

/** List novels (newest first) with an optional title/author filter. */
export function listNovelSummaries(q: string): NovelSummary[] {
  const trimmed = q.trim()
  let where = ''
  const params: unknown[] = []
  if (trimmed) {
    // escape LIKE wildcards so user input matches literally
    const pattern = `%${trimmed.replace(/([%_\\])/g, '\\$1')}%`
    where = ` WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\'`
    params.push(pattern, pattern)
  }
  const rows = all<Record<string, unknown>>(
    `SELECT * FROM novels${where} ORDER BY updated_at DESC`,
    ...params
  )
  return rows.map((r) => novelRowToSummary(r as never))
}

/** Fetch one novel as a NovelSummary, or null when missing. */
export function findNovelSummary(id: string): NovelSummary | null {
  const row = get<Record<string, unknown>>('SELECT * FROM novels WHERE id = ? LIMIT 1', id)
  return row ? novelRowToSummary(row as never) : null
}

// ------------------------------------------------------------
// Chapters (mirror of the raw SQL in api-helpers.ts / routes)
// ------------------------------------------------------------

/** Chapter summaries for a novel, idx ASC. */
export function listChapterSummaries(novelId: string): ChapterSummary[] {
  const rows = all<ChapterSummaryRow>(
    `SELECT id, novel_id, idx, title, status, error,
       (content IS NOT NULL) AS hasContent, (translated IS NOT NULL) AS hasTranslated
     FROM chapters WHERE novel_id = ? ORDER BY idx ASC`,
    novelId
  )
  return rows.map((r) => ({
    id: r.id,
    novelId: r.novel_id,
    idx: r.idx,
    title: r.title,
    status: r.status,
    error: r.error,
    hasContent: Boolean(r.hasContent),
    hasTranslated: Boolean(r.hasTranslated),
  }))
}

/** Fetch one chapter (1-based idx) as ChapterFull, or null when missing. */
export function findChapterFull(novelId: string, idx: number): ChapterFull | null {
  const r = get<ChapterFullRow>(
    `SELECT id, novel_id, idx, title, status, error, source_url, content, translated,
       scraped_at, translated_at,
       (content IS NOT NULL) AS hasContent, (translated IS NOT NULL) AS hasTranslated
     FROM chapters WHERE novel_id = ? AND idx = ? LIMIT 1`,
    novelId,
    idx
  )
  if (!r) return null
  return {
    id: r.id,
    novelId: r.novel_id,
    idx: r.idx,
    title: r.title,
    status: r.status,
    error: r.error,
    hasContent: Boolean(r.hasContent),
    hasTranslated: Boolean(r.hasTranslated),
    sourceUrl: r.source_url,
    content: r.content,
    translated: r.translated,
    scrapedAt: r.scraped_at,
    translatedAt: r.translated_at,
  }
}

// ------------------------------------------------------------
// API keys (never expose the full key — mirror of api-helpers.ts)
// ------------------------------------------------------------

const API_KEY_SELECT = `SELECT id, provider, label, key_tail, active, usage_count, error_count, status, last_used_at, created_at FROM api_keys`

function keyRowToView(r: ApiKeyRawRow): ApiKeyView {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    keyTail: r.key_tail,
    active: Boolean(r.active),
    usageCount: r.usage_count,
    errorCount: r.error_count,
    status: r.status,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }
}

/** List all keys (newest first) as ApiKeyView. */
export function listApiKeyViews(): ApiKeyView[] {
  const rows = all<ApiKeyRawRow>(`${API_KEY_SELECT} ORDER BY created_at DESC`)
  return rows.map(keyRowToView)
}

/** Fetch one key as ApiKeyView, or null when missing. */
export function findApiKeyView(id: string): ApiKeyView | null {
  const row = get<ApiKeyRawRow>(`${API_KEY_SELECT} WHERE id = ? LIMIT 1`, id)
  return row ? keyRowToView(row) : null
}

/** Insert a new Gemini key and return its view. */
export function insertApiKey(input: { key: string; label: string | null }): ApiKeyView {
  const id = uuid()
  const ts = now()
  const keyTail = input.key.slice(-4)
  run(
    `INSERT INTO api_keys (id, provider, label, key, key_tail, active, usage_count, error_count, status, last_used_at, created_at)
     VALUES (?, 'gemini', ?, ?, ?, 1, 0, 0, 'ok', NULL, ?)`,
    id,
    input.label,
    input.key,
    keyTail,
    ts
  )
  return {
    id,
    provider: 'gemini',
    label: input.label,
    keyTail,
    active: true,
    usageCount: 0,
    errorCount: 0,
    status: 'ok',
    lastUsedAt: null,
    createdAt: ts,
  }
}

/** Update active/label; returns the updated view or null when the key is missing. */
export function updateApiKeyFields(
  id: string,
  data: { active?: boolean; label?: string | null }
): ApiKeyView | null {
  const sets: string[] = []
  const params: unknown[] = []
  if (data.active !== undefined) {
    sets.push('active = ?')
    params.push(data.active ? 1 : 0)
  }
  if (data.label !== undefined) {
    sets.push('label = ?')
    params.push(data.label)
  }
  if (sets.length === 0) return findApiKeyView(id)
  const existing = get<{ id: string }>('SELECT id FROM api_keys WHERE id = ?', id)
  if (!existing) return null
  run(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, ...params, id)
  return findApiKeyView(id)
}

/** Delete a key (idempotent — deleting a missing key is not an error). */
export function deleteApiKeyRow(id: string): void {
  run('DELETE FROM api_keys WHERE id = ?', id)
}

// ------------------------------------------------------------
// Settings (row key='app', value = JSON of AppSettings)
// ------------------------------------------------------------

const SETTINGS_ROW_KEY = 'app'

/**
 * Load settings merged over DEFAULT_SETTINGS (never throws on corrupt JSON).
 * Mirrors the strict Next.js loader: only keys present in DEFAULT_SETTINGS
 * are picked from the stored JSON.
 */
export function loadAppSettings(): AppSettings {
  const row = get<{ key: string; value: string }>(
    'SELECT key, value FROM settings WHERE key = ?',
    SETTINGS_ROW_KEY
  )
  if (row?.value) {
    try {
      const parsed: unknown = JSON.parse(row.value)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, unknown>
        const picked: Partial<AppSettings> = {}
        for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
          if (key in raw) (picked as Record<string, unknown>)[key] = raw[key]
        }
        return { ...DEFAULT_SETTINGS, ...picked }
      }
    } catch {
      // corrupted JSON → fall back to defaults
    }
  }
  return { ...DEFAULT_SETTINGS }
}

/** Mask the Supabase service key for API responses: `••••` + last 4 chars. */
export function maskSettings(settings: AppSettings): AppSettings {
  const masked = { ...settings }
  if (masked.supabaseKey) masked.supabaseKey = '••••' + masked.supabaseKey.slice(-4)
  return masked
}

/** Upsert the settings row. */
export function saveAppSettings(next: AppSettings): void {
  const value = JSON.stringify(next)
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    SETTINGS_ROW_KEY,
    value
  )
}

/**
 * Validate + merge a partial settings patch over `current`.
 * Throws ApiHttpError(400) on invalid values.
 *
 * supabaseKey handling: absent → keep stored; '' → clear;
 * starts with '•' (masked echo) → keep stored; otherwise save new.
 */
export function applySettingsPatch(
  current: AppSettings,
  patch: Record<string, unknown>
): AppSettings {
  const next: AppSettings = { ...current }
  const target = next as Record<string, unknown>

  // Numeric fields with allowed ranges
  const numericRules: Array<{ key: keyof AppSettings; min: number; max: number }> = [
    { key: 'translateConcurrency', min: 1, max: 8 },
    { key: 'scrapeConcurrency', min: 1, max: 8 },
    { key: 'translateDelayMs', min: 0, max: 30000 },
    { key: 'scrapeDelayMs', min: 0, max: 30000 },
    { key: 'chunkSize', min: 500, max: 8000 },
  ]
  for (const rule of numericRules) {
    if (rule.key in patch) {
      const v = patch[rule.key]
      if (typeof v !== 'number' || !Number.isInteger(v) || v < rule.min || v > rule.max) {
        throw new ApiHttpError(400, `${rule.key} phải là số nguyên từ ${rule.min} đến ${rule.max}`)
      }
      target[rule.key] = v
    }
  }

  // Boolean fields
  const boolKeys: Array<keyof AppSettings> = ['autoTranslate', 'supabaseEnabled', 'autoSyncSupabase']
  for (const key of boolKeys) {
    if (key in patch) {
      const v = patch[key]
      if (typeof v !== 'boolean') {
        throw new ApiHttpError(400, `${key} phải là boolean (true/false)`)
      }
      target[key] = v
    }
  }

  // Plain string fields
  const stringKeys: Array<keyof AppSettings> = ['geminiModel', 'sourceLang', 'targetLang', 'supabaseUrl']
  for (const key of stringKeys) {
    if (key in patch) {
      const v = patch[key]
      if (typeof v !== 'string') {
        throw new ApiHttpError(400, `${key} phải là chuỗi`)
      }
      target[key] = v.trim()
    }
  }

  // supabaseKey — see doc comment above
  if ('supabaseKey' in patch) {
    const v = patch.supabaseKey
    if (typeof v !== 'string') {
      throw new ApiHttpError(400, 'supabaseKey phải là chuỗi')
    }
    const trimmed = v.trim()
    if (trimmed === '') {
      next.supabaseKey = '' // explicit clear
    } else if (trimmed.startsWith('•')) {
      // masked value echoed back by the UI → keep the stored key
    } else {
      next.supabaseKey = trimmed // save new key
    }
  }

  return next
}

// ------------------------------------------------------------
// Export API helpers (mirror of api-helpers.ts)
// ------------------------------------------------------------

/**
 * Parse the `lang` query parameter for export endpoints.
 * Empty/absent → `fallback`; invalid → ApiHttpError(400).
 */
export function parseExportLang(
  value: string | null,
  fallback: string,
  allowed: string[] = ['vi', 'src', 'both']
): string {
  if (value === null || value.trim() === '') return fallback
  const v = value.trim()
  if (allowed.includes(v)) return v
  throw new ApiHttpError(400, `Tham số lang không hợp lệ (${allowed.join(' | ')})`)
}

/** Turn a (possibly Vietnamese/Chinese) title into a safe ASCII filename stem. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return cleaned.length > 0 ? cleaned : 'truyen'
}

/** Validate a 1-based chapter idx path parameter; throws ApiHttpError(400). */
export function parseChapterIdx(idx: string): number {
  if (!/^\d+$/.test(idx)) {
    throw new ApiHttpError(400, 'Số chương không hợp lệ')
  }
  const idxNum = Number.parseInt(idx, 10)
  if (idxNum < 1) {
    throw new ApiHttpError(400, 'Số chương phải lớn hơn hoặc bằng 1')
  }
  return idxNum
}

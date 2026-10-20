// ============================================================
// KhoTruyện AI — shared helpers + data access for /api/* routes
//
// IMPORTANT Prisma/SQLite note: epoch-ms timestamps (1.79e12)
// exceed the 32-bit INT range Prisma validates for `Int` model
// fields, so typed reads/writes of rows containing timestamps
// throw "Conversion failed ... does not fit in an INT column".
// The engine writes those columns via bun:sqlite (64-bit safe),
// therefore ALL queries touching timestamp columns go through
// `$queryRaw`/`$executeRaw` here, with `CAST(<ts> AS REAL)` so
// values come back as regular JS numbers. Typed Prisma access is
// only used where it is provably safe (settings table, count()
// aggregates, selects that exclude timestamp columns).
// ============================================================

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  DEFAULT_SETTINGS,
  type ApiKeyView,
  type AppSettings,
  type ChapterFull,
  type ChapterStatus,
  type JobRow,
  type JobStatus,
  type JobType,
  type NovelSummary,
} from '@/lib/types'

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

/** Error carrying an HTTP status; rendered by errorResponse(). */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Map any thrown value to the `{ ok:false, error }` envelope (500 by default). */
export function errorResponse(err: unknown): NextResponse {
  const status = err instanceof HttpError ? err.status : 500
  const message = err instanceof Error ? err.message : 'Lỗi máy chủ nội bộ'
  return NextResponse.json({ ok: false, error: message }, { status })
}

// ------------------------------------------------------------
// Request body
// ------------------------------------------------------------

/** Parse the request body as a JSON object; HttpError(400) on anything else. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new HttpError(400, 'JSON không hợp lệ')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON không hợp lệ')
  }
  return parsed as Record<string, unknown>
}

// ------------------------------------------------------------
// Raw row shapes (column aliases keep them camelCase)
// ------------------------------------------------------------

interface NovelRawRow {
  id: string
  sourceSite: string
  sourceUrl: string
  title: string
  author: string | null
  coverUrl: string | null
  description: string | null
  lang: string
  status: string | null
  totalChapters: number
  scrapedCount: number
  translatedCount: number
  createdAt: number
  updatedAt: number
}

interface ApiKeyRawRow {
  id: string
  provider: string
  label: string | null
  keyTail: string | null
  active: number | boolean
  usageCount: number
  errorCount: number
  status: string
  lastUsedAt: number | null
  createdAt: number
}

interface JobRawRow {
  id: string
  type: string
  status: string
  novelId: string | null
  params: string
  progress: number
  total: number
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

interface ChapterRawRow {
  id: string
  novelId: string
  idx: number
  title: string
  status: string
  error: string | null
  sourceUrl: string
  content: string | null
  translated: string | null
  scrapedAt: number | null
  translatedAt: number | null
  hasContent: number | boolean
  hasTranslated: number | boolean
}

const NOVEL_SELECT = Prisma.sql`
  SELECT id, source_site AS "sourceSite", source_url AS "sourceUrl", title, author,
    cover_url AS "coverUrl", description, lang, status,
    total_chapters AS "totalChapters", scraped_count AS "scrapedCount",
    translated_count AS "translatedCount",
    CAST(created_at AS REAL) AS "createdAt", CAST(updated_at AS REAL) AS "updatedAt"
  FROM novels
`

const API_KEY_SELECT = Prisma.sql`
  SELECT id, provider, label, key_tail AS "keyTail", active, usage_count AS "usageCount",
    error_count AS "errorCount", status,
    CAST(last_used_at AS REAL) AS "lastUsedAt", CAST(created_at AS REAL) AS "createdAt"
  FROM api_keys
`

// ------------------------------------------------------------
// Novels
// ------------------------------------------------------------

function novelRowToSummary(r: NovelRawRow): NovelSummary {
  return {
    id: r.id,
    sourceSite: r.sourceSite,
    sourceUrl: r.sourceUrl,
    title: r.title,
    author: r.author,
    coverUrl: r.coverUrl,
    description: r.description,
    lang: r.lang,
    status: r.status,
    totalChapters: r.totalChapters,
    scrapedCount: r.scrapedCount,
    translatedCount: r.translatedCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

/** List novels (newest first) with an optional title/author filter. */
export async function listNovelSummaries(q: string): Promise<NovelSummary[]> {
  const trimmed = q.trim()
  let condition = Prisma.empty
  if (trimmed) {
    // escape LIKE wildcards so user input matches literally
    const pattern = `%${trimmed.replace(/([%_\\])/g, '\\$1')}%`
    condition = Prisma.sql`
      WHERE title LIKE ${pattern} ESCAPE '\\' OR author LIKE ${pattern} ESCAPE '\\'`
  }
  const rows = await db.$queryRaw<NovelRawRow[]>`
    ${NOVEL_SELECT} ${condition} ORDER BY updated_at DESC
  `
  return rows.map(novelRowToSummary)
}

/** Fetch one novel as a NovelSummary, or null when missing. */
export async function findNovelSummary(id: string): Promise<NovelSummary | null> {
  const rows = await db.$queryRaw<NovelRawRow[]>`
    ${NOVEL_SELECT} WHERE id = ${id} LIMIT 1
  `
  return rows.length > 0 ? novelRowToSummary(rows[0]) : null
}

// ------------------------------------------------------------
// Chapters
// ------------------------------------------------------------

function chapterRowToFull(r: ChapterRawRow): ChapterFull {
  return {
    id: r.id,
    novelId: r.novelId,
    idx: r.idx,
    title: r.title,
    status: r.status as ChapterStatus,
    error: r.error,
    hasContent: Boolean(r.hasContent),
    hasTranslated: Boolean(r.hasTranslated),
    sourceUrl: r.sourceUrl,
    content: r.content,
    translated: r.translated,
    scrapedAt: r.scrapedAt,
    translatedAt: r.translatedAt,
  }
}

/** Fetch one chapter (1-based idx) as ChapterFull, or null when missing. */
export async function findChapterFull(novelId: string, idx: number): Promise<ChapterFull | null> {
  const rows = await db.$queryRaw<ChapterRawRow[]>`
    SELECT id, novel_id AS "novelId", idx, title, status, error, source_url AS "sourceUrl",
      content, translated,
      CAST(scraped_at AS REAL) AS "scrapedAt", CAST(translated_at AS REAL) AS "translatedAt",
      (content IS NOT NULL) AS "hasContent", (translated IS NOT NULL) AS "hasTranslated"
    FROM chapters
    WHERE novel_id = ${novelId} AND idx = ${idx}
    LIMIT 1
  `
  return rows.length > 0 ? chapterRowToFull(rows[0]) : null
}

// ------------------------------------------------------------
// Jobs
// ------------------------------------------------------------

function jobRowToJobRow(r: JobRawRow, novelTitle: string | null): JobRow {
  let params: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(r.params)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      params = parsed as Record<string, unknown>
    }
  } catch {
    // corrupted params → empty object
  }
  return {
    id: r.id,
    type: r.type as JobType,
    status: r.status as JobStatus,
    novelId: r.novelId,
    novelTitle,
    params,
    progress: r.progress,
    total: r.total,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    finishedAt: r.finishedAt,
  }
}

/** List the most recent jobs with novel titles joined. */
export async function listJobRows(limit = 100): Promise<JobRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500)
  const rows = await db.$queryRaw<JobRawRow[]>`
    SELECT id, type, status, novel_id AS "novelId", params, progress, total, error,
      CAST(created_at AS REAL) AS "createdAt", CAST(updated_at AS REAL) AS "updatedAt",
      CAST(finished_at AS REAL) AS "finishedAt"
    FROM jobs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `
  const novelIds = [...new Set(rows.map((r) => r.novelId).filter((v): v is string => v !== null))]
  const titleById = new Map<string, string>()
  if (novelIds.length > 0) {
    const titleRows = await db.$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id, title FROM novels WHERE id IN (${Prisma.join(novelIds)})
    `
    for (const t of titleRows) titleById.set(t.id, t.title)
  }
  return rows.map((r) => jobRowToJobRow(r, r.novelId ? titleById.get(r.novelId) ?? null : null))
}

// ------------------------------------------------------------
// API keys (never expose the full key)
// ------------------------------------------------------------

function keyRowToView(r: ApiKeyRawRow): ApiKeyView {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    keyTail: r.keyTail,
    active: Boolean(r.active),
    usageCount: r.usageCount,
    errorCount: r.errorCount,
    status: r.status,
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt,
  }
}

/** List all keys (newest first) as ApiKeyView. */
export async function listApiKeyViews(): Promise<ApiKeyView[]> {
  const rows = await db.$queryRaw<ApiKeyRawRow[]>`
    ${API_KEY_SELECT} ORDER BY created_at DESC
  `
  return rows.map(keyRowToView)
}

/** Fetch one key as ApiKeyView, or null when missing. */
export async function findApiKeyView(id: string): Promise<ApiKeyView | null> {
  const rows = await db.$queryRaw<ApiKeyRawRow[]>`
    ${API_KEY_SELECT} WHERE id = ${id} LIMIT 1
  `
  return rows.length > 0 ? keyRowToView(rows[0]) : null
}

/** Insert a new Gemini key and return its view (raw insert: epoch-ms > INT32). */
export async function insertApiKey(input: { key: string; label: string | null }): Promise<ApiKeyView> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const keyTail = input.key.slice(-4)
  await db.$executeRaw`
    INSERT INTO api_keys (id, provider, label, key, key_tail, active, usage_count, error_count, status, last_used_at, created_at)
    VALUES (${id}, 'gemini', ${input.label}, ${input.key}, ${keyTail}, 1, 0, 0, 'ok', NULL, ${now})
  `
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
    createdAt: now,
  }
}

/** Update active/label; returns the updated view or null when the key is missing. */
export async function updateApiKeyFields(
  id: string,
  data: { active?: boolean; label?: string | null },
): Promise<ApiKeyView | null> {
  const sets: Prisma.Sql[] = []
  if (data.active !== undefined) sets.push(Prisma.sql`active = ${data.active ? 1 : 0}`)
  if (data.label !== undefined) sets.push(Prisma.sql`label = ${data.label}`)
  if (sets.length === 0) return findApiKeyView(id)
  const affected = await db.$executeRaw`
    UPDATE api_keys SET ${Prisma.join(sets)} WHERE id = ${id}
  `
  if (affected === 0) return null
  return findApiKeyView(id)
}

/** Delete a key (idempotent — deleting a missing key is not an error). */
export async function deleteApiKeyRow(id: string): Promise<void> {
  await db.$executeRaw`
    DELETE FROM api_keys WHERE id = ${id}
  `
}

// ------------------------------------------------------------
// Settings (row key='app', value = JSON of AppSettings; no Int
// columns in the settings table → typed Prisma access is safe)
// ------------------------------------------------------------

const SETTINGS_ROW_KEY = 'app'

/** Load settings merged over DEFAULT_SETTINGS (never throws on corrupt JSON). */
export async function loadSettings(): Promise<AppSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_ROW_KEY } })
  if (!row) return { ...DEFAULT_SETTINGS }
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
  return { ...DEFAULT_SETTINGS }
}

/** Mask the Supabase service key for API responses: `••••` + last 4 chars. */
export function maskSettings(settings: AppSettings): AppSettings {
  const masked = { ...settings }
  if (masked.supabaseKey) masked.supabaseKey = '••••' + masked.supabaseKey.slice(-4)
  return masked
}

/** Upsert the settings row. */
export async function saveSettings(next: AppSettings): Promise<void> {
  const value = JSON.stringify(next)
  await db.setting.upsert({
    where: { key: SETTINGS_ROW_KEY },
    update: { value },
    create: { key: SETTINGS_ROW_KEY, value },
  })
}

/**
 * Validate + merge a partial settings patch over `current`.
 * Throws HttpError(400) on invalid values.
 *
 * supabaseKey handling: absent → keep stored; '' → clear;
 * starts with '•' (masked echo) → keep stored; otherwise save new.
 */
export function applySettingsPatch(current: AppSettings, patch: Record<string, unknown>): AppSettings {
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
        throw new HttpError(400, `${rule.key} phải là số nguyên từ ${rule.min} đến ${rule.max}`)
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
        throw new HttpError(400, `${key} phải là boolean (true/false)`)
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
        throw new HttpError(400, `${key} phải là chuỗi`)
      }
      target[key] = v.trim()
    }
  }

  // supabaseKey — see doc comment above
  if ('supabaseKey' in patch) {
    const v = patch.supabaseKey
    if (typeof v !== 'string') {
      throw new HttpError(400, 'supabaseKey phải là chuỗi')
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
// Export API helpers
// ------------------------------------------------------------

/**
 * Parse the `lang` query parameter for export endpoints.
 * Empty/absent → `fallback`; invalid → HttpError(400).
 */
export function parseExportLang(
  value: string | null,
  fallback: string,
  allowed: string[] = ['vi', 'src', 'both'],
): string {
  if (value === null || value.trim() === '') return fallback
  const v = value.trim()
  if (allowed.includes(v)) return v
  throw new HttpError(400, `Tham số lang không hợp lệ (${allowed.join(' | ')})`)
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

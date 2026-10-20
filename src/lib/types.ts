// ============================================================
// KhoTruyện AI — Shared types (contract between app + engine)
// Timestamps are epoch milliseconds (number).
// ============================================================

export type ChapterStatus =
  | 'pending'
  | 'scraped'
  | 'translating'
  | 'translated'
  | 'error'

export type JobType = 'scrape' | 'translate' | 'retry'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled'

/** Response envelope used by ALL HTTP APIs (app + engine). */
export interface ApiOk<T = Record<string, unknown>> {
  ok: true
  data?: T
  [k: string]: unknown
}
export interface ApiErr {
  ok: false
  error: string
}

export interface NovelSummary {
  id: string
  sourceSite: string // '69shuba' | 'xbiquge' | 'novel543' | 'hjwzw' | 'truyenfull'
  sourceUrl: string
  title: string
  author: string | null
  coverUrl: string | null
  description: string | null
  lang: string // 'zh' | 'zh-TW' | 'vi'
  status: string | null // e.g. '完结' | '连载中' | 'Full'
  totalChapters: number
  scrapedCount: number
  translatedCount: number
  createdAt: number
  updatedAt: number
}

export interface ChapterSummary {
  id: string
  novelId: string
  idx: number // 1-based
  title: string
  status: ChapterStatus
  hasContent: boolean
  hasTranslated: boolean
  error: string | null
}

export interface ChapterFull extends ChapterSummary {
  sourceUrl: string
  content: string | null
  translated: string | null
  scrapedAt: number | null
  translatedAt: number | null
}

export interface JobRow {
  id: string
  type: JobType
  status: JobStatus
  novelId: string | null
  novelTitle?: string | null
  params: Record<string, unknown> // { url, autoTranslate, chapterFrom, chapterTo, force ... }
  progress: number
  total: number
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

/** Never expose the full key to the frontend. */
export interface ApiKeyView {
  id: string
  provider: string
  label: string | null
  keyTail: string | null // last 4 chars
  active: boolean
  usageCount: number
  errorCount: number
  status: string // ok | rate_limited | error
  lastUsedAt: number | null
  createdAt: number
}

export interface AppSettings {
  geminiModel: string
  sourceLang: string // 'auto' | 'zh' | 'zh-TW' | 'vi' | ...
  targetLang: string // default 'vi'
  translateConcurrency: number
  translateDelayMs: number
  scrapeConcurrency: number
  scrapeDelayMs: number
  autoTranslate: boolean
  chunkSize: number // max chars per Gemini chunk
  supabaseUrl: string
  supabaseKey: string
  supabaseEnabled: boolean
  autoSyncSupabase: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  geminiModel: 'gemini-2.5-flash',
  sourceLang: 'auto',
  targetLang: 'vi',
  translateConcurrency: 2,
  translateDelayMs: 1200,
  scrapeConcurrency: 3,
  scrapeDelayMs: 700,
  autoTranslate: true,
  chunkSize: 1800,
  supabaseUrl: '',
  supabaseKey: '',
  supabaseEnabled: false,
  autoSyncSupabase: false,
}

export interface EngineStats {
  novels: number
  chapters: number
  scraped: number
  translated: number
  runningJobs: number
  queuedJobs: number
  keysTotal: number
  keysActive: number
  keysRateLimited: number
  keysError: number
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success'

export interface LogEntry {
  ts: number
  level: LogLevel
  msg: string
}

export interface PreviewChapter {
  title: string
  url: string
}

export interface PreviewResult {
  site: string
  siteName: string
  url: string
  title: string
  author: string | null
  cover: string | null
  description: string | null
  status: string | null
  lang: string
  chapterCount: number
  sample: PreviewChapter[] // first 10 chapters
}

export interface SiteInfo {
  id: string
  name: string
  host: string
  lang: string
  url: string
}

export const SITES: SiteInfo[] = [
  { id: '69shuba', name: '69书吧', host: '69shuba.com', lang: 'zh', url: 'https://www.69shuba.com' },
  { id: 'xbiquge', name: '新笔趣阁', host: 'xbiquge.info', lang: 'zh', url: 'https://www.xbiquge.info' },
  { id: 'novel543', name: '小說543', host: 'novel543.com', lang: 'zh-TW', url: 'https://www.novel543.com' },
  { id: 'hjwzw', name: '黃金屋', host: 'hjwzw.com', lang: 'zh-TW', url: 'https://tw.hjwzw.com' },
  { id: 'truyenfull', name: 'TruyenFull', host: 'truyenfull.vn', lang: 'vi', url: 'https://truyenfull.live' },
]

export const ENGINE_PORT = 3002
export const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:3002'
/**
 * Remote-engine mode: when the engine runs on another host (Vercel deployment),
 * ALL /api data routes proxy to it instead of reading SQLite via Prisma.
 * Enabled by ENGINE_READS=remote, or automatically when ENGINE_URL points to a non-local host.
 */
export const REMOTE_ENGINE =
  process.env.ENGINE_READS === 'remote' ||
  (!!process.env.ENGINE_URL &&
    !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?/i.test(process.env.ENGINE_URL))

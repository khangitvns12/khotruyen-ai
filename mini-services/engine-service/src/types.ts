// ============================================================
// KhoTruyện AI — Engine local types (mirror of src/lib/types.ts)
// Timestamps are epoch milliseconds (number).
// ============================================================

export type ChapterStatus = 'pending' | 'scraped' | 'translating' | 'translated' | 'error'
export type JobType = 'scrape' | 'translate' | 'retry'
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface NovelSummary {
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

export interface JobRow {
  id: string
  type: JobType
  status: JobStatus
  novelId: string | null
  novelTitle?: string | null
  params: Record<string, unknown>
  progress: number
  total: number
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

export interface AppSettings {
  geminiModel: string
  sourceLang: string
  targetLang: string
  translateConcurrency: number
  translateDelayMs: number
  scrapeConcurrency: number
  scrapeDelayMs: number
  autoTranslate: boolean
  chunkSize: number
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
  sample: PreviewChapter[]
}

// ---------------- DB row shapes ----------------

export interface NovelRow {
  id: string
  source_site: string
  source_url: string
  title: string
  author: string | null
  cover_url: string | null
  description: string | null
  lang: string
  status: string | null
  total_chapters: number
  scraped_count: number
  translated_count: number
  created_at: number
  updated_at: number
}

export interface ChapterRow {
  id: string
  novel_id: string
  idx: number
  title: string
  source_url: string
  content: string | null
  translated: string | null
  status: string
  error: string | null
  scraped_at: number | null
  translated_at: number | null
}

export interface JobRowDb {
  id: string
  type: string
  status: string
  novel_id: string | null
  params: string
  progress: number
  total: number
  error: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

export interface ApiKeyRow {
  id: string
  provider: string
  label: string | null
  key: string
  key_tail: string | null
  active: number
  usage_count: number
  error_count: number
  status: string
  last_used_at: number | null
  created_at: number
}

// ---------------- Adapter contract ----------------

export interface BookMeta {
  title: string
  author: string | null
  cover: string | null
  description: string | null
  status: string | null
  lang: string
}

export interface ChapterRef {
  title: string
  url: string
}

export interface BookInfo {
  meta: BookMeta
  chapters: ChapterRef[]
}

export interface ChapterContent {
  title: string
  content: string
}

export interface FetchChapterOpts {
  bookUrl?: string
}

export interface SiteAdapter {
  id: string
  siteName: string
  lang: string
  hosts: string[]
  /** Canonical book list URL for a user-supplied URL. */
  normalizeUrl(url: string): string
  /** Fetch book meta + full ascending chapter list. */
  fetchBook(url: string): Promise<BookInfo>
  /** Fetch one chapter (multi-page aware), text paragraphs separated by \n\n. */
  fetchChapter(url: string, opts?: FetchChapterOpts): Promise<ChapterContent>
}

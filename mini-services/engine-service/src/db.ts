import { Database } from 'bun:sqlite'
import type { NovelRow, ChapterRow, JobRowDb, ApiKeyRow, NovelSummary, JobRow } from './types'

// Default: <repo-root>/db/custom.db (portable — works on any host).
// Override with ENGINE_DB (e.g. Railway volume: ENGINE_DB=/data/custom.db).
const DB_PATH = process.env.ENGINE_DB || `${import.meta.dir}/../../../db/custom.db`

declare global {
  // eslint-disable-next-line no-var
  var __engineDb: Database | undefined
}

function openDb(): Database {
  if (globalThis.__engineDb) return globalThis.__engineDb
  const db = new Database(DB_PATH, { create: true })
  db.exec('PRAGMA busy_timeout = 10000')
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    /* already WAL or locked — fine */
  }
  db.exec('PRAGMA synchronous = NORMAL')
  globalThis.__engineDb = db
  return db
}

export const db = openDb()

export function all<T = unknown>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export function run(sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...params)
}

export function now(): number {
  return Date.now()
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------- row mappers ----------------

export function novelRowToSummary(row: NovelRow): NovelSummary {
  return {
    id: row.id,
    sourceSite: row.source_site,
    sourceUrl: row.source_url,
    title: row.title,
    author: row.author,
    coverUrl: row.cover_url,
    description: row.description,
    lang: row.lang,
    status: row.status,
    totalChapters: row.total_chapters,
    scrapedCount: row.scraped_count,
    translatedCount: row.translated_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function jobDbToRow(row: JobRowDb & { novel_title?: string | null }): JobRow {
  let params: Record<string, unknown> = {}
  try {
    params = row.params ? JSON.parse(row.params) : {}
  } catch {
    params = {}
  }
  return {
    id: row.id,
    type: row.type as JobRow['type'],
    status: row.status as JobRow['status'],
    novelId: row.novel_id,
    novelTitle: row.novel_title ?? null,
    params,
    progress: row.progress,
    total: row.total,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  }
}

export function getNovel(id: string): NovelRow | undefined {
  return get<NovelRow>('SELECT * FROM novels WHERE id = ?', id)
}

export function getJob(id: string): JobRowDb | undefined {
  return get<JobRowDb>('SELECT * FROM jobs WHERE id = ?', id)
}

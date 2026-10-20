import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ENGINE_OFFLINE_ERROR,
  ENGINE_TIMEOUT_ERROR,
  engineFetch,
  engineHealth,
} from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'
import { REMOTE_ENGINE, type EngineStats } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/stats — DB-computed stats + engine liveness (remote: engine is the source of truth). */
export async function GET(_req: NextRequest) {
  if (REMOTE_ENGINE) {
    // Vercel has no SQLite — the engine serves the stats.
    const r = await engineFetch('/stats')
    if (r.ok && r.stats && typeof r.stats === 'object') {
      return NextResponse.json({ ok: true, stats: r.stats as EngineStats, engineOnline: true })
    }
    const error = typeof r.error === 'string' ? r.error : 'Lỗi engine'
    const status =
      error === ENGINE_OFFLINE_ERROR ? 503 : error === ENGINE_TIMEOUT_ERROR ? 504 : 502
    return NextResponse.json({ ok: false, error }, { status })
  }

  try {
    const [
      novels,
      chapters,
      scraped,
      translated,
      runningJobs,
      queuedJobs,
      keysTotal,
      keysActive,
      keysRateLimited,
      keysError,
    ] = await Promise.all([
      db.novel.count(),
      db.chapter.count(),
      db.chapter.count({ where: { content: { not: null } } }),
      db.chapter.count({ where: { translated: { not: null } } }),
      db.job.count({ where: { status: 'running' } }),
      db.job.count({ where: { status: 'queued' } }),
      db.apiKey.count(),
      db.apiKey.count({ where: { active: true } }),
      db.apiKey.count({ where: { status: 'rate_limited' } }),
      db.apiKey.count({ where: { status: 'error' } }),
    ])

    // Liveness check must never block the response for long (3s health
    // timeout + a hard race deadline as a belt-and-braces guard).
    const engineOnline = await Promise.race([
      engineHealth(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3500)),
    ])

    const stats: EngineStats = {
      novels,
      chapters,
      scraped,
      translated,
      runningJobs,
      queuedJobs,
      keysTotal,
      keysActive,
      keysRateLimited,
      keysError,
    }
    return NextResponse.json({ ok: true, stats, engineOnline })
  } catch (e) {
    return errorResponse(e)
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { engineHealth } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'
import type { EngineStats } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/stats — DB-computed stats + engine liveness. */
export async function GET(_req: NextRequest) {
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

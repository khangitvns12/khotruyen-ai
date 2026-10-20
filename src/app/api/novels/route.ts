import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, listNovelSummaries } from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/novels?q= — list novels, newest first (remote: relayed with `?q=`).
 * `q` filters by title/author (SQLite LIKE is ASCII-case-insensitive).
 */
export async function GET(req: NextRequest) {
  if (REMOTE_ENGINE) return engineRelay(req, '/novels')

  try {
    const q = req.nextUrl.searchParams.get('q') ?? ''
    const novels = await listNovelSummaries(q)
    return NextResponse.json({ ok: true, novels })
  } catch (e) {
    return errorResponse(e)
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, listNovelSummaries } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/novels?q= — list novels, newest first.
 * `q` filters by title/author (SQLite LIKE is ASCII-case-insensitive).
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? ''
    const novels = await listNovelSummaries(q)
    return NextResponse.json({ ok: true, novels })
  } catch (e) {
    return errorResponse(e)
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, listJobRows } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/jobs — 100 most recent jobs with novel titles joined. */
export async function GET(_req: NextRequest) {
  try {
    const jobs = await listJobRows(100)
    return NextResponse.json({ ok: true, jobs })
  } catch (e) {
    return errorResponse(e)
  }
}

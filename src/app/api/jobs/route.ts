import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, listJobRows } from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/jobs — 100 most recent jobs with novel titles joined (remote: relayed). */
export async function GET(req: NextRequest) {
  if (REMOTE_ENGINE) return engineRelay(req, '/jobs')

  try {
    const jobs = await listJobRows(100)
    return NextResponse.json({ ok: true, jobs })
  } catch (e) {
    return errorResponse(e)
  }
}

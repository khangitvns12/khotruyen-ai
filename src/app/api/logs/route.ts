import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/logs — proxy engine logs (default limit 300, max 1000). */
export async function GET(req: NextRequest) {
  try {
    let limit = 300
    const raw = req.nextUrl.searchParams.get('limit')
    if (raw !== null) {
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed) && parsed >= 1) limit = Math.min(parsed, 1000)
    }
    return engineProxy(req, `/logs?limit=${limit}`)
  } catch (e) {
    return errorResponse(e)
  }
}

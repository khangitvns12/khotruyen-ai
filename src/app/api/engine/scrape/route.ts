import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/engine/scrape — create a scrape job (engine /jobs/scrape). */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/jobs/scrape')
  } catch (e) {
    return errorResponse(e)
  }
}

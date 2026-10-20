import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/engine/retry — re-scrape error/pending chapters (engine /jobs/retry). */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/jobs/retry')
  } catch (e) {
    return errorResponse(e)
  }
}

import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/engine/translate — create a translate job (engine /jobs/translate). */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/jobs/translate')
  } catch (e) {
    return errorResponse(e)
  }
}

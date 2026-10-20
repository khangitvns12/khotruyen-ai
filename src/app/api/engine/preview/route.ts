import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/engine/preview — preview a book URL without writing to DB. */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/preview')
  } catch (e) {
    return errorResponse(e)
  }
}

import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/supabase/sync — push local data to Supabase (engine /supabase/sync). */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/supabase/sync')
  } catch (e) {
    return errorResponse(e)
  }
}

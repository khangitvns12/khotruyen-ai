import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** POST /api/supabase/pull — pull data from Supabase into local DB (engine /supabase/pull). */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/supabase/pull')
  } catch (e) {
    return errorResponse(e)
  }
}

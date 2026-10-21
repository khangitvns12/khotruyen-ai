import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * POST /api/supabase/test — kiểm tra kết nối Supabase (engine /supabase/test).
 * Body: { url, key } — url là Project URL (https://<ref>.supabase.co), key là
 * anon hoặc service_role key.
 */
export async function POST(req: NextRequest) {
  try {
    return engineProxy(req, '/supabase/test')
  } catch (e) {
    return errorResponse(e)
  }
}

import type { NextRequest } from 'next/server'
import { engineProxy } from '@/lib/engine-client'
import { errorResponse, HttpError } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['cancel', 'pause', 'resume'])

/** POST /api/engine/jobs/[id]/[action] — control a job (cancel|pause|resume). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    const { id, action } = await params
    if (!ACTIONS.has(action)) {
      throw new HttpError(400, 'Hành động không hợp lệ (chỉ chấp nhận cancel | pause | resume)')
    }
    return engineProxy(req, `/jobs/${encodeURIComponent(id)}/${action}`)
  } catch (e) {
    return errorResponse(e)
  }
}

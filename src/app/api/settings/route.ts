import { NextResponse, type NextRequest } from 'next/server'
import {
  applySettingsPatch,
  errorResponse,
  loadSettings,
  maskSettings,
  readJsonBody,
  saveSettings,
} from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** GET /api/settings — merged settings, supabaseKey masked (remote: relayed). */
export async function GET(req: NextRequest) {
  if (REMOTE_ENGINE) return engineRelay(req, '/settings')

  try {
    const settings = await loadSettings()
    return NextResponse.json({ ok: true, settings: maskSettings(settings) })
  } catch (e) {
    return errorResponse(e)
  }
}

/** PUT /api/settings — partial update, validated, returns masked settings (remote: relayed). */
export async function PUT(req: NextRequest) {
  if (REMOTE_ENGINE) return engineRelay(req, '/settings')

  try {
    const patch = await readJsonBody(req)
    const current = await loadSettings()
    const next = applySettingsPatch(current, patch)
    await saveSettings(next)
    return NextResponse.json({ ok: true, settings: maskSettings(next) })
  } catch (e) {
    return errorResponse(e)
  }
}

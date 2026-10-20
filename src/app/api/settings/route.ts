import { NextResponse, type NextRequest } from 'next/server'
import {
  applySettingsPatch,
  errorResponse,
  loadSettings,
  maskSettings,
  readJsonBody,
  saveSettings,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/settings — merged settings, supabaseKey masked. */
export async function GET() {
  try {
    const settings = await loadSettings()
    return NextResponse.json({ ok: true, settings: maskSettings(settings) })
  } catch (e) {
    return errorResponse(e)
  }
}

/** PUT /api/settings — partial update, validated, returns masked settings. */
export async function PUT(req: NextRequest) {
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

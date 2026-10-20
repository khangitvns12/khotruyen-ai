import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, HttpError, insertApiKey, listApiKeyViews, readJsonBody } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/keys — list keys (never exposes the full key). */
export async function GET() {
  try {
    const keys = await listApiKeyViews()
    return NextResponse.json({ ok: true, keys })
  } catch (e) {
    return errorResponse(e)
  }
}

/**
 * POST /api/keys — add a Gemini API key.
 * Accepts any trimmed string ≥ 20 chars; keys not starting with
 * 'AIza' are saved but flagged with a `warning`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req)

    const rawKey = body.key
    if (typeof rawKey !== 'string' || rawKey.trim().length < 20) {
      throw new HttpError(400, 'API key không hợp lệ: cần chuỗi dài tối thiểu 20 ký tự')
    }
    const key = rawKey.trim()

    const labelRaw = body.label
    if (labelRaw !== undefined && labelRaw !== null && typeof labelRaw !== 'string') {
      throw new HttpError(400, 'label phải là chuỗi')
    }
    const label = typeof labelRaw === 'string' && labelRaw.trim() !== '' ? labelRaw.trim() : null

    const created = await insertApiKey({ key, label })

    const payload: Record<string, unknown> = { ok: true, key: created }
    if (!key.startsWith('AIza')) {
      payload.warning = 'Key không bắt đầu bằng "AIza" (không đúng định dạng Gemini chuẩn) — vẫn đã lưu.'
    }
    return NextResponse.json(payload, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}

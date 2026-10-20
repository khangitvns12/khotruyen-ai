import { NextResponse, type NextRequest } from 'next/server'
import {
  deleteApiKeyRow,
  errorResponse,
  HttpError,
  readJsonBody,
  updateApiKeyFields,
} from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** PATCH /api/keys/[id] — toggle active / rename label (remote: relayed). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (REMOTE_ENGINE) {
    const { id } = await params
    return engineRelay(req, `/keys/${encodeURIComponent(id)}`)
  }

  try {
    const { id } = await params
    const body = await readJsonBody(req)

    const data: { active?: boolean; label?: string | null } = {}
    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        throw new HttpError(400, 'active phải là boolean (true/false)')
      }
      data.active = body.active
    }
    if ('label' in body) {
      const v = body.label
      if (v !== null && typeof v !== 'string') {
        throw new HttpError(400, 'label phải là chuỗi hoặc null')
      }
      data.label =
        v === null || (typeof v === 'string' && v.trim() === '') ? null : (v as string).trim()
    }
    if (Object.keys(data).length === 0) {
      throw new HttpError(400, 'Không có trường nào để cập nhật (active / label)')
    }

    const updated = await updateApiKeyFields(id, data)
    if (!updated) throw new HttpError(404, 'Không tìm thấy API key')

    return NextResponse.json({ ok: true, key: updated })
  } catch (e) {
    return errorResponse(e)
  }
}

/** DELETE /api/keys/[id] — idempotent delete (remote: relayed). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (REMOTE_ENGINE) {
    const { id } = await params
    return engineRelay(req, `/keys/${encodeURIComponent(id)}`)
  }

  try {
    const { id } = await params
    await deleteApiKeyRow(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}

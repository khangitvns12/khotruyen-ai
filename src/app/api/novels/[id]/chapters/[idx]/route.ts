import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, findChapterFull, findNovelSummary, HttpError } from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/novels/[id]/chapters/[idx] — full chapter content (remote: relayed).
 * `idx` is the 1-based chapter number (not a uuid).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> },
) {
  if (REMOTE_ENGINE) {
    const { id, idx } = await params
    return engineRelay(req, `/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(idx)}`)
  }

  try {
    const { id, idx } = await params
    if (!/^\d+$/.test(idx)) {
      throw new HttpError(400, 'Số chương không hợp lệ')
    }
    const idxNum = Number.parseInt(idx, 10)
    if (idxNum < 1) {
      throw new HttpError(400, 'Số chương phải lớn hơn hoặc bằng 1')
    }

    const novel = await findNovelSummary(id)
    if (!novel) throw new HttpError(404, 'Không tìm thấy truyện')

    const chapter = await findChapterFull(id, idxNum)
    if (!chapter) throw new HttpError(404, `Không tìm thấy chương ${idxNum}`)

    return NextResponse.json({ ok: true, chapter })
  } catch (e) {
    return errorResponse(e)
  }
}

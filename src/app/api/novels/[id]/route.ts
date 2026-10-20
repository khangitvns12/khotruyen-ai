import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { engineProxy, engineRelay } from '@/lib/engine-client'
import { errorResponse, findNovelSummary, HttpError } from '@/lib/api-helpers'
import { REMOTE_ENGINE, type ChapterSummary, type ChapterStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface ChapterSummaryRow {
  id: string
  novelId: string
  idx: number
  title: string
  status: string
  error: string | null
  hasContent: number | boolean
  hasTranslated: number | boolean
}

/** GET /api/novels/[id] — novel + chapter summaries (remote: relayed). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (REMOTE_ENGINE) {
    const { id } = await params
    return engineRelay(req, `/novels/${encodeURIComponent(id)}`)
  }

  try {
    const { id } = await params

    const novel = await findNovelSummary(id)
    if (!novel) throw new HttpError(404, 'Không tìm thấy truyện')

    const rows = await db.$queryRaw<ChapterSummaryRow[]>`
      SELECT id, novel_id AS "novelId", idx, title, status, error,
             (content IS NOT NULL) AS "hasContent",
             (translated IS NOT NULL) AS "hasTranslated"
      FROM chapters
      WHERE novel_id = ${id}
      ORDER BY idx ASC
    `

    const chapters: ChapterSummary[] = rows.map((r) => ({
      id: r.id,
      novelId: r.novelId,
      idx: r.idx,
      title: r.title,
      status: r.status as ChapterStatus,
      error: r.error,
      hasContent: Boolean(r.hasContent),
      hasTranslated: Boolean(r.hasTranslated),
    }))

    return NextResponse.json({ ok: true, novel, chapters })
  } catch (e) {
    return errorResponse(e)
  }
}

/** DELETE /api/novels/[id] — cancel related jobs + delete novel (engine). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return engineProxy(req, `/novels/${encodeURIComponent(id)}`)
  } catch (e) {
    return errorResponse(e)
  }
}

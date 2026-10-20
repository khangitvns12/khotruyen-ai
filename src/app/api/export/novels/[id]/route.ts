import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorResponse, findNovelSummary, HttpError, parseExportLang } from '@/lib/api-helpers'
import { engineRelay } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/novels/[id]?lang=vi|src|both&chapters=1-100
 * Defaults: lang=both, all chapters. `chapters` is an inclusive
 * 1-based range ("from-to" or single "N"), clamped to what exists.
 * (remote: relayed with the FULL search string)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (REMOTE_ENGINE) {
    const { id } = await params
    return engineRelay(req, `/export/novels/${encodeURIComponent(id)}`)
  }

  try {
    const { id } = await params
    const lang = parseExportLang(req.nextUrl.searchParams.get('lang'), 'both')

    const novel = await findNovelSummary(id)
    if (!novel) throw new HttpError(404, 'Không tìm thấy truyện')

    const maxRow = await db.chapter.aggregate({ where: { novelId: id }, _max: { idx: true } })
    const maxIdx = maxRow._max.idx ?? 0

    let from = 1
    let to = maxIdx
    const chaptersParam = req.nextUrl.searchParams.get('chapters')
    if (chaptersParam !== null && chaptersParam.trim() !== '') {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(chaptersParam)
      if (!m) {
        throw new HttpError(400, 'Tham số chapters không hợp lệ (ví dụ: chapters=1-100)')
      }
      const fromRaw = Number.parseInt(m[1], 10)
      const toRaw = m[2] !== undefined ? Number.parseInt(m[2], 10) : fromRaw
      from = Math.max(1, fromRaw)
      to = Math.min(maxIdx, toRaw)
    }

    // Safe typed select: excludes all timestamp columns.
    const rows = await db.chapter.findMany({
      where: { novelId: id, idx: { gte: from, lte: to } },
      orderBy: { idx: 'asc' },
      select: { idx: true, title: true, content: true, translated: true },
    })

    const chapters = rows.map((c) => {
      const out: { idx: number; title: string; content?: string; translated?: string } = {
        idx: c.idx,
        title: c.title,
      }
      if (lang !== 'vi' && c.content !== null) out.content = c.content
      if (lang !== 'src' && c.translated !== null) out.translated = c.translated
      return out
    })

    return NextResponse.json({ ok: true, novel, chapters })
  } catch (e) {
    return errorResponse(e)
  }
}

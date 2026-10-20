import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorResponse, HttpError, parseExportLang } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/novels/[id]/chapters/[idx]?lang=vi|src|both
 * Single chapter export (default: both languages).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> },
) {
  try {
    const { id, idx } = await params
    if (!/^\d+$/.test(idx)) {
      throw new HttpError(400, 'Số chương không hợp lệ')
    }
    const idxNum = Number.parseInt(idx, 10)
    if (idxNum < 1) {
      throw new HttpError(400, 'Số chương phải lớn hơn hoặc bằng 1')
    }

    const lang = parseExportLang(req.nextUrl.searchParams.get('lang'), 'both')

    const novel = await db.novel.findUnique({ where: { id }, select: { id: true } })
    if (!novel) throw new HttpError(404, 'Không tìm thấy truyện')

    const chapter = await db.chapter.findUnique({
      where: { novelId_idx: { novelId: id, idx: idxNum } },
      select: { idx: true, title: true, content: true, translated: true },
    })
    if (!chapter) throw new HttpError(404, `Không tìm thấy chương ${idxNum}`)

    const out: { idx: number; title: string; content?: string; translated?: string } = {
      idx: chapter.idx,
      title: chapter.title,
    }
    if (lang !== 'vi' && chapter.content !== null) out.content = chapter.content
    if (lang !== 'src' && chapter.translated !== null) out.translated = chapter.translated

    return NextResponse.json({ ok: true, chapter: out })
  } catch (e) {
    return errorResponse(e)
  }
}

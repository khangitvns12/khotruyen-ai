import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorResponse, HttpError, parseExportLang, sanitizeFilename } from '@/lib/api-helpers'
import { engineRelayRaw } from '@/lib/engine-client'
import { REMOTE_ENGINE } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/export/novels/[id]/txt?lang=vi|src — download the whole
 * novel as a .txt file. `lang=vi` uses translations and falls back
 * to the original content, marking untranslated chapter titles with
 * "(chưa dịch)". Chapters without any text are skipped.
 * (remote: RAW relay — streams the engine's txt response verbatim)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (REMOTE_ENGINE) {
    const { id } = await params
    return engineRelayRaw(req, `/export/novels/${encodeURIComponent(id)}/txt`)
  }

  try {
    const { id } = await params
    const lang = parseExportLang(req.nextUrl.searchParams.get('lang'), 'vi', ['vi', 'src'])

    // Safe typed select: only TEXT columns (no epoch-ms Int columns).
    const novel = await db.novel.findUnique({
      where: { id },
      select: { title: true, author: true, sourceUrl: true },
    })
    if (!novel) throw new HttpError(404, 'Không tìm thấy truyện')

    const chapters = await db.chapter.findMany({
      where: { novelId: id },
      orderBy: { idx: 'asc' },
      select: { idx: true, title: true, content: true, translated: true },
    })

    const parts: string[] = []
    let included = 0
    for (const c of chapters) {
      const body = lang === 'vi' ? (c.translated ?? c.content) : c.content
      if (body === null || body.trim() === '') continue
      const titleLine =
        lang === 'vi' && c.translated === null ? `${c.title} (chưa dịch)` : c.title
      parts.push(`\n\nChương ${c.idx}: ${titleLine}\n\n${body}`)
      included++
    }

    const header =
      `«${novel.title}»\n` +
      `Tác giả: ${novel.author ?? 'Không rõ'}\n` +
      `Nguồn: ${novel.sourceUrl}\n` +
      `Số chương: ${included}\n\n`
    const text = header + parts.join('')

    const filename = sanitizeFilename(novel.title)
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"; filename*=UTF-8''${encodeURIComponent(novel.title)}.txt`,
      },
    })
  } catch (e) {
    return errorResponse(e)
  }
}

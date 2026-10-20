import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/export — public Export API documentation. */
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      name: 'KhoTruyện AI Export API',
      endpoints: [
        {
          method: 'GET',
          path: '/api/export/novels',
          desc: 'Danh sách truyện trong kho (dạng nhẹ, kèm link chi tiết)',
        },
        {
          method: 'GET',
          path: '/api/export/novels/{id}?lang=vi|src|both&chapters=1-100',
          desc: 'Truyện kèm nội dung các chương theo ngôn ngữ và khoảng chương',
        },
        {
          method: 'GET',
          path: '/api/export/novels/{id}/chapters/{idx}?lang=vi|src|both',
          desc: 'Nội dung một chương theo ngôn ngữ',
        },
        {
          method: 'GET',
          path: '/api/export/novels/{id}/txt?lang=vi|src',
          desc: 'Tải toàn bộ truyện dưới dạng file .txt',
        },
      ],
    })
  } catch (e) {
    return errorResponse(e)
  }
}

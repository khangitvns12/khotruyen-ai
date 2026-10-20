import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** GET /api/export/novels — light novel list for the public Export API. */
export async function GET() {
  try {
    const novels = await db.novel.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        author: true,
        sourceSite: true,
        totalChapters: true,
        scrapedCount: true,
        translatedCount: true,
      },
    })
    return NextResponse.json({
      ok: true,
      count: novels.length,
      novels: novels.map((n) => ({ ...n, url: `/api/export/novels/${n.id}` })),
    })
  } catch (e) {
    return errorResponse(e)
  }
}

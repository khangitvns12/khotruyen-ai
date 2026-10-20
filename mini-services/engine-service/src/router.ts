// ============================================================
// REST router (no framework) — serves the engine's HTTP API on
// the same httpServer as socket.io (path /engine-io).
// Envelope: { ok: true, ...payload } | { ok: false, error }
// ============================================================

import type { IncomingMessage, ServerResponse } from 'http'
import type { JobEngine } from './engine'
import { all, get, run, now, jobDbToRow } from './db'
import { logs, logInfo, logWarn, logError } from './logger'
import { detectAdapter } from './adapters'
import { testConnection, supabasePush, supabasePull } from './supabase'
import type { PreviewResult } from './types'
import {
  ApiHttpError,
  applySettingsPatch,
  deleteApiKeyRow,
  findApiKeyView,
  findChapterFull,
  findNovelSummary,
  insertApiKey,
  listApiKeyViews,
  listChapterSummaries,
  listNovelSummaries,
  loadAppSettings,
  maskSettings,
  parseChapterIdx,
  parseExportLang,
  sanitizeFilename,
  saveAppSettings,
  updateApiKeyFields,
} from './readapi'

const MAX_BODY = 2 * 1024 * 1024 // 2MB

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Prefer',
  })
  res.end(body)
}

const ok = (res: ServerResponse, payload: Record<string, unknown> = {}) => sendJson(res, 200, { ok: true, ...payload })
const bad = (res: ServerResponse, error: string, status = 400) => sendJson(res, status, { ok: false, error })

/** Raw text response (export .txt) with the same CORS/cache headers as sendJson. */
function sendText(res: ServerResponse, status: number, text: string, extraHeaders: Record<string, string>): void {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  })
  res.end(text)
}

/** Safely decode a captured path parameter (relay may percent-encode it). */
function decodeParam(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Body quá lớn'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    req.on('error', (e) => reject(e))
  })
}

/** Lenient JSON body (legacy behavior: empty body → {}). */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req)
  if (raw === '') return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('JSON không hợp lệ')
  }
}

/**
 * Strict JSON object body — mirrors the Next.js `readJsonBody` helper:
 * empty / malformed / non-object bodies → ApiHttpError(400, 'JSON không hợp lệ').
 */
async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiHttpError(400, 'JSON không hợp lệ')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiHttpError(400, 'JSON không hợp lệ')
  }
  return parsed as Record<string, unknown>
}

/** Build PreviewResult from a URL without touching the DB. */
async function buildPreview(url: string): Promise<PreviewResult> {
  const trimmed = String(url ?? '').trim()
  if (!trimmed) throw new Error('Thiếu tham số url')
  const adapter = detectAdapter(trimmed)
  if (!adapter) {
    let host = ''
    try {
      host = new URL(trimmed).hostname
    } catch {
      /* ignore */
    }
    throw new Error(
      `Không hỗ trợ site ${host || trimmed} — hiện hỗ trợ: 69shuba.com, xbiquge.info, novel543.com, hjwzw.com, truyenfull.live`
    )
  }
  const bookUrl = adapter.normalizeUrl(trimmed)
  const { meta, chapters } = await adapter.fetchBook(bookUrl)
  if (!chapters.length) throw new Error('Không tìm thấy chương nào cho truyện này')
  return {
    site: adapter.id,
    siteName: adapter.siteName,
    url: bookUrl,
    title: meta.title,
    author: meta.author,
    cover: meta.cover,
    description: meta.description,
    status: meta.status,
    lang: meta.lang,
    chapterCount: chapters.length,
    sample: chapters.slice(0, 10).map((c) => ({ title: c.title, url: c.url })),
  }
}

export async function handleRest(req: IncomingMessage, res: ServerResponse, engine: JobEngine): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const method = (req.method ?? 'GET').toUpperCase()

  try {
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Prefer',
      })
      res.end()
      return
    }

    // ---------- health ----------
    if (pathname === '/health' && method === 'GET') {
      const q = engine.queueLengths()
      ok(res, { uptime: Math.floor((Date.now() - engine.startedAt) / 1000), running: q.scrape + q.translate, queued: q.scrape + q.translate, db: 'ok' })
      return
    }

    // ---------- stats ----------
    if (pathname === '/stats' && method === 'GET') {
      ok(res, { stats: engine.buildStats() })
      return
    }

    // ---------- jobs list ----------
    if (pathname === '/jobs' && method === 'GET') {
      const rows = all<Record<string, unknown>>(
        `SELECT j.*, n.title AS novel_title FROM jobs j LEFT JOIN novels n ON n.id = j.novel_id ORDER BY j.created_at DESC LIMIT 100`
      )
      ok(res, { jobs: rows.map((r) => jobDbToRow(r as never)) })
      return
    }

    // ---------- logs ----------
    if (pathname === '/logs' && method === 'GET') {
      const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') ?? '300', 10) || 300))
      ok(res, { logs: logs.slice(-limit) })
      return
    }

    // ==========================================================
    // Read/CRUD APIs mirrored from the Next.js /api/* routes
    // (remote-engine mode: Vercel relays these verbatim — the
    // shapes MUST stay byte-identical with src/app/api/**).
    // ==========================================================

    // ---------- novels list (mirror GET /api/novels?q=) ----------
    if (pathname === '/novels' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      ok(res, { novels: listNovelSummaries(q) })
      return
    }

    // ---------- novel detail (mirror GET /api/novels/:id) ----------
    const novelGet = pathname.match(/^\/novels\/([^/]+)$/)
    if (novelGet && method === 'GET') {
      const id = decodeParam(novelGet[1])
      const novel = findNovelSummary(id)
      if (!novel) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }
      ok(res, { novel, chapters: listChapterSummaries(id) })
      return
    }

    // ---------- chapter full (mirror GET /api/novels/:id/chapters/:idx) ----------
    const chapterGet = pathname.match(/^\/novels\/([^/]+)\/chapters\/([^/]+)$/)
    if (chapterGet && method === 'GET') {
      const id = decodeParam(chapterGet[1])
      const idxNum = parseChapterIdx(decodeParam(chapterGet[2]))
      if (!findNovelSummary(id)) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }
      const chapter = findChapterFull(id, idxNum)
      if (!chapter) {
        bad(res, `Không tìm thấy chương ${idxNum}`, 404)
        return
      }
      ok(res, { chapter })
      return
    }

    // ---------- api keys list (mirror GET /api/keys) ----------
    if (pathname === '/keys' && method === 'GET') {
      ok(res, { keys: listApiKeyViews() })
      return
    }

    // ---------- api key create (mirror POST /api/keys) ----------
    if (pathname === '/keys' && method === 'POST') {
      const body = await readJsonObject(req)

      const rawKey = body.key
      if (typeof rawKey !== 'string' || rawKey.trim().length < 20) {
        bad(res, 'API key không hợp lệ: cần chuỗi dài tối thiểu 20 ký tự', 400)
        return
      }
      const key = rawKey.trim()

      const labelRaw = body.label
      if (labelRaw !== undefined && labelRaw !== null && typeof labelRaw !== 'string') {
        bad(res, 'label phải là chuỗi', 400)
        return
      }
      const label = typeof labelRaw === 'string' && labelRaw.trim() !== '' ? labelRaw.trim() : null

      const created = insertApiKey({ key, label })

      const payload: Record<string, unknown> = { ok: true, key: created }
      if (!key.startsWith('AIza')) {
        payload.warning = 'Key không bắt đầu bằng "AIza" (không đúng định dạng Gemini chuẩn) — vẫn đã lưu.'
      }
      sendJson(res, 201, payload)
      return
    }

    // ---------- api key update (mirror PATCH /api/keys/:id) ----------
    const keyPatch = pathname.match(/^\/keys\/([^/]+)$/)
    if (keyPatch && method === 'PATCH') {
      const id = decodeParam(keyPatch[1])
      const body = await readJsonObject(req)

      const data: { active?: boolean; label?: string | null } = {}
      if ('active' in body) {
        if (typeof body.active !== 'boolean') {
          bad(res, 'active phải là boolean (true/false)', 400)
          return
        }
        data.active = body.active
      }
      if ('label' in body) {
        const v = body.label
        if (v !== null && typeof v !== 'string') {
          bad(res, 'label phải là chuỗi hoặc null', 400)
          return
        }
        data.label =
          v === null || (typeof v === 'string' && v.trim() === '') ? null : (v as string).trim()
      }
      if (Object.keys(data).length === 0) {
        bad(res, 'Không có trường nào để cập nhật (active / label)', 400)
        return
      }

      const updated = updateApiKeyFields(id, data)
      if (!updated) {
        bad(res, 'Không tìm thấy API key', 404)
        return
      }
      ok(res, { key: updated })
      return
    }

    // ---------- api key delete (mirror DELETE /api/keys/:id, idempotent) ----------
    if (keyPatch && method === 'DELETE') {
      deleteApiKeyRow(decodeParam(keyPatch[1]))
      ok(res)
      return
    }

    // ---------- settings (mirror GET/PUT /api/settings) ----------
    if (pathname === '/settings' && method === 'GET') {
      ok(res, { settings: maskSettings(loadAppSettings()) })
      return
    }
    if (pathname === '/settings' && method === 'PUT') {
      const patch = await readJsonObject(req)
      const current = loadAppSettings()
      const next = applySettingsPatch(current, patch)
      saveAppSettings(next)
      ok(res, { settings: maskSettings(next) })
      return
    }

    // ---------- export api doc index (mirror GET /api/export) ----------
    if (pathname === '/export' && method === 'GET') {
      ok(res, {
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
      return
    }

    // ---------- export novel list (mirror GET /api/export/novels) ----------
    if (pathname === '/export/novels' && method === 'GET') {
      const rows = all<{
        id: string
        title: string
        author: string | null
        source_site: string
        total_chapters: number
        scraped_count: number
        translated_count: number
      }>(
        `SELECT id, title, author, source_site, total_chapters, scraped_count, translated_count
         FROM novels ORDER BY updated_at DESC`
      )
      const novels = rows.map((n) => ({
        id: n.id,
        title: n.title,
        author: n.author,
        sourceSite: n.source_site,
        totalChapters: n.total_chapters,
        scrapedCount: n.scraped_count,
        translatedCount: n.translated_count,
        url: `/api/export/novels/${n.id}`,
      }))
      ok(res, { count: novels.length, novels })
      return
    }

    // ---------- export novel detail (mirror GET /api/export/novels/:id) ----------
    const exportDetail = pathname.match(/^\/export\/novels\/([^/]+)$/)
    if (exportDetail && method === 'GET') {
      const id = decodeParam(exportDetail[1])
      const lang = parseExportLang(url.searchParams.get('lang'), 'both')

      const novel = findNovelSummary(id)
      if (!novel) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }

      const maxRow = get<{ m: number | null }>('SELECT MAX(idx) AS m FROM chapters WHERE novel_id = ?', id)
      const maxIdx = maxRow?.m ?? 0

      let from = 1
      let to = maxIdx
      const chaptersParam = url.searchParams.get('chapters')
      if (chaptersParam !== null && chaptersParam.trim() !== '') {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(chaptersParam)
        if (!m) {
          bad(res, 'Tham số chapters không hợp lệ (ví dụ: chapters=1-100)', 400)
          return
        }
        const fromRaw = Number.parseInt(m[1], 10)
        const toRaw = m[2] !== undefined ? Number.parseInt(m[2], 10) : fromRaw
        from = Math.max(1, fromRaw)
        to = Math.min(maxIdx, toRaw)
      }

      const rows = all<{ idx: number; title: string; content: string | null; translated: string | null }>(
        `SELECT idx, title, content, translated FROM chapters
         WHERE novel_id = ? AND idx >= ? AND idx <= ? ORDER BY idx ASC`,
        id,
        from,
        to
      )

      const chapters = rows.map((c) => {
        const out: { idx: number; title: string; content?: string; translated?: string } = {
          idx: c.idx,
          title: c.title,
        }
        if (lang !== 'vi' && c.content !== null) out.content = c.content
        if (lang !== 'src' && c.translated !== null) out.translated = c.translated
        return out
      })

      ok(res, { novel, chapters })
      return
    }

    // ---------- export chapter (mirror GET /api/export/novels/:id/chapters/:idx) ----------
    const exportChapter = pathname.match(/^\/export\/novels\/([^/]+)\/chapters\/([^/]+)$/)
    if (exportChapter && method === 'GET') {
      const id = decodeParam(exportChapter[1])
      const idxNum = parseChapterIdx(decodeParam(exportChapter[2]))
      const lang = parseExportLang(url.searchParams.get('lang'), 'both')

      if (!findNovelSummary(id)) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }

      const chapter = get<{ idx: number; title: string; content: string | null; translated: string | null }>(
        `SELECT idx, title, content, translated FROM chapters WHERE novel_id = ? AND idx = ? LIMIT 1`,
        id,
        idxNum
      )
      if (!chapter) {
        bad(res, `Không tìm thấy chương ${idxNum}`, 404)
        return
      }

      const out: { idx: number; title: string; content?: string; translated?: string } = {
        idx: chapter.idx,
        title: chapter.title,
      }
      if (lang !== 'vi' && chapter.content !== null) out.content = chapter.content
      if (lang !== 'src' && chapter.translated !== null) out.translated = chapter.translated

      ok(res, { chapter: out })
      return
    }

    // ---------- export txt (mirror GET /api/export/novels/:id/txt?lang=vi|src) ----------
    const exportTxt = pathname.match(/^\/export\/novels\/([^/]+)\/txt$/)
    if (exportTxt && method === 'GET') {
      const id = decodeParam(exportTxt[1])
      const lang = parseExportLang(url.searchParams.get('lang'), 'vi', ['vi', 'src'])

      const novel = get<{ title: string; author: string | null; source_url: string }>(
        'SELECT title, author, source_url FROM novels WHERE id = ?',
        id
      )
      if (!novel) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }

      const chapters = all<{ idx: number; title: string; content: string | null; translated: string | null }>(
        `SELECT idx, title, content, translated FROM chapters WHERE novel_id = ? ORDER BY idx ASC`,
        id
      )

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
        `Nguồn: ${novel.source_url}\n` +
        `Số chương: ${included}\n\n`
      const text = header + parts.join('')

      const filename = sanitizeFilename(novel.title)
      sendText(res, 200, text, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"; filename*=UTF-8''${encodeURIComponent(novel.title)}.txt`,
      })
      return
    }

    // ---------- preview ----------
    if (pathname === '/preview' && method === 'POST') {
      const body = await readBody(req)
      const preview = await buildPreview(String(body.url ?? ''))
      ok(res, { preview })
      return
    }

    // ---------- job creation ----------
    if (pathname === '/jobs/scrape' && method === 'POST') {
      const body = await readBody(req)
      const r = await engine.startScrapeJob(body)
      ok(res, r)
      return
    }
    if (pathname === '/jobs/translate' && method === 'POST') {
      const body = await readBody(req)
      const r = engine.startTranslateJob(body)
      ok(res, r)
      return
    }
    if (pathname === '/jobs/retry' && method === 'POST') {
      const body = await readBody(req)
      const r = engine.startRetryJob(body)
      ok(res, r)
      return
    }

    // ---------- job control: /jobs/:id/:action ----------
    const jobAction = pathname.match(/^\/jobs\/([^/]+)\/(cancel|pause|resume)$/)
    if (jobAction && method === 'POST') {
      const [, jobId, action] = jobAction
      if (action === 'cancel') engine.cancel(jobId)
      else if (action === 'pause') engine.pause(jobId)
      else engine.resume(jobId)
      ok(res)
      return
    }

    // ---------- delete novel ----------
    const novelDel = pathname.match(/^\/novels\/([^/]+)$/)
    if (novelDel && method === 'DELETE') {
      const novelId = novelDel[1]
      const novel = get<{ id: string; title: string }>('SELECT id, title FROM novels WHERE id = ?', novelId)
      if (!novel) {
        bad(res, 'Không tìm thấy truyện', 404)
        return
      }
      // cancel active jobs for this novel
      const active = all<{ id: string }>(
        "SELECT id FROM jobs WHERE novel_id = ? AND status IN ('queued','running','paused')",
        novelId
      )
      for (const j of active) {
        try {
          engine.cancel(j.id)
        } catch {
          run("UPDATE jobs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?", now(), now(), j.id)
        }
      }
      run('DELETE FROM chapters WHERE novel_id = ?', novelId)
      run('DELETE FROM novels WHERE id = ?', novelId)
      logWarn(`Đã xoá truyện «${novel.title}» (${active.length} job liên quan bị huỷ)`)
      ok(res)
      return
    }

    // ---------- supabase ----------
    if (pathname === '/supabase/test' && method === 'POST') {
      const body = await readBody(req)
      await testConnection(String(body.url ?? ''), String(body.key ?? ''))
      ok(res, { message: 'Kết nối Supabase thành công' })
      return
    }
    if (pathname === '/supabase/sync' && method === 'POST') {
      const body = await readBody(req)
      const novelId = body.novelId != null ? String(body.novelId) : undefined
      const counts = await supabasePush(novelId ?? null)
      logInfo(`Đã đồng bộ lên Supabase: ${counts.novels} truyện, ${counts.chapters} chương, ${counts.keys} key`)
      ok(res, counts)
      return
    }
    if (pathname === '/supabase/pull' && method === 'POST') {
      const body = await readBody(req)
      const novelId = body.novelId != null ? String(body.novelId) : undefined
      const counts = await supabasePull(novelId ?? null)
      logInfo(`Đã kéo từ Supabase về local: ${counts.novels} truyện, ${counts.chapters} chương`)
      ok(res, counts)
      return
    }

    // ---------- 404 ----------
    bad(res, `Không tìm thấy endpoint ${method} ${pathname}`, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Read/CRUD endpoints carry their own HTTP status (404 etc.);
    // everything else keeps the legacy 400 behavior.
    const status = e instanceof ApiHttpError ? e.status : 400
    logError(`REST ${method} ${pathname}: ${msg}`)
    bad(res, msg, status)
  }
}

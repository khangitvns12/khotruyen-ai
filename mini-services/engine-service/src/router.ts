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

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch {
        reject(new Error('JSON không hợp lệ'))
      }
    })
    req.on('error', (e) => reject(e))
  })
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
    logError(`REST ${method} ${pathname}: ${msg}`)
    bad(res, msg, 400)
  }
}

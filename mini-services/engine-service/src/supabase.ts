import { all, get, run, now } from './db'
import { loadSettings } from './settings'
import { logInfo, logWarn } from './logger'
import type { NovelRow, ChapterRow, ApiKeyRow } from './types'

// ============================================================
// Supabase sync via PostgREST (contract §8)
// ============================================================

/**
 * Chuẩn hoá URL Supabase người dùng dán vào:
 *  - "https://xxx.supabase.co/"           → "https://xxx.supabase.co"
 *  - "https://xxx.supabase.co/rest/v1"    → "https://xxx.supabase.co"  (tránh /rest/v1/rest/v1/ → 404)
 *  - "https://supabase.com/dashboard/project/<ref>" → "https://<ref>.supabase.co"
 *  - khoẳng trắng/xuống dòng dính kèm khi copy → bị xoá
 */
export function normalizeSupabaseUrl(raw: string): string {
  let u = (raw || '').replace(/\s+/g, '').replace(/\/+$/, '')
  // Link dashboard → dựng lại URL API theo project ref
  const dash = u.match(/^https?:\/\/[^/]+\/dashboard\/project\/([a-z0-9]{8,})$/i)
  if (dash) return `https://${dash[1]}.supabase.co`
  // Người dùng dán sẵn endpoint REST → bỏ phần đuôi /rest/v1
  u = u.replace(/\/rest\/v1$/i, '')
  return u
}

/** Key là JWT — không chứa khoẳng trắng; xoá hết khi dán kèm xuống dòng. */
function normalizeSupabaseKey(raw: string): string {
  return (raw || '').replace(/\s+/g, '')
}

function supabaseConfig(): { url: string; key: string } {
  const s = loadSettings()
  return { url: normalizeSupabaseUrl(s.supabaseUrl || ''), key: normalizeSupabaseKey(s.supabaseKey || '') }
}

function headers(key: string, preferUpsert = true): Record<string, string> {
  const h: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  if (preferUpsert) h['Prefer'] = 'resolution=merge-duplicates'
  return h
}

async function sbFetch(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase HTTP ${res.status} ${url.split('?')[0]}: ${body.slice(0, 200)}`)
  }
}

/** GET {url}/rest/v1/ with apikey — returns when connection is valid. */
export async function testConnection(url: string, key: string): Promise<void> {
  const base = normalizeSupabaseUrl(url || '')
  const k = normalizeSupabaseKey(key || '')
  if (!base || !k) throw new Error('Thiếu url hoặc key Supabase')
  if (!/^https?:\/\//.test(base)) throw new Error('URL Supabase không hợp lệ (cần https://xxx.supabase.co)')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  let res: Response
  try {
    res = await fetch(`${base}/rest/v1/`, { headers: headers(k, false), signal: ctrl.signal })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('aborted') || (e as Error)?.name === 'AbortError') {
      throw new Error('Supabase không phản hồi trong 15 giây — kiểm tra lại URL hoặc mạng')
    }
    throw new Error(`Không kết nối được tới Supabase (${msg.slice(0, 120)}) — kiểm tra Project URL`) 
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 || res.status === 403) throw new Error('Key Supabase không hợp lệ (401/403) — dùng anon hoặc service_role key từ Settings → API')
  if (res.status === 404) {
    throw new Error(
      `Supabase trả về 404 — URL chưa đúng. Dùng "Project URL" dạng https://<mã>.supabase.co (KHÔNG kèm /rest/v1, không dùng link dashboard)`,
    )
  }
  if (!res.ok) throw new Error(`Supabase trả về HTTP ${res.status}${res.status === 540 ? ' (project đang bị pause — mở lại trong dashboard Supabase)' : ''}`)
}

function novelToApiRow(n: NovelRow): Record<string, unknown> {
  return {
    id: n.id,
    source_site: n.source_site,
    source_url: n.source_url,
    title: n.title,
    author: n.author,
    cover_url: n.cover_url,
    description: n.description,
    lang: n.lang,
    status: n.status,
    total_chapters: n.total_chapters,
    scraped_count: n.scraped_count,
    translated_count: n.translated_count,
    created_at: n.created_at,
    updated_at: n.updated_at,
  }
}

function chapterToApiRow(c: ChapterRow): Record<string, unknown> {
  return {
    id: c.id,
    novel_id: c.novel_id,
    idx: c.idx,
    title: c.title,
    source_url: c.source_url,
    content: c.content,
    translated: c.translated,
    status: c.status,
    scraped_at: c.scraped_at,
    translated_at: c.translated_at,
  }
}

function keyToApiRow(k: ApiKeyRow): Record<string, unknown> {
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    key: k.key,
    key_tail: k.key_tail,
    active: !!k.active,
    usage_count: k.usage_count,
    error_count: k.error_count,
    status: k.status,
    last_used_at: k.last_used_at,
    created_at: k.created_at,
  }
}

export interface PushCounts {
  novels: number
  chapters: number
  keys: number
}

/** Push 1 novel (or all novels) + chapters + api_keys to Supabase. */
export async function supabasePush(novelId?: string | null): Promise<PushCounts> {
  const { url, key } = supabaseConfig()
  if (!url || !key) throw new Error('Chưa cấu hình Supabase (url/key) trong Cài đặt')
  const H = headers(key)

  const novels = novelId
    ? all<NovelRow>('SELECT * FROM novels WHERE id = ?', novelId)
    : all<NovelRow>('SELECT * FROM novels')

  let chapterCount = 0
  for (const n of novels) {
    await sbFetch(`${url}/rest/v1/novels?on_conflict=source_url`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify([novelToApiRow(n)]),
    })
    // replace chapters for this novel
    await sbFetch(`${url}/rest/v1/chapters?novel_id=eq.${encodeURIComponent(n.id)}`, {
      method: 'DELETE',
      headers: headers(key, false),
    })
    const chapters = all<ChapterRow>(
      'SELECT * FROM chapters WHERE novel_id = ? ORDER BY idx ASC',
      n.id
    )
    for (let i = 0; i < chapters.length; i += 500) {
      const batch = chapters.slice(i, i + 500).map(chapterToApiRow)
      await sbFetch(`${url}/rest/v1/chapters`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify(batch),
      })
    }
    chapterCount += chapters.length
  }

  const keys = all<ApiKeyRow>('SELECT * FROM api_keys')
  if (keys.length) {
    await sbFetch(`${url}/rest/v1/api_keys?on_conflict=id`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(keys.map(keyToApiRow)),
    })
  }
  logInfo(`Đã push Supabase: ${novels.length} truyện, ${chapterCount} chương, ${keys.length} key`)
  return { novels: novels.length, chapters: chapterCount, keys: keys.length }
}

export interface PullCounts {
  novels: number
  chapters: number
}

/** Pull novels (+ chapters) from Supabase into local DB. */
export async function supabasePull(novelId?: string | null): Promise<PullCounts> {
  const { url, key } = supabaseConfig()
  if (!url || !key) throw new Error('Chưa cấu hình Supabase (url/key) trong Cài đặt')
  const H = headers(key, false)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  let res: Response
  try {
    const q = novelId ? `&id=eq.${encodeURIComponent(novelId)}` : ''
    res = await fetch(`${url}/rest/v1/novels?select=*${q}`, { headers: H, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status} khi pull novels`)
  const remoteNovels = (await res.json()) as Array<Record<string, any>>

  let chapterCount = 0
  const ts = now()
  for (const rn of remoteNovels) {
    if (!rn || !rn.source_url || !rn.title) continue
    let local = get<NovelRow>('SELECT * FROM novels WHERE source_url = ?', rn.source_url)
    let localId: string
    if (!local) {
      localId = typeof rn.id === 'string' && rn.id ? rn.id : crypto.randomUUID()
      run(
        `INSERT INTO novels (id, source_site, source_url, title, author, cover_url, description, lang, status, total_chapters, scraped_count, translated_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        localId,
        rn.source_site ?? '',
        rn.source_url,
        rn.title,
        rn.author ?? null,
        rn.cover_url ?? null,
        rn.description ?? null,
        rn.lang ?? 'zh',
        rn.status ?? null,
        rn.total_chapters ?? 0,
        rn.scraped_count ?? 0,
        rn.translated_count ?? 0,
        rn.created_at ?? ts,
        rn.updated_at ?? ts
      )
    } else {
      localId = local.id
      const remoteCounts = {
        total: Math.max(local.total_chapters, rn.total_chapters ?? 0),
        scraped: Math.max(local.scraped_count, rn.scraped_count ?? 0),
        translated: Math.max(local.translated_count, rn.translated_count ?? 0),
      }
      run(
        `UPDATE novels SET title=?, author=?, cover_url=?, description=?, status=?, total_chapters=?, scraped_count=?, translated_count=?, updated_at=? WHERE id=?`,
        rn.title ?? local.title,
        rn.author ?? local.author,
        rn.cover_url ?? local.cover_url,
        rn.description ?? local.description,
        rn.status ?? local.status,
        remoteCounts.total,
        remoteCounts.scraped,
        remoteCounts.translated,
        ts,
        localId
      )
    }

    // chapters (map remote novel id → local novel id)
    const remoteNovelId = typeof rn.id === 'string' ? rn.id : ''
    if (!remoteNovelId) continue
    const cres = await fetch(
      `${url}/rest/v1/chapters?novel_id=eq.${encodeURIComponent(remoteNovelId)}&order=idx.asc`,
      { headers: H }
    )
    if (!cres.ok) {
      logWarn(`Không pull được chapters của «${rn.title}» (HTTP ${cres.status})`)
      continue
    }
    const remoteChapters = (await cres.json()) as Array<Record<string, any>>
    for (const rc of remoteChapters) {
      if (!rc || typeof rc.idx !== 'number' || !rc.title) continue
      const localCh = get<ChapterRow>('SELECT * FROM chapters WHERE novel_id = ? AND idx = ?', localId, rc.idx)
      if (!localCh) {
        run(
          `INSERT INTO chapters (id, novel_id, idx, title, source_url, content, translated, status, scraped_at, translated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          typeof rc.id === 'string' && rc.id ? rc.id : crypto.randomUUID(),
          localId,
          rc.idx,
          rc.title,
          rc.source_url ?? '',
          rc.content ?? null,
          rc.translated ?? null,
          rc.status ?? 'scraped',
          rc.scraped_at ?? null,
          rc.translated_at ?? null
        )
        chapterCount++
      } else if (
        (typeof rc.content === 'string' && rc.content.length > (localCh.content || '').length) ||
        (typeof rc.translated === 'string' && rc.translated.length > (localCh.translated || '').length)
      ) {
        const content = typeof rc.content === 'string' && rc.content.length > (localCh.content || '').length ? rc.content : localCh.content
        const translated =
          typeof rc.translated === 'string' && rc.translated.length > (localCh.translated || '').length
            ? rc.translated
            : localCh.translated
        run(
          `UPDATE chapters SET title=?, content=?, translated=?, status=?, scraped_at=?, translated_at=? WHERE id=?`,
          rc.title ?? localCh.title,
          content,
          translated,
          rc.status ?? localCh.status,
          rc.scraped_at ?? localCh.scraped_at,
          rc.translated_at ?? localCh.translated_at,
          localCh.id
        )
        chapterCount++
      }
    }
  }
  logInfo(`Đã pull từ Supabase: ${remoteNovels.length} truyện, ${chapterCount} chương`)
  return { novels: remoteNovels.length, chapters: chapterCount }
}

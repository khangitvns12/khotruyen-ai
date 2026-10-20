import iconv from 'iconv-lite'
import { sleep } from './db'

export interface FetchHtmlOpts {
  referer?: string
  extraHeaders?: Record<string, string>
  timeoutMs?: number
  retries?: number
}

export interface FetchHtmlResult {
  html: string
  finalUrl: string
  status: number
}

// NOTE: Bun's native fetch() TLS fingerprint gets challenged by Cloudflare
// bot-fight mode on 69shuba (verified: 403 "Just a moment..." even with full
// browser headers, while curl passes). So ALL outbound fetches go through
// spawned curl, which passes every site tested.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,vi;q=0.8,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
}

const CHARSET_ALIASES: Record<string, string> = {
  gb2312: 'gbk',
  gbk: 'gbk',
  gb18030: 'gb18030',
  big5: 'big5',
  'big-5': 'big5',
  cp950: 'big5',
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'iso-8859-1': 'utf-8', // treat as utf-8, best effort
}

function normalizeCharset(raw: string | null | undefined): string | null {
  if (!raw) return null
  const c = raw.trim().toLowerCase()
  return CHARSET_ALIASES[c] ?? null
}

function charsetFromHtmlHead(headLatin: string): string | null {
  const mMeta =
    headLatin.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)["']?[^>]*>/i) ||
    headLatin.match(/<meta[^>]+content=["'][^"']*charset\s*=\s*([\w-]+)[^"']*["'][^>]*>/i)
  if (mMeta) return normalizeCharset(mMeta[1])
  const mXml = headLatin.match(/<\?xml[^>]+encoding\s*=\s*["']?([\w-]+)/i)
  if (mXml) return normalizeCharset(mXml[1])
  return null
}

function tryDecode(buf: Buffer, charset: string | null): string {
  if (charset && charset !== 'utf-8') {
    try {
      return iconv.decode(buf, charset)
    } catch {
      /* fall through to utf-8 */
    }
  }
  return buf.toString('utf-8')
}

const META_MARKER = '\n__CURL_META__'

/** Fetch a URL via spawned curl (follows redirects, browser-like headers). */
async function curlFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ body: Buffer; finalUrl: string; status: number }> {
  const args = ['-s', '--compressed', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000))]
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push('-w', `${META_MARKER}%{http_code} %{url_effective}`)
  args.push(url)

  const proc = Bun.spawn(['curl', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    // hide curl progress/errors from engine console
    env: { ...process.env, LC_ALL: 'C' },
  })
  const raw = Buffer.from(await new Response(proc.stdout).arrayBuffer())
  await proc.exited

  const markerIdx = raw.lastIndexOf(Buffer.from(META_MARKER))
  let body = raw
  let status = 200
  let finalUrl = url
  if (markerIdx >= 0) {
    body = raw.subarray(0, markerIdx)
    const meta = raw.subarray(markerIdx + META_MARKER.length).toString('utf-8').trim()
    const m = meta.match(/^(\d{3})\s+(\S+)$/)
    if (m) {
      status = parseInt(m[1], 10)
      finalUrl = m[2]
    }
  }
  return { body, finalUrl, status }
}

/**
 * Fetch an HTML page with browser-like headers, redirect following,
 * timeout and 3 retries (2s/5s/10s backoff). Detects charset from the
 * <meta charset> sniff and decodes gbk/gb18030/big5 via iconv-lite.
 */
export async function fetchHtml(url: string, opts: FetchHtmlOpts = {}): Promise<FetchHtmlResult> {
  const retries = opts.retries ?? 3
  const backoffs = [2000, 5000, 10000]
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffs[Math.min(attempt - 1, backoffs.length - 1)])
    try {
      const headers: Record<string, string> = { ...BROWSER_HEADERS }
      if (opts.referer) headers['Referer'] = opts.referer
      if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders)

      const { body, finalUrl, status } = await curlFetch(url, headers, opts.timeoutMs ?? 20000)

      if (status >= 400) {
        const snippet = body.toString('utf-8').slice(0, 200)
        if (body.toString('utf-8').includes('Just a moment')) {
          throw new Error('HTTP ' + status + ' (Cloudflare challenge)')
        }
        const err = new Error(`HTTP ${status}${snippet ? '' : ''}`) as Error & { noRetry?: boolean }
        // 4xx won't heal with retries unless it's 429
        if (status >= 400 && status < 500 && status !== 429) err.noRetry = true
        throw err
      }

      const charset = charsetFromHtmlHead(body.subarray(0, 4096).toString('latin1'))
      const html = tryDecode(body, charset)
      if (!html || html.length < 50) throw new Error('Phản hồi trống')
      if (html.includes('Just a moment')) throw new Error('Bị Cloudflare chặn (challenge)')
      return { html, finalUrl, status }
    } catch (e: unknown) {
      lastErr = e
      const err = e as Error & { noRetry?: boolean }
      if (err?.noRetry) break
    }
  }
  const msg = (lastErr as Error)?.message ?? String(lastErr ?? 'unknown')
  throw new Error(`Không tải được ${url}: ${msg}`)
}

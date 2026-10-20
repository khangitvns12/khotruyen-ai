// ============================================================
// KhoTruyện AI — Engine HTTP client (server-side only)
// Bridges Next.js /api/* routes to the engine service running
// at http://localhost:3002 (see CONTRACT.md §3).
//
// Design rules:
//  - NEVER throws: every network failure degrades gracefully
//    to the `{ ok:false, error }` envelope.
//  - Regular engine calls time out after 60s (scrape POSTs
//    can be slow); liveness checks time out after 3s.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { ENGINE_URL } from '@/lib/types'

/** Timeout for regular engine calls (POST /jobs/scrape can be slow). */
const ENGINE_TIMEOUT_MS = 60_000
/** Timeout for liveness (health) checks — must never block callers long. */
const HEALTH_TIMEOUT_MS = 3_000

export const ENGINE_OFFLINE_ERROR = 'Engine không trực tuyến'
export const ENGINE_TIMEOUT_ERROR = 'Engine không phản hồi (quá 60 giây)'

/** Envelope returned by every engine endpoint (CONTRACT.md §3). */
export interface EngineResponse {
  ok: boolean
  error?: string
  [k: string]: unknown
}

/** Merge caller headers with the mandatory JSON content type. */
function buildHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = init.headers
    if (h instanceof Headers) {
      h.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(h)) {
      for (const [key, value] of h) {
        headers[key] = String(value)
      }
    } else {
      for (const [key, value] of Object.entries(h)) {
        headers[key] = String(value)
      }
    }
  }
  headers['Content-Type'] = 'application/json'
  return headers
}

async function fetchEngineJson(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<EngineResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      ...init,
      cache: 'no-store',
      headers: buildHeaders(init),
      signal: controller.signal,
    })
    const text = await res.text()
    if (text) {
      try {
        const data: unknown = JSON.parse(text)
        if (data !== null && typeof data === 'object' && typeof (data as EngineResponse).ok === 'boolean') {
          return data as EngineResponse
        }
      } catch {
        // fall through to the invalid-response envelope below
      }
    }
    return { ok: false, error: 'Phản hồi không hợp lệ từ engine' }
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return { ok: false, error: ENGINE_TIMEOUT_ERROR }
    }
    return { ok: false, error: ENGINE_OFFLINE_ERROR }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch an engine endpoint and return its parsed JSON envelope.
 * Never throws — offline/timeout failures come back as
 * `{ ok:false, error }` so callers can degrade gracefully.
 */
export async function engineFetch(path: string, init?: RequestInit): Promise<EngineResponse> {
  return fetchEngineJson(path, init, ENGINE_TIMEOUT_MS)
}

/**
 * Liveness check against engine `GET /health` (3s timeout).
 * Any HTTP response counts as reachable; the `ok` flag in the
 * payload is honored when present.
 */
export async function engineHealth(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(`${ENGINE_URL}/health`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return false
    try {
      const data = (await res.json()) as EngineResponse | null
      return data?.ok !== false
    } catch {
      return true // responded with non-JSON — still reachable
    }
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Forward an incoming /api/* request to the engine as-is
 * (method + JSON body) and relay its envelope to the client.
 *
 * Status mapping:
 *  - engine `ok:true`        → 200 (payload passed through)
 *  - engine `ok:false`       → 502 (engine-level error)
 *  - engine offline          → 503 `Engine không trực tuyến`
 *  - engine timeout          → 504
 *  - malformed request body  → 400 `JSON không hợp lệ`
 */
export async function engineProxy(req: NextRequest, path: string): Promise<NextResponse> {
  const method = req.method.toUpperCase()

  let body: string | undefined
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    let raw = ''
    try {
      raw = await req.text()
    } catch {
      raw = ''
    }
    // Bodyless POSTs (e.g. job cancel/pause/resume) are forwarded as-is;
    // a non-empty body must be valid JSON.
    if (raw.trim() !== '') {
      try {
        body = JSON.stringify(JSON.parse(raw))
      } catch {
        return NextResponse.json({ ok: false, error: 'JSON không hợp lệ' }, { status: 400 })
      }
    }
  }

  const engineResponse = await engineFetch(
    path,
    body !== undefined ? { method, body } : { method },
  )

  if (!engineResponse.ok) {
    const error = typeof engineResponse.error === 'string' ? engineResponse.error : 'Lỗi engine'
    if (error === ENGINE_OFFLINE_ERROR) {
      return NextResponse.json({ ok: false, error }, { status: 503 })
    }
    if (error === ENGINE_TIMEOUT_ERROR) {
      return NextResponse.json({ ok: false, error }, { status: 504 })
    }
    // Engine answered with its own error envelope → relay it.
    return NextResponse.json(engineResponse, { status: 502 })
  }

  return NextResponse.json(engineResponse, { status: 200 })
}

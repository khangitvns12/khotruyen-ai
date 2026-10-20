import { all, run, now, sleep } from './db'
import { logWarn, logError } from './logger'

// ============================================================
// Gemini translation with multi-key rotation (contract §7)
// ============================================================

export interface TranslateCtx {
  novelTitle: string
  novelAuthor: string | null
  sourceLang: string
  targetLang: string
  model: string
  chunkSize: number
}

/** Thrown when no usable API key exists at all. */
export class GeminiNoKeysError extends Error {
  constructor(msg = 'Chưa có Gemini API key hoạt động — thêm key trong Cài đặt') {
    super(msg)
    this.name = 'GeminiNoKeysError'
  }
}

interface KeyInfo {
  id: string
  key: string
}

const cooldowns = new Map<string, number>() // keyId -> until-ts
let keyCursor = 0

function activeKeys(): KeyInfo[] {
  try {
    return all<{ id: string; key: string }>(
      "SELECT id, key FROM api_keys WHERE active = 1 AND status != 'error'"
    )
  } catch {
    return []
  }
}

export function hasActiveKeys(): boolean {
  return activeKeys().length > 0
}

function sourceLangLabel(lang: string): string {
  if (lang.startsWith('zh')) return 'tiếng Trung'
  switch (lang) {
    case 'vi':
      return 'tiếng Việt'
    case 'en':
      return 'tiếng Anh'
    case 'ja':
      return 'tiếng Nhật'
    case 'ko':
      return 'tiếng Hàn'
    default:
      return lang
  }
}

function buildPrompt(chunk: string, ctx: TranslateCtx): string {
  return `Bạn là một dịch giả văn học chuyên nghiệp, chuyên dịch tiểu thuyết mạng sang tiếng Việt.

Nhiệm vụ: dịch đoạn văn sau từ ${sourceLangLabel(ctx.sourceLang)} sang tiếng Việt, giữ nguyên giọng điệu và phong cách kể chuyện.
Bối cảnh truyện: «${ctx.novelTitle}» của tác giả ${ctx.novelAuthor || 'không rõ'}.

Quy tắc:
1. Giữ nguyên cấu trúc đoạn: mỗi đoạn nhập liệu là một dòng trong đầu ra, các đoạn cách nhau bằng một dòng trống.
2. Dịch tự nhiên như tiểu thuyết Việt Nam xuất bản; tên riêng/danh xưng dùng dạng Hán-Việt nếu tự nhiên (ví dụ: Trương Tam Phong), giữ cách xưng hô nhất quán.
3. Giữ nguyên các dấu câu hội thoại theo chuẩn tiếng Việt (dấu gạch ngang "—" hoặc dấu ngoặc kép), không thêm chú thích.
4. CHỈ xuất bản dịch, tuyệt đối không giải thích, không ghi chú, không lặp lại văn bản gốc.

Văn bản cần dịch:
${chunk}`
}

/** Split text into chunks ≤ chunkSize, cut on paragraph boundaries. */
export function chunkText(text: string, chunkSize: number): string[] {
  const max = Math.max(500, chunkSize || 1800)
  const paras = (text || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (p.length > max) {
      if (cur) {
        chunks.push(cur)
        cur = ''
      }
      let rest = p
      while (rest.length > max) {
        let cut = -1
        for (let i = max; i > max / 2; i--) {
          if (/[。！？.!?;；\n，,]/.test(rest[i] ?? '')) {
            cut = i + 1
            break
          }
        }
        if (cut <= 0) cut = max
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut)
      }
      if (rest.trim()) chunks.push(rest.trim())
      continue
    }
    if (cur && cur.length + p.length + 2 > max) {
      chunks.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) chunks.push(cur)
  return chunks
}

async function translateChunk(chunk: string, ctx: TranslateCtx, idx: number, total: number): Promise<string> {
  const prompt = buildPrompt(chunk, ctx)
  const MAX_ROUNDS = 5
  let lastErr: unknown = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const keys = activeKeys()
    if (keys.length === 0) throw new GeminiNoKeysError()

    const ts = now()
    const avail = keys.filter((k) => (cooldowns.get(k.id) ?? 0) <= ts)
    if (avail.length === 0) {
      logWarn(`Tất cả Gemini key đang bị giới hạn tốc độ — chờ 30s (vòng ${round + 1}/${MAX_ROUNDS})`)
      await sleep(30000)
      continue
    }

    const k = avail[keyCursor++ % avail.length]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      ctx.model || 'gemini-2.5-flash'
    )}:generateContent?key=${encodeURIComponent(k.key)}`

    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 60000)
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
          signal: ctrl.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (res.status === 429) {
        run("UPDATE api_keys SET status = 'rate_limited' WHERE id = ?", k.id)
        cooldowns.set(k.id, now() + 60000)
        logWarn(`Gemini key …${k.id.slice(0, 8)} bị 429 — cooldown 60s, đổi key`)
        lastErr = new Error('Rate limited (429)')
        continue
      }
      if (res.status === 400 || res.status === 403) {
        run('UPDATE api_keys SET status = ?, error_count = error_count + 1 WHERE id = ?', 'error', k.id)
        logError(`Gemini key …${k.id.slice(0, 8)} lỗi HTTP ${res.status} — vô hiệu hoá key`)
        lastErr = new Error(`Key lỗi HTTP ${res.status}`)
        continue
      }
      if (!res.ok) {
        lastErr = new Error(`Gemini HTTP ${res.status}`)
        await sleep(2000)
        continue
      }

      const data = (await res.json()) as any
      const cand = data?.candidates?.[0]
      if (cand?.finishReason === 'MAX_TOKENS') {
        logWarn(`Gemini MAX_TOKENS (chunk ${idx + 1}/${total}) — bản dịch có thể bị cắt`)
      }
      const out = ((cand?.content?.parts || []) as { text?: string }[])
        .map((p) => p?.text || '')
        .join('')
        .trim()
      if (!out) {
        lastErr = new Error('Gemini trả về rỗng')
        await sleep(2000)
        continue
      }
      run('UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ?, status = ? WHERE id = ?', now(), 'ok', k.id)
      return out
    } catch (e: unknown) {
      const err = e as Error
      lastErr = err?.name === 'AbortError' ? new Error('Timeout Gemini 60s') : err
      await sleep(2000)
    }
  }
  throw new Error(
    `Dịch chunk ${idx + 1}/${total} thất bại sau ${MAX_ROUNDS} vòng: ${(lastErr as Error)?.message ?? lastErr}`
  )
}

/** Translate a full chapter (multi-chunk), chunks joined by \n\n. */
export async function translateText(text: string, ctx: TranslateCtx): Promise<string> {
  const chunks = chunkText(text, ctx.chunkSize)
  if (!chunks.length) return ''
  const out: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    out.push((await translateChunk(chunks[i], ctx, i, chunks.length)).trim())
  }
  return out.join('\n\n')
}

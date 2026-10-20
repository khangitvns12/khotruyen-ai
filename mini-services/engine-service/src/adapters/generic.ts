import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import type { ChapterRef } from '../types'
import { decodeEntities } from '../clean'

export type Doc = CheerioAPI

export function loadDoc(html: string): Doc {
  return cheerio.load(html)
}

/** Convert an element's inner HTML to plain text: <br> → \n, block ends → \n\n. */
export function htmlToText(html: string): string {
  let h = (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|td|tr|li|blockquote|pre|h[1-6]|section|article|table|dl|dd|dt)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  h = decodeEntities(h)
  return h.replace(/\r\n?/g, '\n')
}

/** Remove common junk nodes from a whole document (in place). */
export function stripJunk($: Doc): void {
  $(
    'script, style, noscript, iframe, ins, nav, header, footer, form, button, input, select, textarea, link[rel=stylesheet]'
  ).remove()
}

/**
 * Generic content extractor: pick the div/td/article/section with the longest
 * text after removing script/style/nav/header/footer, then descend into the
 * densest child (>= 85% of parent text) to skip page furniture wrappers.
 */
export function textDensityExtract($: Doc): string {
  let bestEl: unknown = null
  let bestLen = 0
  for (const sel of ['article', 'td', 'div', 'section']) {
    $(sel).each((_, el) => {
      const len = $(el).text().length
      if (len > bestLen) {
        bestLen = len
        bestEl = el
      }
    })
  }
  if (!bestEl) return ''

  let cur = bestEl
  let curLen = bestLen
  for (let depth = 0; depth < 12; depth++) {
    let next: unknown = null
    let nextLen = 0
    $(cur)
      .children()
      .each((_, c) => {
        const len = $(c).text().length
        if (len >= curLen * 0.85 && len < curLen && len > nextLen) {
          next = c
          nextLen = len
        }
      })
    if (!next) break
    cur = next
    curLen = nextLen
  }
  return htmlToText($(cur).html() || '')
}

/** Absolute URL resolution. */
export function absUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/**
 * Collect chapter links matching a regex. Dedupe by URL keeping the LAST
 * occurrence (site "latest chapters" boxes appear before the real list),
 * preferring non-empty titles. Order of first insertion preserved per keep-last.
 */
export function collectChapterLinks($: Doc, baseUrl: string, pattern: RegExp): ChapterRef[] {
  const order: string[] = []
  const byUrl = new Map<string, ChapterRef>()
  $('a[href]').each((_, a) => {
    const href = ($(a).attr('href') || '').trim()
    if (!href || !pattern.test(href)) return
    const url = absUrl(href, baseUrl)
    if (!url) return
    const title = $(a).text().replace(/\s+/g, ' ').trim()
    if (!byUrl.has(url)) order.push(url)
    const prev = byUrl.get(url)
    if (!prev || title) byUrl.set(url, { url, title: title || prev.title })
  })
  return order.map((u) => byUrl.get(u)!) // eslint-disable-line @typescript-eslint/no-non-null-assertion
}

/** Read og: meta tags (property= or name=). */
export function ogMeta($: Doc): Record<string, string> {
  const out: Record<string, string> = {}
  $('meta').each((_, el) => {
    const prop = $(el).attr('property') || $(el).attr('name') || ''
    const content = $(el).attr('content') || ''
    if (prop.startsWith('og:') && content) out[prop] = content.trim()
  })
  return out
}

/** Fix protocol-relative //host/... image URLs. */
export function fixCover(url: string | null | undefined): string | null {
  if (!url) return null
  const u = url.trim()
  if (!u) return null
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('/')) {
    try {
      return new URL(u, 'https://example.com').pathname ? u : null
    } catch {
      return null
    }
  }
  return u
}

/** Chinese/arabic numeral parser for 第N回/第N章 ordering. */
export function cnNum(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const d: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  const u: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  if (!/^[零一二三四五六七八九十百千]+$/.test(s)) return null
  let total = 0
  let current = 0
  for (const ch of s) {
    if (d[ch] !== undefined) {
      current = d[ch]
    } else if (u[ch] !== undefined) {
      if (current === 0) current = 1
      total += current * u[ch]
      current = 0
    }
  }
  return total + current
}

/** Extract the chapter number from a title like 第一百二十回 ... / 第12章 ... */
export function chapterNumber(title: string): number | null {
  const m = title.match(/第\s*([0-9零一二三四五六七八九十百千]+)\s*[回章節节卷話话辑輯]/)
  if (!m) return null
  return cnNum(m[1])
}

/**
 * Sort chapter refs by their leading 第N章/第N回 number when EVERY entry parses
 * to a unique number; otherwise keep the given order.
 */
export function sortByChapterNumber(chapters: ChapterRef[]): ChapterRef[] {
  const nums = chapters.map((c) => chapterNumber(c.title))
  if (nums.some((n) => n === null)) return chapters
  const seen = new Set<number>()
  for (const n of nums as number[]) {
    if (seen.has(n)) return chapters
    seen.add(n)
  }
  const withIdx = chapters.map((c, i) => ({ c, n: nums[i] as number, i }))
  withIdx.sort((a, b) => a.n - b.n || a.i - b.i)
  return withIdx.map((x) => x.c)
}

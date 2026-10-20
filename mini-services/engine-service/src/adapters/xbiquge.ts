import { fetchHtml } from '../http'
import { cleanNovelText } from '../clean'
import type { BookInfo, ChapterContent, ChapterRef, SiteAdapter } from '../types'
import { collectChapterLinks, fixCover, htmlToText, loadDoc, ogMeta } from './generic'
import { sleep } from '../db'

const HOSTS = ['xbiquge.info', 'www.xbiquge.info', 'xbiquge.cc', 'www.xbiquge.cc']

/**
 * xbiquge REQUIRES browser navigation headers, otherwise chapter pages
 * 302-redirect back to the book page.
 */
const SEC_FETCH_HEADERS: Record<string, string> = {
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
}

function parseBookPath(url: string): { a: string; b: string } | null {
  const m = url.match(/\/(\d+)\/(\d+)(?:\/index_\d+\.html)?\/?$/)
  if (!m) return null
  return { a: m[1], b: m[2] }
}

function cidFrom(href: string): number | null {
  const m = href.match(/\/(\d+)\.html?$/)
  return m ? parseInt(m[1], 10) : null
}

export const xbiquge: SiteAdapter = {
  id: 'xbiquge',
  siteName: '新笔趣阁',
  lang: 'zh',
  hosts: HOSTS,

  normalizeUrl(url: string): string {
    const p = parseBookPath(url)
    if (!p) return url
    return `https://www.xbiquge.info/${p.a}/${p.b}/`
  },

  async fetchBook(url: string): Promise<BookInfo> {
    const p = parseBookPath(url)
    if (!p) throw new Error('URL xbiquge không hợp lệ (cần /{a}/{b}/)')
    const bookUrl = `https://www.xbiquge.info/${p.a}/${p.b}/`
    const { html: bookHtml } = await fetchHtml(bookUrl, {
      extraHeaders: SEC_FETCH_HEADERS,
    })
    const $ = loadDoc(bookHtml)
    const og = ogMeta($)

    const title = og['og:novel:book_name'] || $('#info h1').first().text().trim() || $('h1').first().text().trim()
    const author = og['og:novel:author'] || $('#info p').first().text().replace(/^.*?作者[:：]?\s*/, '').trim() || null
    const description = og['og:description'] || $('#intro').first().text().trim() || null
    const cover = fixCover(og['og:image'] || $('#fmimg img').first().attr('src'))
    const status = og['og:novel:status'] || null
    if (!title) throw new Error('Không đọc được tên truyện từ xbiquge')
    const meta = { title, author, cover, description, status, lang: 'zh' }

    // The chapter list is paginated: /{a}/{b}/index_1.html .. index_N.html.
    // The pager may contain sentinel links (e.g. index_99999.html) — ignore
    // absurd values; also read the pager "current/total" badge when present.
    let maxPage = 1
    const pagerTotal = bookHtml.match(/class="page-link"[^>]*>\s*(\d+)\s*\/\s*(\d+)\s*</)
    if (pagerTotal) {
      maxPage = Math.max(maxPage, parseInt(pagerTotal[2], 10))
    }
    for (const m of bookHtml.matchAll(/index_(\d+)\.html/g)) {
      const n = parseInt(m[1], 10)
      if (n > 500) continue // template sentinel (index_99999.html)
      maxPage = Math.max(maxPage, n)
    }
    maxPage = Math.min(maxPage, 200)

    const pattern = new RegExp(`^/${p.a}/${p.b}/\\d+\\.html?$`)
    const chapters: ChapterRef[] = []
    const byUrl = new Map<string, ChapterRef>()
    for (let page = 1; page <= maxPage; page++) {
      const pageUrl = page === 1 ? bookUrl : `https://www.xbiquge.info/${p.a}/${p.b}/index_${page}.html`
      let listHtml: string
      try {
        const fetched = await fetchHtml(pageUrl, {
          referer: bookUrl,
          extraHeaders: SEC_FETCH_HEADERS,
          retries: 1,
        })
        listHtml = fetched.html
      } catch {
        // beyond the real last page (sentinels / soft-404s) — keep what we have
        if (page > 1) break
        throw new Error('Không tải được trang danh sách chương xbiquge')
      }
      const $list = loadDoc(listHtml)
      // keep-last dedupe within a page: "latest 12 chapters" box precedes the
      // real list; trailing empty-text anchors are ignored.
      const links = collectChapterLinks($list, bookUrl, pattern)
      for (const l of links) {
        if (l.title) byUrl.set(l.url, l)
        else if (!byUrl.has(l.url)) byUrl.set(l.url, l)
      }
      if (page < maxPage) await sleep(400)
    }
    for (const l of byUrl.values()) chapters.push(l)

    // Chapter ids increase with reading order on this site — sort by cid so
    // stray "latest chapter box" entries land at their true position.
    chapters.sort((x, y) => (cidFrom(x.url) ?? 0) - (cidFrom(y.url) ?? 0))
    if (!chapters.length) throw new Error('Không đọc được danh sách chương từ xbiquge')
    return { meta, chapters }
  },

  async fetchChapter(url: string): Promise<ChapterContent> {
    const p = parseBookPath(url.replace(/_\d+\.html?$/, '.html'))
    const bookUrl = p ? `https://www.xbiquge.info/${p.a}/${p.b}/` : undefined
    const base = url.replace(/\.html?$/, '')

    let title = ''
    let totalPages = 1

    for (let attempt = 0; attempt < 3; attempt++) {
      const parts: string[] = []
      try {
        const { html } = await fetchHtml(url, {
          referer: bookUrl,
          extraHeaders: SEC_FETCH_HEADERS,
        })
        const $ = loadDoc(html)
        const rawTitle = ($('h1').first().text() || '').replace(/\s+/g, ' ').trim()
        title = rawTitle.replace(/[-–—]?\s*《[^》]*》\s*$/, '').trim() || rawTitle

        const contentEl = $('article').first().length
          ? $('article').first()
          : $('#content').first().length
            ? $('#content').first()
            : $('.showtxt').first()
        if (!contentEl.length) throw new Error('không tìm thấy nội dung')
        let text = htmlToText(contentEl.html() || '')

        // Chapter pagination marker: 第(N/M)页
        const marker = text.match(/第\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*[页頁]/)
        if (marker) {
          totalPages = Math.max(1, parseInt(marker[2], 10))
          parts.push(stripPageMarkers(text))
          for (let pg = 2; pg <= Math.min(totalPages, 30); pg++) {
            const { html: pgHtml } = await fetchHtml(`${base}_${pg}.html`, {
              referer: url,
              extraHeaders: SEC_FETCH_HEADERS,
            })
            const $pg = loadDoc(pgHtml)
            const pgEl = $('article').first().length
              ? $('article').first()
              : $('#content').first().length
                ? $('#content').first()
                : $('.showtxt').first()
            parts.push(stripPageMarkers(htmlToText(pgEl.html() || '')))
            await sleep(300)
          }
        } else {
          parts.push(text)
        }

        const joined = parts.join('\n\n')
        const content = cleanNovelText(joined, 'xbiquge')
        if (content.replace(/\s/g, '').length < 20) throw new Error('nội dung trống')
        return { title, content }
      } catch (e) {
        if (attempt === 2) throw new Error(`Không đọc được chương xbiquge: ${(e as Error).message}`)
        await sleep(2000)
      }
    }
    throw new Error('Không đọc được chương xbiquge')
  },
}

function stripPageMarkers(text: string): string {
  return text.replace(/第\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*[页頁]\s*/g, '\n').replace(/\n{3,}/g, '\n\n')
}

import { fetchHtml } from '../http'
import { cleanNovelText } from '../clean'
import type { BookInfo, ChapterContent, ChapterRef, SiteAdapter } from '../types'
import { fixCover, htmlToText, loadDoc, ogMeta } from './generic'
import { sleep } from '../db'

const HOSTS = ['truyenfull.vn', 'www.truyenfull.vn', 'truyenfull.vision', 'truyenfull.live', 'www.truyenfull.live']

const BASE = 'https://truyenfull.live'

function slugFrom(url: string): string | null {
  const m = url.match(/https?:\/\/[^/]+\/([^/?#]+)/)
  return m ? m[1] : null
}

function normalizeTruyenfullUrl(url: string): string {
  const slug = slugFrom(url)
  if (!slug) return url
  return `${BASE}/${slug}/`
}

const SEO_JUNK_RE =
  /^(truyen full|truyenfull|truyenfullvn|truyenfulllive|truyenfull vn|đọc truyện|đọc truyện miễn phí|thông tin|nhân vật chính|thể loại|đánh giá)/i

export const truyenfull: SiteAdapter = {
  id: 'truyenfull',
  siteName: 'TruyenFull',
  lang: 'vi',
  hosts: HOSTS,

  normalizeUrl(url: string): string {
    return normalizeTruyenfullUrl(url)
  },

  async fetchBook(url: string): Promise<BookInfo> {
    const slug = slugFrom(url)
    if (!slug) throw new Error('URL truyenfull không hợp lệ (cần /{slug}/)')
    const bookUrl = `${BASE}/${slug}/`
    const { html } = await fetchHtml(bookUrl)
    const $ = loadDoc(html)
    const og = ogMeta($)

    const title =
      og['og:title'] ||
      $('h3.title').first().text().trim() ||
      ($('title').first().text() || '').split(/[-|]/)[0].trim() ||
      slug
    const author = $('a[href*="/tac-gia/"]').first().text().trim() || og['og:novel:author'] || null
    const cover = fixCover(og['og:image'])

    // Description: .col-info-desc paragraphs, dropping SEO junk lines.
    const descParts: string[] = []
    $('.col-info-desc p, #intro p, .desc-text p').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim()
      if (t && t.length > 30 && !SEO_JUNK_RE.test(t) && !/truyenfull/i.test(t)) descParts.push(t)
    })
    const description = descParts.join(' ') || null

    const infoText = $('.info-holder').first().text().replace(/\s+/g, ' ')
    const status = /Full/i.test(infoText) ? 'Full' : /Đang ra/i.test(infoText) ? 'Đang ra' : null

    // Chapter list: 50 per page; total pages in input#total-page
    const totalPagesRaw = $('input#total-page').attr('value')
    const totalPages = Math.max(1, Math.min(parseInt(totalPagesRaw || '1', 10) || 1, 200))

    const chapters: ChapterRef[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= totalPages; page++) {
      const pageUrl = page === 1 ? bookUrl : `${BASE}/${slug}/trang-${page}/`
      const { html: pageHtml } =
        page === 1 ? { html } : await fetchHtml(pageUrl, { referer: bookUrl })
      const $p = loadDoc(pageHtml)
      $p('ul.list-chapter a[href]').each((_, el) => {
        const href = $(el).attr('href') || ''
        const text = $(el).text().replace(/\s+/g, ' ').trim()
        const abs = href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
        if (!text || seen.has(abs)) return
        seen.add(abs)
        chapters.push({ title: text, url: abs })
      })
      if (page < totalPages) await sleep(400)
    }

    if (!chapters.length) throw new Error('Không đọc được danh sách chương từ truyenfull')
    return {
      meta: { title, author, cover, description, status, lang: 'vi' },
      chapters,
    }
  },

  async fetchChapter(url: string): Promise<ChapterContent> {
    const slug = slugFrom(url)
    const referer = slug ? `${BASE}/${slug}/` : undefined
    const { html } = await fetchHtml(url, { referer })
    const $ = loadDoc(html)

    let title = ($('h2').first().text() || $('.chapter-title').first().text() || '').trim()
    if (!title) {
      const titleTag = ($('title').first().text() || '').replace(/\s*-\s*Truyenfull\.vn\s*$/i, '')
      const m = titleTag.match(/:\s*(Chương[^:]*:.*?)\s*$/)
      title = (m ? m[1] : titleTag).trim()
    }

    const contentEl = $('div#chapter-c').first()
    if (!contentEl.length) throw new Error('Không tìm thấy div#chapter-c (truyenfull)')
    const clone = contentEl.clone()
    clone.find('#ads-chapter-top, [class*=ads], [id^=ads], script, iframe, ins, style, .adsbygoogle').remove()
    const content = cleanNovelText(htmlToText(clone.html() || ''), 'truyenfull')
    if (content.replace(/\s/g, '').length < 20) {
      throw new Error('Nội dung chương trống (truyenfull)')
    }
    return { title, content }
  },
}

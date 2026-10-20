import { fetchHtml } from '../http'
import { cleanNovelText } from '../clean'
import type { BookInfo, ChapterContent, SiteAdapter } from '../types'
import { collectChapterLinks, fixCover, htmlToText, loadDoc, ogMeta } from './generic'

const HOSTS = ['69shuba.com', 'www.69shuba.com', '69shuba.cx', 'm.69shuba.com']

function bookIdFrom(url: string): string | null {
  const m = url.match(/\/book\/(\d+)/)
  return m ? m[1] : null
}

export const shuba69: SiteAdapter = {
  id: '69shuba',
  siteName: '69书吧',
  lang: 'zh',
  hosts: HOSTS,

  normalizeUrl(url: string): string {
    const id = bookIdFrom(url)
    if (!id) return url
    return `https://www.69shuba.com/book/${id}.htm`
  },

  async fetchBook(url: string): Promise<BookInfo> {
    const id = bookIdFrom(url)
    if (!id) throw new Error('URL 69shuba không hợp lệ (cần /book/{id}.htm)')
    const bookUrl = `https://www.69shuba.com/book/${id}.htm`
    const { html } = await fetchHtml(bookUrl)
    const $ = loadDoc(html)
    const og = ogMeta($)
    const meta = {
      title: og['og:novel:book_name'] || $('h1').first().text().trim() || `Book ${id}`,
      author: og['og:novel:author'] || null,
      cover: fixCover(og['og:image']),
      description: og['og:description'] || null,
      status: og['og:novel:status'] || null,
      lang: 'zh',
    }

    // Full catalog — may span multiple ?p=N pages (usually a single page).
    const chapters: { title: string; url: string }[] = []
    const seen = new Set<string>()
    let page = 1
    while (page < 50) {
      const { html: catHtml } = await fetchHtml(`https://www.69shuba.com/book/${id}/?p=${page}`, {
        referer: bookUrl,
      })
      const $cat = loadDoc(catHtml)
      const links = collectChapterLinks($cat, `https://www.69shuba.com/book/${id}/`, /^\/txt\/\d+\/\d+\/?$|https?:\/\/(www\.)?69shuba\.(com|cx)\/txt\/\d+\/\d+\/?$/)
      for (const l of links) {
        const normalized = l.url.replace(/^https?:\/\/(www\.)?69shuba\.(com|cx)/, 'https://www.69shuba.com').replace(/\/$/, '')
        if (!seen.has(normalized)) {
          seen.add(normalized)
          chapters.push({ title: l.title, url: normalized })
        }
      }
      if (links.length === 0) break
      // Continue only when the page itself links to the next catalog page
      const hasNext =
        catHtml.includes(`?p=${page + 1}`) ||
        catHtml.includes(`&amp;p=${page + 1}`) ||
        (/下一页|下一頁/.test(catHtml) && /p=/.test(catHtml))
      if (!hasNext) break
      page++
    }

    // The catalog lists newest chapter first → reverse for ascending order.
    chapters.reverse()
    if (!chapters.length) throw new Error('Không đọc được danh sách chương từ 69shuba')
    return { meta, chapters }
  },

  async fetchChapter(url: string): Promise<ChapterContent> {
    const m = url.match(/\/txt\/(\d+)\/(\d+)/)
    const referer = m ? `https://www.69shuba.com/book/${m[1]}.htm` : undefined
    const { html } = await fetchHtml(url, { referer })
    const $ = loadDoc(html)
    const nav = $('div.txtnav').first()
    if (!nav.length) throw new Error('Không tìm thấy div.txtnav (69shuba)')
    const title = (nav.find('h1').first().text() || $('h1').first().text() || '').replace(/\s+/g, ' ').trim()
    const content = nav
      .clone()
      .find('#txtright, .txtinfo, h1, script, style, .hide720, nav, ins, iframe')
      .remove()
      .end()
    const text = cleanNovelText(htmlToText(content.html() || ''), '69shuba')
    return { title, content: text }
  },
}

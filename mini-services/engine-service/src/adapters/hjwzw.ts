import { fetchHtml } from '../http'
import { cleanNovelText } from '../clean'
import type { BookInfo, ChapterContent, ChapterRef, SiteAdapter } from '../types'
import {
  absUrl,
  collectChapterLinks,
  fixCover,
  loadDoc,
  ogMeta,
  sortByChapterNumber,
  stripJunk,
  textDensityExtract,
} from './generic'

const HOSTS = ['hjwzw.com', 'www.hjwzw.com', 'tw.hjwzw.com']

function bookIdFrom(url: string): string | null {
  const m = url.match(/\/Book\/(\d+)/i)
  return m ? m[1] : null
}

export const hjwzw: SiteAdapter = {
  id: 'hjwzw',
  siteName: '黃金屋',
  lang: 'zh-TW',
  hosts: HOSTS,

  normalizeUrl(url: string): string {
    const id = bookIdFrom(url)
    if (!id) return url
    return `https://tw.hjwzw.com/Book/${id}`
  },

  async fetchBook(url: string): Promise<BookInfo> {
    const id = bookIdFrom(url)
    if (!id) throw new Error('URL hjwzw không hợp lệ (cần /Book/{id})')
    const bookUrl = `https://tw.hjwzw.com/Book/${id}`

    const { html } = await fetchHtml(bookUrl)
    const $ = loadDoc(html)
    const og = ogMeta($)
    const meta = {
      title: og['og:novel:book_name'] || $('h1').first().text().trim() || `Book ${id}`,
      author: og['og:novel:author'] || null,
      cover: fixCover(og['og:image']),
      description: og['og:description'] || null,
      status: og['og:novel:status'] || null,
      lang: 'zh-TW',
    }

    // Full TOC at /Book/Chapter/{id}
    const { html: tocHtml } = await fetchHtml(`https://tw.hjwzw.com/Book/Chapter/${id}`, {
      referer: bookUrl,
    })
    const $toc = loadDoc(tocHtml)
    const pattern = new RegExp(`^/Book/Read/${id},\\d+/?$`, 'i')
    const raw = collectChapterLinks($toc, `https://tw.hjwzw.com/Book/Chapter/${id}`, pattern)

    // TOC is mostly in reading order, but a stray chapter (out-of-sequence id)
    // can sit at the end — sort by 第N回/第N章 number when parseable & unique.
    const byUrl = new Map<string, ChapterRef>()
    for (const l of raw) byUrl.set(l.url, l)
    const chapters = sortByChapterNumber([...byUrl.values()])
    if (!chapters.length) throw new Error('Không đọc được danh sách chương từ hjwzw')
    return { meta, chapters }
  },

  async fetchChapter(url: string): Promise<ChapterContent> {
    const id = (url.match(/\/Book\/Read\/(\d+),/i) || [])[1]
    const referer = id ? `https://tw.hjwzw.com/Book/Chapter/${id}` : undefined
    const { html } = await fetchHtml(url, { referer })
    const $ = loadDoc(html)

    // Title from <title>: "{novel}{chapter},{author} | 黃金屋中文"
    let title = ''
    const titleTag = ($('title').first().text() || '').trim()
    if (titleTag) {
      title = titleTag.split(',')[0].split('|')[0].trim()
      // strip the leading novel name if the breadcrumb gives us something better
      const breadcrumb = $('.crumbs a, .breadcrumb a, .path a').last().text().trim()
      if (breadcrumb && title.endsWith(breadcrumb) && breadcrumb.length < title.length) {
        title = breadcrumb
      }
    }
    if (!title) title = $('h1').first().text().trim()

    stripJunk($)
    let text = textDensityExtract($)
    if (!text) {
      // fallback: whole <body>
      text = textDensityExtract(loadDoc(html))
    }
    const content = cleanNovelText(text, 'hjwzw')
    if (content.replace(/\s/g, '').length < 20) {
      throw new Error('Không đọc được nội dung chương từ hjwzw')
    }
    return { title, content }
  },
}

export { absUrl }

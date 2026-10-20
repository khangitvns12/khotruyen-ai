import { fetchHtml } from '../http'
import { cleanNovelText } from '../clean'
import type { BookInfo, ChapterContent, ChapterRef, SiteAdapter } from '../types'
import { collectChapterLinks, fixCover, htmlToText, loadDoc, ogMeta } from './generic'
import { sleep } from '../db'

const HOSTS = ['novel543.com', 'www.novel543.com']

function storyIdFrom(url: string): string | null {
  const m = url.match(/\/(\d{6,})/)
  return m ? m[1] : null
}

/** chapter number from /{story}/{section}_{chapter}(_{page})?.html */
function chapterNoFrom(href: string): number | null {
  const m = href.match(/_(\d+)(?:_\d+)?\.html?$/)
  return m ? parseInt(m[1], 10) : null
}

export const novel543: SiteAdapter = {
  id: 'novel543',
  siteName: '小說543',
  lang: 'zh-TW',
  hosts: HOSTS,

  normalizeUrl(url: string): string {
    const id = storyIdFrom(url)
    if (!id) return url
    return `https://www.novel543.com/${id}/`
  },

  async fetchBook(url: string): Promise<BookInfo> {
    const id = storyIdFrom(url)
    if (!id) throw new Error('URL novel543 không hợp lệ (cần /{id}/)')
    const storyUrl = `https://www.novel543.com/${id}/`
    const { html } = await fetchHtml(storyUrl)
    const $ = loadDoc(html)
    const og = ogMeta($)

    let title = og['og:novel:book_name'] || ''
    let author = og['og:novel:author'] || null
    if (!title) {
      const titleTag = ($('title').first().text() || $('h1').first().text() || '').trim()
      const m = titleTag.match(/《(.+?)》\s*\((.+?)\)/)
      if (m) {
        title = m[1].trim()
        author = m[2].trim()
      } else {
        title = titleTag.split(/[_|]/)[0].trim() || `Story ${id}`
      }
    }
    if (!title) title = `Story ${id}`
    const meta = {
      title,
      author,
      cover: fixCover(og['og:image']),
      description: og['og:description'] || null,
      status: og['og:novel:status'] || null,
      lang: 'zh-TW',
    }

    // Full chapter list at /{id}/dir
    const { html: dirHtml } = await fetchHtml(`https://www.novel543.com/${id}/dir`, {
      referer: storyUrl,
    })
    const $dir = loadDoc(dirHtml)
    const pattern = new RegExp(`^/${id}/\\d+_\\d+\\.html?$`)
    const links = collectChapterLinks($dir, `https://www.novel543.com/${id}/`, pattern)

    // The dir page lists a "latest chapters" box (descending) before the full
    // ascending list — keep-last dedupe keeps the full list ordering; the URL
    // itself carries the chapter number so we sort by it as a safety net.
    const byUrl = new Map<string, ChapterRef>()
    for (const l of links) byUrl.set(l.url, l)
    const chapters = [...byUrl.values()].sort(
      (x, y) => (chapterNoFrom(x.url) ?? 0) - (chapterNoFrom(y.url) ?? 0)
    )
    if (!chapters.length) throw new Error('Không đọc được danh sách chương từ novel543')
    return { meta, chapters }
  },

  async fetchChapter(url: string): Promise<ChapterContent> {
    const id = storyIdFrom(url)
    const base = url.replace(/\.html?$/, '')
    const referer = id ? `https://www.novel543.com/${id}/dir` : undefined

    const { html } = await fetchHtml(url, { referer })
    const $ = loadDoc(html)

    const h1 = $('.chapter-content h1').first().text() || $('h1').first().text() || ''
    const title = h1.replace(/\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, '').replace(/\s+/g, ' ').trim()

    const grab = (docHtml: string): string => {
      const $d = loadDoc(docHtml)
      const content = $d('.chapter-content .content, .chapter-content div.content, div.content').first()
      if (!content.length) return ''
      const clone = content.clone()
      clone.find('.gadBlock, .adBlock, script, iframe, ins, style, nav').remove()
      return htmlToText(clone.html() || '')
    }

    const parts: string[] = [grab(html)]

    // Multi-page: title carries (p/N), page >= 2 lives at {section}_{chapter}_{p}.html
    const marker = h1.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/)
    if (marker) {
      const total = Math.min(parseInt(marker[2], 10) || 1, 30)
      for (let pg = parseInt(marker[1], 10) + 1; pg <= total; pg++) {
        const { html: pgHtml } = await fetchHtml(`${base}_${pg}.html`, { referer: url })
        parts.push(grab(pgHtml))
        await sleep(300)
      }
    }

    const content = cleanNovelText(parts.join('\n\n'), 'novel543')
    if (content.replace(/\s/g, '').length < 20) {
      throw new Error('Không đọc được nội dung chương từ novel543')
    }
    return { title, content }
  },
}

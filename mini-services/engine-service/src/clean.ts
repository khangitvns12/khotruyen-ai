// Contract §6.6 — watermark/junk line removal, entity decode, blank collapse.

const WATERMARK_RE =
  /69书吧|69shuba|笔趣阁|xbiquge|新笔趣阁|novel543|543|hjwzw|黃金屋|黄金屋|truyenfull|TruyenFull|請記住|请记住|首发域名|最新章节|无弹窗|無彈窗|纯文字|純文字|天才一秒|一秒记住|手机阅读|手機閱讀|本章完|ads by|đọc truyện miễn phí tại/i

const JUNK_LINE_RE =
  /^(快捷鍵|快捷键|上一章|下一章|回車鍵|回车键|返回書頁|返回书页|溫馨提示|温馨提示|請收藏|请收藏|加入書籤|加入书签|目\s*錄|目\s*录|章節目錄|章节目录|展開|展开|收縮|收缩)|站內信|用戶中心|登錄用戶/

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  emsp: ' ',
  ensp: ' ',
  thinsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  permil: '‰',
  prime: '′',
  Prime: '″',
  laquo: '\u00AB',
  raquo: '\u00BB',
  times: '×',
  divide: '÷',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, g: string) => {
    if (g.startsWith('#')) {
      const isHex = g[1] === 'x' || g[1] === 'X'
      const code = isHex ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      if (!isNaN(code) && code > 0 && code < 0x110000) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return m
        }
      }
      return m
    }
    return NAMED_ENTITIES[g.toLowerCase()] ?? m
  })
}

/**
 * Clean raw extracted chapter text:
 * - decode entities, drop zero-width chars
 * - hjwzw anti-scrape junk single chars (§6.4)
 * - drop watermark/ad/nav lines (short lines only, to protect real prose)
 * - trim each paragraph, paragraphs joined by \n\n
 */
export function cleanNovelText(raw: string, site?: string): string {
  let text = (raw || '').replace(/\r\n?/g, '\n')
  text = decodeEntities(text)
  text = text.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')

  if (site === 'hjwzw') {
    // Junk chars injected between punctuation / at line starts
    text = text.replace(/([\u3002\uFF01\uFF1F\u201D\u300B\n])[古齋下載网址]\s*/g, '$1')
    text = text.replace(/^\s*[古齋下載网址]\s+/gm, '')
  }

  const lines = text.split('\n').map((s) => s.replace(/[ \t\u3000\u00A0]+/g, ' ').trim())
  const kept = lines.filter((line) => {
    if (!line) return false
    if (/^[\s.。·•\-—_~*《》【】\[\]()（）]+$/.test(line)) return false
    if (line.length < 80 && WATERMARK_RE.test(line)) return false
    if (line.length < 80 && JUNK_LINE_RE.test(line)) return false
    return true
  })
  return kept.join('\n\n')
}

/** Normalize a string for fuzzy comparison (strip all whitespace). */
export function normCompare(s: string): string {
  return (s || '').replace(/\s+/g, '')
}

import { all, get, run, now, uuid, sleep, getNovel, getJob, novelRowToSummary } from './db'
import { log, logInfo, logWarn, logError, logSuccess } from './logger'
import { emitJob, emitNovel, emitChapter, emitStats } from './emitter'
import { loadSettings, hasActiveGeminiKeys } from './settings'
import { detectAdapter, adapterById } from './adapters'
import { cleanNovelText, normCompare } from './clean'
import { translateText, GeminiNoKeysError } from './gemini'
import { supabasePush } from './supabase'
import type {
  AppSettings,
  ChapterRow,
  EngineStats,
  JobRowDb,
  NovelRow,
  SiteAdapter,
} from './types'

interface ScrapeTask {
  jobId: string
  novelId: string
  chapterId: string
}

interface TranslateTask {
  jobId: string
  novelId: string
  chapterId: string
}

const MAX_WORKERS = 8
const CONSECUTIVE_ERROR_LIMIT = 20

export class JobEngine {
  private scrapeQueue: ScrapeTask[] = []
  private translateQueue: TranslateTask[] = []
  private inFlight = new Map<string, number>()
  private consecutiveErrors = new Map<string, number>()
  private settings: AppSettings
  private settingsReadAt = 0
  private scrapeActive = 0
  private translateActive = 0
  private statsTimer: ReturnType<typeof setInterval> | null = null
  readonly startedAt = Date.now()
  running = false

  start(): void {
    if (this.running) return
    this.running = true
    this.settings = loadSettings()
    this.settingsReadAt = Date.now()

    // ---- startup resume ----
    try {
      run("UPDATE chapters SET status = 'scraped' WHERE status = 'translating'")
      const runningJobs = all<{ id: string }>("SELECT id FROM jobs WHERE status = 'running'")
      for (const j of runningJobs) {
        run('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?', 'queued', now(), j.id)
      }
      const queued = all<JobRowDb>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC")
      for (const job of queued) {
        try {
          this.reenqueueJob(job)
        } catch (e) {
          logError(`Không enqueue lại job ${job.id}: ${(e as Error).message}`)
        }
      }
      logInfo(`Engine online — tiếp tục ${queued.length} job đang chờ`)
    } catch (e) {
      logError(`Lỗi resume khi khởi động: ${(e as Error).message}`)
    }

    // ---- worker pools ----
    for (let i = 0; i < MAX_WORKERS; i++) void this.scrapeWorkerLoop(i)
    for (let i = 0; i < MAX_WORKERS; i++) void this.translateWorkerLoop(i)

    // ---- stats broadcast ----
    this.statsTimer = setInterval(() => {
      try {
        emitStats(this.buildStats())
      } catch {
        /* ignore */
      }
    }, 3000)
  }

  getSettings(): AppSettings {
    if (Date.now() - this.settingsReadAt > 10000) {
      this.settings = loadSettings()
      this.settingsReadAt = Date.now()
    }
    return this.settings
  }

  // ============================================================
  // Job creation
  // ============================================================

  /** POST /jobs/scrape — sync fetch meta + upsert novel/chapters, enqueue. */
  async startScrapeJob(body: Record<string, unknown>): Promise<{ jobId: string; novelId: string; totalChapters: number; tasks: number }> {
    const url = String(body?.url ?? '').trim()
    if (!url) throw new Error('Thiếu tham số url')
    const adapter = detectAdapter(url)
    if (!adapter) {
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        /* ignore */
      }
      throw new Error(
        `Không hỗ trợ site ${host || url} — hiện hỗ trợ: 69shuba.com, xbiquge.info, novel543.com, hjwzw.com, truyenfull.live`
      )
    }
    const bookUrl = adapter.normalizeUrl(url)

    logInfo(`Đang tải thông tin truyện từ ${adapter.siteName}: ${bookUrl}`)
    const { meta, chapters } = await adapter.fetchBook(bookUrl)
    if (!chapters.length) throw new Error('Không tìm thấy chương nào cho truyện này')
    const ts = now()

    // ---- upsert novel by source_url ----
    let novel = get<NovelRow>('SELECT * FROM novels WHERE source_url = ?', bookUrl)
    let addedChapters = 0
    if (!novel) {
      const novelId = uuid()
      run(
        `INSERT INTO novels (id, source_site, source_url, title, author, cover_url, description, lang, status, total_chapters, scraped_count, translated_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        novelId,
        adapter.id,
        bookUrl,
        meta.title,
        meta.author,
        meta.cover,
        meta.description,
        meta.lang,
        meta.status,
        chapters.length,
        0,
        0,
        ts,
        ts
      )
      const stmt = (globalThis as any).__engineDb!.prepare(
        `INSERT INTO chapters (id, novel_id, idx, title, source_url, status) VALUES (?,?,?,?,?, 'pending')`
      )
      chapters.forEach((c, i) => stmt.run(uuid(), novelId, i + 1, c.title, c.url))
      novel = getNovel(novelId)!
      logSuccess(`Đã thêm truyện mới «${meta.title}» (${chapters.length} chương)`)
    } else {
      run(
        `UPDATE novels SET title=?, author=?, cover_url=?, description=?, status=?, total_chapters=?, updated_at=? WHERE id=?`,
        meta.title,
        meta.author ?? novel.author,
        meta.cover ?? novel.cover_url,
        meta.description ?? novel.description,
        meta.status ?? novel.status,
        chapters.length,
        ts,
        novel.id
      )
      // append chapters not yet known (match by source_url)
      const existing = all<{ idx: number; source_url: string }>(
        'SELECT idx, source_url FROM chapters WHERE novel_id = ?',
        novel.id
      )
      const knownUrls = new Set(existing.map((e) => e.source_url))
      const takenIdx = new Set<number>(existing.map((e) => e.idx))
      let appendCounter = Math.max(chapters.length, ...takenIdx, 0)
      const stmt = (globalThis as any).__engineDb!.prepare(
        `INSERT INTO chapters (id, novel_id, idx, title, source_url, status) VALUES (?,?,?,?,?, 'pending')`
      )
      for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i]
        if (knownUrls.has(c.url)) continue
        let idx = i + 1
        if (takenIdx.has(idx)) idx = ++appendCounter
        takenIdx.add(idx)
        stmt.run(uuid(), novel.id, idx, c.title, c.url)
        addedChapters++
      }
      novel = getNovel(novel.id)!
      if (addedChapters > 0) logInfo(`Đã thêm ${addedChapters} chương mới cho «${meta.title}»`)
    }

    // ---- select tasks for this job ----
    const from = body?.chapterFrom != null ? Math.max(1, parseInt(String(body.chapterFrom), 10) || 1) : null
    const to = body?.chapterTo != null ? parseInt(String(body.chapterTo), 10) || null : null
    let rows = all<ChapterRow>('SELECT * FROM chapters WHERE novel_id = ? ORDER BY idx ASC', novel.id)
    if (from != null || to != null) {
      rows = rows.filter((r) => (!from || r.idx >= from) && (!to || r.idx <= to))
    }
    const taskRows = rows.filter((r) => r.content === null || r.status === 'pending' || r.status === 'error')

    const jobId = uuid()
    const params = {
      url: bookUrl,
      autoTranslate: body?.autoTranslate === true,
      chapterFrom: from,
      chapterTo: to,
    }
    run(
      `INSERT INTO jobs (id, type, status, novel_id, params, progress, total, created_at, updated_at)
       VALUES (?,?, 'queued', ?, ?, 0, ?, ?, ?)`,
      jobId,
      'scrape',
      novel.id,
      JSON.stringify(params),
      taskRows.length,
      ts,
      ts
    )
    logInfo(
      `Đã tạo job cào «${novel.title}»: ${taskRows.length}/${rows.length} chương cần cào${addedChapters ? ` (trong đó ${addedChapters} chương mới)` : ''}`
    )
    emitJob(jobId)
    emitNovel(novelRowToSummary(novel))
    this.enqueueScrapeTasks(jobId, novel.id, taskRows)
    if (taskRows.length === 0) this.maybeFinishJob(jobId)
    return { jobId, novelId: novel.id, totalChapters: rows.length, tasks: taskRows.length }
  }

  /** POST /jobs/translate */
  startTranslateJob(body: Record<string, unknown>): { jobId: string; novelId: string; note?: string } {
    const novelId = String(body?.novelId ?? '').trim()
    if (!novelId) throw new Error('Thiếu tham số novelId')
    const novel = getNovel(novelId)
    if (!novel) throw new Error('Không tìm thấy truyện')
    const force = body?.force === true
    const s = this.getSettings()
    const ts = now()

    const jobId = uuid()
    const params = { novelId, force }

    if (!hasActiveGeminiKeys()) {
      run(
        `INSERT INTO jobs (id, type, status, novel_id, params, progress, total, error, created_at, updated_at, finished_at)
         VALUES (?,?, 'error', ?, ?, 0, 0, ?, ?, ?, ?)`,
        jobId,
        'translate',
        novelId,
        JSON.stringify(params),
        'Chưa có Gemini API key hoạt động — thêm key trong Cài đặt',
        ts,
        ts,
        ts
      )
      logWarn('Không thể tạo job dịch: chưa có Gemini API key hoạt động')
      emitJob(jobId)
      return { jobId, novelId, note: 'Chưa có Gemini API key hoạt động — thêm key trong Cài đặt' }
    }

    const srcLang = s.sourceLang === 'auto' ? novel.lang : s.sourceLang
    if (srcLang === s.targetLang) {
      run(
        `INSERT INTO jobs (id, type, status, novel_id, params, progress, total, created_at, updated_at, finished_at)
         VALUES (?,?, 'done', ?, ?, 0, 0, ?, ?, ?, ?)`,
        jobId,
        'translate',
        novelId,
        JSON.stringify(params),
        ts,
        ts,
        ts
      )
      logInfo(`Bỏ qua dịch «${novel.title}»: ngôn ngữ nguồn (${srcLang}) đã là ngôn ngữ đích (${s.targetLang})`)
      emitJob(jobId)
      return { jobId, novelId, note: `Bỏ qua dịch: nguồn đã là ${srcLang}` }
    }

    const rows = all<ChapterRow>(
      `SELECT * FROM chapters WHERE novel_id = ? AND content IS NOT NULL ${force ? '' : 'AND translated IS NULL'} ORDER BY idx ASC`,
      novelId
    )
    run(
      `INSERT INTO jobs (id, type, status, novel_id, params, progress, total, created_at, updated_at)
       VALUES (?,?, 'queued', ?, ?, 0, ?, ?, ?)`,
      jobId,
      'translate',
      novelId,
      JSON.stringify(params),
      rows.length,
      ts,
      ts
    )
    logInfo(`Đã tạo job dịch «${novel.title}»: ${rows.length} chương${force ? ' (dịch lại tất cả)' : ''}`)
    emitJob(jobId)
    this.enqueueTranslateTasks(jobId, novelId, rows)
    if (rows.length === 0) this.maybeFinishJob(jobId)
    return { jobId, novelId }
  }

  /** POST /jobs/retry — re-scrape chapters with status error/pending. */
  startRetryJob(body: Record<string, unknown>): { jobId: string; novelId: string; tasks: number } {
    const novelId = String(body?.novelId ?? '').trim()
    if (!novelId) throw new Error('Thiếu tham số novelId')
    const novel = getNovel(novelId)
    if (!novel) throw new Error('Không tìm thấy truyện')
    const rows = all<ChapterRow>(
      "SELECT * FROM chapters WHERE novel_id = ? AND status IN ('error','pending') ORDER BY idx ASC",
      novelId
    )
    const ts = now()
    const jobId = uuid()
    run(
      `INSERT INTO jobs (id, type, status, novel_id, params, progress, total, created_at, updated_at)
       VALUES (?,?, 'queued', ?, ?, 0, ?, ?, ?)`,
      jobId,
      'retry',
      novelId,
      JSON.stringify({ novelId }),
      rows.length,
      ts,
      ts
    )
    logInfo(`Đã tạo job cào lại «${novel.title}»: ${rows.length} chương lỗi/chưa cào`)
    emitJob(jobId)
    this.enqueueScrapeTasks(jobId, novelId, rows)
    if (rows.length === 0) this.maybeFinishJob(jobId)
    return { jobId, novelId, tasks: rows.length }
  }

  // ============================================================
  // Job control
  // ============================================================

  pause(jobId: string, reason?: string): void {
    const job = getJob(jobId)
    if (!job) throw new Error('Không tìm thấy job')
    if (job.status !== 'running' && job.status !== 'queued') {
      throw new Error(`Không thể tạm dừng job đang ${job.status}`)
    }
    run('UPDATE jobs SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE id = ?', 'paused', reason ?? null, now(), jobId)
    this.dropQueuedTasks(jobId)
    this.consecutiveErrors.delete(jobId)
    logInfo(`Đã tạm dừng job ${jobId.slice(0, 8)} (${job.type})${reason ? ` — ${reason}` : ''}`)
    emitJob(jobId)
  }

  resume(jobId: string): void {
    const job = getJob(jobId)
    if (!job) throw new Error('Không tìm thấy job')
    if (job.status !== 'paused') throw new Error(`Không thể tiếp tục job đang ${job.status}`)
    run('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?', 'queued', now(), jobId)
    this.consecutiveErrors.delete(jobId)
    this.reenqueueJob(job)
    logInfo(`Đã tiếp tục job ${jobId.slice(0, 8)} (${job.type})`)
    emitJob(jobId)
  }

  cancel(jobId: string): void {
    const job = getJob(jobId)
    if (!job) throw new Error('Không tìm thấy job')
    if (job.status === 'done' || job.status === 'cancelled') {
      this.dropQueuedTasks(jobId)
      return
    }
    run('UPDATE jobs SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?', 'cancelled', now(), now(), jobId)
    this.dropQueuedTasks(jobId)
    this.consecutiveErrors.delete(jobId)
    logInfo(`Đã huỷ job ${jobId.slice(0, 8)} (${job.type})`)
    emitJob(jobId)
  }

  private dropQueuedTasks(jobId: string): void {
    this.scrapeQueue = this.scrapeQueue.filter((t) => t.jobId !== jobId)
    this.translateQueue = this.translateQueue.filter((t) => t.jobId !== jobId)
  }

  /** Recompute remaining tasks of a (paused/queued) job FROM the DB. */
  private reenqueueJob(job: JobRowDb): void {
    let params: Record<string, unknown> = {}
    try {
      params = JSON.parse(job.params || '{}')
    } catch {
      params = {}
    }
    const novelId = job.novel_id
    if (!novelId) return

    let taskRows: ChapterRow[] = []
    if (job.type === 'translate') {
      const force = params.force === true
      taskRows = all<ChapterRow>(
        `SELECT * FROM chapters WHERE novel_id = ? AND content IS NOT NULL ${force ? "AND status != 'translated'" : 'AND translated IS NULL'} ORDER BY idx ASC`,
        novelId
      )
      this.enqueueTranslateTasks(job.id, novelId, taskRows)
    } else {
      const from = params.chapterFrom != null ? Number(params.chapterFrom) : null
      const to = params.chapterTo != null ? Number(params.chapterTo) : null
      let sql = "SELECT * FROM chapters WHERE novel_id = ? AND (content IS NULL OR status IN ('pending','error'))"
      const args: unknown[] = [novelId]
      if (from != null && to != null) {
        sql += ' AND idx BETWEEN ? AND ?'
        args.push(from, to)
      } else if (from != null) {
        sql += ' AND idx >= ?'
        args.push(from)
      } else if (to != null) {
        sql += ' AND idx <= ?'
        args.push(to)
      }
      sql += ' ORDER BY idx ASC'
      taskRows = all<ChapterRow>(sql, ...args)
      this.enqueueScrapeTasks(job.id, novelId, taskRows)
    }
    // keep totals consistent: progress + remaining
    run('UPDATE jobs SET total = ?, updated_at = ? WHERE id = ?', job.progress + taskRows.length, now(), job.id)
    if (taskRows.length === 0) this.maybeFinishJob(job.id)
  }

  private enqueueScrapeTasks(jobId: string, novelId: string, rows: ChapterRow[]): void {
    for (const r of rows) {
      this.scrapeQueue.push({ jobId, novelId, chapterId: r.id })
    }
  }

  private enqueueTranslateTasks(jobId: string, novelId: string, rows: ChapterRow[]): void {
    for (const r of rows) {
      this.translateQueue.push({ jobId, novelId, chapterId: r.id })
    }
  }

  // ============================================================
  // Workers
  // ============================================================

  private async scrapeWorkerLoop(_workerId: number): Promise<void> {
    while (this.running) {
      const s = this.getSettings()
      const concurrency = Math.max(1, Math.min(s.scrapeConcurrency || 3, MAX_WORKERS))
      if (this.scrapeActive >= concurrency) {
        await sleep(250)
        continue
      }
      const task = this.scrapeQueue.shift()
      if (!task) {
        await sleep(300)
        continue
      }
      this.scrapeActive++
      this.inFlight.set(task.jobId, (this.inFlight.get(task.jobId) ?? 0) + 1)
      try {
        await this.processScrapeTask(task)
      } catch (e) {
        logError(`Lỗi worker cào (job ${task.jobId.slice(0, 8)}): ${(e as Error).message}`)
      } finally {
        this.scrapeActive--
        const v = (this.inFlight.get(task.jobId) ?? 1) - 1
        if (v <= 0) this.inFlight.delete(task.jobId)
        else this.inFlight.set(task.jobId, v)
        try {
          this.maybeFinishJob(task.jobId)
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async translateWorkerLoop(_workerId: number): Promise<void> {
    while (this.running) {
      const s = this.getSettings()
      const concurrency = Math.max(1, Math.min(s.translateConcurrency || 2, MAX_WORKERS))
      if (this.translateActive >= concurrency) {
        await sleep(250)
        continue
      }
      const task = this.translateQueue.shift()
      if (!task) {
        await sleep(300)
        continue
      }
      this.translateActive++
      this.inFlight.set(task.jobId, (this.inFlight.get(task.jobId) ?? 0) + 1)
      try {
        await this.processTranslateTask(task)
      } catch (e) {
        logError(`Lỗi worker dịch (job ${task.jobId.slice(0, 8)}): ${(e as Error).message}`)
      } finally {
        this.translateActive--
        const v = (this.inFlight.get(task.jobId) ?? 1) - 1
        if (v <= 0) this.inFlight.delete(task.jobId)
        else this.inFlight.set(task.jobId, v)
        try {
          this.maybeFinishJob(task.jobId)
        } catch {
          /* ignore */
        }
      }
    }
  }

  private ensureJobRunning(jobId: string): boolean {
    const job = getJob(jobId)
    if (!job) return false
    if (job.status === 'paused' || job.status === 'cancelled' || job.status === 'done' || job.status === 'error') {
      return false
    }
    if (job.status === 'queued') {
      run('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?', 'running', now(), jobId)
      emitJob(jobId)
    }
    return true
  }

  private async processScrapeTask(task: ScrapeTask): Promise<void> {
    if (!this.ensureJobRunning(task.jobId)) return
    const s = this.getSettings()

    const ch = get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', task.chapterId)
    if (!ch) {
      this.bumpProgress(task.jobId)
      return
    }
    // skip if already scraped by someone else
    if (ch.content && ch.status !== 'error' && ch.status !== 'pending') {
      this.bumpProgress(task.jobId)
      return
    }
    const novel = getNovel(task.novelId)
    const adapter: SiteAdapter | null = adapterById(novel?.source_site ?? '') ?? detectAdapter(ch.source_url)
    if (!adapter) {
      run('UPDATE chapters SET status = ?, error = ? WHERE id = ?', 'error', 'Không nhận diện được site', ch.id)
      this.bumpProgress(task.jobId)
      return
    }

    try {
      const { title, content } = await adapter.fetchChapter(ch.source_url, { bookUrl: novel?.source_url })
      let text = cleanNovelText(content, adapter.id)
      // drop a leading line that duplicates the chapter title
      const paras = text.split('\n\n')
      if (paras.length > 1) {
        const first = normCompare(paras[0])
        const t = normCompare(title)
        if (t && (first === t || (t.length >= 6 && first.startsWith(t)))) {
          text = paras.slice(1).join('\n\n')
        }
      }
      if (text.replace(/\s/g, '').length < 20) throw new Error('Nội dung chương trống sau khi làm sạch')
      run(
        `UPDATE chapters SET title = ?, content = ?, status = 'scraped', error = NULL, scraped_at = ? WHERE id = ?`,
        ch.title || title || `Chương ${ch.idx}`,
        text,
        now(),
        ch.id
      )
      this.consecutiveErrors.delete(task.jobId)
      const job = getJob(task.jobId)
      if (ch.idx % 10 === 0 && job) {
        logInfo(`Đã cào ${job.progress + 1}/${job.total} chương «${novel?.title ?? ''}» (chương ${ch.idx})`)
      }
      this.emitChapterRow(ch.id)
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      run('UPDATE chapters SET status = ?, error = ? WHERE id = ?', 'error', msg, ch.id)
      const cnt = (this.consecutiveErrors.get(task.jobId) ?? 0) + 1
      this.consecutiveErrors.set(task.jobId, cnt)
      logWarn(`Lỗi cào chương ${ch.idx} «${ch.title}»: ${msg}`)
      this.emitChapterRow(ch.id)
      if (cnt > CONSECUTIVE_ERROR_LIMIT) {
        logError(`Quá ${CONSECUTIVE_ERROR_LIMIT} lỗi liên tiếp — tạm dừng job (site có thể đang chặn)`)
        try {
          this.pause(task.jobId, `Tạm dừng tự động: hơn ${CONSECUTIVE_ERROR_LIMIT} lỗi liên tiếp (site có thể đang chặn)`)
        } catch {
          /* ignore */
        }
        return
      }
    }

    this.recomputeNovelCounts(task.novelId)
    this.bumpProgress(task.jobId)

    const delay = Math.max(0, s.scrapeDelayMs || 0)
    if (delay) await sleep(delay)
  }

  private async processTranslateTask(task: TranslateTask): Promise<void> {
    if (!this.ensureJobRunning(task.jobId)) return
    const s = this.getSettings()

    const ch = get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', task.chapterId)
    if (!ch || ch.content === null) {
      this.bumpProgress(task.jobId)
      return
    }
    const novel = getNovel(task.novelId)
    if (!novel) {
      this.bumpProgress(task.jobId)
      return
    }

    run("UPDATE chapters SET status = 'translating' WHERE id = ?", ch.id)
    this.emitChapterRow(ch.id)

    const srcLang = s.sourceLang === 'auto' ? novel.lang : s.sourceLang
    try {
      const translated = await translateText(ch.content, {
        novelTitle: novel.title,
        novelAuthor: novel.author,
        sourceLang: srcLang,
        targetLang: s.targetLang,
        model: s.geminiModel,
        chunkSize: s.chunkSize,
      })
      if (!translated.trim()) throw new Error('Bản dịch rỗng')
      run(
        `UPDATE chapters SET translated = ?, status = 'translated', translated_at = ? WHERE id = ?`,
        translated,
        now(),
        ch.id
      )
      this.consecutiveErrors.delete(task.jobId)
      const job = getJob(task.jobId)
      if (ch.idx % 10 === 0 && job) {
        logInfo(`Đã dịch ${job.progress + 1}/${job.total} chương «${novel.title}» (chương ${ch.idx})`)
      }
    } catch (e) {
      const err = e as Error
      if (e instanceof GeminiNoKeysError) {
        // no usable keys — abort the whole job, revert chapter
        run("UPDATE chapters SET status = 'scraped' WHERE id = ?", ch.id)
        run(
          'UPDATE jobs SET status = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?',
          'error',
          err.message,
          now(),
          now(),
          task.jobId
        )
        this.dropQueuedTasks(task.jobId)
        logError(`Job dịch dừng: ${err.message}`)
        this.emitChapterRow(ch.id)
        emitJob(task.jobId)
        return
      }
      run('UPDATE chapters SET status = ?, error = ? WHERE id = ?', 'error', err.message ?? String(err), ch.id)
      const cnt = (this.consecutiveErrors.get(task.jobId) ?? 0) + 1
      this.consecutiveErrors.set(task.jobId, cnt)
      logWarn(`Lỗi dịch chương ${ch.idx} «${ch.title}»: ${err.message}`)
      if (cnt > CONSECUTIVE_ERROR_LIMIT) {
        logError(`Quá ${CONSECUTIVE_ERROR_LIMIT} lỗi dịch liên tiếp — tạm dừng job`)
        try {
          this.pause(task.jobId, `Tạm dừng tự động: hơn ${CONSECUTIVE_ERROR_LIMIT} lỗi dịch liên tiếp`)
        } catch {
          /* ignore */
        }
        return
      }
    }

    this.recomputeNovelCounts(task.novelId)
    this.emitChapterRow(ch.id)
    this.bumpProgress(task.jobId)

    const delay = Math.max(0, s.translateDelayMs || 0)
    if (delay) await sleep(delay)
  }

  // ============================================================
  // Shared helpers
  // ============================================================

  private bumpProgress(jobId: string): void {
    run(
      "UPDATE jobs SET progress = MIN(progress + 1, total), updated_at = ? WHERE id = ? AND status IN ('running','queued')",
      now(),
      jobId
    )
    emitJob(jobId)
  }

  private maybeFinishJob(jobId: string): void {
    if ((this.inFlight.get(jobId) ?? 0) > 0) return
    if (this.scrapeQueue.some((t) => t.jobId === jobId)) return
    if (this.translateQueue.some((t) => t.jobId === jobId)) return
    const job = getJob(jobId)
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return

    run('UPDATE jobs SET status = ?, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?', 'done', now(), now(), jobId)
    const novel = job.novel_id ? getNovel(job.novel_id) : null
    logSuccess(
      `Hoàn thành job ${job.type} «${novel?.title ?? '—'}»: ${job.progress}/${job.total} chương`
    )
    emitJob(jobId)

    // post-actions for scrape/retry jobs
    if ((job.type === 'scrape' || job.type === 'retry') && job.novel_id) {
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(job.params || '{}')
      } catch {
        params = {}
      }
      const s = this.getSettings()
      if (params.autoTranslate === true) {
        const n = getNovel(job.novel_id)
        const srcLang = n ? (s.sourceLang === 'auto' ? n.lang : s.sourceLang) : 'zh'
        if (srcLang === s.targetLang) {
          logInfo('Bỏ qua tự động dịch: ngôn ngữ nguồn trùng ngôn ngữ đích')
        } else if (!hasActiveGeminiKeys()) {
          logWarn('Bỏ qua tự động dịch: chưa có Gemini API key hoạt động')
        } else {
          void this.startTranslateJob({ novelId: job.novel_id }).catch((e) =>
            logError(`Không tạo được job dịch tự động: ${(e as Error).message}`)
          )
        }
      }
      if (s.autoSyncSupabase && s.supabaseEnabled && s.supabaseUrl && s.supabaseKey) {
        void supabasePush(job.novel_id)
          .then((r) => logSuccess(`Tự động sync Supabase xong: ${r.novels} truyện / ${r.chapters} chương`))
          .catch((e) => logWarn(`Tự động sync Supabase lỗi (không ảnh hưởng job): ${(e as Error).message}`))
      }
    }
  }

  private recomputeNovelCounts(novelId: string): void {
    run(
      `UPDATE novels SET
         scraped_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = ? AND status IN ('scraped','translating','translated')),
         translated_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = ? AND status = 'translated'),
         updated_at = ?
       WHERE id = ?`,
      novelId,
      novelId,
      now(),
      novelId
    )
    const n = getNovel(novelId)
    if (n) emitNovel(novelRowToSummary(n))
  }

  private emitChapterRow(chapterId: string): void {
    const ch = get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', chapterId)
    if (!ch) return
    emitChapter({
      novelId: ch.novel_id,
      idx: ch.idx,
      status: ch.status,
      hasContent: ch.content !== null && ch.content.length > 0,
      hasTranslated: ch.translated !== null && ch.translated.length > 0,
    })
  }

  buildStats(): EngineStats {
    const row = get<Record<string, number>>(
      `SELECT
        (SELECT COUNT(*) FROM novels) AS novels,
        (SELECT COUNT(*) FROM chapters) AS chapters,
        (SELECT COUNT(*) FROM chapters WHERE status IN ('scraped','translating','translated')) AS scraped,
        (SELECT COUNT(*) FROM chapters WHERE status = 'translated') AS translated,
        (SELECT COUNT(*) FROM jobs WHERE status = 'running') AS runningJobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'queued') AS queuedJobs,
        (SELECT COUNT(*) FROM api_keys) AS keysTotal,
        (SELECT COUNT(*) FROM api_keys WHERE active = 1 AND status != 'error') AS keysActive,
        (SELECT COUNT(*) FROM api_keys WHERE status = 'rate_limited') AS keysRateLimited,
        (SELECT COUNT(*) FROM api_keys WHERE status = 'error') AS keysError`
    )
    return {
      novels: row?.novels ?? 0,
      chapters: row?.chapters ?? 0,
      scraped: row?.scraped ?? 0,
      translated: row?.translated ?? 0,
      runningJobs: row?.runningJobs ?? 0,
      queuedJobs: row?.queuedJobs ?? 0,
      keysTotal: row?.keysTotal ?? 0,
      keysActive: row?.keysActive ?? 0,
      keysRateLimited: row?.keysRateLimited ?? 0,
      keysError: row?.keysError ?? 0,
    }
  }

  queueLengths(): { scrape: number; translate: number } {
    return { scrape: this.scrapeQueue.length, translate: this.translateQueue.length }
  }
}

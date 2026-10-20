# KhoTruyện AI — Architecture & API Contract (v1)

> **Mục đích project**: Web app cào truyện từ 5 nguồn + dịch tự động bằng Gemini API + lưu Supabase + engine chạy nền phía server (tiếp tục cào khi đóng tab) + xuất truyện qua REST API.
> **UI ngôn ngữ**: tiếng Việt.

## 1. Kiến trúc tổng thể

```
[Browser /] ── fetch /api/* (relative) ──▶ [Next.js 16, port 3000]
      │                                        │ Prisma (read + keys/settings writes)
      │                                        │ fetch http://localhost:3002 (server-to-server proxy)
      └── socket.io io('/?XTransformPort=3002')─┤
                                               ▼
                            [Engine service, port 3002]  (mini-services/engine-service, Bun)
                               - socket.io server (path: '/')
                               - REST nội bộ (router tự viết, không framework)
                               - Job engine: cào chương + dịch Gemini (chạy nền vĩnh viễn)
                               - bun:sqlite → cùng file db với Prisma
                                                │
                                                ▼
                            [SQLite] /home/z/my-project/db/custom.db (WAL mode)
```

**Phân quyền ghi DB (quan trọng — tránh xung đột khóa):**
- **Engine (bun:sqlite) là writer chính**: novels, chapters, jobs, api_keys (usage stats), supabase sync.
- **Next.js (Prisma)**: viết `settings`, `api_keys` (CRUD từ UI), đọc mọi thứ. Prisma client: `import { db } from '@/lib/db'`.
- SQLite đã bật WAL. Engine luôn set `PRAGMA busy_timeout=10000` khi mở connection.

**Cổng & gateway (sandbox)**:
- Next.js: port 3000 (`bun run dev`, đang chạy nền).
- Engine: port **3002**, chạy bằng `bun run dev` (script: `bun --hot index.ts`) trong thư mục `mini-services/engine-service/`.
- Socket.io **server** đặt `path: '/engine-io'` — **KHÔNG dùng '/'** (đã test: path '/' khiến socket.io nuốt hết REST routes trên cùng port). REST router trên cùng httpServer: parse path bằng `new URL(req.url, 'http://x').pathname` (vì req.url có query string).
- Socket.io **client**: `io('/engine-io?XTransformPort=3002', { transports: ['websocket','polling'], reconnection: true, timeout: 10000 })` — KHÔNG ghi port trực tiếp trong URL. Đã verify end-to-end qua Caddy gateway (kèm query XTransformPort ở mọi request, WS upgrade OK).
- Frontend **chỉ** gọi fetch relative `/api/...` (port 3000). Tuyệt đối không fetch trực tiếp port khác / absolute URL localhost.
- Server Next.js gọi engine trực tiếp: `fetch('http://localhost:3002/...', { cache: 'no-store' })`.

## 2. Database schema (SQLite, đã push bằng Prisma)

Timestamps = epoch ms (Int). IDs = `crypto.randomUUID()`. Tables snake_case.

```sql
CREATE TABLE novels (
  id TEXT PRIMARY KEY, source_site TEXT NOT NULL, source_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, author TEXT, cover_url TEXT, description TEXT,
  lang TEXT NOT NULL DEFAULT 'zh', status TEXT,
  total_chapters INTEGER NOT NULL DEFAULT 0, scraped_count INTEGER NOT NULL DEFAULT 0,
  translated_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE chapters (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, title TEXT NOT NULL, source_url TEXT NOT NULL,
  content TEXT, translated TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|scraped|translating|translated|error
  error TEXT, scraped_at INTEGER, translated_at INTEGER,
  UNIQUE(novel_id, idx)
);
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'gemini', label TEXT,
  key TEXT NOT NULL, key_tail TEXT, active INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',      -- ok|rate_limited|error
  last_used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- value = JSON string
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL,            -- scrape|translate|retry
  status TEXT NOT NULL DEFAULT 'queued',              -- queued|running|paused|done|error|cancelled
  novel_id TEXT, params TEXT NOT NULL DEFAULT '{}',   -- params = JSON string
  progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER
);
```

Settings lưu ở row `key='app'`, `value` = JSON của `AppSettings` (xem `src/lib/types.ts` — file này là contract TypeScript dùng chung, import bằng `@/lib/types`). Engine đọc settings từ DB trước mỗi chu kỳ task (không cache lâu).

## 3. Engine REST API (port 3002, envelope `{ok:true,...}` / `{ok:false,error}`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | – | `{ok, uptime, running, queued, db:'ok'}` |
| GET | `/stats` | – | `{ok, stats: EngineStats}` |
| GET | `/jobs` | – | `{ok, jobs: JobRow[]}` (100 mới nhất, kèm novelTitle join từ novels) |
| GET | `/logs?limit=300` | – | `{ok, logs: LogEntry[]}` |
| POST | `/preview` | `{url}` | `{ok, preview: PreviewResult}` — fetch meta + đếm chương, **không ghi DB** |
| POST | `/jobs/scrape` | `{url, autoTranslate?, chapterFrom?, chapterTo?}` | `{ok, jobId, novelId}` — đồng bộ fetch meta + tạo novel & chapters (pending), rồi queue cào nội dung. Nếu novel theo source_url đã tồn tại → cập nhật meta, thêm chương mới, chỉ cào chương chưa có content (resume). |
| POST | `/jobs/translate` | `{novelId, force?}` | `{ok, jobId}` — dịch các chương có content & chưa dịch (force=true → dịch lại tất cả) |
| POST | `/jobs/retry` | `{novelId}` | `{ok, jobId}` — cào lại các chương error/pending |
| POST | `/jobs/:id/cancel` \| `/pause` \| `/resume` | – | `{ok}` |
| DELETE | `/novels/:id` | – | `{ok}` — huỷ job liên quan + xoá novel & chapters |
| POST | `/supabase/test` | `{url, key}` | `{ok, projects?}` hoặc `{ok:false, error}` — GET `{url}/rest/v1/` với header `apikey` |
| POST | `/supabase/sync` | `{novelId?}` | `{ok, novels:n, chapters:n, keys:n}` — push lên Supabase (1 novel hoặc tất cả) |
| POST | `/supabase/pull` | `{novelId?}` | `{ok, novels:n, chapters:n}` — kéo từ Supabase về local |

## 4. Socket.io events (engine → client)

Socket server: `new Server(httpServer, { path: '/engine-io', cors: { origin: '*' } })` — path '/engine-io' (đã verify; '/' sẽ phá REST).

- `log` → `LogEntry`
- `job` → `JobRow` (emit mỗi khi job đổi trạng thái/progress)
- `novel` → `NovelSummary` (emit khi counts đổi)
- `chapter` → `{ novelId, idx, status, hasContent, hasTranslated }`
- `stats` → `EngineStats` (mỗi ~3s)

## 5. Next.js API routes (src/app/api/**, envelope giống engine)

Next.js 16: **dynamic params là Promise** — `export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> })` → `const { id } = await params`. Thêm `export const dynamic = 'force-dynamic'` ở mọi route.

| Method | Path | Body/Query | Response |
|---|---|---|---|
| GET | `/api/stats` | – | `{ok, stats: EngineStats, engineOnline: boolean}` |
| GET | `/api/settings` | – | `{ok, settings: AppSettings}` (merge DEFAULT_SETTINGS; supabaseKey trả về masked dạng `••••tail` nếu có) |
| PUT | `/api/settings` | partial AppSettings | `{ok, settings}` |
| GET | `/api/keys` | – | `{ok, keys: ApiKeyView[]}` (không bao giờ trả key đầy đủ) |
| POST | `/api/keys` | `{key, label?}` | `{ok, key: ApiKeyView}` — validate bắt đầu bằng `AIza` hoặc dài ≥ 20 ký tự |
| PATCH | `/api/keys/[id]` | `{active?, label?}` | `{ok, key}` |
| DELETE | `/api/keys/[id]` | – | `{ok}` |
| GET | `/api/novels?q=` | search theo title/author | `{ok, novels: NovelSummary[]}` |
| GET | `/api/novels/[id]` | – | `{ok, novel, chapters: ChapterSummary[]}` (idx tăng dần) |
| GET | `/api/novels/[id]/chapters/[idx]` | – | `{ok, chapter: ChapterFull}` |
| DELETE | `/api/novels/[id]` | – | proxy engine `{ok}` |
| GET | `/api/jobs` | – | `{ok, jobs: JobRow[]}` (đọc DB trực tiếp + join novelTitle) |
| GET | `/api/logs` | – | proxy engine `{ok, logs}` |
| POST | `/api/engine/preview` | `{url}` | proxy engine |
| POST | `/api/engine/scrape` | `{url, autoTranslate?, chapterFrom?, chapterTo?}` | proxy engine |
| POST | `/api/engine/translate` | `{novelId, force?}` | proxy engine |
| POST | `/api/engine/retry` | `{novelId}` | proxy engine |
| POST | `/api/engine/jobs/[id]/[action]` | action ∈ cancel/pause/resume | proxy engine |
| GET | `/api/supabase/schema` | – | `{ok, sql}` (DDL — xem §8) |
| POST | `/api/supabase/test` \| `/sync` \| `/pull` | | proxy engine |
| GET | `/api/export` | – | `{ok, name, endpoints:[{method,path,desc}]}` tài liệu API |
| GET | `/api/export/novels` | – | `{ok, count, novels:[{id,title,author,sourceSite,totalChapters,scrapedCount,translatedCount,url}]}` |
| GET | `/api/export/novels/[id]?lang=vi|src|both&chapters=1-100` | – | `{ok, novel, chapters:[{idx,title,content?,translated?}]}` (mặc định both) |
| GET | `/api/export/novels/[id]/chapters/[idx]?lang=` | – | `{ok, chapter}` |
| GET | `/api/export/novels/[id]/txt?lang=vi|src` | – | file `.txt` (`Content-Disposition: attachment`), header gồm tên truyện/tác giả, mỗi chương `Chương {idx}: {title}` |

**Proxy helper** (viết trong `src/lib/engine-client.ts`): `engineFetch(path, init)` → fetch `http://localhost:3002${path}` với `cache:'no-store'`, timeout 30s (AbortController), trả JSON. Khi engine offline → `{ ok:false, error:'Engine không trực tuyến' }` status 503. Không throw ra ngoài.

## 6. Site adapters (engine) — SELECTORS ĐÃ VERIFY 20/10/2026

Fetch mọi request với headers giống browser: `User-Agent` (Chrome desktop), `Accept: text/html,application/xhtml+xml,...`, `Accept-Language: zh-CN,zh;q=0.9,vi;q=0.8,en;q=0.8`, `Referer` = trang book (với trang chương). Retry 3 lần (backoff 2s/5s/10s). Giải mã theo charset trong `Content-Type` hoặc `<meta charset>` (dùng **iconv-lite** cho gbk/gb18030/big5). HTML parse bằng **cheerio**.

Mỗi adapter: `detect(url)` → boolean; `fetchBook(url)` → `{ meta, chapters: [{title,url}] }` (thứ tự TĂNG DẦN theo chương); `fetchChapter(url)` → `{ title, content }` (content = các đoạn phân tách bằng `\n\n`, đã làm sạch quảng cáo/watermark).

### 6.1 69shuba (`69shuba.com`, `www.69shuba.com`, `69shuba.cx` → normalize `https://www.69shuba.com`) — **GBK**
- Book: `https://www.69shuba.com/book/{id}.htm` — meta từ og tags: `og:novel:book_name`, `og:novel:author`, `og:image`, `og:novel:status`, `og:description` (meta[property=...] hoặc meta[name=...]).
- Catalog đầy đủ: `https://www.69shuba.com/book/{id}/?p=1` — container `#catalog`, links `#catalog ul li a` (href tuyệt đối dạng `https://www.69shuba.com/txt/{bid}/{cid}`). **Thứ tự GIẢM dần → reverse**.
- Chương: `https://www.69shuba.com/txt/{bid}/{cid}` — container `div.txtnav`; title = `div.txtnav h1` (hoặc `h1.hide720`); loại bỏ `#txtright`, `script`, `.txtinfo` trước khi lấy text; `<br>` → `\n`.

### 6.2 xbiquge (`xbiquge.info`, `www.`) — UTF-8
- Book: `https://www.xbiquge.info/{a}/{b}/` — title `#info h1` (fallback og), author `#info p` (regex `作者[:：]?(.+)` hoặc p đầu), intro `#intro`, cover `#fmimg img[src]`.
- Danh sách chương: tất cả `a[href]` match regex `^/{a}/{b}/\d+\.html$` trong `#list`; **dedupe theo URL giữ vị trí xuất hiện CUỐI** (section "正文" nằm sau "最新章节"), kết quả tăng dần. Bỏ link text như 展开/收缩.
- Chương: `/{a}/{b}/{cid}.html` — title `h1`; content nằm trong `article` (hoặc `#content`, `.showtxt`) — text với `<br>` → `\n`. **Chương có phân trang**: marker `第(N/M)页`; page 2..M ở `/{a}/{b}/{cid}_{p}.html` — fetch hết rồi nối text (bỏ marker). 
- **BẮT BUỘC** gửi headers: `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: same-origin`, `Referer` = URL book. Nếu không, server trả 302 về trang book (đã verify). Nếu response không tìm thấy content → thử lại tối đa 3 lần.

### 6.3 novel543 (`novel543.com`, `www.` → `https://www.novel543.com`) — UTF-8
- Story: `https://www.novel543.com/{numeric}/` — title/author parse từ `<title>`: `《(.+?)》\s*\((.+?)\)`; fallback og meta.
- Catalog: `https://www.novel543.com/{numeric}/dir` — links `a[href^="/{numeric}/"]` match `/{numeric}/{section}_{chapter}.html`; **giảm dần → sort tăng dần theo số chapter** (đã verify: 149 link).
- Chương trang 1: `/{numeric}/{section}_{chapter}.html`; trang p≥2: `/{numeric}/{section}_{chapter}_{p}.html`. Title = `.chapter-content h1` (chứa `(p/N)`); content = `div.chapter-content div.content` — remove `.gadBlock`, `script`, `iframe`, `ins`. Nối các trang cho hết `(p/N)`.

### 6.4 hjwzw (`tw.hjwzw.com`, `hjwzw.com`, `www.` → `https://tw.hjwzw.com`) — UTF-8
- Book: `https://tw.hjwzw.com/Book/{id}` — meta og tags (giống 69shuba).
- Catalog đầy đủ: `https://tw.hjwzw.com/Book/Chapter/{id}` — links `a[href^="/Book/Read/{id},"]` (đã verify 120 chương, tăng dần).
- Chương: `https://tw.hjwzw.com/Book/Read/{id},{cid}` — **không có container id rõ ràng**: dùng generic text-density extractor (chọn element div/td có textContent dài nhất sau khi bỏ script/style/nav/header/footer). Title từ `<title>` (format `{novel}{chapter},{author} | 黃金屋中文`) hoặc breadcrumb.
- **Anti-scrape junk**: hjwzw chèn ký tự đơn lẻ từ tập `{古,齋,下,載,网,址}` rải rác trong text (vd `都付笑談中。古 ——`). Xoá các ký tự này khi đứng **đơn lẻ** (giữa dấu câu/khoảng trắng/dòng mới). Regex gợi ý: `/([\u3002\uFF01\uFF1F\u201D\u300B\n])[古齋下載网址]\s*/g → '$1'` và `/^\s*[古齋下載网址]\s+/gm → ''`.

### 6.5 truyenfull (`truyenfull.vn` → `.vision` → `.live`; normalize `https://truyenfull.live`) — UTF-8, **lang=vi**
- Novel: `https://truyenfull.live/{slug}/` — title từ og:title/`h3.title` (fallback: parse `<title>`); author: `a[href*="/tac-gia/"]`; description: `.col-info-desc` (hoặc `#intro`, `.desc-text`); status từ text `Full`/`Đang ra`.
- Danh sách chương: page 1 trong `ul.list-chapter a` (50 chương/trang); tổng số trang = `input#total-page` value; trang N: `https://truyenfull.live/{slug}/trang-{N}/` (đã verify). URL chương có thể có prefix `quyen-{v}-`.
- Chương: `/{slug}/chuong-{n}/` — title `<title>` (bỏ suffix ` - Truyenfull.vn`) hoặc `h4 a` / `h1`; content = `div#chapter-c` — remove `#ads-chapter-top`, `.ads*`, `script`, `div[id^=ads]`.

### 6.6 Generic fallback + làm sạch text (áp cho mọi site)
- Fallback extractor: nếu selector riêng không tìm thấy content → text-density (element có text dài nhất). Nếu list chương không parse được → gom tất cả `<a>` cùng regex pattern lặp lại ≥5 lần.
- Clean text: xoá dòng chứa watermark/ads: `/69书吧|69shuba|笔趣阁|xbiquge|新笔趣阁|novel543|543|hjwzw|黃金屋|黄金屋|truyenfull|TruyenFull|請記住|请记住|首发域名|最新章节|无弹窗|無彈窗|纯文字|純文字|天才一秒|一秒记住|手机阅读|手機閱讀|本章完|ads by|đọc truyện miễn phí tại/i`; decode entities (`&nbsp;`→space, `&emsp;`→space); collapse nhiều blank lines; trim từng đoạn.

## 7. Dịch bằng Gemini (engine)

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`; body: `{ contents:[{parts:[{text}]}], generationConfig:{ temperature:0.3, maxOutputTokens:8192 } }`. Model từ settings (`geminiModel`, mặc định `gemini-2.5-flash`).
- Keys: lấy từ bảng `api_keys` WHERE active=1 AND status != 'error'. Round-robin; khi gặp **429** → set status='rate_limited' + cooldown in-memory 60s rồi đổi key; hết key → chờ 30s thử lại (tối đa 5 vòng); **400/403** → status='error', error_count++. Thành công → usage_count++, last_used_at. Nếu không có key nào → job error với thông điệp rõ ràng tiếng Việt.
- Chunking: chia content thành chunk theo đoạn (`\n\n`) sao cho ≤ `chunkSize` (mặc định 1800 ký tự). Dịch tuần tự từng chunk, nối bằng `\n\n`. Retry mỗi chunk tối đa 3 lần.
- Prompt (nhúng vào text gửi Gemini):
```
Bạn là một dịch giả văn học chuyên nghiệp, chuyên dịch tiểu thuyết mạng sang tiếng Việt.

Nhiệm vụ: dịch đoạn văn sau từ {sourceLangLabel} sang tiếng Việt, giữ nguyên giọng điệu và phong cách kể chuyện.
Bối cảnh truyện: «{novel.title}» của tác giả {novel.author}.

Quy tắc:
1. Giữ nguyên cấu trúc đoạn: mỗi đoạn nhập liệu là một dòng trong đầu ra, các đoạn cách nhau bằng một dòng trống.
2. Dịch tự nhiên như tiểu thuyết Việt Nam xuất bản; tên riêng/danh xưng dùng dạng Hán-Việt nếu tự nhiên (ví dụ: Trương Tam Phong), giữ cách xưng hô nhất quán.
3. Giữ nguyên các dấu câu hội thoại theo chuẩn tiếng Việt (dấu gạch ngang “—” hoặc dấu ngoặc kép), không thêm chú thích.
4. CHỈ xuất bản dịch, tuyệt đối không giải thích, không ghi chú, không lặp lại văn bản gốc.
```
  (`sourceLangLabel`: 'tiếng Trung' cho zh/zh-TW, 'tiếng Việt' cho vi — khi nguồn đã là tiếng Việt và targetLang='vi' thì bỏ qua dịch, ghi log.)
- Parse response: `candidates[0].content.parts[].text` join. Nếu `finishReason === 'MAX_TOKENS'` → log warn.

## 8. Supabase (engine thực hiện sync qua PostgREST REST)

- Headers chuẩn: `apikey: {key}`, `Authorization: Bearer {key}`, `Content-Type: application/json`, `Prefer: resolution=merge-duplicates` (upsert).
- Push novel: `POST {url}/rest/v1/novels?on_conflict=source_url` body = [row snake_case]. Với chapters: `DELETE {url}/rest/v1/chapters?novel_id=eq.{id}` rồi `POST .../chapters` batch 500 row/call (cột: id, novel_id, idx, title, source_url, content, translated, status, scraped_at, translated_at). Push api_keys: upsert `on_conflict=id` (cột đầy đủ gồm key).
- Pull: `GET {url}/rest/v1/novels?select=*` (+ `&id=eq.` nếu 1 novel) → upsert local theo source_url (cập nhật counts); chapters `GET .../chapters?novel_id=eq.{id}&order=idx` → upsert local theo (novel_id, idx) chỉ khi local thiếu hoặc rỗng hơn.
- DDL (serve từ `/api/supabase/schema`):

```sql
create table if not exists public.novels (
  id text primary key, source_site text, source_url text unique, title text not null,
  author text, cover_url text, description text, lang text default 'zh', status text,
  total_chapters int default 0, scraped_count int default 0, translated_count int default 0,
  created_at bigint, updated_at bigint
);
create table if not exists public.chapters (
  id text primary key, novel_id text references public.novels(id) on delete cascade,
  idx int not null, title text, source_url text, content text, translated text,
  status text default 'pending', scraped_at bigint, translated_at bigint, unique(novel_id, idx)
);
create table if not exists public.api_keys (
  id text primary key, provider text default 'gemini', label text, key text,
  key_tail text, active boolean default true, usage_count int default 0,
  error_count int default 0, status text default 'ok', last_used_at bigint, created_at bigint
);
```
- Tự động sync: khi job scrape hoàn tất + settings.autoSyncSupabase && supabaseEnabled → engine tự push novel đó.

## 9. Job engine (engine)

- 2 worker pool: `scrape` (concurrency = settings.scrapeConcurrency, delay settings.scrapeDelayMs giữa các request cùng site) và `translate` (concurrency = settings.translateConcurrency, delay settings.translateDelayMs).
- Job scrape: fetch meta → upsert novel → sync chapters (thêm chương mới, giữ chương cũ) → đánh hàng đợi cào từng chương (theo chapterFrom/chapterTo nếu có) → mỗi chương: fetch + clean + save (status='scraped', scraped_at) → cập nhật scraped_count + progress + emit events → xong: nếu autoTranslate → tạo job translate; nếu autoSyncSupabase → sync. Chương lỗi → status='error' + error msg, job vẫn chạy tiếp. Trên 20 lỗi liên tiếp → pause job + log lỗi (nghi site chặn).
- Job translate: chọn chương có content AND (translated null OR force) → mỗi chương: status='translating' → chunk + dịch → save translated, status='translated', translated_at → cập nhật translated_count/progress → emit.
- Pause: status='paused', workers bỏ qua task của job; Resume: xếp lại task còn lại (tính lại từ DB). Cancel: status='cancelled'.
- **Khởi động engine**: chapters đang 'translating' → reset về 'scraped'; jobs 'running' → 'queued'; sau đó enqueue lại toàn bộ job queued/paused? (không — paused giữ nguyên paused). Ghi log "Engine online, resume N jobs".
- Log ring buffer 500 dòng + emit socket + console.log.

## 10. Quy tắc bắt buộc chung

1. Next.js 16 + TypeScript strict-ish; `'use client'` cho page/components frontend; không dùng Server Actions (chỉ API routes).
2. **Chỉ có 1 page user-facing: `/`** (src/app/page.tsx). Không tạo route page khác.
3. Frontend chỉ fetch relative `/api/...`; socket.io client: `io('/engine-io?XTransformPort=3002', {...})` — KHÔNG BAO GIỜ ghi port trực tiếp trong URL (kể cả WebSocket).
4. UI: Tailwind 4 + shadcn/ui có sẵn (src/components/ui/*) + lucide-react icons. **Cấm màu indigo/blue** làm màu chính — dùng emerald làm primary, amber/vẽ phụ. Responsive mobile-first. Footer sticky (root `min-h-screen flex flex-col`, footer `mt-auto`). List dài dùng `max-h-* overflow-y-auto` + custom scrollbar.
5. State frontend: React hooks thuần + socket (không cần zustand cho scope này). Toast bằng `sonner` (`import { toast } from 'sonner'`).
6. Engine service: project Bun độc lập (`mini-services/engine-service/package.json`, script `dev: bun --hot index.ts`), port 3002 hard-code. Deps: `socket.io`, `cheerio`, `iconv-lite`. Chạy `bun install` trong thư mục đó.
7. KHÔNG cài thêm package vào root project (`/home/z/my-project`) — mọi dep cần đã có. Nếu thiếu, ghi vào worklog.
8. Worklog: đọc/append `/home/z/my-project/worklog.md` theo template ( xem file).
9. Không viết test code. Chạy `bun run lint` (root) trước khi xong để chắc không lỗi syntax.
10. Dữ liệu cào chỉ nhằm mục đích cá nhân — thêm disclaimer bản quyền ở footer/settings.

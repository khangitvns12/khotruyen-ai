# KhoTruyện AI — Worklog

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Foundation — DB schema, shared types, contract doc, env setup

Work Log:
- Investigated 5 target sites live (69shuba, xbiquge.info, novel543.com, tw.hjwzw.com, truyenfull): verified URL patterns, encodings (69shuba=GBK), catalog endpoints, chapter content selectors, pagination schemes, anti-bot quirks (xbiquge needs Sec-Fetch headers else 302). truyenfull.vn now redirects to truyenfull.live (chapters paginated via /{slug}/trang-{N}/). hjwzw full TOC at /Book/Chapter/{id}, content needs text-density extraction + junk-char filter. novel543 TOC at /{numeric}/dir, chapters multi-page {section}_{chapter}_{page}.html.
- Rewrote prisma/schema.prisma: models Novel/Chapter/ApiKey/Setting/Job (snake_case tables, Int epoch-ms timestamps, String uuid ids). Ran `bun run db:push`. Enabled WAL on db/custom.db (verified journal_mode=wal).
- Created src/lib/types.ts (shared TS contract: AppSettings+DEFAULT_SETTINGS, NovelSummary, ChapterSummary/Full, JobRow, ApiKeyView, EngineStats, LogEntry, PreviewResult, SITES, ENGINE_PORT=3002).
- Wrote /home/z/my-project/CONTRACT.md — full architecture + API/socket contracts + verified site adapter specs + Gemini translation spec + Supabase sync spec.
- Root: `bun add socket.io-client` (v4.8.4). eslint.config.mjs ignores now include mini-services/**, download/**, tests/**.
- Confirmed dev server running on 3000 (Next.js 16.1.3, dev.log clean). Outbound internet to all 5 sites + generativelanguage.googleapis.com verified working.

Stage Summary:
- Foundation ready for 3 parallel agents: 2-a engine mini-service (port 3002), 2-b Next.js APIs, 2-c frontend UI.
- DB: /home/z/my-project/db/custom.db (WAL). Engine must use bun:sqlite + busy_timeout, Prisma app reads + writes settings/api_keys.
- All contracts in CONTRACT.md — agents MUST follow it exactly.

---
Task ID: 2-b
Agent: full-stack-developer (Next.js APIs)
Task: Build all /api/* routes (settings, keys, novels, jobs, engine proxies, supabase, export)
Work Log:
- Created src/lib/engine-client.ts: engineFetch (60s AbortController, no-store, JSON content-type, never throws → `{ok:false,error}` envelope), engineHealth (3s timeout), engineProxy (forwards method + JSON body, bodyless POST tolerated for job actions; status map: engine ok→200, engine error→502, offline→503 'Engine không trực tuyến', timeout→504, bad JSON→400 'JSON không hợp lệ').
- Created src/lib/api-helpers.ts: HttpError/errorResponse envelope helper, readJsonBody, settings load/mask/validate/merge (supabaseKey: undefined→keep, ''→clear, '•…'→keep, else save; ranges concurrency 1-8, delays 0-30000, chunkSize 500-8000), export helpers (parseExportLang, sanitizeFilename), raw-SQL data access (see note below).
- **CRITICAL FINDING (Prisma + SQLite)**: epoch-ms timestamps (1.79e12) exceed Prisma's Int32 validation → EVERY typed read/write of rows containing timestamps fails with "Conversion failed ... does not fit in an INT column" (also $queryRaw without CAST, and typed create() inserts the row but 500s on read-back). Solution WITHOUT touching prisma/** (per scope): all timestamp-touching queries go through $queryRaw/$executeRaw with `CAST(ts AS REAL)` (returns exact JS number — verified) and snake_case→camelCase aliases; typed Prisma kept ONLY where provably safe (settings table = TEXT only, count()/aggregate, selects excluding timestamp columns). Task 2-a engine (bun:sqlite, 64-bit safe) is unaffected. **If anyone later changes prisma/schema.prisma Int→BigInt, these raw queries keep working as-is.**
- 24 route files + replaced /api placeholder with an endpoint index. All routes have `export const dynamic='force-dynamic'` and Next.js 16 Promise-params signatures.
- Verified by curl (with seeded test rows, all removed afterwards, DB back to pristine): stats (counts + engineOnline:false fast), settings GET/PUT (mask '••••'+last4, masked-echo keep, clear, range 400s, bad JSON 400), keys GET/POST 201/PATCH/DELETE idempotent/404/400/non-AIza warning, novels list + ?q= (title/author, LIKE wildcard escaped via ESCAPE '\'), novel detail (raw SQL chapter summaries), chapter full (1-based idx, 400/404s), jobs (novelTitle join, params JSON safe-parse), export index/list/detail (?lang=vi|src|both, ?chapters=1-100 clamp, single N, 400s, 404), export chapter, export txt (Content-Type text/plain; charset=utf-8, Content-Disposition attachment + RFC5987 filename*, «title» header block, Chương {idx}: {title}, (chưa dịch) fallback marker), supabase schema DDL verbatim, ALL engine proxies degrade to 503 'Engine không trực tuyến' while engine offline (preview/scrape/translate/retry/jobs action/novels DELETE/logs/supabase test-sync-pull), action validation 400, scrape bad-JSON 400.
- `bun run lint` → clean (zero output). dev.log tail → no compile errors from my routes.
Stage Summary:
- All 26 endpoints of CONTRACT.md §5 implemented and verified; shapes match types.ts exactly ({ok,...} envelopes, masked supabaseKey, ApiKeyView never exposes full key).
- Engine-proxy offline degradation verified end-to-end (engine 2-a still building; integration with live engine pending — proxies relay engine envelopes verbatim with 200/502 so no changes needed when 2-a lands).
- Delegated to integration: socket.io live updates (frontend 2-c connects directly to engine), real scrape/translate flows once engine is online, keyTail format on engine-written key rows.

---
Task ID: 2-a
Agent: full-stack-developer + main (engine completion)
Task: Build mini-services/engine-service (job engine + 5 site adapters + Gemini + Supabase + socket.io, port 3002)

Work Log:
- Subagent built core modules (engine.ts with worker pools/resume/pause/cancel, 5 adapters, gemini.ts key rotation, supabase.ts PostgREST, db/logger/emitter/settings); main agent completed missing index.ts + src/router.ts.
- CRITICAL FIX: Bun native fetch TLS fingerprint triggers Cloudflare bot challenge on 69shuba (403 "Just a moment..."); rewrote src/http.ts to fetch via spawned curl (-w marker for status+finalUrl), keeping browser headers, retries, charset/iconv decoding.
- Fixed shuba69 adapter: missing htmlToText() before cleanNovelText (<br> tags leaked into chapter content).
- Fixed xbiquge adapter: index_99999.html template sentinel caused pagination loop to 502; now parses pager badge (1/9), ignores sentinels >500, breaks on first failed index page.
- Verified live: preview for all 5 sites OK (69shuba 1039ch/GBK, xbiquge 805ch, novel543 137ch, hjwzw 120ch, truyenfull 151ch) + real chapter scraping on all 5 (clean text 2.2k–14.4k chars).

Stage Summary:
- Engine running on :3002 (bun --hot), socket.io path /engine-io verified through Caddy gateway; jobs persist + auto-resume on restart.

---
Task ID: 2-c
Agent: full-stack-developer (frontend UI)
Task: Build Vietnamese UI — dashboard / add novel / library / detail / reader / jobs / settings + socket live updates

Work Log:
- Views: dashboard (6 stat cards, active jobs, live logs, quick-add), add-novel (URL + site chips + preview card + chapter range + auto-translate switch), novels grid (cover, site badge, dual progress bars, actions incl. export/supabase/delete), novel detail (chapter list + status filter + pagination), fullscreen reader (bản dịch/bản gốc tabs, font size, prev/next, chapter jump), jobs table with pause/resume/cancel, settings (Gemini keys CRUD + model select, translation/scrape tuning, Supabase config + SQL dialog, export API docs).
- Shell: sidebar (desktop) + Sheet nav (mobile), sticky footer with disclaimer, next-themes dark default, emerald palette, sonner toasts, framer-motion transitions.
- use-engine-socket hook: io('/', { path:'/engine-io', query:{ XTransformPort:'3002' } }) + 15s REST polling fallback; jobs/logs seeded from /api.

Stage Summary:
- Browser-verified: preview → scrape → progress → reader → settings key management all working; Vietnamese copy throughout.

---
Task ID: 3
Agent: main (Z.ai Code) + verification subagent
Task: Integration & end-to-end verification

Work Log:
- bun run lint clean; dev.log no compile errors.
- Socket.io verified through Caddy gateway (:81); direct :3000 access degrades gracefully (REST polling + reconnect banner).
- Golden path: truyenfull novel added via UI → preview card → scrape ch 1–3 (job 3/3 done) → reader reads ch 1/2/3 (prev/next + jump + "chưa dịch" fallback) → translate blocked without key (toast warning) → fake key added via Settings (masked ••••efgh).
- Gemini error path (fake key): 69shuba ch1 scraped (2210 chars clean) → translate job → engine really called Gemini API → HTTP 400 → key auto-disabled (status=error, errorCount=1) → job status=error 0/1 "Chưa có Gemini API key hoạt động — thêm key trong Cài đặt", chapter reverted to 'scraped', engine stayed healthy; /api/jobs relayed the error row. BUG FIXED during verification: engine.ts:637 called emitChapterRow() without `this.` in the GeminiNoKeysError branch → ReferenceError "Lỗi worker dịch" + missing final job socket event (REST polling masked it); trivial one-token fix, hot-reloaded (bun --hot), re-verified: same clean error path with no worker error. Also removed an orphaned duplicate engine process (leftover from restart, portless but sharing engine.log — latent double-processing risk on hot reload); real engine untouched.
- Export API: /api/export doc index OK; /api/export/novels (count + light list + detail URLs); detail ?chapters=1-2&lang=vi (novel meta + chapter stubs, translated omitted when none); chapter ?lang=src returns full content; txt → Content-Disposition: attachment + RFC5987 filename* (UTF-8 Vietnamese), header block «title»/Tác giả/Nguồn/Số chương + "Chương {idx}: {title}" + "(chưa dịch)" fallback. Supabase fake creds → {ok:false,error:"Unable to connect. Is the computer able to access the url?"} graceful (no crash); /api/supabase/schema serves DDL verbatim.
- Browser (agent-browser via :81 gateway): zero page errors, console clean (only HMR/React-dev info); all views verified — Kho truyện cards (both novels + actions), Hàng đợi rows (type/status/progress incl. 2 error rows w/ VN message), Tổng quan stats 2/1.190/4/0/0/0 exactly matching stats API, Cài đặt shows masked key "Key test ••••efgh" (status Lỗi) + all sections. Mobile 390×844: hamburger "Mở menu điều hướng" + Sheet nav OK, content readable. Theme toggle dark↔light works (bg→white, toggled back). Footer: short page (empty library) → footerBottom = exactly 900 (sticky, no gap); dashboard content ~1100px (log panel capped max-h 320px) → footer flush at content bottom below fold, no gap. Socket live updates PROVEN: server-side curl-triggered engine logs appeared in "Nhật ký trực tiếp" panel within ~1s. Screenshots: /tmp/mobile.png, /tmp/desktop.png, /tmp/light.png.
- Cleanup: all test novels + fake key deleted (+ 11 stale job-history rows cleared, they referenced deleted novels); stats back to zero (novels:0, chapters:0, keysTotal:0); services left running (:3000, :3002, gateway :81).

Stage Summary:
- App fully functional end-to-end: 5/5 sites scrape, reader/jobs/settings/exports verified; Gemini translation plumbing verified up to the real API call (fake key → HTTP 400 → auto-disabled + clear Vietnamese error; user's real key required for actual translation); Supabase sync implemented (graceful offline failure), needs user's real project. One trivial engine bug fixed (missing `this.`); system left pristine with both services running.

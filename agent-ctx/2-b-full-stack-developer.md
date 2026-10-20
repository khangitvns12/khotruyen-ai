# Task 2-b — full-stack-developer (Next.js APIs) — Work Record

> Scope delivered: `src/lib/engine-client.ts`, `src/lib/api-helpers.ts`, and ALL routes under `src/app/api/**` (placeholder `/api/route.ts` replaced with an endpoint index). No changes to page.tsx / layout.tsx / components / types.ts / prisma / root package.json. No test files written.

## Files created (26)

**Libs:**
- `src/lib/engine-client.ts` — `engineFetch(path, init?)` (60s AbortController, `cache:'no-store'`, JSON content-type, NEVER throws → `{ok:false,error}` envelope), `engineHealth()` (3s timeout, any HTTP response = reachable, honors `ok:false`), `engineProxy(req, path)` (forwards method + JSON body; bodyless POST tolerated for job cancel/pause/resume; status map: engine ok→200 payload verbatim, engine error→502 verbatim, offline→503 `Engine không trực tuyến`, timeout→504, malformed body→400 `JSON không hợp lệ`).
- `src/lib/api-helpers.ts` — `HttpError`/`errorResponse` (envelope + status), `readJsonBody` (400 on non-object/bad JSON), settings stack (`loadSettings` merged over DEFAULT_SETTINGS w/ safe JSON parse, `maskSettings` = `'••••'+last4`, `saveSettings` upsert, `applySettingsPatch` with validation: concurrency 1–8, delays 0–30000, chunkSize 500–8000, booleans, strings; supabaseKey semantics: absent→keep, `''`→clear, startsWith '•'→keep, else save), raw-SQL data access (`listNovelSummaries(q)`, `findNovelSummary`, `findChapterFull`, `listJobRows`, `listApiKeyViews`/`findApiKeyView`/`insertApiKey`/`updateApiKeyFields`/`deleteApiKeyRow`), export helpers (`parseExportLang`, `sanitizeFilename`).

**Routes** (all with `export const dynamic = 'force-dynamic'`, Next.js 16 `params: Promise<...>`):
- `api/route.ts` GET — endpoint index
- `api/stats` GET — 10 count() aggregates + engineOnline (Promise.race 3.5s guard)
- `api/settings` GET/PUT — masked settings, validated patch
- `api/keys` GET/POST(201) — POST validates ≥20 chars, non-`AIza` → `warning` field
- `api/keys/[id]` PATCH/DELETE — 404 unknown, DELETE idempotent
- `api/novels` GET `?q=` — LIKE filter w/ wildcard escaping (ESCAPE '\'), updated_at desc
- `api/novels/[id]` GET (raw-SQL chapter summaries) / DELETE (engine proxy)
- `api/novels/[id]/chapters/[idx]` GET — 1-based idx → ChapterFull
- `api/jobs` GET — 100 newest, novelTitle joined, params JSON safe-parsed
- `api/logs` GET — engine proxy `/logs?limit=300` (limit passthrough, clamp 1–1000)
- `api/engine/preview|scrape|translate|retry` POST — engine proxies
- `api/engine/jobs/[id]/[action]` POST — action ∈ cancel|pause|resume (else 400)
- `api/supabase/schema` GET — DDL from CONTRACT.md §8 verbatim
- `api/supabase/test|sync|pull` POST — engine proxies
- `api/export` GET — API doc (name 'KhoTruyện AI Export API' + 4 endpoints)
- `api/export/novels` GET — light list + `url`
- `api/export/novels/[id]` GET `?lang=vi|src|both&chapters=1-100` — clamped inclusive range, single `N` supported
- `api/export/novels/[id]/chapters/[idx]` GET `?lang=`
- `api/export/novels/[id]/txt` GET `?lang=vi|src` — text/plain; charset=utf-8, attachment + RFC5987 filename*, `«title»` header block, `Chương {idx}: {title}`, `(chưa dịch)` marker for untranslated chapters in vi mode

## CRITICAL integration note for other agents

**Prisma + SQLite + epoch-ms:** Prisma validates `Int` fields as Int32 — every typed read/write of rows containing epoch-ms timestamps fails: `Conversion failed: Value 1792467932721 does not fit in an INT column`. This affects typed `findMany/findUnique/create/update`, AND `$queryRaw` without CAST. (typed `create()` actually INSERTS the row, then 500s on read-back!)

**Workaround used (without touching `prisma/**`):** all timestamp-touching queries use `$queryRaw`/`$executeRaw` with `CAST(<ts> AS REAL) AS "<camelCase>"` (verified to return exact JS numbers — safe up to 2^53) + column aliases. Typed Prisma used ONLY where provably safe: `settings` table (TEXT only), `count()`/`aggregate`, and `select`s that exclude timestamp columns.

If the orchestrator later switches prisma schema timestamps `Int → BigInt`, these raw queries keep working unchanged. Task 2-a (engine, bun:sqlite) is unaffected either way.

## Verification (curl, engine OFFLINE throughout — Task 2-a still building)

- `GET /api/stats` → 200 `{ok,stats,engineOnline:false}` (responds fast, not blocked)
- `GET/PUT /api/settings` → 200; masking `••••9999`, masked-echo keeps stored, `''` clears; invalid ranges/types → 400 Vietnamese messages; bad JSON → 400 `JSON không hợp lệ`
- Keys: GET 200; POST valid → 201 (+`warning` for non-AIza); PATCH → 200 / 404 unknown / 400 invalid; DELETE → 200 idempotent
- Novels: list + `?q=` title/author (incl. Vietnamese), empty result for no match; detail 404; chapter full 400 (non-numeric/0 idx) / 404s
- Jobs: 200 with novelTitle + parsed params
- Export: index/list/detail (lang & chapters variants incl. clamping, 400s, 404)/single chapter/txt (headers + body format verified)
- Supabase: schema 200 (DDL verbatim); test/sync/pull → 503 offline
- Engine proxies ALL → 503 `{ok:false,error:'Engine không trực tuyến'}` (preview, scrape, translate, retry, jobs/{id}/{action}, novels DELETE, logs, supabase×3); invalid action → 400; garbage body → 400
- `bun run lint` → clean; dev.log → no compile errors from these files
- Test rows seeded for verification then fully removed (novels/chapters/jobs/api_keys/settings all back to 0)

## Pending for integration

- Live-engine round-trip once Task 2-a lands (proxies relay engine envelopes verbatim — no code change expected)
- Frontend (2-c) socket.io connection goes direct to engine (`/engine-io?XTransformPort=3002`), not through these routes

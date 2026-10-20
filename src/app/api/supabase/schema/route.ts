import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/** DDL for the Supabase side (CONTRACT.md §8) — served verbatim. */
const SQL = `create table if not exists public.novels (
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
`

/** GET /api/supabase/schema — the SQL users must run in their Supabase project. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, sql: SQL })
  } catch (e) {
    return errorResponse(e)
  }
}

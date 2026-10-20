"use client";

// ============================================================
// KhoTruyện AI — view chi tiết truyện + danh sách chương
// Lọc trạng thái + tìm kiếm + phân trang 100 chương/trang
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { api } from "@/lib/client";
import type { ChapterStatus, ChapterSummary, NovelSummary, EngineStats } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Cover } from "./cover";
import { NovelStatusBadge, SiteBadge, ChapterStatusIcon } from "./badges";
import { NovelActionRow } from "./novel-actions";
import { fmtNum, pct, usePolling } from "./utils";

const PER_PAGE = 100;

const FILTERS: { id: ChapterStatus | "all"; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "pending", label: "Chờ cào" },
  { id: "scraped", label: "Đã cào" },
  { id: "translating", label: "Đang dịch" },
  { id: "translated", label: "Đã dịch" },
  { id: "error", label: "Lỗi" },
];

interface NovelDetailViewProps {
  novelId: string;
  refreshKey: number;
  stats: EngineStats | null;
  onBack: () => void;
  onRead: (novel: NovelSummary, idx: number) => void;
}

function buildPages(current: number, total: number): (number | "left" | "right")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "left" | "right")[] = [1];
  if (current > 3) pages.push("left");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("right");
  pages.push(total);
  return pages;
}

export function NovelDetailView({ novelId, refreshKey, stats, onBack, onRead }: NovelDetailViewProps) {
  const [novel, setNovel] = useState<NovelSummary | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChapterStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const r = await api<{ novel?: NovelSummary; chapters?: ChapterSummary[] }>(
        `/api/novels/${novelId}`
      );
      if (r.novel && Array.isArray(r.chapters)) {
        setNovel(r.novel);
        setChapters(r.chapters);
        setError(null);
      } else {
        setError("Dữ liệu trả về không hợp lệ");
      }
    } catch (e) {
      // Truyện đã bị xoá → quay lại danh sách
      const msg = e instanceof Error ? e.message : "";
      if (/không tìm|not found|đã xoá/i.test(msg)) {
        onBack();
        return;
      }
      setError(msg || "Không tải được truyện");
    }
  }, [novelId, onBack]);

  useEffect(() => {
    // Trì hoãn 1 tick — tránh setState đồng bộ trong thân effect
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  usePolling(() => void load(), 15_000);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: chapters?.length ?? 0 };
    for (const c of chapters ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return counts;
  }, [chapters]);

  const filtered = useMemo(() => {
    let list = chapters ?? [];
    if (filter !== "all") list = list.filter((c) => c.status === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((c) => c.title.toLowerCase().includes(q));
    return list;
  }, [chapters, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const hasKeys = stats == null ? null : (stats.keysTotal ?? 0) > 0;

  // ---------------- Trạng thái tải ----------------

  if (error && !novel) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="h-9" onClick={onBack} aria-label="Quay lại kho truyện">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Kho truyện
        </Button>
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Không tải được truyện</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4 h-10" onClick={() => void load()}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (!novel || chapters === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-4 rounded-xl border p-4">
          <Skeleton className="aspect-[2/3] w-24 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ---------------- Nội dung ----------------

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="h-9 -ml-2" onClick={onBack} aria-label="Quay lại kho truyện">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Kho truyện
      </Button>

      {/* Header */}
      <section
        aria-label={`Thông tin truyện ${novel.title}`}
        className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row"
      >
        <div className="mx-auto aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-lg sm:mx-0 sm:w-32">
          <Cover src={novel.coverUrl} title={novel.title} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{novel.title}</h1>
            <SiteBadge site={novel.sourceSite} />
            <NovelStatusBadge status={novel.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {novel.author || "Không rõ tác giả"} · {fmtNum(novel.totalChapters)} chương
          </p>
          {novel.description && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {novel.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
            <span className="text-muted-foreground">
              Đã cào <span className="font-medium text-foreground">{fmtNum(novel.scrapedCount)}</span>/
              {fmtNum(novel.totalChapters)} ({pct(novel.scrapedCount, novel.totalChapters)}%)
            </span>
            <span className="text-muted-foreground">
              Đã dịch{" "}
              <span className="font-medium text-foreground">{fmtNum(novel.translatedCount)}</span>/
              {fmtNum(novel.scrapedCount)} ({pct(novel.translatedCount, novel.scrapedCount)}%)
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NovelActionRow
              novel={novel}
              onRead={() => onRead(novel, 1)}
              onChanged={() => void load()}
              hasKeys={hasKeys}
            />
            <Button variant="ghost" size="sm" className="h-9" asChild>
              <a
                href={novel.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Mở trang gốc của truyện"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Nguồn
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Danh sách chương */}
      <section aria-labelledby="chapters-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="chapters-heading" className="text-base font-semibold">
            Danh sách chương{" "}
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              ({fmtNum(filtered.length)})
            </span>
          </h2>
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm tiêu đề chương…"
              aria-label="Tìm chương theo tiêu đề"
              className="h-9 pl-9"
            />
          </div>
        </div>

        {/* Bộ lọc trạng thái */}
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Lọc chương theo trạng thái">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = statusCounts[f.id === "all" ? "all" : f.id] ?? 0;
            if (f.id !== "all" && count === 0) return null;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
                aria-pressed={active}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                {f.label}
                <span className="tabular-nums opacity-70">{fmtNum(count)}</span>
              </button>
            );
          })}
        </div>

        {/* Rows */}
        <div className="custom-scroll max-h-[60vh] overflow-y-auto rounded-xl border">
          {pageItems.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Không có chương nào khớp bộ lọc.
            </p>
          ) : (
            <ul className="divide-y">
              {pageItems.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onRead(novel, c.idx)}
                    disabled={!c.hasContent && !c.hasTranslated}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Mở chương ${c.idx}: ${c.title}`}
                  >
                    <span className="w-14 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
                      #{fmtNum(c.idx)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <ChapterStatusIcon status={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Phân trang */}
        {totalPages > 1 && (
          <Pagination className="mt-3">
            <PaginationContent>
              <PaginationItem>
                <PaginationLink
                  href="#"
                  aria-label="Trang trước"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage((p) => Math.max(1, Math.min(p, totalPages) - 1));
                  }}
                  className={cn(safePage <= 1 && "pointer-events-none opacity-40")}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  <span className="sr-only">Trang trước</span>
                </PaginationLink>
              </PaginationItem>
              {buildPages(safePage, totalPages).map((p, i) =>
                typeof p === "number" ? (
                  <PaginationItem key={i}>
                    <PaginationLink
                      href="#"
                      isActive={p === safePage}
                      onClick={(e) => {
                        e.preventDefault();
                        setPage(p);
                      }}
                      aria-label={`Trang ${p}`}
                    >
                      {fmtNum(p)}
                    </PaginationLink>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={i}>
                    <PaginationEllipsis />
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationLink
                  href="#"
                  aria-label="Trang sau"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage((p) => Math.min(totalPages, Math.min(p, totalPages) + 1));
                  }}
                  className={cn(safePage >= totalPages && "pointer-events-none opacity-40")}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                  <span className="sr-only">Trang sau</span>
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </section>
    </div>
  );
}

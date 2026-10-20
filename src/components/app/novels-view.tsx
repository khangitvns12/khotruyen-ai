"use client";

// ============================================================
// KhoTruyện AI — view Kho truyện (lưới thẻ + tìm kiếm)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenText, PlusCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client";
import type { EngineStats, NovelSummary } from "@/lib/types";
import { NovelCard } from "./novel-card";
import { useDebounced, usePolling } from "./utils";
import type { ViewName } from "./nav";

interface NovelsViewProps {
  /** dataVersion đã debounce ~600ms — đổi thì nạp lại */
  refreshKey: number;
  stats: EngineStats | null;
  onOpenNovel: (id: string) => void;
  onRead: (novel: NovelSummary) => void;
  onNavigate: (v: ViewName) => void;
}

const PAGE_SIZE = 24;

export function NovelsView({ refreshKey, stats, onOpenNovel, onRead, onNavigate }: NovelsViewProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [novels, setNovels] = useState<NovelSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = debouncedQuery.trim();
      const r = await api<{ novels?: NovelSummary[] }>(`/api/novels${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setNovels(Array.isArray(r.novels) ? r.novels : []);
    } catch {
      setNovels([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery]);

  // Nạp khi: query đổi / refreshKey đổi (socket event) / polling 15s
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  usePolling(() => void load(), 15_000);

  // Reset "hiển thị thêm" khi đổi tìm kiếm
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [debouncedQuery]);

  const hasKeys = stats == null ? null : (stats.keysTotal ?? 0) > 0;
  const list = useMemo(() => novels ?? [], [novels]);
  const shown = list.slice(0, visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kho truyện</h1>
          <p className="text-sm text-muted-foreground">
            {list.length > 0 ? `${list.length} truyện trong kho` : "Toàn bộ truyện đã cào"}
          </p>
        </div>
        <Button onClick={() => onNavigate("add")} className="h-10">
          <PlusCircle className="size-4" aria-hidden="true" />
          Thêm truyện
        </Button>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo tên truyện hoặc tác giả…"
          aria-label="Tìm kiếm truyện"
          className="h-10 pl-9"
        />
      </div>

      {loading && novels === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 rounded-xl border p-3">
              <Skeleton className="aspect-[2/3] w-20 shrink-0 rounded-lg sm:w-24" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-8 w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <BookOpenText className="size-12 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-4 text-base font-medium">
            {debouncedQuery ? "Không tìm thấy truyện nào" : "Chưa có truyện"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {debouncedQuery
              ? "Thử từ khoá khác hoặc xoá tìm kiếm."
              : "Thêm truyện đầu tiên để engine bắt đầu cào và dịch."}
          </p>
          {!debouncedQuery && (
            <Button className="mt-4 h-10" onClick={() => onNavigate("add")}>
              <PlusCircle className="size-4" aria-hidden="true" />
              Thêm truyện đầu tiên
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((n) => (
              <NovelCard
                key={n.id}
                novel={n}
                hasKeys={hasKeys}
                onOpen={() => onOpenNovel(n.id)}
                onRead={() => onRead(n)}
                onChanged={() => void load()}
              />
            ))}
          </div>
          {visible < list.length && (
            <div className="flex justify-center">
              <Button variant="outline" className="h-10" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Hiện thêm {Math.min(PAGE_SIZE, list.length - visible)} truyện
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

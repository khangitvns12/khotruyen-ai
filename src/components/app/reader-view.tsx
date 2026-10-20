"use client";

// ============================================================
// KhoTruyện AI — view đọc truyện toàn màn hình
// - Tabs Bản dịch / Bản gốc, cỡ chữ 14–24px (mặc định 18)
// - Chuyển chương: nút, bàn phím (←/→), nhảy nhanh theo số
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AArrowDown,
  AArrowUp,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { api } from "@/lib/client";
import type { ChapterFull, NovelSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtNum } from "./utils";

const SIZE_KEY = "khotruyen-reader-size";
const MIN_SIZE = 14;
const MAX_SIZE = 24;
const DEFAULT_SIZE = 18;

interface ReaderViewProps {
  novelId: string;
  initialIdx: number;
  novelTitle?: string;
  totalChapters?: number;
  onClose: () => void;
}

export function ReaderView({
  novelId,
  initialIdx,
  novelTitle,
  totalChapters,
  onClose,
}: ReaderViewProps) {
  const [idx, setIdx] = useState(Math.max(1, initialIdx));
  const [chapter, setChapter] = useState<ChapterFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"vi" | "src">("vi");
  const [meta, setMeta] = useState<{ title: string; total: number } | null>(
    novelTitle != null && totalChapters != null
      ? { title: novelTitle, total: totalChapters }
      : null
  );
  const [jump, setJump] = useState("");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  const title = meta?.title ?? "Truyện";
  const total = meta?.total ?? 0;

  // Cỡ chữ: khôi phục từ localStorage
  useEffect(() => {
    const v = window.localStorage.getItem(SIZE_KEY);
    const n = v ? Number(v) : NaN;
    if (Number.isFinite(n)) setSize(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
  }, []);

  const changeSize = (delta: number) => {
    setSize((s) => {
      const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, s + delta));
      window.localStorage.setItem(SIZE_KEY, String(next));
      return next;
    });
  };

  // Khoá cuộn trang dưới overlay
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Nạp meta truyện nếu chưa có
  useEffect(() => {
    if (meta) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ novel?: NovelSummary }>(`/api/novels/${novelId}`);
        if (!cancelled && r.novel) {
          setMeta({ title: r.novel.title, total: r.novel.totalChapters });
        }
      } catch {
        /* không có meta vẫn đọc được chương */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta, novelId]);

  // Nạp chương theo idx
  const loadChapter = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ chapter?: ChapterFull }>(`/api/novels/${novelId}/chapters/${idx}`);
      if (r.chapter) {
        setChapter(r.chapter);
      } else {
        setError("Không tìm thấy chương");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được chương");
    } finally {
      setLoading(false);
    }
  }, [novelId, idx]);

  useEffect(() => {
    void loadChapter();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [loadChapter]);

  const goto = (n: number) => {
    if (total > 0 && (n < 1 || n > total)) return;
    if (n < 1) return;
    setIdx(n);
    setJump("");
  };

  // Bàn phím ←/→ chuyển chương
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") goto(Math.max(1, idx - 1));
      if (e.key === "ArrowRight") goto(total > 0 ? Math.min(total, idx + 1) : idx + 1);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, total, onClose]);

  const atFirst = idx <= 1;
  const atLast = total > 0 && idx >= total;

  const useTranslated = lang === "vi";
  const body = chapter
    ? useTranslated
      ? (chapter.translated ?? chapter.content)
      : chapter.content
    : null;
  const showingOriginal = useTranslated && chapter != null && !chapter.translated;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`Đọc truyện ${title}`}
    >
      {/* Thanh trên */}
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon" className="size-10" onClick={onClose} aria-label="Đóng trình đọc">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chapter ? chapter.title : `Chương ${fmtNum(idx)}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            onClick={() => goto(idx - 1)}
            disabled={atFirst}
            aria-label="Chương trước"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            onClick={() => goto(idx + 1)}
            disabled={atLast}
            aria-label="Chương sau"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>

          <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            onClick={() => changeSize(-2)}
            disabled={size <= MIN_SIZE}
            aria-label="Giảm cỡ chữ"
            title={`Cỡ chữ ${size}px`}
          >
            <AArrowDown className="size-5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            onClick={() => changeSize(2)}
            disabled={size >= MAX_SIZE}
            aria-label="Tăng cỡ chữ"
            title={`Cỡ chữ ${size}px`}
          >
            <AArrowUp className="size-5" aria-hidden="true" />
          </Button>

          <Tabs value={lang} onValueChange={(v) => setLang(v as "vi" | "src")}>
            <TabsList className="h-10">
              <TabsTrigger value="vi" className="px-3">Bản dịch</TabsTrigger>
              <TabsTrigger value="src" className="px-3">Bản gốc</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Nội dung */}
      <div ref={scrollRef} className="custom-scroll flex-1 overflow-y-auto">
        {loading ? (
          <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
            <Skeleton className="h-8 w-2/3" />
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-5", i % 4 === 3 && "w-2/3")} />
            ))}
          </div>
        ) : error ? (
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <BookOpen className="mx-auto size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="mt-3 font-medium">Không tải được chương</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-4 h-10" onClick={() => void loadChapter()}>
              Thử lại
            </Button>
          </div>
        ) : body ? (
          <article className="mx-auto max-w-2xl px-4 py-8">
            <h1 className="font-serif text-2xl font-bold leading-snug">{chapter?.title}</h1>
            {showingOriginal && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Minus className="size-3" aria-hidden="true" />
                (chưa dịch — hiển thị bản gốc)
              </p>
            )}
            <div
              className="mt-6 whitespace-pre-wrap font-serif leading-8 text-pretty"
              style={{ fontSize: `${size}px` }}
            >
              {body}
            </div>
          </article>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <BookOpen className="mx-auto size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="mt-3 font-medium">Chưa có nội dung</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Chương {fmtNum(idx)} chưa được cào về. Quay lại sau hoặc dùng «Thử lại lỗi chương».
            </p>
          </div>
        )}
      </div>

      {/* Thanh dưới */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 sm:px-4">
        <Button
          variant="outline"
          className="h-10"
          onClick={() => goto(idx - 1)}
          disabled={atFirst}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Chương trước
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {total > 0 ? `Chương ${fmtNum(idx)}/${fmtNum(total)}` : `Chương ${fmtNum(idx)}`}
          </span>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(jump.trim());
              if (jump.trim() === "") return;
              if (Number.isFinite(n) && n >= 1 && (total === 0 || n <= total)) {
                goto(Math.floor(n));
              } else {
                toast.error(
                  total > 0 ? `Nhập số chương từ 1 đến ${fmtNum(total)}` : "Số chương không hợp lệ"
                );
              }
            }}
          >
            <Input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Số chương"
              aria-label="Nhập số chương để nhảy tới"
              className="h-9 w-24 sm:w-28"
            />
            <Button type="submit" variant="secondary" className="h-9" aria-label="Nhảy tới chương">
              Đi
            </Button>
          </form>
        </div>

        <Button
          variant="outline"
          className="h-10"
          onClick={() => goto(idx + 1)}
          disabled={atLast}
        >
          Chương sau
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </footer>

      {loading && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-16 text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
    </motion.div>
  );
}

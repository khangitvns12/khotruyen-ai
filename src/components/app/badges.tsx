"use client";

// ============================================================
// KhoTruyện AI — các badge trạng thái dùng chung
// ============================================================

import { CheckCircle2, Clock, FileText, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChapterStatus, JobStatus, JobType } from "@/lib/types";

// ---------- Site badge: mỗi nguồn một màu cố định ----------

const SITE_STYLES: Record<string, string> = {
  "69shuba": "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  xbiquge: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  novel543: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  hjwzw: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  truyenfull: "border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

const SITE_LABELS: Record<string, string> = {
  "69shuba": "69书吧",
  xbiquge: "新笔趣阁",
  novel543: "小說543",
  hjwzw: "黃金屋",
  truyenfull: "TruyenFull",
};

export function SiteBadge({ site, className }: { site: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn(SITE_STYLES[site] ?? "", className)}>
      {SITE_LABELS[site] ?? site}
    </Badge>
  );
}

// ---------- Trạng thái job ----------

const JOB_STATUS: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: "Đang chờ", className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  running: { label: "Đang chạy", className: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  paused: { label: "Tạm dừng", className: "border-orange-500/40 text-orange-600 dark:text-orange-400" },
  done: { label: "Hoàn tất", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  error: { label: "Lỗi", className: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400" },
  cancelled: { label: "Đã huỷ", className: "border-zinc-500/40 text-zinc-500 dark:text-zinc-400" },
};

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = JOB_STATUS[status] ?? JOB_STATUS.queued;
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  );
}

// ---------- Loại job ----------

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  scrape: "Cào truyện",
  translate: "Dịch",
  retry: "Thử lại",
};

// ---------- Trạng thái truyện (tiếng Trung → Việt) ----------

const NOVEL_STATUS_MAP: Record<string, string> = {
  完结: "Hoàn thành",
  完本: "Hoàn thành",
  已完结: "Hoàn thành",
  连载中: "Đang ra",
  连载: "Đang ra",
  Full: "Hoàn thành",
  full: "Hoàn thành",
  "Đang ra": "Đang ra",
  "Hoàn thành": "Hoàn thành",
};

export function novelStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return NOVEL_STATUS_MAP[status] ?? status;
}

export function NovelStatusBadge({ status }: { status: string | null }) {
  const label = novelStatusLabel(status);
  if (!label) return null;
  const done = label === "Hoàn thành";
  return (
    <Badge
      variant="outline"
      className={
        done
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }
    >
      {label}
    </Badge>
  );
}

// ---------- Trạng thái chương ----------

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  pending: "Chờ cào",
  scraped: "Đã cào",
  translating: "Đang dịch",
  translated: "Đã dịch",
  error: "Lỗi",
};

export function ChapterStatusIcon({ status }: { status: ChapterStatus }) {
  switch (status) {
    case "pending":
      return <Clock className="size-4 shrink-0 text-zinc-500" aria-label="Chờ cào" />;
    case "scraped":
      return <FileText className="size-4 shrink-0 text-amber-500" aria-label="Đã cào" />;
    case "translating":
      return <Loader2 className="size-4 shrink-0 animate-spin text-emerald-500" aria-label="Đang dịch" />;
    case "translated":
      return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-label="Đã dịch" />;
    case "error":
      return <XCircle className="size-4 shrink-0 text-red-500" aria-label="Lỗi" />;
  }
}

// ---------- API key status ----------

export function KeyStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Bình thường
        </Badge>
      );
    case "rate_limited":
      return (
        <Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Giới hạn
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400">
          Lỗi
        </Badge>
      );
  }
}

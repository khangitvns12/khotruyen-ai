"use client";

// ============================================================
// KhoTruyện AI — view Tổng quan (dashboard)
// ============================================================

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Download,
  KeyRound,
  Languages,
  Library,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { post } from "@/lib/client";
import type { EngineStats, JobRow, LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JOB_TYPE_LABELS, JobStatusBadge } from "./badges";
import { JobActionButtons } from "./job-actions";
import { LogPanel } from "./log-panel";
import { fmtNum, pct, useSettings } from "./utils";
import type { ViewName } from "./nav";

interface DashboardViewProps {
  connected: boolean;
  stats: EngineStats | null;
  jobs: Map<string, JobRow>;
  logs: LogEntry[];
  onNavigate: (v: ViewName) => void;
}

// ---------- Thẻ thống kê ----------

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  accent?: string;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            accent ?? "bg-primary/10 text-primary"
          )}
        >
          <Icon className="size-4.5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-bold tabular-nums leading-tight">
            {value === null ? "—" : fmtNum(value)}
          </p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Một job đang chạy ----------

function ActiveJobRow({ job }: { job: JobRow }) {
  const percent = pct(job.progress, job.total);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            job.type === "scrape"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : job.type === "translate"
                ? "bg-primary/10 text-primary"
                : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
          )}
        >
          {job.type === "scrape" ? (
            <Download className="size-4" aria-hidden="true" />
          ) : job.type === "translate" ? (
            <Languages className="size-4" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              {job.novelTitle || JOB_TYPE_LABELS[job.type]}
            </p>
            <span className="text-xs text-muted-foreground">• {JOB_TYPE_LABELS[job.type]}</span>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress
              value={percent}
              className="h-1.5 flex-1 [&_[data-slot=progress-indicator]]:bg-amber-500"
            />
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {percent}% ({fmtNum(job.progress)}/{fmtNum(job.total)})
            </span>
          </div>
        </div>
      </div>
      <JobActionButtons job={job} />
    </div>
  );
}

// ---------- View ----------

export function DashboardView({ connected, stats, jobs, logs, onNavigate }: DashboardViewProps) {
  const { settings } = useSettings();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const activeJobs = useMemo(
    () =>
      Array.from(jobs.values())
        .filter((j) => j.status === "running" || j.status === "queued" || j.status === "paused")
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  );

  const noKeys = stats != null && (stats.keysTotal ?? 0) === 0;

  const quickAdd = async () => {
    const u = url.trim();
    if (!u) {
      toast.error("Nhập đường dẫn truyện trước đã");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/engine/scrape", {
        url: u,
        autoTranslate: settings.autoTranslate,
      });
      toast.success("Đã thêm job cào — engine sẽ chạy nền, theo dõi ở Kho truyện");
      setUrl("");
      onNavigate("novels");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không tạo được job cào");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tổng quan</h1>
          <p className="text-sm text-muted-foreground">
            Cào &amp; dịch truyện tự động bằng Gemini — engine chạy nền phía server.
          </p>
        </div>
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
            connected
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-500"
          )}
          role="status"
        >
          <span
            aria-hidden="true"
            className={cn("status-dot inline-block size-2 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")}
          />
          {connected ? "Engine trực tuyến" : "Engine ngoại tuyến"}
          {stats && (
            <span className="text-muted-foreground">
              · đang chạy {fmtNum(stats.runningJobs)} · chờ {fmtNum(stats.queuedJobs)}
            </span>
          )}
        </div>
      </div>

      {noKeys && (
        <Alert className="rounded-xl border-amber-500/40 bg-amber-500/10">
          <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <AlertTitle className="text-amber-700 dark:text-amber-400">
            Chưa có Gemini API key
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-amber-700/90 dark:text-amber-400/90">
            <span>Thêm key trong Cài đặt để dịch truyện tự động.</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => onNavigate("settings")}>
              Mở Cài đặt
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 6 thẻ thống kê */}
      <section aria-label="Thống kê" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Library} label="Truyện" value={stats?.novels ?? null} />
        <StatCard icon={BookOpen} label="Tổng chương" value={stats?.chapters ?? null} />
        <StatCard
          icon={Download}
          label="Đã cào"
          value={stats?.scraped ?? null}
          accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
        <StatCard icon={Languages} label="Đã dịch" value={stats?.translated ?? null} />
        <StatCard icon={KeyRound} label="API key hoạt động" value={stats?.keysActive ?? null} />
        <StatCard icon={ListChecks} label="Job đang chạy" value={stats?.runningJobs ?? null} />
      </section>

      {/* Thêm nhanh */}
      <Card className="rounded-xl">
        <CardContent className="p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Cào nhanh
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void quickAdd();
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Dán URL truyện (69shuba, xbiquge, novel543, hjwzw, truyenfull…)"
              aria-label="Đường dẫn truyện cần cào"
              className="h-10 flex-1"
              inputMode="url"
            />
            <Button type="submit" className="h-10" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              Cào ngay
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            {settings.autoTranslate
              ? "Đang bật tự động dịch sau khi cào xong (đổi trong Cài đặt)."
              : "Tự động dịch đang tắt — bật trong Cài đặt nếu muốn dịch luôn."}
          </p>
        </CardContent>
      </Card>

      {/* Truyện đang chạy */}
      <section aria-labelledby="active-jobs-heading">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="active-jobs-heading" className="text-base font-semibold">
            Truyện đang chạy
          </h2>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onNavigate("jobs")}>
            Xem hàng đợi
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {activeJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Hiện không có job nào đang chạy — thêm truyện để engine bắt đầu cào.
          </div>
        ) : (
          <div className="space-y-2">
            {activeJobs.map((j) => (
              <ActiveJobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>

      {/* Nhật ký trực tiếp */}
      <section aria-labelledby="logs-heading">
        <h2 id="logs-heading" className="mb-2 text-base font-semibold">
          Nhật ký trực tiếp
        </h2>
        <LogPanel logs={logs} maxHeightClass="max-h-80" />
      </section>
    </div>
  );
}

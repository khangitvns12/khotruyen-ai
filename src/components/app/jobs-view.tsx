"use client";

// ============================================================
// KhoTruyện AI — view Hàng đợi (jobs)
// Bảng ở md+, danh sách thẻ ở mobile + panel log đầy đủ
// ============================================================

import { useMemo, useState } from "react";
import {
  Download,
  Languages,
  ListChecks,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { JobRow, JobType, LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JOB_TYPE_LABELS, JobStatusBadge } from "./badges";
import { JobActionButtons } from "./job-actions";
import { LogPanel } from "./log-panel";
import { fmtNum, pct, timeAgo } from "./utils";

interface JobsViewProps {
  jobs: Map<string, JobRow>;
  logs: LogEntry[];
  connected: boolean;
  onClearLogs: () => void;
  onConnect: () => void;
}

function JobTypeIcon({ type, className }: { type: JobType; className?: string }) {
  if (type === "scrape")
    return <Download className={cn("size-4 text-amber-500", className)} aria-hidden="true" />;
  if (type === "translate")
    return <Languages className={cn("size-4 text-primary", className)} aria-hidden="true" />;
  return <RefreshCw className={cn("size-4 text-zinc-500", className)} aria-hidden="true" />;
}

function JobProgress({ job }: { job: JobRow }) {
  return (
    <div className="flex items-center gap-2">
      <Progress
        value={pct(job.progress, job.total)}
        className="h-1.5 min-w-24 flex-1 [&_[data-slot=progress-indicator]]:bg-amber-500"
        aria-label={`Tiến độ ${pct(job.progress, job.total)}%`}
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {fmtNum(job.progress)}/{fmtNum(job.total)}
      </span>
    </div>
  );
}

export function JobsView({ jobs, logs, connected, onClearLogs, onConnect }: JobsViewProps) {
  const [autoScroll, setAutoScroll] = useState(true);

  const list = useMemo(
    () => Array.from(jobs.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [jobs]
  );

  const activeCount = list.filter(
    (j) => j.status === "running" || j.status === "queued" || j.status === "paused"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hàng đợi</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} job đang chạy/chờ · ${list.length} job gần đây`
              : `${list.length} job gần đây — không có job nào đang chạy`}
          </p>
        </div>
        {!connected && (
          <Button variant="outline" className="h-9" onClick={onConnect}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Engine ngoại tuyến — thử lại
          </Button>
        )}
      </div>

      {/* Bảng desktop */}
      <section aria-label="Danh sách job" className="hidden md:block">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-14 text-center">
            <ListChecks className="size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="mt-3 font-medium">Chưa có job nào</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Thêm truyện để engine bắt đầu cào — job sẽ hiện ở đây.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-32">Loại</TableHead>
                  <TableHead>Truyện</TableHead>
                  <TableHead className="w-28">Trạng thái</TableHead>
                  <TableHead className="w-56">Tiến độ</TableHead>
                  <TableHead className="w-32">Cập nhật</TableHead>
                  <TableHead className="w-28 text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <JobTypeIcon type={j.type} />
                        <span className="text-sm">{JOB_TYPE_LABELS[j.type]}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-sm font-medium">{j.novelTitle || "—"}</p>
                      {j.error && (
                        <p className="truncate text-xs text-red-500" title={j.error}>
                          {j.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <JobStatusBadge status={j.status} />
                    </TableCell>
                    <TableCell>
                      <JobProgress job={j} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <time dateTime={new Date(j.updatedAt).toISOString()}>{timeAgo(j.updatedAt)}</time>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <JobActionButtons job={j} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Danh sách mobile */}
      <section aria-label="Danh sách job" className="space-y-2 md:hidden">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-14 text-center">
            <ListChecks className="size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="mt-3 font-medium">Chưa có job nào</p>
            <p className="mt-1 text-sm text-muted-foreground">Thêm truyện để engine bắt đầu cào.</p>
          </div>
        ) : (
          list.map((j) => (
            <Card key={j.id} className="rounded-xl py-1">
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <JobTypeIcon type={j.type} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{j.novelTitle || JOB_TYPE_LABELS[j.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {JOB_TYPE_LABELS[j.type]} · {timeAgo(j.updatedAt)}
                    </p>
                  </div>
                </div>
                <JobStatusBadge status={j.status} />
                <div className="w-full">
                  <JobProgress job={j} />
                  {j.error && (
                    <p className="mt-1 truncate text-xs text-red-500" title={j.error}>
                      {j.error}
                    </p>
                  )}
                </div>
                <div className="w-full">
                  <JobActionButtons job={j} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {/* Log đầy đủ */}
      <section aria-labelledby="jobs-logs-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="jobs-logs-heading" className="text-base font-semibold">
            Nhật ký engine
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="log-auto-scroll"
                checked={autoScroll}
                onCheckedChange={setAutoScroll}
                aria-label="Tự động cuộn nhật ký"
              />
              <Label htmlFor="log-auto-scroll" className="text-xs text-muted-foreground">
                Tự động cuộn
              </Label>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={onClearLogs}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              Xoá
            </Button>
          </div>
        </div>
        <LogPanel logs={logs} maxHeightClass="max-h-96" autoScroll={autoScroll} />
      </section>
    </div>
  );
}

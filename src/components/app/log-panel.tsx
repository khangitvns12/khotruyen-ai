"use client";

// ============================================================
// KhoTruyện AI — panel nhật ký trực tiếp
// - max-h + overflow-y-auto + custom-scroll
// - màu theo level: info=zinc, success=emerald, warn=amber, error=red
// - tự cuộn xuống dưới trừ khi người dùng đang cuộn lên trên
// ============================================================

import { useEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/types";
import { fmtTime } from "./utils";

const LEVEL_CLASS: Record<string, string> = {
  info: "text-zinc-600 dark:text-zinc-400",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

export function logLevelClass(level: string): string {
  return LEVEL_CLASS[level] ?? LEVEL_CLASS.info;
}

interface LogPanelProps {
  logs: LogEntry[];
  className?: string;
  /** class kiểm soát chiều cao, vd "max-h-80" */
  maxHeightClass?: string;
  /** mặc định true — tự cuộn xuống dưới; tắt qua Switch ở JobsView */
  autoScroll?: boolean;
}

export function LogPanel({
  logs,
  className,
  maxHeightClass = "max-h-80",
  autoScroll = true,
}: LogPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Tự cuộn xuống dòng mới nhất trừ khi người dùng đã cuộn lên hoặc đã tắt tự cuộn
  useEffect(() => {
    const el = ref.current;
    if (el && autoScroll && stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, autoScroll]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-label="Nhật ký engine"
      className={cn(
        "custom-scroll overflow-y-auto rounded-lg border bg-zinc-950/40 dark:bg-black/30 p-3 font-mono text-xs leading-5",
        maxHeightClass,
        className
      )}
    >
      {logs.length === 0 ? (
        <p className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
          <ScrollText className="size-4" aria-hidden="true" />
          Chưa có nhật ký…
        </p>
      ) : (
        logs.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="flex gap-2 break-words">
            <span className="shrink-0 tabular-nums text-muted-foreground/70">{fmtTime(l.ts)}</span>
            <span className={cn("min-w-0 flex-1", logLevelClass(l.level))}>{l.msg}</span>
          </div>
        ))
      )}
    </div>
  );
}

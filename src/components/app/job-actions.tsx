"use client";

// ============================================================
// KhoTruyện AI — nút hành động job (pause / resume / cancel)
// POST /api/engine/jobs/{id}/{action}
// ============================================================

import { useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import type { JobRow } from "@/lib/types";

interface JobActionButtonsProps {
  job: JobRow;
  size?: "sm" | "default";
  onChanged?: () => void;
}

/** Pause/Resume/Cancel theo trạng thái job, có loading + toast. */
export function JobActionButtons({ job, size = "sm", onChanged }: JobActionButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: "pause" | "resume" | "cancel") => {
    setBusy(action);
    try {
      await api(`/api/engine/jobs/${job.id}/${action}`, { method: "POST" });
      const msg =
        action === "pause" ? "Đã tạm dừng job" : action === "resume" ? "Đã tiếp tục job" : "Đã huỷ job";
      toast.success(msg);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(null);
    }
  };

  const cancellable = job.status === "running" || job.status === "queued" || job.status === "paused";
  if (!cancellable) return null;

  const touch = size === "sm" ? "size-8" : "size-9";

  return (
    <div className="flex items-center gap-1">
      {job.status === "running" && (
        <Button
          variant="ghost"
          size="icon"
          className={touch}
          disabled={busy !== null}
          onClick={() => void run("pause")}
          aria-label="Tạm dừng job"
          title="Tạm dừng"
        >
          <Pause className="size-4" aria-hidden="true" />
        </Button>
      )}
      {job.status === "paused" && (
        <Button
          variant="ghost"
          size="icon"
          className={touch}
          disabled={busy !== null}
          onClick={() => void run("resume")}
          aria-label="Tiếp tục job"
          title="Tiếp tục"
        >
          <Play className="size-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={touch}
        disabled={busy !== null}
        onClick={() => void run("cancel")}
        aria-label="Huỷ job"
        title="Huỷ"
      >
        {busy === "cancel" ? (
          <Pause className="size-4 animate-pulse" aria-hidden="true" />
        ) : (
          <X className="size-4 text-red-500" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

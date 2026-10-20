"use client";

// ============================================================
// KhoTruyện AI — hàng nút hành động cho 1 truyện (Đọc / Dịch / menu)
// Dùng chung ở thẻ truyện + trang chi tiết truyện
// ============================================================

import { useState } from "react";
import {
  BookOpen,
  CloudUpload,
  Copy,
  FileJson,
  FileText,
  Languages,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, post } from "@/lib/client";
import type { NovelSummary } from "@/lib/types";

interface NovelActionRowProps {
  novel: NovelSummary;
  onRead: () => void;
  /** gọi sau khi xoá / retry để view nạp lại dữ liệu */
  onChanged?: () => void;
  /** null = chưa biết; false = chắc chắn không có key nào */
  hasKeys?: boolean | null;
}

export function NovelActionRow({ novel, onRead, onChanged, hasKeys }: NovelActionRowProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const translate = async () => {
    if (hasKeys === false) {
      toast.warning("Chưa có Gemini API key — thêm trong Cài đặt để dịch truyện");
      return;
    }
    setBusy("translate");
    try {
      await post("/api/engine/translate", { novelId: novel.id });
      toast.success(`Đã thêm job dịch cho «${novel.title}»`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không tạo được job dịch");
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy("retry");
    try {
      await post("/api/engine/retry", { novelId: novel.id });
      toast.success("Đã xếp job cào lại các chương lỗi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thao tác thất bại");
    } finally {
      setBusy(null);
    }
  };

  const syncSupabase = async () => {
    setBusy("sync");
    try {
      const r = await post<{ novels?: number; chapters?: number }>("/api/supabase/sync", {
        novelId: novel.id,
      });
      toast.success(
        `Đồng bộ xong — ${r.novels ?? 0} truyện, ${r.chapters ?? 0} chương lên Supabase`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Đồng bộ Supabase thất bại");
    } finally {
      setBusy(null);
    }
  };

  const copyApiLink = async () => {
    const link = `${window.location.origin}/api/export/novels/${novel.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Đã copy liên kết API của truyện");
    } catch {
      toast.error("Trình duyệt chặn clipboard — copy thủ công: " + link);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    try {
      await api(`/api/novels/${novel.id}`, { method: "DELETE" });
      toast.success(`Đã xoá «${novel.title}»`);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xoá truyện thất bại");
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" className="h-9" onClick={onRead} aria-label={`Đọc truyện ${novel.title}`}>
          <BookOpen className="size-4" aria-hidden="true" />
          Đọc
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => void translate()}
          disabled={busy !== null}
          aria-label={`Dịch truyện ${novel.title} sang tiếng Việt`}
        >
          {busy === "translate" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Languages className="size-4" aria-hidden="true" />
          )}
          Dịch
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label="Menu hành động khác của truyện"
              disabled={busy !== null}
            >
              {busy && busy !== "translate" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <MoreVertical className="size-4" aria-hidden="true" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => void retry()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Thử lại lỗi chương
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => window.open(`/api/export/novels/${novel.id}`, "_blank", "noopener")}
            >
              <FileJson className="size-4" aria-hidden="true" />
              Xuất JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                window.open(`/api/export/novels/${novel.id}/txt?lang=vi`, "_blank", "noopener")
              }
            >
              <FileText className="size-4" aria-hidden="true" />
              Xuất TXT
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void copyApiLink()}>
              <Copy className="size-4" aria-hidden="true" />
              Copy API link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void syncSupabase()}>
              <CloudUpload className="size-4" aria-hidden="true" />
              Đồng bộ Supabase
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Xoá truyện
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá truyện này?</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá «{novel.title}» cùng toàn bộ chương đã cào và bản dịch? Hành động này không thể
              hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ bỏ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void doDelete()}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Xoá vĩnh viễn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

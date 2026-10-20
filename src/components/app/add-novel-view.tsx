"use client";

// ============================================================
// KhoTruyện AI — view Thêm truyện (URL + xem trước + bắt đầu cào)
// ============================================================

import { useState } from "react";
import { Download, Eye, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { post } from "@/lib/client";
import { SITES, type PreviewResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Cover } from "./cover";
import { NovelStatusBadge, SiteBadge } from "./badges";
import { fmtNum, useSettings } from "./utils";
import type { ViewName } from "./nav";

const EXAMPLE_URLS: Record<string, string> = {
  "69shuba": "https://www.69shuba.com/book/24430.htm",
  xbiquge: "https://www.xbiquge.info/1/1062/",
  novel543: "https://www.novel543.com/0101707940/",
  hjwzw: "https://tw.hjwzw.com/Book/1889",
  truyenfull: "https://truyenfull.live/coi-doi-sang-to-dai-co-nuong/",
};

const LANG_LABELS: Record<string, string> = {
  zh: "Giản thể",
  "zh-TW": "Phồn thể",
  vi: "Tiếng Việt",
};

interface AddNovelViewProps {
  onNavigate: (v: ViewName) => void;
}

export function AddNovelView({ onNavigate }: AddNovelViewProps) {
  const { settings } = useSettings();
  const [url, setUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [autoTranslate, setAutoTranslate] = useState<boolean | null>(null); // null = theo settings
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [starting, setStarting] = useState(false);

  const effectiveAuto = autoTranslate ?? settings.autoTranslate;

  const doPreview = async () => {
    const u = url.trim();
    if (!u) {
      toast.error("Nhập đường dẫn truyện trước đã");
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await post<{ preview?: PreviewResult }>("/api/engine/preview", { url: u });
      if (r.preview) {
        setPreview(r.preview);
        toast.success(`Tìm thấy «${r.preview.title}» — ${fmtNum(r.preview.chapterCount)} chương`);
      } else {
        toast.error("Không đọc được thông tin truyện từ trang này");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xem trước thất bại");
    } finally {
      setPreviewing(false);
    }
  };

  const startScrape = async () => {
    if (!preview) return;
    const fromN = from.trim() === "" ? null : Number(from);
    const toN = to.trim() === "" ? null : Number(to);
    if ((fromN != null && (!Number.isFinite(fromN) || fromN < 1)) || (toN != null && (!Number.isFinite(toN) || toN < 1))) {
      toast.error("Phạm vi chương phải là số ≥ 1");
      return;
    }
    if (fromN != null && toN != null && toN < fromN) {
      toast.error("Chương kết thúc phải ≥ chương bắt đầu");
      return;
    }
    setStarting(true);
    try {
      const body: Record<string, unknown> = {
        url: preview.url || url.trim(),
        autoTranslate: effectiveAuto,
      };
      // Chỉ gửi khi đủ cả hai đầu
      if (fromN != null && toN != null) {
        body.chapterFrom = fromN;
        body.chapterTo = toN;
      }
      await post("/api/engine/scrape", body);
      toast.success("Đã thêm job cào — engine chạy nền, theo dõi ở Kho truyện");
      onNavigate("novels");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không tạo được job cào");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Thêm truyện</h1>
        <p className="text-sm text-muted-foreground">
          Dán link truyện từ 1 trong 5 nguồn được hỗ trợ, xem trước rồi bấm bắt đầu.
        </p>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-base">Nguồn truyện</CardTitle>
          <CardDescription>Chọn nhanh một nguồn để điền link mẫu vào ô bên dưới.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Site chips */}
          <div className="flex flex-wrap gap-2">
            {SITES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setUrl(EXAMPLE_URLS[s.id] ?? "");
                  setPreview(null);
                }}
                title={EXAMPLE_URLS[s.id]}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {LANG_LABELS[s.lang] ?? s.lang}
                </span>
              </button>
            ))}
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="novel-url">Đường dẫn truyện</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="novel-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreview(null);
                }}
                placeholder="https://www.69shuba.com/book/24430.htm"
                inputMode="url"
                className="h-10 flex-1"
              />
              <Button
                variant="secondary"
                className="h-10"
                onClick={() => void doPreview()}
                disabled={previewing || url.trim() === ""}
              >
                {previewing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
                Xem trước
              </Button>
            </div>
          </div>

          {/* Preview */}
          {previewing && (
            <div className="flex gap-3 rounded-xl border p-3">
              <Skeleton className="aspect-[2/3] w-24 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          )}

          {preview && !previewing && (
            <div className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row">
              <div className="mx-auto aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg sm:mx-0">
                <Cover src={preview.cover} title={preview.title} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold">{preview.title}</p>
                  <SiteBadge site={preview.site} />
                  <NovelStatusBadge status={preview.status} />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {preview.author || "Không rõ tác giả"} ·{" "}
                  <span className="tabular-nums">{fmtNum(preview.chapterCount)} chương</span> ·{" "}
                  {LANG_LABELS[preview.lang] ?? preview.lang}
                </p>
                {preview.description && (
                  <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                    {preview.description}
                  </p>
                )}
                {preview.sample.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      10 chương đầu tiên
                    </p>
                    <ul className="custom-scroll max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-sm">
                      {preview.sample.slice(0, 10).map((c, i) => (
                        <li key={i} className="truncate">
                          <span className="mr-1.5 tabular-nums text-muted-foreground">
                            {fmtNum(i + 1)}.
                          </span>
                          {c.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <Separator />

          {/* Tuỳ chọn */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="auto-translate" className="text-sm">
                  Tự động dịch sau khi cào
                </Label>
                <p className="text-xs text-muted-foreground">
                  Khi cào xong, engine tự tạo job dịch bằng Gemini.
                </p>
              </div>
              <Switch
                id="auto-translate"
                checked={effectiveAuto}
                onCheckedChange={(v) => setAutoTranslate(v)}
                aria-label="Tự động dịch sau khi cào"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
              <div className="space-y-1.5">
                <Label htmlFor="chapter-from" className="text-sm">
                  Từ chương
                </Label>
                <Input
                  id="chapter-from"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="1"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chapter-to" className="text-sm">
                  Đến chương
                </Label>
                <Input
                  id="chapter-to"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder={preview ? fmtNum(preview.chapterCount) : "…"}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Để trống cả hai ô để cào toàn bộ. Điền đủ cả hai nếu muốn giới hạn phạm vi.
            </p>
          </div>

          <Button
            size="lg"
            className="h-11 w-full sm:w-auto"
            disabled={!preview || starting}
            onClick={() => void startScrape()}
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : preview ? (
              <Sparkles className="size-4" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            {starting ? "Đang thêm job…" : "Bắt đầu cào"}
          </Button>
          {!preview && !previewing && (
            <p className="text-xs text-muted-foreground">
              Bấm «Xem trước» để lấy thông tin truyện trước khi cào.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

// ============================================================
// KhoTruyện AI — view Cài đặt
// a) Gemini API keys  b) Dịch thuật  c) Cào dữ liệu
// d) Supabase  e) API xuất dữ liệu  f) Về hệ thống
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CloudDownload,
  CloudUpload,
  Copy,
  Database,
  ExternalLink,
  Info,
  KeyRound,
  Languages,
  Loader2,
  Plug,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, del, patch, post, put } from "@/lib/client";
import type { ApiKeyView, AppSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { KeyStatusBadge } from "./badges";
import { fmtNum, timeAgo, useSettings } from "./utils";

// ---------------- Nút lưu có phản hồi Check ----------------

function SaveButton({ onSave, label = "Lưu" }: { onSave: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <Button
      className="h-10"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onSave();
          toast.success("Đã lưu cài đặt");
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Lưu thất bại");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : done ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Save className="size-4" aria-hidden="true" />
      )}
      {done ? "Đã lưu" : label}
    </Button>
  );
}

// ---------------- Ô số có khoảng hợp lệ ----------------

function NumField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onCommit,
  step = 1,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  // Đồng bộ khi prop đổi (mẫu "adjust state during render" của React)
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === "") return;
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
        }}
        className="h-10"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------- Copy button dùng chung ----------------

function CopyButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={ariaLabel}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
          toast.success("Đã copy");
        } catch {
          toast.error("Trình duyệt chặn clipboard");
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}

// ============================================================

export function SettingsView() {
  const { settings, loaded, update } = useSettings();
  const [form, setForm] = useState<AppSettings>(settings);

  useEffect(() => {
    if (loaded) setForm(settings);
  }, [loaded, settings]);

  // ---------- Keys ----------
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [keyBusy, setKeyBusy] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const r = await api<{ keys?: ApiKeyView[] }>("/api/keys");
      setKeys(Array.isArray(r.keys) ? r.keys : []);
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const save = async (partial: Partial<AppSettings>) => {
    const r = await put<{ settings?: Partial<AppSettings> }>("/api/settings", partial);
    const merged: AppSettings = { ...form, ...(r.settings ?? partial) };
    setForm(merged);
    update(merged);
  };

  const addKey = async () => {
    const k = newKey.trim();
    if (!k) {
      toast.error("Nhập API key trước đã");
      return;
    }
    setAdding(true);
    try {
      await post("/api/keys", { key: k, label: newLabel.trim() || undefined });
      toast.success("Đã thêm API key");
      setNewKey("");
      setNewLabel("");
      await loadKeys();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Thêm key thất bại");
    } finally {
      setAdding(false);
    }
  };

  const toggleKey = async (key: ApiKeyView, active: boolean) => {
    setKeyBusy(key.id);
    try {
      await patch(`/api/keys/${key.id}`, { active });
      setKeys((prev) =>
        (prev ?? []).map((k) => (k.id === key.id ? { ...k, active } : k))
      );
      toast.success(active ? "Đã bật key" : "Đã tắt key");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cập nhật thất bại");
    } finally {
      setKeyBusy(null);
    }
  };

  const removeKey = async (key: ApiKeyView) => {
    setKeyBusy(key.id);
    try {
      await del(`/api/keys/${key.id}`);
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== key.id));
      toast.success("Đã xoá key");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xoá key thất bại");
    } finally {
      setKeyBusy(null);
    }
  };

  // ---------- Supabase ----------
  const [sbKeyInput, setSbKeyInput] = useState("");
  const [sbBusy, setSbBusy] = useState<string | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlText, setSqlText] = useState<string | null>(null);

  const testSupabase = async () => {
    setSbBusy("test");
    try {
      const body: Record<string, unknown> = { url: form.supabaseUrl };
      const k = sbKeyInput.trim();
      if (k) body.key = k;
      await post("/api/supabase/test", body);
      toast.success("Kết nối Supabase thành công");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kết nối thất bại");
    } finally {
      setSbBusy(null);
    }
  };

  const syncAll = async () => {
    setSbBusy("sync");
    try {
      const r = await post<{ novels?: number; chapters?: number }>("/api/supabase/sync", {});
      toast.success(`Đã đẩy ${fmtNum(r.novels ?? 0)} truyện và ${fmtNum(r.chapters ?? 0)} chương lên Supabase`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Đồng bộ thất bại");
    } finally {
      setSbBusy(null);
    }
  };

  const pullAll = async () => {
    setSbBusy("pull");
    try {
      const r = await post<{ novels?: number; chapters?: number }>("/api/supabase/pull", {});
      toast.success(`Đã kéo về ${fmtNum(r.novels ?? 0)} truyện và ${fmtNum(r.chapters ?? 0)} chương`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kéo dữ liệu thất bại");
    } finally {
      setSbBusy(null);
    }
  };

  const saveSupabase = async () => {
    const partial: Partial<AppSettings> = {
      supabaseUrl: form.supabaseUrl,
      supabaseEnabled: form.supabaseEnabled,
      autoSyncSupabase: form.autoSyncSupabase,
    };
    if (sbKeyInput.trim()) partial.supabaseKey = sbKeyInput.trim();
    await save(partial);
    setSbKeyInput("");
  };

  const toggleSb = async (field: "supabaseEnabled" | "autoSyncSupabase", v: boolean) => {
    setForm((f) => ({ ...f, [field]: v }));
    try {
      await save({ [field]: v });
    } catch (e) {
      setForm((f) => ({ ...f, [field]: !v }));
      toast.error(e instanceof Error ? e.message : "Lưu thất bại");
    }
  };

  const openSql = async () => {
    setSqlOpen(true);
    if (sqlText === null) {
      try {
        const r = await api<{ sql?: string }>("/api/supabase/schema");
        setSqlText(r.sql ?? "--Không tải được SQL");
      } catch (e) {
        setSqlText(`-- Lỗi: ${e instanceof Error ? e.message : "không tải được"}`);
      }
    }
  };

  // ============================================================

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Cấu hình API key, dịch thuật, cào dữ liệu và đồng bộ Supabase.
        </p>
      </div>

      {/* a) Gemini API keys */}
      <Card id="keys" className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" aria-hidden="true" />
            Gemini API Keys
          </CardTitle>
          <CardDescription>
            Key được xoay vòng tự động; key gặp giới hạn (429) sẽ nguội 60 giây. Lấy key miễn phí
            tại{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              Google AI Studio
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Model */}
          <div className="space-y-1.5">
            <Label className="text-sm">Mô hình dịch</Label>
            <Select
              value={form.geminiModel}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, geminiModel: v }));
                void save({ geminiModel: v }).catch(() => undefined);
                toast.success(`Đã đổi mô hình sang ${v}`);
              }}
            >
              <SelectTrigger className="h-10 w-full sm:w-72" aria-label="Chọn mô hình Gemini">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-2.5-flash">gemini-2.5-flash — mặc định, nhanh</SelectItem>
                <SelectItem value="gemini-2.5-flash-lite">gemini-2.5-flash-lite — siêu nhanh</SelectItem>
                <SelectItem value="gemini-2.0-flash">gemini-2.0-flash — thế hệ trước</SelectItem>
                <SelectItem value="gemini-2.5-pro">gemini-2.5-pro — chất lượng, chậm</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Bảng keys */}
          {keys === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Chưa có API key nào — thêm key đầu tiên ở dưới để bắt đầu dịch.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Key</TableHead>
                    <TableHead className="hidden sm:table-cell">Trạng thái</TableHead>
                    <TableHead className="hidden md:table-cell">Sử dụng</TableHead>
                    <TableHead className="hidden md:table-cell">Lỗi</TableHead>
                    <TableHead className="hidden lg:table-cell">Dùng lúc</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id} className={cn(!k.active && "opacity-50")}>
                      <TableCell>
                        <p className="text-sm font-medium">{k.label || "(không tên)"}</p>
                        <p className="font-mono text-xs text-muted-foreground">••••{k.keyTail ?? "????"}</p>
                        <div className="mt-1 sm:hidden">
                          <KeyStatusBadge status={k.status} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <KeyStatusBadge status={k.status} />
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums md:table-cell">
                        {fmtNum(k.usageCount)}
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums md:table-cell">
                        {fmtNum(k.errorCount)}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {timeAgo(k.lastUsedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Switch
                            checked={k.active}
                            disabled={keyBusy === k.id}
                            onCheckedChange={(v) => void toggleKey(k, v)}
                            aria-label={k.active ? `Tắt key ${k.label}` : `Bật key ${k.label}`}
                          />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={keyBusy === k.id}
                                aria-label={`Xoá key ${k.label}`}
                              >
                                <Trash2 className="size-3.5 text-red-500" aria-hidden="true" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Xoá API key này?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Key «{k.label || "••••" + (k.keyTail ?? "")}» sẽ bị xoá vĩnh viễn.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Huỷ bỏ</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  onClick={() => void removeKey(k)}
                                >
                                  Xoá
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Thêm key */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="AIza…"
              aria-label="API key mới"
              className="h-10 flex-1"
              autoComplete="off"
            />
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Tên gợi nhớ (vd: key chính)"
              aria-label="Tên key"
              className="h-10 sm:w-56"
            />
            <Button className="h-10" onClick={() => void addKey()} disabled={adding}>
              {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              Thêm key
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* b) Dịch thuật */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="size-4 text-primary" aria-hidden="true" />
            Dịch thuật
          </CardTitle>
          <CardDescription>Ngôn ngữ và tốc độ đẩy job dịch Gemini.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Ngôn ngữ đích</Label>
              <Select
                value={form.targetLang}
                onValueChange={(v) => setForm((f) => ({ ...f, targetLang: v }))}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Ngôn ngữ đích">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vi">Tiếng Việt (mặc định)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">Tiếng Trung</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Ngôn ngữ nguồn</Label>
              <Select
                value={form.sourceLang}
                onValueChange={(v) => setForm((f) => ({ ...f, sourceLang: v }))}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Ngôn ngữ nguồn">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Tự động nhận diện</SelectItem>
                  <SelectItem value="zh">Tiếng Trung (giản thể)</SelectItem>
                  <SelectItem value="zh-TW">Tiếng Trung (phồn thể)</SelectItem>
                  <SelectItem value="vi">Tiếng Việt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <NumField
              id="translate-concurrency"
              label="Số chương dịch song song"
              hint="1 – 5 (cẩn thận giới hạn rate)"
              value={form.translateConcurrency}
              min={1}
              max={5}
              onCommit={(n) => setForm((f) => ({ ...f, translateConcurrency: n }))}
            />
            <NumField
              id="translate-delay"
              label="Nghỉ giữa mỗi lần dịch (ms)"
              hint="0 – 10.000ms"
              value={form.translateDelayMs}
              min={0}
              max={10000}
              step={100}
              onCommit={(n) => setForm((f) => ({ ...f, translateDelayMs: n }))}
            />
            <NumField
              id="chunk-size"
              label="Kích thước chunk (ký tự)"
              hint="500 – 4000 ký tự mỗi lần gửi"
              value={form.chunkSize}
              min={500}
              max={4000}
              step={100}
              onCommit={(n) => setForm((f) => ({ ...f, chunkSize: n }))}
            />
          </div>

          <div>
            <SaveButton
              onSave={() =>
                save({
                  targetLang: form.targetLang,
                  sourceLang: form.sourceLang,
                  translateConcurrency: form.translateConcurrency,
                  translateDelayMs: form.translateDelayMs,
                  chunkSize: form.chunkSize,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* c) Cào dữ liệu */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="size-4 text-primary" aria-hidden="true" />
            Cào dữ liệu
          </CardTitle>
          <CardDescription>Tốc độ cào và hành động sau khi cào xong.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField
              id="scrape-concurrency"
              label="Số request cào song song"
              hint="1 – 8 (nhiều quá dễ bị nguồn chặn)"
              value={form.scrapeConcurrency}
              min={1}
              max={8}
              onCommit={(n) => setForm((f) => ({ ...f, scrapeConcurrency: n }))}
            />
            <NumField
              id="scrape-delay"
              label="Nghỉ giữa mỗi request (ms)"
              hint="200 – 5.000ms"
              value={form.scrapeDelayMs}
              min={200}
              max={5000}
              step={100}
              onCommit={(n) => setForm((f) => ({ ...f, scrapeDelayMs: n }))}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-translate-setting" className="text-sm">
                Tự động dịch sau khi cào xong
              </Label>
              <p className="text-xs text-muted-foreground">
                Job dịch sẽ được tạo ngay khi job cào hoàn tất.
              </p>
            </div>
            <Switch
              id="auto-translate-setting"
              checked={form.autoTranslate}
              onCheckedChange={(v) => setForm((f) => ({ ...f, autoTranslate: v }))}
              aria-label="Tự động dịch sau khi cào xong"
            />
          </div>

          <div>
            <SaveButton
              onSave={() =>
                save({
                  scrapeConcurrency: form.scrapeConcurrency,
                  scrapeDelayMs: form.scrapeDelayMs,
                  autoTranslate: form.autoTranslate,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* d) Supabase */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudUpload className="size-4 text-primary" aria-hidden="true" />
            Supabase
          </CardTitle>
          <CardDescription>
            Đồng bộ kho truyện lên Supabase qua PostgREST — backup và đọc từ app khác.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supabase-url" className="text-sm">
                Project URL
              </Label>
              <Input
                id="supabase-url"
                value={form.supabaseUrl}
                onChange={(e) => setForm((f) => ({ ...f, supabaseUrl: e.target.value }))}
                placeholder="https://xxxx.supabase.co"
                inputMode="url"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supabase-key" className="text-sm">
                Service role key
              </Label>
              <Input
                id="supabase-key"
                type="password"
                value={sbKeyInput}
                onChange={(e) => setSbKeyInput(e.target.value)}
                placeholder={
                  form.supabaseKey ? `đã lưu (${form.supabaseKey}) — nhập mới để đổi` : "eyJhbGciOi…"
                }
                aria-label="Supabase service role key"
                className="h-10"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={() => void testSupabase()}
              disabled={sbBusy !== null || !form.supabaseUrl}
            >
              {sbBusy === "test" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plug className="size-4" aria-hidden="true" />
              )}
              Kiểm tra kết nối
            </Button>
            <SaveButton onSave={saveSupabase} />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="supabase-enabled" className="text-sm">
                  Bật đồng bộ Supabase
                </Label>
                <p className="text-xs text-muted-foreground">Cho phép đẩy/kéo dữ liệu.</p>
              </div>
              <Switch
                id="supabase-enabled"
                checked={form.supabaseEnabled}
                onCheckedChange={(v) => void toggleSb("supabaseEnabled", v)}
                aria-label="Bật đồng bộ Supabase"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="auto-sync" className="text-sm">
                  Tự động sync sau khi cào xong
                </Label>
                <p className="text-xs text-muted-foreground">
                  Mỗi truyện cào xong sẽ được đẩy lên Supabase ngay.
                </p>
              </div>
              <Switch
                id="auto-sync"
                checked={form.autoSyncSupabase}
                onCheckedChange={(v) => void toggleSb("autoSyncSupabase", v)}
                aria-label="Tự động đồng bộ sau khi cào xong"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-10"
              onClick={() => void syncAll()}
              disabled={sbBusy !== null || !form.supabaseEnabled}
            >
              {sbBusy === "sync" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="size-4" aria-hidden="true" />
              )}
              Đồng bộ tất cả lên Supabase
            </Button>
            <Button
              variant="secondary"
              className="h-10"
              onClick={() => void pullAll()}
              disabled={sbBusy !== null || !form.supabaseEnabled}
            >
              {sbBusy === "pull" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload className="size-4" aria-hidden="true" />
              )}
              Kéo dữ liệu về máy
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => void openSql()}
              aria-label="Xem SQL khởi tạo bảng Supabase"
            >
              <ScrollText className="size-4" aria-hidden="true" />
              Xem SQL khởi tạo
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Chạy SQL khởi tạo trong SQL Editor của Supabase trước khi bật đồng bộ.
          </p>

          <Dialog open={sqlOpen} onOpenChange={setSqlOpen}>
            <DialogContent className="max-h-[80vh] sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>SQL khởi tạo bảng Supabase</DialogTitle>
                <DialogDescription>
                  Dán vào SQL Editor của project Supabase rồi chạy một lần.
                </DialogDescription>
              </DialogHeader>
              <div className="relative">
                <div className="absolute right-2 top-2">
                  {sqlText && <CopyButton text={sqlText} ariaLabel="Copy SQL" />}
                </div>
                <pre className="custom-scroll max-h-[55vh] overflow-auto rounded-lg border bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-200 dark:bg-black/40">
                  {sqlText ?? "Đang tải…"}
                </pre>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* e) API xuất dữ liệu */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ExternalLink className="size-4 text-primary" aria-hidden="true" />
            API xuất dữ liệu
          </CardTitle>
          <CardDescription>
            Các endpoint REST để app khác đọc dữ liệu kho truyện.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            {
              method: "GET",
              path: "/api/export/novels",
              desc: "Danh sách tất cả truyện (tóm tắt, số chương, tiến độ).",
            },
            {
              method: "GET",
              path: "/api/export/novels/{id}?lang=vi|src|both",
              desc: "Toàn bộ truyện kèm nội dung chương theo ngôn ngữ.",
            },
            {
              method: "GET",
              path: "/api/export/novels/{id}/chapters/{idx}?lang=vi|src|both",
              desc: "Một chương theo số thứ tự.",
            },
            {
              method: "GET",
              path: "/api/export/novels/{id}/txt?lang=vi|src",
              desc: "Tải toàn bộ truyện dạng file .txt.",
            },
          ].map((ep) => (
            <div
              key={ep.path}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <Badge variant="secondary" className="shrink-0 font-mono">
                {ep.method}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{ep.path}</p>
                <p className="truncate text-xs text-muted-foreground">{ep.desc}</p>
              </div>
              <CopyButton text={ep.path} ariaLabel={`Copy endpoint ${ep.path}`} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* f) Về hệ thống */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="size-4 text-primary" aria-hidden="true" />
            Về hệ thống
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Engine chạy nền phía server.</span>{" "}
            Việc cào và dịch thực hiện bởi một dịch vụ chạy liên tục trên máy chủ — bạn đóng tab,
            tắt máy vẫn cào tiếp. Mở lại tab sẽ thấy tiến độ mới nhất qua kết nối socket thời gian
            thực.
          </p>
          <p>
            <span className="font-medium text-foreground">Dịch bằng Gemini.</span> Nội dung được
            chia nhỏ theo đoạn, dịch tuần tự với API key bạn cung cấp, xoay vòng khi gặp giới hạn
            tốc độ.
          </p>
          <Separator />
          <p className="text-xs">
            Dữ liệu cào chỉ nhằm mục đích đọc cá nhân. Vui lòng tôn trọng bản quyền của tác giả và
            nguồn truyện gốc; không sử dụng dữ liệu cho mục đích thương mại.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

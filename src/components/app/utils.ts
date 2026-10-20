"use client";

// ============================================================
// KhoTruyện AI — tiện ích dùng chung cho app components
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { api } from "@/lib/client";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/types";

const numberFmt = new Intl.NumberFormat("vi-VN");

/** Định dạng số theo locale vi-VN (1.039). */
export function fmtNum(n: number | null | undefined): string {
  return numberFmt.format(n ?? 0);
}

/** Giờ:phút:giây từ epoch ms. */
export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "--:--:--";
  try {
    return format(new Date(ts), "HH:mm:ss");
  } catch {
    return "--:--:--";
  }
}

/** Ngày giờ đầy đủ dd/MM/yyyy HH:mm. */
export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  try {
    return format(new Date(ts), "dd/MM/yyyy HH:mm");
  } catch {
    return "—";
  }
}

/** "5 phút trước" — locale Việt. */
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  try {
    return formatDistanceToNow(new Date(ts), { locale: vi, addSuffix: true });
  } catch {
    return "—";
  }
}

/** Phần trăm an toàn (0–100). */
export function pct(done: number | null | undefined, total: number | null | undefined): number {
  const d = done ?? 0;
  const t = total ?? 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.round((d / t) * 100));
}

/** Debounce một giá trị. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Polling an toàn — callback luôn mới, không chồng chéo khi callback async. */
export function usePolling(fn: () => void | Promise<void>, ms = 15_000) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let busy = false;
    const t = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await ref.current();
      } finally {
        busy = false;
      }
    }, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

// ------------------------------------------------------------
// Settings cache (dùng chung giữa các view, chỉ 1 tab nên an toàn)
// ------------------------------------------------------------

let settingsCache: AppSettings | null = null;

export interface SettingsHook {
  settings: AppSettings;
  loaded: boolean;
  update: (s: AppSettings) => void;
  refresh: () => Promise<void>;
}

export function useSettings(): SettingsHook {
  const [state, setState] = useState<AppSettings | null>(settingsCache);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ settings?: Partial<AppSettings> }>("/api/settings");
      if (r.settings) {
        settingsCache = { ...DEFAULT_SETTINGS, ...r.settings };
        setState(settingsCache);
      }
    } catch {
      /* API chưa sẵn sàng — dùng DEFAULT_SETTINGS */
    }
  }, []);

  useEffect(() => {
    if (settingsCache) return;
    // Trì hoãn 1 tick — gọi fetch ngoài thân effect để tránh setState đồng bộ trong effect
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const update = useCallback((s: AppSettings) => {
    settingsCache = s;
    setState(s);
  }, []);

  return { settings: state ?? DEFAULT_SETTINGS, loaded: state != null, update, refresh };
}

"use client";

// ============================================================
// KhoTruyện AI — socket.io hook kết nối engine
//
// Hai chế độ kết nối:
//  1. Remote (Vercel): NEXT_PUBLIC_ENGINE_URL được set (vd
//     https://khotruyen-engine.up.railway.app) → kết nối trực tiếp
//     cross-origin tới engine (CORS '*'), KHÔNG dùng XTransformPort.
//  2. Sandbox (mặc định, KHÔNG đổi hành vi): io('/', { path:
//     '/engine-io', query: { XTransformPort: 3002 } }) qua Caddy —
//     KHÔNG ghi port trực tiếp trong URL (xem chú thích trong effect).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { EngineStats, JobRow, LogEntry } from "@/lib/types";
import { api } from "@/lib/client";

const MAX_LOGS = 300;
const STATS_POLL_MS = 15_000;

/** URL công khai của engine cho chế độ remote (VD: https://khotruyen-engine.up.railway.app). */
const ENGINE_PUBLIC_URL = process.env.NEXT_PUBLIC_ENGINE_URL;

export interface EngineSocketState {
  /** Socket đang kết nối tới engine hay không */
  connected: boolean;
  /** Thống kê engine (từ socket 'stats' hoặc /api/stats fallback) */
  stats: EngineStats | null;
  /** Map jobId → JobRow (cập nhật realtime + seed từ /api/jobs) */
  jobs: Map<string, JobRow>;
  /** 300 dòng log cuối (realtime + seed từ /api/logs) */
  logs: LogEntry[];
  /** Tăng mỗi khi có event 'novel'/'chapter' → view refetch (debounce phía view) */
  dataVersion: number;
  /** Thử kết nối lại + nạp lại dữ liệu nền */
  connect: () => void;
  /** Xoá log đang hiển thị phía client */
  clearLogs: () => void;
}

export function useEngineSocket(): EngineSocketState {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [jobs, setJobs] = useState<Map<string, JobRow>>(() => new Map());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  /** Nạp dữ liệu nền qua REST (jobs + logs) — dùng khi mount và khi connect lại. */
  const seed = useCallback(async () => {
    try {
      const r = await api<{ jobs?: JobRow[] }>("/api/jobs");
      if (Array.isArray(r.jobs)) {
        setJobs((prev) => {
          const next = new Map(prev);
          for (const j of r.jobs!) next.set(j.id, j);
          return next;
        });
      }
    } catch {
      /* API có thể chưa sẵn sàng — bỏ qua */
    }
    try {
      const r = await api<{ logs?: LogEntry[] }>("/api/logs");
      if (Array.isArray(r.logs)) {
        setLogs((r.logs ?? []).slice(-MAX_LOGS));
      }
    } catch {
      /* bỏ qua */
    }
  }, []);

  /** Fallback jobs qua REST (thay thế bằng 100 job mới nhất). */
  const refreshJobs = useCallback(async () => {
    try {
      const r = await api<{ jobs?: JobRow[] }>("/api/jobs");
      if (Array.isArray(r.jobs)) {
        setJobs(new Map((r.jobs ?? []).map((j) => [j.id, j] as const)));
      }
    } catch {
      /* bỏ qua */
    }
  }, []);

  /** Fallback stats qua REST. */
  const refreshStats = useCallback(async () => {
    try {
      const r = await api<{ stats?: EngineStats }>("/api/stats");
      if (r.stats) setStats(r.stats);
    } catch {
      /* bỏ qua */
    }
  }, []);

  const connect = useCallback(() => {
    const s = socketRef.current;
    if (s && !s.connected) s.connect();
    void seed();
  }, [seed]);

  useEffect(() => {
    let socket: Socket;
    if (ENGINE_PUBLIC_URL) {
      // ---- Remote mode: direct cross-origin connection to the engine
      // (deployed on Railway/Render/Fly). Engine CORS is '*', socket.io
      // path stays '/engine-io'. No XTransformPort — that is sandbox-only.
      socket = io(ENGINE_PUBLIC_URL, {
        path: "/engine-io",
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        timeout: 15000,
      });
    } else {
      // ---- Sandbox mode (qua Caddy gateway + socket.io v4.8.4) ----
      // LƯU Ý (đã kiểm chứng thực tế):
      // `io('/engine-io?XTransformPort=3002')` KHÔNG hoạt động — socket.io-client
      // hiểu '/engine-io' là *namespace* và transport vẫn đi qua path mặc định '/socket.io'.
      // Server engine gắn socket.io với `path: '/engine-io'` trên namespace mặc định '/',
      // nên client phải đặt path qua option và XTransformPort qua `query`:
      //   → GET/WS /engine-io/?EIO=4&...&XTransformPort=3002  (Caddy forward sang 3002)
      socket = io("/", {
        path: "/engine-io",
        query: { XTransformPort: "3002" },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        timeout: 10000,
      });
    }
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onStats = (s: EngineStats) => setStats(s);
    const onLog = (l: LogEntry) =>
      setLogs((prev) => {
        const next = prev.length >= MAX_LOGS ? prev.slice(prev.length - MAX_LOGS + 1) : prev.slice();
        next.push(l);
        return next;
      });
    const onJob = (j: JobRow) =>
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(j.id, j);
        return next;
      });
    const onNovel = () => setDataVersion((v) => v + 1);
    const onChapter = () => setDataVersion((v) => v + 1);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("stats", onStats);
    socket.on("log", onLog);
    socket.on("job", onJob);
    socket.on("novel", onNovel);
    socket.on("chapter", onChapter);

    // Nạp dữ liệu nền sau 1 tick (tránh setState đồng bộ trong effect) + polling fallback
    const boot = window.setTimeout(() => {
      void seed();
      void refreshStats();
    }, 0);

    // Polling fallback cho stats + jobs (khi engine không emit socket / socket rớt)
    const poll = window.setInterval(() => {
      void refreshStats();
      void refreshJobs();
    }, STATS_POLL_MS);

    return () => {
      window.clearTimeout(boot);
      window.clearInterval(poll);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("stats", onStats);
      socket.off("log", onLog);
      socket.off("job", onJob);
      socket.off("novel", onNovel);
      socket.off("chapter", onChapter);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [seed, refreshStats, refreshJobs]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { connected, stats, jobs, logs, dataVersion, connect, clearLogs };
}

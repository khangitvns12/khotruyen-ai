"use client";

// ============================================================
// KhoTruyện AI — trang chính (toàn bộ app sống ở `/` dạng view)
// dashboard | add | novels | novel(id) | jobs | settings + reader overlay
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { NovelSummary } from "@/lib/types";
import { useEngineSocket } from "@/hooks/use-engine-socket";
import { AppFooter, AppSidebar, MobileHeader } from "@/components/app/shell";
import { DashboardView } from "@/components/app/dashboard-view";
import { AddNovelView } from "@/components/app/add-novel-view";
import { NovelsView } from "@/components/app/novels-view";
import { NovelDetailView } from "@/components/app/novel-detail-view";
import { ReaderView } from "@/components/app/reader-view";
import { JobsView } from "@/components/app/jobs-view";
import { SettingsView } from "@/components/app/settings-view";
import { useDebounced } from "@/components/app/utils";
import type { ViewName } from "@/components/app/nav";

type View = { name: ViewName } | { name: "novel"; novelId: string };

interface ReaderState {
  novelId: string;
  idx: number;
  novelTitle?: string;
  totalChapters?: number;
}

export default function Page() {
  const engine = useEngineSocket();
  /** dataVersion đã debounce ~600ms — views dùng làm khoá nạp lại dữ liệu */
  const refreshKey = useDebounced(engine.dataVersion, 600);

  const [view, setView] = useState<View>({ name: "dashboard" });
  const [reader, setReader] = useState<ReaderState | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  /** Số job đang chạy + đang chờ — badge trên nav "Hàng đợi" */
  const jobsBadge = useMemo(
    () =>
      Array.from(engine.jobs.values()).filter(
        (j) => j.status === "running" || j.status === "queued"
      ).length,
    [engine.jobs]
  );

  const navigate = (v: ViewName) => setView({ name: v });
  const openNovel = (novelId: string) => setView({ name: "novel", novelId });
  const openReader = (novel: NovelSummary, idx = 1) =>
    setReader({
      novelId: novel.id,
      idx,
      novelTitle: novel.title,
      totalChapters: novel.totalChapters,
    });

  // Cuộn lên đầu khi đổi view
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [view]);

  const viewKey = view.name === "novel" ? `novel-${view.novelId}` : view.name;
  const activeNav: ViewName = view.name === "novel" ? "novels" : view.name;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Bỏ qua tới nội dung chính
      </a>

      <div className="flex flex-1">
        {/* Sidebar desktop */}
        <AppSidebar
          active={activeNav}
          onNavigate={navigate}
          jobsActive={jobsBadge}
          connected={engine.connected}
          onConnect={engine.connect}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header mobile */}
          <MobileHeader
            active={activeNav}
            onNavigate={navigate}
            jobsActive={jobsBadge}
            connected={engine.connected}
            onConnect={engine.connect}
          />

          <main
            ref={mainRef}
            id="main-content"
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={viewKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {view.name === "dashboard" && (
                  <DashboardView
                    connected={engine.connected}
                    stats={engine.stats}
                    jobs={engine.jobs}
                    logs={engine.logs}
                    onNavigate={navigate}
                  />
                )}

                {view.name === "add" && <AddNovelView onNavigate={navigate} />}

                {view.name === "novels" && (
                  <NovelsView
                    refreshKey={refreshKey}
                    stats={engine.stats}
                    onOpenNovel={openNovel}
                    onRead={(n) => openReader(n, 1)}
                    onNavigate={navigate}
                  />
                )}

                {view.name === "novel" && (
                  <NovelDetailView
                    novelId={view.novelId}
                    refreshKey={refreshKey}
                    stats={engine.stats}
                    onBack={() => navigate("novels")}
                    onRead={(n, idx) => openReader(n, idx)}
                  />
                )}

                {view.name === "jobs" && (
                  <JobsView
                    jobs={engine.jobs}
                    logs={engine.logs}
                    connected={engine.connected}
                    onClearLogs={engine.clearLogs}
                    onConnect={engine.connect}
                  />
                )}

                {view.name === "settings" && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Footer sticky bottom */}
          <AppFooter />
        </div>
      </div>

      {/* Trình đọc toàn màn hình */}
      <AnimatePresence>
        {reader && (
          <ReaderView
            novelId={reader.novelId}
            initialIdx={reader.idx}
            novelTitle={reader.novelTitle}
            totalChapters={reader.totalChapters}
            onClose={() => setReader(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

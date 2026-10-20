"use client";

// ============================================================
// KhoTruyện AI — thẻ truyện trong lưới Kho truyện
// ============================================================

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { NovelSummary } from "@/lib/types";
import { Cover } from "./cover";
import { NovelStatusBadge, SiteBadge } from "./badges";
import { NovelActionRow } from "./novel-actions";
import { fmtNum, pct } from "./utils";

interface NovelCardProps {
  novel: NovelSummary;
  hasKeys: boolean | null;
  onOpen: () => void;
  onRead: () => void;
  onChanged: () => void;
}

export function NovelCard({ novel, hasKeys, onOpen, onRead, onChanged }: NovelCardProps) {
  const scrapePct = pct(novel.scrapedCount, novel.totalChapters);
  const translatePct = pct(novel.translatedCount, novel.scrapedCount || novel.totalChapters);

  return (
    <Card
      className="group rounded-xl transition-all hover:border-primary/40 hover:shadow-md"
      role="button"
      tabIndex={0}
      aria-label={`Mở chi tiết truyện ${novel.title}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="flex gap-3 p-3">
        <div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg sm:w-24">
          <Cover src={novel.coverUrl} title={novel.title} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="line-clamp-1 font-medium group-hover:text-primary">{novel.title}</p>
          <p className="text-sm text-muted-foreground">{novel.author || "Không rõ tác giả"}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SiteBadge site={novel.sourceSite} />
            <NovelStatusBadge status={novel.status} />
          </div>

          {/* Tiến độ cào / dịch */}
          <div className="mt-2.5 space-y-1.5 text-xs">
            <div>
              <div className="flex items-center justify-between tabular-nums text-muted-foreground">
                <span>Cào</span>
                <span>
                  {fmtNum(novel.scrapedCount)}/{fmtNum(novel.totalChapters)}
                </span>
              </div>
              <Progress
                value={scrapePct}
                className="mt-0.5 h-1.5 [&_[data-slot=progress-indicator]]:bg-amber-500"
                aria-label={`Tiến độ cào ${scrapePct}%`}
              />
            </div>
            <div>
              <div className="flex items-center justify-between tabular-nums text-muted-foreground">
                <span>Dịch</span>
                <span>
                  {fmtNum(novel.translatedCount)}/{fmtNum(novel.scrapedCount)}
                </span>
              </div>
              <Progress
                value={translatePct}
                className="mt-0.5 h-1.5 [&_[data-slot=progress-indicator]]:bg-emerald-500"
                aria-label={`Tiến độ dịch ${translatePct}%`}
              />
            </div>
          </div>

          <div
            className="mt-2.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <NovelActionRow novel={novel} onRead={onRead} onChanged={onChanged} hasKeys={hasKeys} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

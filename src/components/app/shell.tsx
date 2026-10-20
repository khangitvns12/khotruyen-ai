"use client";

// ============================================================
// KhoTruyện AI — vỏ ứng dụng: sidebar (desktop), header + sheet (mobile), footer
// ============================================================

import { useState } from "react";
import { BookOpenText, Menu, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_ITEMS, VIEW_TITLES, type ViewName } from "./nav";
import { ThemeToggle } from "./theme-toggle";

// ---------------- Logo ----------------

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="cover-gradient flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm">
        <BookOpenText className="size-5 text-white" aria-hidden="true" />
      </div>
      <div className={cn("min-w-0", compact && "hidden xs:block")}>
        <p className="truncate text-sm font-bold leading-tight">KhoTruyện AI</p>
        <p className="truncate text-[11px] text-muted-foreground">cào • dịch • xuất bản</p>
      </div>
    </div>
  );
}

// ---------------- Trạng thái engine ----------------

function EngineStatus({
  connected,
  onConnect,
  className,
}: {
  connected: boolean;
  onConnect: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "status-dot inline-block size-2 rounded-full",
          connected ? "bg-emerald-500" : "bg-red-500"
        )}
      />
      <span className={cn("font-medium", connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
        {connected ? "Engine trực tuyến" : "Engine ngoại tuyến"}
      </span>
      <span className="sr-only">{connected ? "Engine đang chạy" : "Engine không kết nối được"}</span>
      {!connected && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onConnect}
          aria-label="Thử kết nối lại engine"
          title="Thử kết nối lại"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

// ---------------- Nút điều hướng dùng chung ----------------

interface NavProps {
  active: ViewName;
  onNavigate: (v: ViewName) => void;
  jobsActive: number;
}

function NavButtons({ active, onNavigate, jobsActive }: NavProps) {
  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary dark:bg-primary/15"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
              />
            )}
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.id === "jobs" && jobsActive > 0 && (
              <Badge className="bg-primary text-primary-foreground tabular-nums">{jobsActive}</Badge>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------- Sidebar desktop ----------------

export function AppSidebar({ active, onNavigate, jobsActive, connected, onConnect }: NavProps & {
  connected: boolean;
  onConnect: () => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card/40 md:flex">
      <div className="px-4 py-4">
        <Logo />
      </div>
      <div className="flex-1 px-3">
        <NavButtons active={active} onNavigate={onNavigate} jobsActive={jobsActive} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <EngineStatus connected={connected} onConnect={onConnect} />
        <ThemeToggle />
      </div>
    </aside>
  );
}

// ---------------- Header mobile + Sheet ----------------

export function MobileHeader({ active, onNavigate, jobsActive, connected, onConnect }: NavProps & {
  connected: boolean;
  onConnect: () => void;
}) {
  const [open, setOpen] = useState(false);

  const navigate = (v: ViewName) => {
    setOpen(false);
    onNavigate(v);
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b bg-background/85 px-4 py-2.5 backdrop-blur md:hidden">
      <Logo compact />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="size-10" aria-label="Mở menu điều hướng">
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b p-4">
              <SheetTitle asChild>
                <div>
                  <Logo />
                </div>
              </SheetTitle>
              <SheetDescription className="sr-only">
                Menu điều hướng KhoTruyện AI: {VIEW_TITLES[active]}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">
              <NavButtons active={active} onNavigate={navigate} jobsActive={jobsActive} />
            </div>
            <div className="mt-auto border-t px-4 py-3">
              <EngineStatus connected={connected} onConnect={onConnect} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

// ---------------- Footer sticky-bottom ----------------

export function AppFooter() {
  return (
    <footer className="mt-auto border-t py-3 px-4 md:px-6 text-xs text-muted-foreground flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <p>KhoTruyện AI — engine chạy nền phía server, đóng tab vẫn cào tiếp</p>
      <p>Dữ liệu chỉ dùng mục đích cá nhân — tôn trọng bản quyền tác giả &amp; nguồn truyện.</p>
    </footer>
  );
}

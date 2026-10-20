// ============================================================
// KhoTruyện AI — cấu hình điều hướng (dùng chung sidebar + sheet)
// ============================================================

import {
  LayoutDashboard,
  Library,
  ListChecks,
  PlusCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ViewName = "dashboard" | "add" | "novels" | "jobs" | "settings";

export interface NavItem {
  id: ViewName
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { id: "add", label: "Thêm truyện", icon: PlusCircle },
  { id: "novels", label: "Kho truyện", icon: Library },
  { id: "jobs", label: "Hàng đợi", icon: ListChecks },
  { id: "settings", label: "Cài đặt", icon: Settings },
];

export const VIEW_TITLES: Record<ViewName, string> = {
  dashboard: "Tổng quan",
  add: "Thêm truyện",
  novels: "Kho truyện",
  jobs: "Hàng đợi",
  settings: "Cài đặt",
};

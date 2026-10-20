"use client";

// ============================================================
// KhoTruyện AI — ảnh bìa có fallback gradient emerald→amber
// ============================================================

import { useState } from "react";
import { BookOpenText } from "lucide-react";
import { cn } from "@/lib/utils";

interface CoverProps {
  src?: string | null;
  title: string;
  className?: string;
}

export function Cover({ src, title, className }: CoverProps) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div
        className={cn(
          "cover-gradient flex h-full w-full items-center justify-center",
          className
        )}
        role="img"
        aria-label={`Bìa truyện ${title}`}
      >
        <BookOpenText className="size-8 text-white/90 drop-shadow" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Bìa truyện ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

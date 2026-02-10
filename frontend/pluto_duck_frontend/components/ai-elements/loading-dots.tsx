"use client";

import { cn } from "@/lib/utils";
import { memo, type CSSProperties } from "react";

export type LoadingDotsProps = {
  className?: string;
};

const DOT_DELAYS = ["0s", "0.15s", "0.3s"] as const;

const DOT_STYLE: CSSProperties = {
  width: "5px",
  height: "5px",
  borderRadius: "9999px",
  backgroundColor: "hsl(var(--muted-foreground))",
  animation: "dotWave 1.4s ease-in-out infinite",
};

export const LoadingDots = memo(({ className }: LoadingDotsProps) => (
  <div className={cn("px-2 pb-2 pl-3 pt-2", className)}>
    <div className="flex h-5 items-center gap-[5px]">
      {DOT_DELAYS.map((delay, index) => (
        <span
          aria-hidden
          key={index}
          style={{ ...DOT_STYLE, animationDelay: delay }}
        />
      ))}
    </div>
  </div>
));

LoadingDots.displayName = "LoadingDots";

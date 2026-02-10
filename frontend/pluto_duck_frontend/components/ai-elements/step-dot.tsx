"use client";

import { cn } from "@/lib/utils";
import { memo, type CSSProperties } from "react";

export type StepDotPhase = "loading" | "running" | "complete" | "error";

export type StepDotProps = {
  phase: StepDotPhase;
  className?: string;
};

const BASE_DOT_STYLE: CSSProperties = {
  width: "9px",
  height: "9px",
  borderRadius: "9999px",
  position: "relative",
};

const PULSE_DOT_STYLE: CSSProperties = {
  ...BASE_DOT_STYLE,
  position: "absolute",
  backgroundColor: "var(--dot-idle)",
  animation: "dotRipple 2s ease-out infinite",
  zIndex: 0,
};

const getCoreDotStyle = (phase: StepDotPhase): CSSProperties => {
  if (phase === "complete") {
    return {
      ...BASE_DOT_STYLE,
      backgroundColor: "var(--dot-done)",
      boxShadow: "0 0 8px 2px #2ecc7130",
      transition: "background 0.5s ease, box-shadow 0.5s ease",
      zIndex: 1,
    };
  }

  if (phase === "error") {
    return {
      ...BASE_DOT_STYLE,
      backgroundColor: "hsl(var(--destructive))",
      transition: "background 0.5s ease, box-shadow 0.5s ease",
      zIndex: 1,
    };
  }

  return {
    ...BASE_DOT_STYLE,
    backgroundColor: "var(--dot-idle)",
    transition: "background 0.5s ease, box-shadow 0.5s ease",
    zIndex: 1,
  };
};

const shouldRenderPulse = (phase: StepDotPhase) =>
  phase === "loading" || phase === "running";

export const StepDot = memo(({ phase, className }: StepDotProps) => (
  <div
    className={cn("relative flex h-5 w-5 shrink-0 items-center justify-center", className)}
  >
    {shouldRenderPulse(phase) ? <span aria-hidden style={PULSE_DOT_STYLE} /> : null}
    <span aria-hidden style={getCoreDotStyle(phase)} />
  </div>
));

StepDot.displayName = "StepDot";

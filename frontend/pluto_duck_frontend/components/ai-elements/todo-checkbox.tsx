"use client";

import { cn } from "@/lib/utils";
import { memo, type ComponentProps } from "react";
import {
  getTodoCheckboxContainerClass,
  IN_PROGRESS_TODO_GLYPH,
  type TodoCheckboxStatus,
} from "./todoCheckboxModel";

export type TodoCheckboxProps = ComponentProps<"span"> & {
  status?: TodoCheckboxStatus;
};

export const TodoCheckbox = memo(
  ({ status = "pending", className, ...props }: TodoCheckboxProps) => (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] transition-all duration-300",
        getTodoCheckboxContainerClass(status),
        className
      )}
      {...props}
    >
      {status === "in_progress" ? (
        <span className="text-[9px] leading-none text-muted-foreground">
          {IN_PROGRESS_TODO_GLYPH}
        </span>
      ) : null}
      {status === "completed" ? (
        <svg
          className="h-2.5 w-2.5"
          fill="none"
          viewBox="0 0 10 10"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2 5.4L4.1 7.4L8 3.2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      ) : null}
    </span>
  )
);

TodoCheckbox.displayName = "TodoCheckbox";

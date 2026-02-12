"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";
import type { ToolUIInput, ToolUIOutput, ToolUIState } from "./tool-types";
import { mapToolStateToPhase } from "./tool-state-phase-map";
import { StepDot } from "./step-dot";

export { mapToolStateToPhase };

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose text-xs group", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  toolName: string;
  keyParam?: string | null;
  preview?: string | null;
  state: ToolUIState;
  className?: string;
};

export const ToolHeader = ({
  className,
  toolName,
  keyParam,
  preview,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "group/step flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 pr-3 transition-colors hover:bg-muted/50",
      className
    )}
    {...props}
  >
    <StepDot phase={mapToolStateToPhase(state)} />
    <span className="font-medium text-[0.85rem] shrink-0">{toolName}</span>
    {keyParam && (
      <span className="text-muted-foreground text-xs truncate">{keyParam}</span>
    )}
    {preview && (
      <span className="text-muted-foreground text-xs truncate">{preview}</span>
    )}
    <ChevronDownIcon className="size-3 text-muted-foreground opacity-40 transition-[opacity,transform] shrink-0 ml-auto group-hover/step:opacity-70 group-data-[state=open]/step:rotate-180 group-data-[state=open]/step:opacity-70" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "overflow-hidden text-popover-foreground outline-none data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
      className
    )}
    {...props}
  />
);

export type ToolDetailBoxProps = ComponentProps<"div">;

export const ToolDetailBox = ({
  className,
  ...props
}: ToolDetailBoxProps) => (
  <div
    className={cn("bg-muted/50 rounded-[10px] overflow-hidden p-0", className)}
    {...props}
  />
);

export type ToolDetailRowProps = ComponentProps<"div"> & {
  content: string;
  variant?: "default" | "error";
};

export const ToolDetailRow = ({
  className,
  content,
  variant = "default",
  ...props
}: ToolDetailRowProps) => (
  <div
    className={cn(
      "p-[10px_14px] font-mono text-[0.76rem] leading-[1.6] whitespace-pre-wrap break-all",
      variant === "error" ? "text-destructive" : "text-muted-foreground",
      className
    )}
    {...props}
  >
    {content}
  </div>
);

export type ToolDetailDividerProps = ComponentProps<"div">;

export const ToolDetailDivider = ({
  className,
  ...props
}: ToolDetailDividerProps) => (
  <div className={cn("h-px bg-border mx-3.5", className)} {...props} />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIInput;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-1 pl-[38px] pr-2 pb-2", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-[10px] uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded bg-muted/50 overflow-x-auto max-h-40">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIOutput;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-1 pl-[38px] pr-2 pb-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-[10px] uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto overflow-y-auto max-h-48 rounded text-[11px] [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive p-2"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div className="whitespace-pre-wrap break-words">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

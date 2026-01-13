"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";
import type { ToolUIInput, ToolUIOutput, ToolUIState, ToolUIType } from "./tool-types";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("not-prose mb-2 w-full rounded-md border text-xs", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIType;
  state: ToolUIState;
  className?: string;
};

const getStatusBadge = (status: ToolUIState) => {
  const labels: Record<ToolUIState, string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "approval-requested": "Awaiting",
    "approval-responded": "Responded",
    "output-available": "Done",
    "output-error": "Error",
    "output-denied": "Denied",
  };

  const icons: Record<ToolUIState, ReactNode> = {
    "input-streaming": <CircleIcon className="size-3" />,
    "input-available": <ClockIcon className="size-3 animate-pulse" />,
    "approval-requested": <ClockIcon className="size-3 text-yellow-600" />,
    "approval-responded": <CheckCircleIcon className="size-3 text-blue-600" />,
    "output-available": <CheckCircleIcon className="size-3 text-green-600" />,
    "output-error": <XCircleIcon className="size-3 text-red-600" />,
    "output-denied": <XCircleIcon className="size-3 text-orange-600" />,
  };

  return (
    <Badge className="gap-1 rounded-full text-[10px] px-1.5 py-0" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-2 px-2 py-1.5",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-1.5 min-w-0">
      <WrenchIcon className="size-3 text-muted-foreground shrink-0" />
      <span className="font-medium text-xs truncate">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-3 text-muted-foreground transition-transform shrink-0 group-data-[state=open]:rotate-180" />
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

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIInput;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-1 px-2 pb-2", className)} {...props}>
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
    <div className={cn("space-y-1 px-2 pb-2", className)} {...props}>
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

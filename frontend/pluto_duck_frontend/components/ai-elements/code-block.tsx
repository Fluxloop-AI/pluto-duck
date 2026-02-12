"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Element } from "hast";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useState,
} from "react";
import { type BundledLanguage, codeToHtml, type ShikiTransformer } from "shiki";
import { normalizeWhiteTokenColors } from "./codeBlockColorNormalization";

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
  forceLightTheme?: boolean;
  wrapLongLines?: boolean;
  normalizeWhiteTokens?: boolean;
};

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: "",
});

const lineNumberTransformer: ShikiTransformer = {
  name: "line-numbers",
  line(node: Element, line: number) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "inline-block",
          "min-w-10",
          "mr-4",
          "text-right",
          "select-none",
          "text-muted-foreground",
        ],
      },
      children: [{ type: "text", value: String(line) }],
    });
  },
};

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createPlainCodeHtml(code: string): string {
  return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
}

export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false
) {
  const transformers: ShikiTransformer[] = showLineNumbers
    ? [lineNumberTransformer]
    : [];

  try {
    return await Promise.all([
      codeToHtml(code, {
        lang: language,
        theme: "one-light",
        transformers,
      }),
      codeToHtml(code, {
        lang: language,
        theme: "one-dark-pro",
        transformers,
      }),
    ]);
  } catch (error) {
    // Keep chat rendering resilient when Shiki theme chunks fail to load in runtime.
    console.error("Failed to highlight code block with Shiki:", error);
    const fallbackHtml = createPlainCodeHtml(code);
    return [fallbackHtml, fallbackHtml];
  }
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  forceLightTheme = false,
  wrapLongLines = false,
  normalizeWhiteTokens = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>("");
  const [darkHtml, setDarkHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    highlightCode(code, language, showLineNumbers).then(([light, dark]) => {
      if (!cancelled) {
        if (normalizeWhiteTokens) {
          setHtml(normalizeWhiteTokenColors(light));
          setDarkHtml(normalizeWhiteTokenColors(dark));
        } else {
          setHtml(light);
          setDarkHtml(dark);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, showLineNumbers]);

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          "group relative w-full overflow-auto rounded border-none bg-transparent text-foreground",
          className
        )}
        {...props}
      >
        <div className="relative">
          <div
            className={cn(
              "overflow-x-auto [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-2 [&>pre]:text-foreground! [&>pre]:text-[11px] [&_code]:font-mono [&_code]:text-[11px]",
              wrapLongLines &&
                "[&>pre]:whitespace-pre-wrap [&>pre]:break-words [&>pre]:[overflow-wrap:anywhere] [&>pre>code]:whitespace-pre-wrap [&>pre>code]:break-words [&>pre>code]:[overflow-wrap:anywhere] [&_.line]:whitespace-pre-wrap [&_.line]:break-words [&_.line]:[overflow-wrap:anywhere]",
              forceLightTheme ? "block" : "dark:hidden"
            )}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            dangerouslySetInnerHTML={{ __html: html }}
          />
          <div
            className={cn(
              "hidden overflow-x-auto [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-2 [&>pre]:text-foreground! [&>pre]:text-[11px] [&_code]:font-mono [&_code]:text-[11px]",
              wrapLongLines &&
                "[&>pre]:whitespace-pre-wrap [&>pre]:break-words [&>pre]:[overflow-wrap:anywhere] [&>pre>code]:whitespace-pre-wrap [&>pre>code]:break-words [&>pre>code]:[overflow-wrap:anywhere] [&_.line]:whitespace-pre-wrap [&_.line]:break-words [&_.line]:[overflow-wrap:anywhere]",
              forceLightTheme ? "hidden" : "dark:block"
            )}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            dangerouslySetInnerHTML={{ __html: darkHtml }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  );
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  };

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
};

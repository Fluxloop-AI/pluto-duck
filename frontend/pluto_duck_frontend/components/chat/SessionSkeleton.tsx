'use client';

export function SessionSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-1">
      <div className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-4">
        <div className="h-3 w-32 animate-pulse rounded bg-muted-foreground/20" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted-foreground/20" />
        <div className="h-4 w-8/12 animate-pulse rounded bg-muted-foreground/20" />
      </div>

      <div className="ml-auto w-10/12 space-y-3 rounded-xl border border-border/60 bg-background p-4">
        <div className="h-3 w-24 animate-pulse rounded bg-muted-foreground/20" />
        <div className="h-4 w-full animate-pulse rounded bg-muted-foreground/20" />
      </div>

      <div className="w-9/12 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="h-3 w-28 animate-pulse rounded bg-muted-foreground/20" />
        <div className="h-4 w-10/12 animate-pulse rounded bg-muted-foreground/20" />
      </div>
    </div>
  );
}

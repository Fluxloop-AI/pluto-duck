export type TodoCheckboxStatus = "pending" | "in_progress" | "completed";

export const IN_PROGRESS_TODO_GLYPH = "\u2734\uFE0E";

export function getTodoCheckboxContainerClass(
  status: TodoCheckboxStatus
): string {
  if (status === "completed") {
    return "border-0 bg-muted-foreground/60 text-white";
  }
  if (status === "in_progress") {
    return "border-[1.5px] border-muted-foreground/50 bg-transparent";
  }
  return "border-[1.5px] border-muted-foreground/30 bg-transparent";
}

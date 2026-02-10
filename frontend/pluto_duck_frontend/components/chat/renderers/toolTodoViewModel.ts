export type ToolTodoState = "pending" | "completed" | "error";
export type ToolTodoStatus = "pending" | "in_progress" | "completed";

export function getToolTodoStepPhase(
  state: ToolTodoState
): "running" | "complete" | "error" {
  if (state === "error") {
    return "error";
  }
  if (state === "pending") {
    return "running";
  }
  return "complete";
}

export function shouldShowToolTodoChevron(state: ToolTodoState): boolean {
  return state === "completed";
}

export function getToolTodoTextClass(status: ToolTodoStatus | undefined): string {
  if (status === "completed") {
    return "text-muted-foreground line-through";
  }
  if (status === "in_progress") {
    return "text-foreground";
  }
  return "text-muted-foreground";
}

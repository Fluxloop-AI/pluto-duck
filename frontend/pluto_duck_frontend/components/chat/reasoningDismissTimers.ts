export interface ScheduleReasoningDismissTimersParams {
  ids: string[];
  delayMs: number;
  timersById: Map<string, ReturnType<typeof setTimeout>>;
  onDismiss: (id: string) => void;
}

export function scheduleReasoningDismissTimers(params: ScheduleReasoningDismissTimersParams): void {
  const {
    ids,
    delayMs,
    timersById,
    onDismiss,
  } = params;

  ids.forEach(id => {
    if (timersById.has(id)) {
      return;
    }

    const timer = setTimeout(() => {
      timersById.delete(id);
      onDismiss(id);
    }, delayMs);

    timersById.set(id, timer);
  });
}

export function clearReasoningDismissTimers(timersById: Map<string, ReturnType<typeof setTimeout>>): void {
  timersById.forEach(timer => clearTimeout(timer));
  timersById.clear();
}

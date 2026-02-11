import type { StepDotPhase } from '../../ai-elements/step-dot';
import type { ToolItem } from '../../../types/chatRenderItem';

/**
 * Convert snake_case or camelCase to Title Case.
 */
export function formatToolName(name: string): string {
  if (!name) return 'Tool';

  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getInlineToolDisplayText({
  keyParam,
  preview,
  toolName,
}: {
  keyParam: string | null;
  preview: string | null;
  toolName: string;
}): string {
  return keyParam ?? preview ?? formatToolName(toolName);
}

export function getInlineToolPhase(state: ToolItem['state']): StepDotPhase {
  if (state === 'pending') return 'running';
  if (state === 'error') return 'error';
  return 'complete';
}

export function getInlineTodosSummaryLabel(todoCount: number): string {
  return `Update Todos — ${todoCount} items`;
}

export function getInlineErrorText(error: string | undefined): string | null {
  if (!error) return null;
  return error;
}

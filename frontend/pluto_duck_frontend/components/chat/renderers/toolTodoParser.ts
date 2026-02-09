import type { QueueTodo } from '../../ai-elements/queue';

type TodoRecord = Record<string, unknown>;
type TodoStatus = QueueTodo['status'];

function isRecord(value: unknown): value is TodoRecord {
  return typeof value === 'object' && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function parseJsonString(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBracketPayload(value: string): string | null {
  const start = value.indexOf('[');
  if (start < 0) return null;
  return extractBalancedBracketValue(value, start);
}

function extractBalancedBracketValue(value: string, start: number): string | null {
  if (start < 0 || value[start] !== '[') return null;

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = start; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && char === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractTodosListPayload(value: string): string | null {
  const todosKeyMatch = /['"]todos['"]\s*:\s*\[/.exec(value);
  if (!todosKeyMatch || todosKeyMatch.index < 0) return null;
  const listStart = value.indexOf('[', todosKeyMatch.index);
  return extractBalancedBracketValue(value, listStart);
}

function extractUpdatedTodosPayload(value: string): string | null {
  const marker = 'Updated todo list to';
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return null;
  const listStart = value.indexOf('[', markerIndex + marker.length);
  if (listStart < 0) return null;
  return extractBalancedBracketValue(value, listStart);
}

function parseCandidate(candidate: string): unknown | null {
  const direct = parseJsonString(candidate);
  if (direct !== null) return direct;
  const normalized = normalizePythonLiteral(candidate);
  return parseJsonString(normalized);
}

function normalizePythonLiteral(value: string): string {
  return value
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, captured: string) => {
      const escaped = captured.replace(/"/g, '\\"');
      return `"${escaped}"`;
    });
}

function parseStringPayload(value: string): unknown | null {
  const direct = parseJsonString(value);
  if (direct !== null) return direct;

  const candidates = [
    extractTodosListPayload(value),
    extractUpdatedTodosPayload(value),
    extractBracketPayload(value),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function resolveTodoArray(payload: unknown): unknown[] | null {
  if (payload == null) return null;

  let normalized: unknown = payload;
  if (typeof payload === 'string') {
    normalized = parseStringPayload(payload);
    if (normalized === null) return null;
  }

  if (Array.isArray(normalized)) return normalized;

  if (!isRecord(normalized)) return null;
  if (normalized.update !== undefined) {
    return resolveTodoArray(normalized.update);
  }
  if (normalized.content !== undefined) {
    return resolveTodoArray(normalized.content);
  }
  if (Array.isArray(normalized.todos)) return normalized.todos;
  if (Array.isArray(normalized.items)) return normalized.items;
  return null;
}

function mapTodoStatus(value: unknown): TodoStatus {
  if (value === 'completed') return 'completed';
  if (value === 'in_progress') return 'in_progress';
  return 'pending';
}

function normalizeTodoItem(todo: unknown, index: number): QueueTodo {
  if (!isRecord(todo)) {
    return {
      id: String(index),
      title: String(todo),
      status: 'pending',
    };
  }

  const id = toOptionalString(todo.id) ?? String(index);
  const title =
    toOptionalString(todo.content) ??
    toOptionalString(todo.title) ??
    toOptionalString(todo.name) ??
    String(todo);

  return {
    id,
    title,
    description: toOptionalString(todo.description),
    status: mapTodoStatus(todo.status),
  };
}

function parseTodos(payload: unknown): QueueTodo[] | null {
  const todoArray = resolveTodoArray(payload);
  if (todoArray === null) return null;
  return todoArray.map((todo, index) => normalizeTodoItem(todo, index));
}

export function parseTodosFromToolPayload(input: unknown, output: unknown): QueueTodo[] {
  const fromInput = parseTodos(input);
  if (fromInput !== null) return fromInput;

  const fromOutput = parseTodos(output);
  if (fromOutput !== null) return fromOutput;

  return [];
}

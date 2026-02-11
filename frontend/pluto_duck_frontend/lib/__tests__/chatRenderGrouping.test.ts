import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatTurn } from '../../hooks/useMultiTabChat';
import type { AssistantMessageItem, ChatRenderItem, ReasoningItem, ToolItem, UserMessageItem } from '../../types/chatRenderItem';

const chatRenderUtilsModuleUrl = new URL('../chatRenderUtils.ts', import.meta.url);

function baseRenderItem(id: string, seq: number, runId = 'run-1') {
  return {
    id,
    runId,
    seq,
    timestamp: `2026-02-10T00:00:0${seq}.000Z`,
    isStreaming: false,
  };
}

function toolItem(id: string, seq: number, toolName: string, runId = 'run-1', state: ToolItem['state'] = 'completed'): ToolItem {
  return {
    ...baseRenderItem(id, seq, runId),
    type: 'tool',
    toolName,
    state,
  };
}

function reasoningItem(id: string, seq: number): ReasoningItem {
  return {
    ...baseRenderItem(id, seq),
    type: 'reasoning',
    content: `reason-${id}`,
    phase: 'complete',
  };
}

function assistantItem(id: string, seq: number): AssistantMessageItem {
  return {
    ...baseRenderItem(id, seq),
    type: 'assistant-message',
    content: `assistant-${id}`,
    messageId: id,
  };
}

function userItem(id: string, seq: number): UserMessageItem {
  return {
    ...baseRenderItem(id, seq),
    type: 'user-message',
    content: `user-${id}`,
    messageId: id,
  };
}

function buildBaseTurn(overrides?: Partial<ChatTurn>): ChatTurn {
  return {
    key: 'turn-1',
    runId: 'run-1',
    seq: 1,
    userMessages: [],
    assistantMessages: [],
    streamingAssistantText: null,
    streamingAssistantFinal: false,
    otherMessages: [],
    events: [],
    reasoningText: '',
    toolEvents: [],
    groupedToolEvents: [],
    isActive: false,
    ...overrides,
  };
}

test('groups 2 consecutive tool items with same runId and toolName into one tool-group item', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [toolItem('t1', 1, 'run_sql'), toolItem('t2', 2, 'run_sql')];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].type, 'tool-group');
  if (grouped[0].type !== 'tool-group') {
    return;
  }
  assert.equal(grouped[0].toolName, 'run_sql');
  assert.equal(grouped[0].children.length, 2);
  assert.equal(grouped[0].id, 'tool-group-t1');
  assert.equal(grouped[0].state, 'completed');
});

test('groups 3 consecutive tool items with same runId and toolName into one tool-group item', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [
    toolItem('t1', 1, 'run_sql'),
    toolItem('t2', 2, 'run_sql'),
    toolItem('t3', 3, 'run_sql'),
  ];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].type, 'tool-group');
  if (grouped[0].type !== 'tool-group') {
    return;
  }
  assert.equal(grouped[0].children.length, 3);
});

test('keeps single tool item as-is', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [toolItem('t1', 1, 'run_sql')];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].type, 'tool');
  if (grouped[0].type !== 'tool') {
    return;
  }
  assert.equal(grouped[0].id, 't1');
});

test('does not group non-consecutive same toolName sequence A -> B -> A', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [
    toolItem('t1', 1, 'run_sql'),
    toolItem('t2', 2, 'write_todos'),
    toolItem('t3', 3, 'run_sql'),
  ];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped.map((item: ChatRenderItem) => item.type),
    ['tool', 'tool', 'tool'],
  );
});

test('does not group adjacent same toolName across different runs', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [
    toolItem('t1', 1, 'run_sql', 'run-1'),
    toolItem('t2', 2, 'run_sql', 'run-2'),
  ];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((item: ChatRenderItem) => item.type),
    ['tool', 'tool'],
  );
});

test('passes through non-tool items unchanged', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [userItem('u1', 1), reasoningItem('r1', 2), assistantItem('a1', 3)];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped.map((item: ChatRenderItem) => item.type),
    ['user-message', 'reasoning', 'assistant-message'],
  );
});

test('returns empty array for empty input', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  assert.deepEqual(groupConsecutiveTools([]), []);
});

test('groups only contiguous same-tool spans in mixed render item list', async () => {
  const { groupConsecutiveTools } = await import(chatRenderUtilsModuleUrl.href);
  const items: ChatRenderItem[] = [
    reasoningItem('r1', 1),
    toolItem('t1', 2, 'run_sql'),
    toolItem('t2', 3, 'run_sql'),
    toolItem('t3', 4, 'write_todos'),
    assistantItem('a1', 5),
  ];

  const grouped = groupConsecutiveTools(items);
  assert.equal(grouped.length, 4);
  assert.deepEqual(
    grouped.map((item: ChatRenderItem) => item.type),
    ['reasoning', 'tool-group', 'tool', 'assistant-message'],
  );
  const groupItem = grouped[1];
  assert.equal(groupItem.type, 'tool-group');
  if (groupItem.type !== 'tool-group') {
    return;
  }
  assert.equal(groupItem.toolName, 'run_sql');
  assert.equal(groupItem.children.length, 2);
});

test('deriveGroupState prioritizes error over pending and pending over completed', async () => {
  const { deriveGroupState } = await import(chatRenderUtilsModuleUrl.href);
  assert.equal(
    deriveGroupState([toolItem('t1', 1, 'run_sql', 'run-1', 'completed'), toolItem('t2', 2, 'run_sql', 'run-1', 'completed')]),
    'completed',
  );
  assert.equal(
    deriveGroupState([toolItem('t1', 1, 'run_sql', 'run-1', 'pending'), toolItem('t2', 2, 'run_sql', 'run-1', 'completed')]),
    'pending',
  );
  assert.equal(
    deriveGroupState([toolItem('t1', 1, 'run_sql', 'run-1', 'pending'), toolItem('t2', 2, 'run_sql', 'run-1', 'error')]),
    'error',
  );
});

test('flattenTurnsToRenderItems applies grouping on timeline path', async () => {
  const { flattenTurnsToRenderItems } = await import(chatRenderUtilsModuleUrl.href);
  const runId = 'run-timeline-group';
  const turns: ChatTurn[] = [
    buildBaseTurn({
      key: 'turn-timeline',
      runId,
      userMessages: [
        {
          id: 'u1',
          role: 'user',
          content: { text: 'q' },
          created_at: '2026-02-10T00:00:01.000Z',
          seq: 1,
          run_id: runId,
        },
      ],
      events: [
        {
          type: 'tool',
          subtype: 'start',
          content: { tool: 'run_sql', input: { q: 'a' } },
          metadata: { run_id: runId, sequence: 2, event_id: 'evt-t1-start', tool_call_id: 'tc-1' },
          timestamp: '2026-02-10T00:00:02.000Z',
        },
        {
          type: 'tool',
          subtype: 'end',
          content: { tool: 'run_sql', output: { rows: 1 } },
          metadata: { run_id: runId, sequence: 3, event_id: 'evt-t1-end', tool_call_id: 'tc-1' },
          timestamp: '2026-02-10T00:00:03.000Z',
        },
        {
          type: 'tool',
          subtype: 'start',
          content: { tool: 'run_sql', input: { q: 'b' } },
          metadata: { run_id: runId, sequence: 4, event_id: 'evt-t2-start', tool_call_id: 'tc-2' },
          timestamp: '2026-02-10T00:00:04.000Z',
        },
        {
          type: 'tool',
          subtype: 'end',
          content: { tool: 'run_sql', output: { rows: 2 } },
          metadata: { run_id: runId, sequence: 5, event_id: 'evt-t2-end', tool_call_id: 'tc-2' },
          timestamp: '2026-02-10T00:00:05.000Z',
        },
      ],
    }),
  ];

  const items = flattenTurnsToRenderItems(turns);
  const groupedTools = items.filter((item: ChatRenderItem) => item.type === 'tool-group');
  assert.equal(groupedTools.length, 1);
  assert.equal(groupedTools[0].type, 'tool-group');
  if (groupedTools[0].type !== 'tool-group') {
    return;
  }
  assert.equal(groupedTools[0].children.length, 2);
  assert.equal(groupedTools[0].toolName, 'run_sql');
});

test('flattenTurnsToRenderItems applies grouping on legacy fallback path', async () => {
  const { flattenTurnsToRenderItems } = await import(chatRenderUtilsModuleUrl.href);
  const runId = 'run-legacy-group';
  const turns: ChatTurn[] = [
    buildBaseTurn({
      key: 'turn-legacy',
      runId,
      groupedToolEvents: [
        {
          toolName: 'run_sql',
          state: 'completed',
          input: { q: 'one' },
          output: { rows: 1 },
        },
        {
          toolName: 'run_sql',
          state: 'completed',
          input: { q: 'two' },
          output: { rows: 2 },
        },
      ],
    }),
  ];

  const items = flattenTurnsToRenderItems(turns);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'tool-group');
  if (items[0].type !== 'tool-group') {
    return;
  }
  assert.equal(items[0].children.length, 2);
  assert.equal(items[0].toolName, 'run_sql');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTodosFromToolPayload } from '../toolTodoParser.ts';

test('parses todos from input object payload', () => {
  const todos = parseTodosFromToolPayload(
    {
      todos: [
        { id: 'a', content: 'Task A', status: 'pending' },
        { id: 'b', content: 'Task B', status: 'completed' },
      ],
    },
    null
  );

  assert.equal(todos.length, 2);
  assert.deepEqual(todos.map(todo => todo.title), ['Task A', 'Task B']);
});

test('parses todos from input JSON string payload', () => {
  const todos = parseTodosFromToolPayload(
    JSON.stringify({
      todos: [{ content: 'Task JSON', status: 'in_progress' }],
    }),
    null
  );

  assert.equal(todos.length, 1);
  assert.equal(todos[0]?.title, 'Task JSON');
  assert.equal(todos[0]?.status, 'in_progress');
});

test('falls back to output when input is malformed', () => {
  const output = {
    type: 'tool',
    content:
      "Updated todo list to [{'content': 'Fallback task', 'status': 'pending'}]",
  };

  const todos = parseTodosFromToolPayload('{bad-json', output);

  assert.equal(todos.length, 1);
  assert.equal(todos[0]?.title, 'Fallback task');
});

test('returns empty array when both input and output are missing', () => {
  const todos = parseTodosFromToolPayload(null, undefined);
  assert.deepEqual(todos, []);
});

test('maps pending, in_progress, completed statuses without loss', () => {
  const todos = parseTodosFromToolPayload(
    {
      todos: [
        { content: 'Pending task', status: 'pending' },
        { content: 'In progress task', status: 'in_progress' },
        { content: 'Completed task', status: 'completed' },
      ],
    },
    null
  );

  assert.deepEqual(todos.map(todo => todo.status), [
    'pending',
    'in_progress',
    'completed',
  ]);
});

test('defensively parses abnormal todo items', () => {
  const todos = parseTodosFromToolPayload(
    {
      todos: [123, {}, 'raw task'],
    },
    null
  );

  assert.equal(todos.length, 3);
  assert.equal(todos[0]?.title, '123');
  assert.equal(todos[1]?.title, '[object Object]');
  assert.equal(todos[2]?.title, 'raw task');
});

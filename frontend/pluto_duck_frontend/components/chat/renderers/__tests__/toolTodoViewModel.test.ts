import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldDefaultOpenToolTodo,
  getToolTodoStepPhase,
  getToolTodoTextClass,
  shouldShowToolTodoChevron,
} from '../toolTodoViewModel.ts';

test('maps tool todo state to step dot phase', () => {
  assert.equal(getToolTodoStepPhase('pending'), 'running');
  assert.equal(getToolTodoStepPhase('completed'), 'complete');
  assert.equal(getToolTodoStepPhase('error'), 'error');
});

test('shows chevron only when tool todo state is completed', () => {
  assert.equal(shouldShowToolTodoChevron('pending'), false);
  assert.equal(shouldShowToolTodoChevron('completed'), true);
  assert.equal(shouldShowToolTodoChevron('error'), false);
});

test('keeps todos expanded unless tool todo state is completed', () => {
  assert.equal(shouldDefaultOpenToolTodo('pending'), true);
  assert.equal(shouldDefaultOpenToolTodo('completed'), false);
  assert.equal(shouldDefaultOpenToolTodo('error'), true);
});

test('returns text classes by todo item status', () => {
  assert.equal(getToolTodoTextClass('pending'), 'text-muted-foreground');
  assert.equal(getToolTodoTextClass('in_progress'), 'text-foreground');
  assert.equal(
    getToolTodoTextClass('completed'),
    'text-muted-foreground line-through'
  );
  assert.equal(getToolTodoTextClass(undefined), 'text-muted-foreground');
});

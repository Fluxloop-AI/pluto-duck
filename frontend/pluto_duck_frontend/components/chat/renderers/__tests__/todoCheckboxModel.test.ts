import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTodoCheckboxContainerClass,
  IN_PROGRESS_TODO_GLYPH,
} from '../../../ai-elements/todoCheckboxModel.ts';

test('completed todo checkbox has no border class', () => {
  const cls = getTodoCheckboxContainerClass('completed');
  assert.equal(cls.includes('border-0'), true);
  assert.equal(cls.includes('border-[1.5px]'), false);
});

test('in-progress todo checkbox uses border + eight pointed black star', () => {
  const cls = getTodoCheckboxContainerClass('in_progress');
  assert.equal(cls.includes('border-[1.5px]'), true);
  assert.equal(IN_PROGRESS_TODO_GLYPH, '✴︎');
});

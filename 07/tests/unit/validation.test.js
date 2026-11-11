import test from 'node:test';
import assert from 'node:assert/strict';
import {
  charLength,
  normalizePriority,
  normalizeTitle,
  parseTaskFilter,
  parseTaskInput,
  parseTaskPatch,
} from '../../src/validation.js';

test('normalizeTitle trims and collapses whitespace', () => {
  assert.equal(normalizeTitle('  寫  三層\n測試  '), '寫 三層 測試');
  assert.equal(normalizeTitle(123), '');
});

test('normalizePriority accepts known values and falls back', () => {
  assert.equal(normalizePriority('HIGH'), 'high');
  assert.equal(normalizePriority(' low '), 'low');
  assert.equal(normalizePriority(undefined, 'medium'), 'medium');
  assert.equal(normalizePriority('urgent'), null);
  assert.equal(normalizePriority(1), null);
});

test('charLength counts Unicode code points', () => {
  assert.equal(charLength('abc'), 3);
  assert.equal(charLength('😀'), 1);
  assert.equal(charLength(''), 0);
});

test('parseTaskInput returns normalized task data', () => {
  const result = parseTaskInput({
    title: '  修正   API   驗證 ',
    priority: 'high',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    title: '修正 API 驗證',
    priority: 'high',
  });
});

test('parseTaskInput applies medium priority by default', () => {
  const result = parseTaskInput({ title: '跑系統測試' });

  assert.equal(result.ok, true);
  assert.equal(result.value.priority, 'medium');
});

test('parseTaskInput rejects empty, oversized, and invalid priority', () => {
  const empty = parseTaskInput({ title: '   ' });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.title, /請輸入/);

  const tooLong = parseTaskInput({ title: '字'.repeat(81) });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors.title, /80/);

  const badPriority = parseTaskInput({ title: '合法標題', priority: 'urgent' });
  assert.equal(badPriority.ok, false);
  assert.match(badPriority.errors.priority, /low/);
});

test('parseTaskInput accepts exactly 80 characters', () => {
  const result = parseTaskInput({ title: '字'.repeat(80) });
  assert.equal(result.ok, true);
});

test('parseTaskInput rejects non-object payloads', () => {
  for (const value of [null, [], 'task', 42]) {
    const result = parseTaskInput(value);
    assert.equal(result.ok, false);
    assert.match(result.errors.body, /JSON 物件/);
  }
});

test('parseTaskPatch requires a boolean done field', () => {
  assert.deepEqual(parseTaskPatch({ done: true }), {
    ok: true,
    value: { done: true },
  });

  const missing = parseTaskPatch({});
  assert.equal(missing.ok, false);
  assert.match(missing.errors.done, /true 或 false/);

  const wrongType = parseTaskPatch({ done: 'yes' });
  assert.equal(wrongType.ok, false);
});

test('parseTaskFilter normalizes known filters and rejects unknown values', () => {
  assert.equal(parseTaskFilter(undefined), 'all');
  assert.equal(parseTaskFilter(''), 'all');
  assert.equal(parseTaskFilter('ACTIVE'), 'active');
  assert.equal(parseTaskFilter('done'), 'done');
  assert.equal(parseTaskFilter('todo'), null);
});

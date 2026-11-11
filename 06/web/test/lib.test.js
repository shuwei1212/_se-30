import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanAuthor,
  cleanBody,
  escapeHtml,
  firstForwardedIp,
  formatBytes,
  formatUptime,
  noticeFor,
} from '../lib.js';

test('escapeHtml escapes HTML-sensitive characters', () => {
  assert.equal(
    escapeHtml('<img src="x" onerror=\'alert(1)\'>'),
    '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;',
  );
});

test('formatUptime switches between seconds, minutes, hours and days', () => {
  assert.equal(formatUptime(0), '0 秒');
  assert.equal(formatUptime(65), '1 分 5 秒');
  assert.equal(formatUptime(3661), '1 小時 1 分');
  assert.equal(formatUptime(90061), '1 天 1 小時');
  assert.equal(formatUptime(-10), '0 秒');
});

test('formatBytes formats common byte sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1.0 MB');
  assert.equal(formatBytes(120 * 1024 * 1024), '120 MB');
});

test('cleanAuthor trims, collapses whitespace and falls back to anonymous', () => {
  assert.equal(cleanAuthor('   '), '匿名');
  assert.equal(cleanAuthor('  Wei   Chen  '), 'Wei Chen');
  assert.equal(cleanAuthor('a'.repeat(60)).length, 40);
});

test('cleanBody trims and limits by characters', () => {
  assert.equal(cleanBody('  hello  '), 'hello');
  assert.equal(cleanBody('報價'.repeat(200)).length, 280);
});

test('firstForwardedIp picks the first address', () => {
  assert.equal(firstForwardedIp('203.0.113.7, 10.0.0.2', 'fallback'), '203.0.113.7');
  assert.equal(firstForwardedIp('', 'fallback'), 'fallback');
  assert.equal(firstForwardedIp(undefined, ''), '未知');
});

test('noticeFor only returns known notice codes', () => {
  assert.equal(noticeFor('note-added').tone, 'ok');
  assert.equal(noticeFor('note-invalid').tone, 'error');
  assert.equal(noticeFor('<script>'), null);
});

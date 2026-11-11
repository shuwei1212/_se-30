import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../../src/server.js';

let app;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tasklane-system-'));
  app = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataFile: path.join(directory, 'tasks.json'),
  });
});

afterEach(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = response.status === 204 ? '' : await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, text, json };
}

function postJson(url, payload) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function patchJson(url, payload) {
  return request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('GET /api/health and static files are served with security headers', async () => {
  const health = await request(`${app.url}/api/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.service, 'tasklane');
  assert.deepEqual(health.json.tasks, { total: 0, active: 0, done: 0 });

  const page = await request(`${app.url}/`);
  assert.equal(page.response.status, 200);
  assert.match(page.response.headers.get('content-type'), /text\/html/);
  assert.match(page.response.headers.get('content-security-policy'), /default-src/);
  assert.match(page.text, /TaskLane/);
  assert.match(page.text, /data-testid="total-count"/);

  const script = await request(`${app.url}/app.js`);
  assert.equal(script.response.status, 200);
  assert.match(script.response.headers.get('content-type'), /javascript/);
  assert.match(script.text, /handleSubmit/);

  const styles = await request(`${app.url}/styles.css`);
  assert.equal(styles.response.status, 200);
  assert.match(styles.response.headers.get('content-type'), /text\/css/);
});

test('task API supports create, list, filter, update, stats, and delete', async () => {
  const initial = await request(`${app.url}/api/tasks`);
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.json.tasks, []);

  const created = await postJson(`${app.url}/api/tasks`, {
    title: '  系統  API  測試任務 ',
    priority: 'high',
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.json.ok, true);
  assert.equal(created.json.task.title, '系統 API 測試任務');
  assert.equal(created.json.task.priority, 'high');
  assert.equal(created.json.task.done, false);

  const taskId = created.json.task.id;
  const active = await request(`${app.url}/api/tasks?status=active`);
  assert.equal(active.json.tasks.length, 1);
  assert.equal(active.json.tasks[0].id, taskId);

  const updated = await patchJson(`${app.url}/api/tasks/${encodeURIComponent(taskId)}`, {
    done: true,
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.task.done, true);

  const done = await request(`${app.url}/api/tasks?status=done`);
  assert.equal(done.json.tasks.length, 1);
  assert.equal(done.json.tasks[0].id, taskId);

  const activeAfter = await request(`${app.url}/api/tasks?status=active`);
  assert.deepEqual(activeAfter.json.tasks, []);

  const stats = await request(`${app.url}/api/stats`);
  assert.deepEqual(stats.json.stats, { total: 1, active: 0, done: 1 });

  const deleted = await request(`${app.url}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
  assert.equal(deleted.response.status, 204);
  assert.equal(deleted.text, '');

  const afterDelete = await request(`${app.url}/api/tasks`);
  assert.deepEqual(afterDelete.json.tasks, []);
});

test('API returns precise validation and not-found errors', async () => {
  const emptyTitle = await postJson(`${app.url}/api/tasks`, { title: '   ' });
  assert.equal(emptyTitle.response.status, 400);
  assert.equal(emptyTitle.json.error.code, 'VALIDATION_ERROR');
  assert.match(emptyTitle.json.error.fields.title, /請輸入/);

  const badPriority = await postJson(`${app.url}/api/tasks`, {
    title: '合法標題',
    priority: 'urgent',
  });
  assert.equal(badPriority.response.status, 400);
  assert.match(badPriority.json.error.fields.priority, /low/);

  const invalidJson = await request(`${app.url}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(invalidJson.response.status, 400);
  assert.equal(invalidJson.json.error.code, 'INVALID_JSON');

  const wrongType = await request(`${app.url}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ title: '不會被接受' }),
  });
  assert.equal(wrongType.response.status, 415);
  assert.equal(wrongType.json.error.code, 'UNSUPPORTED_MEDIA_TYPE');

  const created = await postJson(`${app.url}/api/tasks`, { title: '用來測錯誤的任務' });
  const taskId = created.json.task.id;

  const badPatch = await patchJson(`${app.url}/api/tasks/${encodeURIComponent(taskId)}`, {
    done: 'yes',
  });
  assert.equal(badPatch.response.status, 400);
  assert.match(badPatch.json.error.fields.done, /true 或 false/);

  const missingPatch = await patchJson(`${app.url}/api/tasks/${encodeURIComponent(taskId)}`, {});
  assert.equal(missingPatch.response.status, 400);

  const missingTask = await patchJson(`${app.url}/api/tasks/missing-id`, { done: true });
  assert.equal(missingTask.response.status, 404);
  assert.equal(missingTask.json.error.code, 'TASK_NOT_FOUND');

  const badFilter = await request(`${app.url}/api/tasks?status=todo`);
  assert.equal(badFilter.response.status, 400);
  assert.equal(badFilter.json.error.code, 'INVALID_FILTER');

  const unknownApi = await request(`${app.url}/api/nope`);
  assert.equal(unknownApi.response.status, 404);
  assert.equal(unknownApi.json.error.code, 'NOT_FOUND');
});

test('tasks survive a server restart because the store writes JSON to disk', async () => {
  const created = await postJson(`${app.url}/api/tasks`, {
    title: '重啟後仍要存在的任務',
    priority: 'low',
  });
  assert.equal(created.response.status, 201);

  const second = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataFile: path.join(directory, 'tasks.json'),
  });

  try {
    const list = await request(`${second.url}/api/tasks`);
    assert.equal(list.response.status, 200);
    assert.equal(list.json.tasks.length, 1);
    assert.equal(list.json.tasks[0].title, '重啟後仍要存在的任務');
    assert.equal(list.json.tasks[0].priority, 'low');
  } finally {
    await second.close();
  }
});

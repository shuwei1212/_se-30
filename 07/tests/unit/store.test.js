import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskStore, TaskValidationError } from '../../src/store.js';

let directory;
let store;
let sequence;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tasklane-unit-'));
  sequence = 0;
  store = new TaskStore({
    filePath: path.join(directory, 'tasks.json'),
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    idFactory: () => `task-${++sequence}`,
  });
  await store.init();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('create normalizes input and returns a persisted task', async () => {
  const task = await store.create({ title: '  寫  單元測試 ', priority: 'HIGH' });

  assert.equal(task.id, 'task-1');
  assert.equal(task.title, '寫 單元測試');
  assert.equal(task.priority, 'high');
  assert.equal(task.done, false);
  assert.equal(task.createdAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(store.list(), [task]);
});

test('create rejects invalid input with field details', async () => {
  await assert.rejects(
    () => store.create({ title: '   ' }),
    (error) => {
      assert.ok(error instanceof TaskValidationError);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.match(error.fields.title, /請輸入/);
      return true;
    },
  );

  await assert.rejects(
    () => store.create({ title: '合法標題', priority: 'urgent' }),
    (error) => {
      assert.ok(error instanceof TaskValidationError);
      assert.match(error.fields.priority, /low/);
      return true;
    },
  );
});

test('list sorts newest first and filters active or done tasks', async () => {
  const first = await store.create({ title: '第一筆' });
  const second = await store.create({ title: '第二筆', priority: 'high' });

  assert.deepEqual(store.list().map((task) => task.id), [second.id, first.id]);

  await store.setDone(first.id, true);

  assert.deepEqual(store.list('active').map((task) => task.id), [second.id]);
  assert.deepEqual(store.list('done').map((task) => task.id), [first.id]);
  assert.throws(() => store.list('todo'), /未知/);
});

test('setDone updates status and stats; unknown ids return null', async () => {
  const task = await store.create({ title: '跑系統測試' });

  assert.deepEqual(store.stats(), { total: 1, active: 1, done: 0 });

  const updated = await store.setDone(task.id, true);
  assert.equal(updated.done, true);
  assert.deepEqual(store.stats(), { total: 1, active: 0, done: 1 });

  assert.equal(await store.setDone('missing', true), null);
  await assert.rejects(() => store.setDone(task.id, 'yes'), TaskValidationError);
});

test('remove deletes a task and reports whether it existed', async () => {
  const task = await store.create({ title: '可刪除任務' });

  assert.equal(await store.remove(task.id), true);
  assert.equal(store.get(task.id), null);
  assert.equal(store.stats().total, 0);
  assert.equal(await store.remove(task.id), false);
});

test('returned tasks are clones, not internal references', async () => {
  const task = await store.create({ title: '原始標題' });
  task.title = '被外部改掉';

  assert.equal(store.get(task.id).title, '原始標題');
  assert.equal(store.list()[0].title, '原始標題');
});

test('a new store instance reloads persisted tasks from disk', async () => {
  const first = await store.create({ title: '持久化第一筆' });
  const second = await store.create({ title: '持久化第二筆', priority: 'high' });
  await store.setDone(first.id, true);

  const reloaded = new TaskStore({ filePath: store.filePath });
  await reloaded.init();

  assert.deepEqual(reloaded.list(), store.list());
  assert.deepEqual(reloaded.stats(), { total: 2, active: 1, done: 1 });

  const raw = JSON.parse(await readFile(store.filePath, 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.tasks.map((task) => task.id), [second.id, first.id]);
});

test('init rejects a corrupt JSON data file', async () => {
  const brokenPath = path.join(directory, 'broken.json');
  await writeFile(brokenPath, '{not json', 'utf8');

  const broken = new TaskStore({ filePath: brokenPath });
  await assert.rejects(() => broken.init(), /JSON/);
});

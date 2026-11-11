import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseTaskInput,
  PRIORITIES,
} from './validation.js';

export class TaskValidationError extends Error {
  constructor(fields) {
    super('輸入資料不正確。');
    this.name = 'TaskValidationError';
    this.code = 'VALIDATION_ERROR';
    this.fields = fields;
  }
}

function cloneTask(task) {
  return { ...task };
}

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const byTime = right.createdAt.localeCompare(left.createdAt);
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

export class TaskStore {
  #filePath;
  #clock;
  #idFactory;
  #tasks = new Map();
  #loaded = false;
  #writeChain = Promise.resolve();

  constructor({ filePath, clock = () => new Date(), idFactory = randomUUID } = {}) {
    if (!filePath) throw new Error('TaskStore 需要 filePath。');
    this.#filePath = path.resolve(filePath);
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  get filePath() {
    return this.#filePath;
  }

  async init() {
    if (this.#loaded) return this;

    await mkdir(path.dirname(this.#filePath), { recursive: true });

    let found = false;
    try {
      const raw = await readFile(this.#filePath, 'utf8');
      found = true;
      if (raw.trim() !== '') {
        this.#load(raw);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`無法讀取資料檔：${error.message}`);
      }
    }

    this.#loaded = true;
    if (!found) {
      await this.#persist();
    }
    return this;
  }

  list(filter = 'all') {
    this.#assertReady();
    if (!['all', 'active', 'done'].includes(filter)) {
      throw new Error(`未知的任務篩選條件：${filter}`);
    }

    const tasks = sortTasks(this.#tasks.values());
    if (filter === 'active') return tasks.filter((task) => !task.done).map(cloneTask);
    if (filter === 'done') return tasks.filter((task) => task.done).map(cloneTask);
    return tasks.map(cloneTask);
  }

  stats() {
    this.#assertReady();
    let active = 0;
    for (const task of this.#tasks.values()) {
      if (!task.done) active += 1;
    }
    const total = this.#tasks.size;
    return { total, active, done: total - active };
  }

  get(id) {
    this.#assertReady();
    const task = this.#tasks.get(String(id));
    return task ? cloneTask(task) : null;
  }

  async create(input) {
    this.#assertReady();
    const parsed = parseTaskInput(input);
    if (!parsed.ok) throw new TaskValidationError(parsed.errors);

    const timestamp = this.#timestamp();
    const task = {
      id: this.#idFactory(),
      title: parsed.value.title,
      priority: parsed.value.priority,
      done: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#tasks.set(task.id, task);
    await this.#persist();
    return cloneTask(task);
  }

  async setDone(id, done) {
    this.#assertReady();
    if (typeof done !== 'boolean') {
      throw new TaskValidationError({ done: 'done 必須是 true 或 false。' });
    }

    const task = this.#tasks.get(String(id));
    if (!task) return null;

    task.done = done;
    task.updatedAt = this.#timestamp();
    await this.#persist();
    return cloneTask(task);
  }

  async remove(id) {
    this.#assertReady();
    const deleted = this.#tasks.delete(String(id));
    if (deleted) await this.#persist();
    return deleted;
  }

  #assertReady() {
    if (!this.#loaded) throw new Error('TaskStore 尚未初始化。');
  }

  #timestamp() {
    const value = this.#clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('clock 回傳了無效日期。');
    return date.toISOString();
  }

  #load(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`資料檔不是有效的 JSON：${error.message}`);
    }

    const rows = Array.isArray(parsed) ? parsed : parsed?.tasks;
    if (!Array.isArray(rows)) {
      throw new Error('資料檔格式錯誤：tasks 必須是陣列。');
    }

    const loaded = new Map();
    for (const row of rows) {
      if (
        !row
        || typeof row.id !== 'string'
        || typeof row.title !== 'string'
        || !PRIORITIES.includes(row.priority)
        || typeof row.done !== 'boolean'
      ) {
        throw new Error('資料檔格式錯誤：任務欄位不完整。');
      }

      const createdAt = String(row.createdAt || '');
      if (Number.isNaN(new Date(createdAt).getTime())) {
        throw new Error('資料檔格式錯誤：createdAt 無效。');
      }

      loaded.set(row.id, {
        id: row.id,
        title: row.title,
        priority: row.priority,
        done: row.done,
        createdAt,
        updatedAt: String(row.updatedAt || createdAt),
      });
    }

    this.#tasks = loaded;
  }

  async #persist() {
    const snapshot = `${JSON.stringify({
      version: 1,
      tasks: sortTasks(this.#tasks.values()),
    }, null, 2)}\n`;

    this.#writeChain = this.#writeChain
      .catch(() => {})
      .then(() => writeFile(this.#filePath, snapshot, 'utf8'));
    await this.#writeChain;
  }
}

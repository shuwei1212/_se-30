#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';
import { createApp } from './app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const dbFile = process.env.DB_FILE || path.join(root, 'data', 'db.json');

const store = createStore(dbFile);
const server = createApp({ store, publicDir: path.join(root, 'public') });

server.listen(port, host, () => {
  console.log(`報價工坊已啟動：http://${host}:${port}`);
  console.log(`資料檔：${dbFile}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

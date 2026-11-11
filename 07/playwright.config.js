import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 4173);
const DATA_FILE = fileURLToPath(new URL('./data/e2e-tasks.json', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_FILE,
    },
  },
});

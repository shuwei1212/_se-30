import test, { expect } from '@playwright/test';

async function resetTasks(request) {
  const response = await request.get('/api/tasks');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();

  for (const task of payload.tasks) {
    const deleted = await request.delete(`/api/tasks/${encodeURIComponent(task.id)}`);
    expect(deleted.status()).toBe(204);
  }
}

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

async function createTask(page, title, priority = 'medium') {
  await page.getByLabel('任務標題').fill(title);
  await page.getByLabel('優先順序').selectOption(priority);
  await page.getByRole('button', { name: '新增任務' }).click();

  const task = page.locator('.task').filter({ hasText: title });
  await expect(task).toHaveCount(1);
  return task;
}

test.beforeEach(async ({ page, request }) => {
  await resetTasks(request);
  await openApp(page);
});

test.afterEach(async ({ request }) => {
  await resetTasks(request);
});

test('creates a task and updates all three counters', async ({ page }) => {
  await page.getByLabel('任務標題').fill('  E2E 建立任務  ');
  await page.getByLabel('優先順序').selectOption('high');
  await page.getByRole('button', { name: '新增任務' }).click();

  const task = page.locator('.task');
  await expect(task).toHaveCount(1);
  await expect(task.locator('.task-title')).toHaveText('E2E 建立任務');
  await expect(task.locator('.priority')).toHaveText('高');
  await expect(page.getByTestId('total-count')).toHaveText('1');
  await expect(page.getByTestId('active-count')).toHaveText('1');
  await expect(page.getByTestId('done-count')).toHaveText('0');
  await expect(page.getByLabel('任務標題')).toHaveValue('');
  await expect(page.getByLabel('任務標題')).toBeFocused();
});

test('marks a task done, filters it, and keeps the state after reload', async ({ page }) => {
  const task = await createTask(page, 'E2E 完成任務', 'high');

  await task.getByRole('checkbox').check();
  await expect(task.getByRole('checkbox')).toBeChecked();
  await expect(task).toHaveClass(/is-done/);
  await expect(page.getByTestId('done-count')).toHaveText('1');
  await expect(page.getByTestId('active-count')).toHaveText('0');

  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '已完成', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.task')).toHaveCount(1);
  await expect(page.locator('.task')).toHaveClass(/is-done/);

  await page.getByRole('button', { name: '進行中', exact: true }).click();
  await expect(page.locator('.task')).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('done-count')).toHaveText('1');
  await expect(page.locator('.task')).toHaveCount(1);
  await expect(page.locator('.task')).toHaveClass(/is-done/);
});

test('filters active and done tasks without losing either group', async ({ page }) => {
  await createTask(page, 'E2E 進行中任務', 'low');
  const completed = await createTask(page, 'E2E 已完成任務', 'medium');

  await completed.getByRole('checkbox').check();
  await expect(completed.getByRole('checkbox')).toBeChecked();

  await page.getByRole('button', { name: '進行中', exact: true }).click();
  await expect(page.locator('.task')).toHaveCount(1);
  await expect(page.locator('.task-title')).toHaveText('E2E 進行中任務');

  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.locator('.task')).toHaveCount(1);
  await expect(page.locator('.task-title')).toHaveText('E2E 已完成任務');

  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.task')).toHaveCount(2);
  await expect(page.getByTestId('total-count')).toHaveText('2');
});

test('deletes a task and the deletion survives a reload', async ({ page }) => {
  const task = await createTask(page, 'E2E 刪除任務');

  await task.getByRole('button', { name: '刪除' }).click();
  await expect(page.locator('.task')).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.getByTestId('total-count')).toHaveText('0');

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.task')).toHaveCount(0);
  await expect(page.getByTestId('total-count')).toHaveText('0');
});

test('shows client-side validation for an empty title', async ({ page }) => {
  await page.getByRole('button', { name: '新增任務' }).click();

  await expect(page.locator('#form-error')).toBeVisible();
  await expect(page.locator('#form-error')).toHaveText('請輸入任務標題。');
  await expect(page.getByLabel('任務標題')).toBeFocused();
  await expect(page.getByTestId('total-count')).toHaveText('0');
});

test('shows a server error and keeps the board usable', async ({ page }) => {
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '模擬伺服器錯誤。' },
      }),
    });
  });

  await page.getByLabel('任務標題').fill('E2E 錯誤任務');
  await page.getByRole('button', { name: '新增任務' }).click();

  await expect(page.locator('#form-error')).toBeVisible();
  await expect(page.locator('#form-error')).toHaveText('模擬伺服器錯誤。');
  await expect(page.getByTestId('total-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: '新增任務' })).toBeEnabled();
});

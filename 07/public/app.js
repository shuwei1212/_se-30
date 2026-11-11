const PRIORITY_LABELS = {
  low: '低',
  medium: '中',
  high: '高',
};

const state = {
  tasks: [],
  filter: 'all',
  busy: false,
  statusTimer: null,
};

const elements = {
  form: document.getElementById('task-form'),
  title: document.getElementById('title'),
  priority: document.getElementById('priority'),
  submit: document.getElementById('submit-button'),
  formError: document.getElementById('form-error'),
  list: document.getElementById('task-list'),
  empty: document.getElementById('empty'),
  status: document.getElementById('status'),
  total: document.querySelector('[data-testid="total-count"]'),
  active: document.querySelector('[data-testid="active-count"]'),
  done: document.querySelector('[data-testid="done-count"]'),
  filters: [...document.querySelectorAll('.filter')],
};

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers });
  const raw = response.status === 204 ? '' : await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `請求失敗（HTTP ${response.status}）`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.fields = payload?.error?.fields || null;
    throw error;
  }

  return payload;
}

function charLength(value) {
  return [...String(value ?? '')].length;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function showStatus(message, tone = 'ok') {
  window.clearTimeout(state.statusTimer);
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
  elements.status.hidden = false;
  state.statusTimer = window.setTimeout(() => {
    elements.status.hidden = true;
    elements.status.textContent = '';
  }, 3500);
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = !message;
}

function setBusy(busy) {
  state.busy = busy;
  elements.submit.disabled = busy;
  elements.submit.textContent = busy ? '儲存中…' : '新增任務';
}

function createTaskItem(task) {
  const item = document.createElement('li');
  item.className = 'task';
  item.dataset.taskId = task.id;
  if (task.done) item.classList.add('is-done');

  const checkLabel = document.createElement('label');
  checkLabel.className = 'check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', `標記完成：${task.title}`);
  checkbox.addEventListener('change', () => toggleTask(task.id, checkbox.checked));
  const checkmark = document.createElement('span');
  checkmark.className = 'checkmark';
  checkLabel.append(checkbox, checkmark);

  const content = document.createElement('div');
  content.className = 'task-content';

  const title = document.createElement('p');
  title.className = 'task-title';
  title.textContent = task.title;

  const meta = document.createElement('p');
  meta.className = 'task-meta';

  const priority = document.createElement('span');
  priority.className = `priority priority-${task.priority}`;
  priority.textContent = PRIORITY_LABELS[task.priority] || task.priority;

  const created = document.createElement('span');
  created.textContent = formatDate(task.createdAt);

  meta.append(priority, created);
  content.append(title, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete';
  remove.textContent = '刪除';
  remove.addEventListener('click', () => deleteTask(task.id));

  item.append(checkLabel, content, remove);
  return item;
}

function filteredTasks() {
  if (state.filter === 'active') return state.tasks.filter((task) => !task.done);
  if (state.filter === 'done') return state.tasks.filter((task) => task.done);
  return state.tasks;
}

function render() {
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.done).length;
  elements.total.textContent = String(total);
  elements.active.textContent = String(total - done);
  elements.done.textContent = String(done);

  const visible = filteredTasks();
  elements.list.replaceChildren(...visible.map(createTaskItem));
  elements.empty.hidden = visible.length !== 0;

  for (const button of elements.filters) {
    const selected = button.dataset.filter === state.filter;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

async function loadTasks() {
  const payload = await api('/api/tasks');
  state.tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  render();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const title = elements.title.value.trim();
  const priority = elements.priority.value;

  if (!title) {
    showFormError('請輸入任務標題。');
    elements.title.focus();
    return;
  }
  if (charLength(title) > 80) {
    showFormError('任務標題最多 80 個字。');
    elements.title.focus();
    return;
  }

  showFormError('');
  setBusy(true);
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, priority }),
    });
    elements.title.value = '';
    elements.priority.value = 'medium';
    await loadTasks();
    showStatus('任務已新增。', 'ok');
    elements.title.focus();
  } catch (error) {
    const message = error.fields?.title || error.fields?.priority || error.message;
    showFormError(message);
    showStatus(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function toggleTask(id, done) {
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    });
    state.tasks = state.tasks.map((task) => (task.id === id ? payload.task : task));
    render();
    showStatus(done ? '任務已完成。' : '任務已改回進行中。', 'ok');
  } catch (error) {
    showStatus(error.message, 'error');
    try {
      await loadTasks();
    } catch {
      render();
    }
  }
}

async function deleteTask(id) {
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter((task) => task.id !== id);
    render();
    showStatus('任務已刪除。', 'ok');
  } catch (error) {
    showStatus(error.message, 'error');
    try {
      await loadTasks();
    } catch {
      render();
    }
  }
}

function applyFilter(filter) {
  if (!['all', 'active', 'done'].includes(filter)) return;
  state.filter = filter;
  render();
}

elements.form.addEventListener('submit', handleSubmit);
elements.title.addEventListener('input', () => {
  if (!elements.formError.hidden) showFormError('');
});
for (const button of elements.filters) {
  button.addEventListener('click', () => applyFilter(button.dataset.filter));
}

async function init() {
  try {
    await loadTasks();
  } catch (error) {
    render();
    showStatus(`載入失敗：${error.message}`, 'error');
  } finally {
    document.body.dataset.ready = 'true';
  }
}

init();

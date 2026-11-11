export const MAX_TITLE_LENGTH = 80;
export const PRIORITIES = ['low', 'medium', 'high'];
export const DEFAULT_PRIORITY = 'medium';

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function charLength(value) {
  return [...String(value ?? '')].length;
}

export function normalizeTitle(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizePriority(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const priority = value.trim().toLowerCase();
  return PRIORITIES.includes(priority) ? priority : null;
}

export function parseTaskInput(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: { body: '請求內容必須是 JSON 物件。' },
    };
  }

  const errors = {};
  const title = normalizeTitle(input.title);
  const priority = normalizePriority(input.priority, DEFAULT_PRIORITY);

  if (!title) {
    errors.title = '請輸入任務標題。';
  } else if (charLength(title) > MAX_TITLE_LENGTH) {
    errors.title = `任務標題最多 ${MAX_TITLE_LENGTH} 個字。`;
  }

  if (!priority) {
    errors.priority = '優先順序必須是 low、medium 或 high。';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { title, priority },
  };
}

export function parseTaskPatch(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: { body: '請求內容必須是 JSON 物件。' },
    };
  }

  if (typeof input.done !== 'boolean') {
    return {
      ok: false,
      errors: { done: 'done 必須是 true 或 false。' },
    };
  }

  return {
    ok: true,
    value: { done: input.done },
  };
}

export function parseTaskFilter(value) {
  if (value === undefined || value === null || value === '') return 'all';
  if (typeof value !== 'string') return null;
  const filter = value.trim().toLowerCase();
  return ['all', 'active', 'done'].includes(filter) ? filter : null;
}

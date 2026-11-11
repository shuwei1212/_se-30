const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const NOTICES = {
  'note-added': { tone: 'ok', text: '筆記已寫入 PostgreSQL，重新整理後仍然存在。' },
  'note-deleted': { tone: 'ok', text: '筆記已從 PostgreSQL 刪除。' },
  'note-invalid': { tone: 'error', text: '筆記內容需為 1 到 280 個字。' },
  'note-missing': { tone: 'error', text: '找不到這筆筆記，可能已經被刪除。' },
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (days > 0) return `${days} 天 ${hours} 小時`;
  if (hours > 0) return `${hours} 小時 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${remainder} 秒`;
  return `${remainder} 秒`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  const digits = exponent === 0 || scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[exponent]}`;
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-TW').format(number);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function firstForwardedIp(headerValue, fallback = '未知') {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return fallback || '未知';
  const first = String(raw).split(',')[0].trim();
  return first || fallback || '未知';
}

export function charLength(value) {
  return [...String(value ?? '')].length;
}

export function cleanAuthor(value, maxLength = 40) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '匿名';
  return [...text].slice(0, maxLength).join('');
}

export function cleanBody(value, maxLength = 280) {
  return [...String(value ?? '').trim()].slice(0, maxLength).join('');
}

export function noticeFor(code) {
  if (!code) return null;
  return NOTICES[String(code)] || null;
}

export function statusTone(ok, warn = false) {
  if (ok) return 'up';
  return warn ? 'warn' : 'down';
}

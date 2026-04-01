import crypto from 'crypto';

function normalizeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(6);
}

export function normalizeLabelContent(content) {
  const text = String(content || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalized = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const classId = String(parts[0]);
    const coords = parts.slice(1).map(normalizeNumber);
    if (coords.some((v) => v == null)) continue;

    normalized.push(`${classId} ${coords.join(' ')}`);
  }

  normalized.sort();
  return normalized.join('\n');
}

export function hashLabelContent(content) {
  return crypto.createHash('md5').update(normalizeLabelContent(content)).digest('hex');
}

export const DB_MIN = -80; // treated as -inf
export const DB_MAX = 12;

export function clampDb(db) {
  return Math.min(DB_MAX, Math.max(DB_MIN, db));
}

export function dbToGain(db) {
  if (!Number.isFinite(db) || db <= DB_MIN) return 0;
  return Math.pow(10, db / 20);
}

export function gainToDb(g) {
  if (!Number.isFinite(g) || g <= 0) return -Infinity;
  return 20 * Math.log10(g);
}

export function formatDb(db) {
  if (!Number.isFinite(db) || db <= DB_MIN) return "-inf";
  return db.toFixed(1);
}

export function parseDb(text) {
  const t = String(text).trim().toLowerCase();
  if (t === "-inf" || t === "-infinity") return -Infinity;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

import BezierEasing from "bezier-easing";

export const CURVE_LINEAR = [0, 0, 1, 1];

const EPS = 1e-9;

function sorted(keys) {
  return (keys || []).slice().sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeFor(k0) {
  const c = k0?.curveToNext || CURVE_LINEAR;
  return BezierEasing(c[0], c[1], c[2], c[3]);
}

export function ensureDefaultCurve(keys, centerS, value) {
  if (Array.isArray(keys) && keys.length) return keys;
  return [{ s: Number(centerS) || 0, v: Number(value) || 0, curveToNext: CURVE_LINEAR }];
}

export function valueAt(keys, s, fallback = 0) {
  const k = sorted(keys);
  if (!k.length) return fallback;

  const ss = Number(s) || 0;

  if (ss <= (k[0].s ?? 0)) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    const as = a.s ?? 0;
    const bs = b.s ?? as;

    if (ss >= as && ss <= bs) {
      const u = (ss - as) / Math.max(EPS, bs - as);
      const e = (a.curveToNext ? easeFor(a)(u) : u);
      return lerp(a.v, b.v, e);
    }
  }
  return k[k.length - 1].v;
}

export function sampleCurve(keys, s0, s1, samples, fallback = 0) {
  const n = Math.max(1, samples | 0);
  const out = new Float32Array(n);
  const span = Math.max(EPS, (Number(s1) || 0) - (Number(s0) || 0));

  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    out[i] = valueAt(keys, (Number(s0) || 0) + u * span, fallback);
  }
  return out;
}

export function scheduleParamFromSourceKeys(
  param,
  keys,
  absStartTime,
  srcStart,
  srcEnd,
  fallback = 0
) {
  const k = sorted(keys);
  const t0 = Number(absStartTime) || 0;
  const s0 = Number(srcStart) || 0;
  const s1 = Number(srcEnd) || s0;

  param.cancelScheduledValues(t0);

  const v0 = valueAt(k, s0, fallback);
  param.setValueAtTime(v0, t0);

  for (const p of k) {
    const ps = Number(p.s) || 0;
    if (ps <= s0) continue;
    if (ps >= s1) break;

    const at = t0 + (ps - s0);
    param.linearRampToValueAtTime(p.v, at);
  }

  const vEnd = valueAt(k, s1, fallback);
  param.linearRampToValueAtTime(vEnd, t0 + (s1 - s0));
}
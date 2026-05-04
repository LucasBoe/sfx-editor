export const PITCH_MIN_SEMITONES = -24;
export const PITCH_MAX_SEMITONES = 24;
export const SNAP_THRESHOLD_PX = 12;

export function clampPitchSemitones(semitones) {
  const n = Number(semitones);
  if (!Number.isFinite(n)) return 0;
  return Math.max(PITCH_MIN_SEMITONES, Math.min(PITCH_MAX_SEMITONES, n));
}

export function layerPitchSemitones(layer) {
  const effects = Array.isArray(layer?.effects) ? layer.effects : [];
  let hasPitchFx = false;
  let sum = 0;

  for (const fx of effects) {
    if (fx?.type !== "pitch") continue;
    hasPitchFx = true;
    if (fx.enabled === false) continue;
    sum += Number(fx.params?.semitones) || 0;
  }

  if (hasPitchFx) return clampPitchSemitones(sum);
  return clampPitchSemitones(layer?.pitchSemitones);
}

export function layerPlaybackRate(layer) {
  return Math.pow(2, layerPitchSemitones(layer) / 12);
}

export function clipSourceDuration(layer) {
  const bufDur = Number(layer?.buffer?.duration) || 0;
  const a = Number(layer?.trimStart) || 0;
  const b = Number(layer?.trimEnd) || 0;
  return Math.max(0, bufDur - a - b);
}

export function clipDuration(layer) {
  return clipSourceDuration(layer) / layerPlaybackRate(layer);
}

export function clipStartTime(layer) {
  return Math.max(0, Number(layer?.offset) || 0);
}

export function clipEndTime(layer) {
  return clipStartTime(layer) + clipDuration(layer);
}

export function projectDuration(layers) {
  const arr = Array.isArray(layers) ? layers : [];
  let max = 0;
  for (const l of arr) {
    max = Math.max(max, clipEndTime(l));
  }
  return max;
}

export function trackWidthPx(stateOrLayers, pxPerSecValue) {
  const hasState =
    !!stateOrLayers &&
    !Array.isArray(stateOrLayers) &&
    typeof stateOrLayers === "object";

  const layers = hasState ? stateOrLayers.layers : stateOrLayers;
  const pxPerSec = Number(hasState ? stateOrLayers.pxPerSec : pxPerSecValue) || 0;
  const dur = projectDuration(layers);
  return Math.max(300, Math.ceil(dur * pxPerSec) + 120);
}

export function clipWidthPx(durationSec, pxPerSec, minPx = 30) {
  return Math.max(minPx, Math.ceil(durationSec * pxPerSec));
}

export function setClipPosition(clipEl, offsetSec, pxPerSec) {
  clipEl.style.left = `${offsetSec * pxPerSec}px`;
}

export function collectCrossTrackSnapPoints(layers, currentLayer) {
  const out = [];
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (!layer || layer === currentLayer) continue;

    const start = clipStartTime(layer);
    const end = clipEndTime(layer);
    out.push(start);
    if (end > start + 1e-6) out.push(end);
  }
  return out;
}

export function snapTimeToPoints(time, points, pxPerSec, thresholdPx = SNAP_THRESHOLD_PX) {
  const target = Number(time) || 0;
  const thresholdSec = Math.max(0, Number(thresholdPx) || 0) / Math.max(1e-6, Number(pxPerSec) || 0);

  let best = target;
  let bestDist = thresholdSec + 1e-9;

  for (const point of Array.isArray(points) ? points : []) {
    const candidate = Number(point);
    if (!Number.isFinite(candidate)) continue;

    const dist = Math.abs(candidate - target);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }

  return best;
}

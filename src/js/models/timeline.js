export const PITCH_MIN_SEMITONES = -24;
export const PITCH_MAX_SEMITONES = 24;
export const SNAP_THRESHOLD_PX = 12;
export const FADE_DB_FLOOR = -96;

const MIN_CLIP_BODY_SOURCE_DUR = 0.01;
const FADE_MIN_GAIN = Math.pow(10, FADE_DB_FLOOR / 20);
const FADE_LINEAR_BLEND = 0.08;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function shapedFadeDb(progress, mode) {
  const t = clamp01(progress);
  const curved = mode === "out"
    ? Math.cos((t * Math.PI) / 2)
    : Math.sin((t * Math.PI) / 2);
  const linear = mode === "out" ? (1 - t) : t;

  // Keep the fades natural, but nudge the visual shape closer to a straight ramp.
  const shaped = lerp(curved, linear, FADE_LINEAR_BLEND);
  return FADE_DB_FLOOR + (0 - FADE_DB_FLOOR) * shaped;
}

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
  if (layer?.isRecordingPlaceholder) {
    const previewDur = Number(layer?.previewDuration) || 0;
    const a = Number(layer?.trimStart) || 0;
    const b = Number(layer?.trimEnd) || 0;
    return Math.max(0, previewDur - a - b);
  }

  const bufDur = Number(layer?.buffer?.duration) || 0;
  const a = Number(layer?.trimStart) || 0;
  const b = Number(layer?.trimEnd) || 0;
  return Math.max(0, bufDur - a - b);
}

export function clipFadeSourceDurations(layer) {
  const srcDur = clipSourceDuration(layer);
  const maxCombined = Math.max(0, srcDur - MIN_CLIP_BODY_SOURCE_DUR);

  let fadeIn = Math.max(0, Number(layer?.fadeIn) || 0);
  let fadeOut = Math.max(0, Number(layer?.fadeOut) || 0);

  fadeIn = Math.min(fadeIn, maxCombined);
  fadeOut = Math.min(fadeOut, maxCombined);

  if (fadeIn + fadeOut > maxCombined) {
    const overflow = fadeIn + fadeOut - maxCombined;
    if (fadeOut > fadeIn) fadeOut = Math.max(0, fadeOut - overflow);
    else fadeIn = Math.max(0, fadeIn - overflow);
  }

  return { fadeIn, fadeOut, srcDur };
}

export function normalizeLayerFades(layer) {
  if (!layer) return { fadeIn: 0, fadeOut: 0, srcDur: 0 };
  const next = clipFadeSourceDurations(layer);
  layer.fadeIn = next.fadeIn;
  layer.fadeOut = next.fadeOut;
  return next;
}

export function clipFadeInDuration(layer) {
  const { fadeIn } = clipFadeSourceDurations(layer);
  return fadeIn / layerPlaybackRate(layer);
}

export function clipFadeOutDuration(layer) {
  const { fadeOut } = clipFadeSourceDurations(layer);
  return fadeOut / layerPlaybackRate(layer);
}

function fadeInGainAt(progress) {
  return Math.max(FADE_MIN_GAIN, dbToGain(shapedFadeDb(progress, "in")));
}

function fadeOutGainAt(progress) {
  return Math.max(FADE_MIN_GAIN, dbToGain(shapedFadeDb(progress, "out")));
}

export function clipFadeGainAtSourceTime(layer, sourceTime) {
  const { fadeIn, fadeOut, srcDur } = clipFadeSourceDurations(layer);
  if (srcDur <= 1e-6) return 1;

  const sourceStart = Number(layer?.trimStart) || 0;
  const sourceEnd = sourceStart + srcDur;
  const s = Math.max(sourceStart, Math.min(sourceEnd, Number(sourceTime) || sourceStart));

  let gain = 1;

  if (fadeIn > 1e-6 && s < sourceStart + fadeIn) {
    gain = Math.min(gain, fadeInGainAt((s - sourceStart) / fadeIn));
  }

  if (fadeOut > 1e-6 && s > sourceEnd - fadeOut) {
    gain = Math.min(gain, fadeOutGainAt((s - (sourceEnd - fadeOut)) / fadeOut));
  }

  return clamp01(gain);
}

export function clipFadeDbAtSourceTime(layer, sourceTime) {
  const gain = clipFadeGainAtSourceTime(layer, sourceTime);
  if (gain <= 0) return FADE_DB_FLOOR;
  return Math.max(FADE_DB_FLOOR, 20 * Math.log10(gain));
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
  const override = hasState ? Number(stateOrLayers.playheadMaxTime) : NaN;
  const maxDur = Number.isFinite(override) ? Math.max(dur, override) : dur;
  return Math.max(300, Math.ceil(maxDur * pxPerSec) + 120);
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

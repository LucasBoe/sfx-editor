import { sampleCurve } from "./automation.js";
import { clampPitchSemitones } from "./timeline.js";
import { clampDb, dbToGain } from "../volume.js";

export const EFFECT_DEFS = [
  { type: "pitch", label: "Pitch", hue: 215, defaults: { semitones: 0 } },
  { type: "volume", label: "Volume", hue: 24, defaults: { db: 0 } },
  { type: "lowpass", label: "Lowpass", hue: 168, defaults: { freq: 12000, q: 0.7 } },
  { type: "highpass", label: "Highpass", hue: 144, defaults: { freq: 80, q: 0.7 } },
];

export const UNIQUE_EFFECT_TYPES = new Set(["pitch", "volume"]);
export const DEFAULT_TRACK_HUE = 46;

export function getEffectDef(type) {
  return EFFECT_DEFS.find((d) => d.type === type) ?? null;
}

export function colorFromHue(hue, saturation = 88, lightness = 64, alpha = 1) {
  const h = Number.isFinite(Number(hue)) ? Number(hue) : DEFAULT_TRACK_HUE;
  const s = Number.isFinite(Number(saturation)) ? Number(saturation) : 88;
  const l = Number.isFinite(Number(lightness)) ? Number(lightness) : 64;
  const a = Number.isFinite(Number(alpha)) ? Number(alpha) : 1;
  return `hsl(${h.toFixed(1)} ${s}% ${l}% / ${a})`;
}

export function effectHue(type) {
  return Number(getEffectDef(type)?.hue ?? DEFAULT_TRACK_HUE);
}

export function effectColor(type, saturation = 88, lightness = 64, alpha = 1) {
  return colorFromHue(effectHue(type), saturation, lightness, alpha);
}

export function effectPrimaryParam(typeOrFx) {
  const type = typeof typeOrFx === "string" ? typeOrFx : typeOrFx?.type;
  if (type === "lowpass" || type === "highpass") return "freq";
  if (type === "volume") return "db";
  return null;
}

export function clampEffectVolumeDb(db) {
  const n = Number(db);
  return clampDb(Number.isFinite(n) ? n : 0);
}

function clampEffectFreq(freq, fallback) {
  const n = Number(freq);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(20, Math.min(20000, safe));
}

export function setEffectBaseValue(fx, value) {
  if (!fx) return 0;

  fx.params ||= {};

  if (fx.type === "lowpass") {
    fx.params.freq = clampEffectFreq(value, 12000);
    return fx.params.freq;
  }

  if (fx.type === "highpass") {
    fx.params.freq = clampEffectFreq(value, 80);
    return fx.params.freq;
  }

  if (fx.type === "volume") {
    fx.params.db = clampEffectVolumeDb(value);
    return fx.params.db;
  }

  if (fx.type === "pitch") {
    fx.params.semitones = clampPitchSemitones(value);
    return fx.params.semitones;
  }

  return Number(value) || 0;
}

export function effectBaseValue(fx) {
  if (!fx) return 0;

  if (fx.type === "lowpass") return Number(fx.params?.freq) || 12000;
  if (fx.type === "highpass") return Number(fx.params?.freq) || 80;
  if (fx.type === "volume") return clampEffectVolumeDb(fx.params?.db);
  if (fx.type === "pitch") return clampPitchSemitones(fx.params?.semitones);

  return 0;
}

export function ensureEffectAutomation(fx, bufferDuration = 0) {
  if (!fx) return null;

  fx.automation ||= {};

  const param = effectPrimaryParam(fx);
  if (!param) return null;

  const rawKeys = Array.isArray(fx.automation[param]) ? fx.automation[param] : [];
  fx.automation[param] = rawKeys;

  const fallback = effectBaseValue(fx);

  return {
    param,
    keys: fx.automation[param],
    fallback,
  };
}

function averageHues(hues) {
  if (!Array.isArray(hues) || !hues.length) return DEFAULT_TRACK_HUE;

  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const radians = (Number(hue) || 0) * Math.PI / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }

  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return DEFAULT_TRACK_HUE;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function layerEffectTheme(layer) {
  const effects = ensureEffects(layer).filter((fx) => fx?.enabled !== false);
  if (!effects.length) {
    return {
      count: 0,
      hue: DEFAULT_TRACK_HUE,
      tintAlpha: 0.08,
      tintStrongAlpha: 0.12,
      rackAlpha: 0.09,
      washAlpha: 0.05,
    };
  }

  const hue = averageHues(effects.map((fx) => effectHue(fx.type)));
  const count = effects.length;
  const tintAlpha = Math.min(0.28, 0.1 + count * 0.045);
  const tintStrongAlpha = Math.min(0.38, tintAlpha + 0.08);
  const rackAlpha = Math.min(0.22, 0.08 + count * 0.035);
  const washAlpha = Math.min(0.12, 0.04 + count * 0.02);

  return { count, hue, tintAlpha, tintStrongAlpha, rackAlpha, washAlpha };
}

export function ensureEffects(layer) {
  if (!Array.isArray(layer.effects)) layer.effects = [];

  const hasPitchFx = layer.effects.some((fx) => fx?.type === "pitch");
  const legacyPitch = Number(layer?.pitchSemitones ?? 0);
  if (!hasPitchFx && Number.isFinite(legacyPitch) && Math.abs(legacyPitch) > 1e-6) {
    const pitchFx = createEffect("pitch");
    pitchFx.enabled = true;
    pitchFx.params.semitones = clampPitchSemitones(legacyPitch);
    layer.effects.unshift(pitchFx);
  }

  if (hasPitchFx || layer.effects.some((fx) => fx?.type === "pitch")) {
    layer.pitchSemitones = 0;
  }

  for (const fx of layer.effects) {
    if (!fx.params) fx.params = {};
    if (!fx.automation) fx.automation = {};
    if (fx.type === "pitch") {
      fx.params.semitones = clampPitchSemitones(fx.params.semitones);
    }
    if (fx.type === "volume") {
      fx.params.db = clampEffectVolumeDb(fx.params.db);
    }
  }
  return layer.effects;
}

function uid() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
}

export function createEffect(type) {
  const def = EFFECT_DEFS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown effect: ${type}`);
  return { id: uid(), type: def.type, params: { ...def.defaults }, automation: {} };
}

function scheduleAudioParam(
  param,
  keys,
  absStartTime,
  srcStart,
  srcEnd,
  fallback,
  playbackRate = 1,
  mapValue = (v) => v
) {
  const span = srcEnd - srcStart;
  if (span <= 1e-6) return;
  const rate = Math.max(1e-6, Number(playbackRate) || 1);
  const timelineSpan = span / rate;

  const samples = Math.min(2048, Math.max(64, Math.ceil(timelineSpan * 240)));
  param.cancelScheduledValues(absStartTime);

  const curve = sampleCurve(keys, srcStart, srcEnd, samples, fallback);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Number(mapValue(curve[i])) || 0;
  }
  param.setValueCurveAtTime(curve, absStartTime, timelineSpan);
}

export function connectSourceThroughEffects(ctx, source, layer, destination, play) {
  let node = source;

  const effects = ensureEffects(layer);

  for (const fx of effects) {

    if (fx.enabled === false) continue;

    if (fx.type === "volume") {
      const g = ctx.createGain();
      const baseDb = effectBaseValue(fx);
      g.gain.value = dbToGain(baseDb);

      node.connect(g);
      node = g;

      if (play) {
        const automation = ensureEffectAutomation(
          fx,
          Number(layer.buffer?.duration) || 0
        );

        if (automation) {
          scheduleAudioParam(
            g.gain,
            automation.keys,
            play.absStartTime,
            play.srcStart,
            play.srcEnd,
            automation.fallback,
            play.playbackRate,
            dbToGain
          );
        }
      }
    }

    if (fx.type === "lowpass" || fx.type === "highpass") {
      const f = ctx.createBiquadFilter();
      f.type = fx.type;

      const baseFreq = effectBaseValue(fx);

      f.frequency.value = baseFreq;
      f.Q.value = Number(fx.params?.q ?? 0.7);

      node.connect(f);
      node = f;

      if (play) {
        const automation = ensureEffectAutomation(
          fx,
          Number(layer.buffer?.duration) || 0
        );

        if (automation) {
          scheduleAudioParam(
            f.frequency,
            automation.keys,
            play.absStartTime,
            play.srcStart,
            play.srcEnd,
            automation.fallback,
            play.playbackRate
          );
        }
      }
    }
  }

  node.connect(destination);
}

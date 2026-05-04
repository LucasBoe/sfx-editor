import { ensureDefaultCurve, sampleCurve } from "./automation.js";
import { clampPitchSemitones } from "./timeline.js";

export const EFFECT_DEFS = [
  { type: "pitch", label: "Pitch", hue: 215, defaults: { semitones: 0 } },
  { type: "lowpass", label: "Lowpass", hue: 168, defaults: { freq: 12000, q: 0.7 } },
  { type: "highpass", label: "Highpass", hue: 144, defaults: { freq: 80, q: 0.7 } },
];

export const UNIQUE_EFFECT_TYPES = new Set(["pitch"]);
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

function scheduleAudioParam(param, keys, absStartTime, srcStart, srcEnd, fallback, playbackRate = 1) {
  const span = srcEnd - srcStart;
  if (span <= 1e-6) return;
  const rate = Math.max(1e-6, Number(playbackRate) || 1);
  const timelineSpan = span / rate;

  const samples = Math.min(2048, Math.max(64, Math.ceil(timelineSpan * 240)));
  param.cancelScheduledValues(absStartTime);

  const curve = sampleCurve(keys, srcStart, srcEnd, samples, fallback);
  param.setValueCurveAtTime(curve, absStartTime, timelineSpan);
}

export function connectSourceThroughEffects(ctx, source, layer, destination, play) {
  let node = source;

  const effects = ensureEffects(layer);

  for (const fx of effects) {

    if (fx.enabled === false) continue;

    if (fx.type === "lowpass" || fx.type === "highpass") {
      const f = ctx.createBiquadFilter();
      f.type = fx.type;

      const baseFreq =
        Number(fx.params?.freq) ||
        (fx.type === "lowpass" ? 12000 : 80);

      f.frequency.value = baseFreq;
      f.Q.value = Number(fx.params?.q ?? 0.7);

      node.connect(f);
      node = f;

      if (play) {
        const bufDur = Number(layer.buffer?.duration) || 0;

        fx.automation.freq = ensureDefaultCurve(
          fx.automation.freq,
          bufDur / 2,
          baseFreq
        );

        scheduleAudioParam(
          f.frequency,
          fx.automation.freq,
          play.absStartTime,
          play.srcStart,
          play.srcEnd,
          baseFreq,
          play.playbackRate
        );
      }
    }
  }

  node.connect(destination);
}

import { ensureDefaultCurve, sampleCurve } from "./automation.js";

export const EFFECT_DEFS = [
  { type: "lowpass", label: "Lowpass", defaults: { freq: 12000, q: 0.7 } },
  { type: "highpass", label: "Highpass", defaults: { freq: 80, q: 0.7 } },
];

export function ensureEffects(layer) {
  if (!Array.isArray(layer.effects)) layer.effects = [];
  for (const fx of layer.effects) {
    if (!fx.params) fx.params = {};
    if (!fx.automation) fx.automation = {};
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

function scheduleAudioParam(param, keys, absStartTime, srcStart, srcEnd, fallback) {
  const span = srcEnd - srcStart;
  if (span <= 1e-6) return;

  const samples = Math.min(2048, Math.max(64, Math.ceil(span * 240)));
  param.cancelScheduledValues(absStartTime);

  const curve = sampleCurve(keys, srcStart, srcEnd, samples, fallback);
  param.setValueCurveAtTime(curve, absStartTime, span);
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
          baseFreq
        );
      }
    }
  }

  node.connect(destination);
}
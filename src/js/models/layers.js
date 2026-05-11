const STARTER_SOURCE_URL = "/audio/sheep.wav";

export function createLayerId() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
}

export function isStarterLayer(layer) {
  return !!layer?.starterSeed || layer?.sourceUrl === STARTER_SOURCE_URL;
}

export function createAudioLayer({
  id = createLayerId(),
  name = "untitled.wav",
  buffer,
  audio,
  gain,
  sourceUrl,
  starterSeed = false,
  offset = 0,
  pitchSemitones = 0,
  trimStart = 0,
  trimEnd = 0,
  fadeIn = 0,
  fadeOut = 0,
  effects = [],
  muted = false,
  preMuteGain,
} = {}) {
  const layer = {
    id,
    name,
    buffer,
    audio,
    gain,
    sourceUrl,
    starterSeed: !!starterSeed,
    offset: Math.max(0, Number(offset) || 0),
    pitchSemitones: Number(pitchSemitones) || 0,
    trimStart: Math.max(0, Number(trimStart) || 0),
    trimEnd: Math.max(0, Number(trimEnd) || 0),
    fadeIn: Math.max(0, Number(fadeIn) || 0),
    fadeOut: Math.max(0, Number(fadeOut) || 0),
    effects: Array.isArray(effects) ? effects : [],
    muted: !!muted,
  };

  if (Number.isFinite(Number(preMuteGain))) {
    layer.preMuteGain = Number(preMuteGain);
  }

  return layer;
}

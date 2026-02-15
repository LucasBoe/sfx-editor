import { audioBufferToWav, downloadBlob } from "./wav.js";
import { projectDuration, clipDuration } from "./models/timeline.js";

export function ensureCtx(state, masterGainValue) {
  if (!state.ctx) {
    state.ctx = new AudioContext();
    state.masterGain = state.ctx.createGain();
    state.masterGain.gain.value = masterGainValue;
    state.masterGain.connect(state.ctx.destination);
  }
  return state.ctx;
}

export async function decodeAudio(ctx, arrayBuffer) {
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } catch {
    return await new Promise((resolve, reject) => {
      ctx.decodeAudioData(arrayBuffer, resolve, reject);
    });
  }
}

export function createGainToMaster(state, value) {
  const g = state.ctx.createGain();
  g.gain.value = value;
  g.connect(state.masterGain);
  return g;
}

function clampTime(state, t) {
  const dur = projectDuration(state.layers || []);
  return Math.max(0, Math.min(Number(t) || 0, dur));
}

export function setPlayheadTimeValue(state, t) {
  const clamped = clampTime(state, t);
  state.playheadTime = clamped;
  if (typeof state.onPlayheadTimeChanged === "function") {
    state.onPlayheadTimeChanged(clamped);
  }
}

export function currentPlayTime(state) {
  if (!state.ctx || state.playStartAt === null) return state.playheadTime || 0;
  return (state.playheadTimeAtStart || 0) + (state.ctx.currentTime - state.playStartAt);
}

export function stopPlayback(state) {
  if (state.playStartAt !== null) {
    setPlayheadTimeValue(state, currentPlayTime(state));
  }

  for (const src of state.playing || []) {
    try {
      src.stop();
    } catch {}
  }
  state.playing = [];

  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;

  state.playStartAt = null;
  state.playheadTimeAtStart = state.playheadTime || 0;
}

export async function startPlayback(state) {
  if (!state.layers?.length) return;

  await state.ctx.resume();
  stopPlayback(state);

  const cursor = state.playheadTime || 0;
  const t0 = state.ctx.currentTime + 0.05;

  state.playStartAt = t0;
  state.playheadTimeAtStart = cursor;

state.playing = state.layers
  .map((l) => {
    const in0 = Number(l.trimStart) || 0;
    const dur = clipDuration(l);
    if (dur <= 0.0001) return null;

    const clipStart = Number(l.offset) || 0;
    const clipEnd = clipStart + dur;

    if (cursor >= clipEnd) return null;

    const when = t0 + Math.max(0, clipStart - cursor);

    const playedFromTimeline = Math.max(0, cursor - clipStart);
    const offset = in0 + playedFromTimeline;

    const playDur = clipEnd - Math.max(cursor, clipStart);
    if (playDur <= 0.0001) return null;

    const src = state.ctx.createBufferSource();
    src.buffer = l.buffer;
    src.connect(l.gain);
    src.start(when, offset, playDur);
    return src;
  })
  .filter(Boolean);

  const dur = projectDuration(state.layers);

  const tick = () => {
    const t = currentPlayTime(state);
    setPlayheadTimeValue(state, t);

    if (t >= dur + 0.02) {
      stopPlayback(state);
      if (typeof state.onPlaybackEnded === "function") state.onPlaybackEnded();
      return;
    }

    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

export async function renderMixdownWav(state, masterGainValue) {
  if (!state.layers?.length) return;

  const sr = state.ctx.sampleRate;
  const dur = projectDuration(state.layers);
  const length = Math.ceil(dur * sr);
  if (length <= 0) return;

  const offline = new OfflineAudioContext(2, length, sr);

  const master = offline.createGain();
  master.gain.value = masterGainValue;
  master.connect(offline.destination);

  for (const l of state.layers) {
    const src = offline.createBufferSource();
    src.buffer = l.buffer;

    const g = offline.createGain();
    g.gain.value = l.gain.gain.value;

    src.connect(g);
    g.connect(master);
    const in0 = Number(l.trimStart) || 0;
    const dur = clipDuration(l);
    if (dur <= 0.0001) continue;

    src.start(l.offset, in0, dur);
  }

  const out = await offline.startRendering();
  const wav = audioBufferToWav(out);
  downloadBlob(wav, "mixdown.wav");
}

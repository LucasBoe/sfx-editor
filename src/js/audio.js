import { audioBufferToWav, downloadBlob } from "./wav.js";

export function ensureCtx(state, masterVol) {
  if (!state.ctx) {
    state.ctx = new AudioContext();
    state.masterGain = state.ctx.createGain();
    state.masterGain.gain.value = masterVol;
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

export function projectDuration(layers) {
  let max = 0;
  for (const l of layers) max = Math.max(max, l.offset + l.buffer.duration);
  return max;
}

export function trackWidthPx(state) {
  return Math.max(300, Math.ceil(projectDuration(state.layers) * state.pxPerSec) + 120);
}

export function setClipPosition(state, clipEl, offset) {
  clipEl.style.left = `${offset * state.pxPerSec}px`;
}

export function getLeftPanelWidthPx(layersEl) {
  const cs = getComputedStyle(layersEl);
  const a = parseFloat(cs.getPropertyValue("--controls-col-width")) || 0;
  const b = parseFloat(cs.getPropertyValue("--name-col-width")) || 0;
  return a + b;
}

function controlsWidthPx(layersEl) {
  if (!layersEl) return 0;
  const v = getComputedStyle(layersEl).getPropertyValue("--controls-width").trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function timelineOriginPx(state) {
  if (!state.layersEl) return 0;

  if (state.rulerCanvasEl) {
    const layersRect = state.layersEl.getBoundingClientRect();
    const rulerRect = state.rulerCanvasEl.getBoundingClientRect();

    // stable even when scrolled
    return (rulerRect.left - layersRect.left) + state.layersEl.scrollLeft;
  }

  // fallback
  return controlsWidthPx(state.layersEl);
}

function playheadOriginPx(state) {
  const shell = state.timelineShellEl;
  const layersEl = state.layersEl;
  if (!shell || !layersEl) return 0;

  const track = layersEl.querySelector(".track");
  if (!track) return 0;

  const shellRect = shell.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();

  // screen space origin of timeline, already accounts for scroll
  return trackRect.left - shellRect.left;
}

export function updatePlayheadPosition(state) {
  const origin = playheadOriginPx(state);
  const x = origin + state.playheadTime * state.pxPerSec;
  state.playheadEl.style.left = `${x}px`;
}

export function setPlayheadTime(state, t) {
  const dur = projectDuration(state.layers);
  state.playheadTime = Math.max(0, Math.min(t, dur));
  updatePlayheadPosition(state);
}

export function currentPlayTime(state) {
  if (!state.ctx || state.playStartAt === null) return state.playheadTime;
  return state.playheadTimeAtStart + (state.ctx.currentTime - state.playStartAt);
}

export function stopPlayback(state) {
  if (state.playStartAt !== null) {
    setPlayheadTime(state, currentPlayTime(state));
  }

  for (const src of state.playing) {
    try { src.stop(); } catch {}
  }
  state.playing = [];

  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;

  state.playStartAt = null;
  state.playheadTimeAtStart = state.playheadTime;
}

export async function startPlayback(state) {
  if (!state.layers.length) return;

  await state.ctx.resume();
  stopPlayback(state);

  const cursor = state.playheadTime;
  const t0 = state.ctx.currentTime + 0.05;

  state.playStartAt = t0;
  state.playheadTimeAtStart = cursor;

  state.playing = state.layers
    .map((l) => {
      const clipStart = l.offset;
      const clipEnd = l.offset + l.buffer.duration;

      if (cursor >= clipEnd) return null;

      const when = t0 + Math.max(0, clipStart - cursor);
      const offset = Math.max(0, cursor - clipStart);

      const src = state.ctx.createBufferSource();
      src.buffer = l.buffer;
      src.connect(l.gain);
      src.start(when, offset);
      return src;
    })
    .filter(Boolean);

  const dur = projectDuration(state.layers);

  const tick = () => {
    const t = currentPlayTime(state);
    setPlayheadTime(state, t);

    if (t >= dur + 0.02) {
      stopPlayback(state);
      if (typeof state.onPlaybackEnded === "function")
        state.onPlaybackEnded();
      return;
    }

    state.rafId = requestAnimationFrame(tick);
  };

  state.rafId = requestAnimationFrame(tick);
}

export async function renderMixdownWav(state, masterVolValue) {
  if (!state.layers.length) return;

  const sr = state.ctx.sampleRate;
  const dur = projectDuration(state.layers);
  const length = Math.ceil(dur * sr);
  if (length <= 0) return;

  const offline = new OfflineAudioContext(2, length, sr);

  const master = offline.createGain();
  master.gain.value = masterVolValue;
  master.connect(offline.destination);

  for (const l of state.layers) {
    const src = offline.createBufferSource();
    src.buffer = l.buffer;

    const g = offline.createGain();
    g.gain.value = l.gain.gain.value;

    src.connect(g);
    g.connect(master);
    src.start(l.offset);
  }

  const out = await offline.startRendering();
  const wav = audioBufferToWav(out);
  downloadBlob(wav, "mixdown.wav");
}

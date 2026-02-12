import "bootstrap/dist/js/bootstrap.bundle.min.js";
import { dom, setLoading, setZoomLabel } from "./ui.js";
import { dbToGain, gainToDb, formatDb, parseDb, clampDb, DB_MIN } from "./volume.js";
import { loadProject, saveProject, clearProject } from "./persist.js";
import { drawWaveformFromBuffer } from "./waveform.js";
import { drawRulerViewport } from "./ruler.js";
import { setCanvasSize } from "./canvasFit.js";
import {
  ensureCtx, decodeAudio, createGainToMaster, startPlayback, stopPlayback, renderMixdownWav, 
  getLeftPanelWidthPx, setPlayheadTime, trackWidthPx, computeTimelineOriginPx, projectDuration } from "./audio.js";
import { renderLayersUI } from "./timelineUI.js";

const state = {
  ctx: null,
  masterGain: null,
  layers: [],
  playing: [],
  playStartAt: null,
  rafId: null,
  layersEl: dom.layersEl,
  playheadEl: dom.playheadEl,
  rulerCanvasEl: dom.rulerCanvasEl,
  timelineOriginPx: 0,
  playheadTime: 0,
  playheadTimeAtStart: 0,
  leftPanelWidth: 0,
  playState: "stopped",
  playSessionStartTime: 0,
  onPlaybackEnded: () => {
    state.playState = "stopped";
    updatePlayButton();
},

  pxPerSec: Number(dom.zoomEl.value),
};

setZoomLabel(state.pxPerSec);

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

async function saveNow() {
  try {
    const project = {
      masterVol: dbToGain(Number(dom.masterVolEl.value)),
      pxPerSec: state.pxPerSec,
      layers: state.layers.map((l) => ({
        name: l.name,
        offset: l.offset,
        gain: l.gain.gain.value,
        audio: l.audio,
      })),
    };
    await saveProject(project);
  } catch (e) {
    console.error("Save failed:", e);
  }
}

function render() {
  const w = trackWidthPx(state);
  dom.layersEl.style.setProperty("--timeline-width", `${w}px`);

  renderLayersUI({
    state,
    layersEl: dom.layersEl,
    drawWaveform: drawWaveformFromBuffer,
    scheduleSave,
  });

  state.timelineOriginPx = computeTimelineOriginPx(dom.layersEl);
  setPlayheadTime(state, state.playheadTime);

  renderRuler();

  requestAnimationFrame(() => {
    state.timelineOriginPx = computeTimelineOriginPx(dom.layersEl);
    setPlayheadTime(state, state.playheadTime);
    renderRuler();
  });
}




function renderRuler() {
  const rulerH = 28;
  const cssW = Math.round(dom.rulerCanvasEl.parentElement.clientWidth);
  const startTime = dom.layersEl.scrollLeft / state.pxPerSec;

  setCanvasSize(dom.rulerCanvasEl, cssW, rulerH);
  drawRulerViewport(dom.rulerCanvasEl, state.pxPerSec, startTime, cssW, rulerH);
}

dom.masterVolEl.addEventListener("input", () => {
  const db = clampDb(Number(dom.masterVolEl.value));
  dom.masterVolEl.value = String(db);
  dom.masterDbEl.value = formatDb(db);

  if (state.masterGain) state.masterGain.gain.value = dbToGain(db);
  scheduleSave();
});

dom.masterDbEl.addEventListener("change", () => {
  const parsed = parseDb(dom.masterDbEl.value);
  const db = Number.isFinite(parsed) ? clampDb(parsed) : -Infinity;

  dom.masterVolEl.value = String(Number.isFinite(db) ? db : DB_MIN);
  dom.masterDbEl.value = formatDb(db);

  if (state.masterGain) state.masterGain.gain.value = dbToGain(db);
  scheduleSave();
});

dom.zoomEl.addEventListener("input", () => {
  const layersRect = dom.layersEl.getBoundingClientRect();
  const phRect = dom.playheadEl.getBoundingClientRect();

  // playhead x inside the visible layers viewport
  const anchorX = phRect.left - layersRect.left;

  state.pxPerSec = Number(dom.zoomEl.value);
  setZoomLabel(state.pxPerSec);

  render();

  // playhead x in content coordinates after zoom
  const playheadLeft = Number.parseFloat(state.playheadEl.style.left) || 0;

  // scroll so playhead stays at same anchorX
  dom.layersEl.scrollLeft = Math.max(0, playheadLeft - anchorX);

  scheduleSave();
});

let rulerRaf = 0;
dom.layersEl.addEventListener("scroll", () => {
  if (rulerRaf) return;
  rulerRaf = requestAnimationFrame(() => {
    rulerRaf = 0;
    renderRuler();
  });
});

dom.filesEl.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  setLoading(true, `Importing ${files.length} file(s)`);
  try {
    ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));

    for (const f of files) {
      const audio = await f.arrayBuffer();
      const buffer = await decodeAudio(state.ctx, audio.slice(0));

      const gain = createGainToMaster(state, 1);
      state.layers.push({ name: f.name, buffer, audio, gain, offset: 0 });
    }

    render();
    scheduleSave();
  } catch (err) {
    console.error("Import failed:", err);
    alert("Import failed. Try WAV first.");
  } finally {
    setLoading(false);
    e.target.value = "";
  }
});

dom.playEl.addEventListener("click", async () => {
  ensureCtx(state, Number(dom.masterVolEl.value));

  if (state.playState === "playing") {
    state.playState = "paused";
    stopPlayback(state); // pause
    updatePlayButton();
    return;
  }

  if (state.playState === "stopped") {
    state.playSessionStartTime = state.playheadTime;
  }

  state.playState = "playing";
  await startPlayback(state); // starts from current playheadTime
  updatePlayButton();
});

dom.stopEl.addEventListener("click", () => {
  stopPlayback(state); // stop audio if playing
  setPlayheadTime(state, state.playSessionStartTime); // jump back to where Play started
  state.playState = "stopped";
  updatePlayButton();
});


dom.renderEl.addEventListener("click", async () => {
  ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
  await renderMixdownWav(state, Number(dom.masterVolEl.value));
});

dom.clearEl.addEventListener("click", async () => {
  stopPlayback(state);
  state.layers = [];
  render();
  await clearProject();
});

function rulerTimeFromEvent(ev) {
  const rect = dom.rulerCanvasEl.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  return (dom.layersEl.scrollLeft + x) / state.pxPerSec;
}

function seekToTime(t, restartIfPlaying) {
  const wasPlaying = state.playStartAt !== null;

  stopPlayback(state);
  setPlayheadTime(state, t);
  scheduleSave();

  if (restartIfPlaying && wasPlaying) { 
    state.playSessionStartTime = t
    startPlayback(state);
  }
}

function updatePlayButton() {
  dom.playEl.innerHTML = state.playState === "playing" ? '<span class="icon-pause2"></span>' : '<span class="icon-play3"></span>';
}

dom.rulerCanvasEl.addEventListener("pointerdown", (e) => {
  dom.rulerCanvasEl.setPointerCapture(e.pointerId);

  const wasPlaying = state.playStartAt !== null;
  let lastRestartMs = 0;

  const apply = (ev, doRestart) => {
    const t = rulerTimeFromEvent(ev);
    seekToTime(t, doRestart);
  };

  apply(e, true);

  const onMove = (ev) => {
    const t = rulerTimeFromEvent(ev);
    setPlayheadTime(state, t);
    scheduleSave();

    if (wasPlaying) {
      const now = performance.now();
      if (now - lastRestartMs > 100) {
        lastRestartMs = now;
        stopPlayback(state);
        startPlayback(state);
      }
    }
  };

  const onUp = (ev) => {
    dom.rulerCanvasEl.releasePointerCapture(ev.pointerId);
    dom.rulerCanvasEl.removeEventListener("pointermove", onMove);
    dom.rulerCanvasEl.removeEventListener("pointerup", onUp);
    dom.rulerCanvasEl.removeEventListener("pointercancel", onUp);

    if (wasPlaying) {
      stopPlayback(state);
      startPlayback(state);
    }
  };

  dom.rulerCanvasEl.addEventListener("pointermove", onMove);
  dom.rulerCanvasEl.addEventListener("pointerup", onUp);
  dom.rulerCanvasEl.addEventListener("pointercancel", onUp);
});

async function restore() {
  setLoading(true, "Restoring project");
  try {
    const project = await loadProject();
    if (!project) return;

    const masterDb = gainToDb(project.masterVol ?? 1);
    dom.masterVolEl.value = String(Number.isFinite(masterDb) ? clampDb(masterDb) : DB_MIN);
    dom.masterDbEl.value = formatDb(masterDb);

    state.pxPerSec = Number(project.pxPerSec ?? state.pxPerSec);
    dom.zoomEl.value = String(state.pxPerSec);
    setZoomLabel(state.pxPerSec);

    ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
    state.layers = [];

    for (const item of project.layers ?? []) {
      const audio = item.audio;
      const buffer = await decodeAudio(state.ctx, audio.slice(0));

      const gain = createGainToMaster(state, Number(item.gain ?? 1));
      state.layers.push({
        name: item.name,
        buffer,
        audio,
        gain,
        offset: Number(item.offset ?? 0),
      });
    }

    render();
  } catch (e) {
    console.error("Restore failed:", e);
  } finally {
    setLoading(false);
  }
}

restore();

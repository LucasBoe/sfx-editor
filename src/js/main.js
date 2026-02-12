import "bootstrap/dist/js/bootstrap.bundle.min.js";
import { dom, setLoading, setZoomLabel } from "./ui.js";
import { dbToGain, gainToDb, formatDb, parseDb, clampDb, DB_MIN } from "./volume.js";
import { loadProject, saveProject, clearProject } from "./persist.js";
import { drawWaveformSegment } from "./waveform.js";
import { drawRulerViewport } from "./ruler.js";
import { setCanvasSize } from "./canvasFit.js";
import { zoomFromSlider, sliderFromZoom } from "./zoomConfig.js";
import {
  ensureCtx, decodeAudio, createGainToMaster, startPlayback, stopPlayback, renderMixdownWav, 
  setPlayheadTime, trackWidthPx, computeTimelineOriginPx } from "./audio.js";
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

  pxPerSec: zoomFromSlider(Number(dom.zoomEl.value)),
  
};

dom.zoomEl.value = String(sliderFromZoom(state.pxPerSec));
setZoomLabel(Math.round(state.pxPerSec));

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

async function saveNow() {
  try {
    const project = {
      masterVol: dbToGain(Number(dom.masterVolEl.value)),
      playheadTime: state.playheadTime,
      playSessionStartTime: state.playSessionStartTime,
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
    drawWaveform: drawWaveformSegment,
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

dom.zoomEl.addEventListener("input", applyZoomFromSlider);

function bumpZoom(dir) {
  const step = 25; // feel free to tweak
  const cur = Number(dom.zoomEl.value) || 0;
  const next = Math.max(0, Math.min(1000, cur + dir * step));
  if (next === cur) return;
  dom.zoomEl.value = String(next);
  applyZoomFromSlider();
}

dom.zoomInEl.addEventListener("click", () => bumpZoom(+1));
dom.zoomOutEl.addEventListener("click", () => bumpZoom(-1));

function holdZoom(dir) {
  bumpZoom(dir);
  const id = setInterval(() => bumpZoom(dir), 60);
  const stop = () => {
    clearInterval(id);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

dom.zoomInEl.addEventListener("pointerdown", () => holdZoom(+1));
dom.zoomOutEl.addEventListener("pointerdown", () => holdZoom(-1));

function applyZoomFromSlider() {
  const layersRect = dom.layersEl.getBoundingClientRect();
  const phRect = dom.playheadEl.getBoundingClientRect();
  const anchorX = phRect.left - layersRect.left;

  state.pxPerSec = zoomFromSlider(Number(dom.zoomEl.value));
  setZoomLabel(Math.round(state.pxPerSec));

  render();

  const playheadLeft = Number.parseFloat(state.playheadEl.style.left) || 0;
  dom.layersEl.scrollLeft = Math.max(0, playheadLeft - anchorX);

  scheduleSave();
}

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

// prevent "go to previous page when navigating through tracks horizontally and reaching scroll boundary"
dom.layersEl.addEventListener(
  "wheel",
  (e) => {
    const dx = e.deltaX;
    const dy = e.deltaY;

    const horizontalIntent = Math.abs(dx) > Math.abs(dy) || e.shiftKey;
    if (!horizontalIntent) return;

    const move = e.shiftKey ? dy : dx;
    dom.layersEl.scrollLeft += move;
    e.preventDefault();
  },
  { passive: false }
);

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
    dom.zoomEl.value = String(sliderFromZoom(state.pxPerSec));
    setZoomLabel(Math.round(state.pxPerSec));

    state.playheadTime = Number(project.playheadTime ?? 0);
    state.playSessionStartTime = Number(project.playSessionStartTime ?? state.playheadTime);

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

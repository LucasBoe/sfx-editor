import { dom, setLoading } from "../ui.js";
import { zoomFromSlider } from "../zoomConfig.js";
import { dbToGain } from "../volume.js";
import { loadProject, saveProject, clearProject } from "../persist.js";
import { drawWaveformSegment } from "../waveform.js";
import { renderLayersUI } from "../timelineUI.js";
import { trackWidthPx } from "../models/timeline.js";
import {
  ensureCtx,
  decodeAudio,
  createGainToMaster,
  startPlayback,
  stopPlayback,
  renderMixdownWav,
  setPlayheadTimeValue,
} from "../audio.js";
import { initPlayhead, updatePlayheadPosition } from "../features/playhead.js";
import { createRulerFeature } from "../features/rulerFeature.js";
import { initZoom } from "../features/zoomFeature.js";
import { initMaster } from "../features/masterFeature.js";
import { initImport } from "../features/importFeature.js";
import { initPlayback } from "../features/playbackFeature.js";
import { createPersistence } from "../features/persistenceFeature.js";
import { initScroll } from "../features/scrollFeature.js";
import { createGlobalMeterFeature } from "../features/globalMeterFeature.js";

const state = {
  ctx: null,
  masterGain: null,
  layers: [],
  playing: [],
  playStartAt: null,
  rafId: null,

  timelineShellEl: dom.timelineShellEl,
  layersEl: dom.layersEl,
  rulerCanvasEl: dom.rulerCanvasEl,
  playheadEl: dom.playheadEl,

  playheadTime: 0,
  playheadTimeAtStart: 0,
  playState: "stopped",
  playSessionStartTime: 0,

  pxPerSec: zoomFromSlider(Number(dom.zoomEl.value)),

  // set by initPlayhead
  onPlayheadTimeChanged: null,
  // convenience
  setPlayheadTimeValue: null,
};

initPlayhead(state, dom);
state.setPlayheadTimeValue = (t) => setPlayheadTimeValue(state, t);

function renderAll() {
  const w = trackWidthPx(state.layers, state.pxPerSec);
  dom.layersEl.style.setProperty("--timeline-width", `${w}px`);

  renderLayersUI({
    state,
    layersEl: dom.layersEl,
    drawWaveform: drawWaveformSegment,
    scheduleSave,
    requestRender: renderAll,
  });

  updatePlayheadPosition(state);
  ruler.renderRuler();;

  requestAnimationFrame(() => {
    updatePlayheadPosition(state);
    ruler.renderRuler();;
  });
}

const persistence = createPersistence({
  state,
  dom,
  setLoading,
  loadProject,
  saveProject,
  clearProject,
  ensureCtx,
  decodeAudio,
  createGainToMaster,
});

const { scheduleSave, restoreProject, clearSavedProject } = persistence;

initMaster({ state, dom, scheduleSave });
initPlayback({ state, dom, ensureCtx, startPlayback, stopPlayback });
initZoom({ state, dom, renderAll, renderRuler: () => ruler.renderRuler(), scheduleSave });
initScroll({ state, dom, renderRuler: () => ruler.renderRuler(), updatePlayheadPosition });

const ruler = createRulerFeature({ state, dom });
ruler.initRulerScrub({ seekToTime, scheduleSave });

function seekToTime(t, restartIfPlaying) {
  const wasPlaying = state.playStartAt !== null;

  stopPlayback(state);
  state.setPlayheadTimeValue(t);
  ruler.renderRuler();;
  scheduleSave();

  if (restartIfPlaying && wasPlaying) {
    state.playSessionStartTime = t;
    startPlayback(state);
  }
}

initImport({
  state,
  dom,
  setLoading,
  ensureCtx,
  decodeAudio,
  createGainToMaster,
  renderAll,
  scheduleSave,
});

const meter = createGlobalMeterFeature({ state, dom });
state.onMeterFrame = () => meter.update();
state.onMeterStop = () => meter.onStop();
state.onMeterReset = () => meter.reset();



dom.renderEl.addEventListener("click", async () => {
  ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
  await renderMixdownWav(state, dbToGain(Number(dom.masterVolEl.value)));
});

dom.clearEl.addEventListener("click", async () => {
  stopPlayback(state);
  state.layers = [];
  renderAll();
  await clearSavedProject();
});

restoreProject(renderAll);

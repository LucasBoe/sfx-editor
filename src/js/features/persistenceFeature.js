import { dbToGain } from "../volume.js";
import { createAudioLayer, createLayerId } from "../models/layers.js";
import { sliderFromZoom } from "../zoomConfig.js";
import { setZoomLabel } from "../ui.js";
import { restoreMasterUi } from "./masterFeature.js";
import { applyFitZoomForDuration } from "./fitZoom.js";

const DEFAULT_STARTER_LAYER = {
  url: "/audio/sheep.wav",
  name: "sheep.wav",
};

export function createPersistence({ state, dom, setLoading, loadProject, saveProject, clearProject, ensureCtx, decodeAudio, createGainToMaster }) {
  let timer = 0;

  async function saveNow() {
    try {
      const project = {
        masterVol: dbToGain(Number(dom.masterVolEl.value)),
        playheadTime: state.playheadTime,
        playSessionStartTime: state.playSessionStartTime,
        pxPerSec: state.pxPerSec,
        layers: state.layers.map((l) => ({
          id: l.id,
          name: l.name,
          sourceUrl: l.sourceUrl,
          starterSeed: !!l.starterSeed,
          offset: l.offset,
          trimStart: l.trimStart,
          trimEnd: l.trimEnd,
          fadeIn: l.fadeIn,
          fadeOut: l.fadeOut,
          effects: l.effects ?? [],
          gain: l.muted ? (l.preMuteGain ?? l.gain.gain.value) : l.gain.gain.value,
          muted: l.muted ?? false,
          audio: l.audio,
        })),
      };
      await saveProject(project);
    } catch (e) {
      console.error("Save failed:", e);
    }
  }

  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(saveNow, 250);
  }

  async function loadStarterLayer() {
    const response = await fetch(DEFAULT_STARTER_LAYER.url);
    if (!response.ok) {
      throw new Error(`Failed to load starter audio: ${response.status}`);
    }

    const audio = await response.arrayBuffer();
    const buffer = await decodeAudio(state.ctx, audio.slice(0));
    const gain = createGainToMaster(state, 1);

    return {
      ...createAudioLayer({
        id: createLayerId(),
        name: DEFAULT_STARTER_LAYER.name,
        buffer,
        audio,
        sourceUrl: DEFAULT_STARTER_LAYER.url,
        starterSeed: true,
        gain,
      }),
      buffer,
    };
  }

  async function restore(renderAll) {
    setLoading(true, "Restoring project");
    try {
      const project = await loadProject();

      // master
      restoreMasterUi(dom, project?.masterVol ?? 1);

      // zoom
      state.pxPerSec = Number(project?.pxPerSec ?? state.pxPerSec);
      dom.zoomEl.value = String(sliderFromZoom(state.pxPerSec));
      setZoomLabel(Math.round(state.pxPerSec));

      // playhead
      state.playheadTime = Number(project?.playheadTime ?? 0);
      state.playSessionStartTime = Number(project?.playSessionStartTime ?? state.playheadTime);

      // layers
      ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
      state.layers = [];

      if (!project) {
        const starterLayer = await loadStarterLayer();
        state.layers.push(starterLayer);
        applyFitZoomForDuration({
          state,
          dom,
          durationSec: Number(starterLayer.buffer?.duration) || 0,
        });
        renderAll();
        if (dom.layersEl) dom.layersEl.scrollLeft = 0;
        state.setPlayheadTimeValue(0);
        return;
      }

      for (const item of project.layers ?? []) {
        const audio = item.audio;
        const buffer = await decodeAudio(state.ctx, audio.slice(0));
        const intendedGain = Number(item.gain ?? 1);
        const isMuted = !!item.muted;
        const gain = createGainToMaster(state, isMuted ? 0 : intendedGain);
        state.layers.push(createAudioLayer({
          id: item.id || createLayerId(),
          name: item.name,
          buffer,
          audio,
          sourceUrl: item.sourceUrl,
          gain,
          offset: Number(item.offset ?? 0),
          pitchSemitones: Number(item.pitchSemitones ?? 0),
          trimStart: Number(item.trimStart ?? 0),
          trimEnd: Number(item.trimEnd ?? 0),
          fadeIn: Math.max(0, Number(item.fadeIn ?? 0) || 0),
          fadeOut: Math.max(0, Number(item.fadeOut ?? 0) || 0),
          effects: Array.isArray(item.effects) ? item.effects : [],
          muted: isMuted,
          starterSeed: !!item.starterSeed,
          preMuteGain: isMuted ? intendedGain : undefined,
        }));
      }

      renderAll();
      state.setPlayheadTimeValue(state.playheadTime);
    } catch (e) {
      console.error("Restore failed:", e);
    } finally {
      setLoading(false);
    }
  }

  async function clear(renderAll) {
    state.layers = [];
    renderAll();
    await clearProject();
  }

  async function restoreProject(renderAll) {
    return await restore(renderAll);
  }

  async function clearSavedProject() {
    await clearProject();
  }

  return {
    saveNow,
    scheduleSave,
    restoreProject,
    clearSavedProject,
    // keep legacy names
    restore,
    clear,
  };
}

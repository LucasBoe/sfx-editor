import { dbToGain } from "../volume.js";
import { sliderFromZoom } from "../zoomConfig.js";
import { setZoomLabel } from "../ui.js";
import { restoreMasterUi } from "./masterFeature.js";

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
          offset: l.offset,
          trimStart: l.trimStart,
          trimEnd: l.trimEnd,
          effects: l.effects ?? [],
          gain: l.gain.gain.value,
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

  async function restore(renderAll) {
    setLoading(true, "Restoring project");
    try {
      const project = await loadProject();
      if (!project) return;

      // master
      restoreMasterUi(dom, project.masterVol ?? 1);

      // zoom
      state.pxPerSec = Number(project.pxPerSec ?? state.pxPerSec);
      dom.zoomEl.value = String(sliderFromZoom(state.pxPerSec));
      setZoomLabel(Math.round(state.pxPerSec));

      // playhead
      state.playheadTime = Number(project.playheadTime ?? 0);
      state.playSessionStartTime = Number(project.playSessionStartTime ?? state.playheadTime);

      // layers
      ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
      state.layers = [];

      for (const item of project.layers ?? []) {
        const audio = item.audio;
        const buffer = await decodeAudio(state.ctx, audio.slice(0));
        const gain = createGainToMaster(state, Number(item.gain ?? 1));
        state.layers.push({
          id: item.id || crypto.randomUUID(),
          name: item.name,
          buffer,
          audio,
          gain,
          offset: Number(item.offset ?? 0),
          trimStart: Number(item.trimStart ?? 0),
          trimEnd: Number(item.trimEnd ?? 0),
          effects: Array.isArray(item.effects) ? item.effects : [],
        });
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

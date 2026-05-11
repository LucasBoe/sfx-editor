import { dbToGain } from "../volume.js";
import { createAudioLayer, isStarterLayer } from "../models/layers.js";
import { applyFitZoomForDuration } from "./fitZoom.js";

export function initImport({ state, dom, setLoading, ensureCtx, decodeAudio, createGainToMaster, renderAll, scheduleSave }) {
  dom.filesEl.addEventListener("change", async (e) => {
    if (state.recordState === "recording") {
      alert("Stop recording before importing audio.");
      e.target.value = "";
      return;
    }

    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setLoading(true, `Importing ${files.length} file(s)`);
    try {
      ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
      const simpleStarterProject =
        (state.layers.length === 0 || state.layers.every(isStarterLayer)) &&
        files.length === 1 &&
        state.layers.length + files.length <= 2;
      const importedLayers = [];

      for (const f of files) {
        const audio = await f.arrayBuffer();
        const buffer = await decodeAudio(state.ctx, audio.slice(0));
        const gain = createGainToMaster(state, 1);
        const layer = createAudioLayer({
          name: f.name,
          buffer,
          audio,
          gain,
        });
        state.layers.push(layer);
        importedLayers.push(layer);
      }

      if (simpleStarterProject) {
        let targetDuration = 0;
        for (const layer of importedLayers) {
          targetDuration = Math.max(targetDuration, Number(layer?.buffer?.duration) || 0);
        }
        applyFitZoomForDuration({ state, dom, durationSec: targetDuration });
      }

      renderAll();
      if (simpleStarterProject && dom.layersEl) {
        dom.layersEl.scrollLeft = 0;
      }
      scheduleSave();
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed. Try WAV first.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  });
}

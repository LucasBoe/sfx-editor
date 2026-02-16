import { dbToGain } from "../volume.js";

export function initImport({ state, dom, setLoading, ensureCtx, decodeAudio, createGainToMaster, renderAll, scheduleSave }) {
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
        state.layers.push({
          name: f.name,
          buffer,
          audio,
          gain,
          offset: 0,
          trimStart: 0,
          trimEnd: 0,
          effects: [],
        });
      }

      renderAll();
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

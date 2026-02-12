import { dbToGain, gainToDb, formatDb, parseDb, clampDb, DB_MIN } from "./volume.js";
import { setClipPosition, trackWidthPx } from "./audio.js";
import { setCanvasSize } from "./canvasFit.js";

export function renderLayersUI({ state, layersEl, drawWaveform, scheduleSave }) {
  const template = layersEl.querySelector("#layerTemplate");
  const tracksEl = layersEl.querySelector("#tracks");

  if (!template) throw new Error("Missing #layerTemplate inside #layers");
  if (!tracksEl) throw new Error("Missing #tracks inside #layers");

  tracksEl.innerHTML = "";

  const w = trackWidthPx(state);
  layersEl.style.setProperty("--timeline-width", `${w}px`);

  for (const l of state.layers) {
    const frag = template.content.cloneNode(true);

    const nameEl = frag.querySelector(".name");
    const offsetEl = frag.querySelector(".offset");
    const volEl = frag.querySelector(".vol");
    const volDbEl = frag.querySelector(".volDb");
    const clipEl = frag.querySelector(".clip");

    // NEW: tiled waveform container
    const waveEl = frag.querySelector(".wave");

    nameEl.textContent = `${l.name} (${l.buffer.duration.toFixed(2)}s)`;
    offsetEl.value = String(l.offset);

    const db = gainToDb(l.gain.gain.value);
    volEl.value = String(Number.isFinite(db) ? clampDb(db) : DB_MIN);
    volDbEl.value = formatDb(db);

    const clipW = Math.max(30, Math.ceil(l.buffer.duration * state.pxPerSec));
    clipEl.style.width = `${clipW}px`;
    setClipPosition(state, clipEl, l.offset);

    // NEW: draw waveform in tiles to avoid huge canvas blur
    if (waveEl) {
      waveEl.innerHTML = "";

      const clipH = 96; // matches .track height
      const tileMaxCssPx = 1600;

      for (let x0 = 0; x0 < clipW; x0 += tileMaxCssPx) {
        const tileW = Math.min(tileMaxCssPx, clipW - x0);

        const c = document.createElement("canvas");
        setCanvasSize(c, tileW, clipH);

        const t0 = x0 / state.pxPerSec;
        const t1 = (x0 + tileW) / state.pxPerSec;

        drawWaveform(c, l.buffer, t0, t1);
        waveEl.appendChild(c);
      }
    } else {
      // Fallback if template still has a single canvas
      const canvasEl = frag.querySelector("canvas");
      if (canvasEl) {
        const clipH = 96;
        setCanvasSize(canvasEl, clipW, clipH);
        drawWaveform(canvasEl, l.buffer);
      }
    }

    volEl.addEventListener("input", () => {
      const db = clampDb(Number(volEl.value));
      l.gain.gain.value = dbToGain(db);
      volDbEl.value = formatDb(db);
      scheduleSave();
    });

    volDbEl.addEventListener("change", () => {
      const parsed = parseDb(volDbEl.value);
      const db = Number.isFinite(parsed) ? clampDb(parsed) : -Infinity;

      volEl.value = String(Number.isFinite(db) ? db : DB_MIN);
      volDbEl.value = formatDb(db);

      l.gain.gain.value = dbToGain(db);
      scheduleSave();
    });

    offsetEl.addEventListener("input", () => {
      l.offset = Math.max(0, Number(offsetEl.value) || 0);
      setClipPosition(state, clipEl, l.offset);
      scheduleSave();
    });

    clipEl.addEventListener("pointerdown", (e) => {
      clipEl.classList.add("dragging");
      clipEl.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startOffset = l.offset;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const raw = startOffset + dx / state.pxPerSec;
        const snapped = Math.max(0, Math.round(raw * 100) / 100);
        l.offset = snapped;
        offsetEl.value = String(snapped);
        setClipPosition(state, clipEl, snapped);
      };

      const onUp = (ev) => {
        clipEl.classList.remove("dragging");
        clipEl.releasePointerCapture(ev.pointerId);
        clipEl.removeEventListener("pointermove", onMove);
        clipEl.removeEventListener("pointerup", onUp);
        clipEl.removeEventListener("pointercancel", onUp);
        scheduleSave();
      };

      clipEl.addEventListener("pointermove", onMove);
      clipEl.addEventListener("pointerup", onUp);
      clipEl.addEventListener("pointercancel", onUp);
    });

    tracksEl.appendChild(frag);
  }
}

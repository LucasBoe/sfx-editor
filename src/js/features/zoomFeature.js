import { zoomFromSlider, sliderFromZoom } from "../zoomConfig.js";
import { setZoomLabel } from "../ui.js";
import { trackStartContentPx } from "./geometryDom.js";
import { trackWidthPx } from "../models/timeline.js";

export function initZoom({ state, dom, renderAll, renderRuler, scheduleSave }) {
  // normalize slider to current zoom
  dom.zoomEl.value = String(sliderFromZoom(state.pxPerSec));
  setZoomLabel(Math.round(state.pxPerSec));

  let timer = 0;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function applyZoomLight() {
  const layersEl = dom.layersEl;

  // anchor where the playhead currently is inside the visible layers viewport
  const layersRect = layersEl.getBoundingClientRect();
  const phRect = dom.playheadEl.getBoundingClientRect();
  let anchorX = phRect.left - layersRect.left;
  anchorX = clamp(anchorX, 0, layersEl.clientWidth);

  // update zoom
  state.pxPerSec = zoomFromSlider(Number(dom.zoomEl.value));
  setZoomLabel(Math.round(state.pxPerSec));

  // IMPORTANT: update scrollWidth immediately so maxScroll is correct
  const w = trackWidthPx(state);
  layersEl.style.setProperty("--timeline-width", `${w}px`);

  // compute desired scroll
  const origin = trackStartContentPx(layersEl); // scroll invariant
  const desired = origin + state.playheadTime * state.pxPerSec - anchorX;

  // clamp to scrollable range
  const maxScroll = Math.max(0, layersEl.scrollWidth - layersEl.clientWidth);
  layersEl.scrollLeft = clamp(desired, 0, maxScroll);

  // now update playhead and ruler using the new scrollLeft
  state.onPlayheadTimeChanged?.(state.playheadTime);
  renderRuler();
}

  dom.zoomEl.addEventListener("input", () => {
    applyZoomLight();
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderAll();
      scheduleSave();
    }, 120);
  });

  dom.zoomEl.addEventListener("change", () => {
    renderAll();
    scheduleSave();
  });

  function bumpZoom(dir) {
    const step = 25;
    const cur = Number(dom.zoomEl.value) || 0;
    const next = Math.max(0, Math.min(1000, cur + dir * step));
    if (next === cur) return;

    dom.zoomEl.value = String(next);
    applyZoomLight();

    // buttons are always instant
    clearTimeout(timer);
    renderAll();
    scheduleSave();
  }

  if (dom.zoomInEl) dom.zoomInEl.addEventListener("click", () => bumpZoom(+1));
  if (dom.zoomOutEl) dom.zoomOutEl.addEventListener("click", () => bumpZoom(-1));

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

  if (dom.zoomInEl) dom.zoomInEl.addEventListener("pointerdown", () => holdZoom(+1));
  if (dom.zoomOutEl) dom.zoomOutEl.addEventListener("pointerdown", () => holdZoom(-1));
}

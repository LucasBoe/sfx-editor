import { clampZoom, sliderFromZoom } from "../zoomConfig.js";
import { setZoomLabel } from "../ui.js";
import { controlsWidthPx } from "./geometryDom.js";

const FIT_TRACK_PADDING_PX = 120;
const FIT_VIEWPORT_GUTTER_PX = 56;
const FIT_SCALE = 0.8;

export function applyFitZoomForDuration({ state, dom, durationSec, fitScale = FIT_SCALE }) {
  if (!dom?.layersEl || !dom?.zoomEl) return;

  const duration = Number(durationSec) || 0;
  if (duration <= 1e-6) return;

  const controlsW = controlsWidthPx(dom.layersEl);
  const trackViewportW = Math.max(
    240,
    dom.layersEl.clientWidth - controlsW - FIT_VIEWPORT_GUTTER_PX
  );
  const fitContentW = Math.max(60, trackViewportW - FIT_TRACK_PADDING_PX);
  const nextZoom = clampZoom((fitContentW / duration) * Math.max(0.1, Number(fitScale) || 1));

  state.pxPerSec = nextZoom;
  dom.zoomEl.value = String(sliderFromZoom(nextZoom));
  setZoomLabel(Math.round(nextZoom));
}

export const ZOOM_MIN = 50;      // px per second
export const ZOOM_MAX = 100000;   // px per second
export const ZOOM_SLIDER_MAX = 1000;

export function clampZoom(px) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, px));
}

export function zoomFromSlider(sliderValue) {
  const s = Math.min(ZOOM_SLIDER_MAX, Math.max(0, Number(sliderValue) || 0));
  const t = s / ZOOM_SLIDER_MAX; // 0..1
  const px = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t);
  return clampZoom(px);
}

export function sliderFromZoom(pxPerSec) {
  const px = clampZoom(Number(pxPerSec) || ZOOM_MIN);
  const t = Math.log(px / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
  return Math.round(t * ZOOM_SLIDER_MAX);
}
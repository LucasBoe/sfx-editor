function readCssNumber(el, name) {
  if (!el) return 0;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function controlsWidthPx(layersEl) {
  return readCssNumber(layersEl, "--controls-width");
}

// Scroll invariant content X position where the timeline actually starts
export function trackStartXWithinLayers(layersEl) {
  if (!layersEl) return 0;

  const track = layersEl.querySelector(".track");
  if (!track) return controlsWidthPx(layersEl);

  const layersRect = layersEl.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();

  // convert viewport delta to content coordinate
  return (trackRect.left - layersRect.left) + layersEl.scrollLeft;
}

export function trackStartContentPx(layersEl) {
  const track = layersEl.querySelector(".track");
  if (!track) return 0;

  const layersRect = layersEl.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();

  return (trackRect.left - layersRect.left) + layersEl.scrollLeft;
}

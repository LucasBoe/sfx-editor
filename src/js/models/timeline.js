export function clipDuration(layer) {
  const bufDur = Number(layer?.buffer?.duration) || 0;
  const a = Number(layer?.trimStart) || 0;
  const b = Number(layer?.trimEnd) || 0;
  return Math.max(0, bufDur - a - b);
}

export function projectDuration(layers) {
  const arr = Array.isArray(layers) ? layers : [];
  let max = 0;
  for (const l of arr) {
    const off = Number(l?.offset) || 0;
    max = Math.max(max, off + clipDuration(l));
  }
  return max;
}

export function trackWidthPx(stateOrLayers, pxPerSecValue) {
  const hasState =
    !!stateOrLayers &&
    !Array.isArray(stateOrLayers) &&
    typeof stateOrLayers === "object";

  const layers = hasState ? stateOrLayers.layers : stateOrLayers;
  const pxPerSec = Number(hasState ? stateOrLayers.pxPerSec : pxPerSecValue) || 0;
  const dur = projectDuration(layers);
  return Math.max(300, Math.ceil(dur * pxPerSec) + 120);
}

export function clipWidthPx(durationSec, pxPerSec, minPx = 30) {
  return Math.max(minPx, Math.ceil(durationSec * pxPerSec));
}

export function setClipPosition(clipEl, offsetSec, pxPerSec) {
  clipEl.style.left = `${offsetSec * pxPerSec}px`;
}

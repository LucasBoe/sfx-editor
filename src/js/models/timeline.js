export function projectDuration(layers) {
  const arr = Array.isArray(layers) ? layers : [];
  let max = 0;

  for (const l of arr) {
    const off = Number(l?.offset) || 0;
    const dur = Number(l?.buffer?.duration) || 0;
    max = Math.max(max, off + dur);
  }
  return max;
}

export function trackWidthPx(state) {
  const pxPerSec = Number(state?.pxPerSec) || 0;
  const dur = projectDuration(state?.layers);
  return Math.max(300, Math.ceil(dur * pxPerSec) + 120);
}

export function clipWidthPx(durationSec, pxPerSec, minPx = 30) {
  return Math.max(minPx, Math.ceil(durationSec * pxPerSec));
}

export function setClipPosition(clipEl, offsetSec, pxPerSec) {
  clipEl.style.left = `${offsetSec * pxPerSec}px`;
}

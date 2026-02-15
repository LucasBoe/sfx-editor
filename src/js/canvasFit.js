const MAX_BACKING_PX = 8192;

export function setCanvasSize(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;

  const bw = Math.min(Math.ceil(cssW * dpr), MAX_BACKING_PX);
  const bh = Math.min(Math.ceil(cssH * dpr), MAX_BACKING_PX);

  canvas.width = Math.max(1, bw);
  canvas.height = Math.max(1, bh);

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  return {
    cssW,
    cssH,
    sx: canvas.width / cssW,
    sy: canvas.height / cssH,
  };
}

function waveScaleFromGain(g) {
  const n = Number(g);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.02, Math.min(n, 8)); // clamp for usability
}

export function scaleCanvasY(canvas, gain) {
  console.log(gain);
      canvas.style.transform = `scaleY(${waveScaleFromGain(gain)})`;
}
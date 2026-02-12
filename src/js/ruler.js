function niceStep(seconds) {
  const steps = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  for (const s of steps) if (s >= seconds) return s;
  return 10;
}

function fmt(t) {
  if (t < 1) return t.toFixed(2);
  if (t < 10) return t.toFixed(2);
  return t.toFixed(1);
}

export function drawRulerViewport(canvas, pxPerSec, startTime, cssW, cssH) {
  const g = canvas.getContext("2d");

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);

  const sx = canvas.width / cssW;
  const sy = canvas.height / cssH;
  g.setTransform(sx, 0, 0, sy, 0, 0);

  g.fillStyle = "rgba(255,255,255,0.75)";
  g.strokeStyle = "rgba(255,255,255,0.25)";
  g.font = "12px system-ui, sans-serif";
  g.lineWidth = 1;

  const endTime = startTime + cssW / pxPerSec;

  const targetPx = 90;
  const major = niceStep(targetPx / pxPerSec);
  const minor = major / 5;

  const first = Math.floor(startTime / minor) * minor;

  for (let t = first; t <= endTime + 0.0001; t += minor) {
    const x = Math.round((t - startTime) * pxPerSec) + 0.5;
    const isMajor = Math.abs((t / major) - Math.round(t / major)) < 1e-6;

    g.beginPath();
    g.moveTo(x, cssH);
    g.lineTo(x, isMajor ? 6 : 14);
    g.stroke();

    if (isMajor) g.fillText(fmt(Math.max(0, t)), x + 3, 13);
  }
}
function computeMinMaxForWidth(channelData, width) {
  const len = channelData.length;
  const step = len / Math.max(1, width);

  const mins = new Float32Array(width);
  const maxs = new Float32Array(width);

  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * step);
    const end = Math.min(len, Math.floor((x + 1) * step) || start + 1);

    let mn = 1;
    let mx = -1;

    for (let i = start; i < end; i++) {
      const s = channelData[i];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }

    mins[x] = mn;
    maxs[x] = mx;
  }

  return { mins, maxs };
}

function drawFilled(g, mins, maxs, y0, h) {
  const mid = y0 + h / 2;
  const amp = h / 2;

  g.beginPath();
  g.moveTo(0, mid - maxs[0] * amp);

  for (let x = 1; x < maxs.length; x++) g.lineTo(x, mid - maxs[x] * amp);
  for (let x = mins.length - 1; x >= 0; x--) g.lineTo(x, mid - mins[x] * amp);

  g.closePath();
  g.fill();
}

export function drawWaveformFromBuffer(canvas, buffer, { stereo = false } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext("2d");

  g.clearRect(0, 0, w, h);

  if (!buffer || w <= 1 || h <= 1) return;

  g.fillStyle = "#79dfc1";
  g.strokeStyle = "rgba(0,0,0,0.2)";
  g.lineWidth = 1;

  const drawMidline = (y0, hh) => {
    g.beginPath();
    g.moveTo(0, y0 + hh / 2 + 0.5);
    g.lineTo(w, y0 + hh / 2 + 0.5);
    g.stroke();
  };

  if (stereo && buffer.numberOfChannels >= 2) {
    const top = computeMinMaxForWidth(buffer.getChannelData(0), w);
    const bottom = computeMinMaxForWidth(buffer.getChannelData(1), w);

    drawFilled(g, top.mins, top.maxs, 0, h / 2);
    drawMidline(0, h / 2);

    drawFilled(g, bottom.mins, bottom.maxs, h / 2, h / 2);
    drawMidline(h / 2, h / 2);
  } else {
    const mono = computeMinMaxForWidth(buffer.getChannelData(0), w);
    drawFilled(g, mono.mins, mono.maxs, 0, h);
    drawMidline(0, h);
  }
}

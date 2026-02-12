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

export function drawWaveformSegment(canvas, buffer, t0, t1) {
  const g = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  g.clearRect(0, 0, w, h);
  if (!buffer || w <= 1 || h <= 1) return;

  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);

  const s0 = Math.max(0, Math.floor(t0 * sr));
  const s1 = Math.min(ch0.length, Math.floor(t1 * sr));
  const span = Math.max(1, s1 - s0);

  g.fillStyle = "rgba(120, 237, 206, 0.9)";
  const mid = h / 2;
  const amp = mid;

  const step = span / w;

  for (let x = 0; x < w; x++) {
    const a = s0 + Math.floor(x * step);
    const b = Math.min(s1, s0 + Math.floor((x + 1) * step) + 1);

    let mn = 1;
    let mx = -1;
    for (let i = a; i < b; i++) {
      const s = ch0[i];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }

    const y1 = mid - mx * amp;
    const y2 = mid - mn * amp;

    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  // midline
  g.strokeStyle = addAlpha("#79dfc1", .3);
  g.lineWidth = 1;

  const y = Math.floor(h / 2) + 0.5;
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(w, y);
  g.stroke();
}

function addAlpha(color, opacity) {
    // coerce values so it is between 0 and 1.
    var _opacity = Math.round(Math.min(Math.max(opacity ?? 1, 0), 1) * 255);
    return color + _opacity.toString(16).toUpperCase();
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

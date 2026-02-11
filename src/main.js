const filesEl = document.getElementById("files");
const layersEl = document.getElementById("layers");
const playEl = document.getElementById("play");
const stopEl = document.getElementById("stop");
const renderEl = document.getElementById("render");
const masterVolEl = document.getElementById("masterVol");
const zoomEl = document.getElementById("zoom");
const zoomValEl = document.getElementById("zoomVal");
const loadingEl = document.getElementById("loading");
const loadingTextEl = document.getElementById("loadingText");

let ctx;
let masterGain;
let layers = [];
let playing = [];

let playStartAt = null;
let rafId = null;
let playheads = [];

let pxPerSec = Number(zoomEl.value);
zoomValEl.textContent = String(pxPerSec);

const clearEl = document.getElementById("clear");

const DB_NAME = "sfx-editor";
const DB_STORE = "kv";
const DB_KEY = "project";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 250);
}

async function saveProject() {
  try {
    const project = {
      masterVol: Number(masterVolEl.value),
      pxPerSec,
      layers: layers.map((l) => ({
        name: l.name,
        offset: l.offset,
        gain: l.gain.gain.value,
        audio: l.audio, // ArrayBuffer
      })),
    };
    await idbSet(DB_KEY, project);
  } catch (e) {
    console.error("Save failed:", e);
  }
}

async function restoreProject() {
  setLoading(true, "Restoring project");
  try {
    const project = await idbGet(DB_KEY);
    if (!project) return;

    masterVolEl.value = String(project.masterVol ?? 1);
    pxPerSec = Number(project.pxPerSec ?? pxPerSec);
    zoomEl.value = String(pxPerSec);
    zoomValEl.textContent = String(pxPerSec);

    ensureCtx();
    layers = [];

    for (const item of project.layers ?? []) {
      const audio = item.audio;
      const buffer = await ctx.decodeAudioData(audio.slice(0));

      const gain = ctx.createGain();
      gain.gain.value = Number(item.gain ?? 1);
      gain.connect(masterGain);

      const peaks = computePeaks(buffer);

      layers.push({
        name: item.name,
        buffer,
        audio,
        gain,
        offset: Number(item.offset ?? 0),
        peaks,
      });
    }

    renderLayersUI();
  } catch (e) {
    console.error("Restore failed:", e);
  } finally {
    setLoading(false);
  }
}

function setLoading(on, text = "Loading") {
  loadingTextEl.textContent = text;
  loadingEl.classList.toggle("hidden", !on);
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = Number(masterVolEl.value);
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

masterVolEl.addEventListener("input", () => {
  if (masterGain) {
    masterGain.gain.value = Number(masterVolEl.value);
    scheduleSave();
  }
});

zoomEl.addEventListener("input", () => {
  pxPerSec = Number(zoomEl.value);
  zoomValEl.textContent = String(pxPerSec);
  renderLayersUI();
  scheduleSave();
});

async function decodeFile(file) {
  const ab = await file.arrayBuffer();
  return await ensureCtx().decodeAudioData(ab);
}

function projectDuration() {
  let max = 0;
  for (const l of layers) max = Math.max(max, l.offset + l.buffer.duration);
  return max;
}

function computePeaks(buffer, points = 2000) {
  const data = buffer.getChannelData(0);
  const len = data.length;
  const step = Math.max(1, Math.floor(len / points));
  const mins = new Float32Array(points);
  const maxs = new Float32Array(points);

  for (let i = 0; i < points; i++) {
    const start = i * step;
    const end = Math.min(len, start + step);

    let mn = 1;
    let mx = -1;

    for (let j = start; j < end; j++) {
      const s = data[j];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
    mins[i] = mn;
    maxs[i] = mx;
  }

  return { mins, maxs, points };
}

function drawWaveform(canvas, peaks) {
  const w = canvas.width;
  const h = canvas.height;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);

  const mid = h / 2;
  g.lineWidth = 1;
  g.beginPath();

  for (let x = 0; x < w; x++) {
    const idx = Math.min(
      peaks.points - 1,
      Math.floor((x / (w - 1 || 1)) * peaks.points)
    );

    const y1 = mid + peaks.mins[idx] * mid;
    const y2 = mid + peaks.maxs[idx] * mid;

    g.moveTo(x + 0.5, y1);
    g.lineTo(x + 0.5, y2);
  }

  g.stroke();
}

function setClipPosition(clipEl, offset) {
  clipEl.style.left = `${offset * pxPerSec}px`;
}

function trackWidthPx() {
  return Math.max(700, Math.ceil(projectDuration() * pxPerSec) + 120);
}

function renderLayersUI() {
  layersEl.innerHTML = "";
  playheads = [];

  const w = trackWidthPx();
  layersEl.style.setProperty("--timeline-width", `${w}px`);

  layers.forEach((l) => {
    const layerEl = document.createElement("div");
    layerEl.className = "layer";

    const controls = document.createElement("div");
    controls.className = "layerControls";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `${l.name} (${l.buffer.duration.toFixed(2)}s)`;

    const offset = document.createElement("input");
    offset.className = "small";
    offset.type = "number";
    offset.step = "0.01";
    offset.min = "0";
    offset.value = String(l.offset);

    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "1";
    vol.step = "0.01";
    vol.value = String(l.gain.gain.value);

    controls.appendChild(name);
    controls.appendChild(offset);
    controls.appendChild(vol);

    const track = document.createElement("div");
    track.className = "track";

    const ph = document.createElement("div");
    ph.className = "playhead";
    track.appendChild(ph);
    playheads.push(ph);

    const clip = document.createElement("div");
    clip.className = "clip";

    const clipW = Math.max(30, Math.ceil(l.buffer.duration * pxPerSec));
    clip.style.width = `${clipW}px`;
    setClipPosition(clip, l.offset);

    const canvas = document.createElement("canvas");
    canvas.width = clipW;
    canvas.height = 48;
    clip.appendChild(canvas);

    if (l.peaks) drawWaveform(canvas, l.peaks);

    track.appendChild(clip);

    vol.addEventListener("input", () => {
      l.gain.gain.value = Number(vol.value);
      scheduleSave();
    });

    offset.addEventListener("input", () => {
      l.offset = Math.max(0, Number(offset.value) || 0);
      setClipPosition(clip, l.offset);
      scheduleSave();
    });


    clip.addEventListener("pointerdown", (e) => {
      clip.classList.add("dragging");
      clip.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startOffset = l.offset;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const raw = startOffset + dx / pxPerSec;
        const snapped = Math.max(0, Math.round(raw * 100) / 100);
        l.offset = snapped;
        offset.value = String(snapped);
        setClipPosition(clip, snapped);
      };

      const onUp = (ev) => {
        clip.classList.remove("dragging");
        clip.releasePointerCapture(ev.pointerId);
        clip.removeEventListener("pointermove", onMove);
        clip.removeEventListener("pointerup", onUp);
        clip.removeEventListener("pointercancel", onUp);
        scheduleSave();
      };

      clip.addEventListener("pointermove", onMove);
      clip.addEventListener("pointerup", onUp);
      clip.addEventListener("pointercancel", onUp);
    });

    layerEl.appendChild(controls);
    layerEl.appendChild(track);
    layersEl.appendChild(layerEl);
  });

  setPlayheads(currentPlayTime());
}


filesEl.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  setLoading(true, `Importing ${files.length} file(s)`);
  try {
    ensureCtx();

    for (const f of files) {
      const audio = await f.arrayBuffer();
      const buffer = await ctx.decodeAudioData(audio.slice(0));

      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(masterGain);

      const peaks = computePeaks(buffer);

      layers.push({ name: f.name, buffer, audio, gain, offset: 0, peaks });
    }

    renderLayersUI();
    scheduleSave();
  } catch (err) {
    console.error("Import failed:", err);
    alert("Import failed. Try WAV first.");
  } finally {
    setLoading(false);
    e.target.value = "";
  }
});

playEl.addEventListener("click", async () => {
  if (!layers.length) return;

  ensureCtx();
  await ctx.resume();

  stopPlayback();

  const t0 = ctx.currentTime + 0.05;
  playStartAt = t0;

  playing = layers.map((l) => {
    const src = ctx.createBufferSource();
    src.buffer = l.buffer;
    src.connect(l.gain);
    src.start(t0 + l.offset);
    return src;
  });

  const dur = projectDuration();

  const tick = () => {
    const t = currentPlayTime();
    setPlayheads(t);

    if (t >= dur + 0.02) {
      stopPlayback();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
});

stopEl.addEventListener("click", stopPlayback);

renderEl.addEventListener("click", async () => {
  if (!layers.length) return;

  const sr = ensureCtx().sampleRate;
  const dur = projectDuration();
  const length = Math.ceil(dur * sr);
  if (length <= 0) return;

  const offline = new OfflineAudioContext(2, length, sr);

  const master = offline.createGain();
  master.gain.value = Number(masterVolEl.value);
  master.connect(offline.destination);

  for (const l of layers) {
    const src = offline.createBufferSource();
    src.buffer = l.buffer;

    const g = offline.createGain();
    g.gain.value = l.gain.gain.value;

    src.connect(g);
    g.connect(master);

    src.start(l.offset);
  }

  const out = await offline.startRendering();
  const wav = audioBufferToWav(out);
  downloadBlob(wav, "mixdown.wav");
});

clearEl.addEventListener("click", async () => {
  stopPlayback();
  layers = [];
  renderLayersUI();
  await idbDel(DB_KEY);
});

function currentPlayTime() {
  if (!ctx || playStartAt === null) return 0;
  return Math.max(0, ctx.currentTime - playStartAt);
}

function setPlayheads(t) {
  const dur = projectDuration();
  const clamped = Math.max(0, Math.min(t, dur));
  const x = clamped * pxPerSec;
  for (const ph of playheads) ph.style.left = `${x}px`;
}

function stopPlayback() {
  for (const src of playing) {
    try { src.stop(); } catch {}
  }
  playing = [];
  playStartAt = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  setPlayheads(0);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = numFrames * blockAlign;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  let o = 0;
  const writeStr = (s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    o += s.length;
  };

  writeStr("RIFF");
  view.setUint32(o, 36 + dataSize, true);
  o += 4;
  writeStr("WAVE");

  writeStr("fmt ");
  view.setUint32(o, 16, true);
  o += 4;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint16(o, numCh, true);
  o += 2;
  view.setUint32(o, sr, true);
  o += 4;
  view.setUint32(o, byteRate, true);
  o += 4;
  view.setUint16(o, blockAlign, true);
  o += 2;
  view.setUint16(o, 16, true);
  o += 2;

  writeStr("data");
  view.setUint32(o, dataSize, true);
  o += 4;

  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch));

  let p = o;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = chans[ch][i];
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

restoreProject();
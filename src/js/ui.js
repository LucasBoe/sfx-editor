export const dom = {
  timelineShellEl: document.getElementById("timelineShell"),
  filesEl: document.getElementById("files"),
  layersEl: document.getElementById("layers"),
  playEl: document.getElementById("play"),
  stopEl: document.getElementById("stop"),
  renderEl: document.getElementById("render"),
  clearEl: document.getElementById("clear"),

  masterVolEl: document.getElementById("masterVol"),
  masterDbEl: document.getElementById("masterDb"),

  zoomInEl: document.getElementById("zoomIn"),
  zoomOutEl: document.getElementById("zoomOut"),
  zoomEl: document.getElementById("zoom"),
  zoomValEl: document.getElementById("zoomVal"),

  loadingEl: document.getElementById("loading"),
  loadingTextEl: document.getElementById("loadingText"),

  rulerCanvasEl: document.getElementById("rulerCanvas"),
  playheadEl: document.getElementById("globalPlayhead"),
};

export function setZoomLabel(pxPerSec) {
  dom.zoomValEl.textContent = String(pxPerSec);
}

export function setLoading(on, text = "Loading") {
  dom.loadingTextEl.textContent = text;
  dom.loadingEl.classList.toggle("hidden", !on);
}

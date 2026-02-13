function readControlsWidthPx(layersEl) {
  if (!layersEl) return 0;
  const v = getComputedStyle(layersEl).getPropertyValue("--controls-width").trim();
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function playheadOriginPx(state) {
  const shell = state.timelineShellEl;
  const layersEl = state.layersEl;
  if (!shell || !layersEl) return 0;

  const shellRect = shell.getBoundingClientRect();

  const track = layersEl.querySelector(".track");
  if (track) {
    const trackRect = track.getBoundingClientRect();
    return trackRect.left - shellRect.left;
  }

  const layersRect = layersEl.getBoundingClientRect();
  const controlsW = readControlsWidthPx(layersEl);
  return (layersRect.left - shellRect.left) + controlsW;
}

export function updatePlayheadPosition(state) {
  const origin = playheadOriginPx(state);
  const t = Number(state.playheadTime || 0);
  const x = origin + t * state.pxPerSec;
  if (state.playheadEl) state.playheadEl.style.left = `${x}px`;
  return origin;
}

export function initPlayhead(state, dom) {
  if (dom) {
    state.timelineShellEl = dom.timelineShellEl;
    state.playheadEl = dom.playheadEl;
  }

  state.onPlayheadTimeChanged = () => {
    updatePlayheadPosition(state);
  };

  updatePlayheadPosition(state);
}

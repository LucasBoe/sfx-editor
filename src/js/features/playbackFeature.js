import { dbToGain } from "../volume.js";

export function initPlayback({ state, dom, ensureCtx, startPlayback, stopPlayback }) {
  function updatePlayButton() {
    dom.playEl.innerHTML =
      state.playState === "playing"
        ? '<span class="icon-pause2"></span>'
        : '<span class="icon-play3"></span>';

    dom.stopEl.classList.toggle("is-playing", state.playState === "playing");

  }

  state.onPlaybackEnded = () => {
    state.playState = "stopped";

    const backTo = Number(state.playSessionStartTime ?? 0);
    state.setPlayheadTimeValue?.(backTo);
    updatePlayButton();
  };

  updatePlayButton();

  dom.playEl.addEventListener("click", async () => {
    ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));

    if (state.playState === "playing") {
      state.playState = "paused";
      stopPlayback(state);
      updatePlayButton();
      return;
    }

    if (state.playState === "stopped") {
      state.playSessionStartTime = state.playheadTime;
    }

    state.playState = "playing";
    await startPlayback(state);
    updatePlayButton();
  });

  dom.stopEl.addEventListener("click", () => {
    stopPlayback(state);
    state.setPlayheadTimeValue(state.playSessionStartTime);
    state.playState = "stopped";
    updatePlayButton();
  });

  return { updatePlayButton };
}

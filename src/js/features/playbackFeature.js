import { dbToGain } from "../volume.js";

export function initPlayback({ state, dom, ensureCtx, startPlayback, stopPlayback }) {
  function updatePlayButton() {
    const recording = state.recordState === "recording";
    dom.playEl.innerHTML =
      state.playState === "playing"
        ? '<span class="icon-pause2"></span>'
        : '<span class="icon-play3"></span>';

    dom.playEl.classList.toggle("active", state.playState !== "playing" && !recording);
    dom.stopEl.classList.toggle("active", state.playState === "playing" || recording);
    dom.playEl.disabled = recording;
    dom.playEl.setAttribute("aria-disabled", recording ? "true" : "false");
  }

  state.onPlaybackEnded = () => {
    state.playState = "stopped";

    const backTo = Number(state.playSessionStartTime ?? 0);
    state.setPlayheadTimeValue?.(backTo);
    updatePlayButton();
  };

  updatePlayButton();

  async function togglePlayback() {
    if (state.recordState === "recording") return;

    if (state.playState === "playing") {
      state.playState = "paused";
      stopPlayback(state);
      updatePlayButton();
      return;
    }

    if (!state.layers?.length) {
      state.playState = "stopped";
      updatePlayButton();
      return;
    }

    ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));

    if (state.playState === "stopped") {
      state.playSessionStartTime = state.playheadTime;
    }

    state.playState = "playing";
    await startPlayback(state);
    if (state.playStartAt === null) {
      state.playState = "stopped";
    }
    updatePlayButton();
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
      )
    );
  }

  function isHandledByFocusedControl(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, a[href], summary, [role="button"]'));
  }

  dom.playEl.addEventListener("click", async () => {
    await togglePlayback();
  });

  document.addEventListener("keydown", (e) => {
    const isSpace = e.code === "Space" || e.key === " ";
    if (!isSpace || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.defaultPrevented) return;
    if (isTypingTarget(e.target) || isHandledByFocusedControl(e.target)) return;

    e.preventDefault();
    void togglePlayback();
  });

  async function stopAndReset() {
    if (state.recordState === "recording") {
      await state.stopRecording?.();
      updatePlayButton();
      return;
    }

    stopPlayback(state);
    state.setPlayheadTimeValue(state.playSessionStartTime);
    state.playState = "stopped";
    updatePlayButton();
  }

  dom.stopEl.addEventListener("click", () => {
    void stopAndReset();
  });

  document.addEventListener("keydown", (e) => {
    const isEnter = e.code === "Enter" || e.key === "Enter";
    if (!isEnter || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;

    e.preventDefault();
    if (state.recordState === "recording" || state.playState === "playing") {
      void stopAndReset();
    } else {
      state.setPlayheadTimeValue?.(state.playSessionStartTime ?? state.playheadTime);
      state.playState = "stopped";
      void togglePlayback();
    }
  });

  return { updatePlayButton };
}

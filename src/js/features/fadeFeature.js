import {
  clipFadeSourceDurations,
  clipSourceDuration,
  layerPlaybackRate,
  normalizeLayerFades,
} from "../models/timeline.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function createFadeFeature({ state, scheduleSave, requestRender }) {
  const MIN_BODY_SOURCE_DUR = 0.01;

  function maybeRestartPlayback() {
    if (state.playState !== "playing") return;
    const now = performance.now();
    if (!state._fadeRestartAt || now - state._fadeRestartAt > 80) {
      state._fadeRestartAt = now;
      state.stopPlayback?.();
      state.startPlayback?.();
    }
  }

  function attachFade({ layer, leftHandle, rightHandle, redrawClip }) {
    if (!leftHandle || !rightHandle) return;

    leftHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      leftHandle.setPointerCapture(e.pointerId);

      normalizeLayerFades(layer);

      const startX = e.clientX;
      const startFade = clipFadeSourceDurations(layer).fadeIn;
      const otherFade = clipFadeSourceDurations(layer).fadeOut;
      const rate = layerPlaybackRate(layer);
      const srcDur = clipSourceDuration(layer);
      const maxFade = Math.max(0, srcDur - otherFade - MIN_BODY_SOURCE_DUR);

      const onMove = (ev) => {
        const dtTimeline = (ev.clientX - startX) / state.pxPerSec;
        layer.fadeIn = clamp(startFade + dtTimeline * rate, 0, maxFade);
        redrawClip();
        scheduleSave?.();
        maybeRestartPlayback();
      };

      const onUp = (ev) => {
        leftHandle.releasePointerCapture(ev.pointerId);
        leftHandle.removeEventListener("pointermove", onMove);
        leftHandle.removeEventListener("pointerup", onUp);
        leftHandle.removeEventListener("pointercancel", onUp);
        scheduleSave?.();
        requestRender?.();
      };

      leftHandle.addEventListener("pointermove", onMove);
      leftHandle.addEventListener("pointerup", onUp);
      leftHandle.addEventListener("pointercancel", onUp);
    });

    rightHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      rightHandle.setPointerCapture(e.pointerId);

      normalizeLayerFades(layer);

      const startX = e.clientX;
      const startFade = clipFadeSourceDurations(layer).fadeOut;
      const otherFade = clipFadeSourceDurations(layer).fadeIn;
      const rate = layerPlaybackRate(layer);
      const srcDur = clipSourceDuration(layer);
      const maxFade = Math.max(0, srcDur - otherFade - MIN_BODY_SOURCE_DUR);

      const onMove = (ev) => {
        const dtTimeline = (ev.clientX - startX) / state.pxPerSec;
        layer.fadeOut = clamp(startFade - dtTimeline * rate, 0, maxFade);
        redrawClip();
        scheduleSave?.();
        maybeRestartPlayback();
      };

      const onUp = (ev) => {
        rightHandle.releasePointerCapture(ev.pointerId);
        rightHandle.removeEventListener("pointermove", onMove);
        rightHandle.removeEventListener("pointerup", onUp);
        rightHandle.removeEventListener("pointercancel", onUp);
        scheduleSave?.();
        requestRender?.();
      };

      rightHandle.addEventListener("pointermove", onMove);
      rightHandle.addEventListener("pointerup", onUp);
      rightHandle.addEventListener("pointercancel", onUp);
    });
  }

  return { attachFade };
}

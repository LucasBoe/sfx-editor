import {
  clipEndTime,
  clipStartTime,
  collectCrossTrackSnapPoints,
  layerPlaybackRate,
  snapTimeToPoints,
} from "../models/timeline.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function createTrimFeature({ state, scheduleSave, requestRender }) {
  const MIN_DUR = 0.01;

  function attachTrim({ layer, leftHandle, rightHandle, redrawClip }) {
    if (!leftHandle || !rightHandle) return;

    leftHandle.addEventListener("pointerdown", (e) => {

      if (!state.tools?.trim) return;

      e.stopPropagation();
      leftHandle.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startOffset = Number(layer.offset) || 0;
      const startTrim = Number(layer.trimStart) || 0;
      const trimEnd = Number(layer.trimEnd) || 0;
      const bufDur = Number(layer.buffer?.duration) || 0;
      const rate = layerPlaybackRate(layer);
      const fixedEnd = clipEndTime(layer);
      const snapPoints = collectCrossTrackSnapPoints(state.layers, layer);

      const onMove = (ev) => {
        let dtTimeline = (ev.clientX - startX) / state.pxPerSec;

        const maxTrimStart = Math.max(0, bufDur - trimEnd - MIN_DUR);
        const minDtTimeline = Math.max(-startOffset, -startTrim / rate);
        const maxDtTimeline = (maxTrimStart - startTrim) / rate;
        dtTimeline = clamp(dtTimeline, minDtTimeline, maxDtTimeline);

        let nextOffset = startOffset + dtTimeline;
        if (state.tools?.snap !== false) {
          const snappedStart = snapTimeToPoints(nextOffset, snapPoints, state.pxPerSec);
          nextOffset = clamp(snappedStart, 0, fixedEnd - MIN_DUR / rate);
          dtTimeline = nextOffset - startOffset;
        }

        layer.offset = nextOffset;
        layer.trimStart = startTrim + dtTimeline * rate;

        redrawClip();
      };

      const onUp = (ev) => {
        leftHandle.releasePointerCapture(ev.pointerId);
        leftHandle.removeEventListener("pointermove", onMove);
        leftHandle.removeEventListener("pointerup", onUp);
        leftHandle.removeEventListener("pointercancel", onUp);
        scheduleSave();
        requestRender?.();
      };

      leftHandle.addEventListener("pointermove", onMove);
      leftHandle.addEventListener("pointerup", onUp);
      leftHandle.addEventListener("pointercancel", onUp);
    });

    rightHandle.addEventListener("pointerdown", (e) => {
      if (!state.tools?.trim) return;

      e.stopPropagation();
      rightHandle.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startTrimEnd = Number(layer.trimEnd) || 0;
      const trimStart = Number(layer.trimStart) || 0;
      const bufDur = Number(layer.buffer?.duration) || 0;
      const rate = layerPlaybackRate(layer);
      const fixedStart = clipStartTime(layer);
      const snapPoints = collectCrossTrackSnapPoints(state.layers, layer);

      const onMove = (ev) => {
        const dtTimeline = (ev.clientX - startX) / state.pxPerSec;

        const maxTrimEnd = Math.max(0, bufDur - trimStart - MIN_DUR);
        let nextTrimEnd = clamp(startTrimEnd - dtTimeline * rate, 0, maxTrimEnd);

        if (state.tools?.snap !== false) {
          const rawRightEdge = fixedStart + (bufDur - trimStart - nextTrimEnd) / rate;
          const snappedRightEdge = snapTimeToPoints(rawRightEdge, snapPoints, state.pxPerSec);
          const snappedTimelineDur = Math.max(MIN_DUR / rate, snappedRightEdge - fixedStart);
          nextTrimEnd = clamp(
            bufDur - trimStart - snappedTimelineDur * rate,
            0,
            maxTrimEnd
          );
        }

        layer.trimEnd = nextTrimEnd;

        redrawClip();
      };

      const onUp = (ev) => {
        rightHandle.releasePointerCapture(ev.pointerId);
        rightHandle.removeEventListener("pointermove", onMove);
        rightHandle.removeEventListener("pointerup", onUp);
        rightHandle.removeEventListener("pointercancel", onUp);
        scheduleSave();
        requestRender?.();
      };

      rightHandle.addEventListener("pointermove", onMove);
      rightHandle.addEventListener("pointerup", onUp);
      rightHandle.addEventListener("pointercancel", onUp);
    });
  }

  return { attachTrim };
}

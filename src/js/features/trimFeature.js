function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function createTrimFeature({ state, scheduleSave }) {
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

      const onMove = (ev) => {
        let dt = (ev.clientX - startX) / state.pxPerSec;

        const maxTrimStart = Math.max(0, bufDur - trimEnd - MIN_DUR);
        dt = clamp(dt, -startTrim, maxTrimStart - startTrim);
        dt = Math.max(dt, -startOffset);

        layer.offset = startOffset + dt;
        layer.trimStart = startTrim + dt;

        redrawClip();
      };

      const onUp = (ev) => {
        leftHandle.releasePointerCapture(ev.pointerId);
        leftHandle.removeEventListener("pointermove", onMove);
        leftHandle.removeEventListener("pointerup", onUp);
        leftHandle.removeEventListener("pointercancel", onUp);
        scheduleSave();
      };

      leftHandle.addEventListener("pointermove", onMove);
      leftHandle.addEventListener("pointerup", onUp);
      leftHandle.addEventListener("pointercancel", onUp);
    });

    rightHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      rightHandle.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startTrimEnd = Number(layer.trimEnd) || 0;
      const trimStart = Number(layer.trimStart) || 0;
      const bufDur = Number(layer.buffer?.duration) || 0;

      const onMove = (ev) => {
        const dt = (ev.clientX - startX) / state.pxPerSec;

        const maxTrimEnd = Math.max(0, bufDur - trimStart - MIN_DUR);
        const nextTrimEnd = clamp(startTrimEnd - dt, 0, maxTrimEnd);

        layer.trimEnd = nextTrimEnd;

        redrawClip();
      };

      const onUp = (ev) => {
        rightHandle.releasePointerCapture(ev.pointerId);
        rightHandle.removeEventListener("pointermove", onMove);
        rightHandle.removeEventListener("pointerup", onUp);
        rightHandle.removeEventListener("pointercancel", onUp);
        scheduleSave();
      };

      rightHandle.addEventListener("pointermove", onMove);
      rightHandle.addEventListener("pointerup", onUp);
      rightHandle.addEventListener("pointercancel", onUp);
    });
  }

  return { attachTrim };
}
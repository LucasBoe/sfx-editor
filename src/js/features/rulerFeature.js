import { setCanvasSize } from "../canvasFit.js";
import { drawRulerViewport } from "../ruler.js";
import { trackStartContentPx } from "./geometryDom.js";

export function createRulerFeature({ state, dom }) {
  function xOffsetPx() {
    const layersRect = dom.layersEl.getBoundingClientRect();
    const rulerRect = dom.rulerCanvasEl.getBoundingClientRect();
    return (layersRect.left - rulerRect.left) + trackStartContentPx(dom.layersEl);
  }

  function renderRuler() {
    const rulerH = 28;
    const cssW = Math.round(dom.rulerCanvasEl.parentElement.clientWidth);
    const startTime = dom.layersEl.scrollLeft / state.pxPerSec;

    setCanvasSize(dom.rulerCanvasEl, cssW, rulerH);
    drawRulerViewport(dom.rulerCanvasEl, state.pxPerSec, startTime, cssW, rulerH, xOffsetPx());
  }

  function rulerTimeFromEvent(ev) {
    const rect = dom.rulerCanvasEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const t = (dom.layersEl.scrollLeft + x - xOffsetPx()) / state.pxPerSec;
    return Math.max(0, t);
  }

  function initRulerScrub({ seekToTime, scheduleSave }) {
    dom.rulerCanvasEl.addEventListener("pointerdown", (e) => {
      dom.rulerCanvasEl.setPointerCapture(e.pointerId);

      const wasPlaying = state.playStartAt !== null;
      let lastRestartMs = 0;

      const apply = (ev, doRestart) => {
        const t = rulerTimeFromEvent(ev);
        seekToTime(t, doRestart);
      };

      apply(e, true);

      const onMove = (ev) => {
        const t = rulerTimeFromEvent(ev);
        state.setPlayheadTimeValue?.(t);
        scheduleSave?.();

        if (wasPlaying) {
          const now = performance.now();
          if (now - lastRestartMs > 100) {
            lastRestartMs = now;
            seekToTime(t, true);
          }
        }
      };

      const onUp = (ev) => {
        dom.rulerCanvasEl.releasePointerCapture(ev.pointerId);
        dom.rulerCanvasEl.removeEventListener("pointermove", onMove);
        dom.rulerCanvasEl.removeEventListener("pointerup", onUp);
        dom.rulerCanvasEl.removeEventListener("pointercancel", onUp);

        if (wasPlaying) {
          const t = rulerTimeFromEvent(ev);
          seekToTime(t, true);
        }
      };

      dom.rulerCanvasEl.addEventListener("pointermove", onMove);
      dom.rulerCanvasEl.addEventListener("pointerup", onUp);
      dom.rulerCanvasEl.addEventListener("pointercancel", onUp);
    });
  }

  return { renderRuler, rulerTimeFromEvent, initRulerScrub };
}
export function initScroll({ state, dom, renderRuler, updatePlayheadPosition }) {
  // prevent browser swipe navigation when doing horizontal trackpad scroll
  dom.layersEl.addEventListener(
    "wheel",
    (e) => {
      const dx = e.deltaX;
      const dy = e.deltaY;

      const horizontalIntent = Math.abs(dx) > Math.abs(dy) || e.shiftKey;
      if (!horizontalIntent) return;

      const move = e.shiftKey ? dy : dx;
      dom.layersEl.scrollLeft += move;
      e.preventDefault();
    },
    { passive: false }
  );

  let raf = 0;
  dom.layersEl.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderRuler();
      updatePlayheadPosition(state);
    });
  });
}

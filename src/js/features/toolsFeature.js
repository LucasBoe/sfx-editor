export function initTools({ state, dom, requestRender }) {
  state.tools ||= { move: true, trim: true, keys: true };

  function apply() {
    document.body.dataset.toolMove = state.tools.move ? "1" : "0";
    document.body.dataset.toolTrim = state.tools.trim ? "1" : "0";
    document.body.dataset.toolKeys = state.tools.keys ? "1" : "0";

    setBtn(dom.toolMoveEl, state.tools.move);
    setBtn(dom.toolTrimEl, state.tools.trim);
    setBtn(dom.toolKeysEl, state.tools.keys);
  }

  function setBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function toggle(name) {
    state.tools[name] = !state.tools[name];
    apply();
    requestRender?.();
  }

  dom.toolMoveEl?.addEventListener("click", () => toggle("move"));
  dom.toolTrimEl?.addEventListener("click", () => toggle("trim"));
  dom.toolKeysEl?.addEventListener("click", () => toggle("keys"));

  apply();
}
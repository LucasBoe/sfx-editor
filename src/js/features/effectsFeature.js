import { EFFECT_DEFS, createEffect, ensureEffects } from "../models/effects.js";
import { ensureDefaultCurve } from "../models/automation.js";

function labelFor(type) {
  return EFFECT_DEFS.find((d) => d.type === type)?.label ?? type;
}

function isActive(state, layer, fx) {
  const a = state.activeFx;
  return !!a && a.layerId === layer.id && a.fxId === fx.id;
}

function getTpl(id) {
  const t = document.getElementById(id);
  if (!t) throw new Error(`Missing template #${id}`);
  return t;
}

const menuItemTpl = () => getTpl("fxMenuItemTemplate");
const blockTpl = () => getTpl("fxBlockTemplate");

export function createEffectsFeature({ state, scheduleSave, requestRender }) {
  function render({ layer, menuEl, listEl }) {
    ensureEffects(layer);

    // menu
    menuEl.innerHTML = "";
    for (const def of EFFECT_DEFS) {
      const frag = menuItemTpl().content.cloneNode(true);
      const item = frag.querySelector(".fxMenuItem");
      item.textContent = def.label;

      item.addEventListener("click", () => {
        const fx = createEffect(def.type);
        fx.enabled = true;

        const dur = Number(layer.buffer?.duration) || 0;
        fx.automation ||= {};
        fx.automation.freq = ensureDefaultCurve(fx.automation.freq, dur / 2, fx.params.freq);

        layer.effects.push(fx);
        state.activeFx = { layerId: layer.id, fxId: fx.id, param: "freq" };

        scheduleSave?.();
        requestRender?.();
      });

      menuEl.appendChild(frag);
    }

    // blocks
    listEl.innerHTML = "";
    for (const fx of layer.effects) {
      const frag = blockTpl().content.cloneNode(true);

      const block = frag.querySelector(".fxBlock");
      const title = frag.querySelector(".fxTitle");
      const enabled = frag.querySelector(".fxEnabled");
      const remove = frag.querySelector(".fxRemove");
      const sw = frag.querySelector(".fxSwitch");
      const swSlider = frag.querySelector(".fxSlider");

      title.textContent = labelFor(fx.type);

      block.classList.toggle("active", isActive(state, layer, fx));
      block.classList.toggle("disabled", fx.enabled === false);

      enabled.checked = fx.enabled !== false;

      // selecting effect
      block.addEventListener("click", () => {
        state.activeFx = { layerId: layer.id, fxId: fx.id, param: "freq" };
        requestRender?.();
      });

      block.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          block.click();
        }
      });

      // make switch clickable without selecting effect
      const stop = (e) => e.stopPropagation();
      sw.addEventListener("pointerdown", stop);
      sw.addEventListener("click", stop);
      swSlider.addEventListener("pointerdown", stop);
      swSlider.addEventListener("click", stop);
      enabled.addEventListener("click", stop);

      enabled.addEventListener("change", (e) => {
        e.stopPropagation();
        fx.enabled = enabled.checked;
        scheduleSave?.();
        requestRender?.();
      });

      // remove with same trash icon as layer delete
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const idx = layer.effects.indexOf(fx);
        if (idx >= 0) layer.effects.splice(idx, 1);

        const a = state.activeFx;
        if (a && a.layerId === layer.id && a.fxId === fx.id) state.activeFx = null;

        scheduleSave?.();
        requestRender?.();
      });

      listEl.appendChild(frag);
    }
  }

  return { render };
}
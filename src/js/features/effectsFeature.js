import {
  EFFECT_DEFS,
  UNIQUE_EFFECT_TYPES,
  createEffect,
  effectColor,
  effectHue,
  ensureEffects,
  getEffectDef,
} from "../models/effects.js";
import { ensureDefaultCurve } from "../models/automation.js";
import {
  PITCH_MAX_SEMITONES,
  PITCH_MIN_SEMITONES,
  clampPitchSemitones,
} from "../models/timeline.js";

function labelFor(type) {
  return getEffectDef(type)?.label ?? type;
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

function applyFxTheme(el, type) {
  if (!el) return;
  const hue = effectHue(type);
  el.style.setProperty("--fx-hue", String(hue));
  el.style.setProperty("--fx-accent", effectColor(type, 88, 67, 0.96));
  el.style.setProperty("--fx-border", effectColor(type, 88, 67, 0.86));
  el.style.setProperty("--fx-surface", effectColor(type, 78, 58, 0.12));
  el.style.setProperty("--fx-surface-strong", effectColor(type, 82, 60, 0.24));
  el.style.setProperty("--fx-glow", effectColor(type, 88, 67, 0.42));
}

export function createEffectsFeature({ state, scheduleSave, requestRender }) {
  function activeParamForFx(fx) {
    return fx.type === "pitch" ? null : "freq";
  }

  function maybeRestartPlayback() {
    if (state.playState !== "playing") return;
    const now = performance.now();
    if (!state._fxRestartAt || now - state._fxRestartAt > 80) {
      state._fxRestartAt = now;
      state.stopPlayback?.();
      state.startPlayback?.();
    }
  }

  function renderPitchControls({ fx, bodyEl }) {
    if (!bodyEl) return;

    const row = document.createElement("div");
    row.className = "fxPitchRow";

    const slider = document.createElement("input");
    slider.className = "fxPitchSlider form-range range-custom";
    slider.type = "range";
    slider.min = String(PITCH_MIN_SEMITONES);
    slider.max = String(PITCH_MAX_SEMITONES);
    slider.step = "0.1";
    slider.value = String(clampPitchSemitones(fx.params?.semitones));

    const value = document.createElement("input");
    value.className = "fxPitchValue";
    value.type = "text";
    value.value = clampPitchSemitones(fx.params?.semitones).toFixed(1);

    const suffix = document.createElement("span");
    suffix.className = "fxPitchSuffix";
    suffix.textContent = "st";

    const stop = (e) => e.stopPropagation();
    slider.addEventListener("pointerdown", stop);
    slider.addEventListener("click", stop);
    value.addEventListener("pointerdown", stop);
    value.addEventListener("click", stop);

    slider.addEventListener("input", () => {
      fx.params.semitones = clampPitchSemitones(Number(slider.value));
      value.value = clampPitchSemitones(fx.params.semitones).toFixed(1);
      maybeRestartPlayback();
      scheduleSave?.();
    });

    slider.addEventListener("change", () => {
      requestRender?.();
    });

    value.addEventListener("change", () => {
      const parsed = Number(String(value.value).trim().replace(",", "."));
      fx.params.semitones = clampPitchSemitones(Number.isFinite(parsed) ? parsed : 0);
      slider.value = String(fx.params.semitones);
      value.value = clampPitchSemitones(fx.params.semitones).toFixed(1);
      maybeRestartPlayback();
      scheduleSave?.();
      requestRender?.();
    });

    row.appendChild(slider);
    row.appendChild(value);
    row.appendChild(suffix);
    bodyEl.appendChild(row);
  }

  function render({ layer, menuEl, listEl }) {
    ensureEffects(layer);

    // menu
    menuEl.innerHTML = "";
    for (const def of EFFECT_DEFS) {
      const frag = menuItemTpl().content.cloneNode(true);
      const item = frag.querySelector(".fxMenuItem");
      item.textContent = def.label;
      applyFxTheme(item, def.type);
      item.style.color = effectColor(def.type, 88, 70, 0.96);
      item.style.borderLeft = `3px solid ${effectColor(def.type, 88, 67, 0.92)}`;
      item.style.paddingLeft = "0.75rem";

      item.addEventListener("click", () => {
        let fx = null;
        if (UNIQUE_EFFECT_TYPES.has(def.type)) {
          fx = layer.effects.find((candidate) => candidate.type === def.type) ?? null;
          if (fx) fx.enabled = true;
        }

        if (!fx) {
          fx = createEffect(def.type);
          fx.enabled = true;

          if (fx.type !== "pitch") {
            const dur = Number(layer.buffer?.duration) || 0;
            fx.automation ||= {};
            fx.automation.freq = ensureDefaultCurve(fx.automation.freq, dur / 2, fx.params.freq);
          }

          layer.effects.push(fx);
        }

        state.activeFx = { layerId: layer.id, fxId: fx.id, param: activeParamForFx(fx) };

        maybeRestartPlayback();
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
      const body = frag.querySelector(".fxBody");
      const enabled = frag.querySelector(".fxEnabled");
      const remove = frag.querySelector(".fxRemove");
      const sw = frag.querySelector(".fxSwitch");
      const swSlider = frag.querySelector(".fxSlider");

      title.textContent = labelFor(fx.type);
      applyFxTheme(block, fx.type);
      block.classList.toggle("pitchFx", fx.type === "pitch");

      block.classList.toggle("active", isActive(state, layer, fx));
      block.classList.toggle("disabled", fx.enabled === false);

      enabled.checked = fx.enabled !== false;

      // selecting effect
      block.addEventListener("click", () => {
        state.activeFx = { layerId: layer.id, fxId: fx.id, param: activeParamForFx(fx) };
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
        maybeRestartPlayback();
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

        maybeRestartPlayback();
        scheduleSave?.();
        requestRender?.();
      });

      if (fx.type === "pitch") {
        renderPitchControls({ fx, bodyEl: body });
      }

      listEl.appendChild(frag);
    }
  }

  return { render };
}

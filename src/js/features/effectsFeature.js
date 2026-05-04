import {
  EFFECT_DEFS,
  UNIQUE_EFFECT_TYPES,
  createEffect,
  clampEffectVolumeDb,
  effectColor,
  effectHue,
  effectPrimaryParam,
  ensureEffectAutomation,
  ensureEffects,
  getEffectDef,
  setEffectBaseValue,
} from "../models/effects.js";
import {
  PITCH_MAX_SEMITONES,
  PITCH_MIN_SEMITONES,
  clampPitchSemitones,
} from "../models/timeline.js";
import { DB_MIN, DB_MAX, clampDb, formatDb, parseDb } from "../volume.js";

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

function formatSignedValue(value, decimals = 1) {
  const n = Number(value) || 0;
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}`;
}

function formatDbDisplay(db) {
  const text = formatDb(db);
  if (text === "-inf") return text;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? `+${text}` : text;
}

export function createEffectsFeature({ state, scheduleSave, requestRender }) {
  function activeParamForFx(fx) {
    return effectPrimaryParam(fx);
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

  function createValueGroup({ inputClass, inputValue, suffixText }) {
    const wrap = document.createElement("div");
    wrap.className = "fxValueGroup";

    const input = document.createElement("input");
    input.className = inputClass;
    input.type = "text";
    input.value = inputValue;
    syncValueInputSize(input);
    input.addEventListener("input", () => syncValueInputSize(input));

    const suffix = document.createElement("span");
    suffix.className = "fxValueSuffix";
    suffix.textContent = suffixText;

    wrap.appendChild(input);
    wrap.appendChild(suffix);
    return { wrap, input };
  }

  function syncValueInputSize(input) {
    if (!input) return;
    const len = String(input.value ?? "").trim().length || 1;
    input.size = Math.max(1, Math.ceil(len * 0.6));
  }

  function renderPitchControls({ fx, bodyEl, valueSlotEl }) {
    if (!bodyEl || !valueSlotEl) return;

    const slider = document.createElement("input");
    slider.className = "fxPitchSlider form-range range-custom";
    slider.type = "range";
    slider.min = String(PITCH_MIN_SEMITONES);
    slider.max = String(PITCH_MAX_SEMITONES);
    slider.step = "0.1";
    slider.value = String(clampPitchSemitones(fx.params?.semitones));

    const { wrap, input: value } = createValueGroup({
      inputClass: "fxPitchValue fxValueInput",
      inputValue: formatSignedValue(clampPitchSemitones(fx.params?.semitones)),
      suffixText: "st",
    });

    const stop = (e) => e.stopPropagation();
    slider.addEventListener("pointerdown", stop);
    slider.addEventListener("click", stop);
    wrap.addEventListener("pointerdown", stop);
    wrap.addEventListener("click", stop);
    value.addEventListener("pointerdown", stop);
    value.addEventListener("click", stop);

    slider.addEventListener("input", () => {
      fx.params.semitones = clampPitchSemitones(Number(slider.value));
      value.value = formatSignedValue(clampPitchSemitones(fx.params.semitones));
      syncValueInputSize(value);
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
      value.value = formatSignedValue(clampPitchSemitones(fx.params.semitones));
      syncValueInputSize(value);
      maybeRestartPlayback();
      scheduleSave?.();
      requestRender?.();
    });

    valueSlotEl.appendChild(wrap);
    bodyEl.appendChild(slider);
  }

  function shiftAutomationValues(fx, param, delta, clampValue) {
    if (!fx?.automation?.[param] || !Number.isFinite(delta) || Math.abs(delta) <= 1e-9) return;
    for (const key of fx.automation[param]) {
      key.v = clampValue(key.v + delta);
    }
  }

  function renderVolumeControls({ fx, bodyEl, valueSlotEl }) {
    if (!bodyEl || !valueSlotEl) return;

    const slider = document.createElement("input");
    slider.className = "fxParamSlider form-range range-custom";
    slider.type = "range";
    slider.min = String(DB_MIN);
    slider.max = String(DB_MAX);
    slider.step = "0.1";
    slider.value = String(clampEffectVolumeDb(fx.params?.db));

    const { wrap, input: value } = createValueGroup({
      inputClass: "fxParamValue fxValueInput",
      inputValue: formatDbDisplay(clampEffectVolumeDb(fx.params?.db)),
      suffixText: "dB",
    });

    const stop = (e) => e.stopPropagation();
    slider.addEventListener("pointerdown", stop);
    slider.addEventListener("click", stop);
    wrap.addEventListener("pointerdown", stop);
    wrap.addEventListener("click", stop);
    value.addEventListener("pointerdown", stop);
    value.addEventListener("click", stop);

    function applyVolume(nextDb) {
      const prevDb = clampEffectVolumeDb(fx.params?.db);
      const clamped = setEffectBaseValue(fx, nextDb);
      const delta = clamped - prevDb;
      shiftAutomationValues(fx, "db", delta, clampDb);

      slider.value = String(clamped);
      value.value = formatDbDisplay(clamped);
      syncValueInputSize(value);
    }

    slider.addEventListener("input", () => {
      applyVolume(Number(slider.value));
      maybeRestartPlayback();
      scheduleSave?.();
    });

    slider.addEventListener("change", () => {
      requestRender?.();
    });

    value.addEventListener("change", () => {
      const parsed = parseDb(value.value);
      applyVolume(Number.isFinite(parsed) ? parsed : DB_MIN);
      maybeRestartPlayback();
      scheduleSave?.();
      requestRender?.();
    });

    valueSlotEl.appendChild(wrap);
    bodyEl.appendChild(slider);
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

          if (effectPrimaryParam(fx)) {
            ensureEffectAutomation(
              fx,
              Number(layer.buffer?.duration) || 0
            );
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
      const valueSlot = frag.querySelector(".fxValueSlot");
      const enabled = frag.querySelector(".fxEnabled");
      const remove = frag.querySelector(".fxRemove");
      const sw = frag.querySelector(".fxSwitch");
      const swSlider = frag.querySelector(".fxSlider");

      title.textContent = labelFor(fx.type);
      applyFxTheme(block, fx.type);
      block.classList.toggle("pitchFx", fx.type === "pitch");
      block.classList.toggle("paramFx", fx.type === "pitch" || fx.type === "volume");

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
        renderPitchControls({ fx, bodyEl: body, valueSlotEl: valueSlot });
      }

      if (fx.type === "volume") {
        renderVolumeControls({ fx, bodyEl: body, valueSlotEl: valueSlot });
      }

      listEl.appendChild(frag);
    }
  }

  return { render };
}

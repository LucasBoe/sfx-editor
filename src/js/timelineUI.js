import {
  dbToGain,
  gainToDb,
  formatDb,
  parseDb,
  clampDb,
  DB_MIN,
  DB_MAX,
} from "./volume.js";
import { setCanvasSize, scaleCanvasY } from "./canvasFit.js";
import {
  setClipPosition,
  trackWidthPx,
  clipDuration,
  clipSourceDuration,
  collectCrossTrackSnapPoints,
  layerPlaybackRate,
  snapTimeToPoints,
} from "./models/timeline.js";
import {
  colorFromHue,
  effectBaseValue,
  effectColor,
  effectPrimaryParam,
  ensureEffectAutomation,
  layerEffectTheme,
  setEffectBaseValue,
} from "./models/effects.js";
import { createTrimFeature } from "./features/trimFeature.js";
import { createEffectsFeature } from "./features/effectsFeature.js";
import { sampleCurve } from "./models/automation.js";

function fmtSec(s) {
  const n = Number(s) || 0;
  if (n <= 0) return "";
  return n < 1 ? `${n.toFixed(2)}s` : `${n.toFixed(1)}s`;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function applyLayerTint(layerEl, layer) {
  if (!layerEl) return;

  const theme = layerEffectTheme(layer);
  layerEl.style.setProperty("--layer-effect-hue", String(theme.hue.toFixed(1)));
  layerEl.style.setProperty(
    "--layer-effect-outline",
    colorFromHue(theme.hue, 90, 68, theme.count ? 0.96 : 0.88)
  );
  layerEl.style.setProperty(
    "--layer-effect-line",
    colorFromHue(theme.hue, 76, 62, theme.count ? 0.32 : 0.18)
  );
  layerEl.style.setProperty(
    "--layer-effect-tint",
    colorFromHue(theme.hue, 78, 60, theme.tintAlpha)
  );
  layerEl.style.setProperty(
    "--layer-effect-tint-strong",
    colorFromHue(theme.hue, 82, 62, theme.tintStrongAlpha)
  );
  layerEl.style.setProperty(
    "--layer-effect-rack",
    colorFromHue(theme.hue, 72, 54, theme.rackAlpha)
  );
  layerEl.style.setProperty(
    "--layer-effect-wash",
    colorFromHue(theme.hue, 76, 60, theme.washAlpha)
  );
  layerEl.style.setProperty(
    "--layer-effect-glow",
    colorFromHue(theme.hue, 90, 68, theme.count ? 0.28 : 0.16)
  );
  layerEl.dataset.hasEffects = theme.count > 0 ? "1" : "0";
}

function mapFreqToY(freq, h) {
  const min = 20;
  const max = 20000;
  const f = Math.max(min, Math.min(max, Number(freq) || min));

  const a = Math.log(min);
  const b = Math.log(max);
  const t = (Math.log(f) - a) / (b - a);

  return (1 - t) * (h - 10) + 5;
}

function mapDbToY(db, h) {
  const t = (clampDb(Number(db) || 0) - DB_MIN) / Math.max(1e-9, DB_MAX - DB_MIN);
  return (1 - t) * (h - 10) + 5;
}

function isActiveFx(state, layer, fx, param) {
  const a = state.activeFx;
  return !!a && a.layerId === layer.id && a.fxId === fx.id && a.param === param;
}

function freqToY(freq, h) {
  const min = 20, max = 20000;
  const f = Math.max(min, Math.min(max, Number(freq) || min));
  const a = Math.log(min), b = Math.log(max);
  const t = (Math.log(f) - a) / (b - a);
  return (1 - t) * (h - 10) + 5;
}

function yToFreq(y, h) {
  const min = 20, max = 20000;
  const a = Math.log(min), b = Math.log(max);
  const t = 1 - Math.max(0, Math.min(1, (y - 5) / Math.max(1e-9, (h - 10))));
  return Math.exp(a + t * (b - a));
}

function yToDb(y, h) {
  const t = 1 - Math.max(0, Math.min(1, (y - 5) / Math.max(1e-9, (h - 10))));
  return clampDb(DB_MIN + t * (DB_MAX - DB_MIN));
}

function mapAutomationValueToY(param, value, h) {
  if (param === "freq") return mapFreqToY(value, h);
  if (param === "db") return mapDbToY(value, h);
  return h / 2;
}

function yToAutomationValue(param, y, h) {
  if (param === "freq") return yToFreq(y, h);
  if (param === "db") return yToDb(y, h);
  return 0;
}

function automationStateForFx(fx, layer) {
  const param = effectPrimaryParam(fx);
  if (!param) return null;

  const automation = ensureEffectAutomation(
    fx,
    Number(layer.buffer?.duration) || 0
  );
  if (!automation) return null;

  return {
    param,
    baseValue: effectBaseValue(fx),
    keys: automation.keys,
  };
}

function setConstantCurvePath(pathEl, clipW, y) {
  if (!pathEl) return;
  const yy = Number(y) || 0;
  pathEl.setAttribute("d", `M 0 ${yy} L ${clipW} ${yy}`);
}

function drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave, requestRender) {
  if (!svgEl) return;

  const ns = "http://www.w3.org/2000/svg";
  const rate = layerPlaybackRate(layer);

  const s0 = Number(layer.trimStart) || 0;
  const srcDur = clipSourceDuration(layer);
  const s1 = s0 + srcDur;

  const maybeRestartPlayback = () => {
    if (state.playState !== "playing") return;
    const now = performance.now();
    if (!state._fxRestartAt || now - state._fxRestartAt > 80) {
      state._fxRestartAt = now;
      state.stopPlayback?.();
      state.startPlayback?.();
    }
  };

  svgEl.setAttribute("viewBox", `0 0 ${clipW} ${clipH}`);
  svgEl.innerHTML = "";

  // bind dblclick once per svg instance, not inside key loop
  if (!svgEl._autoBound) {
    svgEl._autoBound = true;

    svgEl.addEventListener("dblclick", (ev) => {
      
      if (state.tools?.keys === false) return;

      ev.preventDefault();
      ev.stopPropagation();

      const a = state.activeFx;
      if (!a || a.layerId !== layer.id || !a.param) return;

      const fx = (layer.effects || []).find((x) => x.id === a.fxId);
      if (!fx) return;

      const auto = automationStateForFx(fx, layer);
      if (!auto || auto.param !== a.param) return;

      const rect = svgEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(clipW, ev.clientX - rect.left));
      const y = Math.max(0, Math.min(clipH, ev.clientY - rect.top));

      const s = (Number(layer.trimStart) || 0) + (x / state.pxPerSec) * rate;
      const v = yToAutomationValue(auto.param, y, clipH);

      fx.automation ||= {};
      fx.automation[auto.param] ||= [];
      fx.automation[auto.param].push({ s, v });
      fx.automation[auto.param].sort((p, q) => (p.s ?? 0) - (q.s ?? 0));

      scheduleSave?.();
      drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave, requestRender);
    });
  }

  const effects = layer.effects || [];
  for (const fx of effects) {
    const auto = automationStateForFx(fx, layer);
    if (!auto) continue;

    const keys = auto.keys;
    const allowKeys = state.tools?.keys !== false;
    const active = allowKeys && isActiveFx(state, layer, fx, auto.param);

    const samples = Math.max(32, Math.min(400, Math.floor(clipW / 6)));
    const curve = sampleCurve(keys, s0, s1, samples, auto.baseValue);

    let d = "";
    for (let i = 0; i < samples; i++) {
      const u = samples === 1 ? 0 : i / (samples - 1);
      const x = u * clipW;
      const y = mapAutomationValueToY(auto.param, curve[i], clipH);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", active ? "autoCurve active" : "autoCurve");
    path.style.setProperty(
      "--auto-curve-color",
      effectColor(fx.type, 88, active ? 68 : 64, active ? 0.92 : 0.6)
    );
    const isConstant = keys.length === 0;
    if (isConstant) path.classList.add("constant");
    svgEl.appendChild(path);

    if (active && isConstant) {
      path.style.pointerEvents = "stroke";
      path.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const rect = svgEl.getBoundingClientRect();
        const y0 = mapAutomationValueToY(auto.param, effectBaseValue(fx), clipH);
        setConstantCurvePath(path, clipW, y0);

        const onMove = (mv) => {
          const y = Math.max(0, Math.min(clipH, mv.clientY - rect.top));
          const nextValue = yToAutomationValue(auto.param, y, clipH);
          setEffectBaseValue(fx, nextValue);

          setConstantCurvePath(path, clipW, y);
          scheduleSave?.();
          maybeRestartPlayback();
        };

        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          scheduleSave?.();
          requestRender?.();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    }

    for (const k of keys) {
      const ks = Number(k.s) || 0;
      if (ks < s0 || ks > s1) continue;

      const x = ((ks - s0) / rate) * state.pxPerSec;
      const y = mapAutomationValueToY(auto.param, k.v, clipH);

      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(y));
      c.setAttribute("r", String(active ? 4 : 3));
      c.setAttribute("class", active ? "autoKey active" : "autoKey");
      c.style.setProperty(
        "--auto-key-color",
        effectColor(fx.type, 88, 66, active ? 0.98 : 0.4)
      );
      svgEl.appendChild(c);

      if (!active) continue;

      c.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation(); // critical: prevents clip drag handler
        c.setPointerCapture(ev.pointerId);

        const rect = svgEl.getBoundingClientRect();

        const onMove = (mv) => {
          const x = Math.max(0, Math.min(clipW, mv.clientX - rect.left));
          const y = Math.max(0, Math.min(clipH, mv.clientY - rect.top));

          const nextS = (Number(layer.trimStart) || 0) + (x / state.pxPerSec) * rate;
          const maxS = Number(layer.buffer?.duration) || nextS;

          k.s = Math.max(0, Math.min(maxS, nextS));
          k.v = yToAutomationValue(auto.param, y, clipH);

          // apply audio feedback while dragging
          scheduleSave?.();

          maybeRestartPlayback();

          keys.sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
          drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave, requestRender);
        };

        const onUp = (up) => {
          c.releasePointerCapture(up.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          scheduleSave?.();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    }
  }
}

export function renderLayersUI({ state, layersEl, drawWaveform, scheduleSave, requestRender }) {
  const template = layersEl.querySelector("#layerTemplate");
  const tracksEl = layersEl.querySelector("#tracks");

  if (!template) throw new Error("Missing #layerTemplate inside #layers");
  if (!tracksEl) throw new Error("Missing #tracks inside #layers");

  tracksEl.innerHTML = "";

  const w = trackWidthPx(state);
  layersEl.style.setProperty("--timeline-width", `${w}px`);

  const trim = createTrimFeature({ state, scheduleSave, requestRender });
  const fx = createEffectsFeature({ state, scheduleSave, requestRender });


  for (const l of state.layers) {
    const frag = template.content.cloneNode(true);

    const layerEl = frag.querySelector(".layer");
    const nameEl = frag.querySelector(".name");
    const offsetEl = frag.querySelector(".offset");
    const volEl = frag.querySelector(".vol");
    const volDbEl = frag.querySelector(".volDb");
    const clipEl = frag.querySelector(".clip");
    const delEl = frag.querySelector(".del");
    const canvasWrapperEl = frag.querySelector(".canvas-wrapper");
    const autoSvgEl = frag.querySelector(".autoSvg");

    const trimInEl = frag.querySelector(".trimInfo.left");
    const trimOutEl = frag.querySelector(".trimInfo.right");

    const fxMenuEl = frag.querySelector(".fxMenu");
    const fxListEl = frag.querySelector(".fxList");



    if (!fxMenuEl || !fxListEl) {
      throw new Error("Missing .fxMenu or .fxList in #layerTemplate");
    }

    fx.render({ layer: l, menuEl: fxMenuEl, listEl: fxListEl });
    applyLayerTint(layerEl, l);
    offsetEl.value = String(l.offset);

    const db = gainToDb(l.gain.gain.value);
    volEl.value = String(Number.isFinite(db) ? clampDb(db) : DB_MIN);
    volDbEl.value = formatDb(db);

    const leftHandle = frag.querySelector(".trimHandle.left");
    const rightHandle = frag.querySelector(".trimHandle.right");

    function redrawClip() {
      const rate = layerPlaybackRate(l);
      const srcDur = clipSourceDuration(l);
      const dur = clipDuration(l);
      const clipW = Math.max(30, Math.ceil(dur * state.pxPerSec));

      nameEl.textContent = `${l.name} (${dur.toFixed(2)}s)`;
      offsetEl.value = String(l.offset);
      clipEl.style.width = `${clipW}px`;
      setClipPosition(clipEl, l.offset, state.pxPerSec);

      if (!canvasWrapperEl) return;

      canvasWrapperEl.innerHTML = "";
      const clipH = 96;
      const tileMaxCssPx = 1600;

      for (let x0 = 0; x0 < clipW; x0 += tileMaxCssPx) {
        const tileW = Math.min(tileMaxCssPx, clipW - x0);
        const c = document.createElement("canvas");
        setCanvasSize(c, tileW, clipH);
        
        const trimStart = Number(l.trimStart) || 0;
        const t0 = trimStart + (x0 / state.pxPerSec) * rate;
        const t1 = Math.min(
          trimStart + srcDur,
          trimStart + ((x0 + tileW) / state.pxPerSec) * rate
        );
        
        drawWaveform(c, l.buffer, t0, t1);
        canvasWrapperEl.appendChild(c);
      }

      scaleCanvasY(canvasWrapperEl, l.gain.gain.value);
      drawFxAutomationOverlay(autoSvgEl, l, state, clipW, clipH, scheduleSave, requestRender);

      const trimOn = state.tools?.trim !== false;
      if (leftHandle) leftHandle.style.display = trimOn ? "" : "none";
      if (rightHandle) rightHandle.style.display = trimOn ? "" : "none";

      const inSec = (Number(l.trimStart) || 0) / rate;
      const outSec = (Number(l.trimEnd) || 0) / rate;

      clipEl.classList.toggle("hasTrimStart", inSec > 0);
      clipEl.classList.toggle("hasTrimEnd", outSec > 0);

      if (trimInEl) {
        const t = fmtSec(inSec);
        trimInEl.textContent = t ? `- ${t}` : "";
        trimInEl.style.display = t ? "block" : "none";
      }

      if (trimOutEl) {
        const t = fmtSec(outSec);
        trimOutEl.textContent = t ? `+ ${t}` : "";
        trimOutEl.style.display = t ? "block" : "none";
      }

    }

    trim.attachTrim({
      layer: l,
      leftHandle,
      rightHandle,
      redrawClip,
    });

    redrawClip();

    /*
    if (waveContainerEl) {
      waveContainerEl.innerHTML = "";

      const clipH = 96;
      const tileMaxCssPx = 1600;

      for (let x0 = 0; x0 < clipW; x0 += tileMaxCssPx) {
        const tileW = Math.min(tileMaxCssPx, clipW - x0);

        const c = document.createElement("canvas");
        setCanvasSize(c, tileW, clipH);

        const t0 = x0 / state.pxPerSec;
        const t1 = (x0 + tileW) / state.pxPerSec;

        drawWaveform(c, l.buffer, t0, t1);
        waveContainerEl.appendChild(c);
      }
    } else {
      const canvasEl = frag.querySelector("canvas");
      if (canvasEl) {
        const clipH = 96;
        setCanvasSize(canvasEl, clipW, clipH);
        drawWaveform(canvasEl, l.buffer, 0, l.buffer.duration);
      }
    }
    
    */

    volEl.addEventListener("input", () => {
      const db = clampDb(Number(volEl.value));
      l.gain.gain.value = dbToGain(db);
      volDbEl.value = formatDb(db);
      scaleCanvasY(canvasWrapperEl, l.gain.gain.value);
      scheduleSave();
    });

    volDbEl.addEventListener("change", () => {
      const parsed = parseDb(volDbEl.value);
      const db = Number.isFinite(parsed) ? clampDb(parsed) : -Infinity;

      volEl.value = String(Number.isFinite(db) ? db : DB_MIN);
      volDbEl.value = formatDb(db);

      l.gain.gain.value = dbToGain(db);
      scaleCanvasY(canvasWrapperEl, l.gain.gain.value);
      scheduleSave();
    });

    offsetEl.addEventListener("input", () => {
      l.offset = Math.max(0, Number(offsetEl.value) || 0);
      setClipPosition(clipEl, l.offset, state.pxPerSec);
      scheduleSave();
    });

    clipEl.addEventListener("pointerdown", (e) => {

      if (!state.tools?.move) return;
      if (e.target?.closest?.(".trimHandle")) return;
      if (e.target?.closest?.(".autoSvg")) return;

      clipEl.classList.add("dragging");
      clipEl.setPointerCapture(e.pointerId);

      const startX = e.clientX;
      const startOffset = l.offset;
      const dur = clipDuration(l);
      const snapPoints = collectCrossTrackSnapPoints(state.layers, l);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const raw = startOffset + dx / state.pxPerSec;
        let nextOffset = Math.max(0, raw);

        if (state.tools?.snap !== false) {
          const snapCandidates = [];
          for (const point of snapPoints) {
            snapCandidates.push(point);
            snapCandidates.push(point - dur);
          }
          nextOffset = Math.max(
            0,
            snapTimeToPoints(nextOffset, snapCandidates, state.pxPerSec)
          );
        } else {
          nextOffset = Math.round(nextOffset * 100) / 100;
        }

        l.offset = nextOffset;
        offsetEl.value = String(nextOffset);
        setClipPosition(clipEl, nextOffset, state.pxPerSec);
      };

      const onUp = (ev) => {
        clipEl.classList.remove("dragging");
        clipEl.releasePointerCapture(ev.pointerId);
        clipEl.removeEventListener("pointermove", onMove);
        clipEl.removeEventListener("pointerup", onUp);
        clipEl.removeEventListener("pointercancel", onUp);
        scheduleSave();
        requestRender?.();
      };

      clipEl.addEventListener("pointermove", onMove);
      clipEl.addEventListener("pointerup", onUp);
      clipEl.addEventListener("pointercancel", onUp);
    });

    if (delEl) {
      delEl.addEventListener("click", () => {
        const idx = state.layers.indexOf(l);
        if (idx >= 0) state.layers.splice(idx, 1);
        scheduleSave();
        if (typeof requestRender === "function") requestRender();
      });
    }

    tracksEl.appendChild(frag);
  }
}

import { dbToGain, gainToDb, formatDb, parseDb, clampDb, DB_MIN } from "./volume.js";
import { setCanvasSize, scaleCanvasY } from "./canvasFit.js";
import { setClipPosition, trackWidthPx, clipDuration } from "./models/timeline.js";
import { createTrimFeature } from "./features/trimFeature.js";
import { createEffectsFeature } from "./features/effectsFeature.js";
import { sampleCurve, ensureDefaultCurve } from "./models/automation.js";

function fmtSec(s) {
  const n = Number(s) || 0;
  if (n <= 0) return "";
  return n < 1 ? `${n.toFixed(2)}s` : `${n.toFixed(1)}s`;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
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

function drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave) {
  if (!svgEl) return;

  const ns = "http://www.w3.org/2000/svg";

  const s0 = Number(layer.trimStart) || 0;
  const dur = clipDuration(layer);
  const s1 = s0 + dur;

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
      if (!a || a.layerId !== layer.id || a.param !== "freq") return;

      const fx = (layer.effects || []).find((x) => x.id === a.fxId);
      if (!fx) return;

      const rect = svgEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(clipW, ev.clientX - rect.left));
      const y = Math.max(0, Math.min(clipH, ev.clientY - rect.top));

      const s = (Number(layer.trimStart) || 0) + x / state.pxPerSec;
      const v = yToFreq(y, clipH);

      fx.automation ||= {};
      fx.automation.freq ||= [];
      fx.automation.freq.push({ s, v });
      fx.automation.freq.sort((p, q) => (p.s ?? 0) - (q.s ?? 0));

      scheduleSave?.();
      drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave);
    });
  }

  const effects = layer.effects || [];
  for (const fx of effects) {
    if (fx.type !== "lowpass" && fx.type !== "highpass") continue;

    const baseFreq = Number(fx.params?.freq) || (fx.type === "highpass" ? 80 : 12000);

    fx.automation ||= {};
    fx.automation.freq = ensureDefaultCurve(
      fx.automation.freq,
      (Number(layer.buffer?.duration) || 0) / 2,
      baseFreq
    );

    const keys = fx.automation.freq;
    const allowKeys = state.tools?.keys !== false;
    const active = allowKeys && isActiveFx(state, layer, fx, "freq");

    const samples = Math.max(32, Math.min(400, Math.floor(clipW / 6)));
    const curve = sampleCurve(keys, s0, s1, samples, baseFreq);

    let d = "";
    for (let i = 0; i < samples; i++) {
      const u = samples === 1 ? 0 : i / (samples - 1);
      const x = u * clipW;
      const y = mapFreqToY(curve[i], clipH);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", active ? "autoCurve active" : "autoCurve");
    svgEl.appendChild(path);

    for (const k of keys) {
      const ks = Number(k.s) || 0;
      if (ks < s0 || ks > s1) continue;

      const x = (ks - s0) * state.pxPerSec;
      const y = mapFreqToY(k.v, clipH);

      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(y));
      c.setAttribute("r", String(active ? 4 : 3));
      c.setAttribute("class", active ? "autoKey active" : "autoKey");
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

          const nextS = (Number(layer.trimStart) || 0) + x / state.pxPerSec;
          const maxS = Number(layer.buffer?.duration) || nextS;

          k.s = Math.max(0, Math.min(maxS, nextS));
          k.v = yToFreq(y, clipH);

          // apply audio feedback while dragging
          scheduleSave?.();

          if (state.playState === "playing") {
            const now = performance.now();
            if (!state._fxRestartAt || now - state._fxRestartAt > 80) {
              state._fxRestartAt = now;

              // restart from current playhead to reapply automation
              state.stopPlayback?.();
              state.startPlayback?.();
            }
          }

          keys.sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
          drawFxAutomationOverlay(svgEl, layer, state, clipW, clipH, scheduleSave);
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

  const w = trackWidthPx(state.layers, state.pxPerSec);
  layersEl.style.setProperty("--timeline-width", `${w}px`);

  const trim = createTrimFeature({ state, scheduleSave });
  const fx = createEffectsFeature({ state, scheduleSave, requestRender });


  for (const l of state.layers) {
    const frag = template.content.cloneNode(true);

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
    console.log("fx menu items", fxMenuEl.children.length);

    nameEl.textContent = `${l.name} (${l.buffer.duration.toFixed(2)}s)`;
    offsetEl.value = String(l.offset);

    const db = gainToDb(l.gain.gain.value);
    volEl.value = String(Number.isFinite(db) ? clampDb(db) : DB_MIN);
    volDbEl.value = formatDb(db);

    const leftHandle = frag.querySelector(".trimHandle.left");
    const rightHandle = frag.querySelector(".trimHandle.right");

    function redrawClip() {
      const dur = clipDuration(l);
      const clipW = Math.max(30, Math.ceil(dur * state.pxPerSec));

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
        const t0 = trimStart + x0 / state.pxPerSec;
        const t1 = trimStart + (x0 + tileW) / state.pxPerSec;
        
        drawWaveform(c, l.buffer, t0, t1);
        canvasWrapperEl.appendChild(c);
      }

      scaleCanvasY(canvasWrapperEl, l.gain.gain.value);
      drawFxAutomationOverlay(autoSvgEl, l, state, clipW, clipH);

      const trimOn = state.tools?.trim !== false;
      if (leftHandle) leftHandle.style.display = trimOn ? "" : "none";
      if (rightHandle) rightHandle.style.display = trimOn ? "" : "none";

      const inSec = Number(l.trimStart) || 0;
      const outSec = Number(l.trimEnd) || 0;

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

    redrawClip()

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

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const raw = startOffset + dx / state.pxPerSec;
        const snapped = Math.max(0, Math.round(raw * 100) / 100);
        l.offset = snapped;
        offsetEl.value = String(snapped);
        setClipPosition(clipEl, snapped, state.pxPerSec);
      };

      const onUp = (ev) => {
        clipEl.classList.remove("dragging");
        clipEl.releasePointerCapture(ev.pointerId);
        clipEl.removeEventListener("pointermove", onMove);
        clipEl.removeEventListener("pointerup", onUp);
        clipEl.removeEventListener("pointercancel", onUp);
        scheduleSave();
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

function dbFromAmp(a) {
  if (!Number.isFinite(a) || a <= 0) return -Infinity;
  return 20 * Math.log10(a);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function pctFromDb(db, minDb, maxDb) {
  const d = clamp(db, minDb, maxDb);
  return (d - minDb) / (maxDb - minDb);
}

export function createGlobalMeterFeature({ state, dom, minDb = -60, maxDb = 12 }) {
  let peakHoldDb = -Infinity;
  let clipHold = false;

  function reset() {
    peakHoldDb = -Infinity;
    clipHold = false;
    dom.globalMeterClipEl.style.opacity = "0";
    dom.globalMeterEl.classList.remove("clipHold");
  }

  function update() {
    const a = state.masterAnalyser;
    const buf = state._meterBuf;
    if (!a || !buf) return;

    a.getFloatTimeDomainData(buf);

    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }

    if (peak > 1) clipHold = true;

    const nowDb = dbFromAmp(peak);
    peakHoldDb = Math.max(peakHoldDb, nowDb);

    const pNow = pctFromDb(nowDb, minDb, maxDb);
    const pHold = pctFromDb(peakHoldDb, minDb, maxDb);

    dom.globalMeterFillEl.style.width = `${(pNow * 100).toFixed(2)}%`;
    dom.globalMeterPeakEl.style.left = `${(pHold * 100).toFixed(2)}%`;

    dom.globalMeterEl.classList.toggle("clipHold", clipHold);
    dom.globalMeterClipEl.style.opacity = clipHold ? "1" : "0";
  }

  function onStop() {
    dom.globalMeterFillEl.style.width = "0%";
  }

  dom.globalMeterEl.addEventListener("click", reset);

  return { update, onStop, reset };
}
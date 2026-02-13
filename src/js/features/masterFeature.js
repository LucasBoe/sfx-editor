import { dbToGain, gainToDb, formatDb, parseDb, clampDb, DB_MIN } from "../volume.js";

export function initMaster({ state, dom, scheduleSave }) {
  function setUi(db) {
    const clamped = Number.isFinite(db) ? clampDb(db) : -Infinity;

    dom.masterVolEl.value = String(Number.isFinite(clamped) ? clamped : DB_MIN);
    dom.masterDbEl.value = formatDb(clamped);

    if (state.masterGain) state.masterGain.gain.value = dbToGain(clamped);
  }

  // ensure initial textbox matches slider
  setUi(Number(dom.masterVolEl.value));

  dom.masterVolEl.addEventListener("input", () => {
    setUi(Number(dom.masterVolEl.value));
    scheduleSave();
  });

  dom.masterDbEl.addEventListener("change", () => {
    const parsed = parseDb(dom.masterDbEl.value);
    setUi(parsed);
    scheduleSave();
  });
}

export function restoreMasterUi(dom, masterGainValue) {
  const masterDb = gainToDb(masterGainValue ?? 1);
  dom.masterVolEl.value = String(Number.isFinite(masterDb) ? clampDb(masterDb) : DB_MIN);
  dom.masterDbEl.value = formatDb(masterDb);
}

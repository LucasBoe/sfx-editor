import { dbToGain } from "../volume.js";
import { audioBufferToWavArrayBuffer } from "../wav.js";
import { createAudioLayer, isStarterLayer } from "../models/layers.js";
import { trackWidthPx } from "../models/timeline.js";
import { controlsWidthPx } from "./geometryDom.js";
import { applyFitZoomForDuration } from "./fitZoom.js";

function disconnectNode(node) {
  try {
    node?.disconnect?.();
  } catch {}
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function pad(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${pad(mins)}:${pad(secs)}`;
}

function createRecordingName(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-") + ` ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  return `Recording ${stamp}.wav`;
}

function mergeChannelChunks(chunks, totalFrames) {
  const out = new Float32Array(totalFrames);
  let offset = 0;

  for (const chunk of chunks || []) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function buildRecordedBuffer(ctx, recording) {
  const totalFrames = Math.max(0, Number(recording?.totalFrames) || 0);
  const channelCount = Math.max(1, Number(recording?.channelCount) || 1);
  const sampleRate = Math.max(1, Number(recording?.sampleRate) || ctx.sampleRate || 44100);
  const buffer = ctx.createBuffer(channelCount, totalFrames, sampleRate);

  for (let ch = 0; ch < channelCount; ch++) {
    const chunks = recording.channelChunks[ch] || recording.channelChunks[0] || [];
    buffer.copyToChannel(mergeChannelChunks(chunks, totalFrames), ch);
  }

  return buffer;
}

function updateTimelineDuringRecording(state, dom, renderRuler, updatePlayheadPosition) {
  dom.layersEl.style.setProperty("--timeline-width", `${trackWidthPx(state)}px`);
  updatePlayheadPosition(state);
  renderRuler?.();
}

function keepPlayheadInView(state, dom) {
  const layersEl = dom.layersEl;
  if (!layersEl) return;

  const viewportW = Math.max(160, layersEl.clientWidth - controlsWidthPx(layersEl) - 24);
  const cursorX = Math.max(0, Number(state.playheadTime) || 0) * state.pxPerSec;
  const viewRight = layersEl.scrollLeft + viewportW;

  if (cursorX > viewRight - 56) {
    layersEl.scrollLeft = Math.max(0, cursorX - viewportW + 56);
  }
}

function setRecordStatus(dom, text, mode = "idle") {
  if (!dom.recordStatusEl || !dom.recordStatusTextEl) return;

  dom.recordStatusTextEl.textContent = text;
  dom.recordStatusEl.dataset.mode = mode;
  dom.recordStatusEl.classList.toggle("is-recording", mode === "recording");
  dom.recordStatusEl.classList.toggle("is-pending", mode === "pending");
  dom.recordStatusEl.classList.toggle("is-error", mode === "error");
}

export function initRecord({
  state,
  dom,
  ensureCtx,
  createGainToMaster,
  renderAll,
  scheduleSave,
  renderRuler,
  updatePlayheadPosition,
  updatePlaybackUi,
}) {
  state.recordState = "idle";
  state.recording = null;
  setRecordStatus(dom, "Mic ready");

  function updateRecordButton() {
    const recording = state.recordState === "recording";
    if (dom.recordEl) {
      dom.recordEl.classList.toggle("active", recording);
      dom.recordEl.setAttribute("aria-pressed", recording ? "true" : "false");
      dom.recordEl.title = recording ? "Stop recording" : "Start recording";
    }
    if (dom.filesEl) dom.filesEl.disabled = recording;
    if (dom.renderEl) dom.renderEl.disabled = recording;
    if (dom.clearEl) dom.clearEl.disabled = recording;
  }

  function cleanupRecordingNodes(recording) {
    if (!recording) return;
    if (recording.processor) recording.processor.onaudioprocess = null;
    disconnectNode(recording.source);
    disconnectNode(recording.analyser);
    disconnectNode(recording.processor);
    disconnectNode(recording.silent);
    stopStream(recording.stream);
  }

  function startRecordingTick() {
    const tick = () => {
      const recording = state.recording;
      if (!recording || state.recordState !== "recording" || !state.ctx) return;

      const elapsed = Math.max(0, state.ctx.currentTime - recording.startedAt);
      const currentTime = recording.timelineStart + elapsed;

      recording.previewLayer.previewDuration = elapsed;
      state.playheadMaxTime = currentTime;
      state.setPlayheadTimeValue?.(currentTime);
      setRecordStatus(dom, `REC ${formatDuration(elapsed)}`, "recording");
      recording.redrawPreview?.();
      updateTimelineDuringRecording(state, dom, renderRuler, updatePlayheadPosition);
      keepPlayheadInView(state, dom);
      state.onMeterFrame?.();

      recording.rafId = requestAnimationFrame(tick);
    };

    tick();
  }

  async function startRecording() {
    if (state.recordState === "recording") return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordStatus(dom, "Mic unsupported", "error");
      alert("This browser does not support microphone recording.");
      return;
    }

    if (state.playState === "playing") {
      state.stopPlayback?.();
      state.playState = "stopped";
    }

    ensureCtx(state, dbToGain(Number(dom.masterVolEl.value)));
    await state.ctx.resume();

    state.playSessionStartTime = Number(state.playheadTime) || 0;
    state.onMeterReset?.();
    setRecordStatus(dom, "Enable mic", "pending");

    let stream;
    let source;
    let analyser;
    let processor;
    let silent;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      source = state.ctx.createMediaStreamSource(stream);
      analyser = state.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;

      processor = state.ctx.createScriptProcessor(4096, 2, 2);
      silent = state.ctx.createGain();
      silent.gain.value = 0;

      const recording = {
        stream,
        source,
        analyser,
        processor,
        silent,
        timelineStart: Number(state.playheadTime) || 0,
        startedAt: state.ctx.currentTime,
        startedWallClockAt: new Date(),
        sampleRate: state.ctx.sampleRate,
        channelCount: 0,
        totalFrames: 0,
        channelChunks: [],
        rafId: 0,
        redrawPreview: null,
        shouldFitZoom:
          (state.layers.length === 0 || state.layers.every(isStarterLayer)) &&
          (Number(state.playheadTime) || 0) <= 1e-6,
      };

      recording.previewLayer = {
        id: `recording-preview-${Date.now()}`,
        name: "Recording...",
        offset: recording.timelineStart,
        previewDuration: 0,
        trimStart: 0,
        trimEnd: 0,
        fadeIn: 0,
        fadeOut: 0,
        effects: [],
        muted: false,
        gain: { gain: { value: 1 } },
        isRecordingPlaceholder: true,
      };

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const nextChannelCount = Math.max(1, Math.min(2, input.numberOfChannels || 1));

        if (recording.channelCount !== nextChannelCount) {
          recording.channelCount = nextChannelCount;
          while (recording.channelChunks.length < nextChannelCount) {
            recording.channelChunks.push([]);
          }
        }

        for (let ch = 0; ch < recording.channelCount; ch++) {
          const data = new Float32Array(input.getChannelData(ch));
          recording.channelChunks[ch].push(data);
        }

        recording.totalFrames += input.length;
      };

      source.connect(analyser);
      analyser.connect(silent);
      source.connect(processor);
      processor.connect(silent);
      silent.connect(state.ctx.destination);

      state.meterAnalyser = analyser;
      state.meterBuf = new Float32Array(analyser.fftSize);
      state.recordState = "recording";
      state.recording = recording;
      state.playheadMaxTime = recording.timelineStart;

      renderAll();
      updateRecordButton();
      updatePlaybackUi?.();
      startRecordingTick();
    } catch (error) {
      cleanupRecordingNodes({ stream, source, analyser, processor, silent });
      state.recordState = "idle";
      state.recording = null;
      state.meterAnalyser = null;
      state.meterBuf = null;
      state.playheadMaxTime = null;
      updateRecordButton();
      updatePlaybackUi?.();

      const blocked = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      setRecordStatus(dom, blocked ? "Mic blocked" : "Mic unavailable", "error");
      alert(blocked ? "Microphone access was blocked." : "Recording could not start.");
      console.error("Recording failed to start:", error);
    }
  }

  async function stopRecording() {
    const recording = state.recording;
    if (!recording || state.recordState !== "recording") return false;

    if (recording.rafId) cancelAnimationFrame(recording.rafId);
    cleanupRecordingNodes(recording);

    state.recordState = "idle";
    state.recording = null;
    state.meterAnalyser = null;
    state.meterBuf = null;

    const duration = recording.totalFrames > 0 ? recording.totalFrames / recording.sampleRate : 0;
    const endTime = recording.timelineStart + duration;

    state.playheadMaxTime = endTime;
    state.setPlayheadTimeValue?.(endTime);
    state.onMeterStop?.();

    updateRecordButton();
    updatePlaybackUi?.();

    if (duration <= 1e-4 || recording.channelCount <= 0) {
      state.playheadMaxTime = null;
      renderAll();
      setRecordStatus(dom, "Mic ready");
      return false;
    }

    const buffer = buildRecordedBuffer(state.ctx, recording);
    const audio = audioBufferToWavArrayBuffer(buffer);
    const gain = createGainToMaster(state, 1);

    state.layers.push(createAudioLayer({
      name: createRecordingName(recording.startedWallClockAt),
      buffer,
      audio,
      gain,
      offset: recording.timelineStart,
    }));

    state.playheadMaxTime = null;

    if (recording.shouldFitZoom) {
      applyFitZoomForDuration({
        state,
        dom,
        durationSec: Math.max(Number(buffer.duration) || 0, endTime),
      });
    }

    renderAll();
    keepPlayheadInView(state, dom);
    scheduleSave?.();
    setRecordStatus(dom, "Mic ready");
    return true;
  }

  async function toggleRecording() {
    if (state.recordState === "recording") {
      await stopRecording();
      return;
    }

    await startRecording();
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
      )
    );
  }

  dom.recordEl?.addEventListener("click", () => {
    void toggleRecording();
  });

  document.addEventListener("keydown", (event) => {
    const isRecordKey = event.code === "KeyR" || event.key === "r" || event.key === "R";
    if (!isRecordKey || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.defaultPrevented || isTypingTarget(event.target)) return;

    event.preventDefault();
    void toggleRecording();
  });

  state.startRecording = startRecording;
  state.stopRecording = stopRecording;

  updateRecordButton();
  return { startRecording, stopRecording };
}

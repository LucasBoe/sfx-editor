export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sr * blockAlign;
  const dataSize = numFrames * blockAlign;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  let o = 0;
  const writeStr = (s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    o += s.length;
  };

  writeStr("RIFF");
  view.setUint32(o, 36 + dataSize, true);
  o += 4;
  writeStr("WAVE");

  writeStr("fmt ");
  view.setUint32(o, 16, true);
  o += 4;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint16(o, numCh, true);
  o += 2;
  view.setUint32(o, sr, true);
  o += 4;
  view.setUint32(o, byteRate, true);
  o += 4;
  view.setUint16(o, blockAlign, true);
  o += 2;
  view.setUint16(o, 16, true);
  o += 2;

  writeStr("data");
  view.setUint32(o, dataSize, true);
  o += 4;

  const chans = [];
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch));

  let p = o;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = chans[ch][i];
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

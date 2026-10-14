import { METHODOLOGY, MAX_AUDIO_BYTES, MAX_DURATION_SECONDS, type AudioMetrics } from '@oratoria/core';

export async function checkAudioFile(blob: Blob) {
  if (!blob.size || blob.size > MAX_AUDIO_BYTES)
    throw new Error('Admite archivos de audio de hasta 25 MiB y 10 minutos.');
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const tag = new TextDecoder('latin1').decode(bytes);
  const valid =
    (tag.startsWith('RIFF') && tag.slice(8, 12) === 'WAVE') ||
    tag.startsWith('OggS') ||
    tag.startsWith('fLaC') ||
    tag.startsWith('ID3') ||
    tag.slice(4, 8) === 'ftyp' ||
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  if (!valid)
    throw new Error(
      'El archivo no tiene una cabecera de audio compatible (WAV, MP3, OGG, WebM, MP4 o FLAC).',
    );
}

export function dbfs(value: number): number {
  return Math.max(-120, 20 * Math.log10(Math.max(value, 1e-6)));
}
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const x of samples) sum += x * x;
  return Math.sqrt(sum / samples.length);
}
function median(values: number[]): number {
  if (!values.length) return 0;
  const a = [...values].sort((a, b) => a - b);
  return a.length % 2 ? a[Math.floor(a.length / 2)]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
}
/** Normalized autocorrelation. Uncalibrated pitch estimate, not an emotion classifier. */
export function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate / 60 || rms(samples) < 0.008) return null;
  let mean = 0;
  for (const s of samples) mean += s;
  mean /= samples.length;
  const centered = Float32Array.from(samples, (s) => s - mean);
  const minLag = Math.floor(sampleRate / 400),
    maxLag = Math.min(Math.ceil(sampleRate / 70), samples.length / 2);
  const correlations: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0,
      a = 0,
      b = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      const x = centered[i]!,
        y = centered[i + lag]!;
      cross += x * y;
      a += x * x;
      b += y * y;
    }
    correlations[lag] = cross / Math.max(1e-12, Math.sqrt(a * b));
  }
  // First strong local peak avoids choosing a harmonic at twice the period.
  for (let lag = minLag + 1; lag < maxLag; lag++)
    if (
      correlations[lag]! >= 0.8 &&
      correlations[lag]! > correlations[lag - 1]! &&
      correlations[lag]! >= correlations[lag + 1]!
    )
      return sampleRate / lag;
  return null;
}
export function analyzeAudio(pcm: Float32Array, sampleRate: number, thresholdDbfs = -38): AudioMetrics {
  if (!pcm.length || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('Muestras o frecuencia no válidas.');
  if (pcm.some((x) => !Number.isFinite(x))) throw new Error('El audio contiene muestras no finitas.');
  if (pcm.length / sampleRate > MAX_DURATION_SECONDS + 0.1) throw new Error('El límite es de 10 minutos.');
  if (!Number.isFinite(thresholdDbfs) || thresholdDbfs < -60 || thresholdDbfs > -15)
    throw new Error('Umbral no válido.');
  const duration = pcm.length / sampleRate;
  const frameSize = Math.round(sampleRate * 0.02),
    threshold = 10 ** (thresholdDbfs / 20);
  const frames: AudioMetrics['frames'] = [];
  let peak = 0,
    clips = 0,
    sumSquares = 0;
  for (const s of pcm) {
    peak = Math.max(peak, Math.abs(s));
    if (Math.abs(s) >= 0.995) clips++;
    sumSquares += s * s;
  }
  for (let i = 0; i < pcm.length; i += frameSize) {
    const energy = rms(pcm.subarray(i, Math.min(pcm.length, i + frameSize)));
    frames.push({ time: i / sampleRate, rms: energy, active: energy > threshold });
  }
  // Bridge gaps under 100 ms surrounded by activity; remove bursts under 80 ms.
  for (let i = 0; i < frames.length;) {
    const active = frames[i]!.active,
      start = i;
    while (i < frames.length && frames[i]!.active === active) i++;
    const span = Math.min(duration, (i * frameSize) / sampleRate) - (start * frameSize) / sampleRate;
    if (!active && span < 0.1 && start > 0 && i < frames.length)
      for (let k = start; k < i; k++) frames[k]!.active = true;
  }
  for (let i = 0; i < frames.length;) {
    const active = frames[i]!.active,
      start = i;
    while (i < frames.length && frames[i]!.active === active) i++;
    const span = Math.min(duration, (i * frameSize) / sampleRate) - (start * frameSize) / sampleRate;
    if (active && span < 0.08) for (let k = start; k < i; k++) frames[k]!.active = false;
  }
  let activeSeconds = 0;
  frames.forEach((f, i) => {
    if (f.active) activeSeconds += Math.min(frameSize / sampleRate, duration - (i * frameSize) / sampleRate);
  });
  const pauses: AudioMetrics['pauses'] = [];
  for (let i = 0; i < frames.length;) {
    if (frames[i]!.active) {
      i++;
      continue;
    }
    const startIndex = i;
    while (i < frames.length && !frames[i]!.active) i++;
    const start = (startIndex * frameSize) / sampleRate,
      end = Math.min(duration, (i * frameSize) / sampleRate);
    if (startIndex > 0 && i < frames.length && end - start >= 0.25 - 1e-8)
      pauses.push({ start, end, duration: end - start });
  }
  const energies = frames.filter((f) => f.active).map((f) => f.rms);
  const mean = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length);
  const variance = energies.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, energies.length);
  const pitches: number[] = [];
  const stride = Math.max(1, Math.floor(sampleRate / 8000));
  for (let i = 0; i + sampleRate * 0.05 < pcm.length; i += Math.round(sampleRate * 0.2)) {
    if (!frames[Math.floor(i / frameSize)]?.active) continue;
    const window = new Float32Array(Math.floor((sampleRate * 0.05) / stride));
    for (let k = 0; k < window.length; k++) window[k] = pcm[i + k * stride]!;
    const pitch = estimatePitch(window, sampleRate / stride);
    if (pitch !== null) pitches.push(pitch);
  }
  const envelope: number[] = [],
    bin = Math.max(1, Math.ceil(pcm.length / 600));
  for (let i = 0; i < pcm.length; i += bin) {
    let p = 0;
    for (let j = i; j < Math.min(i + bin, pcm.length); j++) p = Math.max(p, Math.abs(pcm[j]!));
    envelope.push(p);
  }
  const sortedEnergy = frames.map((f) => f.rms).sort((a, b) => a - b);
  return {
    methodology: METHODOLOGY,
    duration,
    activeSeconds,
    silenceSeconds: Math.max(0, duration - activeSeconds),
    thresholdDbfs,
    meanDbfs: dbfs(Math.sqrt(sumSquares / pcm.length)),
    peakDbfs: dbfs(peak),
    variation: mean ? Math.sqrt(variance) / mean : 0,
    clippingFraction: clips / pcm.length,
    pauses,
    meanPause: pauses.length ? pauses.reduce((a, p) => a + p.duration, 0) / pauses.length : 0,
    pitchMedianHz: pitches.length >= 3 ? median(pitches) : null,
    pitchSamples: pitches.length,
    noiseFloorDbfs: dbfs(sortedEnergy[Math.floor(sortedEnergy.length * 0.1)] ?? 0),
    frames,
    envelope,
  };
}
export function downmixAndResample(
  channels: Float32Array[],
  sourceRate: number,
  targetRate = 16000,
): Float32Array {
  if (!channels.length || !channels[0]?.length || sourceRate < 8000 || targetRate < 8000)
    throw new Error('Audio vacío o frecuencia no válida.');
  if (channels.some((c) => c.length !== channels[0]!.length)) throw new Error('Canales desiguales.');
  const length = Math.round((channels[0]!.length * targetRate) / sourceRate),
    output = new Float32Array(length);
  // Windowed low-pass FIR before decimation limits aliasing from frequencies above Nyquist.
  const ratio = sourceRate / targetRate,
    radius = ratio > 1 ? 12 : 1,
    cutoff = Math.min(1, 1 / ratio) * 0.9;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    let value = 0,
      weightSum = 0;
    if (ratio === 1) {
      for (const c of channels) value += c[i]!;
      output[i] = value / channels.length;
      continue;
    }
    for (let k = Math.ceil(pos - radius); k <= Math.floor(pos + radius); k++) {
      if (k < 0 || k >= channels[0]!.length) continue;
      const delta = pos - k;
      const sinc = delta === 0 ? cutoff : Math.sin(Math.PI * cutoff * delta) / (Math.PI * delta);
      const weight = sinc * (0.5 + 0.5 * Math.cos((Math.PI * delta) / radius));
      let sample = 0;
      for (const c of channels) sample += c[k]!;
      value += (weight * sample) / channels.length;
      weightSum += weight;
    }
    output[i] = weightSum ? value / weightSum : 0;
  }
  return output;
}

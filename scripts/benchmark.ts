import { performance } from 'node:perf_hooks';
import { analyzeAudio } from '@oratoria/audio';
const duration = 600,
  rate = 16000;
const pcm = Float32Array.from({ length: duration * rate }, (_, i) =>
  (i / rate) % 5 < 4 ? 0.2 * Math.sin((2 * Math.PI * 220 * i) / rate) : 0,
);
const start = performance.now(),
  result = analyzeAudio(pcm, rate),
  elapsed = performance.now() - start;
console.log(
  JSON.stringify(
    {
      fixture: 'Seno sintético 220 Hz; 4 s de actividad y 1 s de silencio; 10 minutos',
      runtime: process.version,
      methodology: result.methodology,
      seconds: result.duration,
      dspMilliseconds: Math.round(elapsed),
      activeSeconds: result.activeSeconds,
      internalPauses: result.pauses.length,
      rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      scope:
        'Solo DSP en Node: excluye captura, decodificación, resampling, UI y ASR. No es un benchmark de habla ni una predicción para otros equipos.',
    },
    null,
    2,
  ),
);

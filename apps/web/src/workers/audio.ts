import { analyzeAudio, downmixAndResample } from '@oratoria/audio';
import { errorMessage } from '@oratoria/core';
self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; sampleRate: number; threshold: number }>,
) => {
  try {
    const { channels, sampleRate, threshold } = event.data;
    const pcm = downmixAndResample(channels, sampleRate);
    const metrics = analyzeAudio(pcm, 16000, threshold);
    self.postMessage({ metrics, pcm }, { transfer: [pcm.buffer] });
  } catch (error) {
    self.postMessage({ error: errorMessage(error) });
  }
};

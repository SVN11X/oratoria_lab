import { describe, expect, it } from 'vitest';
import { analyzeAudio, dbfs, downmixAndResample, estimatePitch, rms } from '@oratoria/audio';
const rate = 16000;
function tone(seconds: number, hz = 220, amplitude = 0.2, sampleRate = rate) {
  return Float32Array.from(
    { length: seconds * sampleRate },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate),
  );
}
describe('DSP sobre señales con valores conocidos', () => {
  it('RMS y dBFS coinciden con un seno de amplitud conocida', () => {
    expect(rms(tone(1))).toBeCloseTo(0.2 / Math.sqrt(2), 5);
    expect(dbfs(1)).toBe(0);
    expect(dbfs(0)).toBe(-120);
    expect(dbfs(0.5)).toBeCloseTo(-6.0206, 3);
  });
  it('mide duración, actividad y pausa interna excluyendo extremos', () => {
    const pcm = new Float32Array(4 * rate);
    pcm.set(tone(1), 0.5 * rate);
    pcm.set(tone(1.5), 2 * rate);
    const a = analyzeAudio(pcm, rate);
    expect(a.duration).toBe(4);
    expect(a.activeSeconds).toBeCloseTo(2.5, 2);
    expect(a.silenceSeconds).toBeCloseTo(1.5, 2);
    expect(a.pauses).toHaveLength(1);
    expect(a.meanPause).toBeCloseTo(0.5, 2);
    expect(a.pauses[0]?.start).toBeCloseTo(1.5, 2);
    expect(a.pitchMedianHz).toBeCloseTo(222.22, 0);
  });
  it('el silencio no fabrica habla, pausas internas ni tono', () => {
    const a = analyzeAudio(new Float32Array(rate), rate);
    expect(a.activeSeconds).toBe(0);
    expect(a.silenceSeconds).toBe(1);
    expect(a.pauses).toHaveLength(0);
    expect(a.pitchMedianHz).toBeNull();
    expect(a.variation).toBe(0);
  });
  it('une huecos menores a 100 ms', () => {
    const pcm = tone(1);
    pcm.fill(0, 0.1 * rate, 0.16 * rate);
    expect(analyzeAudio(pcm, rate).activeSeconds).toBeCloseTo(1, 2);
  });
  it('descarta ráfagas de actividad menores a 80 ms', () => {
    const pcm = new Float32Array(rate);
    pcm.set(tone(0.06), 0.3 * rate);
    expect(analyzeAudio(pcm, rate).activeSeconds).toBe(0);
  });
  it('respeta la sensibilidad configurable', () => {
    const pcm = tone(1, 220, 0.005);
    expect(analyzeAudio(pcm, rate, -38).activeSeconds).toBe(0);
    expect(analyzeAudio(pcm, rate, -60).activeSeconds).toBeCloseTo(1, 2);
  });
  it('estima fundamental sin atribuirla a habla', () => {
    expect(estimatePitch(tone(0.05, 200, 0.3, 8000), 8000)).toBeCloseTo(200, 1);
    expect(estimatePitch(new Float32Array(400), 8000)).toBeNull();
  });
  it('cuenta muestras cerca del límite digital', () => {
    const pcm = new Float32Array(rate).fill(0.2);
    pcm.fill(1, 0, 160);
    expect(analyzeAudio(pcm, rate).clippingFraction).toBeCloseTo(0.01, 5);
  });
  it('rechaza entradas inválidas, demasiado largas y NaN', () => {
    expect(() => analyzeAudio(new Float32Array(), rate)).toThrow();
    expect(() => analyzeAudio(new Float32Array([NaN]), rate)).toThrow();
    expect(() => analyzeAudio(tone(1), 0)).toThrow();
    expect(() => analyzeAudio(tone(1), rate, 0)).toThrow();
    expect(() => analyzeAudio(new Float32Array(8000 * 601), 8000)).toThrow('10 minutos');
  });
  it('mezcla canales sin sumar su amplitud', () => {
    const a = new Float32Array(4800).fill(0.2),
      b = new Float32Array(4800).fill(0.6);
    const pcm = downmixAndResample([a, b], 48000);
    expect(pcm.length).toBe(1600);
    expect(rms(pcm)).toBeCloseTo(0.4, 5);
  });
  it('el filtro limita aliasing en la reducción a 16 kHz', () => {
    const source = tone(0.3, 12000, 0.5, 48000),
      output = downmixAndResample([source], 48000);
    expect(rms(output.subarray(100, output.length - 100))).toBeLessThan(0.025);
  });
});

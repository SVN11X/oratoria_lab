import type { Phase, Tick } from '@oratoria/defense';

/** Reloj para practicar por escrito. No crea pistas, audio sintético ni mediciones vocales. */
export class TextSensors {
  readonly ticks: Tick[] = [];
  readonly hasCamera = false;
  readonly vision = 'off' as const;
  readonly visionError = '';
  phase: Phase | 'pausa' = 'pregunta';
  private last = performance.now();
  private elapsed = 0;
  private seconds = new Map<Phase, number>();
  private stopped = false;
  private flush() {
    const now = performance.now();
    if (!this.stopped && this.phase !== 'pausa') {
      const dt = (now - this.last) / 1000;
      this.elapsed += dt;
      this.seconds.set(this.phase, (this.seconds.get(this.phase) ?? 0) + dt);
    }
    this.last = now;
  }
  now() {
    this.flush();
    return this.elapsed;
  }
  setPhase(phase: Phase) {
    this.flush();
    this.phase = phase;
  }
  pause() {
    this.flush();
    this.phase = 'pausa';
  }
  phaseSeconds(phase: Phase) {
    this.flush();
    return this.seconds.get(phase) ?? 0;
  }
  firstVoiceAfter(_t: number): number | null {
    void _t;
    return null;
  }
  voicedSince(_t: number) {
    void _t;
    return 0;
  }
  attachVideo(_video: HTMLVideoElement | null) {
    void _video;
    /* Sin cámara en modo escrito. */
  }
  async enableVision(_factory?: unknown) {
    void _factory;
    /* No se carga ningún modelo de cámara. */
  }
  async stop(): Promise<Blob | null> {
    this.flush();
    this.stopped = true;
    return null;
  }
}

import { dbfs, estimatePitch, rms } from '@oratoria/audio';
import type { Phase, Tick } from '@oratoria/defense';
import type { VisionAnalyzer } from './vision';

export type LiveStats = {
  level: number;
  speaking: boolean;
  silence: number;
  contact: number | null;
  faceSeen: boolean | null;
  vision: 'off' | 'loading' | 'on' | 'error';
};
type Acc = {
  frames: number;
  active: number;
  dbSum: number;
  near: number;
  pitch: number[];
  clipped: number;
  v: number;
  face: number;
  contact: number;
  down: number;
  smile: number;
  pose: number;
  handsVisible: number;
  handsMoving: number;
  touch: number;
  tilt: number[];
  midX: number[];
  width: number[];
};
const emptyAcc = (): Acc => ({
  frames: 0,
  active: 0,
  dbSum: 0,
  near: 0,
  pitch: [],
  clipped: 0,
  v: 0,
  face: 0,
  contact: 0,
  down: 0,
  smile: 0,
  pose: 0,
  handsVisible: 0,
  handsMoving: 0,
  touch: 0,
  tilt: [],
  midX: [],
  width: [],
});
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
/**
 * Sensores de la práctica: captura micrófono y cámara, mide cada 100 ms y resume cada segundo en
 * un Tick. Opcionalmente entrega PCM para transcribir en el equipo. Todo ocurre en el navegador;
 * la grabación queda en memoria hasta que decidas guardarla o descargarla.
 */
export class MediaSensors {
  readonly ticks: Tick[] = [];
  readonly onsets: number[] = [];
  phase: Phase | 'pausa' = 'pregunta';
  vision: LiveStats['vision'] = 'off';
  visionError = '';
  private analyzer: VisionAnalyzer | null = null;
  private context: AudioContext;
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buffer: Float32Array<ArrayBuffer>;
  private acc = emptyAcc();
  private clock = 0;
  private lastFrame = performance.now();
  private lastVoice = 0;
  private run = 0;
  private frameCount = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private visionTimer: ReturnType<typeof setInterval> | undefined;
  private liveTimer: ReturnType<typeof setInterval> | undefined;
  private recorder: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private stopped = false;
  private capture: AudioWorkletNode | null = null;
  video: HTMLVideoElement | null = null;
  private constructor(
    readonly stream: MediaStream,
    readonly hasCamera: boolean,
    private threshold: number,
    record: boolean,
    private onLive: (s: LiveStats) => void,
  ) {
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
    if (record) this.startRecorder();
  }
  static async open(options: {
    camera: boolean;
    record: boolean;
    threshold: number;
    onLive: (s: LiveStats) => void;
    /** Recibe audio PCM para transcripción local. */
    onPcm?: (frame: Float32Array, sampleRate: number, t: number) => void;
    deviceId?: string;
    cameraId?: string;
  }): Promise<{ engine: MediaSensors; warning: string }> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('El simulador necesita HTTPS o localhost y un navegador con acceso al micrófono.');
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    };
    let stream: MediaStream,
      warning = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: options.camera
          ? {
              width: { ideal: 640 },
              height: { ideal: 480 },
              ...(options.cameraId ? { deviceId: { exact: options.cameraId } } : { facingMode: 'user' }),
            }
          : false,
      });
    } catch (error) {
      if (!options.camera) throw permission(error);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        warning = 'No se pudo usar la cámara. La práctica continúa solo con micrófono.';
      } catch (second) {
        throw permission(second);
      }
    }
    const engine = new MediaSensors(
      stream,
      stream.getVideoTracks().length > 0,
      options.threshold,
      options.record,
      options.onLive,
    );
    await engine.context.resume();
    if (options.onPcm) await engine.startCapture(options.onPcm);
    engine.timer = setInterval(() => engine.frame(), 100);
    engine.liveTimer = setInterval(() => engine.emit(), 400);
    return { engine, warning };
  }
  private async startCapture(onPcm: (frame: Float32Array, sampleRate: number, t: number) => void) {
    try {
      await this.context.audioWorklet.addModule(
        new URL('worklets/capture.js', new URL(import.meta.env.BASE_URL, location.href)).href,
      );
      const node = new AudioWorkletNode(this.context, 'oratoria-capture');
      node.port.onmessage = (e: MessageEvent<Float32Array>) =>
        onPcm(e.data, this.context.sampleRate, this.clock);
      this.source.connect(node);
      node.port.postMessage({ active: true });
      this.capture = node;
    } catch {
      this.capture = null;
      throw new Error('Este navegador no permite capturar audio para transcribir en el equipo.');
    }
  }
  private startRecorder() {
    const withVideo = this.stream.getVideoTracks().length > 0;
    const types = withVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    try {
      this.recorder = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64000,
        ...(withVideo ? { videoBitsPerSecond: 900000 } : {}),
      });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.parts.push(e.data);
      };
      this.recorder.start(2000);
    } catch {
      this.recorder = null;
    }
  }
  attachVideo(video: HTMLVideoElement | null) {
    this.video = video;
    if (video && this.hasCamera && video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => undefined);
    }
  }
  async enableVision(load: () => Promise<VisionAnalyzer>) {
    if (!this.hasCamera) return;
    this.vision = 'loading';
    try {
      const analyzer = await load();
      if (this.stopped) {
        analyzer.close();
        return;
      }
      this.analyzer = analyzer;
      this.vision = 'on';
      this.visionTimer = setInterval(() => this.visionFrame(), 125);
    } catch (error) {
      this.vision = 'error';
      this.visionError = error instanceof Error ? error.message : 'No se pudo iniciar el análisis de cámara.';
    }
  }
  /** Segundos de práctica sin contar pausas. */
  now() {
    return this.clock;
  }
  silence() {
    return this.clock - this.lastVoice;
  }
  setPhase(phase: Phase) {
    this.flush();
    this.phase = phase;
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }
  pause() {
    this.flush();
    this.phase = 'pausa';
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }
  phaseSeconds(phase: Phase) {
    return (
      this.ticks.reduce((n, t) => n + (t.phase === phase ? t.seconds : 0), 0) +
      (this.phase === phase ? this.acc.frames / 10 : 0)
    );
  }
  /** Primer inicio de voz sostenida (al menos 0,3 s) desde el instante indicado. */
  firstVoiceAfter(t: number): number | null {
    return this.onsets.find((o) => o >= t) ?? null;
  }
  voicedSince(t: number) {
    return (
      this.ticks.filter((x) => x.t >= t).reduce((n, x) => n + x.speaking * x.seconds, 0) +
      this.acc.active / 10
    );
  }
  private frame() {
    const now = performance.now(),
      dt = Math.min(0.5, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === 'pausa' || this.stopped) return;
    this.clock += dt;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const level = rms(this.buffer),
      db = dbfs(level),
      active = db > this.threshold;
    const a = this.acc;
    a.frames++;
    if (this.buffer.some((x) => Math.abs(x) > 0.99)) a.clipped++;
    if (active) {
      a.active++;
      a.dbSum += db;
      if (db < this.threshold + 6) a.near++;
      this.lastVoice = this.clock;
      if (++this.run === 3) this.onsets.push(this.clock - 0.3);
      if (this.frameCount++ % 2 === 0) {
        const p = estimatePitch(this.buffer, this.context.sampleRate);
        if (p) a.pitch.push(Math.round(p * 10) / 10);
      }
    } else this.run = 0;
    if (a.frames >= 10) this.flush();
  }
  private visionFrame() {
    if (!this.analyzer || !this.video || this.phase === 'pausa' || this.stopped) return;
    let f;
    try {
      f = this.analyzer.analyze(this.video);
    } catch {
      return;
    }
    if (!f) return;
    const a = this.acc;
    a.v++;
    a.face += +f.face;
    a.contact += +f.contact;
    a.down += +f.down;
    a.smile += +f.smile;
    if (f.pose) {
      a.pose++;
      a.handsVisible += +f.handsVisible;
      a.handsMoving += +f.handsMoving;
      a.touch += +f.touchFace;
      if (f.tilt !== null) a.tilt.push(f.tilt);
      if (f.midX !== null) a.midX.push(f.midX);
      if (f.shoulderW !== null) a.width.push(f.shoulderW);
    }
    this.latestFace = f.face;
  }
  private latestFace: boolean | null = null;
  private flush() {
    const a = this.acc;
    if (!a.frames || this.phase === 'pausa') {
      this.acc = emptyAcc();
      return;
    }
    const cam = this.vision === 'on';
    this.ticks.push({
      t: Math.round(this.clock - a.frames / 10),
      seconds: a.frames / 10,
      phase: this.phase,
      speaking: a.active / a.frames,
      db: a.active ? a.dbSum / a.active : null,
      nearThreshold: a.active ? a.near / a.active : 0,
      pitch: a.pitch,
      clipped: a.clipped > 0,
      face: cam ? (a.v ? a.face / a.v : null) : null,
      contact: cam && a.v ? a.contact / a.v : null,
      down: cam && a.v ? a.down / a.v : null,
      smile: cam && a.v ? a.smile / a.v : null,
      pose: cam && a.v ? a.pose / a.v : null,
      handsVisible: cam && a.pose ? a.handsVisible / a.pose : null,
      handsMoving: cam && a.pose ? a.handsMoving / a.pose : null,
      touchFace: cam && a.pose ? a.touch / a.pose : null,
      tilt: avg(a.tilt),
      midX: avg(a.midX),
      shoulderW: avg(a.width),
    });
    this.acc = emptyAcc();
  }
  private emit() {
    if (this.stopped) return;
    const recent = this.ticks.slice(-4).filter((t) => t.face !== null);
    const face = recent.reduce((n, t) => n + (t.face ?? 0), 0);
    this.onLive({
      level: Math.min(1, rms(this.buffer) * 6),
      speaking: this.silence() < 0.4 && this.phase !== 'pausa',
      silence: this.phase === 'pausa' ? 0 : this.silence(),
      contact: face > 0.5 ? recent.reduce((n, t) => n + (t.contact ?? 0), 0) / face : null,
      faceSeen: this.vision === 'on' ? this.latestFace : null,
      vision: this.vision,
    });
  }
  /** Detiene todo y devuelve la grabación (o null si no se grabó). */
  async stop(): Promise<Blob | null> {
    if (this.stopped) return null;
    this.flush();
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.visionTimer);
    clearInterval(this.liveTimer);
    const recorder = this.recorder;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!recorder || recorder.state === 'inactive')
        return resolve(this.parts.length ? new Blob(this.parts) : null);
      recorder.onstop = () => resolve(new Blob(this.parts, { type: recorder.mimeType }));
      recorder.stop();
    });
    this.capture?.port.postMessage({ active: false });
    this.capture?.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    this.source.disconnect();
    await this.context.close().catch(() => undefined);
    this.analyzer?.close();
    this.analyzer = null;
    if (this.video) this.video.srcObject = null;
    return blob;
  }
}
function permission(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : '';
  return new Error(
    name === 'NotAllowedError'
      ? 'No se concedió permiso al micrófono o a la cámara. Revisa los permisos del sitio en la barra de direcciones.'
      : name === 'NotFoundError'
        ? 'No se encontró micrófono o cámara. Conéctalos e inténtalo de nuevo.'
        : name === 'NotReadableError'
          ? 'Otra aplicación está usando el micrófono o la cámara. Ciérrala e inténtalo de nuevo.'
          : 'No se pudo acceder al micrófono.',
  );
}

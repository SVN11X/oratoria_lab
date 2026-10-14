import { useEffect, useRef, useState } from 'react';
import { drafts } from '@oratoria/storage';
import { MAX_AUDIO_BYTES, MAX_DURATION_SECONDS, errorMessage } from '@oratoria/core';
import { basePath } from './services';
type Mode = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping';
export function useRecorder(onDone: (blob: Blob) => void) {
  const [mode, setMode] = useState<Mode>('idle'),
    [seconds, setSeconds] = useState(0),
    [level, setLevel] = useState(0);
  const [error, setError] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const resources = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    node: AudioNode;
    sink: GainNode;
    id: string;
    queue: Promise<void>;
    start: number;
    accumulated: number;
    timer: ReturnType<typeof setInterval>;
    bytes: number;
    index: number;
    failed: string;
  } | null>(null);
  const alive = useRef(true),
    doneCallback = useRef(onDone);
  useEffect(() => {
    doneCallback.current = onDone;
  }, [onDone]);
  const enumerate = async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices();
      if (alive.current) setDevices(all?.filter((d) => d.kind === 'audioinput') ?? []);
    } catch {
      /* Permission status is shown on start. */
    }
  };
  useEffect(() => {
    alive.current = true;
    void enumerate();
    return () => {
      alive.current = false;
      const r = resources.current;
      if (!r) return;
      clearInterval(r.timer);
      r.stream.getTracks().forEach((t) => t.stop());
      if (r.recorder.state !== 'inactive') r.recorder.stop();
      r.source.disconnect();
      r.node.disconnect();
      r.sink.disconnect();
      void r.context.close();
      void r.queue.finally(() => drafts.remove(r.id)).catch(() => undefined);
      resources.current = null;
    };
  }, []);
  async function start(deviceId: string) {
    if (mode !== 'idle') return;
    setError('');
    setSeconds(0);
    setLevel(0);
    setMode('requesting');
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          'La grabación requiere HTTPS o localhost y un navegador compatible. Puedes importar audio.',
        );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream),
        sink = context.createGain();
      sink.gain.value = 0;
      sink.connect(context.destination);
      let node: AudioNode;
      try {
        await context.audioWorklet.addModule(`${basePath}worklets/levels.js`);
        const meter = new AudioWorkletNode(context, 'oratoria-levels');
        meter.port.onmessage = (event: MessageEvent<number>) => {
          if (alive.current) setLevel(event.data);
        };
        node = meter;
      } catch {
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        node = analyser;
      }
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        sink.disconnect();
        await context.close();
        return;
      }
      source.connect(node);
      node.connect(sink);
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined),
        id = crypto.randomUUID();
      const r = {
        recorder,
        stream,
        context,
        source,
        node,
        sink,
        id,
        queue: Promise.resolve(),
        start: performance.now(),
        accumulated: 0,
        bytes: 0,
        index: 0,
        failed: '',
        timer: setInterval(() => {
          if (r.recorder.state === 'recording') {
            const s = r.accumulated + (performance.now() - r.start) / 1000;
            setSeconds(s);
            if (s >= MAX_DURATION_SECONDS) stop();
            if (node instanceof AnalyserNode) {
              const data = new Float32Array(node.fftSize);
              node.getFloatTimeDomainData(data);
              setLevel(Math.sqrt(data.reduce((n, x) => n + x * x, 0) / data.length));
            }
          }
        }, 100),
      };
      resources.current = r;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        r.bytes += event.data.size;
        if (r.bytes > MAX_AUDIO_BYTES) {
          r.failed = 'La grabación alcanzó el límite de 25 MB.';
          stop();
          return;
        }
        const index = r.index++;
        r.queue = r.queue
          .then(() => drafts.append(id, index, event.data))
          .catch((error) => {
            r.failed = `No se pudo guardar el audio temporal: ${errorMessage(error)}`;
            stop();
          });
      };
      recorder.onerror = () => {
        r.failed = 'El navegador interrumpió la grabación.';
        stop();
      };
      stream.getAudioTracks().forEach((t) => {
        t.onended = () => {
          if (recorder.state !== 'inactive') {
            setError('El micrófono se desconectó. Se conservará el audio capturado.');
            stop();
          }
        };
      });
      recorder.onstop = async () => {
        clearInterval(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
        r.source.disconnect();
        r.node.disconnect();
        r.sink.disconnect();
        await r.context.close().catch(() => undefined);
        try {
          await r.queue;
          if (r.failed) throw new Error(r.failed);
          const blob = await drafts.finish(r.id, recorder.mimeType);
          if (alive.current && blob.size) doneCallback.current(blob);
        } catch (error) {
          if (alive.current) setError(errorMessage(error));
          await drafts.remove(r.id).catch(() => undefined);
        } finally {
          if (alive.current) {
            setMode('idle');
            setLevel(0);
          }
          resources.current = null;
        }
      };
      recorder.start(1000);
      setMode('recording');
      void enumerate();
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      await context?.close().catch(() => undefined);
      if (alive.current) {
        setMode('idle');
        const name = error instanceof DOMException ? error.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'No se concedió permiso al micrófono. Revisa los permisos del sitio o importa un audio.'
            : name === 'NotFoundError'
              ? 'No hay un micrófono disponible. Conecta uno o importa audio.'
              : errorMessage(error),
        );
      }
    }
  }
  function stop() {
    const r = resources.current;
    if (!r || r.recorder.state === 'inactive') return;
    if (r.recorder.state === 'recording') r.accumulated += (performance.now() - r.start) / 1000;
    setSeconds(r.accumulated);
    setMode('stopping');
    r.recorder.stop();
  }
  function togglePause() {
    const r = resources.current;
    if (!r) return;
    if (r.recorder.state === 'recording') {
      r.accumulated += (performance.now() - r.start) / 1000;
      r.recorder.pause();
      setMode('paused');
      setLevel(0);
    } else if (r.recorder.state === 'paused') {
      r.start = performance.now();
      r.recorder.resume();
      setMode('recording');
    }
  }
  return { mode, seconds, level, error, devices, start, stop, togglePause };
}

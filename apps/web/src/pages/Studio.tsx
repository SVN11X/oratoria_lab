import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Pause, Play, Square, Upload, ShieldCheck, Save, Trash2 } from 'lucide-react';
import { newSession, formatDuration, errorMessage, type AudioMetrics } from '@oratoria/core';
import { store } from '@oratoria/storage';
import { downloadBlob } from '@oratoria/export';
import { PageHead, Alert, Metric, AudioPlayer, Confirm } from '../components';
import { useRecorder } from '../useRecorder';
import { processAudio } from '../services';
import { usePreferences, useSessions } from '../state';
export function Studio() {
  const [title, setTitle] = useState('Mi práctica'),
    [goal, setGoal] = useState(usePreferences.getState().goal);
  const [blob, setBlob] = useState<Blob | null>(null),
    [source, setSource] = useState<'microphone' | 'import'>('microphone');
  const [name, setName] = useState('grabacion.webm'),
    [device, setDevice] = useState('');
  const [metrics, setMetrics] = useState<AudioMetrics | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false);
  const abort = useRef<AbortController | null>(null),
    mounted = useRef(true),
    threshold = usePreferences((s) => s.threshold);
  const navigate = useNavigate(),
    reload = useSessions((s) => s.reload);
  const recorder = useRecorder((b) => {
    setBlob(b);
    setSource('microphone');
    setName(`grabacion.${b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm'}`);
    setMetrics(null);
    setError('');
  });
  const recording = recorder.mode !== 'idle';
  useEffect(() => {
    mounted.current = true;
    const guard = (e: BeforeUnloadEvent) => {
      if (recording || blob || busy) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    const guardLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        (recording || blob || busy) &&
        link &&
        link.hash.startsWith('#/') &&
        link.hash !== location.hash &&
        !window.confirm(
          'Tienes audio sin guardar o una operación en curso. ¿Descartarlo y salir del estudio?',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('click', guardLink, true);
    };
  }, [recording, blob, busy]);
  useEffect(
    () => () => {
      mounted.current = false;
      abort.current?.abort();
    },
    [],
  );
  async function analyze() {
    if (!blob) return;
    setError('');
    setBusy('Analizando el audio local…');
    abort.current = new AbortController();
    try {
      const result = await processAudio(blob, threshold, source === 'microphone', abort.current.signal);
      if (mounted.current) setMetrics(result.metrics);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function save() {
    if (!blob || !metrics || !title.trim()) return;
    setBusy('Guardando en tu dispositivo…');
    setError('');
    try {
      const session = newSession({
        title: title.trim(),
        goal,
        source,
        audioName: name,
        audioMime: blob.type,
        audioBytes: blob.size,
        audio: metrics,
      });
      await store.save(session, blob);
      await reload();
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(`No se pudo guardar. ${errorMessage(e)} Puedes descargar el audio para conservarlo.`);
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  return (
    <>
      <PageHead
        eyebrow="ESTUDIO"
        title="Dale espacio a tu voz."
        description="Hasta 10 minutos y 25 MB por grabación. Puedes analizar audio sin instalar IA."
      />
      {(error || recorder.error) && <Alert>{error || recorder.error}</Alert>}
      <div className="studio-grid">
        <section className="panel recorder-panel">
          <div className="section-heading">
            <h2>Grabación</h2>
            <span className="badge">
              <ShieldCheck size={14} /> Local
            </span>
          </div>
          <label className="field">
            Nombre de la sesión
            <input
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!!busy}
            />
          </label>
          <label className="field">
            Micrófono
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              disabled={recording || !!busy || !!blob}
            >
              <option value="">Predeterminado del sistema</option>
              {recorder.devices
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Micrófono ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <div className={`recording-stage ${recorder.mode === 'recording' ? 'is-recording' : ''}`}>
            <div className="mic-orbit">
              <Mic size={42} strokeWidth={1.4} />
            </div>
            <div className="record-clock" role="timer" aria-label="Duración grabada">
              {formatDuration(recorder.seconds)}
            </div>
            <p>
              {recorder.mode === 'recording'
                ? 'Grabando en tu dispositivo'
                : recorder.mode === 'paused'
                  ? 'Grabación en pausa'
                  : recorder.mode === 'requesting'
                    ? 'Esperando permiso del micrófono…'
                    : recorder.mode === 'stopping'
                      ? 'Preparando el audio capturado…'
                      : blob
                        ? 'Tu audio está listo para escuchar'
                        : 'Cuando estés listo, comienza'}
            </p>
            <div
              className="level-meter"
              role="meter"
              aria-label="Nivel relativo del micrófono"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, recorder.level * 4) * 100)}
            >
              <span style={{ width: `${Math.min(1, recorder.level * 4) * 100}%` }} />
            </div>
            <small>Nivel relativo · escala visual, sin calibración física</small>
          </div>
          <div className="actions center">
            {recorder.mode === 'idle' ? (
              <button
                className="button primary"
                onClick={() => void recorder.start(device)}
                disabled={!!blob || !!busy}
              >
                <Mic size={18} /> Grabar audio
              </button>
            ) : (
              <>
                <button
                  className="button secondary"
                  onClick={recorder.togglePause}
                  disabled={recorder.mode !== 'recording' && recorder.mode !== 'paused'}
                >
                  {recorder.mode === 'paused' ? <Play size={17} /> : <Pause size={17} />}{' '}
                  {recorder.mode === 'paused' ? 'Reanudar' : 'Pausar'}
                </button>
                <button
                  className="button danger"
                  onClick={recorder.stop}
                  disabled={recorder.mode === 'requesting' || recorder.mode === 'stopping'}
                >
                  <Square size={15} /> Detener
                </button>
              </>
            )}
          </div>
          {blob && (
            <div className="audio-preview">
              <AudioPlayer blob={blob} />
              <div className="actions">
                <button className="button secondary" onClick={analyze} disabled={!!busy}>
                  {metrics ? 'Volver a analizar' : 'Analizar audio'}
                </button>
                <button className="button quiet" onClick={() => downloadBlob(blob, name)}>
                  Descargar audio
                </button>
                <button
                  className="icon-button"
                  aria-label="Descartar audio capturado"
                  onClick={() => setDiscard(true)}
                  disabled={!!busy}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          )}
        </section>
        <div className="studio-aside">
          <section className="panel">
            <span className="eyebrow">DALE UNA DIRECCIÓN</span>
            <h2>Tu objetivo de hoy</h2>
            <label className="field">
              ¿Qué vas a practicar?
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="Por ejemplo: explicar un resultado de mi tesis en 2 minutos."
              />
            </label>
            <p className="caption">
              Un objetivo específico ayuda a comparar sesiones y valorar tus decisiones.
            </p>
          </section>
          <section className="panel import-panel">
            <Upload size={24} />
            <h2>¿Ya tienes un audio?</h2>
            <p>Importa WAV, MP3, OGG, WebM, MP4/M4A o FLAC si tu navegador los reconoce.</p>
            <label className={`button secondary file-button ${recording || busy || blob ? 'disabled' : ''}`}>
              Importar audio
              <input
                aria-label="Importar audio"
                type="file"
                accept="audio/*,.webm,.mp4,.m4a"
                disabled={recording || !!busy || !!blob}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  if (file.size > 25 * 1024 * 1024 || !file.size) {
                    setError('El archivo debe contener audio y pesar hasta 25 MB.');
                    return;
                  }
                  setBlob(file);
                  setSource('import');
                  setName(file.name);
                  setMetrics(null);
                  setError('');
                }}
              />
            </label>
            <p className="caption">El archivo se valida antes de analizarlo. No se envía a internet.</p>
          </section>
        </div>
      </div>
      {busy && (
        <div className="status-line" role="status">
          <span className="spinner" />
          {busy}
          {!busy.startsWith('Guardando') && (
            <button className="text-link" onClick={() => abort.current?.abort()}>
              Cancelar
            </button>
          )}
        </div>
      )}
      {metrics && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MEDICIONES DEL AUDIO</span>
              <h2>Una primera mirada</h2>
            </div>
            <button className="button primary" onClick={save} disabled={!!busy || !title.trim()}>
              <Save size={17} /> Guardar sesión
            </button>
          </div>
          <div className="metric-row compact">
            <Metric label="Duración" value={formatDuration(metrics.duration)} />
            <Metric
              label="Actividad estimada"
              value={formatDuration(metrics.activeSeconds)}
              detail="Detector energético; puede incluir ruido"
            />
            <Metric label="Pausas internas ≥ 250 ms" value={metrics.pauses.length} />
          </div>
          <p className="caption">
            Umbral utilizado: {metrics.thresholdDbfs} dBFS. Una pausa no se considera un defecto. Guarda para
            editar la transcripción y revisar el análisis.
          </p>
        </section>
      )}
      {discard && (
        <Confirm
          title="¿Descartar este audio?"
          onCancel={() => setDiscard(false)}
          onConfirm={() => {
            setBlob(null);
            setMetrics(null);
            setDiscard(false);
          }}
        >
          El audio aún no está guardado como sesión. Puedes descargarlo antes de descartarlo.
        </Confirm>
      )}
    </>
  );
}

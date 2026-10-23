import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mic,
  Pause,
  Play,
  Square,
  Upload,
  ShieldCheck,
  Save,
  Trash2,
  Wand2,
  Download,
  Sparkles,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { newSession, formatDuration, errorMessage, type AudioMetrics, type Transcript } from '@oratoria/core';
import { analyzeText, coachingNotes } from '@oratoria/evaluation';
import { keyTerms, normalize } from '@oratoria/defense';
import { evaluateSpeech, type SpeechFeedback } from '@oratoria/conversation';
import { managed } from '@oratoria/model-manager';
import { store } from '@oratoria/storage';
import { downloadBlob, safeFilename } from '@oratoria/export';
import { PageHead, Alert, Metric, AudioPlayer, Confirm, Chart } from '../components';
import { useRecorder } from '../useRecorder';
import { processAudio, WhisperTranscriber } from '../services';
import { usePreferences, useSessions } from '../state';
import { useAi } from '../ai/settings';
import { llmFor } from '../ai/llm';
import { MaterialPanel } from '../knowledge/MaterialPanel';
import { documentChunks, makeRetriever } from '../knowledge/library';
import { bestWhisper } from '../practice/engines';

const STRUCTURE: [string, RegExp][] = [
  [
    'Apertura con propósito',
    /\b(hoy (les |te )?(voy a|vamos a)|el objetivo (de|es)|en esta presentacion|quiero (contarles|mostrarles))\b/,
  ],
  [
    'Transiciones',
    /\b(primero|en primer lugar|en segundo lugar|por otro lado|a continuacion|luego|despues de esto|ahora veamos)\b/,
  ],
  ['Ejemplos', /\b(por ejemplo|un ejemplo|imaginen|pensemos en)\b/],
  ['Evidencia', /\b(\d+ ?%|datos|resultados|estudio|segun)\b/],
  ['Cierre', /\b(en conclusion|para terminar|en resumen|para cerrar|finalmente)\b/],
];

/** Práctica sin interlocutores: grabar o importar, medir, transcribir y recibir recomendaciones. */
export function FreePractice({ mode }: { mode: 'record' | 'import' }) {
  const [title, setTitle] = useState(mode === 'record' ? 'Práctica libre' : 'Grabación analizada'),
    [goal, setGoal] = useState(usePreferences.getState().goal),
    [targetMin, setTargetMin] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null),
    [source, setSource] = useState<'microphone' | 'import'>(mode === 'record' ? 'microphone' : 'import'),
    [name, setName] = useState('grabacion.webm'),
    [device, setDevice] = useState(usePreferences.getState().micId);
  const [metrics, setMetrics] = useState<AudioMetrics | null>(null),
    [pcm, setPcm] = useState<Float32Array | null>(null),
    [transcript, setTranscript] = useState<Transcript | null>(null),
    [manual, setManual] = useState(''),
    [content, setContent] = useState<SpeechFeedback | null>(null),
    [docIds, setDocIds] = useState<string[]>([]),
    [coverage, setCoverage] = useState<{ covered: string[]; missing: string[] } | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [discard, setDiscard] = useState(false),
    [whisperModel, setWhisperModel] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null),
    mounted = useRef(true),
    player = useRef<HTMLAudioElement>(null),
    threshold = usePreferences((s) => s.threshold),
    fillers = usePreferences((s) => s.fillers),
    ai = useAi();
  const navigate = useNavigate(),
    { sessions, reload } = useSessions();
  const recorder = useRecorder((b) => {
    setBlob(b);
    setSource('microphone');
    setName(`grabacion.${b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm'}`);
    setMetrics(null);
    setTranscript(null);
    setManual('');
    setContent(null);
    setError('');
  });
  const recording = recorder.mode !== 'idle';
  useEffect(() => {
    mounted.current = true;
    void bestWhisper(ai.stt).then((id) => mounted.current && setWhisperModel(id));
    const guard = (e: BeforeUnloadEvent) => {
      if (recording || blob) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', guard);
      abort.current?.abort();
    };
  }, [recording, blob, ai.stt]);
  const text = useMemo(() => {
    const t: Transcript | null =
      transcript ??
      (manual.trim()
        ? {
            source: 'manual',
            language: 'es',
            model: null,
            revision: 1,
            updatedAt: new Date().toISOString(),
            segments: [{ id: 'm1', text: manual.trim(), start: null, end: null }],
          }
        : null);
    return t ? { t, a: analyzeText(t, metrics?.duration ?? null, fillers) } : null;
  }, [transcript, manual, metrics, fillers]);
  const full = text?.t.segments.map((s) => s.text).join(' ') ?? '';
  const structure = useMemo(() => {
    const n = ` ${normalize(full)} `;
    return STRUCTURE.map(([label, rx]) => ({ label, found: rx.test(n) }));
  }, [full]);
  const notes = useMemo(() => coachingNotes(metrics, text?.a ?? null), [metrics, text]);
  const previous = sessions.find((s) => s.source === source && s.audio && s.transcript && s.title !== title);
  useEffect(() => {
    let alive = true;
    if (!docIds.length || !full) {
      setCoverage(null);
      return;
    }
    void documentChunks(docIds)
      .then((chunks) => {
        if (!alive) return;
        const terms = keyTerms(chunks.map((c) => c.text).join(' '), 15);
        const said = normalize(full);
        setCoverage({
          covered: terms.filter((t) => said.includes(normalize(t))),
          missing: terms.filter((t) => !said.includes(normalize(t))),
        });
      })
      .catch(() => alive && setCoverage(null));
    return () => {
      alive = false;
    };
  }, [docIds, full]);
  useEffect(() => {
    setContent(null);
  }, [full, docIds, goal]);
  async function analyze() {
    if (!blob) return;
    setError('');
    setBusy('Analizando el audio en tu equipo…');
    abort.current = new AbortController();
    try {
      const r = await processAudio(blob, threshold, source === 'microphone', abort.current.signal);
      if (mounted.current) {
        setMetrics(r.metrics);
        setPcm(r.pcm);
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function transcribe() {
    if (!pcm || !whisperModel) return;
    setBusy(`Transcribiendo con ${managed(whisperModel)?.name ?? 'Whisper'} en tu equipo…`);
    setError('');
    abort.current = new AbortController();
    try {
      const t = await new WhisperTranscriber(whisperModel).transcribe(
        pcm,
        'es',
        abort.current.signal,
        (p) => mounted.current && setBusy(p.message),
      );
      if (!t.segments.some((s) => s.text.trim()))
        throw new Error('Whisper no reconoció texto. Escucha el audio y escribe la transcripción.');
      if (mounted.current) setTranscript(t);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function feedback() {
    const llm = llmFor('evaluacion');
    if (!llm || !full) return;
    setBusy(`El modelo ${llm.model} revisa el contenido…`);
    setError('');
    abort.current = new AbortController();
    try {
      const retriever = await makeRetriever(docIds);
      const result = await evaluateSpeech({
        text: full,
        title,
        goal,
        llm,
        retrieve: retriever?.retrieve,
        signal: abort.current.signal,
        onProgress: (part, total) =>
          mounted.current && setBusy(`Revisando el contenido: parte ${part} de ${total}…`),
      });
      if (mounted.current) setContent(result);
    } catch (e) {
      if (mounted.current) setError(`No se obtuvo el comentario del modelo: ${errorMessage(e)}`);
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function save() {
    if (!blob || !metrics || !title.trim()) return;
    setBusy('Guardando en tu dispositivo…');
    try {
      const session = newSession({
        title: title.trim().slice(0, 120),
        goal: goal.slice(0, 500),
        source,
        audioName: name,
        audioMime: blob.type,
        audioBytes: blob.size,
        audio: metrics,
        transcript: text?.t ?? null,
        speechFeedback: content,
      });
      await store.save(session, blob);
      await reload();
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(`No se pudo guardar. ${errorMessage(e)} Puedes descargar el audio para conservarlo.`);
      setBusy('');
    }
  }
  const pausesPerMin = metrics ? (metrics.pauses.length * 60) / metrics.duration : 0;
  const option = useMemo<EChartsOption | null>(
    () =>
      metrics
        ? {
            grid: { top: 28, bottom: 56, left: 48, right: 24 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'value', name: 's', min: 0, max: Math.ceil(metrics.duration) },
            yAxis: { type: 'value', name: 'amplitud', min: 0, max: 1 },
            dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 10 }],
            series: [
              {
                name: 'Energía de la voz',
                type: 'line',
                showSymbol: false,
                areaStyle: { opacity: 0.18 },
                data: metrics.envelope.map((v, i, a) => [(i * metrics.duration) / a.length, v]),
                markArea: {
                  silent: true,
                  itemStyle: { opacity: 0.18 },
                  data: metrics.pauses.map(
                    (p) => [{ xAxis: p.start }, { xAxis: p.end }] as [{ xAxis: number }, { xAxis: number }],
                  ),
                },
              },
              ...(text?.a.fillerCandidates.some((f) => f.start !== null)
                ? [
                    {
                      name: 'Muletillas (inicio del segmento)',
                      type: 'scatter' as const,
                      symbolSize: 10,
                      data: text.a.fillerCandidates
                        .filter((f) => f.start !== null)
                        .map((f) => [f.start!, 0.9]),
                    },
                  ]
                : []),
            ],
          }
        : null,
    [metrics, text],
  );
  return (
    <>
      <PageHead
        eyebrow={mode === 'record' ? 'PRÁCTICA LIBRE' : 'ANALIZAR UNA GRABACIÓN'}
        title={mode === 'record' ? 'Habla sin interlocutores.' : 'Analiza una grabación que ya tienes.'}
        description="Mide voz, pausas, muletillas y estructura, transcribe en tu equipo y recibe recomendaciones. Los resultados aparecen aquí mismo; guardar es opcional."
      />
      {(error || recorder.error) && <Alert>{error || recorder.error}</Alert>}
      <div className="studio-grid">
        <section className="panel recorder-panel">
          <label className="field">
            Nombre de la sesión
            <input
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!!busy}
            />
          </label>
          {mode === 'record' ? (
            <>
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
                          ? 'Preparando el audio…'
                          : blob
                            ? 'Tu audio está listo'
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
            </>
          ) : (
            <div className="dropzone">
              <Upload size={24} />
              <strong>Elige un audio o video</strong>
              <p className="caption">
                WAV, MP3, OGG, WebM, MP4/M4A o FLAC de hasta 25 MB y 10 minutos. Del video se analiza el
                audio.
              </p>
              <label className={`button secondary file-button ${busy || blob ? 'disabled' : ''}`}>
                Importar audio
                <input
                  aria-label="Importar audio"
                  type="file"
                  accept="audio/*,video/mp4,video/webm,.webm,.mp4,.m4a"
                  disabled={!!busy || !!blob}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > 25 * 1024 * 1024 || !file.size) {
                      setError('El archivo debe pesar hasta 25 MB.');
                      return;
                    }
                    setBlob(file);
                    setSource('import');
                    setName(file.name);
                    setMetrics(null);
                    setTranscript(null);
                    setManual('');
                    setContent(null);
                    setError('');
                  }}
                />
              </label>
            </div>
          )}
          {blob && (
            <div className="audio-preview">
              <AudioPlayer blob={blob} playerRef={player} />
              <div className="actions">
                <button className="button primary" onClick={() => void analyze()} disabled={!!busy}>
                  {metrics ? 'Volver a analizar' : 'Analizar audio'}
                </button>
                <button className="button quiet" onClick={() => downloadBlob(blob, name)}>
                  <Download size={16} /> Descargar
                </button>
                <button
                  className="icon-button"
                  aria-label="Descartar audio"
                  onClick={() => setDiscard(true)}
                  disabled={!!busy}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          )}
        </section>
        <div>
          <section className="panel">
            <h2>Tu objetivo</h2>
            <label className="field">
              ¿Qué vas a practicar?
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Explicar un resultado de mi tesis en 2 minutos."
              />
            </label>
            <label className="field">
              Duración objetivo
              <select value={targetMin} onChange={(e) => setTargetMin(Number(e.target.value))}>
                <option value={0}>Sin duración objetivo</option>
                {[1, 2, 3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} minuto{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>Guion, presentación o documento (opcional)</summary>
              <MaterialPanel
                selected={docIds}
                onChange={setDocIds}
                hint="Tu guion o presentación permite revisar qué ideas clave mencionaste."
                compact
              />
            </details>
          </section>
          <section className="panel">
            <span className="badge success">
              <ShieldCheck size={14} /> Todo se procesa en tu equipo
            </span>
            <p className="caption" style={{ marginTop: 8 }}>
              Nada se envía a internet salvo que actives un servicio externo.{' '}
              <Link className="text-link" to="/settings/privacy">
                Privacidad
              </Link>
            </p>
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
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Voz y tiempo</span>
                <h2>Lo que se midió</h2>
              </div>
              <button
                className="button primary"
                onClick={() => void save()}
                disabled={!!busy || !title.trim()}
              >
                <Save size={17} /> Guardar en historial
              </button>
            </div>
            <div className="metric-row compact">
              <Metric
                label="Duración"
                value={formatDuration(metrics.duration)}
                detail={
                  targetMin
                    ? `Objetivo ${targetMin}:00 · ${metrics.duration > targetMin * 66 ? 'te pasaste' : metrics.duration < targetMin * 50 ? 'quedó corto' : 'dentro del rango'}`
                    : undefined
                }
              />
              <Metric
                label="Voz activa"
                value={`${Math.round((metrics.activeSeconds / metrics.duration) * 100)} %`}
                detail="Detector de energía"
              />
              <Metric
                label="Pausas por minuto"
                value={pausesPerMin.toFixed(1)}
                detail={`Media ${metrics.meanPause.toFixed(1)} s`}
              />
              {text?.a.wordsPerMinute && (
                <Metric
                  label="Velocidad"
                  value={Math.round(text.a.wordsPerMinute)}
                  unit=" ppm"
                  detail="Referencia: 120 a 160"
                />
              )}
              {text?.a.fillersPer100Words !== null && text && (
                <Metric
                  label="Muletillas"
                  value={(text.a.fillersPer100Words ?? 0).toFixed(1)}
                  unit=" /100 pal."
                />
              )}
              <Metric
                label="Tono (mediana)"
                value={metrics.pitchMedianHz ? Math.round(metrics.pitchMedianHz) : '—'}
                unit={metrics.pitchMedianHz ? ' Hz' : ''}
                detail="Solo con voz periódica"
              />
            </div>
            {option && (
              <>
                <h3 style={{ marginTop: 10 }}>Línea de tiempo</h3>
                <p className="caption">
                  Zonas sombreadas: pausas de 250 ms o más. Puntos: segmentos con muletillas. Haz clic para
                  escuchar ese momento.
                </p>
                <Chart
                  option={option}
                  label={`Energía de la voz durante ${formatDuration(metrics.duration)} con ${metrics.pauses.length} pausas marcadas.`}
                  onPointClick={(x) => {
                    if (player.current) {
                      player.current.currentTime = Math.max(0, x - 0.5);
                      void player.current.play().catch(() => undefined);
                    }
                  }}
                />
              </>
            )}
            {previous?.audio && previous.transcript && text?.a.wordsPerMinute && (
              <p className="caption">
                Comparado con «{previous.title}»: velocidad{' '}
                {Math.round(
                  analyzeText(previous.transcript, previous.audio.duration, fillers).wordsPerMinute ?? 0,
                )}{' '}
                → {Math.round(text.a.wordsPerMinute)} ppm; pausas por minuto{' '}
                {((previous.audio.pauses.length * 60) / previous.audio.duration).toFixed(1)} →{' '}
                {pausesPerMin.toFixed(1)}.
              </p>
            )}
          </section>
          <section className="panel">
            <span className="eyebrow">Contenido</span>
            <h2>Transcripción</h2>
            {!transcript && (
              <div className="actions">
                {whisperModel ? (
                  <button
                    className="button secondary"
                    onClick={() => void transcribe()}
                    disabled={!!busy || !pcm}
                  >
                    <Wand2 size={16} /> Transcribir con {managed(whisperModel)?.name}
                  </button>
                ) : (
                  <p className="caption">
                    Para transcribir automáticamente en tu equipo, instala Whisper en{' '}
                    <Link className="text-link" to="/settings/models">
                      Modelos de IA
                    </Link>
                    . También puedes escribir lo que dijiste.
                  </p>
                )}
              </div>
            )}
            {transcript ? (
              <div className="stack" style={{ marginTop: 10 }}>
                {transcript.segments.map((s) => (
                  <p key={s.id} style={{ color: 'var(--text)' }}>
                    {s.start !== null && (
                      <button
                        className="text-link"
                        onClick={() => {
                          if (player.current) {
                            player.current.currentTime = s.start!;
                            void player.current.play().catch(() => undefined);
                          }
                        }}
                      >
                        {formatDuration(s.start)}
                      </button>
                    )}{' '}
                    {s.text}
                  </p>
                ))}
              </div>
            ) : (
              <label className="field" style={{ marginTop: 10 }}>
                Transcripción manual
                <textarea
                  rows={5}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Escribe lo que dijiste para analizar palabras, muletillas y estructura."
                />
              </label>
            )}
            {text && (
              <>
                <div className="structure-row">
                  {structure.map((s) => (
                    <span key={s.label} className={`badge ${s.found ? 'success' : ''}`}>
                      {s.found ? '✓' : '·'} {s.label}
                    </span>
                  ))}
                </div>
                {text.a.fillerCandidates.length > 0 && (
                  <p className="caption">
                    Muletillas:{' '}
                    {[...new Set(text.a.fillerCandidates.map((f) => f.term))]
                      .map((t) => `«${t}» ×${text.a.fillerCandidates.filter((f) => f.term === t).length}`)
                      .join(', ')}
                    .
                  </p>
                )}
                {coverage && (
                  <p className="caption">
                    Ideas clave de tu material mencionadas: {coverage.covered.length} de{' '}
                    {coverage.covered.length + coverage.missing.length}.
                    {coverage.missing.length > 0 && ` Faltaron: ${coverage.missing.slice(0, 8).join(', ')}.`}
                  </p>
                )}
                {ai.useLlm && llmFor('evaluacion') && (
                  <div className="actions">
                    <button className="button secondary" onClick={() => void feedback()} disabled={!!busy}>
                      <Sparkles size={16} /> Comentario de contenido con {llmFor('evaluacion')?.model}
                    </button>
                  </div>
                )}
              </>
            )}
            {content && (
              <div className="panel soft" style={{ marginTop: 12 }}>
                <span className="eyebrow">Comentario del modelo {content.model}</span>
                <p style={{ color: 'var(--text)' }}>{content.summary}</p>
                {content.findings.map((f, i) => (
                  <article key={i} className="panel">
                    <blockquote>«{f.quote}»</blockquote>
                    <p>{f.observed}</p>
                    <p>
                      <strong>Para practicar:</strong> {f.improve}
                    </p>
                    {f.sources.map((s) => (
                      <blockquote key={s.chunkId} className="source-quote">
                        «{s.excerpt}»
                        <small>
                          {s.docName} · {s.location}
                        </small>
                      </blockquote>
                    ))}
                  </article>
                ))}
                {content.notes.map((n) => (
                  <p className="caption" key={n}>
                    {n}
                  </p>
                ))}
                <button
                  className="button secondary small"
                  onClick={() =>
                    downloadBlob(
                      new Blob([JSON.stringify({ title, goal, feedback: content }, null, 2)], {
                        type: 'application/json',
                      }),
                      `${safeFilename(title)}-comentarios.json`,
                    )
                  }
                >
                  <Download size={15} /> Exportar comentarios con evidencias
                </button>
                <p className="caption">Apreciación automática: revísala con criterio.</p>
              </div>
            )}
          </section>
          <section className="panel">
            <h2>Recomendaciones</h2>
            {notes.length ||
            (targetMin && metrics.duration > targetMin * 66) ||
            (text?.a.wordsPerMinute && (text.a.wordsPerMinute > 165 || text.a.wordsPerMinute < 110)) ||
            structure.some((s) => !s.found) ? (
              <div className="stack">
                {targetMin > 0 && metrics.duration > targetMin * 66 && (
                  <p className="coaching-note">
                    Te pasaste del tiempo objetivo. Marca en tu guion dónde deberías ir en cada cuarto del
                    tiempo.
                  </p>
                )}
                {text?.a.wordsPerMinute && text.a.wordsPerMinute > 165 && (
                  <p className="coaching-note">
                    Hablaste rápido ({Math.round(text.a.wordsPerMinute)} ppm). Haz una pausa de un segundo al
                    final de cada idea importante.
                  </p>
                )}
                {text?.a.wordsPerMinute && text.a.wordsPerMinute < 110 && (
                  <p className="coaching-note">
                    Hablaste lento ({Math.round(text.a.wordsPerMinute)} ppm). Prueba explicar cada idea en 60
                    segundos con cronómetro.
                  </p>
                )}
                {text && !structure[0]!.found && (
                  <p className="coaching-note">
                    No se escuchó una apertura con propósito. Empieza diciendo qué vas a explicar y por qué
                    importa.
                  </p>
                )}
                {text && !structure[4]!.found && (
                  <p className="coaching-note">
                    No se escuchó un cierre explícito. Termina con «En resumen…» y la idea que quieres que
                    recuerden.
                  </p>
                )}
                {notes.map((n) => (
                  <div className="coaching-note" key={n.title}>
                    <strong>{n.title}</strong>
                    <p>{n.evidence}</p>
                    <p>{n.exercise}</p>
                    <small>{n.method}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                Sin recomendaciones por reglas en esta grabación. Agrega una transcripción para revisar
                velocidad, muletillas y estructura.
              </p>
            )}
            <div className="actions">
              <button
                className="button secondary"
                onClick={() =>
                  downloadBlob(
                    new Blob(
                      [
                        [
                          title,
                          `Duración: ${formatDuration(metrics.duration)}`,
                          `Pausas por minuto: ${pausesPerMin.toFixed(1)}`,
                          text?.a.wordsPerMinute ? `Velocidad: ${Math.round(text.a.wordsPerMinute)} ppm` : '',
                          text
                            ? `Muletillas cada 100 palabras: ${(text.a.fillersPer100Words ?? 0).toFixed(1)}`
                            : '',
                          '',
                          full,
                        ]
                          .filter((x) => x !== '')
                          .join('\n'),
                      ],
                      { type: 'text/plain;charset=utf-8' },
                    ),
                    `${safeFilename(title)}.txt`,
                  )
                }
              >
                <Download size={16} /> Descargar resultados (TXT)
              </button>
            </div>
          </section>
        </>
      )}
      {discard && (
        <Confirm
          title="¿Descartar este audio?"
          onCancel={() => setDiscard(false)}
          onConfirm={() => {
            setBlob(null);
            setMetrics(null);
            setTranscript(null);
            setDiscard(false);
          }}
        >
          El audio aún no está guardado. Puedes descargarlo antes de descartarlo.
        </Confirm>
      )}
    </>
  );
}

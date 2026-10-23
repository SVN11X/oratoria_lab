import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Save, Trash2, Plus, AudioLines, FileText, ListChecks, Sparkles, Play } from 'lucide-react';
import {
  type Session as SessionData,
  type Segment,
  type Rating,
  type Rubric,
  SessionSchema,
  TranscriptSchema,
  errorMessage,
  formatDuration,
} from '@oratoria/core';
import {
  analyzeText,
  coachingNotes,
  INITIAL_RUBRICS,
  scoreEvaluation,
  validateRatings,
} from '@oratoria/evaluation';
import { store, rubricStore } from '@oratoria/storage';
import { downloadBlob, exportSession } from '@oratoria/export';
import { managed } from '@oratoria/model-manager';
import { bestWhisper } from '../practice/engines';
import { PageHead, Metric, Alert, Empty, Chart, AudioPlayer, Confirm } from '../components';
import { processAudio, WhisperTranscriber } from '../services';
import { usePreferences, useSessions } from '../state';
import { BackupExport } from '../BackupControls';
export function SessionPage() {
  const { id } = useParams();
  return <SessionView key={id} id={id ?? ''} />;
}
function SessionView({ id }: { id: string }) {
  const [session, setSession] = useState<SessionData | null>(null),
    [blob, setBlob] = useState<Blob | null>(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('audio');
  const [segments, setSegments] = useState<Segment[]>([]),
    [rubrics, setRubrics] = useState<Rubric[]>(INITIAL_RUBRICS),
    [rubricKey, setRubricKey] = useState('general@1');
  const [ratings, setRatings] = useState<Rating[]>([]),
    [installed, setInstalled] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false),
    [replaceTranscript, setReplaceTranscript] = useState(false);
  const [threshold, setThreshold] = useState(-38),
    abort = useRef<AbortController | null>(null),
    player = useRef<HTMLAudioElement>(null);
  const alive = useRef(true),
    navigate = useNavigate(),
    reload = useSessions((s) => s.reload),
    fillers = usePreferences((s) => s.fillers);
  useEffect(() => {
    alive.current = true;
    void Promise.all([store.get(id), store.audio(id), rubricStore.list(), bestWhisper()])
      .then(([data, audio, savedRubrics, available]) => {
        if (!alive.current) return;
        if (!data) {
          setError('Esta sesión no existe en este dispositivo.');
          return;
        }
        setSession(data);
        setBlob(audio ?? null);
        setSegments(data.transcript?.segments ?? []);
        setThreshold(data.audio?.thresholdDbfs ?? -38);
        setInstalled(available);
        const snapshot = data.evaluation?.rubric;
        const availableRubrics = [...INITIAL_RUBRICS, ...savedRubrics].filter(
          (r) => !snapshot || r.id !== snapshot.id || r.version !== snapshot.version,
        );
        if (snapshot) availableRubrics.push(snapshot);
        setRubrics(availableRubrics);
        if (data.evaluation) {
          setRubricKey(`${data.evaluation.rubric.id}@${data.evaluation.rubric.version}`);
          setRatings(data.evaluation.ratings);
        } else if (data.scenarioId === 'tesis') setRubricKey('tesis@1');
        if (!data.audio) setTab('transcript');
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, [id]);
  const text = useMemo(
    () =>
      session?.transcript ? analyzeText(session.transcript, session.audio?.duration ?? null, fillers) : null,
    [session, fillers],
  );
  const notes = useMemo(() => coachingNotes(session?.audio ?? null, text), [session, text]);
  const option = useMemo(
    () => ({
      grid: { top: 28, bottom: 58, left: 48, right: 24 },
      tooltip: { trigger: 'axis' as const },
      xAxis: { type: 'value' as const, name: 's', min: 0, max: session?.audio?.duration },
      yAxis: {
        type: 'value' as const,
        name: 'amplitud',
        min: 0,
        max: 1,
        splitLine: { lineStyle: { color: '#7c929522' } },
      },
      dataZoom: [{ type: 'inside' as const }, { type: 'slider' as const, height: 14, bottom: 12 }],
      series: [
        {
          name: 'Pico absoluto por intervalo',
          type: 'line' as const,
          showSymbol: false,
          lineStyle: { color: '#167a68', width: 1.5 },
          areaStyle: { color: '#167a6830' },
          data:
            session?.audio?.envelope.map((value, i, a) => [
              (i * session.audio!.duration) / a.length,
              value,
            ]) ?? [],
          markArea: {
            silent: true,
            itemStyle: { color: '#b293f522' },
            data:
              session?.audio?.pauses.map(
                (p) => [{ xAxis: p.start }, { xAxis: p.end }] as [{ xAxis: number }, { xAxis: number }],
              ) ?? [],
          },
        },
      ],
    }),
    [session],
  );
  const rubric =
    rubrics.find((r) => `${r.id}@${r.version}` === rubricKey) ??
    session?.evaluation?.rubric ??
    INITIAL_RUBRICS[0]!;
  const dirty = JSON.stringify(segments) !== JSON.stringify(session?.transcript?.segments ?? []);
  async function persist(next: SessionData) {
    const parsed = SessionSchema.parse(next);
    await store.save(parsed);
    if (alive.current) setSession(parsed);
    await reload();
  }
  async function saveTranscript() {
    if (!session) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const cleaned = segments.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() }));
      if (!cleaned.length) throw new Error('Escribe al menos un segmento de transcripción.');
      const transcript = TranscriptSchema.parse({
        source: 'manual',
        language: 'es',
        model: null,
        revision: (session.transcript?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        segments: cleaned,
      });
      await persist({ ...session, transcript, evaluation: null, speechFeedback: null });
      setSegments(cleaned);
      setRatings([]);
      setStatus(
        'Transcripción guardada. Las valoraciones anteriores se retiraron para revisar las nuevas evidencias.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function transcribe() {
    if (!session || !blob) return;
    setReplaceTranscript(false);
    setBusy(true);
    setError('');
    setStatus('Preparando audio para Whisper…');
    abort.current = new AbortController();
    try {
      const { pcm } = await processAudio(
        blob,
        threshold,
        session.source === 'microphone',
        abort.current.signal,
      );
      const transcript = await new WhisperTranscriber(installed ?? 'whisper-tiny').transcribe(
        pcm,
        'es',
        abort.current.signal,
        (p) => {
          if (alive.current) setStatus(p.message);
        },
      );
      transcript.revision = (session.transcript?.revision ?? 0) + 1;
      if (!transcript.segments.some((s) => s.text.trim()))
        throw new Error('Whisper no reconoció texto. Escucha el audio y prueba una transcripción manual.');
      await persist({ ...session, transcript, evaluation: null, speechFeedback: null });
      if (alive.current) {
        setSegments(transcript.segments);
        setRatings([]);
        setStatus('Whisper terminó localmente. Revisa los nombres, cifras y marcas de tiempo.');
      }
    } catch (e) {
      if (alive.current) {
        setError(errorMessage(e));
        setStatus('');
      }
    } finally {
      abort.current = null;
      if (alive.current) setBusy(false);
    }
  }
  async function reanalyze() {
    if (!session || !blob) return;
    setBusy(true);
    setError('');
    setStatus('Recalculando con el umbral seleccionado…');
    abort.current = new AbortController();
    try {
      const { metrics } = await processAudio(
        blob,
        threshold,
        session.source === 'microphone',
        abort.current.signal,
      );
      await persist({ ...session, audio: metrics });
      if (alive.current) setStatus('Mediciones acústicas actualizadas.');
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      abort.current = null;
      if (alive.current) setBusy(false);
    }
  }
  async function saveEvaluation() {
    if (!session?.transcript) return;
    setError('');
    setBusy(true);
    try {
      const fullRatings = rubric.criteria.map(
        (c) =>
          ratings.find((r) => r.criterionId === c.id) ?? {
            criterionId: c.id,
            level: null,
            segmentId: null,
            quote: '',
            note: '',
          },
      );
      const errors = validateRatings(fullRatings, rubric, session.transcript);
      if (errors.length) throw new Error(errors.join(' '));
      await persist({
        ...session,
        evaluation: {
          method: 'manual-evidence-1.0.0',
          rubric,
          ratings: fullRatings,
          transcriptRevision: session.transcript.revision,
          createdAt: new Date().toISOString(),
        },
      });
      setStatus('Valoración manual guardada con su rúbrica y evidencias.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function changeRating(criterionId: string, change: Partial<Rating>) {
    setRatings((prev) => {
      const found = prev.find((r) => r.criterionId === criterionId) ?? {
        criterionId,
        level: null,
        segmentId: null,
        quote: '',
        note: '',
      };
      return [...prev.filter((r) => r.criterionId !== criterionId), { ...found, ...change }];
    });
  }
  function seek(time: number | null) {
    if (time !== null && player.current) {
      player.current.currentTime = time;
      void player.current.play().catch(() => setError('Pulsa reproducir para escuchar el fragmento.'));
    }
  }
  if (loading) return <p role="status">Abriendo sesión…</p>;
  if (!session)
    return (
      <>
        <Alert>{error || 'No se encontró la sesión.'}</Alert>
        <Link className="button secondary" to="/history">
          Volver al historial
        </Link>
      </>
    );
  return (
    <>
      <PageHead
        eyebrow={`SESIÓN / ${new Date(session.createdAt).toLocaleDateString('es-CL')}`}
        title={session.title}
        description={session.goal || 'Revisa lo medido, escucha el contexto y elige qué ensayar después.'}
        action={
          <button
            className="icon-button"
            aria-label="Eliminar esta sesión"
            onClick={() => setDeleting(true)}
            disabled={busy}
          >
            <Trash2 size={19} />
          </button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {status && (
        <div className="status-line" role="status">
          {busy && <span className="spinner" />}
          {status}
          {busy && abort.current && (
            <button className="text-link" onClick={() => abort.current?.abort()}>
              Cancelar procesamiento
            </button>
          )}
        </div>
      )}
      {blob && (
        <section className="panel player-panel">
          <div>
            <AudioLines size={23} />
            <span>Grabación original</span>
            <small>{session.audioBytes ? (session.audioBytes / 1024 / 1024).toFixed(2) + ' MB' : ''}</small>
          </div>
          <AudioPlayer blob={blob} playerRef={player} />
        </section>
      )}
      <div className="tab-bar" aria-label="Secciones del análisis">
        {[
          { id: 'audio', label: 'Audio', icon: AudioLines },
          { id: 'transcript', label: 'Transcripción', icon: FileText },
          { id: 'evaluation', label: 'Valoración', icon: ListChecks },
        ].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={17} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'audio' &&
        (session.audio ? (
          <>
            <div className="metric-row">
              <Metric label="Duración total" value={formatDuration(session.audio.duration)} />
              <Metric
                label="Actividad acústica estimada"
                value={formatDuration(session.audio.activeSeconds)}
                detail="Puede incluir ruido o música"
              />
              <Metric label="Silencio estimado" value={formatDuration(session.audio.silenceSeconds)} />
              <Metric
                label="Pausas internas"
                value={session.audio.pauses.length}
                detail={`Promedio: ${session.audio.meanPause.toFixed(2)} s`}
              />
            </div>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">DESDE LA GRABACIÓN REAL</span>
                  <h2>Amplitud y pausas</h2>
                </div>
                <span className="badge">DSP · v1.0</span>
              </div>
              <Chart
                option={option}
                label={`Audio de ${formatDuration(session.audio.duration)}; ${session.audio.pauses.length} pausas internas señaladas en violeta. Amplitud digital relativa de cero a uno.`}
              />
              <p className="caption">
                Picos absolutos por intervalo. Violeta: silencio interno ≥ 250 ms. Una pausa puede ayudar a
                organizar ideas.
              </p>
              <div className="metric-row compact">
                <Metric
                  label="Nivel RMS digital"
                  value={session.audio.meanDbfs.toFixed(1)}
                  unit="dBFS"
                  detail="No es dB SPL ni volumen físico"
                />
                <Metric
                  label="Variación relativa de energía"
                  value={(session.audio.variation * 100).toFixed(1)}
                  unit="%"
                  detail="Desviación / media en intervalos activos"
                />
                <Metric
                  label="Frecuencia fundamental estimada"
                  value={session.audio.pitchMedianHz?.toFixed(0) ?? '—'}
                  unit={session.audio.pitchMedianHz ? 'Hz' : ''}
                  detail={
                    session.audio.pitchMedianHz
                      ? `Mediana de ${session.audio.pitchSamples} ventanas periódicas`
                      : 'Evidencia periódica insuficiente'
                  }
                />
              </div>
              <details>
                <summary>Cómo se calcula y cómo ajustar el detector</summary>
                <p>
                  RMS en ventanas de 20 ms, actividad sobre un umbral digital, unión de huecos menores a 100
                  ms y eliminación de ráfagas menores a 80 ms. Se excluyen el silencio inicial y final del
                  conteo de pausas. La frecuencia se estima por autocorrelación; no clasifica emociones ni
                  identifica personas.
                </p>
                <label className="field">
                  Umbral energético: {threshold} dBFS
                  <input
                    type="range"
                    min={-60}
                    max={-15}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />
                </label>
                <p className="caption">
                  Más negativo detecta sonidos más suaves y también más ruido. Escucha antes de interpretar.
                </p>
                <button className="button secondary" onClick={reanalyze} disabled={busy || !blob}>
                  Recalcular métricas
                </button>
              </details>
            </section>
            {session.audio.pauses.length > 0 && (
              <section className="panel">
                <h2>Revisa las pausas en contexto</h2>
                <div className="pause-list">
                  {session.audio.pauses.map((p, i) => (
                    <button key={i} className="pause-item" onClick={() => seek(Math.max(0, p.start - 1))}>
                      <Play size={14} />
                      {formatDuration(p.start)} — {formatDuration(p.end)}
                      <strong>{p.duration.toFixed(2)} s</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <Empty title="Esta es una práctica escrita">
            No hay audio ni métricas acústicas. Puedes revisar el texto y aplicar una rúbrica.
          </Empty>
        ))}
      {tab === 'transcript' && (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">TEXTO / EVIDENCIAS</span>
                <h2>{session.transcript ? 'Revisa tu transcripción' : 'Añade una transcripción'}</h2>
              </div>
              {blob &&
                (installed ? (
                  <button
                    className="button secondary"
                    onClick={() =>
                      session.transcript || dirty ? setReplaceTranscript(true) : void transcribe()
                    }
                    disabled={busy}
                  >
                    <Sparkles size={17} /> Transcribir con {managed(installed)?.name ?? 'Whisper'}
                  </button>
                ) : (
                  <Link className="button secondary" to="/settings/models">
                    Instalar Whisper local
                  </Link>
                ))}
            </div>
            <p className="caption">
              {session.transcript
                ? `${session.transcript.source === 'whisper-local' ? 'Whisper local' : 'Texto manual'} · revisión ${session.transcript.revision}.`
                : 'Sin texto, no se calculan palabras ni muletillas.'}{' '}
              La edición manual es independiente de IA. Las marcas de tiempo son opcionales y deben
              corresponder al audio.
            </p>
            {segments.map((segment, i) => (
              <div className="segment-editor" key={segment.id}>
                {segment.prompt && <p className="caption">Pregunta guía: {segment.prompt}</p>}
                <div className="segment-heading">
                  <strong>Segmento {i + 1}</strong>
                  {session.audio && (
                    <>
                      <label>
                        Inicio (s)
                        <input
                          type="number"
                          min={0}
                          max={session.audio.duration}
                          step="0.01"
                          value={segment.start ?? ''}
                          onChange={(e) =>
                            setSegments((prev) =>
                              prev.map((s) =>
                                s.id === segment.id
                                  ? { ...s, start: e.target.value === '' ? null : Number(e.target.value) }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Fin (s)
                        <input
                          type="number"
                          min={0}
                          max={session.audio.duration}
                          step="0.01"
                          value={segment.end ?? ''}
                          onChange={(e) =>
                            setSegments((prev) =>
                              prev.map((s) =>
                                s.id === segment.id
                                  ? { ...s, end: e.target.value === '' ? null : Number(e.target.value) }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`Quitar segmento ${i + 1}`}
                    onClick={() => setSegments((prev) => prev.filter((s) => s.id !== segment.id))}
                    disabled={busy}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  aria-label={`Texto del segmento ${i + 1}`}
                  rows={4}
                  maxLength={50000}
                  value={segment.text}
                  disabled={busy}
                  onChange={(e) =>
                    setSegments((prev) =>
                      prev.map((s) => (s.id === segment.id ? { ...s, text: e.target.value } : s)),
                    )
                  }
                />
              </div>
            ))}
            <div className="actions">
              <button
                className="button secondary"
                onClick={() =>
                  setSegments((prev) => [
                    ...prev,
                    { id: crypto.randomUUID(), text: '', start: null, end: null },
                  ])
                }
                disabled={busy || segments.length >= 1000}
              >
                <Plus size={16} /> Añadir segmento
              </button>
              <button
                className="button primary"
                onClick={saveTranscript}
                disabled={busy || !segments.some((s) => s.text.trim()) || !dirty}
              >
                <Save size={16} /> Guardar transcripción
              </button>
              {dirty && <span className="caption">Cambios sin guardar</span>}
            </div>
          </section>
          {text && (
            <>
              <div className="metric-row">
                <Metric label="Palabras en el texto guardado" value={text.words} />
                <Metric
                  label="Ritmo sobre duración total"
                  value={text.wordsPerMinute?.toFixed(1) ?? '—'}
                  unit={text.wordsPerMinute ? 'pal/min' : ''}
                  detail="Solo disponible con audio"
                />
                <Metric
                  label="Candidatos a muletilla"
                  value={text.fillerCandidates.length}
                  detail="Coincidencias léxicas; revisar contexto"
                />
                <Metric
                  label="Candidatos por 100 palabras"
                  value={text.fillersPer100Words?.toFixed(1) ?? '—'}
                />
              </div>
              <section className="panel">
                <h2>Términos para escuchar en contexto</h2>
                <p>
                  No todos los usos de «este», «bueno» u otras expresiones son muletillas. Los tiempos señalan
                  el inicio del segmento, no la posición exacta de la palabra.
                </p>
                {text.fillerCandidates.length ? (
                  <div className="findings">
                    {text.fillerCandidates.map((f, i) => (
                      <div className="finding" key={i}>
                        <span className="badge">{f.term}</span>
                        <span>«{f.quote}»</span>
                        {f.start !== null ? (
                          <button className="text-link" onClick={() => seek(f.start)}>
                            <Play size={13} /> Segmento {formatDuration(f.start)}
                          </button>
                        ) : (
                          <span className="caption">Sin marca temporal</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="caption">No hay coincidencias con el diccionario actual.</p>
                )}
                {text.repeatedTerms.length > 0 && (
                  <>
                    <h3>Términos repetidos, excluyendo palabras funcionales</h3>
                    <div className="term-list">
                      {text.repeatedTerms.map(([word, count]) => (
                        <span className="badge" key={word}>
                          {word} · {count}
                        </span>
                      ))}
                    </div>
                    <p className="caption">
                      La repetición puede ser útil. No determina claridad ni calidad argumentativa.
                    </p>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
      {tab === 'evaluation' && (
        <section className="panel">
          <span className="eyebrow">VALORACIÓN CON EVIDENCIA</span>
          <h2>Aplica una rúbrica a tu texto</h2>
          <p>
            Valoración manual, sin LLM. Cada criterio puntuado necesita una cita exacta del texto guardado.
            Los criterios no evaluables se excluyen de la puntuación.
          </p>
          {!session.transcript ? (
            <Empty title="Primero guarda una transcripción">
              Puedes escribirla manualmente en la pestaña Transcripción.
            </Empty>
          ) : (
            <>
              <label className="field">
                Rúbrica y versión
                <select
                  value={rubricKey}
                  onChange={(e) => {
                    setRubricKey(e.target.value);
                    setRatings([]);
                  }}
                >
                  {rubrics.map((r) => (
                    <option value={`${r.id}@${r.version}`} key={`${r.id}@${r.version}`}>
                      {r.name} · v{r.version}
                    </option>
                  ))}
                </select>
              </label>
              {rubric.criteria.map((c) => {
                const r = ratings.find((r) => r.criterionId === c.id);
                return (
                  <div className="rubric-rating" key={c.id}>
                    <div>
                      <h3>
                        {c.name}
                        <span className="badge">Peso {c.weight}</span>
                      </h3>
                      <p>{c.indicator}</p>
                      <label className="field">
                        Nivel de desempeño
                        <select
                          value={r?.level ?? ''}
                          onChange={(e) =>
                            changeRating(c.id, {
                              level: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        >
                          <option value="">No evaluable</option>
                          {c.descriptors.map((d, i) => (
                            <option value={i} key={i}>
                              {i} · {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div>
                      <label className="field">
                        Segmento de evidencia
                        <select
                          value={r?.segmentId ?? ''}
                          onChange={(e) => changeRating(c.id, { segmentId: e.target.value || null })}
                        >
                          <option value="">Selecciona un segmento</option>
                          {session.transcript!.segments.map((s, i) => (
                            <option value={s.id} key={s.id}>
                              Segmento {i + 1}: {s.text.slice(0, 60)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Cita exacta
                        <input
                          value={r?.quote ?? ''}
                          maxLength={2000}
                          onChange={(e) => changeRating(c.id, { quote: e.target.value })}
                          placeholder="Copia una frase del segmento"
                        />
                      </label>
                      <label className="field">
                        Justificación del nivel / límite
                        <textarea
                          value={r?.note ?? ''}
                          maxLength={2000}
                          rows={2}
                          onChange={(e) => changeRating(c.id, { note: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
              <button className="button primary" onClick={saveEvaluation} disabled={busy}>
                <Save size={17} /> Guardar valoración manual
              </button>
              {session.evaluation &&
                (() => {
                  const score = scoreEvaluation(session.evaluation!);
                  return (
                    <div className="evaluation-result">
                      <strong>
                        {score.percent === null ? 'Sin puntuación' : `${score.percent.toFixed(1)} %`}
                      </strong>
                      <div>
                        <p>
                          Valoración manual guardada · {session.evaluation!.rubric.name} v
                          {session.evaluation!.rubric.version}
                        </p>
                        <small>
                          Cobertura: {(score.coverage * 100).toFixed(0)} % del peso total. Transcripción v
                          {session.evaluation!.transcriptRevision}. No es una medida objetiva de oratoria.
                        </small>
                      </div>
                    </div>
                  );
                })()}
            </>
          )}
        </section>
      )}
      {session.speechFeedback && (
        <section className="panel">
          <h2>Comentarios de contenido con evidencias</h2>
          <p>{session.speechFeedback.summary}</p>
          <p className="caption">
            Modelo: {session.speechFeedback.model}. Apreciación automática para revisar con criterio.
          </p>
          {session.speechFeedback.findings.map((f, i) => (
            <article key={i} className="coaching-note">
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
          {session.speechFeedback.notes.map((n) => (
            <p className="caption" key={n}>
              {n}
            </p>
          ))}
        </section>
      )}
      {notes.length > 0 && (
        <section className="panel">
          <h2>Siguientes pasos basados en tus datos</h2>
          {notes.map((n) => (
            <div className="coaching-note" key={n.title}>
              <h3>{n.title}</h3>
              <p>{n.evidence}</p>
              <p>{n.exercise}</p>
              <small>{n.method}</small>
            </div>
          ))}
        </section>
      )}
      <section className="panel export-panel">
        <div>
          <h2>Conserva tu práctica</h2>
          <p className="caption">JSON incluye resultados y métodos; el audio se descarga por separado.</p>
        </div>
        <div className="actions">
          <BackupExport session={session} audio={blob} disabled={busy || dirty} />
          <button className="button secondary" onClick={() => exportSession(session, 'json', fillers)}>
            <Download size={16} /> JSON
          </button>
          <button className="button secondary" onClick={() => exportSession(session, 'csv', fillers)}>
            Métricas CSV
          </button>
          {session.transcript && (
            <button className="button secondary" onClick={() => exportSession(session, 'txt')}>
              Transcripción TXT
            </button>
          )}
          {blob && (
            <button
              className="button secondary"
              onClick={() => downloadBlob(blob, session.audioName ?? 'grabacion.webm')}
            >
              Audio original
            </button>
          )}
        </div>
        {dirty && (
          <p className="caption">Guarda los cambios de transcripción antes de crear la copia completa.</p>
        )}
      </section>
      {deleting && (
        <Confirm
          title="¿Eliminar esta práctica?"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            void store
              .remove(id)
              .then(reload)
              .then(() => navigate('/history'))
              .catch((e) => {
                setError(errorMessage(e));
                setDeleting(false);
              });
          }}
        >
          Se eliminarán los datos locales de la sesión, incluyendo su audio y texto.
        </Confirm>
      )}
      {replaceTranscript && (
        <Confirm
          title="¿Reemplazar la transcripción?"
          confirmLabel="Transcribir y reemplazar"
          onCancel={() => setReplaceTranscript(false)}
          onConfirm={() => void transcribe()}
        >
          Whisper generará una nueva transcripción desde el audio original. Al terminar correctamente, se
          reemplazará el texto actual y se retirará la valoración previa.
        </Confirm>
      )}
    </>
  );
}

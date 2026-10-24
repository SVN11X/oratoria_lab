import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, Trash2, Dumbbell, BookOpen, PlayCircle } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import {
  ANSWER_TYPE_TEXT,
  DIMENSION_NAMES,
  LEVEL_NAMES,
  SCENARIOS,
  STAGE_TEXT,
  compareCriterion,
  previousComparable,
  type CriterionResult,
  type Dimension,
  type Exercise,
} from '@oratoria/conversation';
import { formatDuration } from '@oratoria/core';
import { downloadBlob, safeFilename } from '@oratoria/export';
import { PageHead, Metric, Chart, Confirm } from '../components';
import { recordMedia, historyPoints, useRecords, type PracticeRecord } from './records';
import { Diagnostics } from './Diagnostics';

export function LevelDots({ level }: { level: CriterionResult['level'] }) {
  if (level === null) return <span className="badge">No evaluado</span>;
  return (
    <span className="row-wrap" title={LEVEL_NAMES[level]}>
      <span className={`level-dots l${level}`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i <= level ? 'on' : ''} />
        ))}
      </span>
      <span className={`badge ${level >= 3 ? 'success' : level === 2 ? 'primary' : 'warning'}`}>
        {LEVEL_NAMES[level]}
      </span>
    </span>
  );
}
const METHOD_TEXT = { medicion: 'Medición', reglas: 'Regla explícita', ia: 'Valoración con IA' } as const;
const DIM_ORDER: Dimension[] = ['contenido', 'verbal', 'interpersonal', 'vocal', 'no_verbal'];

export function recordText(r: PracticeRecord): string {
  const s = SCENARIOS[r.scenario];
  const lines = [
    `ORATORIA LAB · ${s.name.toUpperCase()}`,
    `${r.title} · ${new Date(r.createdAt).toLocaleString('es-CL')}`,
    '',
    r.evaluation.summary,
    '',
    'CRITERIOS',
    ...r.evaluation.criteria.map(
      (c) =>
        `- ${c.name}: ${c.level === null ? 'No evaluado' : LEVEL_NAMES[c.level]} (${c.method ? METHOD_TEXT[c.method] : 'sin datos'}). ${c.observed}${c.evidence.length ? ` Evidencia: ${c.evidence.map((e) => `«${e.text}»`).join(' ')}` : ''}`,
    ),
    '',
    'EJERCICIOS RECOMENDADOS',
    ...r.exercises.map((e) => `- ${e.title}: ${e.steps.join(' ')} Verificación: ${e.verify}`),
    '',
    'CONVERSACIÓN',
    ...(r.snapshot?.turns ?? []).flatMap((t) => [
      `P (${r.snapshot?.config.participants.find((p) => p.id === t.question.speakerId)?.name ?? ''}): ${t.question.text}`,
      `R: ${t.answer?.text || '(sin texto)'}`,
      '',
    ]),
    ...(r.evaluation.notes.length ? ['NOTAS', ...r.evaluation.notes.map((n) => `- ${n}`)] : []),
  ];
  return lines.join('\n');
}

export function Report({
  record,
  liveMedia,
  onAgain,
  onExercise,
  onDeleted,
}: {
  record: PracticeRecord;
  liveMedia?: Blob | null;
  onAgain: () => void;
  onExercise: (e: Exercise) => void;
  onDeleted?: () => void;
}) {
  const scenario = SCENARIOS[record.scenario];
  const records = useRecords((s) => s.records);
  const [media, setMedia] = useState<Blob | null>(liveMedia ?? null),
    [mediaUrl, setMediaUrl] = useState(''),
    [deleting, setDeleting] = useState(false);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    if (liveMedia || !record.media) return;
    void recordMedia(record.id).then((b) => setMedia(b ?? null));
  }, [record.id, record.media, liveMedia]);
  useEffect(() => {
    if (!media) return;
    const url = URL.createObjectURL(media);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);
  const prev = useMemo(() => {
    const points = historyPoints(records);
    const me = points.find((p) => p.id === record.id) ?? historyPoints([record])[0]!;
    const p = previousComparable(points, me);
    return p ? records.find((r) => r.id === p.id) : undefined;
  }, [records, record]);
  const criteria = record.evaluation.criteria;
  const byDim = DIM_ORDER.map((d) => ({ d, items: criteria.filter((c) => c.dimension === d) })).filter(
    (x) => x.items.length,
  );
  const evaluated = criteria.filter((c) => c.level !== null);
  const turns = record.snapshot?.turns ?? [];
  const names = new Map(record.snapshot?.config.participants.map((p) => [p.id, p]) ?? []);
  const seek = (t: number) => {
    if (player.current) {
      player.current.currentTime = Math.max(0, t - 1);
      void player.current.play().catch(() => undefined);
    }
  };
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      grid: { left: 44, right: 50, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: record.report.timeline.map((t) => formatDuration(t.t)) },
      yAxis: [
        { type: 'value', min: 0, max: 100, name: '%' },
        { type: 'value', min: 0, name: 'ppm' },
      ],
      series: [
        {
          name: 'Voz activa (%)',
          type: 'line',
          showSymbol: false,
          data: record.report.timeline.map((t) => Math.round(t.speaking * 100)),
        },
        ...(record.report.cameraUsed
          ? [
              {
                name: 'Mirada (%)',
                type: 'line' as const,
                showSymbol: false,
                data: record.report.timeline.map((t) =>
                  t.contact === null ? null : Math.round(t.contact * 100),
                ),
              },
            ]
          : []),
        ...(record.report.transcriptUsed
          ? [
              {
                name: 'Palabras por minuto',
                type: 'line' as const,
                yAxisIndex: 1,
                showSymbol: false,
                data: record.report.timeline.map((t) => (t.wpm === null ? null : Math.round(t.wpm))),
              },
            ]
          : []),
      ],
    }),
    [record],
  );
  const total = Math.max(1, record.durationSec);
  const segments = record.report.answers.map((a, i, all) => ({
    start: i === 0 ? 0 : all[i - 1]!.endedAt,
    asked: a.askedAt,
    end: a.endedAt,
    i,
  }));
  const name = safeFilename(`${scenario.name}-${record.title}-${record.createdAt.slice(0, 10)}`);
  return (
    <>
      <PageHead
        eyebrow={`INFORME · ${scenario.name.toUpperCase()}`}
        title={record.title}
        description={`${new Date(record.createdAt).toLocaleString('es-CL')} · ${formatDuration(record.durationSec)} · ${record.engines.llm ? `interlocutores con ${record.engines.llm}` : 'interlocutores por reglas'}${record.engines.evaluator ? ` · evaluación con ${record.engines.evaluator}` : ''}`}
        action={
          <button className="button primary" onClick={onAgain}>
            <RotateCcw size={17} /> Practicar de nuevo
          </button>
        }
      />
      <div className="report-summary">
        <section className="panel">
          <span className="eyebrow">Resumen</span>
          <h2>Lo que se observó</h2>
          <p style={{ color: 'var(--text)', marginTop: 8 }}>{record.evaluation.summary}</p>
          <div className="metric-row compact" style={{ marginTop: 16 }}>
            <Metric
              label="Criterios evaluados"
              value={`${evaluated.length}/${criteria.length}`}
              detail="Los demás quedan como «No evaluado»"
            />
            <Metric label="Logrados o destacados" value={evaluated.filter((c) => c.level! >= 2).length} />
            <Metric label="Por practicar" value={evaluated.filter((c) => c.level! <= 1).length} />
            {record.evaluation.index && (
              <Metric
                label="Índice orientativo"
                value={record.evaluation.index.value}
                unit="/100"
                detail={`Cobertura ${record.evaluation.index.coverage} %`}
              />
            )}
          </div>
          <p className="caption">
            El índice resume niveles de criterios con distinto origen (mediciones, reglas e IA). Es una
            orientación para comparar tus propias sesiones, no una calificación ni una medición científica.
          </p>
          {record.goal && <p className="caption">Tu objetivo: {record.goal}</p>}
          {record.docNames.length > 0 && (
            <p className="caption">Material usado: {record.docNames.join(', ')}.</p>
          )}
        </section>
        <section className="panel">
          <span className="eyebrow">Entrenador</span>
          <h2>Qué practicar ahora</h2>
          {record.exercises.length ? (
            <div className="stack" style={{ marginTop: 10 }}>
              {record.exercises.map((e) => (
                <article className="coach-card" key={e.criterionId}>
                  <h3>{e.title}</h3>
                  <p>{e.why}</p>
                  <ol>
                    {e.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <p className="caption">Cómo se verificará: {e.verify}</p>
                  <div>
                    <button className="button secondary small" onClick={() => onExercise(e)}>
                      <Dumbbell size={15} /> Practicar este ejercicio
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>
              No quedaron criterios en nivel inicial o en desarrollo. Sube la dificultad o el temperamento de
              los interlocutores.
            </p>
          )}
        </section>
      </div>
      {prev && (
        <section className="panel">
          <h2>Comparación con tu sesión anterior</h2>
          <p className="caption">
            {SCENARIOS[prev.scenario].name} del {new Date(prev.createdAt).toLocaleDateString('es-CL')}. Solo
            se comparan criterios evaluados en ambas.
          </p>
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Criterio</th>
                  <th>Antes</th>
                  <th>Ahora</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {criteria
                  .map((c) => ({ c, b: prev.evaluation.criteria.find((x) => x.id === c.id) }))
                  .filter(({ c, b }) => compareCriterion(b, c) !== 'sin datos')
                  .map(({ c, b }) => {
                    const v = compareCriterion(b, c);
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{LEVEL_NAMES[b!.level!]}</td>
                        <td>{LEVEL_NAMES[c.level!]}</td>
                        <td className={`verdict ${v === 'mejoró' ? 'up' : v === 'empeoró' ? 'down' : ''}`}>
                          {v}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {byDim.map(({ d, items }) => (
        <section className="panel dimension-block" key={d}>
          <h2>{DIMENSION_NAMES[d]}</h2>
          <div className="criterion-grid" style={{ marginTop: 12 }}>
            {items.map((c) => (
              <article className={`criterion-card ${c.level === null ? 'not-evaluated' : ''}`} key={c.id}>
                <header>
                  <h3>{c.name}</h3>
                  <LevelDots level={c.level} />
                </header>
                <p className="observed">{c.observed}</p>
                {c.evidence.slice(0, 2).map((e, i) => (
                  <p className="evidence" key={i}>
                    {e.kind === 'cita' ? `«${e.text}»` : e.text}
                    {e.turn !== undefined && turns[e.turn] && <small> · turno {e.turn + 1}</small>}
                  </p>
                ))}
                <p className="why">Por qué importa: {c.why}</p>
                {c.level !== null && c.level <= 2 && (
                  <p className="improve">
                    <strong>Cómo mejorar:</strong> {c.improve}
                  </p>
                )}
                <span className="method-tag">
                  {c.method ? METHOD_TEXT[c.method] : 'No evaluado'} · {c.methodText}
                </span>
              </article>
            ))}
          </div>
        </section>
      ))}
      {mediaUrl && (
        <section className="panel">
          <h2>Mírate y escúchate</h2>
          <p className="caption">
            La grabación está en este equipo. Usa los botones «Ir al momento» para saltar a cada respuesta.
          </p>
          {media?.type.startsWith('video') ? (
            <video ref={player} className="replay" src={mediaUrl} controls playsInline />
          ) : (
            <audio ref={player} src={mediaUrl} controls />
          )}
        </section>
      )}
      {segments.length > 0 && (
        <section className="panel">
          <h2>Línea de tiempo de la conversación</h2>
          <div className="timeline">
            <div className="timeline-track" role="group" aria-label="Turnos de la conversación">
              {segments.map((s) => (
                <span key={s.i} style={{ display: 'contents' }}>
                  <button
                    className="seg-agent"
                    style={{ flex: Math.max(0.5, s.asked - s.start) }}
                    aria-label={`Pregunta ${s.i + 1} en ${formatDuration(s.asked)}`}
                    onClick={() => seek(s.asked)}
                  />
                  <button
                    className="seg-user"
                    style={{ flex: Math.max(0.5, s.end - s.asked) }}
                    aria-label={`Respuesta ${s.i + 1}: ${formatDuration(s.end - s.asked)}`}
                    onClick={() => seek(s.asked)}
                  />
                </span>
              ))}
              {total > (segments.at(-1)?.end ?? 0) && (
                <span className="seg-silence" style={{ flex: total - (segments.at(-1)?.end ?? 0) }} />
              )}
            </div>
            <div className="timeline-legend">
              <span>
                <i style={{ background: 'color-mix(in srgb, var(--accent) 55%, transparent)' }} />
                Interlocutores y exposición
              </span>
              <span>
                <i style={{ background: 'color-mix(in srgb, var(--primary) 70%, transparent)' }} />
                Tus respuestas
              </span>
            </div>
          </div>
        </section>
      )}
      {record.report.timeline.length > 1 && (
        <section className="panel">
          <h2>Voz, mirada y ritmo durante la práctica</h2>
          <p className="caption">Cada punto resume 30 segundos.</p>
          <Chart
            option={option}
            label="Gráfico por tramos de 30 segundos con voz activa, mirada y palabras por minuto cuando hubo datos."
          />
        </section>
      )}
      {turns.length > 0 && (
        <section className="panel">
          <h2>Preguntas, respuestas y fundamentos</h2>
          {turns.map((t, i) => {
            const p = names.get(t.question.speakerId);
            const a = record.report.answers[i];
            return (
              <div className="answer-review" key={t.question.id}>
                <span className="eyebrow">
                  {p?.name} · {t.question.kind} · {STAGE_TEXT[t.question.stage].name} ·{' '}
                  {t.question.generator === 'ia' ? 'IA' : 'reglas'}
                </span>
                <h3>{t.question.text}</h3>
                {t.question.reason && <p className="caption">Por qué se preguntó: {t.question.reason}</p>}
                {t.question.sources.map((s) => (
                  <blockquote className="source-quote" key={s.chunkId}>
                    <BookOpen size={13} /> «{s.excerpt}»
                    <small>
                      {s.docName} · {s.location}
                    </small>
                  </blockquote>
                ))}
                <p className="answer-text">{t.answer?.text || 'Sin texto reconocido para esta respuesta.'}</p>
                {t.answer && (
                  <div className="row-wrap" style={{ marginTop: 8 }}>
                    <span className="badge">{ANSWER_TYPE_TEXT[t.answer.analysis.type]}</span>
                    <span className="caption">
                      {t.answer.latencySec === null
                        ? 'sin voz detectada'
                        : `empezaste a los ${t.answer.latencySec.toFixed(1)} s`}{' '}
                      · {formatDuration(t.answer.durationSec)} · {t.answer.analysis.words} palabras
                      {t.answer.interrupted ? ' · te interrumpieron' : ''}
                    </span>
                    {mediaUrl && a && (
                      <button className="text-link" onClick={() => seek(a.askedAt)}>
                        <PlayCircle size={14} /> Ir al momento
                      </button>
                    )}
                  </div>
                )}
                {t.answer?.analysis.notes.length ? (
                  <p className="caption">{t.answer.analysis.notes.join(' ')}</p>
                ) : null}
              </div>
            );
          })}
        </section>
      )}
      <section className="panel">
        <h2>Guardar y exportar</h2>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() =>
              downloadBlob(
                new Blob([recordText(record)], { type: 'text/plain;charset=utf-8' }),
                `${name}.txt`,
              )
            }
          >
            <Download size={16} /> Informe (TXT)
          </button>
          <button
            className="button secondary"
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
                `${name}.json`,
              )
            }
          >
            <Download size={16} /> Datos (JSON)
          </button>
          {media && (
            <button
              className="button secondary"
              onClick={() =>
                downloadBlob(
                  media,
                  `${name}.${media.type.includes('mp4') ? 'mp4' : media.type.includes('ogg') ? 'ogg' : 'webm'}`,
                )
              }
            >
              <Download size={16} /> {media.type.startsWith('video') ? 'Video' : 'Audio'}
            </button>
          )}
          {onDeleted && (
            <button className="button quiet" onClick={() => setDeleting(true)}>
              <Trash2 size={16} /> Eliminar esta práctica
            </button>
          )}
        </div>
        {record.evaluation.notes.map((n) => (
          <p className="caption" key={n}>
            {n}
          </p>
        ))}
      </section>
      {record.diagnostics && <Diagnostics report={record.diagnostics} />}
      {deleting && onDeleted && (
        <Confirm title="¿Eliminar esta práctica?" onCancel={() => setDeleting(false)} onConfirm={onDeleted}>
          Se borrarán el informe y la grabación de este equipo.
        </Confirm>
      )}
    </>
  );
}

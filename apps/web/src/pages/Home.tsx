import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, ArrowRight, ShieldCheck, BookOpen, TrendingUp, Clock } from 'lucide-react';
import { formatDuration } from '@oratoria/core';
import { analyzeText } from '@oratoria/evaluation';
import { PageHead, Metric, Empty, Chart, StartLink, Alert } from '../components';
import { useSessions, usePreferences } from '../state';
export function Home() {
  const { sessions, loading, error } = useSessions(),
    goal = usePreferences((s) => s.goal);
  const [metric, setMetric] = useState<'pace' | 'fillers' | 'pauses'>('pace');
  const threshold = usePreferences((s) => s.threshold),
    fillers = usePreferences((s) => s.fillers);
  const audioSessions = sessions.filter((s) => s.audio),
    total = audioSessions.reduce((n, s) => n + s.audio!.duration, 0);
  const comparable = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.audio &&
            (metric === 'pauses'
              ? s.audio.thresholdDbfs === threshold
              : s.transcript && analyzeText(s.transcript, s.audio.duration, fillers).words > 0),
        )
        .slice(0, 20)
        .reverse(),
    [sessions, metric, threshold, fillers],
  );
  const values = useMemo(
    () =>
      comparable.map((s) =>
        metric === 'pauses'
          ? (s.audio!.pauses.length * 60) / s.audio!.duration
          : metric === 'fillers'
            ? analyzeText(s.transcript!, s.audio!.duration, fillers).fillersPer100Words!
            : analyzeText(s.transcript!, s.audio!.duration, fillers).wordsPerMinute!,
      ),
    [comparable, metric, fillers],
  );
  const unit = metric === 'pace' ? 'pal/min' : metric === 'fillers' ? 'por 100 palabras' : 'pausas/min';
  const option = useMemo(
    () => ({
      grid: { left: 48, top: 25, right: 22, bottom: 48 },
      tooltip: { trigger: 'axis' as const },
      xAxis: {
        type: 'category' as const,
        data: comparable.map((s) =>
          new Date(s.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }),
        ),
      },
      yAxis: { type: 'value' as const, name: unit, splitLine: { lineStyle: { color: '#7c929522' } } },
      series: [
        {
          type: 'line' as const,
          data: values.map((v) => Number(v.toFixed(1))),
          symbolSize: 8,
          lineStyle: { color: '#167a68', width: 3 },
          itemStyle: { color: '#167a68' },
        },
      ],
    }),
    [comparable, values, unit],
  );
  return (
    <>
      <PageHead
        eyebrow="TU ESPACIO DE PRÁCTICA"
        title="Tu voz, con perspectiva."
        description="Practica, escucha y encuentra tu siguiente paso. Tus datos se quedan contigo."
        action={<StartLink />}
      />
      {error && <Alert>{error}</Alert>}
      <section className="hero">
        <div>
          <span className="hero-label">
            <span className="dot" /> UN MOMENTO PARA TU VOZ
          </span>
          <h2>
            Las buenas ideas
            <br />
            merecen ser escuchadas.
          </h2>
          <p>
            Graba una intervención breve. Revisa lo que ocurrió y ensaya una nueva versión con un objetivo
            concreto.
          </p>
          <Link to="/studio" className="button lime">
            <Mic size={18} /> Abrir el estudio <ArrowRight size={18} />
          </Link>
          <span className="hero-note">
            <ShieldCheck size={15} /> Sin cuentas · Sin servicios de inferencia
          </span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orb">
            <Mic size={55} strokeWidth={1.3} />
          </div>
          <div className="art-caption">ORATORIA / LAB</div>
        </div>
      </section>
      <div className="metric-row">
        <Metric label="Sesiones guardadas" value={sessions.length} detail="Audio y prácticas guiadas" />
        <Metric
          label="Tiempo grabado"
          value={formatDuration(total)}
          detail="Duración real de audios analizados"
        />
        <Metric
          label="Prácticas con transcripción"
          value={sessions.filter((s) => s.transcript).length}
          detail="Manuales o con Whisper local"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">OBSERVA TUS REGISTROS</span>
              <h2>Indicadores a lo largo del tiempo</h2>
            </div>
            <TrendingUp size={20} />
          </div>
          <label className="field">
            Indicador del gráfico
            <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
              <option value="pace">Palabras por minuto de audio</option>
              <option value="fillers">Candidatos a muletilla por 100 palabras</option>
              <option value="pauses">Pausas internas por minuto</option>
            </select>
          </label>
          {comparable.length ? (
            <>
              <Chart
                option={option}
                label={`${unit}: ${comparable.length} grabaciones reales. Los valores también están disponibles en la tabla.`}
              />
              <p className="caption">
                {metric === 'pauses'
                  ? `Solo audios con el mismo umbral: ${threshold} dBFS.`
                  : metric === 'fillers'
                    ? 'Se aplica tu diccionario actual a todas las transcripciones guardadas.'
                    : 'Palabras / duración total del audio.'}{' '}
                Compara objetivos y condiciones similares; un cambio no implica mejora.
              </p>
              <details>
                <summary>Ver datos del gráfico</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Sesión</th>
                      <th>{unit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparable.map((s, i) => (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/session/${s.id}`}>{s.title}</Link>
                        </td>
                        <td>{values[i]?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <Empty title="Tu evolución empieza con una práctica">
              {metric === 'pauses'
                ? `Guarda audios analizados con el umbral de ${threshold} dBFS para comparar pausas.`
                : 'El gráfico aparecerá cuando guardes audios con una transcripción.'}{' '}
              No hay datos de ejemplo.
            </Empty>
          )}
        </section>
        <section className="panel focus-panel">
          <span className="eyebrow">UN OBJETIVO A LA VEZ</span>
          <h2>¿Qué quieres practicar?</h2>
          <p>
            {goal ||
              'Elige una idea pequeña: explicar un resultado, construir un cierre o responder una pregunta con evidencia.'}
          </p>
          <Link to="/settings" className="text-link">
            {goal ? 'Editar mi objetivo' : 'Definir mi objetivo'} <ArrowRight size={16} />
          </Link>
          <div className="divider" />
          <BookOpen size={23} />
          <h3>Ensaya tu defensa de tesis</h3>
          <p>Preguntas guiadas sobre el problema, la metodología, los resultados y sus límites.</p>
          <Link to="/practice" className="button secondary">
            Explorar prácticas <ArrowUp />
          </Link>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">RETOMA DONDE LO DEJASTE</span>
            <h2>Prácticas recientes</h2>
          </div>
          <Link to="/history" className="text-link">
            Ver historial <ArrowRight size={16} />
          </Link>
        </div>
        {loading ? (
          <p role="status">Leyendo sesiones locales…</p>
        ) : sessions.length ? (
          <div className="session-list">
            {sessions.slice(0, 4).map((s) => (
              <Link className="session-row" to={`/session/${s.id}`} key={s.id}>
                <span className="session-symbol">{s.audio ? <Mic size={20} /> : <BookOpen size={20} />}</span>
                <div>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(s.createdAt).toLocaleString('es-CL')} ·{' '}
                    {s.source === 'guided' ? 'Práctica guiada' : 'Audio local'}
                  </small>
                </div>
                <span className="duration">
                  <Clock size={14} />
                  {s.audio ? formatDuration(s.audio.duration) : 'Texto'}
                </span>
                <ArrowRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="Todavía no hay sesiones">
            Tu primera grabación aparecerá aquí cuando la guardes.
          </Empty>
        )}
      </section>
    </>
  );
}
function ArrowUp() {
  return <ArrowRight size={16} />;
}

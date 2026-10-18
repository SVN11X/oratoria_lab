import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Dumbbell, TrendingUp } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import {
  SCENARIOS,
  SCENARIO_ORDER,
  LEVEL_NAMES,
  DIMENSION_NAMES,
  compareCriterion,
  prioritySkills,
  previousComparable,
  type ProgressVerdict,
  type ScenarioId,
} from '@oratoria/conversation';
import { formatDuration } from '@oratoria/core';
import { PageHead, Empty, Metric, Alert, Chart } from '../components';
import { useRecords, historyPoints, type PracticeRecord } from '../practice/records';

const VERDICT_CLASS: Record<ProgressVerdict, string> = {
  mejoró: 'up',
  'se mantiene': '',
  empeoró: 'down',
  'sin datos': '',
};
const date = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });

/**
 * Mi progreso: evolución por escenario y criterio, habilidades prioritarias y el siguiente ejercicio.
 * Solo compara sesiones del mismo escenario, porque los criterios cambian entre prácticas.
 */
export function Progress() {
  const { records, loading, error, reload } = useRecords();
  const [scenario, setScenario] = useState<ScenarioId | 'todas'>('todas');
  useEffect(() => {
    void reload();
  }, [reload]);
  const used = useMemo(
    () => SCENARIO_ORDER.filter((id) => records.some((r) => r.scenario === id)),
    [records],
  );
  const list = useMemo(
    () =>
      records
        .filter((r) => scenario === 'todas' || r.scenario === scenario)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [records, scenario],
  );
  const points = useMemo(() => historyPoints(list), [list]);
  const skills = useMemo(() => prioritySkills(points, 6), [points]);
  const last = list.at(-1);
  const lastPoint = last ? points.at(-1) : undefined;
  const previous = lastPoint ? previousComparable(points, lastPoint) : undefined;
  const comparison = useMemo(() => {
    if (!last || !previous) return [];
    return last.evaluation.criteria
      .map((c) => {
        const before = previous.criteria.find((p) => p.id === c.id);
        return {
          id: c.id,
          name: c.name,
          before: before?.level ?? null,
          after: c.level,
          verdict: compareCriterion(before, c),
        };
      })
      .filter((c) => c.verdict !== 'sin datos');
  }, [last, previous]);
  const improved = comparison.filter((c) => c.verdict === 'mejoró').length,
    worse = comparison.filter((c) => c.verdict === 'empeoró').length;

  const indexChart = useMemo<EChartsOption | null>(() => {
    const scenarios = scenario === 'todas' ? used : [scenario];
    const dated = list.filter((r) => r.evaluation.index);
    if (dated.length < 2) return null;
    const labels = dated.map((r) => `${date(r.createdAt)} · ${r.id.slice(0, 4)}`);
    return {
      grid: { left: 44, right: 16, top: 36, bottom: 40 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0 },
      xAxis: { type: 'category', data: labels, axisLabel: { formatter: (v: string) => v.split(' · ')[0]! } },
      yAxis: { type: 'value', min: 0, max: 100, name: 'Índice' },
      series: scenarios.map((id) => ({
        name: SCENARIOS[id].name,
        type: 'line',
        connectNulls: true,
        symbolSize: 8,
        data: dated.map((r) => (r.scenario === id ? r.evaluation.index!.value : null)),
      })),
    };
  }, [list, scenario, used]);

  const [criterion, setCriterion] = useState('');
  const criterionIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of list)
      for (const c of r.evaluation.criteria) if (c.level !== null && !seen.has(c.id)) seen.set(c.id, c.name);
    return [...seen];
  }, [list]);
  const chosen = criterionIds.some(([id]) => id === criterion)
    ? criterion
    : (skills[0]?.id ?? criterionIds[0]?.[0] ?? '');
  const criterionChart = useMemo<EChartsOption | null>(() => {
    const rows = list
      .map((r) => ({ r, c: r.evaluation.criteria.find((c) => c.id === chosen) }))
      .filter((x) => x.c && x.c.level !== null);
    if (rows.length < 2) return null;
    return {
      grid: { left: 110, right: 16, top: 16, bottom: 40 },
      tooltip: { trigger: 'axis', valueFormatter: (v) => (typeof v === 'number' ? LEVEL_NAMES[v]! : '') },
      xAxis: {
        type: 'category',
        data: rows.map((x) => `${date(x.r.createdAt)} · ${x.r.id.slice(0, 4)}`),
        axisLabel: { formatter: (v: string) => v.split(' · ')[0]! },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 3,
        interval: 1,
        axisLabel: { formatter: (v: number) => LEVEL_NAMES[v] ?? '' },
      },
      series: [{ type: 'line', step: 'middle', symbolSize: 9, data: rows.map((x) => x.c!.level) }],
    };
  }, [list, chosen]);

  const totalSec = list.reduce((n, r) => n + r.durationSec, 0);
  const recent = list.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 30 * 864e5).length;
  const nextExercise = last?.exercises[0];
  const dimensions = useMemo(() => {
    if (!last) return [];
    const by = new Map<string, { total: number; good: number; weak: number }>();
    for (const c of last.evaluation.criteria) {
      if (c.level === null) continue;
      const e = by.get(c.dimension) ?? { total: 0, good: 0, weak: 0 };
      e.total++;
      if (c.level >= 2) e.good++;
      else e.weak++;
      by.set(c.dimension, e);
    }
    return [...by].map(([dim, e]) => ({ dim: dim as keyof typeof DIMENSION_NAMES, ...e }));
  }, [last]);

  return (
    <>
      <PageHead
        eyebrow="MI PROGRESO"
        title="Cómo evolucionan tus habilidades."
        description="Cada criterio se compara con tu sesión anterior del mismo tipo de práctica. Los criterios sin datos no cuentan como bajos."
        action={
          <label className="field" style={{ margin: 0, minWidth: 220 }}>
            Práctica
            <select value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
              <option value="todas">Todas las prácticas</option>
              {SCENARIO_ORDER.map((id) => (
                <option key={id} value={id} disabled={!used.includes(id)}>
                  {SCENARIOS[id].name}
                  {used.includes(id) ? '' : ' (sin sesiones)'}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {error && <Alert>{error}</Alert>}
      {loading ? (
        <p role="status">Leyendo tus prácticas…</p>
      ) : !list.length ? (
        <Empty
          title="Aún no hay progreso que mostrar"
          action={
            <Link className="button primary" to="/practice">
              Elegir una práctica
            </Link>
          }
        >
          Completa al menos dos prácticas guiadas del mismo tipo para ver tendencias y comparaciones.
        </Empty>
      ) : (
        <>
          <div className="metric-row">
            <Metric label="Prácticas" value={list.length} detail={`${recent} en los últimos 30 días`} />
            <Metric label="Tiempo practicado" value={formatDuration(totalSec)} />
            <Metric
              label="Índice de la última sesión"
              value={last?.evaluation.index ? last.evaluation.index.value : 'Sin datos'}
              unit={last?.evaluation.index ? ' / 100' : ''}
              detail={
                last?.evaluation.index
                  ? `Cobertura de criterios: ${last.evaluation.index.coverage} %`
                  : undefined
              }
            />
            <Metric
              label="Frente a la sesión anterior"
              value={previous ? `${improved} ↑ · ${worse} ↓` : 'Sin comparación'}
              detail={
                previous ? 'Criterios que mejoraron y empeoraron' : 'Necesitas otra sesión del mismo tipo'
              }
            />
          </div>
          <div className="grid-2">
            <section className="panel">
              <span className="eyebrow">
                <TrendingUp size={13} /> Índice general por sesión
              </span>
              {indexChart ? (
                <Chart option={indexChart} label="Evolución del índice general por sesión y práctica" />
              ) : (
                <p className="caption" style={{ marginTop: 8 }}>
                  Se mostrará cuando tengas dos o más sesiones con criterios evaluados.
                </p>
              )}
              <p className="caption">
                El índice pondera solo los criterios evaluados. Una cobertura baja significa que hubo pocos
                datos, no un mal desempeño.
              </p>
            </section>
            <section className="panel">
              <div className="section-heading">
                <span className="eyebrow">Evolución de un criterio</span>
                {criterionIds.length > 0 && (
                  <label className="field" style={{ margin: 0, minWidth: 200 }}>
                    <span className="sr-only">Criterio</span>
                    <select
                      value={chosen}
                      onChange={(e) => setCriterion(e.target.value)}
                      aria-label="Criterio"
                    >
                      {criterionIds.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {criterionChart ? (
                <Chart
                  option={criterionChart}
                  label={`Nivel del criterio ${criterionIds.find(([id]) => id === chosen)?.[1] ?? ''} por sesión`}
                />
              ) : (
                <p className="caption" style={{ marginTop: 8 }}>
                  Este criterio necesita al menos dos sesiones con datos.
                </p>
              )}
            </section>
          </div>
          <div className="grid-2">
            <section className="panel">
              <span className="eyebrow">Habilidades prioritarias</span>
              {skills.length ? (
                <div className="skill-list">
                  {skills.map((s) => (
                    <div className="skill-item" key={s.id}>
                      <div>
                        <strong>{s.name}</strong>
                        <small style={{ display: 'block' }}>
                          Por practicar en {s.weak} de {s.seen} sesiones · último nivel:{' '}
                          {s.last === null ? 'sin datos' : LEVEL_NAMES[s.last]}
                        </small>
                      </div>
                      <span className="skill-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((1 - s.rate) * 100)}%` }} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="caption" style={{ marginTop: 8 }}>
                  No hay criterios que se repitan en nivel inicial o en desarrollo.
                </p>
              )}
            </section>
            <section className="panel">
              <span className="eyebrow">
                <Dumbbell size={13} /> Siguiente ejercicio
              </span>
              {nextExercise && last ? (
                <ExerciseCard record={last} />
              ) : (
                <>
                  <h2>Sigue practicando con más dificultad</h2>
                  <p>
                    Tu última sesión no dejó criterios en nivel inicial o en desarrollo. Prueba un nivel de
                    dificultad más alto o un temperamento más exigente.
                  </p>
                  {last && (
                    <div className="actions">
                      <Link className="button secondary" to={`/practice/${last.scenario}`}>
                        Configurar práctica <ArrowRight size={16} />
                      </Link>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
          {last && previous && comparison.length > 0 && (
            <section className="panel">
              <span className="eyebrow">Última sesión frente a la anterior comparable</span>
              <p className="caption">
                {SCENARIOS[last.scenario].name} · {new Date(previous.createdAt).toLocaleDateString('es-CL')}{' '}
                frente a {new Date(last.createdAt).toLocaleDateString('es-CL')}
                {previous.difficulty !== last.difficulty ? ' · Atención: las dificultades no coinciden' : ''}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Criterio</th>
                      <th scope="col">Antes</th>
                      <th scope="col">Ahora</th>
                      <th scope="col">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((c) => (
                      <tr key={c.id}>
                        <th scope="row">{c.name}</th>
                        <td>{c.before === null ? 'Sin datos' : LEVEL_NAMES[c.before]}</td>
                        <td>{c.after === null ? 'Sin datos' : LEVEL_NAMES[c.after]}</td>
                        <td>
                          <span className={`verdict ${VERDICT_CLASS[c.verdict]}`}>{c.verdict}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {dimensions.length > 0 && (
            <section className="panel">
              <span className="eyebrow">Balance de la última sesión por dimensión</span>
              <div className="hw-grid" style={{ marginTop: 10 }}>
                {dimensions.map((d) => (
                  <div key={d.dim}>
                    <strong>{DIMENSION_NAMES[d.dim]}</strong>
                    {d.good} de {d.total} criterios logrados · {d.weak} por practicar
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function ExerciseCard({ record }: { record: PracticeRecord }) {
  const e = record.exercises[0]!;
  return (
    <>
      <h2>{e.title}</h2>
      <p>{e.why}</p>
      <ol className="plain-list">
        {e.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="caption">Cómo se verificará: {e.verify}</p>
      <div className="actions">
        <Link className="button secondary" to={`/practice/${record.scenario}`} state={{ exercise: e }}>
          <Dumbbell size={16} /> Practicar este ejercicio
        </Link>
      </div>
    </>
  );
}

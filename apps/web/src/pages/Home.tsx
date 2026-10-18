import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Mic, Dumbbell, Cpu } from 'lucide-react';
import { SCENARIOS, SCENARIO_ORDER, LEVEL_NAMES, prioritySkills } from '@oratoria/conversation';
import { formatDuration } from '@oratoria/core';
import { PageHead, Empty, Metric, Alert } from '../components';
import { useSessions } from '../state';
import { useRecords, historyPoints } from '../practice/records';
import { useAiStatus } from '../ai/status';
import { SCENARIO_ICON } from './Practices';

export function Home() {
  const { sessions } = useSessions();
  const { records, loading, error, reload } = useRecords();
  const status = useAiStatus();
  useEffect(() => {
    void reload();
  }, [reload]);
  const last = records[0];
  const skills = useMemo(() => prioritySkills(historyPoints(records)), [records]);
  const totalSec =
    records.reduce((n, r) => n + r.durationSec, 0) +
    sessions.reduce((n, s) => n + (s.audio?.duration ?? 0), 0);
  const recommended = last?.exercises[0];
  return (
    <>
      <PageHead
        eyebrow="INICIO"
        title="Entrena para conversaciones que importan."
        description="Simulaciones con interlocutores que escuchan, preguntan y repreguntan. Todo se procesa en tu equipo."
      />
      {error && <Alert>{error}</Alert>}
      <div className="hero">
        <section className="hero-main">
          <span
            className="badge"
            style={{
              background: 'rgb(255 255 255 / 14%)',
              color: '#fff',
              borderColor: 'transparent',
              width: 'fit-content',
            }}
          >
            <GraduationCap size={14} /> Recomendado para tu tesis
          </span>
          <h2>Ensaya tu defensa frente a una comisión que conoce tu documento.</h2>
          <p>
            Carga tu tesis y tu presentación; la comisión preguntará citando páginas y secciones, con el
            temperamento y la dificultad que elijas.
          </p>
          <div className="row-wrap">
            <Link to="/practice/tesis" className="button light">
              Preparar mi defensa <ArrowRight size={17} />
            </Link>
            <Link to="/practice" className="button ghost-light">
              Ver las seis prácticas
            </Link>
          </div>
        </section>
        <div className="hero-side">
          <section className="panel" style={{ marginBottom: 0 }}>
            <span className="eyebrow">Habilidades prioritarias</span>
            {skills.length ? (
              <div className="skill-list">
                {skills.map((s) => (
                  <div className="skill-item" key={s.id}>
                    <div>
                      <strong>{s.name}</strong>
                      <small style={{ display: 'block' }}>
                        Por practicar en {s.weak} de {s.seen} sesiones · último nivel:{' '}
                        {s.last === null ? '—' : LEVEL_NAMES[s.last]}
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
                Aparecerán después de tu primera práctica guiada.
              </p>
            )}
          </section>
          <Link to="/settings/models" className="panel" style={{ marginBottom: 0, display: 'grid', gap: 6 }}>
            <span className="eyebrow">
              <Cpu size={13} /> Estado del sistema de IA
            </span>
            <span className="row-wrap">
              <span className={`dot ${status.llm === 'ok' ? 'on' : status.llm === 'off' ? '' : 'warn'}`} />{' '}
              {status.llmText}
            </span>
            <span className="row-wrap">
              <span className={`dot ${status.stt === 'local' ? 'on' : 'warn'}`} /> {status.sttText}
            </span>
          </Link>
        </div>
      </div>
      <div className="metric-row">
        <Metric label="Prácticas guiadas" value={records.length} />
        <Metric label="Grabaciones analizadas" value={sessions.length} />
        <Metric label="Tiempo practicado" value={formatDuration(totalSec)} />
        <Metric label="Escenarios usados" value={new Set(records.map((r) => r.scenario)).size} unit=" de 6" />
      </div>
      <div className="grid-2">
        <section className="panel">
          <span className="eyebrow">Última sesión</span>
          {loading ? (
            <p role="status">Leyendo historial…</p>
          ) : last ? (
            <>
              <h2>{last.title}</h2>
              <p>
                {SCENARIOS[last.scenario].name} · {new Date(last.createdAt).toLocaleString('es-CL')} ·{' '}
                {formatDuration(last.durationSec)}
              </p>
              <p style={{ marginTop: 8, color: 'var(--text)' }}>{last.evaluation.summary}</p>
              <div className="actions">
                <Link className="button secondary" to={`/practice/record/${last.id}`}>
                  Ver informe <ArrowRight size={16} />
                </Link>
                <Link className="button quiet" to={`/practice/${last.scenario}`}>
                  Repetir
                </Link>
              </div>
            </>
          ) : (
            <Empty
              title="Todavía no hay prácticas"
              action={
                <Link className="button primary" to="/practice">
                  Elegir una práctica
                </Link>
              }
            >
              Tu primera sesión aparecerá aquí con su informe.
            </Empty>
          )}
        </section>
        <section className="panel">
          <span className="eyebrow">
            <Dumbbell size={13} /> Ejercicio recomendado
          </span>
          {recommended ? (
            <>
              <h2>{recommended.title}</h2>
              <p>{recommended.why}</p>
              <ol className="plain-list">
                {recommended.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div className="actions">
                <Link
                  className="button secondary"
                  to={`/practice/${last!.scenario}`}
                  state={{ exercise: recommended }}
                >
                  Practicarlo
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Una práctica libre de dos minutos</h2>
              <p>
                Graba una explicación breve de tu trabajo y revisa velocidad, pausas, muletillas y estructura.
              </p>
              <div className="actions">
                <Link className="button secondary" to="/practice/libre">
                  <Mic size={16} /> Práctica libre
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <span className="eyebrow">Prácticas disponibles</span>
        <div className="scenario-grid" style={{ marginTop: 12, marginBottom: 0 }}>
          {SCENARIO_ORDER.map((id) => {
            const Icon = SCENARIO_ICON[id];
            return (
              <Link key={id} to={`/practice/${id}`} className="scenario" style={{ minHeight: 0 }}>
                <span className="scenario-icon">
                  <Icon size={20} />
                </span>
                <h3>{SCENARIOS[id].name}</h3>
                <p>{SCENARIOS[id].short}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}

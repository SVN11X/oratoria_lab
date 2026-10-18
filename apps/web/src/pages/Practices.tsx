import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  GraduationCap,
  Briefcase,
  Presentation,
  Scale,
  BookOpen,
  MessagesSquare,
  Mic,
  Upload,
} from 'lucide-react';
import {
  SCENARIOS,
  SCENARIO_ORDER,
  LEVEL_NAMES,
  type Exercise,
  type ScenarioId,
} from '@oratoria/conversation';
import { errorMessage } from '@oratoria/core';
import { PageHead, Alert } from '../components';
import { Setup } from '../practice/Setup';
import { Room } from '../practice/Room';
import { Report } from '../practice/Report';
import { usePractice, setupFor, type PracticeSetup } from '../practice/store';
import { deleteRecord, saveRecord, useRecords, type PracticeRecord } from '../practice/records';

export const SCENARIO_ICON: Record<ScenarioId, typeof GraduationCap> = {
  tesis: GraduationCap,
  entrevista: Briefcase,
  presentacion: Presentation,
  debate: Scale,
  educativa: BookOpen,
  dificil: MessagesSquare,
};

export function Practices() {
  const { records, reload } = useRecords();
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <>
      <PageHead
        eyebrow="PRÁCTICAS GUIADAS"
        title="Elige con quién quieres practicar."
        description="Seis simulaciones con interlocutores que escuchan, preguntan, repreguntan y te evalúan con evidencias. También puedes practicar sin interlocutores o analizar una grabación."
      />
      <div className="scenario-grid">
        {SCENARIO_ORDER.map((id) => {
          const s = SCENARIOS[id],
            Icon = SCENARIO_ICON[id];
          const last = records.find((r) => r.scenario === id);
          return (
            <Link to={`/practice/${id}`} className={`scenario ${id === 'tesis' ? 'featured' : ''}`} key={id}>
              <span className="scenario-icon">
                <Icon size={22} />
              </span>
              <h2>{s.name}</h2>
              <p>{s.short}</p>
              {last ? (
                <small>
                  Última: {new Date(last.createdAt).toLocaleDateString('es-CL')} ·{' '}
                  {last.evaluation.criteria.filter((c) => c.level !== null && c.level <= 1).length} criterios
                  por practicar
                </small>
              ) : (
                <small>Sin sesiones todavía</small>
              )}
              <span className="scenario-cta">
                Configurar <ArrowRight size={15} />
              </span>
            </Link>
          );
        })}
      </div>
      <h2 style={{ marginBottom: 12 }}>Sin interlocutores</h2>
      <div className="scenario-grid">
        <Link to="/practice/libre" className="scenario">
          <span className="scenario-icon">
            <Mic size={22} />
          </span>
          <h2>Práctica libre</h2>
          <p>
            Graba una intervención y recibe análisis de voz, pausas, muletillas, estructura y recomendaciones.
          </p>
          <span className="scenario-cta">
            Grabar <ArrowRight size={15} />
          </span>
        </Link>
        <Link to="/practice/analizar" className="scenario">
          <span className="scenario-icon">
            <Upload size={22} />
          </span>
          <h2>Analizar una grabación</h2>
          <p>
            Importa un audio o video que ya tengas (WAV, MP3, OGG, WebM, MP4) y analízalo igual que una
            práctica.
          </p>
          <span className="scenario-cta">
            Importar <ArrowRight size={15} />
          </span>
        </Link>
      </div>
    </>
  );
}

/** Recorrido de una práctica: configurar → simular → informe → practicar de nuevo. */
export function PracticeFlow() {
  const { scenario } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState<Exercise | null>(
    () => (location.state as { exercise?: Exercise } | null)?.exercise ?? null,
  );
  const id = (SCENARIO_ORDER as string[]).includes(scenario ?? '') ? (scenario as ScenarioId) : null;
  const [view, setView] = useState<'setup' | 'run' | 'report'>('setup'),
    [record, setRecord] = useState<PracticeRecord | null>(null),
    [media, setMedia] = useState<Blob | null>(null),
    [runSetup, setRunSetup] = useState<PracticeSetup | null>(null),
    [error, setError] = useState('');
  const update = usePractice((s) => s.update);
  useEffect(() => {
    if (view !== 'run') return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [view]);
  if (!id)
    return (
      <>
        <Alert>Esa práctica no existe.</Alert>
        <Link className="button secondary" to="/practice">
          Volver a Prácticas guiadas
        </Link>
      </>
    );
  function start(override?: Partial<PracticeSetup>) {
    const base = setupFor(id!);
    setRunSetup({ ...base, ...override });
    setRecord(null);
    setMedia(null);
    setView('run');
    window.scrollTo({ top: 0 });
  }
  function exercise(e: Exercise) {
    const { difficulty, ...rest } = e.preset;
    const base = setupFor(id!);
    start({
      ...rest,
      participants: difficulty ? base.participants.map((p) => ({ ...p, difficulty })) : base.participants,
      goal: `Ejercicio: ${e.title}`,
    });
  }
  if (view === 'run' && runSetup)
    return (
      <Room
        setup={runSetup}
        onCancel={() => setView('setup')}
        onFinish={(r, m) => {
          setRecord(r);
          setMedia(m);
          setView('report');
          window.scrollTo({ top: 0 });
          const keep = runSetup.record && m && m.size <= 400 * 1024 * 1024 ? m : null;
          void saveRecord({ ...r, media: keep ? { type: keep.type, bytes: keep.size } : null }, keep).catch(
            (e) => setError(`El informe no se pudo guardar: ${errorMessage(e)}`),
          );
        }}
      />
    );
  if (view === 'report' && record)
    return (
      <>
        {error && <Alert>{error}</Alert>}
        <Report
          record={record}
          liveMedia={media}
          onAgain={() => setView('setup')}
          onExercise={exercise}
          onDeleted={() =>
            void deleteRecord(record.id).then(() => {
              setView('setup');
              navigate(`/practice/${id}`);
            })
          }
        />
      </>
    );
  return (
    <>
      {pending && (
        <Alert tone="info">
          Ejercicio elegido: <strong>{pending.title}</strong>. Al comenzar se aplicará su configuración.{' '}
          {pending.why}{' '}
          <button className="text-link" onClick={() => setPending(null)}>
            Quitar ejercicio
          </button>
        </Alert>
      )}
      <Setup
        scenarioId={id}
        onStart={() => {
          update(id, {});
          if (pending) {
            const e = pending;
            setPending(null);
            exercise(e);
          } else start();
        }}
      />
    </>
  );
}

/** Informe guardado, abierto desde el historial. */
export function SavedReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { records, loading, reload } = useRecords();
  useEffect(() => {
    void reload();
  }, [reload]);
  const record = records.find((r) => r.id === id);
  if (loading) return <p role="status">Abriendo informe…</p>;
  if (!record)
    return (
      <>
        <Alert>No se encontró esta práctica en este equipo.</Alert>
        <Link className="button secondary" to="/history">
          Volver al historial
        </Link>
      </>
    );
  return (
    <Report
      record={record}
      onAgain={() => navigate(`/practice/${record.scenario}`)}
      onExercise={(e) => navigate(`/practice/${record.scenario}`, { state: { exercise: e } })}
      onDeleted={() => void deleteRecord(record.id).then(() => navigate('/history'))}
    />
  );
}
export { LEVEL_NAMES };

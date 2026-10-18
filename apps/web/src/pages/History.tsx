import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Mic, ArrowRight, Trash2, Upload } from 'lucide-react';
import { SCENARIOS, SCENARIO_ORDER, type ScenarioId } from '@oratoria/conversation';
import { formatDuration, errorMessage } from '@oratoria/core';
import { store } from '@oratoria/storage';
import { PageHead, Empty, Confirm, Alert } from '../components';
import { useSessions } from '../state';
import { BackupImport } from '../BackupControls';
import { deleteRecord, useRecords } from '../practice/records';
import { SCENARIO_ICON } from './Practices';

type Item =
  | {
      kind: 'practice';
      id: string;
      title: string;
      createdAt: string;
      scenario: ScenarioId;
      duration: number;
      detail: string;
    }
  | { kind: 'audio'; id: string; title: string; createdAt: string; duration: number | null; detail: string };

/** Historial unificado: prácticas guiadas y grabaciones analizadas. */
export function History() {
  const { sessions, loading, error, reload } = useSessions();
  const records = useRecords();
  const [query, setQuery] = useState(''),
    [type, setType] = useState<'todo' | 'audio' | ScenarioId>('todo'),
    [deleting, setDeleting] = useState<Item | null>(null),
    [failure, setFailure] = useState(''),
    [restored, setRestored] = useState<string | null>(null);
  useEffect(() => {
    void records.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const items = useMemo<Item[]>(
    () =>
      [
        ...records.records.map((r): Item => ({
          kind: 'practice',
          id: r.id,
          title: r.title,
          createdAt: r.createdAt,
          scenario: r.scenario,
          duration: r.durationSec,
          detail: `${SCENARIOS[r.scenario].name}${r.legacy ? ' (versión anterior)' : ''} · ${r.evaluation.criteria.filter((c) => c.level !== null && c.level <= 1).length} criterios por practicar`,
        })),
        ...sessions.map((s): Item => ({
          kind: 'audio',
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          duration: s.audio?.duration ?? null,
          detail: `${s.source === 'guided' ? 'Práctica escrita (versión anterior)' : s.source === 'import' ? 'Grabación importada' : 'Práctica libre'} · ${s.transcript ? 'con transcripción' : 'sin transcripción'}`,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records.records, sessions],
  );
  const q = query.toLocaleLowerCase('es');
  const filtered = items.filter(
    (i) =>
      (type === 'todo' ||
        (type === 'audio' ? i.kind === 'audio' : i.kind === 'practice' && i.scenario === type)) &&
      (i.title.toLocaleLowerCase('es').includes(q) || i.detail.toLocaleLowerCase('es').includes(q)),
  );
  async function remove() {
    if (!deleting) return;
    try {
      if (deleting.kind === 'practice') await deleteRecord(deleting.id);
      else {
        await store.remove(deleting.id);
        await reload();
      }
      setDeleting(null);
    } catch (e) {
      setFailure(errorMessage(e));
      setDeleting(null);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="HISTORIAL"
        title="Todas tus sesiones."
        description="Prácticas guiadas con su informe y grabaciones analizadas. Todo está guardado en este equipo."
        action={
          <BackupImport
            onRestored={(id) => {
              setRestored(id);
              void reload();
            }}
          />
        }
      />
      {(error || failure || records.error) && <Alert>{error || failure || records.error}</Alert>}
      {restored && (
        <div className="status-line" role="status">
          Copia restaurada como sesión nueva.{' '}
          <Link className="text-link" to={`/session/${restored}`}>
            Abrir sesión
          </Link>
        </div>
      )}
      <section className="panel">
        <div className="filter-bar">
          <div className="search-field" style={{ flex: 1, minWidth: 220 }}>
            <Search size={18} />
            <input
              aria-label="Buscar sesiones"
              placeholder="Buscar por nombre o práctica…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="field">
            Tipo
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="todo">Todas</option>
              {SCENARIO_ORDER.map((id) => (
                <option key={id} value={id}>
                  {SCENARIOS[id].name}
                </option>
              ))}
              <option value="audio">Grabaciones analizadas</option>
            </select>
          </label>
          <span className="caption">{filtered.length} sesiones</span>
        </div>
        {loading || records.loading ? (
          <p role="status">Leyendo historial…</p>
        ) : filtered.length ? (
          <div className="session-list">
            {filtered.map((s) => {
              const Icon =
                s.kind === 'practice'
                  ? SCENARIO_ICON[s.scenario]
                  : s.detail.startsWith('Grabación importada')
                    ? Upload
                    : Mic;
              const to = s.kind === 'practice' ? `/practice/record/${s.id}` : `/session/${s.id}`;
              return (
                <div className="session-row" key={`${s.kind}-${s.id}`}>
                  <span className="session-symbol">
                    <Icon size={20} />
                  </span>
                  <Link className="session-description" to={to}>
                    <strong>{s.title}</strong>
                    <small>
                      {new Date(s.createdAt).toLocaleString('es-CL')} · {s.detail}
                    </small>
                  </Link>
                  <span className="duration">
                    {s.duration !== null ? formatDuration(s.duration) : 'Texto'}
                  </span>
                  <div className="row-actions">
                    <Link className="icon-button" to={to} aria-label={`Abrir ${s.title}`}>
                      <ArrowRight size={18} />
                    </Link>
                    <button
                      className="icon-button"
                      aria-label={`Eliminar ${s.title}`}
                      onClick={() => setDeleting(s)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            title={
              query || type !== 'todo' ? 'No hay sesiones con ese filtro' : 'Tu historial está por comenzar'
            }
            action={
              <Link className="button primary" to="/practice">
                Ir a Prácticas guiadas
              </Link>
            }
          >
            {query || type !== 'todo'
              ? 'Prueba con otro nombre o tipo.'
              : 'Completa una práctica guiada o graba una práctica libre.'}
          </Empty>
        )}
      </section>
      {deleting && (
        <Confirm
          title="¿Eliminar la sesión?"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        >
          Se eliminarán de este equipo el informe, la grabación y la transcripción de «{deleting.title}».
        </Confirm>
      )}
    </>
  );
}

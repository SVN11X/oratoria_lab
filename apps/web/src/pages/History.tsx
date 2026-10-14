import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Mic, BookOpen, ArrowRight, Trash2 } from 'lucide-react';
import { formatDuration, errorMessage } from '@oratoria/core';
import { store } from '@oratoria/storage';
import { PageHead, Empty, StartLink, Confirm, Alert } from '../components';
import { useSessions } from '../state';
import { BackupImport } from '../BackupControls';
export function History() {
  const { sessions, loading, error, reload } = useSessions(),
    [query, setQuery] = useState(''),
    [deleting, setDeleting] = useState<string | null>(null),
    [failure, setFailure] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const filtered = sessions.filter((s) =>
    s.title.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')),
  );
  async function remove() {
    if (!deleting) return;
    try {
      await store.remove(deleting);
      setDeleting(null);
      await reload();
    } catch (e) {
      setFailure(errorMessage(e));
      setDeleting(null);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="HISTORIAL LOCAL"
        title="Cada práctica cuenta."
        description="Retoma tus grabaciones, revisa tus hallazgos y conserva los datos que necesites."
        action={
          <div className="actions">
            <BackupImport
              onRestored={(id) => {
                setRestored(id);
                void reload();
              }}
            />
            <StartLink />
          </div>
        }
      />
      {(error || failure) && <Alert>{error || failure}</Alert>}
      {restored && (
        <div className="status-line" role="status">
          Copia restaurada como sesión nueva.{' '}
          <Link className="text-link" to={`/session/${restored}`}>
            Abrir sesión
          </Link>
        </div>
      )}
      <section className="panel">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Buscar sesiones por nombre"
            placeholder="Buscar una práctica…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>{filtered.length} sesiones</span>
        </div>
        {loading ? (
          <p role="status">Leyendo historial…</p>
        ) : filtered.length ? (
          <div className="session-list">
            {filtered.map((s) => (
              <div className="session-row" key={s.id}>
                <span className="session-symbol">{s.audio ? <Mic size={20} /> : <BookOpen size={20} />}</span>
                <Link className="session-description" to={`/session/${s.id}`}>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(s.createdAt).toLocaleString('es-CL')} ·{' '}
                    {s.transcript ? 'Con transcripción' : 'Sin transcripción'}
                  </small>
                </Link>
                <span className="duration">{s.audio ? formatDuration(s.audio.duration) : 'Texto'}</span>
                <Link className="icon-button" to={`/session/${s.id}`} aria-label={`Abrir ${s.title}`}>
                  <ArrowRight size={18} />
                </Link>
                <button
                  className="icon-button"
                  aria-label={`Eliminar ${s.title}`}
                  onClick={() => setDeleting(s.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title={query ? 'No encontramos esa práctica' : 'Tu historial está por comenzar'}>
            {query
              ? 'Prueba con otro nombre.'
              : 'Graba un audio o completa una práctica guiada para comenzar.'}
          </Empty>
        )}
      </section>
      {deleting && (
        <Confirm
          title="¿Eliminar la sesión?"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        >
          Se eliminarán el audio, la transcripción y las evaluaciones de esta sesión en este dispositivo.
        </Confirm>
      )}
    </>
  );
}

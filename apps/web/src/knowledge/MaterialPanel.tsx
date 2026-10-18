import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Upload, Trash2, Sparkles, ListTree, GitCompare, CircleAlert } from 'lucide-react';
import { errorMessage } from '@oratoria/core';
import type { CompareFinding } from '@oratoria/knowledge';
import { Alert, Confirm } from '../components';
import { useAi } from '../ai/settings';
import {
  DOC_KIND_TEXT,
  compareDocs,
  embedDocuments,
  guessKind,
  importDocument,
  listDocuments,
  removeDocument,
  vectorCoverage,
  type DocKind,
  type ImportProgress,
  type SourceDoc,
} from './library';

const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown,.tex,application/pdf,text/plain,text/markdown';
const fmtBytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;

/**
 * Material académico de la práctica. Los archivos se procesan y guardan en este equipo; no hay
 * límite de caracteres: el texto se segmenta y se busca lo pertinente para cada pregunta.
 */
export function MaterialPanel({
  selected,
  onChange,
  hint,
  compact = false,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  hint: string;
  compact?: boolean;
}) {
  const [docs, setDocs] = useState<SourceDoc[]>([]),
    [progress, setProgress] = useState<ImportProgress | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [over, setOver] = useState(false),
    [deleting, setDeleting] = useState<SourceDoc | null>(null),
    [outline, setOutline] = useState<string | null>(null),
    [coverage, setCoverage] = useState<{ model: string; have: number; total: number } | null>(null),
    [embedding, setEmbedding] = useState<{ done: number; total: number } | null>(null),
    [comparison, setComparison] = useState<CompareFinding[] | null>(null);
  const ai = useAi();
  const abort = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const all = await listDocuments();
    setDocs(all);
    return all;
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(errorMessage(e)));
    return () => abort.current?.abort();
  }, [refresh]);
  useEffect(() => {
    void vectorCoverage(selected)
      .then(setCoverage)
      .catch(() => setCoverage(null));
  }, [selected, ai.assign.embeddings, embedding]);
  async function add(files: FileList | File[]) {
    setError('');
    setStatus('');
    const added: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const doc = await importDocument(file, guessKind(file.name), setProgress);
        added.push(doc.id);
        if (doc.warnings.some((w) => /escaneado|no tiene texto/.test(w)))
          setError(`${file.name}: ${doc.warnings.join(' ')}`);
      } catch (e) {
        setError(`${file.name}: ${errorMessage(e)}`);
      }
    }
    setProgress(null);
    await refresh();
    if (added.length) {
      onChange([...new Set([...selected, ...added])]);
      setStatus(
        `${added.length} archivo${added.length === 1 ? '' : 's'} listo${added.length === 1 ? '' : 's'} y seleccionado${added.length === 1 ? '' : 's'} para esta práctica.`,
      );
    }
  }
  async function setKind(doc: SourceDoc, kind: DocKind) {
    const { libraryStore } = await import('@oratoria/storage');
    await libraryStore.update({ ...doc, kind } as never);
    await refresh();
  }
  async function embed() {
    setError('');
    abort.current = new AbortController();
    try {
      const r = await embedDocuments(
        selected,
        (done, total) => setEmbedding({ done, total }),
        abort.current.signal,
      );
      setStatus(
        r.embedded
          ? `Búsqueda por significado lista: ${r.embedded} fragmentos procesados con ${ai.assign.embeddings}.`
          : 'Todos los fragmentos ya estaban procesados.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setEmbedding(null);
      abort.current = null;
    }
  }
  async function compare() {
    const main = docs.find((d) => selected.includes(d.id) && d.kind === 'tesis');
    const slides = docs.find((d) => selected.includes(d.id) && d.kind === 'presentacion');
    if (!main || !slides) return;
    setComparison((await compareDocs(main.id, slides.id)).findings);
  }
  const chosen = docs.filter((d) => selected.includes(d.id));
  const canCompare = chosen.some((d) => d.kind === 'tesis') && chosen.some((d) => d.kind === 'presentacion');
  const totalChars = chosen.reduce((n, d) => n + d.chars, 0);
  return (
    <div>
      {error && <Alert>{error}</Alert>}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
      >
        <Upload size={22} />
        <strong>Arrastra archivos o elígelos</strong>
        <p className="caption">
          {hint} PDF, DOCX, PPTX, TXT, Markdown o LaTeX. Se procesan en este equipo, sin límite de caracteres.
        </p>
        <label className="button secondary file-pick">
          <FileText size={16} /> Elegir archivos
          <input
            type="file"
            multiple
            accept={ACCEPT}
            aria-label="Elegir archivos de material académico"
            onChange={(e) => {
              if (e.target.files?.length) void add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {progress && (
          <p className="caption" role="status">
            <span className="spinner" />{' '}
            {progress.phase === 'leyendo'
              ? 'Leyendo'
              : progress.phase === 'extrayendo'
                ? 'Extrayendo texto'
                : progress.phase === 'segmentando'
                  ? 'Dividiendo por secciones'
                  : 'Guardando'}
            : {progress.detail}
          </p>
        )}
      </div>
      {docs.length > 0 && (
        <div className="doc-list" role="group" aria-label="Documentos disponibles">
          {docs.map((d) => (
            <div className="doc-item" key={d.id}>
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                aria-label={`Usar ${d.name} en esta práctica`}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))
                }
              />
              <div>
                <strong>{d.name}</strong>
                <small>
                  {d.pages ? `${d.pages} páginas · ` : d.slides ? `${d.slides} diapositivas · ` : ''}
                  {d.chars.toLocaleString('es-CL')} caracteres · {d.chunks} fragmentos · {fmtBytes(d.bytes)}
                </small>
                {!compact && (
                  <label className="field" style={{ margin: '6px 0 0' }}>
                    <span className="sr-only">Tipo de {d.name}</span>
                    <select value={d.kind} onChange={(e) => void setKind(d, e.target.value as DocKind)}>
                      {Object.entries(DOC_KIND_TEXT).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {d.warnings
                  .filter((w) => !/no guarda números de página/.test(w))
                  .map((w) => (
                    <small key={w}>
                      <CircleAlert size={12} /> {w}
                    </small>
                  ))}
              </div>
              <div className="row-wrap">
                {d.outline.length > 0 && (
                  <button
                    className="icon-button"
                    aria-label={`Ver estructura de ${d.name}`}
                    onClick={() => setOutline(outline === d.id ? null : d.id)}
                  >
                    <ListTree size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Eliminar ${d.name}`}
                  onClick={() => setDeleting(d)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {outline === d.id && (
                <ul className="plain-list" style={{ gridColumn: '1 / -1' }}>
                  {d.outline.slice(0, 60).map((o, i) => (
                    <li key={i} style={{ marginLeft: (o.level - 1) * 14 }}>
                      {o.heading} <small>{o.location}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {chosen.length > 0 && (
        <p className="caption">
          {chosen.length} documento{chosen.length === 1 ? '' : 's'} seleccionado
          {chosen.length === 1 ? '' : 's'} · {totalChars.toLocaleString('es-CL')} caracteres. Para cada
          pregunta se buscan los fragmentos pertinentes y se cita su ubicación.
        </p>
      )}
      {chosen.length > 0 && ai.useLlm && ai.assign.embeddings && coverage && coverage.total > 0 && (
        <div className="actions">
          {coverage.have < coverage.total ? (
            <button className="button secondary" onClick={() => void embed()} disabled={!!embedding}>
              <Sparkles size={16} />{' '}
              {embedding
                ? `Procesando ${embedding.done} de ${embedding.total}…`
                : `Activar búsqueda por significado (${coverage.total - coverage.have} fragmentos)`}
            </button>
          ) : (
            <span className="badge success">Búsqueda por significado lista ({coverage.model})</span>
          )}
          {embedding && (
            <button className="button quiet" onClick={() => abort.current?.abort()}>
              Cancelar
            </button>
          )}
        </div>
      )}
      {chosen.length > 0 && (!ai.useLlm || !ai.assign.embeddings) && (
        <p className="caption">
          Sin modelo de embeddings, la búsqueda usa coincidencia de palabras (BM25). Puedes asignar uno en
          Configuración → Modelos de IA.
        </p>
      )}
      {canCompare && (
        <div className="actions">
          <button className="button secondary" onClick={() => void compare()}>
            <GitCompare size={16} /> Comparar presentación con el documento
          </button>
        </div>
      )}
      {comparison && (
        <div className="panel soft" style={{ marginTop: 12 }}>
          <h3>Revisión de la presentación</h3>
          {comparison.length ? (
            <ul className="plain-list">
              {comparison.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          ) : (
            <p>No se encontraron diferencias con estas reglas.</p>
          )}
          <p className="caption">
            Reglas de coincidencia de términos y cifras: señalan puntos para revisar, no errores confirmados.
          </p>
        </div>
      )}
      {deleting && (
        <Confirm
          title={`¿Eliminar «${deleting.name}»?`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void removeDocument(id).then(async () => {
              onChange(selected.filter((x) => x !== id));
              await refresh();
              setStatus('Documento eliminado de este equipo, con sus fragmentos y vectores.');
            });
          }}
        >
          Se borrarán el archivo, su texto extraído y sus vectores de este equipo. Las prácticas ya guardadas
          conservan sus citas.
        </Confirm>
      )}
    </div>
  );
}

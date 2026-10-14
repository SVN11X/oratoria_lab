import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Archive, Download, LockKeyhole, Upload, X } from 'lucide-react';
import { errorMessage, formatDuration, type Session } from '@oratoria/core';
import { downloadBlob, MAX_BACKUP_BYTES, type RestoredSession } from '@oratoria/export';
import { store } from '@oratoria/storage';
import { Alert } from './components';
import { runBackupTask } from './backup-task';

function BackupDialog({
  title,
  onClose,
  children,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    heading = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm backup-dialog"
      aria-labelledby={heading}
      onCancel={(e) => {
        if (closeDisabled) e.preventDefault();
        else onClose();
      }}
    >
      <button
        type="button"
        className="icon-button close"
        aria-label="Cerrar copia de seguridad"
        onClick={onClose}
        disabled={closeDisabled}
      >
        <X size={18} />
      </button>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}
export function BackupExport({
  session,
  audio,
  disabled,
}: {
  session: Session;
  audio: Blob | null;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [encrypted, setEncrypted] = useState(true);
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  function close() {
    operation.current?.abort();
    operation.current = null;
    setPassword('');
    setConfirmation('');
    setError('');
    setPhase('');
    setBusy(false);
    setOpen(false);
  }
  async function prepare() {
    if (encrypted && password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await runBackupTask(
        { kind: 'export', session, audio, password: encrypted ? password : undefined },
        controller.signal,
        setPhase,
      );
      if (controller.signal.aborted) return;
      if (result.kind !== 'export') throw new Error('No se pudo preparar la copia.');
      downloadBlob(result.file, result.filename);
      setStatus('Copia preparada para descargar. Puedes restaurarla desde el historial.');
      close();
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setPhase('');
        operation.current = null;
      }
    }
  }
  return (
    <>
      <button
        className="button secondary"
        disabled={disabled}
        onClick={() => {
          setStatus('');
          setOpen(true);
        }}
      >
        <Archive size={16} /> Copia completa
      </button>
      {status && (
        <span className="caption" role="status">
          {status}
        </span>
      )}
      {open && (
        <BackupDialog title="Copia de esta sesión" onClose={close}>
          <p>
            Incluye el audio original, el texto guardado, las métricas y la valoración con su rúbrica. Los
            modelos y las preferencias del dispositivo se conservan por separado.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
          >
            <label className="field">
              Protección del archivo
              <select
                value={encrypted ? 'encrypted' : 'plain'}
                disabled={busy}
                onChange={(e) => {
                  setEncrypted(e.target.value === 'encrypted');
                  setPassword('');
                  setConfirmation('');
                  setError('');
                }}
              >
                <option value="encrypted">Con contraseña</option>
                <option value="plain">Sin contraseña</option>
              </select>
            </label>
            {encrypted ? (
              <>
                <label className="field">
                  Contraseña de la copia
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={1024}
                    value={password}
                    disabled={busy}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="field">
                  Repetir contraseña
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={1024}
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <p className="caption">
                  Usa una frase larga de al menos 12 caracteres. Conserva la contraseña: la aplicación no
                  puede recuperarla. Se cifra todo el contenido del archivo.
                </p>
              </>
            ) : (
              <p className="caption">
                El archivo permite leer tu audio, texto y resultados sin contraseña. Elige dónde conservarlo.
              </p>
            )}
            {error && <Alert>{error}</Alert>}
            {busy && (
              <div className="status-line" role="status">
                <span className="spinner" />
                {phase || 'Preparando copia…'}
              </div>
            )}
            <div className="actions">
              <button type="button" className="button secondary" onClick={close}>
                {busy ? 'Cancelar' : 'Cerrar'}
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {encrypted ? <LockKeyhole size={16} /> : <Download size={16} />} Preparar descarga
              </button>
            </div>
          </form>
        </BackupDialog>
      )}
    </>
  );
}
export function BackupImport({ onRestored }: { onRestored: (id: string) => void }) {
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState(''),
    [locked, setLocked] = useState(false);
  const [preview, setPreview] = useState<RestoredSession | null>(null);
  const [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const operation = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  function close() {
    operation.current?.abort();
    operation.current = null;
    setFile(null);
    setPassword('');
    setLocked(false);
    setPreview(null);
    setError('');
    setPhase('');
    setBusy(false);
    setOpen(false);
  }
  async function inspect(selected: File, secret?: string) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setPreview(null);
    setError('');
    setBusy(true);
    try {
      if (selected.size > MAX_BACKUP_BYTES) throw new Error('Selecciona una copia de hasta 60 MiB.');
      const result = await runBackupTask(
        { kind: 'import', file: selected, password: secret },
        controller.signal,
        setPhase,
      );
      if (controller.signal.aborted) return;
      if (result.kind === 'password-required') setLocked(true);
      else if (result.kind === 'import') {
        setPreview(result);
        setPassword('');
        setLocked(false);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setPhase('');
        operation.current = null;
      }
    }
  }
  async function restore() {
    if (!preview) return;
    setBusy(true);
    setSaving(true);
    setError('');
    setPhase('Guardando una nueva copia local…');
    const id = crypto.randomUUID();
    try {
      await store.save({ ...preview.session, id }, preview.audio ?? undefined);
      if (!alive.current) return;
      setSaving(false);
      close();
      onRestored(id);
    } catch (e) {
      if (alive.current) {
        setError(errorMessage(e));
        setBusy(false);
        setSaving(false);
        setPhase('');
      }
    }
  }
  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)}>
        <Upload size={16} /> Restaurar copia
      </button>
      {open && (
        <BackupDialog title="Restaurar una sesión" onClose={close} closeDisabled={saving}>
          <p>
            Selecciona un archivo creado con «Copia completa». Se revisa en este dispositivo antes de
            guardarlo como sesión nueva.
          </p>
          <label className="field">
            Archivo de copia
            <input
              type="file"
              accept=".oratoria,.json,application/json"
              disabled={busy}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                setFile(selected ?? null);
                setPassword('');
                setLocked(false);
                setPreview(null);
                setError('');
                if (selected) void inspect(selected);
              }}
            />
          </label>
          {locked && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (file) void inspect(file, password);
              }}
            >
              <label className="field">
                Contraseña para abrir la copia
                <input
                  type="password"
                  autoComplete="off"
                  required
                  minLength={12}
                  maxLength={1024}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="button secondary" type="submit" disabled={busy}>
                <LockKeyhole size={16} /> Abrir copia cifrada
              </button>
            </form>
          )}
          {error && <Alert>{error}</Alert>}
          {busy && (
            <div className="status-line" role="status">
              <span className="spinner" />
              {phase || 'Revisando copia…'}
            </div>
          )}
          {preview && (
            <div className="backup-preview">
              <h3>{preview.session.title}</h3>
              <p>{new Date(preview.session.createdAt).toLocaleString('es-CL')}</p>
              <ul>
                <li>
                  {preview.audio
                    ? `Audio original: ${(preview.audio.size / 1024 / 1024).toFixed(2)} MiB${preview.session.audio ? ` · ${formatDuration(preview.session.audio.duration)}` : ''}`
                    : 'Práctica escrita, sin grabación'}
                </li>
                <li>
                  {preview.session.transcript
                    ? `${preview.session.transcript.segments.length} segmentos · revisión ${preview.session.transcript.revision}`
                    : 'Sin transcripción'}
                </li>
                <li>
                  {preview.session.evaluation
                    ? `Valoración manual: ${preview.session.evaluation.rubric.name} v${preview.session.evaluation.rubric.version}`
                    : 'Sin valoración'}
                </li>
              </ul>
              <p className="caption">
                Se conserva la fecha de la práctica. Las sesiones existentes permanecen guardadas. La
                validación comprueba coherencia e integridad; no certifica el origen de los resultados.
              </p>
            </div>
          )}
          <div className="actions">
            <button type="button" className="button secondary" onClick={close} disabled={saving}>
              {busy && operation.current ? 'Cancelar' : 'Cerrar'}
            </button>
            <button className="button primary" disabled={busy || !preview} onClick={() => void restore()}>
              <Archive size={16} /> Guardar como sesión nueva
            </button>
          </div>
        </BackupDialog>
      )}
    </>
  );
}

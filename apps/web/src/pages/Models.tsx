import { useEffect, useRef, useState } from 'react';
import { Download, ShieldCheck, HardDrive, Trash2, Cpu, ExternalLink } from 'lucide-react';
import {
  WHISPER,
  downloadModel,
  modelAvailable,
  verifyModel,
  removeModel,
  type DownloadProgress,
} from '@oratoria/model-manager';
import { errorMessage } from '@oratoria/core';
import { basePath } from '../services';
import { PageHead, Alert, Confirm } from '../components';
export function Models() {
  const [available, setAvailable] = useState(false),
    [verified, setVerified] = useState(false),
    [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [deleting, setDeleting] = useState(false);
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void modelAvailable(basePath)
      .then((v) => {
        if (alive.current) setAvailable(v);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  async function install() {
    setBusy(true);
    setError('');
    setVerified(false);
    controller.current = new AbortController();
    try {
      await downloadModel(basePath, controller.current.signal, (p) => {
        if (alive.current) setProgress(p);
      });
      if (alive.current) {
        setAvailable(true);
        setVerified(true);
        setStatus('Modelo instalado. Todos los archivos coinciden con sus hashes SHA-256.');
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      controller.current = null;
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  async function verify() {
    setBusy(true);
    setError('');
    try {
      const ok = await verifyModel(basePath, (p) => {
        if (alive.current) setProgress(p);
      });
      if (alive.current) {
        setVerified(ok);
        setStatus(
          ok ? 'Integridad SHA-256 verificada.' : 'Hay archivos ausentes o dañados. Reinstala el modelo.',
        );
        if (!ok) setAvailable(false);
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      controller.current = null;
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  return (
    <>
      <PageHead
        eyebrow="MODELOS LOCALES"
        title="Instala solo lo que necesitas."
        description="Grabar y analizar audio no requiere modelos. Whisper añade transcripción local en español."
      />
      {error && <Alert>{error}</Alert>}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      <section className="panel model-panel">
        <div className="model-icon">
          <Cpu size={30} />
        </div>
        <div className="model-body">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RECONOCIMIENTO DE VOZ / MULTILINGÜE</span>
              <h2>{WHISPER.name}</h2>
            </div>
            <span className={`badge ${verified ? 'success' : ''}`}>
              {verified ? 'Integridad verificada' : available ? 'Archivos presentes' : 'Sin instalar'}
            </span>
          </div>
          <p>
            Modelo compacto para una primera transcripción. Puede equivocarse con nombres, ruido, variedades
            regionales y números; revisa siempre el resultado.
          </p>
          <div className="model-facts">
            <span>
              <HardDrive size={16} />
              {(WHISPER.totalBytes / 1024 / 1024).toFixed(1)} MiB (
              {WHISPER.totalBytes.toLocaleString('es-CL')} bytes)
            </span>
            <span>
              <Cpu size={16} />
              WASM · CPU · sin WebGPU obligatorio
            </span>
            <span>
              <ShieldCheck size={16} />
              SHA-256 por archivo
            </span>
          </div>
          <p className="caption">
            RAM estimada: {WHISPER.estimatedRam}. Descarga desde Hugging Face y sus hosts de archivos; esos
            hosts reciben la solicitud de descarga y tu IP. El audio nunca forma parte de esa solicitud. No
            hay descargas automáticas.
          </p>
          <details>
            <summary>Procedencia, licencia y archivos</summary>
            <p>
              {WHISPER.license}. Revisión fijada: <code>{WHISPER.revision}</code>.
            </p>
            <div className="actions">
              <a className="text-link" href={WHISPER.sourceUrl} target="_blank" rel="noreferrer">
                Repositorio del modelo <ExternalLink size={14} />
              </a>
              <a className="text-link" href={WHISPER.licenseUrl} target="_blank" rel="noreferrer">
                Licencia original <ExternalLink size={14} />
              </a>
            </div>
            <ul className="model-files">
              {WHISPER.files.map((f) => (
                <li key={f.path}>
                  <strong>{f.path}</strong>
                  <span>{(f.bytes / 1024).toFixed(1)} KiB</span>
                  <code>{f.sha256}</code>
                </li>
              ))}
            </ul>
          </details>
          {progress && (
            <div className="download-progress" role="status">
              <progress max={progress.total} value={progress.received} />
              <p>
                {progress.phase === 'verify' ? 'Comprobando' : 'Descargando'} {progress.file} ·{' '}
                {Math.floor((progress.received * 100) / progress.total)} % de bytes
              </p>
            </div>
          )}
          <div className="actions">
            <button className="button primary" onClick={install} disabled={busy}>
              <Download size={17} />
              {available
                ? 'Reinstalar / reparar'
                : `Descargar ${Math.round(WHISPER.totalBytes / 1000000)} MB`}
            </button>
            {available && (
              <button className="button secondary" onClick={verify} disabled={busy}>
                <ShieldCheck size={17} /> Verificar integridad
              </button>
            )}
            {available && (
              <button className="button quiet" onClick={() => setDeleting(true)} disabled={busy}>
                <Trash2 size={17} /> Eliminar modelo
              </button>
            )}
            {busy && controller.current && (
              <button className="button secondary" onClick={() => controller.current?.abort()}>
                Cancelar descarga
              </button>
            )}
          </div>
        </div>
      </section>
      <section className="panel">
        <h2>Capacidades futuras</h2>
        <p>
          Evaluación con LLM, análisis visual y síntesis de voz siguen pendientes. Las prácticas actuales
          utilizan preguntas fijas y las rúbricas se valoran manualmente. No hay un modelo descargado para
          esas capacidades.
        </p>
      </section>
      {deleting && (
        <Confirm
          title="¿Eliminar Whisper?"
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            void removeModel()
              .then(() => {
                setAvailable(false);
                setVerified(false);
                setDeleting(false);
                setStatus('Modelo eliminado. Tus sesiones y transcripciones se conservaron.');
              })
              .catch((e) => {
                setError(errorMessage(e));
                setDeleting(false);
              });
          }}
        >
          Se borrarán los archivos del modelo. Para volver a transcribir, necesitarás descargarlo otra vez.
        </Confirm>
      )}
    </>
  );
}

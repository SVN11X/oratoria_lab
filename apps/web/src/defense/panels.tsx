import { useEffect, useRef, useState } from 'react';
import { Camera, Download, Trash2, Sparkles, PlugZap, ExternalLink, ShieldCheck } from 'lucide-react';
import { errorMessage } from '@oratoria/core';
import { Alert } from '../components';
import { VISION, installVision, removeVision, visionStatus, type VisionProgress } from './vision';
import { LLM_PRESETS, testLlm } from './llm';
import { useDefense } from './store';

export function useVisionInstalled() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const refresh = () => visionStatus().then((s) => setInstalled(s.installed));
  useEffect(() => {
    void refresh();
  }, []);
  return { installed, refresh };
}
export function VisionPanel({ compact = false }: { compact?: boolean }) {
  const { installed, refresh } = useVisionInstalled();
  const [progress, setProgress] = useState<VisionProgress | null>(null),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [prints, setPrints] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    void visionStatus().then((s) => setPrints(s.prints));
    return () => controller.current?.abort();
  }, [installed]);
  async function install() {
    setError('');
    setStatus('');
    controller.current = new AbortController();
    try {
      await installVision(controller.current.signal, setProgress);
      setStatus('Modelos de cámara instalados. Se guardó su huella SHA-256 para comprobarlos en cada uso.');
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      controller.current = null;
      setProgress(null);
    }
  }
  const pinned = VISION.models.every((m) => m.sha256);
  const total = VISION.models.reduce((n, m) => n + (m.bytes ?? m.approxBytes), 0);
  return (
    <section className={`panel model-panel ${compact ? 'compact-panel' : ''}`}>
      <div className="model-icon">
        <Camera size={30} />
      </div>
      <div className="model-body">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CÁMARA / MIRADA, GESTOS Y POSTURA</span>
            <h2>MediaPipe: rostro y postura</h2>
          </div>
          <span className={`badge ${installed ? 'success' : ''}`}>
            {installed === null ? 'Revisando…' : installed ? 'Instalado' : 'Sin instalar'}
          </span>
        </div>
        {error && <Alert>{error}</Alert>}
        {status && (
          <p className="status-line" role="status">
            {status}
          </p>
        )}
        <p>
          Permite que el simulador de defensa mida hacia dónde miras, si te llevas las manos a la cara, cuánto
          gesticulas y si te balanceas. La imagen se analiza en tu equipo y nunca se envía.
        </p>
        <div className="model-facts">
          <span>Unos {Math.round(total / 1000000)} MB</span>
          <span>Se descarga de Google (storage.googleapis.com)</span>
          <span>
            <ShieldCheck size={16} /> {pinned ? 'SHA-256 fijado' : 'Huella SHA-256 registrada al instalar'}
          </span>
        </div>
        {!compact && (
          <details>
            <summary>Procedencia, licencia y huellas</summary>
            <p>
              {VISION.runtime}. Licencia {VISION.license}. El motor WASM se incluye en la app; solo los dos
              modelos se descargan.{' '}
              {!pinned &&
                'Para fijar el hash oficial en el código, ejecuta «pnpm pin:vision» en el proyecto y guarda el cambio.'}
            </p>
            <div className="actions">
              <a className="text-link" href={VISION.sourceUrl} target="_blank" rel="noreferrer">
                Documentación de MediaPipe <ExternalLink size={14} />
              </a>
              <a className="text-link" href={VISION.licenseUrl} target="_blank" rel="noreferrer">
                Licencia <ExternalLink size={14} />
              </a>
            </div>
            <ul className="model-files">
              {VISION.models.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  <span>{m.bytes ? `${(m.bytes / 1024).toFixed(1)} KiB` : 'tamaño al descargar'}</span>
                  <code>{m.sha256 ?? prints[m.id] ?? 'sin instalar'}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
        {progress && (
          <div className="download-progress" role="status">
            <progress max={progress.total} value={Math.min(progress.received, progress.total)} />
            <p>
              Descargando {progress.file} ·{' '}
              {Math.min(100, Math.floor((progress.received * 100) / progress.total))} %
            </p>
          </div>
        )}
        <div className="actions">
          <button className="button primary" onClick={install} disabled={!!progress}>
            <Download size={17} /> {installed ? 'Reinstalar' : `Descargar ${Math.round(total / 1000000)} MB`}
          </button>
          {progress && (
            <button className="button secondary" onClick={() => controller.current?.abort()}>
              Cancelar descarga
            </button>
          )}
          {installed && !progress && (
            <button
              className="button quiet"
              onClick={() =>
                void removeVision()
                  .then(refresh)
                  .then(() => setStatus('Modelos de cámara eliminados.'))
              }
            >
              <Trash2 size={17} /> Eliminar
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
export function LlmPanel({ compact = false }: { compact?: boolean }) {
  const { llm, updateLlm } = useDefense();
  const [testing, setTesting] = useState(false),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  const preset =
    LLM_PRESETS.find((p) => p.baseUrl && p.baseUrl === llm.baseUrl) ?? LLM_PRESETS[LLM_PRESETS.length - 1]!;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(llm.baseUrl);
  async function test() {
    setTesting(true);
    setError('');
    setResult('');
    try {
      await testLlm({ ...llm, enabled: true });
      setResult('Conexión correcta. La comisión usará este modelo para preguntar y repreguntar.');
      updateLlm({ enabled: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }
  return (
    <section className={`panel model-panel ${compact ? 'compact-panel' : ''}`}>
      <div className="model-icon">
        <Sparkles size={30} />
      </div>
      <div className="model-body">
        <div className="section-heading">
          <div>
            <span className="eyebrow">COMISIÓN CON IA / OPCIONAL</span>
            <h2>Preguntas sobre lo que expusiste</h2>
          </div>
          <span className={`badge ${llm.enabled ? 'success' : ''}`}>
            {llm.enabled ? 'Activada' : 'Sin conectar'}
          </span>
        </div>
        <p>
          Con un modelo de lenguaje, la comisión escucha tu exposición, formula preguntas sobre lo que
          dijiste, repregunta cuando una respuesta queda débil y comenta el contenido. Sin conectarlo, usa un
          banco de preguntas de defensa y términos tomados de tu resumen.
        </p>
        {error && <Alert>{error}</Alert>}
        {result && (
          <p className="status-line" role="status">
            {result}
          </p>
        )}
        <div className="form-grid">
          <label className="field">
            Servicio
            <select
              value={preset.id}
              onChange={(e) => {
                const p = LLM_PRESETS.find((x) => x.id === e.target.value)!;
                updateLlm({ baseUrl: p.baseUrl, model: p.model, enabled: false });
                setResult('');
              }}
            >
              {LLM_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Modelo
            <input
              value={llm.model}
              placeholder="nombre del modelo"
              onChange={(e) => updateLlm({ model: e.target.value, enabled: false })}
            />
          </label>
          <label className="field">
            Dirección del servicio
            <input
              value={llm.baseUrl}
              placeholder="https://…/v1"
              onChange={(e) => updateLlm({ baseUrl: e.target.value, enabled: false })}
            />
          </label>
          <label className="field">
            Clave de API {local ? '(no se necesita)' : ''}
            <input
              type="password"
              autoComplete="off"
              value={llm.apiKey}
              placeholder={local ? 'vacía' : 'pega tu clave'}
              onChange={(e) => updateLlm({ apiKey: e.target.value, enabled: false })}
            />
          </label>
        </div>
        <p className="caption">
          {preset.help}{' '}
          {local
            ? 'Si abres la app desde GitHub Pages, configura en Ollama la variable OLLAMA_ORIGINS con la dirección de la página.'
            : 'La clave queda guardada solo en este navegador. Cualquiera con acceso a este perfil del navegador podría verla.'}
        </p>
        <div className="actions">
          <button className="button primary" onClick={test} disabled={testing}>
            <PlugZap size={17} /> {testing ? 'Probando…' : 'Probar y activar'}
          </button>
          {llm.enabled && (
            <button className="button quiet" onClick={() => updateLlm({ enabled: false })}>
              Desactivar
            </button>
          )}
          {llm.apiKey && (
            <button className="button quiet" onClick={() => updateLlm({ apiKey: '', enabled: false })}>
              Borrar clave
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { ShieldCheck, Save, HardDrive, WifiOff } from 'lucide-react';
import { isDesktop } from '@oratoria/storage';
import { errorMessage } from '@oratoria/core';
import { usePreferences } from '../state';
import { offlineStatus, prepareOffline, type OfflineProgress } from '../offline';
import { PageHead, Alert } from '../components';
export function Settings() {
  const preferences = usePreferences(),
    [goal, setGoal] = useState(preferences.goal),
    [fillers, setFillers] = useState(preferences.fillers.join(', ')),
    [threshold, setThreshold] = useState(preferences.threshold);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null),
    [offline, setOffline] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false),
    [offlineProgress, setOfflineProgress] = useState<OfflineProgress | null>(null);
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then(setEstimate)
      .catch((e) => setError(errorMessage(e)));
    if (import.meta.env.PROD && !isDesktop())
      void offlineStatus()
        .then((r) => setOffline(!!r?.ready))
        .catch(() => setOffline(false));
  }, []);
  async function persistStorage() {
    try {
      const granted = await navigator.storage?.persist();
      setStatus(
        granted
          ? 'El navegador concedió almacenamiento persistente. Mantén copias exportadas.'
          : 'El navegador no concedió persistencia. Exporta las sesiones que quieras conservar.',
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function prepare() {
    setPreparing(true);
    setError('');
    try {
      const result = await prepareOffline(setOfflineProgress);
      setOffline(result.ready);
      setStatus(
        'Interfaz offline preparada y verificada con SHA-256. Puedes recargar y probar sin conexión.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
      setOfflineProgress(null);
    }
  }
  function save() {
    const dictionary = [
      ...new Set(
        fillers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (dictionary.length > 100 || dictionary.some((s) => s.length > 50)) {
      setError('Usa hasta 100 términos de 50 caracteres como máximo.');
      return;
    }
    preferences.update({ goal: goal.trim(), fillers: dictionary, threshold });
    setError('');
    setStatus('Preferencias guardadas en este dispositivo.');
  }
  return (
    <>
      <PageHead
        eyebrow="PREFERENCIAS Y PRIVACIDAD"
        title="Tus prácticas, bajo tu control."
        description="Sin cuentas, publicidad ni sincronización remota. Puedes exportar y eliminar cada sesión desde su análisis."
      />
      {error && <Alert>{error}</Alert>}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      <div className="settings-grid">
        <section className="panel">
          <h2>Personaliza tu práctica</h2>
          <label className="field">
            Objetivo personal
            <textarea
              value={goal}
              rows={3}
              maxLength={500}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Preparar una defensa de tesis clara y con evidencia."
            />
          </label>
          <label className="field">
            Candidatos a muletilla, separados por comas
            <textarea value={fillers} rows={3} onChange={(e) => setFillers(e.target.value)} />
          </label>
          <p className="caption">
            Se comparan palabras completas, ignorando mayúsculas y acentos. Las coincidencias deben escucharse
            en contexto.
          </p>
          <label className="field">
            Umbral inicial del detector: {threshold} dBFS
            <input
              type="range"
              min={-60}
              max={-15}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Apariencia
            <select
              value={preferences.theme}
              onChange={(e) => preferences.update({ theme: e.target.value as 'light' | 'dark' })}
            >
              <option value="light">Modo claro</option>
              <option value="dark">Modo oscuro</option>
            </select>
          </label>
          <button className="button primary" onClick={save}>
            <Save size={17} /> Guardar preferencias
          </button>
        </section>
        <div>
          <section className="panel">
            <span className="eyebrow">ALMACENAMIENTO</span>
            <h2>
              <HardDrive size={21} /> En este dispositivo
            </h2>
            <p>
              {isDesktop()
                ? 'Sesiones y grabaciones: SQLite y archivos de la aplicación. Rúbricas, preferencias y modelos: almacenamiento del WebView.'
                : 'Sesiones, grabaciones y rúbricas: IndexedDB. Modelos: CacheStorage. Preferencias: almacenamiento local.'}
            </p>
            {estimate && (
              <p className="storage-numbers">
                {((estimate.usage ?? 0) / 1024 / 1024).toFixed(1)} MiB utilizados{' '}
                <small>
                  Cuota estimada del origen: {((estimate.quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GiB
                </small>
              </p>
            )}
            <button className="button secondary" onClick={persistStorage}>
              Solicitar persistencia al navegador
            </button>
            <p className="caption">
              Las cuotas y la conservación dependen del navegador. Borrar datos del sitio elimina el
              almacenamiento web. Los datos no están cifrados en reposo por la app.
            </p>
          </section>
          <section className="panel">
            <h2>
              <WifiOff size={21} /> Uso sin conexión
            </h2>
            <p>
              {isDesktop()
                ? 'La interfaz está incluida en la aplicación de escritorio.'
                : import.meta.env.DEV
                  ? 'El Service Worker se activa en la compilación de producción; no en desarrollo.'
                  : offline
                    ? 'La interfaz offline está preparada. Reabre este mismo origen sin conexión para acceder a ella.'
                    : 'La interfaz offline todavía no está preparada. Puedes descargar y verificar los recursos de esta versión con el botón inferior.'}
            </p>
            {import.meta.env.PROD && !isDesktop() && (
              <>
                <p className="caption">
                  La preparación descarga recursos de la interfaz y runtime WASM desde este alojamiento; no
                  instala pesos. Puede requerir aproximadamente 55 MiB en esta entrega. Las actualizaciones de
                  estos recursos se preparan por tu elección.
                </p>
                <button className="button secondary" disabled={preparing} onClick={prepare}>
                  {preparing ? 'Preparando recursos…' : 'Preparar o actualizar uso offline'}
                </button>
                {offlineProgress && (
                  <p className="caption" role="status">
                    Verificados{' '}
                    {Math.floor((offlineProgress.verifiedBytes * 100) / offlineProgress.totalBytes)} % de
                    bytes · {offlineProgress.file}
                  </p>
                )}
              </>
            )}
            <p className="caption">
              Para transcribir offline, Whisper debe estar instalado y verificado previamente. En web, usa
              HTTPS o localhost.
            </p>
          </section>
        </div>
      </div>
      <section className="panel privacy-panel">
        <ShieldCheck size={28} />
        <div>
          <h2>Qué sale de tu dispositivo</h2>
          <p>
            Durante la práctica, audio y texto se procesan localmente. El alojamiento recibe solicitudes de la
            interfaz. Solo al pulsar descargar un modelo se contacta con Hugging Face (Whisper) o con Google
            (modelos de cámara). Los enlaces de procedencia abren sitios externos por tu elección.
          </p>
          <p>
            El simulador de defensa tiene dos conexiones opcionales que tú activas. La transcripción en vivo
            usa el reconocimiento de voz del navegador: en Chrome y Edge el audio lo procesan Google o
            Microsoft. La comisión con IA envía el texto de tu exposición y de tus respuestas al servicio que
            configures; con Ollama o LM Studio ese texto no sale de tu equipo. La imagen de la cámara nunca
            sale del dispositivo.
          </p>
          <p className="caption">
            No se incluyen analítica, telemetría ni fuentes remotas. Las exportaciones contienen datos de la
            sesión y deben conservarse donde tú elijas. La evaluación con IA solo existe, de forma opcional,
            en el simulador de defensa. El cifrado de exportaciones ordinarias no está implementado.
          </p>
        </div>
      </section>
    </>
  );
}

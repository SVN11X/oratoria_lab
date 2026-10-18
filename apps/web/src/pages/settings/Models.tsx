import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Cpu,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Play,
  Square,
  PauseCircle,
  ExternalLink,
  Gauge,
  Replace,
  Check,
} from 'lucide-react';
import {
  CATALOG,
  DECISION_TEXT,
  FUNCTION_TEXT,
  MANAGED,
  PROFILE_TEXT,
  auditModels,
  formatBytes,
  isEmbeddingModel,
  managedStatus,
  planProfile,
  profileForHardware,
  removeManaged,
  verifyManaged,
  type AuditItem,
  type ManagedModel,
  type ManagedStatus,
  type OllamaModel,
  type Profile,
} from '@oratoria/model-manager';
import { isDesktop } from '@oratoria/storage';
import { Alert, Confirm, Toggle } from '../../components';
import { basePath } from '../../services';
import { useAi, type AiSettings, type SttEngine, type TtsEngine } from '../../ai/settings';
import { benchmark, ollama, OpenAiPort } from '../../ai/llm';
import { detectHardware } from '../../ai/hardware';
import { ollamaStorage, systemInfo, type SystemInfo } from '../../ai/desktop';
import { licenseSummary, useAction, useInventory, useInventoryAutoRefresh } from '../../ai/inventory';
import {
  OLLAMA_NAME,
  cancelJob,
  clearJob,
  installManagedModel,
  managedJobKey,
  pullKey,
  pullModel,
  useJobs,
  type Job,
} from '../../ai/jobs';
import { STT_TEXT, TTS_TEXT } from '../../practice/engines';
import { PiperTts } from '../../voice/tts';
import { browserSttSupported } from '../../voice/stt';

type ChatRole = 'conversacion' | 'evaluacion' | 'embeddings';
const ROLES: ChatRole[] = ['conversacion', 'evaluacion', 'embeddings'];
const short = (digest: string) => digest.replace(/^sha256:/, '').slice(0, 12);
const modelMatches = (a: string, b: string) => a === b || a === `${b}:latest` || `${a}:latest` === b;

/* =============================== Sección principal =============================== */
export function ModelsSection() {
  const ai = useAi();
  useInventoryAutoRefresh(ai.useLlm && ai.provider === 'ollama', 20000);
  return (
    <div className="stack">
      <HardwarePanel />
      <EnginePanel />
      {ai.useLlm && ai.provider === 'ollama' && (
        <>
          <ProfilePanel />
          <InventoryPanel />
          <CatalogPanel />
        </>
      )}
      <FunctionsPanel />
      <ManagedPanel />
      <ServersPanel />
    </div>
  );
}

/* ================================== Equipo ================================== */
function HardwarePanel() {
  const hardware = useAi((s) => s.hardware),
    update = useAi((s) => s.update);
  const [sys, setSys] = useState<SystemInfo | null>(null),
    [busy, setBusy] = useState(false);
  async function detect() {
    setBusy(true);
    try {
      update({ hardware: await detectHardware() });
      setSys(await systemInfo());
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!hardware) void detect();
    else void systemInfo().then(setSys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const profile = hardware ? profileForHardware(hardware) : null;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            <Cpu size={13} /> Tu equipo
          </span>
          <h2>Lo que se puede saber de este equipo</h2>
        </div>
        <button className="button secondary small" onClick={() => void detect()} disabled={busy}>
          <RefreshCw size={15} /> {busy ? 'Detectando…' : 'Volver a detectar'}
        </button>
      </div>
      {hardware ? (
        <>
          <div className="hw-grid">
            <div>
              <strong>
                {hardware.ramGb === null
                  ? 'No informada'
                  : `${hardware.ramSource === 'navegador' && hardware.ramGb >= 8 ? '8 GB o más' : `${hardware.ramGb} GB`}`}
              </strong>
              Memoria RAM ·{' '}
              {hardware.ramSource === 'sistema'
                ? 'según el sistema operativo'
                : hardware.ramSource === 'navegador'
                  ? 'aproximada por el navegador'
                  : 'el navegador no la informa'}
            </div>
            <div>
              <strong>{hardware.cores ?? 'No informados'}</strong>
              Núcleos lógicos de CPU
            </div>
            <div>
              <strong>{hardware.gpu ?? 'No detectada'}</strong>
              GPU {hardware.webgpu ? '(WebGPU disponible)' : '(sin WebGPU en este navegador)'}
            </div>
            <div>
              <strong>
                {hardware.cpuScore === null
                  ? 'Sin medir'
                  : `${hardware.cpuScore.toLocaleString('es-CL')} GFLOP/s`}
              </strong>
              Prueba rápida de CPU en este navegador
            </div>
            {sys && (
              <div>
                <strong>{sys.cpuBrand || 'CPU'}</strong>
                {sys.os} · {formatBytes(sys.availableMemoryBytes)} libres
              </div>
            )}
          </div>
          {profile && (
            <p style={{ marginTop: 12 }}>
              Perfil sugerido: <strong>{PROFILE_TEXT[profile].name}</strong>. {PROFILE_TEXT[profile].what}
            </p>
          )}
          {!isDesktop() && (
            <p className="caption">
              Los navegadores limitan lo que informan para proteger tu privacidad: Chrome indica como máximo 8
              GB y no revela el modelo de CPU. La app de escritorio lee los datos del sistema operativo. La
              velocidad real de un modelo se mide con «Probar velocidad».
            </p>
          )}
        </>
      ) : (
        <p role="status">Detectando…</p>
      )}
    </section>
  );
}

/* ============================ Motor de lenguaje ============================ */
function EnginePanel() {
  const ai = useAi();
  const inv = useInventory();
  const { busy, error, done, run } = useAction();
  const [url, setUrl] = useState(ai.ollamaUrl);
  const [openai, setOpenai] = useState(ai.openai);
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const remote = useMemo(() => {
    try {
      const host = new URL(ai.provider === 'ollama' ? ai.ollamaUrl : ai.openai.baseUrl).hostname;
      return !/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(host);
    } catch {
      return false;
    }
  }, [ai.provider, ai.ollamaUrl, ai.openai.baseUrl]);
  function saveUrl() {
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      ai.update({ ollamaUrl: u.origin });
      setUrl(u.origin);
      void inv.refresh();
    } catch {
      void run('url', async () => {
        throw new Error('Escribe una dirección válida, por ejemplo http://localhost:11434.');
      });
    }
  }
  return (
    <section className="panel">
      <span className="eyebrow">Motor de lenguaje</span>
      <h2>Interlocutores con IA local</h2>
      <p>
        Sin un modelo de lenguaje, los interlocutores funcionan con el motor de reglas: hacen preguntas
        ancladas a tu material, repreguntan y evalúan con mediciones. Con un modelo local, las preguntas y la
        evaluación se vuelven más naturales.
      </p>
      <div className="toggle-grid" style={{ marginTop: 12 }}>
        <Toggle
          checked={ai.useLlm}
          onChange={(v) => ai.update({ useLlm: v })}
          title="Usar un modelo de lenguaje"
        >
          Desactivado, la aplicación no hace ninguna solicitud de red.
        </Toggle>
      </div>
      {ai.useLlm && (
        <>
          <div className="segmented" role="group" aria-label="Proveedor" style={{ marginTop: 14 }}>
            <button aria-pressed={ai.provider === 'ollama'} onClick={() => ai.update({ provider: 'ollama' })}>
              Ollama (recomendado)
            </button>
            <button aria-pressed={ai.provider === 'openai'} onClick={() => ai.update({ provider: 'openai' })}>
              Servidor compatible con OpenAI
            </button>
          </div>
          {ai.provider === 'ollama' ? (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field">
                Dirección de Ollama
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={saveUrl}
                  inputMode="url"
                  spellCheck={false}
                />
              </label>
              <div className="field">
                Estado
                <span className="row-wrap" role="status">
                  <span
                    className={`dot ${inv.state === 'ok' ? 'on' : inv.state === 'error' ? 'warn' : ''}`}
                  />
                  {inv.state === 'ok'
                    ? `Conectado · Ollama ${inv.version} · ${inv.models.length} modelos`
                    : inv.state === 'error'
                      ? 'Sin conexión'
                      : inv.state === 'loading'
                        ? 'Consultando…'
                        : 'Sin consultar'}
                  <button className="button quiet small" onClick={() => void inv.refresh()}>
                    <RefreshCw size={14} /> Probar
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field">
                Dirección base (termina en /v1)
                <input
                  value={openai.baseUrl}
                  onChange={(e) => setOpenai({ ...openai, baseUrl: e.target.value })}
                  onBlur={() => ai.update({ openai })}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                Modelo
                <input
                  value={openai.model}
                  onChange={(e) => setOpenai({ ...openai, model: e.target.value })}
                  onBlur={() => ai.update({ openai })}
                  spellCheck={false}
                />
              </label>
              <label className="field">
                Clave (opcional)
                <input
                  type="password"
                  autoComplete="off"
                  value={openai.apiKey}
                  onChange={(e) => setOpenai({ ...openai, apiKey: e.target.value })}
                  onBlur={() => ai.update({ openai })}
                />
              </label>
              <div className="field">
                Prueba
                <button
                  className="button secondary small"
                  disabled={!!busy || !openai.model.trim()}
                  onClick={() =>
                    void run('openai', async () => {
                      ai.update({ openai });
                      const t0 = performance.now();
                      const text = await new OpenAiPort(
                        openai.model.trim(),
                        openai.baseUrl,
                        openai.apiKey,
                      ).complete([{ role: 'user', content: 'Responde solo con la palabra: listo' }], {
                        json: false,
                        timeoutMs: 60000,
                      });
                      return `Respondió en ${((performance.now() - t0) / 1000).toFixed(1)} s: «${text.trim().slice(0, 60)}».`;
                    })
                  }
                >
                  {busy === 'openai' ? 'Probando…' : 'Probar conexión'}
                </button>
              </div>
              <p className="caption" style={{ gridColumn: '1 / -1' }}>
                Sirve para LM Studio, llama.cpp, vLLM, LocalAI y otros. La clave se guarda sin cifrar en el
                almacenamiento de este navegador. La gestión de modelos solo está disponible con Ollama.
              </p>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          {done && (
            <p className="status-line" role="status">
              {done}
            </p>
          )}
          {ai.provider === 'ollama' && inv.state === 'error' && (
            <Alert tone="warn">
              {inv.error}
              <details style={{ marginTop: 8 }}>
                <summary>Cómo conectar Ollama</summary>
                <ol className="plain-list">
                  <li>
                    Instala Ollama desde{' '}
                    <a
                      className="text-link"
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noreferrer"
                    >
                      ollama.com/download <ExternalLink size={13} />
                    </a>{' '}
                    y ábrelo.
                  </li>
                  <li>
                    Si usas la versión web publicada, Ollama debe aceptar este origen. Define la variable{' '}
                    <code>OLLAMA_ORIGINS={origin}</code> y reinicia Ollama. En Windows: Configuración del
                    sistema, Variables de entorno. En macOS:{' '}
                    <code>launchctl setenv OLLAMA_ORIGINS "{origin}"</code>. En Linux con systemd:{' '}
                    <code>systemctl edit ollama.service</code> y agrega{' '}
                    <code>Environment="OLLAMA_ORIGINS={origin}"</code>.
                  </li>
                  <li>En localhost y en la app de escritorio normalmente no hace falta configurar nada.</li>
                </ol>
              </details>
            </Alert>
          )}
          {remote && (
            <Alert tone="warn">
              La dirección configurada no es de este equipo. El texto de tus respuestas y de tu material se
              enviará a ese servidor. Úsala solo si es tuyo y confías en él.
            </Alert>
          )}
        </>
      )}
    </section>
  );
}

/* ================================= Perfiles ================================= */
function ProfilePanel() {
  const ai = useAi();
  const inv = useInventory();
  const [preview, setPreview] = useState<Exclude<Profile, 'personalizado'> | null>(null);
  const plan = useMemo(() => (preview ? planProfile(preview, inv.models) : null), [preview, inv.models]);
  const jobs = useJobs((s) => s.jobs);
  const sttFor: Record<Exclude<Profile, 'personalizado'>, SttEngine> = {
    eficiente: 'whisper-tiny',
    equilibrado: 'whisper-base',
    calidad: 'whisper-small',
  };
  const recommended = ai.hardware ? profileForHardware(ai.hardware) : null;
  function apply() {
    if (!plan || !preview) return;
    const installed = (tag?: string) =>
      tag && inv.models.some((m) => modelMatches(m.name, tag))
        ? inv.models.find((m) => modelMatches(m.name, tag))!.name
        : '';
    ai.update({
      profile: preview,
      assign: {
        conversacion: installed(plan.assignments.conversacion) || ai.assign.conversacion,
        evaluacion: installed(plan.assignments.evaluacion) || ai.assign.evaluacion,
        embeddings: installed(plan.assignments.embeddings) || ai.assign.embeddings,
      },
    });
    setPreview(null);
  }
  return (
    <section className="panel">
      <span className="eyebrow">Perfiles</span>
      <h2>Elige un equilibrio entre calidad y velocidad</h2>
      <p>
        El perfil propone modelos para cada función. Primero reutiliza lo que ya tienes instalado y solo
        sugiere descargar lo que falta. No se descarga nada sin tu confirmación.
      </p>
      <div className="segmented" role="group" aria-label="Perfil de modelos" style={{ marginTop: 12 }}>
        {(['eficiente', 'equilibrado', 'calidad', 'personalizado'] as const).map((p) => (
          <button
            key={p}
            aria-pressed={(preview ?? ai.profile) === p}
            onClick={() => {
              if (p === 'personalizado') {
                setPreview(null);
                ai.update({ profile: 'personalizado' });
              } else setPreview(p);
            }}
          >
            {PROFILE_TEXT[p].name}
            {p === recommended ? ' · sugerido' : ''}
          </button>
        ))}
      </div>
      <p className="caption" style={{ marginTop: 8 }}>
        {PROFILE_TEXT[preview ?? ai.profile].what}
      </p>
      {plan && preview && (
        <div className="function-grid" style={{ marginTop: 12 }}>
          {ROLES.map((r) => {
            const tag = plan.assignments[r];
            const have = !!tag && inv.models.some((m) => modelMatches(m.name, tag));
            const job = tag ? jobs[pullKey(tag)] : undefined;
            return (
              <div className="function-card" key={r}>
                <strong>{FUNCTION_TEXT[r].name}</strong>
                <span>{tag ?? 'Sin propuesta'}</span>
                <span className={`badge ${have ? 'success' : 'warning'}`}>
                  {have ? 'Ya instalado' : tag ? 'Por descargar' : 'Sin modelo'}
                </span>
                {!have &&
                  tag &&
                  (job ? (
                    <JobProgress job={job} />
                  ) : (
                    <button
                      className="button secondary small"
                      onClick={() => void pullModel(tag).then(() => inv.refresh())}
                    >
                      <Download size={15} /> Descargar {CATALOG.find((c) => c.tag === tag)?.downloadGb ?? ''}{' '}
                      GB
                    </button>
                  ))}
              </div>
            );
          })}
          <div className="function-card">
            <strong>Reconocimiento de voz</strong>
            <span>{STT_TEXT[sttFor[preview]]}</span>
            <span className="caption">Se instala en «Modelos administrados por Oratoria Lab».</span>
          </div>
          <div className="actions" style={{ gridColumn: '1 / -1' }}>
            <button className="button primary" onClick={apply}>
              <Check size={16} /> Aplicar lo que ya está instalado
            </button>
            <button className="button quiet" onClick={() => setPreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================ Inventario de Ollama ============================ */
type Uninstall = { item: AuditItem; model: OllamaModel; roles: ChatRole[]; replacement: string };
type Substitute = {
  from: string;
  to: string;
  step: 'confirmar' | 'descargando' | 'probando' | 'reasignado' | 'error';
  message: string;
};

function InventoryPanel() {
  const ai = useAi();
  const inv = useInventory();
  const jobs = useJobs((s) => s.jobs);
  const { busy, error, done, run, setDone } = useAction();
  const [removing, setRemoving] = useState<Uninstall | null>(null);
  const [subst, setSubst] = useState<Substitute | null>(null);
  const audit = useMemo(
    () =>
      auditModels({
        installed: inv.models,
        running: inv.running,
        shows: inv.shows,
        hardware: ai.hardware ?? {
          ramGb: null,
          ramSource: 'desconocido',
          cores: null,
          gpu: null,
          webgpu: false,
          cpuScore: null,
        },
        selected: ai.assign,
        lastUsed: ai.lastUsed,
      }),
    [inv.models, inv.running, inv.shows, ai.hardware, ai.assign, ai.lastUsed],
  );
  const rolesOf = (name: string) => ROLES.filter((r) => ai.assign[r] && modelMatches(ai.assign[r], name));

  /** Desinstalación real con la API oficial; verifica el resultado y mide el espacio en escritorio. */
  async function uninstall(u: Uninstall) {
    await run(`rm:${u.model.name}`, async () => {
      const client = ollama();
      if (inv.running.some((r) => r.name === u.model.name))
        await client.unload(u.model.name).catch(() => undefined);
      const before = await ollamaStorage();
      await client.remove(u.model.name);
      const after = await client.list();
      if (after.some((m) => m.name === u.model.name))
        throw new Error('Ollama no confirmó la eliminación. El modelo sigue instalado.');
      const afterDisk = await ollamaStorage();
      const assign: AiSettings['assign'] = { ...ai.assign };
      for (const r of u.roles) assign[r] = u.replacement;
      ai.update({ assign });
      setRemoving(null);
      await inv.refresh();
      const freed =
        before && afterDisk
          ? `Espacio liberado, medido en disco: ${formatBytes(Math.max(0, before.totalBytes - afterDisk.totalBytes))}.`
          : `Espacio liberado: hasta ${formatBytes(u.model.size)}. Si compartía capas con otro modelo, Ollama las conserva y se libera menos; la cifra exacta se mide en la app de escritorio.`;
      return `${u.model.name} se eliminó con la API oficial de Ollama. ${freed}${u.roles.length ? ` ${u.replacement ? `Sus funciones ahora usan ${u.replacement}.` : 'Sus funciones quedaron sin modelo y usarán reglas.'}` : ''}`;
    });
  }

  /** Sustitución: descargar → probar → reasignar → preguntar si eliminar el anterior. */
  async function substitute(s: Substitute) {
    setSubst({ ...s, step: 'descargando', message: '' });
    const ok = inv.models.some((m) => modelMatches(m.name, s.to)) || (await pullModel(s.to));
    if (!ok) {
      setSubst({
        ...s,
        step: 'error',
        message: useJobs.getState().jobs[pullKey(s.to)]?.error ?? 'La descarga no terminó.',
      });
      return;
    }
    await inv.refresh();
    setSubst({ ...s, step: 'probando', message: '' });
    let note = '';
    if (!isEmbeddingModel({ name: s.to })) {
      try {
        const b = await benchmark(s.to);
        note = `Prueba: ${b.totalSec} s${b.tokensPerSec ? `, ${b.tokensPerSec} tokens/s` : ''}, JSON ${b.jsonOk ? 'válido' : 'no válido'}.`;
      } catch (e) {
        note = `La prueba falló: ${e instanceof Error ? e.message : 'error'}.`;
      }
    }
    const name = useInventory.getState().models.find((m) => modelMatches(m.name, s.to))?.name ?? s.to;
    const assign: AiSettings['assign'] = { ...ai.assign };
    for (const r of ROLES) if (assign[r] && modelMatches(assign[r], s.from)) assign[r] = name;
    ai.update({ assign });
    setSubst({ ...s, to: name, step: 'reasignado', message: note });
  }

  if (inv.state !== 'ok' && !inv.models.length) return null;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            <HardDrive size={13} /> Instalados en Ollama
          </span>
          <h2>Tus modelos actuales</h2>
        </div>
        <span className="caption">
          Ollama {inv.version} · {formatBytes(inv.models.reduce((n, m) => n + m.size, 0))} en total
        </span>
      </div>
      <p>
        Antes de recomendar descargas se revisa lo que ya tienes. Ningún modelo se elimina solo por ser
        antiguo. Las decisiones se explican y siempre las confirmas tú.
      </p>
      {audit.gaps.map((g) => (
        <Alert tone="info" key={g}>
          {g}
        </Alert>
      ))}
      {error && <Alert>{error}</Alert>}
      {done && (
        <p className="status-line" role="status">
          {done}{' '}
          <button className="text-link" onClick={() => setDone('')}>
            Cerrar
          </button>
        </p>
      )}
      {!inv.models.length ? (
        <p className="caption">
          Ollama no tiene modelos instalados. Elige un perfil o descarga uno del catálogo.
        </p>
      ) : (
        <div className="model-grid" style={{ marginTop: 12 }}>
          {audit.items.map((item) => {
            const model = inv.models.find((m) => m.name === item.name)!;
            const show = inv.shows.get(item.name);
            const arch = (show?.model_info?.['general.architecture'] as string | undefined) ?? item.family;
            const ctx = show?.model_info?.[`${arch}.context_length`] as number | undefined;
            const roles = rolesOf(item.name);
            const bench = ai.bench[item.name];
            const license = licenseSummary(show);
            const capsKnown = !!show?.capabilities?.length;
            return (
              <article className="model-card" key={item.name}>
                <header>
                  <h3>{item.name}</h3>
                  <span
                    className={`badge ${item.decision === 'conservar' ? 'success' : item.decision === 'desinstalar' ? 'danger' : 'warning'}`}
                  >
                    {DECISION_TEXT[item.decision]}
                  </span>
                </header>
                <div className="model-facts">
                  <span>Arquitectura: {arch}</span>
                  <span>Parámetros: {model.details?.parameter_size ?? 'no informado'}</span>
                  <span>Cuantización: {item.quantization ?? 'no informada'}</span>
                  <span>Tamaño: {formatBytes(item.sizeBytes)}</span>
                  <span>Formato: {model.details?.format ?? 'no informado'}</span>
                  {ctx && <span>Contexto: {ctx.toLocaleString('es-CL')} tokens</span>}
                  <span>Versión: {short(model.digest)}</span>
                  <span>Actualizado: {new Date(model.modified_at).toLocaleDateString('es-CL')}</span>
                  <span>Motor: Ollama</span>
                  <span>
                    Tareas: {item.tasks.map((t) => FUNCTION_TEXT[t].name).join(', ')}{' '}
                    {capsKnown ? '(según Ollama)' : '(estimadas por el nombre)'}
                  </span>
                  <span>Licencia: {license ?? 'Ollama no la informa'}</span>
                  <span>
                    Último uso en Oratoria Lab:{' '}
                    {ai.lastUsed[item.name]
                      ? new Date(ai.lastUsed[item.name]!).toLocaleString('es-CL')
                      : 'sin registro'}
                  </span>
                </div>
                <div className="row-wrap">
                  <span className="badge success">Instalado</span>
                  {item.running && (
                    <span className="badge info">
                      Cargado en memoria{item.vramBytes ? ` · ${formatBytes(item.vramBytes)} en GPU` : ''}
                    </span>
                  )}
                  {roles.map((r) => (
                    <span className="badge primary" key={r}>
                      Seleccionado: {FUNCTION_TEXT[r].name}
                    </span>
                  ))}
                </div>
                <ul className="reason-list">
                  {item.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {bench && (
                  <p className="caption">
                    Prueba del {new Date(bench.at).toLocaleDateString('es-CL')}: {bench.totalSec} s en total
                    {bench.loadSec !== null ? `, carga ${bench.loadSec} s` : ''}
                    {bench.tokensPerSec !== null ? `, ${bench.tokensPerSec} tokens/s` : ''} · JSON{' '}
                    {bench.jsonOk ? 'válido' : 'no válido'} · español{' '}
                    {bench.spanishOk ? 'correcto' : 'dudoso'}
                  </p>
                )}
                <div className="actions">
                  {!item.tasks.includes('embeddings') && (
                    <button
                      className="button secondary small"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`b:${item.name}`, async () => void (await benchmark(item.name)))
                      }
                    >
                      <Gauge size={15} /> {busy === `b:${item.name}` ? 'Probando…' : 'Probar velocidad'}
                    </button>
                  )}
                  {item.running && (
                    <button
                      className="button quiet small"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`u:${item.name}`, async () => {
                          await ollama().unload(item.name);
                          await inv.refresh();
                          return `${item.name} se descargó de la memoria. Sigue instalado.`;
                        })
                      }
                    >
                      <PauseCircle size={15} /> Liberar memoria
                    </button>
                  )}
                  {item.suggestion &&
                    (item.decision === 'sustituir' || item.decision === 'actualizar') &&
                    OLLAMA_NAME.test(item.suggestion.split(' ')[0]!) && (
                      <button
                        className="button secondary small"
                        disabled={!!busy || !!subst}
                        onClick={() =>
                          setSubst({
                            from: item.name,
                            to: item.suggestion!.split(' ')[0]!,
                            step: 'confirmar',
                            message: '',
                          })
                        }
                      >
                        <Replace size={15} /> Sustituir por {item.suggestion.split(' ')[0]}
                      </button>
                    )}
                  <button
                    className="button quiet small"
                    disabled={!!busy}
                    onClick={() => {
                      const replacement =
                        inv.models.find(
                          (m) =>
                            m.name !== item.name &&
                            isEmbeddingModel(m, inv.shows.get(m.name)?.capabilities) ===
                              item.tasks.includes('embeddings'),
                        )?.name ?? '';
                      setRemoving({ item, model, roles, replacement });
                    }}
                  >
                    <Trash2 size={15} /> Desinstalar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {removing && (
        <Confirm
          title={`¿Desinstalar ${removing.model.name}?`}
          busy={busy.startsWith('rm:')}
          confirmLabel="Desinstalar con Ollama"
          onCancel={() => setRemoving(null)}
          onConfirm={() => void uninstall(removing)}
        >
          <p>
            Se pedirá a Ollama que lo elimine con su API oficial. Oratoria Lab no borra archivos de Ollama por
            su cuenta.
          </p>
          <ul>
            <li>
              Tamaño informado: {formatBytes(removing.model.size)}. Si comparte capas con otra variante,
              Ollama conserva esas capas y se libera menos.
            </li>
            {removing.item.running && <li>Está cargado en memoria: primero se liberará la memoria.</li>}
            {removing.roles.length > 0 && (
              <li>
                Está seleccionado para{' '}
                {removing.roles.map((r) => FUNCTION_TEXT[r].name.toLowerCase()).join(' y ')}.{' '}
                {removing.replacement
                  ? `Esas funciones pasarán a usar ${removing.replacement}.`
                  : 'Esas funciones quedarán sin modelo y usarán reglas.'}
              </li>
            )}
            <li>Otras aplicaciones que usen este modelo en Ollama también dejarán de tenerlo.</li>
          </ul>
          {removing.roles.length > 0 && (
            <label className="field">
              Reemplazo para sus funciones
              <select
                value={removing.replacement}
                onChange={(e) => setRemoving({ ...removing, replacement: e.target.value })}
              >
                <option value="">Ninguno (usar reglas)</option>
                {inv.models
                  .filter((m) => m.name !== removing.model.name)
                  .map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </Confirm>
      )}
      {subst && (
        <SubstituteDialog
          s={subst}
          job={jobs[pullKey(subst.to)]}
          onStart={() => void substitute(subst)}
          onClose={() => setSubst(null)}
          onRemoveOld={() => {
            const model = inv.models.find((m) => m.name === subst.from);
            const item = audit.items.find((i) => i.name === subst.from);
            setSubst(null);
            if (model && item)
              setRemoving({ item, model, roles: rolesOf(subst.from), replacement: subst.to });
          }}
        />
      )}
    </section>
  );
}

function SubstituteDialog({
  s,
  job,
  onStart,
  onClose,
  onRemoveOld,
}: {
  s: Substitute;
  job?: Job;
  onStart: () => void;
  onClose: () => void;
  onRemoveOld: () => void;
}) {
  const working = s.step === 'descargando' || s.step === 'probando';
  return (
    <Confirm
      title={`Sustituir ${s.from} por ${s.to}`}
      tone="primary"
      busy={working}
      confirmLabel={
        s.step === 'confirmar'
          ? 'Comenzar'
          : s.step === 'reasignado'
            ? 'Revisar si elimino el anterior'
            : s.step === 'error'
              ? 'Reintentar'
              : 'Procesando…'
      }
      cancelLabel={s.step === 'reasignado' ? 'Conservar el anterior' : 'Cerrar'}
      onCancel={onClose}
      onConfirm={() => (s.step === 'reasignado' ? onRemoveOld() : onStart())}
    >
      <ol className="plain-list">
        <li>
          {s.step === 'confirmar' ? 'Descargar' : s.step === 'descargando' ? 'Descargando' : 'Descargado'}{' '}
          {s.to} con Ollama.
        </li>
        <li>{s.step === 'probando' ? 'Probando' : 'Probar'} su velocidad y su respuesta en español.</li>
        <li>Asignarle las funciones de {s.from}.</li>
        <li>Preguntarte si quieres eliminar {s.from}. Nunca se elimina automáticamente.</li>
      </ol>
      {s.step === 'descargando' && job && <JobProgress job={job} />}
      {s.step === 'reasignado' && (
        <p role="status">
          Listo: las funciones de {s.from} ahora usan {s.to}. {s.message}
        </p>
      )}
      {s.step === 'error' && <Alert>{s.message}</Alert>}
    </Confirm>
  );
}

export function JobProgress({ job }: { job: Job }) {
  const pct = job.total ? Math.min(100, Math.floor((job.completed * 100) / job.total)) : 0;
  const active = job.phase === 'descargando' || job.phase === 'verificando';
  return (
    <div className="download-progress" role="status">
      {active && <progress max={100} value={pct} aria-label={`Progreso de ${job.label}`} />}
      <p>
        {job.phase === 'error' ? `Error: ${job.error}` : job.status}
        {active && job.total
          ? ` · ${pct} % (${formatBytes(job.completed)} de ${formatBytes(job.total)})`
          : ''}
      </p>
      <div className="row-wrap">
        {active ? (
          <button className="button quiet small" onClick={() => cancelJob(job.key)}>
            <Square size={14} /> Cancelar
          </button>
        ) : (
          <button className="button quiet small" onClick={() => clearJob(job.key)}>
            Ocultar
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================ Catálogo ================================ */
function CatalogPanel() {
  const inv = useInventory();
  const jobs = useJobs((s) => s.jobs);
  const hardware = useAi((s) => s.hardware);
  const [custom, setCustom] = useState('');
  const ram = hardware?.ramSource === 'sistema' ? hardware.ramGb : null;
  async function pull(tag: string) {
    if (await pullModel(tag)) await inv.refresh();
  }
  return (
    <section className="panel">
      <span className="eyebrow">
        <Download size={13} /> Catálogo sugerido
      </span>
      <h2>Modelos para descargar con Ollama</h2>
      <p className="caption">
        Tamaños consultados en ollama.com el 17 de octubre de 2026; pueden cambiar. La licencia definitiva es
        la que muestra Ollama tras instalar. Ollama verifica cada capa con SHA-256.
      </p>
      <div className="model-grid" style={{ marginTop: 12 }}>
        {CATALOG.map((c) => {
          const have = inv.models.some((m) => modelMatches(m.name, c.tag));
          const job = jobs[pullKey(c.tag)];
          const heavy = ram !== null && c.ramGb > ram * 0.75;
          return (
            <article className="model-card" key={c.tag}>
              <header>
                <h3>{c.tag}</h3>
                <span className={`badge ${have ? 'success' : ''}`}>
                  {have ? 'Instalado' : PROFILE_TEXT[c.tier].name}
                </span>
              </header>
              <div className="model-facts">
                <span>{c.functions.map((f) => FUNCTION_TEXT[f].name).join(', ')}</span>
                <span>{c.params} parámetros</span>
                <span>Descarga: {c.downloadGb} GB</span>
                <span>RAM sugerida: {c.ramGb.toLocaleString('es-CL')} GB libres</span>
              </div>
              <p className="caption">
                {c.spanish} {c.note}
              </p>
              {heavy && (
                <p className="caption">
                  Tu equipo informa {ram} GB de RAM: este modelo podría ser muy lento.
                </p>
              )}
              <div className="actions">
                <a className="text-link" href={c.source} target="_blank" rel="noreferrer">
                  Ficha en ollama.com <ExternalLink size={13} />
                </a>
                {!have && !job && (
                  <button className="button secondary small" onClick={() => void pull(c.tag)}>
                    <Download size={15} /> Descargar
                  </button>
                )}
              </div>
              {job && <JobProgress job={job} />}
              {job && (job.phase === 'error' || job.phase === 'cancelado') && (
                <button className="button secondary small" onClick={() => void pull(c.tag)}>
                  <RefreshCw size={14} /> Reintentar
                </button>
              )}
            </article>
          );
        })}
      </div>
      <details>
        <summary>Instalar otro modelo de Ollama por su nombre</summary>
        <div className="row-wrap" style={{ marginTop: 10 }}>
          <label className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            Nombre exacto (por ejemplo qwen3.5:4b)
            <input value={custom} onChange={(e) => setCustom(e.target.value.trim())} spellCheck={false} />
          </label>
          <button
            className="button secondary"
            disabled={!OLLAMA_NAME.test(custom) || !!jobs[pullKey(custom)]}
            onClick={() => void pull(custom)}
          >
            <Download size={15} /> Descargar
          </button>
        </div>
        {custom && !OLLAMA_NAME.test(custom) && (
          <p className="caption">Usa solo letras, números, puntos, guiones, barras y dos puntos.</p>
        )}
        {custom && jobs[pullKey(custom)] && <JobProgress job={jobs[pullKey(custom)]!} />}
      </details>
    </section>
  );
}

/* ============================ Funciones y asignación ============================ */
function FunctionsPanel() {
  const ai = useAi();
  const inv = useInventory();
  const { statuses } = useManagedStatuses();
  const chat = inv.models.filter((m) => !isEmbeddingModel(m, inv.shows.get(m.name)?.capabilities));
  const emb = inv.models.filter((m) => isEmbeddingModel(m, inv.shows.get(m.name)?.capabilities));
  const installedPiper = MANAGED.filter((m) => m.kind === 'tts' && statuses[m.id]?.installed);
  const whisperInstalled = (id: string) => !!statuses[id]?.installed;
  const ollamaMode = ai.useLlm && ai.provider === 'ollama';
  const select = (role: ChatRole, list: OllamaModel[]) => (
    <label className="field">
      Modelo
      <select
        value={ai.assign[role]}
        onChange={(e) =>
          ai.update({ assign: { ...ai.assign, [role]: e.target.value }, profile: 'personalizado' })
        }
        disabled={!ollamaMode}
      >
        <option value="">
          {role === 'embeddings'
            ? 'Ninguno (búsqueda por palabras)'
            : role === 'evaluacion'
              ? 'El mismo de conversación'
              : 'Ninguno (reglas)'}
        </option>
        {list.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} · {formatBytes(m.size)}
          </option>
        ))}
        {ai.assign[role] && !list.some((m) => m.name === ai.assign[role]) && (
          <option value={ai.assign[role]}>{ai.assign[role]} (no instalado)</option>
        )}
      </select>
    </label>
  );
  return (
    <section className="panel">
      <span className="eyebrow">Funciones</span>
      <h2>Qué modelo hace cada tarea</h2>
      <div className="function-grid" style={{ marginTop: 12 }}>
        <Card title={FUNCTION_TEXT.conversacion.name} what={FUNCTION_TEXT.conversacion.what}>
          {ai.provider === 'openai' && ai.useLlm ? (
            <span className="caption">
              Usa el modelo del servidor compatible: {ai.openai.model || 'sin definir'}.
            </span>
          ) : (
            select('conversacion', chat)
          )}
        </Card>
        <Card title={FUNCTION_TEXT.evaluacion.name} what={FUNCTION_TEXT.evaluacion.what}>
          {ai.provider === 'openai' && ai.useLlm ? (
            <span className="caption">Usa el mismo modelo del servidor compatible.</span>
          ) : (
            select('evaluacion', chat)
          )}
          <span className="caption">
            El evaluador no recibe el temperamento de los interlocutores, para que la nota sea justa.
          </span>
        </Card>
        <Card title={FUNCTION_TEXT.embeddings.name} what={FUNCTION_TEXT.embeddings.what}>
          {select('embeddings', emb)}
        </Card>
        <Card
          title="Reordenamiento de fragmentos"
          what="Ordena los fragmentos recuperados antes de preguntar."
        >
          <span className="caption">
            Sin modelo dedicado en esta versión: se combinan búsqueda por palabras y por significado (fusión
            de rangos) y se diversifica el resultado (MMR).
          </span>
        </Card>
        <Card title={FUNCTION_TEXT.stt.name} what={FUNCTION_TEXT.stt.what}>
          <label className="field">
            Motor
            <select value={ai.stt} onChange={(e) => ai.update({ stt: e.target.value as SttEngine })}>
              {(
                [
                  'whisper-tiny',
                  'whisper-base',
                  'whisper-small',
                  'navegador',
                  'servidor',
                  'escrito',
                ] as SttEngine[]
              ).map((id) => (
                <option key={id} value={id} disabled={id === 'navegador' && !browserSttSupported()}>
                  {STT_TEXT[id]}
                  {id.startsWith('whisper') ? (whisperInstalled(id) ? '' : ' (no instalado)') : ''}
                </option>
              ))}
            </select>
          </label>
          {ai.stt === 'navegador' && (
            <span className="caption">
              En Chrome y Edge el audio se procesa en servidores de Google o Microsoft. Whisper transcribe sin
              internet.
            </span>
          )}
          {ai.stt.startsWith('whisper') && !whisperInstalled(ai.stt) && (
            <span className="caption">Instálalo abajo, en «Modelos administrados por Oratoria Lab».</span>
          )}
        </Card>
        <Card title={FUNCTION_TEXT.tts.name} what={FUNCTION_TEXT.tts.what}>
          <label className="field">
            Motor
            <select value={ai.tts} onChange={(e) => ai.update({ tts: e.target.value as TtsEngine })}>
              {(['piper', 'sistema', 'servidor', 'texto'] as TtsEngine[]).map((id) => (
                <option key={id} value={id}>
                  {TTS_TEXT[id]}
                  {id === 'piper' && !installedPiper.length ? ' (sin voces instaladas)' : ''}
                </option>
              ))}
            </select>
          </label>
          {ai.tts === 'piper' && installedPiper.length > 0 && (
            <>
              <label className="field">
                Voz femenina
                <select
                  value={ai.piper.f}
                  onChange={(e) => ai.update({ piper: { ...ai.piper, f: e.target.value } })}
                >
                  {installedPiper
                    .filter((m) => String(m.meta?.gender).includes('f'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  {!installedPiper.some((m) => m.id === ai.piper.f) && (
                    <option value={ai.piper.f}>
                      {MANAGED.find((m) => m.id === ai.piper.f)?.name ?? ai.piper.f} (no instalada)
                    </option>
                  )}
                </select>
              </label>
              <label className="field">
                Voz masculina
                <select
                  value={ai.piper.m}
                  onChange={(e) => ai.update({ piper: { ...ai.piper, m: e.target.value } })}
                >
                  {installedPiper
                    .filter((m) => String(m.meta?.gender).includes('m'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  {!installedPiper.some((m) => m.id === ai.piper.m) && (
                    <option value={ai.piper.m}>
                      {MANAGED.find((m) => m.id === ai.piper.m)?.name ?? ai.piper.m} (no instalada)
                    </option>
                  )}
                </select>
              </label>
            </>
          )}
        </Card>
        <Card title={FUNCTION_TEXT.vision.name} what={FUNCTION_TEXT.vision.what}>
          <Toggle
            checked={ai.vision}
            onChange={(v) => ai.update({ vision: v })}
            title="Analizar la cámara cuando la actives"
          >
            {statuses.vision?.installed ? 'MediaPipe instalado.' : 'Requiere instalar MediaPipe abajo.'}
          </Toggle>
        </Card>
      </div>
    </section>
  );
}
function Card({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  return (
    <div className="function-card">
      <strong>{title}</strong>
      <span className="caption">{what}</span>
      {children}
    </div>
  );
}

/* ====================== Modelos administrados por Oratoria Lab ====================== */
function useManagedStatuses() {
  const jobs = useJobs((s) => s.jobs);
  const [statuses, setStatuses] = useState<Record<string, ManagedStatus>>({});
  const [tick, setTick] = useState(0);
  const finished = Object.values(jobs).filter((j) => j.phase === 'listo').length;
  useEffect(() => {
    let alive = true;
    void Promise.all(MANAGED.map(async (m) => [m.id, await managedStatus(m, basePath)] as const)).then(
      (all) => alive && setStatuses(Object.fromEntries(all)),
    );
    return () => {
      alive = false;
    };
  }, [finished, tick]);
  return { statuses, refresh: () => setTick((t) => t + 1) };
}

const KIND_TEXT: Record<ManagedModel['kind'], string> = {
  stt: 'Reconocimiento de voz (Whisper)',
  tts: 'Voces neuronales (Piper)',
  vision: 'Cámara (MediaPipe)',
};
function ManagedPanel() {
  const { statuses, refresh } = useManagedStatuses();
  const jobs = useJobs((s) => s.jobs);
  const ai = useAi();
  const { busy, error, done, run } = useAction();
  const [removing, setRemoving] = useState<ManagedModel | null>(null);
  const inUse = (m: ManagedModel) =>
    (m.kind === 'stt' && ai.stt === m.id) ||
    (m.kind === 'tts' && ai.tts === 'piper' && (ai.piper.f === m.id || ai.piper.m === m.id)) ||
    (m.kind === 'vision' && ai.vision);
  async function preview(m: ManagedModel, gender: 'f' | 'm') {
    await run(`p:${m.id}`, async () => {
      const tts = new PiperTts({ f: m.id, m: m.id });
      await tts.speak(
        'Buenos días. Gracias por su exposición. Quisiera hacerle una pregunta sobre su metodología.',
        { gender, pitch: 1, rate: 1, pause: 300, emphasis: 0.4, voiceKey: m.id, seed: 0 },
      ).done;
    });
  }
  return (
    <section className="panel">
      <span className="eyebrow">
        <ShieldCheck size={13} /> Modelos administrados por Oratoria Lab
      </span>
      <h2>Voz, transcripción y cámara en este equipo</h2>
      <p className="caption">
        Se guardan en el almacenamiento de este sitio, cada uno en su propio espacio. Desinstalar borra solo
        ese espacio y nada más. Los modelos con versión fijada se verifican con SHA-256 conocidos; los demás
        registran su huella al instalar y se comprueban en cada uso.
      </p>
      {error && <Alert>{error}</Alert>}
      {done && (
        <p className="status-line" role="status">
          {done}
        </p>
      )}
      {(['stt', 'tts', 'vision'] as const).map((kind) => (
        <div key={kind} style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{KIND_TEXT[kind]}</h3>
          <div className="model-grid">
            {MANAGED.filter((m) => m.kind === kind).map((m) => {
              const st = statuses[m.id];
              const job = jobs[managedJobKey(m.id)];
              const active = job && (job.phase === 'descargando' || job.phase === 'verificando');
              return (
                <article className="model-card" key={m.id}>
                  <header>
                    <h3>{m.name}</h3>
                    <span className={`badge ${st?.installed ? 'success' : st?.partial ? 'warning' : ''}`}>
                      {st?.installed ? 'Instalado' : st?.partial ? 'Incompleto' : 'Sin instalar'}
                    </span>
                  </header>
                  <p className="caption">{m.description}</p>
                  <div className="model-facts">
                    <span>
                      {st?.installed
                        ? `Ocupa ${formatBytes(st.bytes)}`
                        : `Descarga aproximada: ${formatBytes(m.approxBytes)}`}
                    </span>
                    <span>RAM: {m.ram}</span>
                    <span>Idioma: {m.language}</span>
                    <span>Revisión: {m.revision.slice(0, 12)}</span>
                    <span>{m.pinned ? 'Huellas SHA-256 fijadas' : 'Huella registrada al instalar'}</span>
                    {inUse(m) && (
                      <span className={`badge ${st?.installed ? 'primary' : 'warning'}`}>
                        {st?.installed ? 'En uso' : 'Elegido, falta instalar'}
                      </span>
                    )}
                  </div>
                  <p className="caption">{m.quality}</p>
                  <div className="actions">
                    <a className="text-link" href={m.sourceUrl} target="_blank" rel="noreferrer">
                      Origen <ExternalLink size={13} />
                    </a>
                    <a className="text-link" href={m.licenseUrl} target="_blank" rel="noreferrer">
                      Licencia <ExternalLink size={13} />
                    </a>
                  </div>
                  <div className="actions">
                    {!st?.installed && !active && (
                      <button
                        className="button secondary small"
                        onClick={() => void installManagedModel(m.id)}
                      >
                        <Download size={15} /> {st?.partial ? 'Completar instalación' : 'Instalar'}
                      </button>
                    )}
                    {st?.installed && (
                      <button
                        className="button quiet small"
                        disabled={!!busy}
                        onClick={() =>
                          void run(`v:${m.id}`, async () => {
                            const ok = await verifyManaged(m, basePath);
                            refresh();
                            return ok
                              ? `${m.name}: integridad verificada.`
                              : `${m.name}: hay archivos dañados. Reinstálalo.`;
                          })
                        }
                      >
                        <ShieldCheck size={15} /> {busy === `v:${m.id}` ? 'Verificando…' : 'Verificar'}
                      </button>
                    )}
                    {st?.installed && m.kind === 'tts' && (
                      <>
                        {String(m.meta?.gender).includes('f') && (
                          <button
                            className="button quiet small"
                            disabled={!!busy}
                            onClick={() => void preview(m, 'f')}
                          >
                            <Play size={15} /> Escuchar{m.meta?.gender === 'fm' ? ' voz femenina' : ''}
                          </button>
                        )}
                        {String(m.meta?.gender).includes('m') && (
                          <button
                            className="button quiet small"
                            disabled={!!busy}
                            onClick={() => void preview(m, 'm')}
                          >
                            <Play size={15} /> Escuchar{m.meta?.gender === 'fm' ? ' voz masculina' : ''}
                          </button>
                        )}
                      </>
                    )}
                    {(st?.installed || st?.partial) && (
                      <button
                        className="button quiet small"
                        disabled={!!busy || !!active}
                        onClick={() => setRemoving(m)}
                      >
                        <Trash2 size={15} /> Desinstalar
                      </button>
                    )}
                  </div>
                  {job && <JobProgress job={job} />}
                  {job && (job.phase === 'error' || job.phase === 'cancelado') && (
                    <button className="button secondary small" onClick={() => void installManagedModel(m.id)}>
                      <RefreshCw size={14} /> Reintentar
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      ))}
      {removing && (
        <Confirm
          title={`¿Desinstalar ${removing.name}?`}
          busy={busy === `rm:${removing.id}`}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run(`rm:${removing.id}`, async () => {
              const m = removing;
              const { freedBytes } = await removeManaged(m, basePath);
              const still = await managedStatus(m, basePath);
              if (still.installed || still.partial)
                throw new Error('El navegador no confirmó el borrado. Vuelve a intentarlo.');
              if (m.kind === 'stt' && ai.stt === m.id)
                ai.update({ stt: browserSttSupported() ? 'navegador' : 'escrito' });
              setRemoving(null);
              refresh();
              return `${m.name} se desinstaló. Espacio liberado: ${formatBytes(freedBytes)}. Tus sesiones y transcripciones se conservaron.`;
            })
          }
        >
          <p>
            Se borrará solo su espacio de almacenamiento propio. Tus sesiones, informes y materiales no se
            tocan.
          </p>
          {inUse(removing) && (
            <p>
              Está en uso.{' '}
              {removing.kind === 'stt'
                ? 'El reconocimiento de voz pasará al del navegador o a respuestas escritas.'
                : removing.kind === 'tts'
                  ? 'Los interlocutores usarán las voces del sistema.'
                  : 'La cámara dejará de analizarse.'}
            </p>
          )}
        </Confirm>
      )}
    </section>
  );
}

/* =========================== Servidores locales opcionales =========================== */
function ServersPanel() {
  const ai = useAi();
  const [stt, setStt] = useState(ai.sttServer),
    [tts, setTts] = useState(ai.ttsServer);
  return (
    <section className="panel">
      <details>
        <summary>Servidores locales opcionales de voz y transcripción</summary>
        <p className="caption" style={{ marginTop: 8 }}>
          Para usar motores que corren fuera del navegador, como whisper.cpp o faster-whisper (transcripción)
          y Kokoro-FastAPI o LocalAI (voz). Deben exponer una API compatible con OpenAI y ejecutarse en tu
          equipo.
        </p>
        <div className="form-grid">
          <label className="field">
            Transcripción: dirección base
            <input
              value={stt.baseUrl}
              onChange={(e) => setStt({ ...stt, baseUrl: e.target.value })}
              onBlur={() => ai.update({ sttServer: stt })}
              spellCheck={false}
            />
          </label>
          <label className="field">
            Transcripción: modelo
            <input
              value={stt.model}
              onChange={(e) => setStt({ ...stt, model: e.target.value })}
              onBlur={() => ai.update({ sttServer: stt })}
              spellCheck={false}
            />
          </label>
          <label className="field">
            Voz: dirección base
            <input
              value={tts.baseUrl}
              onChange={(e) => setTts({ ...tts, baseUrl: e.target.value })}
              onBlur={() => ai.update({ ttsServer: tts })}
              spellCheck={false}
            />
          </label>
          <label className="field">
            Voz: modelo
            <input
              value={tts.model}
              onChange={(e) => setTts({ ...tts, model: e.target.value })}
              onBlur={() => ai.update({ ttsServer: tts })}
              spellCheck={false}
            />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            Voces disponibles en el servidor, separadas por comas (se reparten entre los interlocutores)
            <input
              value={tts.voices}
              onChange={(e) => setTts({ ...tts, voices: e.target.value })}
              onBlur={() => ai.update({ ttsServer: tts })}
              spellCheck={false}
            />
          </label>
        </div>
      </details>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import {
  Cpu,
  Mic,
  Camera,
  ShieldCheck,
  Palette,
  SlidersHorizontal,
  Database,
  Play,
  Square,
  RefreshCw,
  WifiOff,
  HardDrive,
  Trash2,
  Save,
} from 'lucide-react';
import { TEMPERAMENTS, type Temperament } from '@oratoria/conversation';
import {
  MANAGED,
  VISION_MODEL,
  formatBytes,
  managed,
  managedStatus,
  removeManaged,
} from '@oratoria/model-manager';
import { clearAllLocalData, isDesktop, libraryStore, store } from '@oratoria/storage';
import { errorMessage } from '@oratoria/core';
import { PageHead, Alert, Confirm, Toggle } from '../../components';
import { usePreferences, useSessions } from '../../state';
import { useAi, DEFAULT_AI } from '../../ai/settings';
import { makeTts, STT_TEXT, TTS_TEXT } from '../../practice/engines';
import { loadSystemVoices, voiceGender, SystemTts } from '../../voice/tts';
import { offlineStatus, prepareOffline, type OfflineProgress } from '../../offline';
import { basePath } from '../../services';
import { useRecords } from '../../practice/records';
import { ModelsSection } from './Models';

const SECTIONS = [
  {
    id: 'models',
    name: 'Modelos de IA',
    icon: Cpu,
    title: 'Modelos de IA',
    text: 'Qué modelos tienes, cuáles usa cada función y cómo instalarlos o desinstalarlos con seguridad.',
  },
  {
    id: 'audio',
    name: 'Audio y micrófono',
    icon: Mic,
    title: 'Audio y micrófono',
    text: 'Micrófono, detector de voz y voces de los interlocutores.',
  },
  {
    id: 'camera',
    name: 'Cámara',
    icon: Camera,
    title: 'Cámara',
    text: 'Cámara para medir mirada, gestos y postura. La imagen se analiza en este equipo.',
  },
  {
    id: 'privacy',
    name: 'Privacidad',
    icon: ShieldCheck,
    title: 'Privacidad',
    text: 'Qué sale de tu equipo con la configuración actual.',
  },
  {
    id: 'appearance',
    name: 'Apariencia',
    icon: Palette,
    title: 'Apariencia',
    text: 'Tema, tamaño del texto y movimiento.',
  },
  {
    id: 'preferences',
    name: 'Preferencias',
    icon: SlidersHorizontal,
    title: 'Preferencias',
    text: 'Tu objetivo y las palabras que quieres vigilar.',
  },
  {
    id: 'data',
    name: 'Gestión de datos',
    icon: Database,
    title: 'Gestión de datos',
    text: 'Almacenamiento, uso sin conexión y eliminación de datos.',
  },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function Settings() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) return <Navigate to="/settings/models" replace />;
  return (
    <>
      <PageHead eyebrow="CONFIGURACIÓN" title={current.title} description={current.text} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Secciones de configuración">
          {SECTIONS.map(({ id, name, icon: Icon }) => (
            <NavLink key={id} to={`/settings/${id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={17} /> {name}
            </NavLink>
          ))}
        </nav>
        <div>
          <Section id={current.id} />
        </div>
      </div>
    </>
  );
}
function Section({ id }: { id: SectionId }) {
  switch (id) {
    case 'models':
      return <ModelsSection />;
    case 'audio':
      return <AudioSection />;
    case 'camera':
      return <CameraSection />;
    case 'privacy':
      return <PrivacySection />;
    case 'appearance':
      return <AppearanceSection />;
    case 'preferences':
      return <PreferencesSection />;
    case 'data':
      return <DataSection />;
  }
}

/* ================================ Dispositivos ================================ */
function useDevices(kind: 'audioinput' | 'videoinput') {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  async function list(ask = false) {
    setError('');
    try {
      if (!navigator.mediaDevices?.enumerateDevices)
        throw new Error('Este navegador no permite elegir dispositivos. Usa HTTPS o localhost.');
      if (ask) {
        const s = await navigator.mediaDevices.getUserMedia(
          kind === 'audioinput' ? { audio: true } : { video: true },
        );
        s.getTracks().forEach((t) => t.stop());
      }
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind));
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'El navegador no dio permiso. Revisa el ícono de permisos junto a la dirección.'
          : errorMessage(e),
      );
    }
  }
  useEffect(() => {
    void list(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { devices, error, list, named: devices.some((d) => d.label) };
}

function AudioSection() {
  const prefs = usePreferences();
  const ai = useAi();
  const { devices, error, list, named } = useDevices('audioinput');
  const [level, setLevel] = useState<number | null>(null),
    [testing, setTesting] = useState(false),
    [failure, setFailure] = useState('');
  const stop = useRef<() => void>(() => undefined);
  useEffect(() => () => stop.current(), []);
  async function test() {
    if (testing) {
      stop.current();
      return;
    }
    setFailure('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(prefs.micId ? { deviceId: { exact: prefs.micId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        setLevel(20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9));
        raf = requestAnimationFrame(tick);
      };
      tick();
      const timer = setTimeout(() => stop.current(), 15000);
      stop.current = () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setTesting(false);
        setLevel(null);
        stop.current = () => undefined;
      };
      setTesting(true);
      if (!named) void list(false);
    } catch (e) {
      setFailure(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'El navegador no dio permiso para usar el micrófono.'
          : errorMessage(e),
      );
    }
  }
  const pct = level === null ? 0 : Math.max(0, Math.min(100, ((level + 70) / 60) * 100));
  return (
    <div className="stack">
      <section className="panel">
        <h2>Micrófono</h2>
        {(error || failure) && <Alert>{error || failure}</Alert>}
        <div className="form-grid">
          <label className="field">
            Dispositivo
            <select value={prefs.micId} onChange={(e) => prefs.update({ micId: e.target.value })}>
              <option value="">Predeterminado del sistema</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Micrófono ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Prueba de nivel
            <div className="row-wrap">
              <button className="button secondary small" onClick={() => void test()}>
                {testing ? <Square size={15} /> : <Play size={15} />}{' '}
                {testing ? 'Detener' : 'Probar 15 segundos'}
              </button>
              {!named && (
                <button className="button quiet small" onClick={() => void list(true)}>
                  Mostrar nombres
                </button>
              )}
            </div>
          </div>
        </div>
        {testing && (
          <div role="status" aria-live="polite">
            <div
              className={`mini-meter ${level !== null && level < prefs.threshold ? 'low' : ''}`}
              style={{ marginTop: 8 }}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="caption">
              {level === null
                ? ''
                : `${Math.round(level)} dBFS · ${level >= prefs.threshold ? 'se detecta como voz' : 'por debajo del umbral'}`}
            </p>
          </div>
        )}
        <label className="field">
          Umbral del detector de voz: {prefs.threshold} dBFS
          <input
            type="range"
            min={-60}
            max={-15}
            value={prefs.threshold}
            onChange={(e) => prefs.update({ threshold: Number(e.target.value) })}
          />
        </label>
        <p className="caption">
          Habla con tu volumen normal durante la prueba. Si tu voz queda por debajo del umbral, bájalo. Si el
          ruido de la sala lo supera, súbelo.
        </p>
      </section>
      <VoicesPanel />
      <section className="panel">
        <h2>Reconocimiento de voz</h2>
        <p>
          Motor actual: <strong>{STT_TEXT[ai.stt]}</strong>. Se cambia en Modelos de IA, función
          «Reconocimiento de voz».
        </p>
        <p className="caption">
          Usa auriculares si quieres interrumpir a los interlocutores mientras hablan: así el micrófono no
          capta su voz.
        </p>
      </section>
    </div>
  );
}

function VoicesPanel() {
  const ai = useAi();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [temperament, setTemperament] = useState<Temperament>('cordial'),
    [gender, setGender] = useState<'f' | 'm'>('f'),
    [note, setNote] = useState(''),
    [playing, setPlaying] = useState(false);
  const cancel = useRef<() => void>(() => undefined);
  useEffect(() => {
    void loadSystemVoices(ai.allowOnlineVoices).then(setVoices);
  }, [ai.allowOnlineVoices]);
  useEffect(() => () => cancel.current(), []);
  async function preview() {
    cancel.current();
    setNote('');
    const { tts, warning } = await makeTts();
    setNote(warning || `Motor: ${tts.label}.`);
    const t = TEMPERAMENTS[temperament].voice;
    const handle = tts.speak(
      temperament === 'desafiante' || temperament === 'exigente'
        ? 'Su respuesta no me convence. ¿Qué evidencia concreta sostiene esa afirmación?'
        : 'Gracias por su exposición. Me gustaría que precisara un poco más su metodología.',
      {
        gender,
        pitch: (gender === 'f' ? 1.08 : 0.9) * t.pitch,
        rate: t.rate,
        pause: t.pause,
        emphasis: t.emphasis,
        voiceKey: '',
        seed: gender === 'f' ? 0 : 1,
      },
    );
    setPlaying(true);
    cancel.current = () => {
      handle.cancel();
      setPlaying(false);
    };
    await handle.done.catch((e: unknown) => setNote(errorMessage(e)));
    setPlaying(false);
  }
  function sample(v: SpeechSynthesisVoice) {
    cancel.current();
    const tts = new SystemTts([v]);
    const g = voiceGender(v) ?? 'f';
    const handle = tts.speak('Buenos días. Empecemos con su presentación.', {
      gender: g,
      pitch: 1,
      rate: 1,
      pause: 300,
      emphasis: 0,
      voiceKey: v.name,
      seed: 0,
    });
    cancel.current = () => handle.cancel();
  }
  return (
    <section className="panel">
      <h2>Voces de los interlocutores</h2>
      <p>
        Motor actual: <strong>{TTS_TEXT[ai.tts]}</strong>. Cada temperamento cambia el ritmo, la altura y las
        pausas. Si interrumpes mientras alguien habla, su voz se detiene.
      </p>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label className="field">
          Temperamento
          <select value={temperament} onChange={(e) => setTemperament(e.target.value as Temperament)}>
            {(Object.keys(TEMPERAMENTS) as Temperament[]).map((t) => (
              <option key={t} value={t}>
                {TEMPERAMENTS[t].name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Voz
          <select value={gender} onChange={(e) => setGender(e.target.value as 'f' | 'm')}>
            <option value="f">Femenina</option>
            <option value="m">Masculina</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="button secondary" onClick={() => (playing ? cancel.current() : void preview())}>
          {playing ? <Square size={16} /> : <Play size={16} />} {playing ? 'Detener' : 'Escuchar ejemplo'}
        </button>
      </div>
      {note && (
        <p className="caption" role="status">
          {note}
        </p>
      )}
      <Toggle
        checked={ai.allowOnlineVoices}
        onChange={(v) => ai.update({ allowOnlineVoices: v })}
        title="Permitir voces en línea del navegador"
      >
        Algunas voces de Edge y Chrome se generan en servidores de Microsoft o Google: el texto de las
        preguntas sale de tu equipo. Desactivado por defecto.
      </Toggle>
      <details>
        <summary>Voces del sistema disponibles ({voices.length})</summary>
        {voices.length ? (
          <ul className="model-files" style={{ marginTop: 10 }}>
            {voices.map((v) => (
              <li key={v.voiceURI} className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{v.name}</strong> · {v.lang} · {v.localService ? 'local' : 'en línea'}
                  {voiceGender(v)
                    ? ` · ${voiceGender(v) === 'f' ? 'femenina' : 'masculina'} (estimado por el nombre)`
                    : ''}
                </span>
                <button className="button quiet small" onClick={() => sample(v)}>
                  <Play size={14} /> Escuchar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="caption" style={{ marginTop: 8 }}>
            No hay voces en español {ai.allowOnlineVoices ? '' : 'locales '}en este navegador. Instala voces
            Piper en Modelos de IA o agrega voces en tu sistema operativo.
          </p>
        )}
      </details>
    </section>
  );
}

/* ================================== Cámara ================================== */
function CameraSection() {
  const prefs = usePreferences();
  const ai = useAi();
  const { devices, error, list, named } = useDevices('videoinput');
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null),
    [failure, setFailure] = useState(''),
    [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    void managedStatus(VISION_MODEL, basePath).then((s) => setInstalled(s.installed));
  }, []);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);
  async function preview() {
    if (stream) {
      setStream(null);
      return;
    }
    setFailure('');
    try {
      setStream(
        await navigator.mediaDevices.getUserMedia({
          video: prefs.cameraId ? { deviceId: { exact: prefs.cameraId } } : { facingMode: 'user' },
        }),
      );
      if (!named) void list(false);
    } catch (e) {
      setFailure(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'El navegador no dio permiso para usar la cámara.'
          : errorMessage(e),
      );
    }
  }
  return (
    <div className="stack">
      <section className="panel">
        <h2>Cámara</h2>
        {(error || failure) && <Alert>{error || failure}</Alert>}
        <div className="form-grid">
          <label className="field">
            Dispositivo
            <select value={prefs.cameraId} onChange={(e) => prefs.update({ cameraId: e.target.value })}>
              <option value="">Cámara frontal predeterminada</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Cámara ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Vista previa
            <button className="button secondary small" onClick={() => void preview()}>
              {stream ? <Square size={15} /> : <Play size={15} />} {stream ? 'Detener' : 'Ver cámara'}
            </button>
          </div>
        </div>
        {stream && (
          <video
            ref={video}
            className="self-view"
            autoPlay
            muted
            playsInline
            style={{ maxWidth: 360, transform: 'scaleX(-1)', borderRadius: 12 }}
            aria-label="Vista previa de la cámara"
          />
        )}
        <Toggle
          checked={ai.vision}
          onChange={(v) => ai.update({ vision: v })}
          title="Analizar lenguaje corporal"
        >
          {installed === null
            ? 'Comprobando MediaPipe…'
            : installed
              ? 'MediaPipe está instalado.'
              : 'Instala MediaPipe en Modelos de IA para medir mirada, gestos y postura.'}
        </Toggle>
      </section>
      <section className="panel">
        <h2>Qué se mide y qué no</h2>
        <ul className="plain-list">
          <li>
            Se mide: hacia dónde miras, si tus manos están visibles, gestos, manos en la cara y la inclinación
            de hombros.
          </li>
          <li>No se mide: emociones, personalidad ni identidad. No se reconoce a nadie.</li>
          <li>
            La imagen se procesa en este equipo. Solo se guarda un video si activas la grabación de la sesión.
          </li>
          <li>
            La luz, el ángulo y la distancia afectan los resultados: el informe lo indica cuando hay pocos
            datos.
          </li>
        </ul>
      </section>
    </div>
  );
}

/* ================================ Privacidad ================================ */
function PrivacySection() {
  const ai = useAi();
  const [whisper, setWhisper] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all(
      ['whisper-small', 'whisper-base', 'whisper-tiny'].map(
        async (id) => [id, (await managedStatus(managed(id)!, basePath)).installed] as const,
      ),
    ).then((r) => setWhisper(r.find(([, ok]) => ok)?.[0] ?? null));
  }, []);
  const local = (u: string) => {
    try {
      return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(u).hostname);
    } catch {
      return false;
    }
  };
  const llmUrl = ai.provider === 'ollama' ? ai.ollamaUrl : ai.openai.baseUrl;
  const items: { ok: boolean; title: string; text: string }[] = [
    {
      ok: !ai.useLlm || local(llmUrl),
      title: 'Modelo de lenguaje',
      text: !ai.useLlm
        ? 'Desactivado. Los interlocutores usan reglas en tu equipo.'
        : local(llmUrl)
          ? `Se ejecuta en este equipo (${llmUrl}). Tus respuestas y tu material no salen de él.`
          : `Se envía texto a ${llmUrl}, que no es este equipo.`,
    },
    {
      ok: ai.stt !== 'navegador' && (ai.stt !== 'servidor' || local(ai.sttServer.baseUrl)),
      title: 'Reconocimiento de voz',
      text:
        ai.stt === 'navegador'
          ? 'Usa el reconocimiento del navegador: en Chrome y Edge tu voz se envía a Google o Microsoft.'
          : ai.stt === 'servidor'
            ? `Se envía audio a ${ai.sttServer.baseUrl}.`
            : `${STT_TEXT[ai.stt]}: sin envío de audio.`,
    },
    {
      ok: !ai.allowOnlineVoices && (ai.tts !== 'servidor' || local(ai.ttsServer.baseUrl)),
      title: 'Voces',
      text: ai.allowOnlineVoices
        ? 'Permites voces en línea: el texto de las preguntas puede enviarse a Microsoft o Google.'
        : ai.tts === 'servidor'
          ? `Se envía texto a ${ai.ttsServer.baseUrl}.`
          : 'Solo voces locales.',
    },
    { ok: true, title: 'Cámara', text: 'La imagen se analiza en este equipo y nunca se envía.' },
    {
      ok: true,
      title: 'Material académico',
      text: 'Tus documentos se guardan y se procesan en este equipo. Con un modelo local, sus fragmentos solo van a ese modelo.',
    },
    {
      ok: true,
      title: 'Descargas de modelos',
      text: 'Solo cuando pulsas instalar: Hugging Face (Whisper y Piper), Google (MediaPipe) u Ollama (sus modelos). Esos sitios ven tu dirección IP, no tus datos.',
    },
    {
      ok: true,
      title: 'Telemetría',
      text: 'No hay analítica, publicidad, cuentas ni sincronización remota.',
    },
  ];
  function strict() {
    ai.update({
      allowOnlineVoices: false,
      ...(ai.stt === 'navegador' ? { stt: (whisper as typeof ai.stt | null) ?? 'escrito' } : {}),
      ...(ai.tts === 'servidor' && !local(ai.ttsServer.baseUrl) ? { tts: 'sistema' } : {}),
    });
  }
  const allOk = items.every((i) => i.ok);
  return (
    <div className="stack">
      <section className="panel">
        <h2>Con tu configuración actual</h2>
        <ul className="checklist">
          {items.map((i) => (
            <li key={i.title} className="check">
              <span className={`dot ${i.ok ? 'on' : 'warn'}`} aria-hidden="true" />
              <span>
                <strong>{i.title}</strong> · {i.text}
                <span className="sr-only">{i.ok ? ' (local)' : ' (sale del equipo)'}</span>
              </span>
            </li>
          ))}
        </ul>
        {!allOk && (
          <div className="actions">
            <button className="button primary" onClick={strict}>
              <WifiOff size={16} /> Usar solo procesamiento local
            </button>
          </div>
        )}
        {!allOk && (
          <p className="caption">
            Cambia a Whisper{' '}
            {whisper ? `(${managed(whisper)?.name})` : 'o a respuestas escritas si no lo tienes instalado'} y
            desactiva las voces en línea. El modelo de lenguaje remoto se revisa en Modelos de IA.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Tus datos</h2>
        <ul className="plain-list">
          <li>
            Todo se guarda en este equipo:{' '}
            {isDesktop()
              ? 'base SQLite y carpeta de la aplicación'
              : 'almacenamiento del navegador (IndexedDB y CacheStorage)'}
            .
          </li>
          <li>Los datos no se cifran en reposo. Si compartes el equipo, usa una cuenta de usuario propia.</li>
          <li>Las exportaciones contienen tus respuestas y grabaciones: guárdalas en un lugar seguro.</li>
          <li>Puedes borrar cada sesión desde el historial, o todo desde Gestión de datos.</li>
        </ul>
      </section>
    </div>
  );
}

/* ================================ Apariencia ================================ */
function AppearanceSection() {
  const prefs = usePreferences();
  return (
    <section className="panel">
      <div className="field">
        Tema
        <div className="segmented" role="group" aria-label="Tema">
          {(
            [
              ['system', 'Según el sistema'],
              ['light', 'Claro'],
              ['dark', 'Oscuro'],
            ] as const
          ).map(([v, t]) => (
            <button key={v} aria-pressed={prefs.theme === v} onClick={() => prefs.update({ theme: v })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        Tamaño del texto
        <div className="segmented" role="group" aria-label="Tamaño del texto">
          {(
            [
              [15, 'Normal'],
              [16, 'Grande'],
              [18, 'Muy grande'],
            ] as const
          ).map(([v, t]) => (
            <button key={v} aria-pressed={prefs.fontSize === v} onClick={() => prefs.update({ fontSize: v })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <Toggle
        checked={prefs.reducedMotion}
        onChange={(v) => prefs.update({ reducedMotion: v })}
        title="Reducir movimiento"
      >
        Desactiva animaciones de la interfaz y reduce el movimiento de los avatares. También se respeta la
        preferencia del sistema operativo.
      </Toggle>
    </section>
  );
}

/* =============================== Preferencias =============================== */
function PreferencesSection() {
  const prefs = usePreferences();
  const [goal, setGoal] = useState(prefs.goal),
    [fillers, setFillers] = useState(prefs.fillers.join(', ')),
    [status, setStatus] = useState(''),
    [error, setError] = useState('');
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
    prefs.update({ goal: goal.trim(), fillers: dictionary });
    setError('');
    setStatus('Preferencias guardadas en este equipo.');
  }
  return (
    <section className="panel">
      {error && <Alert>{error}</Alert>}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      <label className="field">
        Objetivo personal
        <textarea
          value={goal}
          rows={3}
          maxLength={500}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Defender mi tesis con claridad y responder objeciones con evidencia."
        />
      </label>
      <label className="field">
        Muletillas que quieres vigilar, separadas por comas
        <textarea value={fillers} rows={3} onChange={(e) => setFillers(e.target.value)} />
      </label>
      <p className="caption">
        Se comparan palabras completas, sin distinguir mayúsculas ni acentos. Revisa cada coincidencia en su
        contexto: no toda repetición es una muletilla.
      </p>
      <button className="button primary" onClick={save}>
        <Save size={17} /> Guardar preferencias
      </button>
    </section>
  );
}

/* ============================== Gestión de datos ============================== */
function DataSection() {
  const sessions = useSessions();
  const records = useRecords();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null),
    [docs, setDocs] = useState<number | null>(null),
    [offline, setOffline] = useState(false),
    [preparing, setPreparing] = useState(false),
    [progress, setProgress] = useState<OfflineProgress | null>(null),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState<'datos' | 'config' | null>(null),
    [withModels, setWithModels] = useState(false),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setEstimate((await navigator.storage?.estimate().catch(() => null)) ?? null);
    setDocs((await libraryStore.docs().catch(() => [])).length);
    void records.reload();
    void sessions.reload();
  }
  useEffect(() => {
    void refresh();
    if (import.meta.env.PROD && !isDesktop())
      void offlineStatus()
        .then((r) => setOffline(!!r?.ready))
        .catch(() => setOffline(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function persist() {
    try {
      const granted = await navigator.storage?.persist();
      setStatus(
        granted
          ? 'El navegador concedió almacenamiento persistente. Igual conviene exportar lo importante.'
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
      const result = await prepareOffline(setProgress);
      setOffline(result.ready);
      setStatus(
        'Interfaz offline preparada y verificada con SHA-256. Puedes recargar y probar sin conexión.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreparing(false);
      setProgress(null);
    }
  }
  async function wipe() {
    setBusy(true);
    setError('');
    try {
      if (confirm === 'datos') {
        if (isDesktop()) for (const s of await store.list()) await store.remove(s.id);
        await clearAllLocalData();
        let freed = 0;
        if (withModels) for (const m of MANAGED) freed += (await removeManaged(m, basePath)).freedBytes;
        setStatus(
          `Se eliminaron tus sesiones, prácticas, grabaciones y materiales de este equipo.${withModels ? ` Modelos de Oratoria Lab desinstalados: ${formatBytes(freed)} liberados.` : ''} Los modelos de Ollama no se tocaron.`,
        );
      } else {
        for (const key of Object.keys(localStorage))
          if (key.startsWith('oratoria-') && key !== 'oratoria-defense-migrated')
            localStorage.removeItem(key);
        useAi.setState({ ...DEFAULT_AI });
        setStatus(
          'La configuración volvió a sus valores iniciales. Recarga la página para aplicarla por completo.',
        );
      }
      setConfirm(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {error && <Alert>{error}</Alert>}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      <section className="panel">
        <h2>
          <HardDrive size={20} /> En este equipo
        </h2>
        <div className="hw-grid" style={{ marginTop: 10 }}>
          <div>
            <strong>{records.records.length}</strong>
            Prácticas guiadas
          </div>
          <div>
            <strong>{sessions.sessions.length}</strong>
            Grabaciones analizadas
          </div>
          <div>
            <strong>{docs ?? '…'}</strong>
            Documentos de material académico
          </div>
          {estimate && (
            <div>
              <strong>{formatBytes(estimate.usage ?? 0)}</strong>
              Usado por este sitio (cuota aproximada {formatBytes(estimate.quota ?? 0)})
            </div>
          )}
        </div>
        <p className="caption" style={{ marginTop: 10 }}>
          {isDesktop()
            ? 'Las grabaciones analizadas se guardan en SQLite y en la carpeta de la aplicación. Prácticas, materiales y modelos de Oratoria Lab, en el almacenamiento del WebView.'
            : 'Todo se guarda en el almacenamiento de este navegador. Borrar los datos del sitio elimina todo.'}
        </p>
        <div className="actions">
          {!isDesktop() && (
            <button className="button secondary" onClick={() => void persist()}>
              Pedir almacenamiento persistente
            </button>
          )}
          <button className="button quiet" onClick={() => void refresh()}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>
          <WifiOff size={20} /> Uso sin conexión
        </h2>
        <p>
          {isDesktop()
            ? 'La interfaz viene incluida en la app de escritorio.'
            : import.meta.env.DEV
              ? 'El modo sin conexión se activa en la compilación de producción, no en desarrollo.'
              : offline
                ? 'La interfaz sin conexión está preparada. Abre este mismo sitio sin internet para usarla.'
                : 'La interfaz sin conexión todavía no está preparada.'}
        </p>
        {import.meta.env.PROD && !isDesktop() && (
          <>
            <p className="caption">
              Descarga y verifica los archivos de la interfaz y los motores WASM de esta versión. Los modelos
              se instalan aparte, en Modelos de IA.
            </p>
            <button className="button secondary" disabled={preparing} onClick={() => void prepare()}>
              {preparing ? 'Preparando…' : 'Preparar o actualizar uso sin conexión'}
            </button>
            {progress && (
              <p className="caption" role="status">
                Verificado {Math.floor((progress.verifiedBytes * 100) / progress.totalBytes)} % ·{' '}
                {progress.file}
              </p>
            )}
          </>
        )}
      </section>
      <section className="panel">
        <h2>
          <Trash2 size={20} /> Eliminar
        </h2>
        <p>
          Antes de borrar, exporta desde el historial lo que quieras conservar. Esta acción no se puede
          deshacer.
        </p>
        <div className="actions">
          <button className="button danger" onClick={() => setConfirm('datos')}>
            Eliminar todos mis datos
          </button>
          <button className="button secondary" onClick={() => setConfirm('config')}>
            Restablecer configuración
          </button>
        </div>
      </section>
      {confirm && (
        <Confirm
          title={confirm === 'datos' ? '¿Eliminar todos tus datos?' : '¿Restablecer la configuración?'}
          confirmLabel={confirm === 'datos' ? 'Eliminar todo' : 'Restablecer'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void wipe()}
        >
          {confirm === 'datos' ? (
            <>
              <p>
                Se borrarán de este equipo las prácticas, informes, grabaciones, transcripciones y documentos
                de material académico.
              </p>
              <Toggle
                checked={withModels}
                onChange={setWithModels}
                title="Desinstalar también los modelos de Oratoria Lab"
              >
                Whisper, voces Piper y MediaPipe. Los modelos de Ollama nunca se tocan desde aquí.
              </Toggle>
            </>
          ) : (
            <p>
              Se restablecen preferencias, apariencia, modelos asignados y opciones de práctica. Tus sesiones
              y materiales se conservan.
            </p>
          )}
        </Confirm>
      )}
    </div>
  );
}

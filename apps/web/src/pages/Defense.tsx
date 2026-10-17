import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Presentation,
  MessagesSquare,
  Timer,
  Camera,
  CameraOff,
  Mic,
  Sparkles,
  Volume2,
  Captions,
  Play,
  Pause,
  Square,
  RotateCcw,
  Download,
  ArrowRight,
  Upload,
  Trash2,
  CheckCircle2,
  CircleAlert,
  Repeat,
  Eye,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import {
  COMMITTEE,
  DIFFICULTY_TEXT,
  buildReport,
  priorities,
  strengths,
  reportText,
  fallbackQuestions,
  fallbackFollowUp,
  fallbackInterruption,
  nextAttention,
  questionsPrompt,
  parseQuestions,
  answerPrompt,
  parseAnswer,
  interruptionPrompt,
  parseInterruption,
  contentPrompt,
  parseContent,
  countTerms,
  wordCount,
  seeded,
  type AnswerRecord,
  type DefenseReport,
  type Finding,
  type MemberId,
  type Phase,
  type PlannedQuestion,
  type SpeechChunk,
} from '@oratoria/defense';
import { errorMessage, formatDuration } from '@oratoria/core';
import { downloadBlob, safeFilename } from '@oratoria/export';
import { PageHead, Alert, Metric, Chart, Confirm } from '../components';
import { usePreferences } from '../state';
import { useDefense, type DefenseSetup } from '../defense/store';
import { DefenseEngine, type LiveStats } from '../defense/engine';
import { LiveTranscriber, recognitionSupported, loadVoices, speak, stopSpeaking } from '../defense/speech';
import { createVision, visionStatus, VISION } from '../defense/vision';
import { chat } from '../defense/llm';
import { Audience, describeRoom, type PersonState } from '../defense/Audience';
import { VisionPanel, LlmPanel, useVisionInstalled } from '../defense/panels';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEVEL_TEXT: Record<Finding['level'], string> = {
  fortaleza: 'Fortaleza',
  adecuado: 'Adecuado',
  mejorar: 'Por mejorar',
  'sin-datos': 'Sin datos',
};
const AREA_TEXT: Record<Finding['area'], string> = {
  voz: 'Voz',
  lenguaje: 'Lenguaje',
  cuerpo: 'Lenguaje corporal',
  respuestas: 'Respuestas a la comisión',
  tiempo: 'Tiempo',
};
const MODES: { id: DefenseSetup['mode']; name: string; text: string; icon: typeof Presentation }[] = [
  {
    id: 'completa',
    name: 'Defensa completa',
    text: 'Expones frente a la comisión y el público, y luego respondes sus preguntas.',
    icon: Presentation,
  },
  {
    id: 'preguntas',
    name: 'Solo ronda de preguntas',
    text: 'La comisión pregunta a partir de tu resumen. Ideal para practicar respuestas difíciles.',
    icon: MessagesSquare,
  },
  {
    id: 'exposicion',
    name: 'Solo exposición',
    text: 'Ensaya la presentación con tiempo, público y mediciones, sin preguntas al final.',
    icon: Timer,
  },
];
function stripLatex(text: string) {
  return text
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}$]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function Defense() {
  const { setup, llm, reports, addReport, removeReport } = useDefense();
  const [view, setView] = useState<'setup' | 'run' | 'report'>('setup'),
    [report, setReport] = useState<DefenseReport | null>(null),
    [media, setMedia] = useState<Blob | null>(null);
  useEffect(() => {
    if (view !== 'run') return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [view]);
  if (view === 'run')
    return (
      <Run
        setup={setup}
        llmEnabled={llm.enabled}
        onCancel={() => setView('setup')}
        onFinish={(r, blob) => {
          addReport(r);
          setReport(r);
          setMedia(blob);
          setView('report');
        }}
      />
    );
  if (view === 'report' && report)
    return (
      <ReportView
        report={report}
        media={media}
        history={reports}
        onAgain={() => {
          setMedia(null);
          setView('setup');
        }}
      />
    );
  return (
    <SetupView
      onStart={() => setView('run')}
      reports={reports}
      onOpen={(r) => {
        setReport(r);
        setMedia(null);
        setView('report');
      }}
      onDelete={removeReport}
    />
  );
}

function Toggle({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="toggle-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </label>
  );
}
function Check({ ok, title, children }: { ok: boolean | null; title: string; children: ReactNode }) {
  return (
    <li className={`check ${ok ? 'ok' : ok === false ? 'warn' : ''}`}>
      {ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </li>
  );
}
function SetupView({
  onStart,
  reports,
  onOpen,
  onDelete,
}: {
  onStart: () => void;
  reports: DefenseReport[];
  onOpen: (r: DefenseReport) => void;
  onDelete: (id: string) => void;
}) {
  const { setup, updateSetup, llm } = useDefense();
  const { installed } = useVisionInstalled();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null),
    [error, setError] = useState(''),
    [panel, setPanel] = useState<'vision' | 'llm' | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const speech = recognitionSupported();
  useEffect(() => {
    void loadVoices().then(setVoices);
  }, []);
  async function load(file: File) {
    setError('');
    if (file.size > 2 * 1024 * 1024) {
      setError(
        'El archivo es muy grande. Usa un texto de hasta 2 MB, por ejemplo el resumen o las conclusiones.',
      );
      return;
    }
    const text = await file.text();
    updateSetup({ summary: (file.name.endsWith('.tex') ? stripLatex(text) : text).slice(0, 20000) });
  }
  const canStart =
    setup.mode !== 'preguntas' || setup.summary.trim().length >= 40 || setup.title.trim().length > 5;
  return (
    <>
      <PageHead
        eyebrow="SIMULADOR DE DEFENSA"
        title="Ensaya tu defensa frente a una comisión."
        description="Una comisión de tres personas y público virtual te escuchan, te miran, te interrumpen y te preguntan. Al final recibes un informe de tus habilidades blandas con ejercicios concretos."
      />
      {error && <Alert>{error}</Alert>}
      <div className="scenario-grid">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`scenario ${setup.mode === m.id ? 'selected' : ''}`}
            aria-pressed={setup.mode === m.id}
            onClick={() => updateSetup({ mode: m.id })}
          >
            <m.icon size={23} />
            <h2>{m.name}</h2>
            <p>{m.text}</p>
            <span>
              {setup.mode === m.id ? 'Seleccionado' : 'Elegir modalidad'} <ArrowRight size={15} />
            </span>
          </button>
        ))}
      </div>
      <div className="defense-setup-grid">
        <section className="panel">
          <h2>Tu tesis</h2>
          <label className="field">
            Título
            <input
              value={setup.title}
              maxLength={200}
              onChange={(e) => updateSetup({ title: e.target.value })}
              placeholder="Por ejemplo: Robot de navegación autónomo"
            />
          </label>
          <label className="field">
            Resumen o puntos clave
            <textarea
              rows={7}
              value={setup.summary}
              maxLength={20000}
              onChange={(e) => updateSetup({ summary: e.target.value })}
              placeholder="Pega el resumen de tu tesis, los objetivos, la metodología y los resultados principales. La comisión lo usa para preguntarte."
            />
          </label>
          <div className="actions">
            <label className="button secondary file-pick">
              <Upload size={16} /> Cargar .txt, .md o .tex
              <input
                type="file"
                accept=".txt,.md,.tex,text/plain,text/markdown"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void load(f).catch((x) => setError(errorMessage(x)));
                  e.target.value = '';
                }}
              />
            </label>
            <span className="caption">
              {setup.summary.length.toLocaleString('es-CL')} de 20.000 caracteres
            </span>
          </div>
          <div className="divider" />
          <h2>La comisión</h2>
          <div className="form-grid">
            <label className="field">
              Nivel de exigencia
              <select
                value={setup.difficulty}
                onChange={(e) => updateSetup({ difficulty: e.target.value as DefenseSetup['difficulty'] })}
              >
                <option value="amable">Amable</option>
                <option value="estandar">Estándar</option>
                <option value="exigente">Exigente</option>
              </select>
            </label>
            <label className="field">
              Preguntas en la ronda
              <select
                value={setup.questions}
                disabled={setup.mode === 'exposicion'}
                onChange={(e) => updateSetup({ questions: Number(e.target.value) })}
              >
                {[3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tiempo de exposición (minutos)
              <input
                type="number"
                min={2}
                max={60}
                value={setup.minutes}
                disabled={setup.mode === 'preguntas'}
                onChange={(e) =>
                  updateSetup({ minutes: Math.max(2, Math.min(60, Number(e.target.value) || 2)) })
                }
              />
            </label>
            <label className="field">
              Público en la sala
              <select
                value={setup.audience}
                onChange={(e) =>
                  updateSetup({ audience: Number(e.target.value) as DefenseSetup['audience'] })
                }
              >
                <option value={0}>Solo la comisión</option>
                <option value={6}>Comisión y 6 personas</option>
                <option value={12}>Comisión y 12 personas</option>
              </select>
            </label>
          </div>
          <p className="caption">{DIFFICULTY_TEXT[setup.difficulty]}</p>
          <div className="toggle-grid">
            <Toggle
              checked={setup.interruptions}
              onChange={(v) => updateSetup({ interruptions: v })}
              title="Interrupciones"
            >
              Un integrante te interrumpe a mitad de la exposición, como pasa en defensas reales.
            </Toggle>
            <Toggle
              checked={setup.followUps}
              onChange={(v) => updateSetup({ followUps: v })}
              title="Repreguntas"
            >
              Si una respuesta queda débil, la misma persona insiste.
            </Toggle>
            <Toggle
              checked={setup.distractions}
              onChange={(v) => updateSetup({ distractions: v })}
              title="Distracciones del público"
            >
              Algunas personas miran su celular aunque lo hagas bien, para entrenar tu concentración.
            </Toggle>
          </div>
        </section>
        <div>
          <section className="panel">
            <h2>Cómo te va a observar</h2>
            <div className="toggle-grid one">
              <Toggle checked={setup.camera} onChange={(v) => updateSetup({ camera: v })} title="Cámara">
                Mide mirada hacia la comisión, gestos, manos en la cara y postura. La imagen no sale de tu
                equipo.
              </Toggle>
              <Toggle
                checked={setup.liveText}
                onChange={(v) => updateSetup({ liveText: v })}
                title="Transcripción en vivo"
              >
                Necesaria para velocidad, muletillas y preguntas sobre lo que dijiste. En Chrome y Edge el
                audio lo procesa Google o Microsoft.
              </Toggle>
              <Toggle
                checked={setup.voice}
                onChange={(v) => updateSetup({ voice: v })}
                title="Voz de la comisión"
              >
                La comisión lee sus preguntas en voz alta. Usa audífonos para que el micrófono no la capte.
              </Toggle>
              <Toggle
                checked={setup.indicators}
                onChange={(v) => updateSetup({ indicators: v })}
                title="Indicadores en pantalla"
              >
                Desactívalos para un ensayo realista sin ayudas; el informe final se genera igual.
              </Toggle>
              <Toggle checked={setup.record} onChange={(v) => updateSetup({ record: v })} title="Grabación">
                Graba video (o audio sin cámara) para que te veas después. Queda solo en memoria hasta que lo
                descargues.
              </Toggle>
            </div>
          </section>
          <section className="panel">
            <h2>Antes de empezar</h2>
            <ul className="checklist">
              <Check ok={null} title="Micrófono">
                El navegador pedirá permiso al comenzar. Usa audífonos si activas la voz de la comisión.
              </Check>
              {setup.camera && (
                <Check ok={installed} title="Modelos de cámara">
                  {installed
                    ? 'Instalados. Se medirán mirada, gestos y postura.'
                    : 'Sin instalar: verás tu imagen, pero no habrá mediciones de cuerpo.'}{' '}
                  {!installed && (
                    <button
                      className="text-link"
                      onClick={() => setPanel(panel === 'vision' ? null : 'vision')}
                    >
                      Instalar (
                      {Math.round(
                        VISION.models.reduce((n, m) => n + (m.bytes ?? m.approxBytes), 0) / 1000000,
                      )}{' '}
                      MB)
                    </button>
                  )}
                </Check>
              )}
              {setup.liveText && (
                <Check ok={speech} title="Transcripción en vivo">
                  {speech
                    ? 'Disponible en este navegador.'
                    : 'Este navegador no la tiene. Abre la app en Chrome o Edge para medir velocidad y muletillas.'}
                </Check>
              )}
              {setup.voice && (
                <Check ok={voices === null ? null : voices.length > 0} title="Voces en español">
                  {voices === null
                    ? 'Revisando…'
                    : voices.length
                      ? `${voices.length} disponibles.`
                      : 'No hay voces en español instaladas; las preguntas se mostrarán por escrito.'}{' '}
                  {!!voices?.length && (
                    <button
                      className="text-link"
                      onClick={() =>
                        void speak('Buenos días. Puede comenzar cuando esté listo.', 0, voices).then(() =>
                          speak('Tengo una pregunta sobre su metodología.', 1, voices),
                        )
                      }
                    >
                      Escuchar
                    </button>
                  )}
                </Check>
              )}
              <Check ok={llm.enabled} title="Comisión con IA">
                {llm.enabled
                  ? `Conectada (${llm.model}). Preguntará sobre lo que expongas y comentará tu contenido.`
                  : 'Sin conectar: usará un banco de preguntas de defensa y términos de tu resumen.'}{' '}
                <button className="text-link" onClick={() => setPanel(panel === 'llm' ? null : 'llm')}>
                  {llm.enabled ? 'Cambiar' : 'Conectar'}
                </button>
              </Check>
            </ul>
            <button className="button primary start-button" disabled={!canStart} onClick={onStart}>
              <Play size={17} /> Entrar a la sala
            </button>
            {!canStart && (
              <p className="caption">
                Para la ronda de preguntas, escribe al menos el título o un resumen breve.
              </p>
            )}
          </section>
        </div>
      </div>
      {panel === 'vision' && <VisionPanel compact />}
      {panel === 'llm' && <LlmPanel compact />}
      {reports.length > 0 && (
        <section className="panel">
          <h2>Tus intentos anteriores</h2>
          <p>Compara tus intentos para ver si mejoras. Se guardan los últimos 10 en este navegador.</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Modalidad</th>
                  <th>Exposición</th>
                  <th>Velocidad</th>
                  <th>Muletillas</th>
                  <th>Mirada</th>
                  <th>Por mejorar</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.createdAt).toLocaleString('es-CL', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>{MODES.find((m) => m.id === r.mode)?.name}</td>
                    <td>{r.exposition.seconds ? formatDuration(r.exposition.seconds) : '—'}</td>
                    <td>{r.exposition.wpm ? `${Math.round(r.exposition.wpm)} ppm` : '—'}</td>
                    <td>
                      {r.exposition.fillersPer100 !== null
                        ? `${r.exposition.fillersPer100.toFixed(1)} /100`
                        : '—'}
                    </td>
                    <td>
                      {(() => {
                        const c = r.findings.find((f) => f.id === 'contacto');
                        return c ? c.value.split(' ')[0] + ' %' : '—';
                      })()}
                    </td>
                    <td>{r.findings.filter((f) => f.level === 'mejorar').length}</td>
                    <td className="row-actions">
                      <button className="text-link" onClick={() => onOpen(r)}>
                        Ver informe
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Eliminar intento del ${new Date(r.createdAt).toLocaleString('es-CL')}`}
                        onClick={() => setDeleting(r.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {deleting && (
        <Confirm
          title="¿Eliminar este intento?"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting);
            setDeleting(null);
          }}
        >
          Se borrará su informe de este navegador.
        </Confirm>
      )}
    </>
  );
}

type Stage = 'preparando' | 'comision' | 'exposicion' | 'escuchando' | 'pensando' | 'cierre';
function Run({
  setup,
  llmEnabled,
  onCancel,
  onFinish,
}: {
  setup: DefenseSetup;
  llmEnabled: boolean;
  onCancel: () => void;
  onFinish: (r: DefenseReport, media: Blob | null) => void;
}) {
  const llm = useDefense((s) => s.llm),
    threshold = usePreferences((s) => s.threshold),
    fillers = usePreferences((s) => s.fillers);
  const { installed } = useVisionInstalled();
  const [stage, setStage] = useState<Stage>('preparando'),
    [paused, setPaused] = useState(false),
    [fatal, setFatal] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]),
    [status, setStatus] = useState('Preparando micrófono, cámara y voces…'),
    [question, setQuestion] = useState<PlannedQuestion | null>(null),
    [speaking, setSpeaking] = useState<MemberId | null>(null),
    [live, setLive] = useState<LiveStats | null>(null),
    [caption, setCaption] = useState(''),
    [lastFinal, setLastFinal] = useState(''),
    [typed, setTyped] = useState(''),
    [expSeconds, setExpSeconds] = useState(0),
    [card, setCard] = useState(''),
    [room, setRoom] = useState<{ committee: PersonState[]; audience: PersonState[] }>({
      committee: ['atento', 'atento', 'atento'],
      audience: Array(setup.audience).fill('atento'),
    }),
    [attention, setAttention] = useState(70),
    [confirmCancel, setConfirmCancel] = useState(false),
    [stats, setStats] = useState({ wpm: null as number | null, fillers: 0, answered: 0, total: 0 });
  const engine = useRef<DefenseEngine | null>(null),
    transcriber = useRef<LiveTranscriber | null>(null),
    transcriptOk = useRef(false),
    voices = useRef<SpeechSynthesisVoice[]>([]),
    chunks = useRef<SpeechChunk[]>([]),
    answers = useRef<AnswerRecord[]>([]),
    queue = useRef<PlannedQuestion[]>([]),
    qIndex = useRef(0),
    asking = useRef<{ q: PlannedQuestion; askedAt: number; chunkStart: number } | null>(null),
    plan = useRef<number[]>([]),
    cards = useRef(new Set<string>()),
    stageRef = useRef<Stage>('preparando'),
    userPhase = useRef<Phase>('exposicion'),
    busy = useRef(false),
    endRound = useRef(false),
    pending = useRef<Promise<unknown>[]>([]),
    alive = useRef(true),
    typedRef = useRef(''),
    liveRef = useRef<LiveStats | null>(null),
    attentionRef = useRef(70),
    rng = useRef(seeded(Date.now() % 1000003)),
    people = useRef(
      Array.from({ length: 12 }, (_, i) => ({
        threshold: 22 + ((i * 37) % 50),
        until: 0,
        forced: 'atento' as PersonState,
      })),
    ),
    notes = useRef({ member: 0, until: 0 }),
    videoRef = useRef<HTMLVideoElement | null>(null),
    controller = useRef(new AbortController()),
    created = useRef(new Date().toISOString());
  const go = (s: Stage) => {
    stageRef.current = s;
    if (alive.current) setStage(s);
  };
  const warn = (m: string) => alive.current && setWarnings((w) => (w.includes(m) ? w : [...w, m]));
  const target = setup.minutes * 60;
  async function speakAs(member: MemberId, text: string) {
    const e = engine.current;
    if (!e || !alive.current) return;
    setSpeaking(member);
    e.setPhase('pregunta');
    transcriber.current?.pause();
    if (setup.voice && voices.current.length) await speak(text, member, voices.current);
    else await sleep(Math.min(7000, 1500 + wordCount(text) * 260));
    if (alive.current) setSpeaking(null);
  }
  function listen(phase: Phase) {
    userPhase.current = phase;
    engine.current?.setPhase(phase);
    transcriber.current?.resume();
  }
  async function ask(q: PlannedQuestion) {
    if (!alive.current || !engine.current) return;
    go('comision');
    setQuestion(q);
    setTyped('');
    typedRef.current = '';
    setLastFinal('');
    await speakAs(q.member, q.text);
    if (!alive.current || !engine.current) return;
    asking.current = { q, askedAt: engine.current.now(), chunkStart: chunks.current.length };
    listen('respuesta');
    go('escuchando');
  }
  async function evaluate(record: AnswerRecord, allowFollowUp: boolean): Promise<string | null> {
    try {
      const text = await chat(
        llm,
        answerPrompt({
          title: setup.title,
          summary: setup.summary,
          member: record.member,
          question: record.question,
          answer: record.text,
          difficulty: setup.difficulty,
          allowFollowUp,
        }),
        controller.current.signal,
        25000,
      );
      const result = parseAnswer(text);
      record.feedback = result.feedback;
      return allowFollowUp ? result.followUp : null;
    } catch (e) {
      if (alive.current) warn(`La IA no pudo comentar una respuesta: ${errorMessage(e)}`);
      return allowFollowUp ? fallbackFollowUp(record.text, setup.difficulty, rng.current) : null;
    }
  }
  async function nextQuestion() {
    const q = queue.current[qIndex.current];
    setStats((s) => ({ ...s, answered: qIndex.current, total: queue.current.length }));
    if (!q) return finish();
    await ask(q);
  }
  async function startQuestions() {
    const e = engine.current;
    if (!e) return;
    go('pensando');
    setQuestion(null);
    setStatus('La comisión prepara sus preguntas…');
    e.setPhase('pregunta');
    transcriber.current?.pause();
    const exposition = chunks.current
      .filter((c) => c.phase === 'exposicion')
      .map((c) => c.text)
      .join(' ');
    const fallback = () =>
      fallbackQuestions({
        text: `${setup.title}. ${setup.summary} ${exposition}`,
        count: setup.questions,
        difficulty: setup.difficulty,
        seed: Math.floor(rng.current() * 100000),
      });
    const generated: Promise<PlannedQuestion[]> = llmEnabled
      ? chat(
          llm,
          questionsPrompt({
            title: setup.title,
            summary: setup.summary,
            exposition,
            count: setup.questions,
            difficulty: setup.difficulty,
          }),
          controller.current.signal,
          60000,
        )
          .then((t) => {
            const qs = parseQuestions(t, setup.questions);
            const extra = fallback().filter((f) => !qs.some((q) => q.text === f.text));
            return [...qs, ...extra].slice(0, setup.questions);
          })
          .catch((err) => {
            warn(
              `La IA no generó preguntas (${errorMessage(err)}). Se usarán preguntas del banco y de tu resumen.`,
            );
            return fallback();
          })
      : Promise.resolve(fallback());
    const intro =
      setup.mode === 'preguntas'
        ? 'Buenos días. Hemos leído su resumen. Comenzamos con las preguntas de la comisión.'
        : 'Muchas gracias por su exposición. Pasamos ahora a la ronda de preguntas.';
    const [qs] = await Promise.all([generated, speakAs(0, intro)]);
    if (!alive.current) return;
    queue.current = qs;
    qIndex.current = 0;
    await nextQuestion();
  }
  async function interrupt() {
    const e = engine.current;
    if (!e || busy.current) return;
    busy.current = true;
    const member: MemberId = rng.current() < 0.5 ? 1 : 2;
    setSpeaking(member);
    const recent = chunks.current
      .filter((c) => c.phase === 'exposicion' && c.t >= e.now() - 90)
      .map((c) => c.text)
      .join(' ');
    let text = fallbackInterruption(recent, rng.current),
      source: PlannedQuestion['source'] = 'regla';
    if (llmEnabled && wordCount(recent) > 15) {
      try {
        text = parseInterruption(
          await chat(
            llm,
            interruptionPrompt({ title: setup.title, recent, member, difficulty: setup.difficulty }),
            controller.current.signal,
            15000,
          ),
        );
        source = 'ia';
      } catch {
        /* Se usa la interrupción por reglas. */
      }
    }
    busy.current = false;
    if (stageRef.current !== 'exposicion' || !alive.current) return;
    await ask({ member, text, kind: 'interrupcion', source });
  }
  async function finishAnswer() {
    const a = asking.current,
      e = engine.current;
    if (!a || !e) return;
    asking.current = null;
    go('pensando');
    setStatus(`${COMMITTEE[a.q.member].name} toma nota…`);
    await sleep(transcriptOk.current ? 1300 : 200);
    if (!alive.current) return;
    const text = [
      ...chunks.current
        .slice(a.chunkStart)
        .filter((c) => c.phase === 'respuesta')
        .map((c) => c.text),
      typedRef.current.trim(),
    ]
      .filter(Boolean)
      .join(' ');
    const record: AnswerRecord = {
      member: a.q.member,
      kind: a.q.kind,
      question: a.q.text,
      source: a.q.source,
      askedAt: a.askedAt,
      startedAt: e.firstVoiceAfter(a.askedAt),
      endedAt: e.now(),
      text,
      feedback: null,
    };
    answers.current.push(record);
    e.setPhase('pregunta');
    transcriber.current?.pause();
    if (a.q.kind === 'interrupcion') {
      if (llmEnabled && text) pending.current.push(evaluate(record, false));
      await speakAs(a.q.member, 'Gracias. Continúe, por favor.');
      if (!alive.current) return;
      setQuestion(null);
      listen('exposicion');
      go('exposicion');
      return;
    }
    const canFollow = setup.followUps && a.q.kind === 'pregunta' && !endRound.current;
    const hasText = wordCount(text) > 0;
    let follow: string | null = null;
    if (llmEnabled && hasText) {
      if (canFollow) follow = await evaluate(record, true);
      else pending.current.push(evaluate(record, false));
    } else if (canFollow) {
      follow = hasText
        ? fallbackFollowUp(text, setup.difficulty, rng.current)
        : record.endedAt - record.askedAt < 8
          ? '¿Podría desarrollar un poco más su respuesta?'
          : null;
    }
    if (!alive.current) return;
    if (follow)
      queue.current.splice(qIndex.current + 1, 0, {
        member: a.q.member,
        text: follow,
        kind: 'repregunta',
        source: llmEnabled && hasText ? 'ia' : 'regla',
      });
    qIndex.current++;
    if (endRound.current) return finish();
    await nextQuestion();
  }
  async function finish() {
    const e = engine.current;
    if (!e || stageRef.current === 'cierre') return;
    go('cierre');
    setQuestion(null);
    setStatus('Preparando tu informe…');
    if (setup.voice) await speakAs(0, 'Muchas gracias. La comisión revisará su presentación.');
    transcriber.current?.stop();
    if (pending.current.length) await Promise.race([Promise.allSettled(pending.current), sleep(20000)]);
    stopSpeaking();
    const media = await e.stop();
    const report = buildReport({
      id: crypto.randomUUID(),
      createdAt: created.current,
      title: setup.title || 'Defensa sin título',
      difficulty: setup.difficulty,
      mode: setup.mode,
      targetMinutes: setup.minutes,
      ticks: e.ticks,
      chunks: chunks.current,
      answers: answers.current,
      transcriptUsed: chunks.current.length > 0,
      fillers,
    });
    if (llmEnabled && (report.expositionText || answers.current.some((x) => x.text))) {
      setStatus('La IA revisa el contenido de tu exposición…');
      try {
        const content = parseContent(
          await chat(
            llm,
            contentPrompt({
              title: setup.title,
              summary: setup.summary,
              exposition: report.expositionText,
              answers: answers.current.map((x) => ({ question: x.question, answer: x.text })),
              difficulty: setup.difficulty,
            }),
            undefined,
            90000,
          ),
        );
        report.content = { model: llm.model, ...content };
      } catch (err) {
        report.notes.push(`No se obtuvo el comentario de contenido de la IA: ${errorMessage(err)}`);
      }
    }
    if (alive.current) onFinish(report, media);
  }
  function endExposition() {
    if (stageRef.current !== 'exposicion') return;
    plan.current = [];
    if (setup.mode === 'exposicion') void finish();
    else void startQuestions();
  }
  function togglePause() {
    const e = engine.current;
    if (!e) return;
    if (!paused) {
      e.pause();
      transcriber.current?.pause();
      setPaused(true);
    } else {
      listen(userPhase.current);
      setPaused(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const signal = controller.current;
    (async () => {
      try {
        voices.current = setup.voice ? await loadVoices() : [];
        if (setup.voice && !voices.current.length)
          warn('No hay voces en español en este equipo. Las preguntas se mostrarán por escrito.');
        const { engine: e, warning } = await DefenseEngine.open({
          camera: setup.camera,
          record: setup.record,
          threshold,
          onLive: (s) => {
            liveRef.current = s;
            if (alive.current) setLive(s);
          },
        });
        if (!alive.current) {
          await e.stop();
          return;
        }
        engine.current = e;
        if (warning) warn(warning);
        e.attachVideo(videoRef.current);
        if (e.hasCamera) {
          if ((await visionStatus()).installed)
            void e.enableVision(createVision).then(() => {
              if (e.vision === 'error') warn(`Análisis de cámara desactivado: ${e.visionError}`);
            });
          else
            warn(
              'Los modelos de cámara no están instalados: te verás en pantalla, pero no se medirán mirada, gestos ni postura.',
            );
        }
        if (setup.liveText) {
          if (recognitionSupported()) {
            const t = new LiveTranscriber(
              'es-CL',
              (text) => {
                const eng = engine.current;
                if (!eng) return;
                const phase =
                  eng.phase === 'exposicion' || eng.phase === 'respuesta' ? eng.phase : userPhase.current;
                chunks.current.push({ text, t: eng.now(), phase });
                if (alive.current) setLastFinal(text);
              },
              (text) => alive.current && setCaption(text),
              (message) => {
                transcriptOk.current = false;
                warn(message);
              },
            );
            transcriber.current = t;
            transcriptOk.current = true;
            t.start();
            t.pause();
          } else
            warn(
              'Este navegador no tiene transcripción en vivo. Usa Chrome o Edge para medir velocidad, muletillas y contenido.',
            );
        }
        if (setup.mode === 'preguntas') await startQuestions();
        else {
          go('comision');
          await speakAs(
            0,
            'Buenos días. Bienvenido a su defensa. Puede comenzar su exposición cuando esté listo.',
          );
          if (!alive.current) return;
          const count = !setup.interruptions || target < 180 ? 0 : setup.difficulty === 'exigente' ? 2 : 1;
          const marks = count === 2 ? [0.33, 0.66] : count === 1 ? [0.45] : [];
          plan.current = marks.map((m) => Math.round(target * (m + (rng.current() - 0.5) * 0.12)));
          listen('exposicion');
          go('exposicion');
        }
      } catch (err) {
        if (alive.current) setFatal(errorMessage(err));
      }
    })();
    return () => {
      alive.current = false;
      signal.abort();
      transcriber.current?.stop();
      stopSpeaking();
      void engine.current?.stop();
    };
    // Se ejecuta una sola vez por práctica: la configuración queda fija al entrar a la sala.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (engine.current && videoRef.current) engine.current.attachVideo(videoRef.current);
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const e = engine.current,
        s = liveRef.current,
        st = stageRef.current;
      if (!e || paused) return;
      const now = e.now(),
        exp = e.phaseSeconds('exposicion');
      setExpSeconds(exp);
      const recentChunks = chunks.current.filter((c) => c.t >= now - 30 && c.phase === userPhase.current);
      const span = Math.min(30, Math.max(5, now - (asking.current?.askedAt ?? 0)));
      const wpm = recentChunks.length
        ? (recentChunks.reduce((n, c) => n + wordCount(c.text), 0) * 60) / span
        : null;
      const expFillers = countTerms(
        chunks.current.filter((c) => c.phase === 'exposicion').map((c) => c.text),
        fillers,
      ).total;
      const fillersRecent = countTerms(
        chunks.current.filter((c) => c.t >= now - 10).map((c) => c.text),
        fillers,
      ).total;
      setStats((x) => ({ ...x, wpm, fillers: expFillers }));
      const userTurn = st === 'exposicion' || st === 'escuchando';
      attentionRef.current = nextAttention(attentionRef.current, {
        speaking: s?.speaking ? 1 : 0,
        silenceSeconds: userTurn ? (s?.silence ?? 0) : 0,
        contact: userTurn ? (s?.contact ?? null) : null,
        fillersRecent,
        wpm: userTurn ? wpm : null,
      });
      setAttention(Math.round(attentionRef.current));
      const a = attentionRef.current,
        r = rng.current;
      if (notes.current.until < now && r() < 0.04)
        notes.current = { member: Math.floor(r() * 3), until: now + 4 };
      const audience = people.current.slice(0, setup.audience).map((p, i) => {
        if (p.until > now) return p.forced;
        if (setup.distractions && r() < 0.012) {
          p.forced = 'celular';
          p.until = now + 6 + r() * 6;
          return p.forced;
        }
        if (a >= p.threshold) return s?.speaking && r() < 0.07 ? 'asiente' : 'atento';
        return (['mira-lado', 'celular', 'aburrido'] as const)[i % 3]!;
      });
      const committee = ([0, 1, 2] as MemberId[]).map((i): PersonState => {
        if (speaking === i) return 'habla';
        if (!userTurn) return 'atento';
        if (notes.current.member === i && notes.current.until > now) return 'escribe';
        if (a < 35 && i === 2) return 'aburrido';
        if (a > 78 && r() < 0.05) return 'asiente';
        return 'atento';
      });
      setRoom({ committee, audience });
      if (st === 'exposicion' && !busy.current) {
        const remaining = target - exp;
        const show = (id: string, text: string, voice?: string) => {
          if (cards.current.has(id)) return;
          cards.current.add(id);
          setCard(text);
          setTimeout(() => alive.current && setCard((c) => (c === text ? '' : c)), 8000);
          if (voice && setup.voice) {
            busy.current = true;
            void speakAs(0, voice).then(() => {
              busy.current = false;
              if (stageRef.current === 'exposicion') listen('exposicion');
            });
          }
        };
        if (target >= 600 && remaining <= 300 && remaining > 120) show('5', 'Quedan 5 minutos');
        if (target >= 300 && remaining <= 120 && remaining > 0) show('2', 'Quedan 2 minutos');
        if (remaining <= 0) show('0', 'Tiempo cumplido', 'Le pido ir cerrando, por favor.');
        if (remaining <= -target * 0.15 && setup.difficulty === 'exigente')
          show('x', 'Se excedió del tiempo', 'Debe terminar ahora para pasar a las preguntas.');
        const next = plan.current[0];
        if (next !== undefined && exp >= next && ((s?.silence ?? 0) >= 0.6 || exp - next > 15)) {
          plan.current.shift();
          void interrupt();
        }
      }
      if (st === 'escuchando' && asking.current && s) {
        const spoke = e.voicedSince(asking.current.askedAt);
        if (spoke >= 6 && s.silence >= 7 && !typedRef.current.trim()) void finishAnswer();
      }
    }, 1000);
    return () => clearInterval(timer);
    // Lee el estado vivo desde referencias; solo debe reiniciarse al pausar o cuando cambia quién habla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, speaking]);
  const roomLabel = describeRoom(room.committee, room.audience);
  const remaining = target - expSeconds;
  const userTurn = stage === 'exposicion' || stage === 'escuchando';
  const showSilenceHint = stage === 'escuchando' && (live?.silence ?? 0) >= 4 && !paused;
  if (fatal)
    return (
      <section className="panel">
        <h1>No se pudo abrir la sala.</h1>
        <Alert>{fatal}</Alert>
        <button className="button primary" onClick={onCancel}>
          Volver a la preparación
        </button>
      </section>
    );
  return (
    <div className="defense-run">
      <div className="stage-wrap">
        <div className="stage-scene">
          <Audience
            committee={room.committee}
            audience={room.audience}
            speaking={speaking}
            label={roomLabel}
          />
          <div className="stage-top">
            <span className={`stage-badge ${userTurn && !paused ? 'live' : ''}`}>
              {paused
                ? 'En pausa'
                : stage === 'exposicion'
                  ? 'Tu exposición'
                  : stage === 'escuchando'
                    ? 'Tu respuesta'
                    : stage === 'comision'
                      ? 'Habla la comisión'
                      : stage === 'pensando'
                        ? 'La comisión piensa'
                        : stage === 'cierre'
                          ? 'Cierre'
                          : 'Preparando'}
            </span>
            {setup.mode !== 'preguntas' && (
              <span className={`stage-clock ${remaining < 0 ? 'over' : remaining <= 120 ? 'warn' : ''}`}>
                <Timer size={16} /> {formatDuration(expSeconds)} / {formatDuration(target)}
              </span>
            )}
          </div>
          {card && (
            <div className="time-card" role="status">
              {card}
            </div>
          )}
        </div>
        <div className="stage-band" aria-live="polite">
          {question ? (
            <>
              <span>
                {COMMITTEE[question.member].name} ·{' '}
                {question.kind === 'repregunta'
                  ? 'repregunta'
                  : question.kind === 'interrupcion'
                    ? 'interrumpe'
                    : 'pregunta'}
                {question.source === 'ia' ? ' · IA' : ''}
              </span>
              <p>{question.text}</p>
            </>
          ) : stage === 'pensando' || stage === 'preparando' || stage === 'cierre' ? (
            <p className="band-status" role="status">
              <span className="spinner" /> {status}
            </p>
          ) : (
            <p className="band-hint">
              {stage === 'exposicion'
                ? 'Habla mirando a la comisión, como si estuvieras en la sala.'
                : 'Escucha a la comisión.'}
            </p>
          )}
        </div>
      </div>
      <aside className="stage-side">
        {setup.camera && (
          <figure className={`self-view-box ${engine.current?.hasCamera ? '' : 'hidden'}`}>
            <video ref={videoRef} className="self-view" muted playsInline aria-label="Tu cámara" />
            <figcaption>Tu cámara, en modo espejo</figcaption>
          </figure>
        )}
        {warnings.map((w) => (
          <Alert key={w}>{w}</Alert>
        ))}
        <div className="stage-controls">
          {stage === 'exposicion' && (
            <button className="button primary" onClick={endExposition} disabled={paused}>
              <Square size={16} />{' '}
              {setup.mode === 'exposicion' ? 'Terminar exposición' : 'Terminar y pasar a preguntas'}
            </button>
          )}
          {stage === 'escuchando' && (
            <>
              <button className="button primary" onClick={() => void finishAnswer()} disabled={paused}>
                <ArrowRight size={16} />{' '}
                {asking.current?.q.kind === 'interrupcion'
                  ? 'Respondí, sigo con la exposición'
                  : 'Terminé mi respuesta'}
              </button>
              <button
                className="button secondary"
                disabled={paused}
                onClick={() => {
                  const a = asking.current;
                  if (!a) return;
                  void speakAs(a.q.member, a.q.text).then(() => listen('respuesta'));
                }}
              >
                <Repeat size={16} /> Repetir pregunta
              </button>
            </>
          )}
          {userTurn && (
            <button className="button secondary" onClick={togglePause}>
              {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Continuar' : 'Pausar'}
            </button>
          )}
          {stage === 'escuchando' && asking.current?.q.kind !== 'interrupcion' && (
            <button
              className="button quiet"
              onClick={() => {
                endRound.current = true;
                void finishAnswer();
              }}
            >
              Terminar la ronda ahora
            </button>
          )}
          {stage !== 'cierre' && (
            <button className="button quiet" onClick={() => setConfirmCancel(true)}>
              Salir sin informe
            </button>
          )}
        </div>
        {showSilenceHint && (
          <p className="caption" role="status">
            Si terminaste, la comisión seguirá en unos segundos. Si no, continúa hablando.
          </p>
        )}
        {stage === 'escuchando' && !transcriptOk.current && (
          <label className="field">
            Escribe lo esencial de tu respuesta (opcional)
            <textarea
              rows={3}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                typedRef.current = e.target.value;
              }}
              placeholder="Sin transcripción en vivo, esto permite comentar tu contenido."
            />
          </label>
        )}
        {setup.indicators ? (
          <div className="live-grid">
            <LiveItem icon={<Mic size={16} />} label="Tu voz">
              <div className="mini-meter" aria-hidden="true">
                <span style={{ width: `${Math.round((live?.level ?? 0) * 100)}%` }} />
              </div>
              <strong>{live?.speaking ? 'Hablando' : `Silencio ${Math.round(live?.silence ?? 0)} s`}</strong>
            </LiveItem>
            <LiveItem icon={<Volume2 size={16} />} label="Velocidad">
              <strong>
                {!transcriptOk.current
                  ? 'Sin transcripción'
                  : stats.wpm
                    ? `${Math.round(stats.wpm)} ppm`
                    : '—'}
              </strong>
              <small>Referencia: 120 a 160</small>
            </LiveItem>
            <LiveItem icon={<Captions size={16} />} label="Muletillas en la exposición">
              <strong>{transcriptOk.current ? stats.fillers : '—'}</strong>
            </LiveItem>
            <LiveItem
              icon={setup.camera ? <Eye size={16} /> : <CameraOff size={16} />}
              label="Mirada a la comisión"
            >
              <strong>
                {live?.vision === 'on'
                  ? live.faceSeen === false
                    ? 'No se ve tu rostro'
                    : live.contact === null
                      ? '—'
                      : `${Math.round(live.contact * 100)} %`
                  : live?.vision === 'loading'
                    ? 'Cargando…'
                    : 'Sin medición'}
              </strong>
            </LiveItem>
            <LiveItem icon={<Sparkles size={16} />} label="Atención del público">
              <div className={`mini-meter attention ${attention < 40 ? 'low' : ''}`} aria-hidden="true">
                <span style={{ width: `${attention}%` }} />
              </div>
              <strong>{attention >= 70 ? 'Alta' : attention >= 40 ? 'Media' : 'Baja'}</strong>
            </LiveItem>
            {stats.total > 0 && (
              <LiveItem icon={<MessagesSquare size={16} />} label="Ronda de preguntas">
                <strong>
                  {Math.min(stats.answered + 1, stats.total)} de {stats.total}
                </strong>
              </LiveItem>
            )}
          </div>
        ) : (
          <p className="caption">Modo sin ayudas: verás todas las mediciones en el informe final.</p>
        )}
        {setup.indicators && transcriptOk.current && (caption || lastFinal) && (
          <p className="live-caption">
            <span>Lo que escucha la app:</span> {caption || lastFinal}
          </p>
        )}
        {setup.camera && !installed && (
          <p className="caption">
            <Camera size={13} /> Instala los modelos de cámara en Modelos locales para medir tu lenguaje
            corporal.
          </p>
        )}
      </aside>
      {confirmCancel && (
        <Confirm
          title="¿Salir sin informe?"
          confirmLabel="Salir y descartar"
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            setConfirmCancel(false);
            onCancel();
          }}
        >
          Se detendrán la cámara y el micrófono y se descartará esta práctica.
        </Confirm>
      )}
    </div>
  );
}
function LiveItem({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="live-item">
      <span className="live-label">
        {icon} {label}
      </span>
      {children}
    </div>
  );
}

function ReportView({
  report,
  media,
  history,
  onAgain,
}: {
  report: DefenseReport;
  media: Blob | null;
  history: DefenseReport[];
  onAgain: () => void;
}) {
  const [mediaUrl, setMediaUrl] = useState('');
  useEffect(() => {
    if (!media) return;
    const url = URL.createObjectURL(media);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);
  const top = priorities(report),
    good = strengths(report);
  const previous = history.find((r) => r.id !== report.id && r.createdAt < report.createdAt);
  const contact = report.findings.find((f) => f.id === 'contacto');
  const latency = report.findings.find((f) => f.id === 'latencia');
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 50, top: 44, bottom: 30 },
      xAxis: { type: 'category', data: report.timeline.map((t) => formatDuration(t.t)) },
      yAxis: [
        { type: 'value', min: 0, max: 100, name: '%' },
        { type: 'value', min: 0, name: 'ppm' },
      ],
      series: [
        {
          name: 'Voz activa (%)',
          type: 'line',
          showSymbol: false,
          data: report.timeline.map((t) => Math.round(t.speaking * 100)),
        },
        ...(report.cameraUsed
          ? [
              {
                name: 'Mirada a la comisión (%)',
                type: 'line' as const,
                showSymbol: false,
                data: report.timeline.map((t) => (t.contact === null ? null : Math.round(t.contact * 100))),
              },
            ]
          : []),
        ...(report.transcriptUsed
          ? [
              {
                name: 'Palabras por minuto',
                type: 'line' as const,
                yAxisIndex: 1,
                showSymbol: false,
                data: report.timeline.map((t) => (t.wpm === null ? null : Math.round(t.wpm))),
              },
            ]
          : []),
      ],
    }),
    [report],
  );
  const name = safeFilename(`defensa-${report.title}-${report.createdAt.slice(0, 10)}`);
  const areas = [...new Set(report.findings.map((f) => f.area))];
  return (
    <>
      <PageHead
        eyebrow="INFORME DE TU DEFENSA SIMULADA"
        title={report.title}
        description={`${new Date(report.createdAt).toLocaleString('es-CL')} · ${MODES.find((m) => m.id === report.mode)?.name} · nivel ${report.difficulty}`}
        action={
          <button className="button primary" onClick={onAgain}>
            <RotateCcw size={17} /> Practicar de nuevo
          </button>
        }
      />
      <div className="metric-row">
        {report.mode !== 'preguntas' && (
          <Metric
            label="Exposición"
            value={formatDuration(report.exposition.seconds)}
            unit={` / ${report.targetMinutes}:00`}
          />
        )}
        <Metric
          label="Velocidad"
          value={report.exposition.wpm ? Math.round(report.exposition.wpm) : '—'}
          unit={report.exposition.wpm ? ' ppm' : ''}
          detail={
            previous?.exposition.wpm
              ? `Intento anterior: ${Math.round(previous.exposition.wpm)} ppm`
              : undefined
          }
        />
        <Metric
          label="Muletillas"
          value={report.exposition.fillersPer100 === null ? '—' : report.exposition.fillersPer100.toFixed(1)}
          unit={report.exposition.fillersPer100 === null ? '' : ' /100 pal.'}
        />
        <Metric
          label="Mirada"
          value={contact ? contact.value.split(' ')[0]! : '—'}
          unit={contact ? ' %' : ''}
        />
        <Metric label="Preguntas respondidas" value={report.answers.length} />
        <Metric
          label="Inicio de respuesta"
          value={latency ? latency.value.split(' ')[0]! : '—'}
          unit={latency ? ' s' : ''}
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <span className="eyebrow">PRIORIDADES</span>
          <h2>Lo que más te conviene practicar</h2>
          {top.length ? (
            <ol className="priority-list">
              {top.map((f) => (
                <li key={f.id}>
                  <h3>{f.title}</h3>
                  <p>
                    {f.value}. {f.explanation}
                  </p>
                  <p className="exercise">
                    <strong>Ejercicio:</strong> {f.exercise}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              No hubo aspectos marcados como prioritarios. Prueba un nivel más exigente o sin indicadores.
            </p>
          )}
        </section>
        <section className="panel focus-panel">
          <CheckCircle2 size={24} />
          <h2>Lo que haces bien</h2>
          {good.length ? (
            <ul className="plain-list">
              {good.map((f) => (
                <li key={f.id}>
                  <strong>{f.title}:</strong> {f.value}
                </li>
              ))}
            </ul>
          ) : (
            <p>Todavía no hay fortalezas marcadas. Con más práctica aparecerán aquí.</p>
          )}
        </section>
      </div>
      {mediaUrl && (
        <section className="panel">
          <h2>Mírate y escúchate</h2>
          <p>
            Revisa tu grabación con el informe al lado. Se borra al salir de esta página si no la descargas.
          </p>
          {media?.type.startsWith('video') ? (
            <video className="replay" src={mediaUrl} controls playsInline />
          ) : (
            <audio src={mediaUrl} controls />
          )}
        </section>
      )}
      {report.timeline.length > 1 && (
        <section className="panel">
          <h2>Cómo evolucionaste durante la práctica</h2>
          <p>
            Cada punto resume 30 segundos. Las caídas indican tramos en que hablaste menos o miraste a otro
            lado.
          </p>
          <Chart
            option={option}
            label={`Gráfico por tramos de 30 segundos con voz activa${report.cameraUsed ? ', mirada a la comisión' : ''}${report.transcriptUsed ? ' y palabras por minuto' : ''}.`}
          />
        </section>
      )}
      {areas.map((area) => (
        <section className="panel" key={area}>
          <h2>{AREA_TEXT[area]}</h2>
          <div className="finding-grid">
            {report.findings
              .filter((f) => f.area === area)
              .map((f) => (
                <article className={`finding-card level-${f.level}`} key={f.id}>
                  <div className="section-heading">
                    <h3>{f.title}</h3>
                    <span className={`badge level-badge level-${f.level}`}>{LEVEL_TEXT[f.level]}</span>
                  </div>
                  <strong className="finding-value">{f.value}</strong>
                  <p>{f.explanation}</p>
                  <p className="exercise">
                    <strong>Ejercicio:</strong> {f.exercise}
                  </p>
                  <p className="caption">Cómo se mide: {f.method}</p>
                </article>
              ))}
          </div>
        </section>
      ))}
      {report.content && (
        <section className="panel">
          <span className="eyebrow">CONTENIDO · COMENTARIO DE IA ({report.content.model})</span>
          <h2>Claridad y estructura de lo que dijiste</h2>
          <p>{report.content.resumen}</p>
          <div className="structure-row">
            {Object.entries(report.content.estructura).map(([k, v]) => (
              <span key={k} className={`badge ${v ? 'success' : ''}`}>
                {v ? '✓' : '✗'} {k.replaceAll('_', ' ')}
              </span>
            ))}
          </div>
          <div className="form-grid">
            <div>
              <h3>Fortalezas</h3>
              <ul className="plain-list">
                {report.content.fortalezas.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Mejoras</h3>
              <ul className="plain-list">
                {report.content.mejoras.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="caption">Comentario automático: revísalo con criterio y con tu profesor guía.</p>
        </section>
      )}
      {report.answers.length > 0 && (
        <section className="panel">
          <h2>Preguntas y respuestas</h2>
          {report.answers.map((a, i) => (
            <div className="answer-review" key={i}>
              <span className="eyebrow">
                {COMMITTEE[a.member].name} · {a.kind}
              </span>
              <h3>{a.question}</h3>
              <p className="caption">
                Empezaste a responder{' '}
                {a.latency === null ? 'sin voz detectada' : `a los ${a.latency.toFixed(1)} s`} · duración{' '}
                {formatDuration(a.duration)} · {a.words} palabras · {a.hedges} expresiones de duda ·{' '}
                {a.fillers} muletillas
              </p>
              <p>{a.text || 'Sin transcripción de esta respuesta.'}</p>
              {a.feedback && (
                <p className="exercise">
                  <strong>Comentario:</strong> {a.feedback}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Guardar resultados</h2>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() =>
              downloadBlob(
                new Blob([reportText(report)], { type: 'text/plain;charset=utf-8' }),
                `${name}.txt`,
              )
            }
          >
            <Download size={16} /> Informe (TXT)
          </button>
          <button
            className="button secondary"
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
                `${name}.json`,
              )
            }
          >
            <Download size={16} /> Datos (JSON)
          </button>
          {media && (
            <button
              className="button secondary"
              onClick={() =>
                downloadBlob(
                  media,
                  `${name}.${media.type.includes('mp4') ? 'mp4' : media.type.includes('ogg') ? 'ogg' : 'webm'}`,
                )
              }
            >
              <Download size={16} /> {media.type.startsWith('video') ? 'Video' : 'Audio'}
            </button>
          )}
        </div>
        {report.notes.map((n) => (
          <p className="caption" key={n}>
            {n}
          </p>
        ))}
      </section>
    </>
  );
}

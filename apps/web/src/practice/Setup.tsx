import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  Plus,
  Trash2,
  Shuffle,
  Volume2,
  CheckCircle2,
  CircleAlert,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import {
  DIFFICULTIES,
  SCENARIOS,
  TEMPERAMENTS,
  createParticipants,
  defaultLook,
  type Difficulty,
  type Participant,
  type Temperament,
} from '@oratoria/conversation';
import { managed, managedStatus } from '@oratoria/model-manager';
import { PageHead, Toggle } from '../components';
import { useAi } from '../ai/settings';
import { ollama } from '../ai/llm';
import { basePath } from '../services';
import { browserSttSupported } from '../voice/stt';
import { MaterialPanel } from '../knowledge/MaterialPanel';
import { visionInstalled } from './vision';
import { Avatar } from './Avatar';
import { makeTts, voiceSpec, STT_TEXT, TTS_TEXT } from './engines';
import { PRESETS, applyPreset, usePractice, setupFor, type PracticeSetup } from './store';

type Check = { ok: boolean | null; title: string; text: ReactNode };

export function Setup({
  scenarioId,
  onStart,
}: {
  scenarioId: PracticeSetup['scenario'];
  onStart: () => void;
}) {
  const scenario = SCENARIOS[scenarioId];
  const update = usePractice((s) => s.update),
    reset = usePractice((s) => s.reset);
  const setup = usePractice((s) => s.setups[scenarioId]) ?? setupFor(scenarioId);
  const set = (patch: Partial<PracticeSetup>) => update(scenarioId, patch);
  const ai = useAi();
  const [checks, setChecks] = useState<Check[]>([]);
  const [preset, setPreset] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list: Check[] = [];
      let mic: PermissionState | 'unknown' = 'unknown';
      try {
        mic = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
      } catch {
        mic = 'unknown';
      }
      list.push({
        ok: mic === 'granted' ? true : mic === 'denied' ? false : null,
        title: 'Micrófono',
        text:
          mic === 'denied'
            ? 'El permiso está bloqueado. Habilítalo en la barra de direcciones.'
            : mic === 'granted'
              ? 'Permiso concedido.'
              : 'Se pedirá permiso al entrar.',
      });
      const sttModel = ai.stt.startsWith('whisper') ? managed(ai.stt) : undefined;
      const sttOk =
        ai.stt === 'escrito'
          ? true
          : sttModel
            ? (await managedStatus(sttModel, basePath)).installed
            : ai.stt === 'navegador'
              ? browserSttSupported()
              : null;
      list.push({
        ok: sttOk,
        title: 'Reconocimiento de voz',
        text: `${STT_TEXT[ai.stt]}. ${sttOk === false ? (sttModel ? 'No está instalado.' : 'Este navegador no lo tiene.') : ai.stt === 'navegador' ? 'En Chrome y Edge el audio se procesa en servidores de Google o Microsoft.' : ''}`,
      });
      list.push({
        ok: true,
        title: 'Voz de los interlocutores',
        text: `${TTS_TEXT[ai.tts]}. Usa audífonos para que el micrófono no capte su voz.`,
      });
      if (ai.useLlm && ai.provider === 'ollama' && ai.assign.conversacion) {
        const tags = await ollama()
          .list()
          .then((l) => l.map((m) => m.name))
          .catch(() => null);
        const ok = !!tags?.some(
          (t) => t === ai.assign.conversacion || t === `${ai.assign.conversacion}:latest`,
        );
        list.push({
          ok: tags === null ? false : ok,
          title: 'Interlocutores con IA',
          text:
            tags === null
              ? 'Ollama no responde: se usarán las reglas del motor.'
              : ok
                ? `Modelo ${ai.assign.conversacion} disponible en Ollama.`
                : `El modelo ${ai.assign.conversacion} no está instalado en Ollama.`,
        });
      } else
        list.push({
          ok: ai.useLlm && ai.provider === 'openai' ? !!ai.openai.model : null,
          title: 'Interlocutores',
          text: ai.useLlm
            ? ai.provider === 'openai'
              ? `Servicio compatible: ${ai.openai.model || 'sin modelo'}.`
              : 'Sin modelo asignado: reglas del motor.'
            : 'Reglas del motor (sin modelo de lenguaje). Puedes activar un modelo local en Configuración.',
        });
      if (setup.camera && ai.vision) {
        const v = await visionInstalled();
        list.push({
          ok: v,
          title: 'Cámara',
          text: v
            ? 'Modelos instalados: se medirán mirada, gestos y postura.'
            : 'Modelos sin instalar: te verás, pero no habrá mediciones de cuerpo.',
        });
      }
      if (alive) setChecks(list);
    })();
    return () => {
      alive = false;
    };
  }, [
    ai.stt,
    ai.tts,
    ai.useLlm,
    ai.provider,
    ai.assign.conversacion,
    ai.openai.model,
    ai.vision,
    setup.camera,
  ]);

  const setParticipant = (id: string, patch: Partial<Participant>) =>
    set({ participants: setup.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  async function preview(p: Participant, i: number) {
    const { tts } = await makeTts();
    await tts
      .speak(
        scenario.id === 'tesis'
          ? 'Buenos días. Tengo una pregunta sobre su metodología. ¿Por qué eligió ese enfoque?'
          : 'Hola. Tengo una pregunta para ti. ¿Me puedes dar un ejemplo concreto?',
        voiceSpec(p, i),
      )
      .done.catch(() => undefined);
  }
  const canStart =
    setup.participants.length > 0 && (setup.topic.trim().length >= 3 || setup.docIds.length > 0);
  const difficulty = setup.participants[0]?.difficulty ?? scenario.defaults.difficulty;
  return (
    <>
      <PageHead
        eyebrow={`PRÁCTICAS GUIADAS · ${scenario.name.toUpperCase()}`}
        title={scenario.name}
        description={scenario.description}
        action={
          <div className="segmented" role="group" aria-label="Tipo de configuración">
            <button aria-pressed={!setup.advanced} onClick={() => set({ advanced: false })}>
              Configuración rápida
            </button>
            <button aria-pressed={setup.advanced} onClick={() => set({ advanced: true })}>
              <Settings2 size={15} /> Avanzada
            </button>
          </div>
        }
      />
      <ol className="stepper" aria-label="Pasos">
        <li className="done">1. Práctica</li>
        <li aria-current="step">2. Escenario y participantes</li>
        <li>3. Material</li>
        <li>4. Simulación</li>
        <li>5. Evaluación</li>
      </ol>
      <div className="setup-layout">
        <div>
          <section className="panel">
            <h2>Escenario</h2>
            <label className="field">
              {scenario.topicLabel}
              <input
                value={setup.topic}
                maxLength={200}
                onChange={(e) => set({ topic: e.target.value })}
                placeholder={scenario.topicPlaceholder}
              />
            </label>
            {scenario.fields.slice(0, setup.advanced ? undefined : 1).map((f) => (
              <label className="field" key={f.id}>
                {f.label}
                {f.multiline ? (
                  <textarea
                    rows={3}
                    value={setup.context[f.id] ?? ''}
                    onChange={(e) => set({ context: { ...setup.context, [f.id]: e.target.value } })}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <input
                    value={setup.context[f.id] ?? ''}
                    onChange={(e) => set({ context: { ...setup.context, [f.id]: e.target.value } })}
                    placeholder={f.placeholder}
                  />
                )}
              </label>
            ))}
            <div className="form-grid">
              {scenario.opening.kind !== 'ninguna' && (
                <label className="field">
                  {scenario.opening.label} (minutos)
                  <select
                    value={setup.openingMinutes}
                    onChange={(e) => set({ openingMinutes: Number(e.target.value) })}
                  >
                    <option value={0}>Sin {scenario.opening.label.toLowerCase()}</option>
                    {[1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 45].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Preguntas principales
                <select value={setup.questions} onChange={(e) => set({ questions: Number(e.target.value) })}>
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === scenario.defaults.questions ? '(recomendado)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>{scenario.id === 'tesis' ? 'La comisión' : 'Interlocutores'}</h2>
                <p className="caption">
                  La dificultad define qué tan profundas son las preguntas; el temperamento, cómo se comporta
                  cada persona. Son independientes y no cambian la calificación.
                </p>
              </div>
            </div>
            {!setup.advanced ? (
              <>
                <div
                  className="scenario-grid"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', marginBottom: 12 }}
                >
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`scenario ${preset === p.id ? 'selected' : ''}`}
                      aria-pressed={preset === p.id}
                      onClick={() => {
                        setPreset(p.id);
                        update(scenarioId, applyPreset(setup, p.id));
                      }}
                      style={{ minHeight: 0 }}
                    >
                      <h3>
                        {scenario.id === 'tesis'
                          ? p.name
                          : p.name
                              .replace('Comisión', 'Interlocutores')
                              .replace('Defensa extrema', 'Máxima presión')}
                      </h3>
                      <p>{p.text}</p>
                      <span className="badge">{DIFFICULTIES[p.difficulty].name}</span>
                    </button>
                  ))}
                </div>
                <ul className="summary-list">
                  {setup.participants.map((p) => (
                    <li key={p.id}>
                      <span>
                        {p.name} · {p.role}
                      </span>
                      <span>
                        {TEMPERAMENTS[p.temperament].name} · {DIFFICULTIES[p.difficulty].name}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <div className="form-grid">
                  <label className="field">
                    Dificultad para todos
                    <select
                      value={difficulty}
                      onChange={(e) =>
                        set({
                          participants: setup.participants.map((p) => ({
                            ...p,
                            difficulty: e.target.value as Difficulty,
                          })),
                        })
                      }
                    >
                      {Object.entries(DIFFICULTIES).map(([k, d]) => (
                        <option key={k} value={k}>
                          {d.name}: {d.summary}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="participant-grid">
                  {setup.participants.map((p, i) => (
                    <article className="participant-card" key={p.id}>
                      <header>
                        <div className="portrait-mini">
                          <Avatar
                            look={p.look}
                            temperament={p.temperament}
                            seed={i}
                            label={`Apariencia de ${p.name}`}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <h3>{p.name}</h3>
                          <small>{p.role}</small>
                        </div>
                      </header>
                      <label className="field">
                        Nombre
                        <input
                          value={p.name}
                          maxLength={60}
                          onChange={(e) => setParticipant(p.id, { name: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        Rol
                        <select
                          value={p.roleId}
                          onChange={(e) => {
                            const r = scenario.roles.find((x) => x.id === e.target.value)!;
                            setParticipant(p.id, {
                              roleId: r.id,
                              role: r.role,
                              specialty: r.specialty,
                              areas: [...r.areas],
                              goals: [...r.goals],
                            });
                          }}
                        >
                          {scenario.roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Temperamento
                        <select
                          value={p.temperament}
                          onChange={(e) =>
                            setParticipant(p.id, { temperament: e.target.value as Temperament })
                          }
                        >
                          {Object.entries(TEMPERAMENTS).map(([k, t]) => (
                            <option key={k} value={k}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <small>{TEMPERAMENTS[p.temperament].summary}</small>
                      </label>
                      <label className="field">
                        Dificultad
                        <select
                          value={p.difficulty}
                          onChange={(e) => setParticipant(p.id, { difficulty: e.target.value as Difficulty })}
                        >
                          {Object.entries(DIFFICULTIES).map(([k, d]) => (
                            <option key={k} value={k}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Voz
                        <select
                          value={p.voice.gender}
                          onChange={(e) => {
                            const g = e.target.value as 'f' | 'm';
                            setParticipant(p.id, {
                              voice: { ...p.voice, gender: g, pitch: g === 'f' ? 1.08 : 0.9 },
                              look: { ...defaultLook(i, g), skin: p.look.skin },
                            });
                          }}
                        >
                          <option value="f">Femenina</option>
                          <option value="m">Masculina</option>
                        </select>
                      </label>
                      <div className="row-wrap">
                        <button className="button secondary small" onClick={() => void preview(p, i)}>
                          <Volume2 size={15} /> Escuchar
                        </button>
                        <button
                          className="button quiet small"
                          onClick={() =>
                            setParticipant(p.id, {
                              look: {
                                ...defaultLook(i + Math.floor(Math.random() * 9) + 1, p.voice.gender),
                                skin: Math.floor(Math.random() * 6),
                              },
                            })
                          }
                        >
                          <Shuffle size={15} /> Apariencia
                        </button>
                        {setup.participants.length > 1 && (
                          <button
                            className="icon-button"
                            aria-label={`Quitar a ${p.name}`}
                            onClick={() =>
                              set({ participants: setup.participants.filter((x) => x.id !== p.id) })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {setup.participants.length < scenario.maxParticipants && (
                  <div className="actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        const free =
                          scenario.roles.find((r) => !setup.participants.some((p) => p.roleId === r.id)) ??
                          scenario.roles[0]!;
                        const [np] = createParticipants([free], difficulty, {
                          academic: scenario.id === 'tesis',
                          seed: Date.now() % 997,
                        });
                        set({
                          participants: [
                            ...setup.participants,
                            {
                              ...np!,
                              id: `p${Date.now() % 100000}`,
                              look: defaultLook(setup.participants.length, np!.voice.gender),
                            },
                          ],
                        });
                      }}
                    >
                      <Plus size={16} /> Agregar participante
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h2>Material</h2>
            <p className="caption">
              Opcional, pero recomendado: las preguntas se basan en tu material y citan la página, diapositiva
              o sección.
            </p>
            <MaterialPanel
              selected={setup.docIds}
              onChange={(ids) => set({ docIds: ids })}
              hint={scenario.materialHint}
              compact={!setup.advanced}
            />
          </section>

          {setup.advanced && (
            <>
              <section className="panel">
                <h2>Desarrollo de la sesión</h2>
                <div className="toggle-grid">
                  <Toggle
                    checked={setup.progressive}
                    onChange={(v) => set({ progressive: v })}
                    title="Exigencia progresiva"
                  >
                    De preguntas introductorias a objeciones y síntesis; avanza más rápido si respondes bien.
                  </Toggle>
                  <Toggle
                    checked={setup.followUps}
                    onChange={(v) => set({ followUps: v })}
                    title="Repreguntas"
                  >
                    Si una respuesta queda débil, la misma persona insiste.
                  </Toggle>
                  <Toggle
                    checked={setup.interruptions}
                    onChange={(v) => set({ interruptions: v })}
                    title="Interrupciones"
                  >
                    Pueden interrumpirte si te extiendes, te desvías o algo no queda claro.
                  </Toggle>
                  <Toggle checked={setup.camera} onChange={(v) => set({ camera: v })} title="Cámara">
                    Mide mirada, gestos y postura en tu equipo. Opcional.
                  </Toggle>
                  <Toggle checked={setup.record} onChange={(v) => set({ record: v })} title="Grabación">
                    Graba la sesión para revisarla. Queda en tu equipo.
                  </Toggle>
                  <Toggle
                    checked={setup.indicators}
                    onChange={(v) => set({ indicators: v })}
                    title="Indicadores en vivo"
                  >
                    Desactívalos para un ensayo realista sin ayudas.
                  </Toggle>
                  <Toggle
                    checked={setup.captions}
                    onChange={(v) => set({ captions: v })}
                    title="Subtítulos de los interlocutores"
                  >
                    Muestra el texto de lo que dicen.
                  </Toggle>
                  <Toggle
                    checked={setup.headphones}
                    onChange={(v) => set({ headphones: v })}
                    title="Uso audífonos"
                  >
                    Permite interrumpir a un interlocutor hablando sin que el micrófono capte su voz.
                  </Toggle>
                </div>
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <label className="field">
                    Terminar mi turno tras un silencio de
                    <select value={setup.autoEnd} onChange={(e) => set({ autoEnd: Number(e.target.value) })}>
                      <option value={0}>Nunca (uso el botón)</option>
                      {[3, 4, 6, 8, 10].map((n) => (
                        <option key={n} value={n}>
                          {n} segundos
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Público
                    <select
                      value={setup.audience}
                      onChange={(e) => set({ audience: Number(e.target.value) as PracticeSetup['audience'] })}
                    >
                      <option value={0}>Sin público</option>
                      <option value={6}>6 personas</option>
                      <option value={12}>12 personas</option>
                    </select>
                  </label>
                </div>
              </section>
              <section className="panel">
                <h2>Criterios de evaluación</h2>
                <p className="caption">
                  Partes de los criterios recomendados para esta práctica. Desactiva los que no quieras
                  observar y ajusta su peso si te interesa más un aspecto.
                </p>
                <label className="field">
                  Mi objetivo de aprendizaje (opcional)
                  <input
                    value={setup.goal}
                    maxLength={200}
                    onChange={(e) => set({ goal: e.target.value })}
                    placeholder="Por ejemplo: responder objeciones metodológicas con evidencia"
                  />
                </label>
                <div className="criteria-list">
                  {scenario.criteria.map((c) => {
                    const cfg = setup.criteria[c.id] ?? { on: true, weight: c.weight };
                    return (
                      <div className="criterion-row" key={c.id}>
                        <input
                          type="checkbox"
                          checked={cfg.on}
                          aria-label={`Evaluar ${c.name}`}
                          onChange={(e) =>
                            set({ criteria: { ...setup.criteria, [c.id]: { ...cfg, on: e.target.checked } } })
                          }
                        />
                        <span>
                          <strong>{c.name}</strong> <small>· {c.indicator}</small>
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={cfg.weight}
                          aria-label={`Peso de ${c.name}`}
                          onChange={(e) =>
                            set({
                              criteria: {
                                ...setup.criteria,
                                [c.id]: {
                                  ...cfg,
                                  weight: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                                },
                              },
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
        <aside className="setup-aside">
          <section className="panel">
            <h2>Antes de empezar</h2>
            <ul className="checklist">
              {checks.map((c) => (
                <li className={`check ${c.ok ? 'ok' : c.ok === false ? 'warn' : ''}`} key={c.title}>
                  {c.ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                  <div>
                    <strong>{c.title}</strong>
                    <p>{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="caption">
              Puedes cambiar la voz, el reconocimiento y los modelos en{' '}
              <Link className="text-link" to="/settings/models">
                Configuración → Modelos de IA
              </Link>
              .
            </p>
            <button
              className="button primary"
              style={{ width: '100%', marginTop: 12 }}
              disabled={!canStart}
              onClick={onStart}
            >
              <Play size={17} /> Entrar a la simulación
            </button>
            {!canStart && <p className="caption">Escribe el tema o selecciona material para comenzar.</p>}
            <div className="actions">
              <button className="button quiet small" onClick={() => reset(scenarioId)}>
                <RotateCcw size={14} /> Restablecer esta práctica
              </button>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

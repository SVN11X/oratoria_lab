import { useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ArrowRight, Save, RotateCcw } from 'lucide-react';
import { INITIAL_PRACTICE, practiceReducer, SCENARIOS } from '@oratoria/simulation';
import { newSession, errorMessage } from '@oratoria/core';
import { store } from '@oratoria/storage';
import { PageHead, Alert } from '../components';
import { useSessions } from '../state';
export function Practice() {
  const [state, dispatch] = useReducer(practiceReducer, INITIAL_PRACTICE),
    [scenarioId, setScenarioId] = useState('tesis');
  const [topic, setTopic] = useState(''),
    [context, setContext] = useState(''),
    [goal, setGoal] = useState(''),
    [interlocutor, setInterlocutor] = useState('Comité académico');
  const [difficulty, setDifficulty] = useState<'inicial' | 'profundizacion'>('inicial'),
    [count, setCount] = useState(3),
    [duration, setDuration] = useState(5),
    [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate(),
    reload = useSessions((s) => s.reload);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const scenario = SCENARIOS.find((s) => s.id === state.scenarioId)!;
      const session = newSession({
        title: `${scenario.name}${topic ? ': ' + topic : ''}`.slice(0, 120),
        source: 'guided',
        scenarioId: scenario.id,
        goal: `Objetivo: ${goal || 'Practicar respuestas'}; tema: ${topic}; contexto: ${context}; interlocutor: ${interlocutor}; nivel: ${difficulty}; duración objetivo: ${duration} min.`.slice(
          0,
          500,
        ),
        transcript: {
          source: 'manual',
          language: 'es',
          model: null,
          revision: 1,
          updatedAt: new Date().toISOString(),
          segments: state.answers.map((text, i) => ({
            id: crypto.randomUUID(),
            text,
            prompt: state.questions[i],
            start: null,
            end: null,
          })),
        },
      });
      await store.save(session);
      await reload();
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="PRÁCTICAS GUIADAS"
        title="Prepárate para tu próxima conversación."
        description="Preguntas predefinidas, sin IA conversacional. Tus respuestas se guardan como una práctica escrita."
      />
      {error && <Alert>{error}</Alert>}
      {state.status === 'setup' ? (
        <>
          <div className="scenario-grid">
            {SCENARIOS.map((s) => (
              <button
                className={`scenario ${scenarioId === s.id ? 'selected' : ''}`}
                aria-pressed={scenarioId === s.id}
                onClick={() => setScenarioId(s.id)}
                key={s.id}
              >
                <BookOpen size={23} />
                <h2>{s.name}</h2>
                <p>{s.description}</p>
                <span>
                  {scenarioId === s.id ? 'Seleccionado' : 'Elegir escenario'} <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>
          <section className="panel">
            <h2>Prepara el contexto</h2>
            <div className="form-grid">
              <label className="field">
                Tema
                <input
                  value={topic}
                  maxLength={80}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Por ejemplo: navegación de un robot móvil"
                />
              </label>
              <label className="field">
                Objetivo
                <input
                  value={goal}
                  maxLength={100}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Explicar resultados con evidencia"
                />
              </label>
              <label className="field">
                Contexto
                <textarea
                  value={context}
                  maxLength={120}
                  rows={2}
                  onChange={(e) => setContext(e.target.value)}
                />
              </label>
              <label className="field">
                Interlocutor de referencia
                <input
                  value={interlocutor}
                  maxLength={40}
                  onChange={(e) => setInterlocutor(e.target.value)}
                />
              </label>
              <label className="field">
                Nivel
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                >
                  <option value="inicial">Inicial: propósito y contexto primero</option>
                  <option value="profundizacion">Profundización: evidencias y límites primero</option>
                </select>
              </label>
              <label className="field">
                Cantidad de preguntas
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Duración objetivo (minutos)
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={duration}
                  onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value))))}
                />
              </label>
            </div>
            <p className="caption">
              El contexto orienta tus respuestas; no genera ni adapta las preguntas. El nivel cambia el orden
              de un banco de seis preguntas. La duración es una meta, no una medición del habla.
            </p>
            <button
              className="button primary"
              onClick={() => dispatch({ type: 'start', scenarioId, count, difficulty })}
            >
              Comenzar práctica <ArrowRight size={16} />
            </button>
          </section>
        </>
      ) : state.status === 'answering' ? (
        <section className="panel conversation">
          <span className="badge">
            Preguntas fijas · {state.index + 1} de {state.questions.length}
          </span>
          <div className="question">
            <BookOpen size={30} />
            <h2>{state.questions[state.index]}</h2>
          </div>
          {topic && (
            <p className="caption">
              Tema: {topic} · {interlocutor}
            </p>
          )}
          <label className="field">
            Tu respuesta
            <textarea
              autoFocus
              rows={8}
              value={answer}
              maxLength={50000}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Escribe lo que dirías. Puedes ensayarlo en voz alta antes."
            />
          </label>
          <div className="actions">
            <button
              className="button primary"
              disabled={!answer.trim()}
              onClick={() => {
                dispatch({ type: 'answer', text: answer });
                setAnswer('');
              }}
            >
              {state.index + 1 === state.questions.length
                ? 'Terminar práctica'
                : 'Guardar respuesta y continuar'}
              <ArrowRight size={17} />
            </button>
            <button
              className="button quiet"
              onClick={() => {
                if (window.confirm('¿Descartar las respuestas de esta práctica y comenzar de nuevo?'))
                  dispatch({ type: 'reset' });
              }}
            >
              Volver a empezar
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <span className="eyebrow">PRÁCTICA COMPLETADA</span>
          <h2>Ya tienes material para revisar.</h2>
          <p>
            Guarda tus respuestas para contar términos o valorarlas con una rúbrica. No se generó una
            evaluación mediante IA.
          </p>
          {state.answers.map((text, i) => (
            <div className="answer-review" key={i}>
              <h3>{state.questions[i]}</h3>
              <p>{text}</p>
            </div>
          ))}
          <div className="actions">
            <button className="button primary" onClick={save} disabled={busy}>
              <Save size={17} /> Guardar práctica escrita
            </button>
            <button className="button secondary" onClick={() => dispatch({ type: 'reset' })} disabled={busy}>
              <RotateCcw size={17} /> Otra práctica
            </button>
          </div>
        </section>
      )}
    </>
  );
}

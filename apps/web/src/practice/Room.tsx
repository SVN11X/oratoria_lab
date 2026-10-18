import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Captions,
  Eye,
  EyeOff,
  Mic,
  Pause,
  Play,
  Repeat,
  Sparkles,
  Square,
  Timer,
  Volume2,
  BookOpen,
  Hand,
} from 'lucide-react';
import {
  ConversationEngine,
  SCENARIOS,
  STAGE_TEXT,
  TEMPERAMENTS,
  coachPlan,
  evaluateSession,
  type Move,
  type RetrievedChunk,
  type ScenarioId,
} from '@oratoria/conversation';
import {
  buildReport,
  countTerms,
  nextAttention,
  wordCount,
  type AnswerRecord,
  type MemberId,
  type Phase,
  type SpeechChunk,
} from '@oratoria/defense';
import { errorMessage, formatDuration } from '@oratoria/core';
import { Alert, Confirm } from '../components';
import { usePreferences } from '../state';
import { llmFor } from '../ai/llm';
import { useAi } from '../ai/settings';
import { makeRetriever, listDocuments } from '../knowledge/library';
import { MediaSensors, type LiveStats } from './sensors';
import { createVision, visionInstalled } from './vision';
import { Avatar, AudienceMember, type AvatarHandle } from './Avatar';
import { makeStt, makeTts, STT_TEXT, TTS_TEXT, voiceSpec } from './engines';
import { toConfig, type PracticeSetup } from './store';
import type { PracticeRecord } from './records';
import type { Stt } from '../voice/stt';
import type { SpeakHandle, Tts } from '../voice/tts';

type Stage = 'preparando' | 'agente' | 'exposicion' | 'respuesta' | 'pensando' | 'cierre';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KIND_TEXT: Record<Move['kind'], string> = {
  saludo: 'saluda',
  pregunta: 'pregunta',
  repregunta: 'repregunta',
  interrupcion: 'interrumpe',
  reaccion: 'reacciona',
  reformulacion: 'reformula',
  aviso: 'indica',
  cierre: 'cierra',
};

export function Room({
  setup,
  onCancel,
  onFinish,
}: {
  setup: PracticeSetup;
  onCancel: () => void;
  onFinish: (record: PracticeRecord, media: Blob | null) => void;
}) {
  const scenario = SCENARIOS[setup.scenario as ScenarioId];
  const config = useMemo(() => toConfig(setup), [setup]);
  const threshold = usePreferences((s) => s.threshold),
    fillers = usePreferences((s) => s.fillers),
    micId = usePreferences((s) => s.micId),
    cameraId = usePreferences((s) => s.cameraId);
  const ai = useAi();
  const [stage, setStage] = useState<Stage>('preparando'),
    [paused, setPaused] = useState(false),
    [fatal, setFatal] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]),
    [status, setStatus] = useState('Preparando micrófono, voces y material…'),
    [band, setBand] = useState<Move | null>(null),
    [speaking, setSpeaking] = useState<string | null>(null),
    [live, setLive] = useState<LiveStats | null>(null),
    [interim, setInterim] = useState(''),
    [lastFinal, setLastFinal] = useState(''),
    [typed, setTyped] = useState(''),
    [expSeconds, setExpSeconds] = useState(0),
    [card, setCard] = useState(''),
    [attention, setAttention] = useState(70),
    [confirmCancel, setConfirmCancel] = useState(false),
    [showText, setShowText] = useState(setup.captions),
    [showSources, setShowSources] = useState(false),
    [transcribing, setTranscribing] = useState(false),
    [progress, setProgress] = useState({ asked: 0, total: config.questions }),
    [engines, setEngines] = useState({ stt: '', tts: '', llm: '' }),
    [stats, setStats] = useState({ wpm: null as number | null, fillers: 0 });
  const engine = useRef<ConversationEngine | null>(null),
    sensors = useRef<MediaSensors | null>(null),
    stt = useRef<Stt | null>(null),
    tts = useRef<Tts | null>(null),
    speech = useRef<SpeakHandle | null>(null),
    avatars = useRef(new Map<string, AvatarHandle>()),
    chunks = useRef<SpeechChunk[]>([]),
    answers = useRef<AnswerRecord[]>([]),
    asking = useRef<{ move: Move; askedAt: number; chunkStart: number } | null>(null),
    plan = useRef<number[]>([]),
    cards = useRef(new Set<string>()),
    stageRef = useRef<Stage>('preparando'),
    userPhase = useRef<Phase>('exposicion'),
    busy = useRef(false),
    alive = useRef(true),
    typedRef = useRef(''),
    liveRef = useRef<LiveStats | null>(null),
    interimRef = useRef(''),
    attentionRef = useRef(70),
    controller = useRef(new AbortController()),
    videoRef = useRef<HTMLVideoElement | null>(null),
    created = useRef(new Date().toISOString()),
    retrieverChunks = useRef<RetrievedChunk[]>([]),
    warningsRef = useRef<string[]>([]),
    enginesRef = useRef({ stt: '', tts: '', llm: '' }),
    docNames = useRef<string[]>([]),
    finished = useRef(false);
  const target = config.openingMinutes * 60;
  const hasOpening = target > 0 && scenario.opening.kind !== 'ninguna';
  const go = (s: Stage) => {
    stageRef.current = s;
    if (alive.current) setStage(s);
  };
  const warn = (m: string) => {
    if (!m || warningsRef.current.includes(m)) return;
    warningsRef.current = [...warningsRef.current, m];
    if (alive.current) setWarnings(warningsRef.current);
  };
  const indexOf = (id: string) => config.participants.findIndex((p) => p.id === id);

  function setModes(speakerId: string | null, mode: 'speaking' | 'thinking' | 'listening' = 'speaking') {
    const si = speakerId ? indexOf(speakerId) : -1;
    config.participants.forEach((p, i) => {
      const a = avatars.current.get(p.id);
      if (!a) return;
      if (p.id === speakerId) a.setMode(mode, 0);
      else a.setMode(mode === 'thinking' ? 'thinking' : 'listening', si >= 0 ? Math.sign(si - i) : 0);
    });
  }
  /** Una intervención: se muestra, se dice en voz alta y se anima a quien habla. */
  async function speakMove(m: Move, allowBargeIn: boolean) {
    if (!alive.current || !tts.current) return;
    const p = engine.current!.participant(m.speakerId);
    setBand(m);
    setSpeaking(m.speakerId);
    setModes(m.speakerId);
    if (m.answerType) avatars.current.get(m.speakerId)?.react(m.answerType);
    stt.current?.setListening(false, sensors.current?.now() ?? 0);
    sensors.current?.setPhase('pregunta');
    go('agente');
    const handle = tts.current.speak(m.text, voiceSpec(p, indexOf(p.id)), {
      onMouth: (mouth) => avatars.current.get(m.speakerId)?.setMouth(mouth),
    });
    speech.current = handle;
    let barge: ReturnType<typeof setInterval> | undefined;
    if (allowBargeIn && setup.headphones) {
      let voiced = 0;
      barge = setInterval(() => {
        voiced = liveRef.current?.speaking ? voiced + 1 : 0;
        if (voiced >= 4) {
          handle.cancel();
          warn('Interrumpiste a un interlocutor: la práctica continúa con tu respuesta.');
        }
      }, 150);
    }
    try {
      await handle.done;
    } catch (e) {
      warn(`La voz falló (${errorMessage(e)}). El texto sigue en pantalla.`);
      await sleep(1500);
    } finally {
      clearInterval(barge);
      speech.current = null;
      avatars.current.get(m.speakerId)?.setMouth({ open: 0, wide: 0.5, round: 0 });
    }
    if (alive.current) {
      setSpeaking(null);
      setModes(null, 'listening');
    }
  }
  function listen(phase: Phase) {
    userPhase.current = phase;
    sensors.current?.setPhase(phase);
    stt.current?.setListening(true, sensors.current?.now() ?? 0);
  }
  /** Dice las intervenciones y decide qué sigue según el estado del motor. */
  async function present(moves: Move[]) {
    const e = engine.current!;
    for (let i = 0; i < moves.length && alive.current; i++) {
      const m = moves[i]!;
      const lastAsk =
        i === moves.length - 1 &&
        ['pregunta', 'repregunta', 'interrupcion', 'reformulacion'].includes(m.kind);
      await speakMove(m, lastAsk);
      if (moves.length > 1 && i < moves.length - 1) await sleep(250);
    }
    if (!alive.current) return;
    setProgress({ asked: e.moves.filter((m) => m.kind === 'pregunta').length, total: config.questions });
    if (e.status === 'finished') return finish();
    const turn = e.currentTurn;
    if (turn && !turn.answer) {
      asking.current = {
        move: turn.question,
        askedAt: sensors.current!.now(),
        chunkStart: chunks.current.length,
      };
      setTyped('');
      typedRef.current = '';
      setLastFinal('');
      listen('respuesta');
      go('respuesta');
      return;
    }
    if (e.status === 'exposition') {
      setBand(null);
      listen('exposicion');
      go('exposicion');
    }
  }
  async function finishAnswer() {
    const a = asking.current,
      e = engine.current,
      s = sensors.current;
    if (!a || !e || !s || busy.current) return;
    busy.current = true;
    asking.current = null;
    go('pensando');
    setModes(a.move.speakerId, 'thinking');
    setStatus(`${e.participant(a.move.speakerId).name} considera tu respuesta…`);
    stt.current?.setListening(false, s.now());
    try {
      if (stt.current) {
        setTranscribing(!stt.current.live);
        await stt.current.flush();
      }
      setTranscribing(false);
      const text = [
        ...chunks.current
          .slice(a.chunkStart)
          .filter((c) => c.phase === 'respuesta')
          .map((c) => c.text),
        typedRef.current.trim(),
      ]
        .filter(Boolean)
        .join(' ');
      const startedAt = s.firstVoiceAfter(a.askedAt);
      const endedAt = s.now();
      answers.current.push({
        member: Math.min(2, Math.max(0, indexOf(a.move.speakerId))) as MemberId,
        kind:
          a.move.kind === 'interrupcion'
            ? 'interrupcion'
            : a.move.kind === 'repregunta' || a.move.kind === 'reformulacion'
              ? 'repregunta'
              : 'pregunta',
        question: a.move.text,
        source: a.move.generator,
        askedAt: a.askedAt,
        startedAt,
        endedAt,
        text,
        feedback: null,
      });
      const moves = await e.answer({
        text,
        durationSec: Math.max(0, endedAt - a.askedAt),
        latencySec: startedAt === null ? null : Math.max(0, startedAt - a.askedAt),
      });
      for (const n of e.notes) warn(n);
      busy.current = false;
      await present(moves);
    } catch (err) {
      busy.current = false;
      if (alive.current) warn(`No se pudo continuar la conversación: ${errorMessage(err)}`);
    }
  }
  async function interrupt() {
    const e = engine.current,
      s = sensors.current;
    if (!e || !s || busy.current) return;
    busy.current = true;
    const recent = chunks.current
      .filter((c) => c.phase === 'exposicion' && c.t >= s.now() - 90)
      .map((c) => c.text)
      .join(' ');
    const holder = config.participants.reduce((a, b) =>
      TEMPERAMENTS[b.temperament].interrupts > TEMPERAMENTS[a.temperament].interrupts ? b : a,
    );
    avatars.current.get(holder.id)?.raiseHand(true);
    try {
      const m = await e.interruptExposition(recent || config.topic);
      avatars.current.get(holder.id)?.raiseHand(false);
      busy.current = false;
      if (m && stageRef.current === 'exposicion' && alive.current) await present([m]);
    } catch {
      busy.current = false;
      avatars.current.get(holder.id)?.raiseHand(false);
    }
  }
  async function endExposition() {
    const e = engine.current;
    if (!e || stageRef.current !== 'exposicion' || busy.current) return;
    plan.current = [];
    busy.current = true;
    go('pensando');
    setStatus('La comisión prepara sus preguntas…');
    stt.current?.setListening(false, sensors.current?.now() ?? 0);
    try {
      if (stt.current && !stt.current.live) {
        setTranscribing(true);
        await stt.current.flush();
        setTranscribing(false);
      }
      const moves = await e.endExposition();
      busy.current = false;
      await present(moves);
    } catch (err) {
      busy.current = false;
      setFatal(errorMessage(err));
    }
  }
  async function finish() {
    if (finished.current) return;
    finished.current = true;
    const e = engine.current,
      s = sensors.current;
    if (!e || !s) return;
    go('cierre');
    setStatus('Preparando tu informe…');
    if (e.status !== 'finished') {
      const close = e.finish();
      for (const m of close) await speakMove(m, false);
    }
    stt.current?.stop();
    speech.current?.cancel();
    const media = await s.stop();
    const snapshot = e.snapshot();
    const report = buildReport({
      id: crypto.randomUUID(),
      createdAt: created.current,
      title: config.topic || scenario.name,
      difficulty: 'estandar',
      mode: hasOpening ? 'completa' : 'preguntas',
      targetMinutes: Math.max(1, config.openingMinutes || 1),
      ticks: s.ticks,
      chunks: chunks.current,
      answers: answers.current,
      transcriptUsed: chunks.current.length > 0,
      fillers,
    });
    const active = scenario.criteria
      .filter((c) => setup.criteria[c.id]?.on !== false)
      .map((c) => ({ ...c, weight: setup.criteria[c.id]?.weight ?? c.weight }));
    setStatus(
      llmFor('evaluacion')
        ? 'El evaluador revisa tus respuestas y busca evidencias…'
        : 'Calculando criterios y evidencias…',
    );
    const evaluation = await evaluateSession({
      snapshot,
      findings: report.findings,
      llm: llmFor('evaluacion'),
      criteria: active,
      chunks: retrieverChunks.current,
    }).catch((err) => {
      warn(`No se pudo completar la evaluación: ${errorMessage(err)}`);
      return null;
    });
    if (!evaluation || !alive.current) return;
    const order = ['basica', 'intermedia', 'avanzada', 'experta', 'extrema'] as const;
    const record: PracticeRecord = {
      id: report.id,
      scenario: setup.scenario,
      createdAt: created.current,
      title: config.topic || scenario.name,
      difficulty: order[Math.max(...config.participants.map((p) => order.indexOf(p.difficulty)))]!,
      durationSec: Math.round(s.now()),
      snapshot,
      report,
      evaluation: {
        ...evaluation,
        notes: [...new Set([...evaluation.notes, ...e.notes, ...warningsRef.current])],
      },
      exercises: coachPlan(evaluation.criteria),
      engines: {
        llm: snapshot.llmModel,
        evaluator: evaluation.evaluatorModel,
        stt: enginesRef.current.stt,
        tts: enginesRef.current.tts,
        vision: report.cameraUsed,
      },
      docNames: docNames.current,
      media: media ? { type: media.type, bytes: media.size } : null,
      goal: setup.goal,
    };
    onFinish(record, media);
  }
  function togglePause() {
    const s = sensors.current;
    if (!s) return;
    if (!paused) {
      s.pause();
      stt.current?.setListening(false, s.now());
      setPaused(true);
    } else {
      listen(userPhase.current);
      setPaused(false);
    }
  }

  // Preparación: sensores, voz, reconocimiento, material y motor.
  useEffect(() => {
    alive.current = true;
    const signal = controller.current;
    (async () => {
      try {
        const [{ tts: t, warning: tw }, retriever, docs] = await Promise.all([
          makeTts(),
          makeRetriever(setup.docIds),
          listDocuments(),
        ]);
        tts.current = t;
        warn(tw);
        docNames.current = docs.filter((d) => setup.docIds.includes(d.id)).map((d) => d.name);
        if (setup.docIds.length && !retriever)
          warn('El material seleccionado no tiene texto extraíble; las preguntas no podrán citarlo.');
        if (retriever)
          retrieverChunks.current = await retriever.retrieve(
            `${config.topic} objetivo metodología resultados conclusiones`,
            6,
          );
        const clock = () => sensors.current?.now() ?? 0;
        const { stt: recognizer, warning: sw } = await makeStt(
          {
            onFinal: (text, at) => {
              const phase = userPhase.current;
              chunks.current.push({ text, t: at, phase });
              if (phase === 'exposicion') engine.current?.addExposition(text, at);
              if (alive.current) setLastFinal(text);
            },
            onInterim: (text) => {
              interimRef.current = text;
              if (alive.current) setInterim(text);
            },
            onError: (m) => warn(m),
            onBusy: (b) => alive.current && setTranscribing(b),
          },
          clock,
        );
        warn(sw);
        stt.current = recognizer;
        const local = recognizer && !recognizer.live;
        const { engine: s, warning } = await MediaSensors.open({
          camera: setup.camera,
          record: setup.record,
          threshold,
          deviceId: micId || undefined,
          cameraId: cameraId || undefined,
          onLive: (st) => {
            liveRef.current = st;
            if (alive.current) setLive(st);
          },
          onPcm: local ? (frame, rate, t) => recognizer.feed?.(frame, rate, t) : undefined,
        });
        if (!alive.current) {
          await s.stop();
          return;
        }
        sensors.current = s;
        warn(warning);
        s.attachVideo(videoRef.current);
        if (s.hasCamera && useAi.getState().vision) {
          if (await visionInstalled())
            void s.enableVision(createVision).then(() => {
              if (s.vision === 'error') warn(`Análisis de cámara desactivado: ${s.visionError}`);
            });
          else
            warn(
              'Los modelos de cámara no están instalados: te verás en pantalla, pero no se medirán mirada, gestos ni postura.',
            );
        }
        recognizer?.start();
        const llm = llmFor('conversacion');
        enginesRef.current = {
          stt: recognizer ? recognizer.id : 'escrito',
          tts: t.id,
          llm: llm?.model ?? '',
        };
        setEngines(enginesRef.current);
        const e = new ConversationEngine(config, {
          llm,
          retrieve: retriever?.retrieve ?? null,
          signal: signal.signal,
        });
        engine.current = e;
        const first = await e.start();
        if (hasOpening) {
          const count =
            !config.interruptions || target < 150 || scenario.opening.kind !== 'exposicion'
              ? 0
              : config.participants.some((p) => TEMPERAMENTS[p.temperament].interrupts >= 0.6)
                ? 2
                : 1;
          const marks = count === 2 ? [0.33, 0.66] : count === 1 ? [0.45] : [];
          plan.current = marks.map((m) => Math.round(target * (m + (Math.random() - 0.5) * 0.12)));
        }
        await present(first);
      } catch (err) {
        if (alive.current && !signal.signal.aborted) setFatal(errorMessage(err));
      }
    })();
    return () => {
      alive.current = false;
      signal.abort();
      stt.current?.stop();
      speech.current?.cancel();
      void sensors.current?.stop();
    };
    // La configuración queda fija al entrar a la sala.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (sensors.current && videoRef.current) sensors.current.attachVideo(videoRef.current);
  });
  // Reloj de la sala: tiempos, interrupciones, fin de turno por silencio y público.
  useEffect(() => {
    const timer = setInterval(() => {
      const s = sensors.current,
        e = engine.current,
        l = liveRef.current,
        st = stageRef.current;
      if (!s || !e || paused) return;
      const now = s.now(),
        exp = s.phaseSeconds('exposicion');
      setExpSeconds(exp);
      const recent = chunks.current.filter((c) => c.t >= now - 30 && c.phase === userPhase.current);
      const span = Math.min(30, Math.max(5, now - (asking.current?.askedAt ?? 0)));
      const wpm = recent.length ? (recent.reduce((n, c) => n + wordCount(c.text), 0) * 60) / span : null;
      const expFillers = countTerms(
        chunks.current.filter((c) => c.phase === 'exposicion').map((c) => c.text),
        fillers,
      ).total;
      setStats({ wpm, fillers: expFillers });
      const userTurn = st === 'exposicion' || st === 'respuesta';
      attentionRef.current = nextAttention(attentionRef.current, {
        speaking: l?.speaking ? 1 : 0,
        silenceSeconds: userTurn ? (l?.silence ?? 0) : 0,
        contact: userTurn ? (l?.contact ?? null) : null,
        fillersRecent: countTerms(
          chunks.current.filter((c) => c.t >= now - 10).map((c) => c.text),
          fillers,
        ).total,
        wpm: userTurn ? wpm : null,
      });
      setAttention(Math.round(attentionRef.current));
      if (st === 'exposicion' && !busy.current) {
        const remaining = target - exp;
        const show = (id: '5' | '2' | '0' | 'x', text: string, voice: boolean) => {
          if (cards.current.has(id)) return;
          cards.current.add(id);
          setCard(text);
          setTimeout(() => alive.current && setCard((c) => (c === text ? '' : c)), 8000);
          if (voice) {
            busy.current = true;
            void speakMove(e.timeNotice(id), false).then(() => {
              busy.current = false;
              if (stageRef.current === 'agente') {
                listen('exposicion');
                go('exposicion');
              }
            });
          }
        };
        if (target >= 600 && remaining <= 300 && remaining > 120) show('5', 'Quedan 5 minutos', false);
        if (target >= 240 && remaining <= 120 && remaining > 0) show('2', 'Quedan 2 minutos', false);
        if (remaining <= 0) show('0', 'Tiempo cumplido', true);
        if (remaining <= -Math.max(60, target * 0.15)) show('x', 'Se excedió del tiempo', true);
        const next = plan.current[0];
        if (next !== undefined && exp >= next && ((l?.silence ?? 0) >= 0.6 || exp - next > 15)) {
          plan.current.shift();
          void interrupt();
        }
      }
      if (st === 'respuesta' && asking.current && l) {
        const elapsed = now - asking.current.askedAt;
        const liveText = [
          ...chunks.current.slice(asking.current.chunkStart).map((c) => c.text),
          interimRef.current,
        ].join(' ');
        const cut = e.shouldInterruptAnswer(elapsed, liveText);
        if (cut && !busy.current) {
          busy.current = true;
          void speakMove(cut, false).then(() => {
            busy.current = false;
            if (alive.current && asking.current) {
              listen('respuesta');
              go('respuesta');
            }
          });
          return;
        }
        const spoke = s.voicedSince(asking.current.askedAt);
        // Con respuestas escritas no se avanza por silencio: la persona puede estar escribiendo.
        if (
          stt.current &&
          setup.autoEnd > 0 &&
          spoke >= 2.5 &&
          l.silence >= setup.autoEnd &&
          !typedRef.current.trim() &&
          !busy.current
        )
          void finishAnswer();
      }
    }, 1000);
    return () => clearInterval(timer);
    // Lee el estado vivo desde referencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const remaining = target - expSeconds;
  const userTurn = stage === 'exposicion' || stage === 'respuesta';
  const current = asking.current?.move ?? band;
  const speaker = band ? config.participants.find((p) => p.id === band.speakerId) : null;
  if (fatal)
    return (
      <section className="panel">
        <h1>No se pudo abrir la sala.</h1>
        <Alert>{fatal}</Alert>
        <button className="button primary" onClick={onCancel}>
          Volver a la configuración
        </button>
      </section>
    );
  return (
    <div className="room">
      <section className="room-stage" aria-label={`Sala de ${scenario.name}`}>
        <div className="room-top">
          <span className={`stage-badge ${userTurn && !paused ? 'live' : ''}`}>
            {paused
              ? 'En pausa'
              : stage === 'exposicion'
                ? `Tu turno · ${scenario.opening.label}`
                : stage === 'respuesta'
                  ? 'Tu respuesta'
                  : stage === 'agente'
                    ? `Habla ${speaker?.name ?? 'un interlocutor'}`
                    : stage === 'pensando'
                      ? 'Pensando…'
                      : stage === 'cierre'
                        ? 'Cierre'
                        : 'Preparando'}
          </span>
          {hasOpening && (stage === 'exposicion' || expSeconds > 0) && (
            <span className={`stage-clock ${remaining < 0 ? 'over' : remaining <= 120 ? 'warn' : ''}`}>
              <Timer size={15} /> {formatDuration(expSeconds)} / {formatDuration(target)}
            </span>
          )}
          {progress.asked > 0 && (
            <span className="stage-clock">
              Pregunta {Math.min(progress.asked, progress.total)} de {progress.total} ·{' '}
              {STAGE_TEXT[engine.current?.stage ?? 'introduccion'].name}
            </span>
          )}
        </div>
        {card && (
          <div className="time-card" role="status">
            {card}
          </div>
        )}
        <div className="seats">
          {config.participants.map((p, i) => (
            <div className={`seat ${speaking === p.id ? 'speaking' : ''}`} key={p.id}>
              <Avatar
                ref={(h) => {
                  if (h) avatars.current.set(p.id, h);
                  else avatars.current.delete(p.id);
                }}
                look={p.look}
                temperament={p.temperament}
                seed={i}
                label={`${p.name}, ${p.role}${speaking === p.id ? ', está hablando' : ', escucha'}`}
              />
            </div>
          ))}
        </div>
        <div className="room-table">
          {config.participants.map((p) => (
            <div className={`nameplate ${speaking === p.id ? 'speaking' : ''}`} key={p.id}>
              <strong>{p.name}</strong>
              <span>{p.role}</span>
            </div>
          ))}
        </div>
        {setup.audience > 0 && (
          <div
            className="audience-strip"
            role="img"
            aria-label={`Público: atención ${attention >= 70 ? 'alta' : attention >= 40 ? 'media' : 'baja'} (simulada)`}
          >
            {Array.from({ length: setup.audience }, (_, i) => (
              <AudienceMember key={i} index={i} attentive={attention >= 25 + ((i * 37) % 50)} />
            ))}
          </div>
        )}
        <div className="stage-band" aria-live="polite">
          {band && (stage === 'agente' || stage === 'respuesta') ? (
            <>
              <span className="who">
                {speaker?.name} · {KIND_TEXT[band.kind]}
                {band.generator === 'ia' ? (
                  <span className="badge primary">IA</span>
                ) : (
                  <span className="badge">reglas</span>
                )}
                {band.sources.length > 0 && (
                  <button className="text-link" onClick={() => setShowSources(!showSources)}>
                    <BookOpen size={14} /> {showSources ? 'Ocultar fundamento' : 'Ver fundamento'}
                  </button>
                )}
              </span>
              {showText ? (
                <p className="said">{band.text}</p>
              ) : (
                <p className="caption">
                  Subtítulos ocultos.{' '}
                  <button className="text-link" onClick={() => setShowText(true)}>
                    Mostrar texto
                  </button>
                </p>
              )}
              {showSources &&
                band.sources.map((s) => (
                  <blockquote className="source-quote" key={s.chunkId}>
                    «{s.excerpt}»
                    <small>
                      {s.docName} · {s.location}
                    </small>
                  </blockquote>
                ))}
            </>
          ) : stage === 'pensando' || stage === 'preparando' || stage === 'cierre' ? (
            <p className="band-status" role="status">
              <span className="spinner" /> {transcribing ? 'Transcribiendo tu voz en este equipo…' : status}
            </p>
          ) : (
            <p className="caption">
              {stage === 'exposicion'
                ? 'Habla mirando a los interlocutores, como si estuvieras en la sala.'
                : 'Escucha.'}
            </p>
          )}
        </div>
      </section>
      <aside className="room-side">
        {setup.camera && (
          <figure className={`self-view-box ${sensors.current?.hasCamera ? '' : 'hidden'}`}>
            <video ref={videoRef} className="self-view" muted playsInline aria-label="Tu cámara" />
            <figcaption>Tu cámara (espejo)</figcaption>
          </figure>
        )}
        {warnings.map((w) => (
          <Alert key={w} tone="warn">
            {w}
          </Alert>
        ))}
        <section className="panel" aria-label="Controles">
          <div className="controls">
            {stage === 'exposicion' && (
              <button className="button primary" onClick={() => void endExposition()} disabled={paused}>
                <Square size={16} />{' '}
                {scenario.opening.kind === 'exposicion' ? 'Terminar y pasar a preguntas' : 'Listo, continuar'}
              </button>
            )}
            {stage === 'respuesta' && (
              <>
                <button className="button primary" onClick={() => void finishAnswer()} disabled={paused}>
                  <ArrowRight size={16} />{' '}
                  {asking.current?.move.kind === 'interrupcion'
                    ? 'Respondí, sigo exponiendo'
                    : 'Terminé mi respuesta'}
                </button>
                <button
                  className="button secondary"
                  disabled={paused}
                  onClick={() => {
                    const a = asking.current;
                    if (a)
                      void speakMove({ ...a.move, answerType: undefined }, false).then(
                        () => (listen('respuesta'), go('respuesta')),
                      );
                  }}
                >
                  <Repeat size={16} /> Repetir
                </button>
              </>
            )}
            {userTurn && (
              <button className="button secondary" onClick={togglePause}>
                {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Continuar' : 'Pausar'}
              </button>
            )}
            {stage === 'agente' && (
              <button className="button secondary" onClick={() => speech.current?.cancel()}>
                <Hand size={16} /> Saltar intervención
              </button>
            )}
            {(stage === 'respuesta' || stage === 'exposicion') && engine.current?.status === 'questions' && (
              <button className="button quiet" onClick={() => void finish()}>
                Terminar la práctica ahora
              </button>
            )}
            {stage !== 'cierre' && (
              <button className="button quiet" onClick={() => setConfirmCancel(true)}>
                Salir sin guardar
              </button>
            )}
            <button className="button quiet" onClick={() => setShowText(!showText)} aria-pressed={showText}>
              {showText ? <EyeOff size={16} /> : <Eye size={16} />}{' '}
              {showText ? 'Ocultar subtítulos' : 'Mostrar subtítulos'}
            </button>
          </div>
          {stage === 'respuesta' && !!stt.current && (live?.silence ?? 0) >= 3 && setup.autoEnd > 0 && (
            <p className="caption" role="status">
              Si terminaste, la conversación sigue tras {setup.autoEnd} s de silencio.
            </p>
          )}
        </section>
        {(stage === 'respuesta' || (stage === 'exposicion' && !stt.current)) && (
          <label className="field panel">
            {stt.current ? 'Agregar por escrito (opcional)' : 'Escribe lo esencial de lo que dices'}
            <textarea
              rows={3}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                typedRef.current = e.target.value;
              }}
              placeholder={
                stt.current
                  ? 'Por si el reconocimiento no captó algo importante.'
                  : 'Sin reconocimiento de voz, el texto permite analizar tu contenido.'
              }
            />
          </label>
        )}
        {setup.indicators ? (
          <section className="panel" aria-label="Indicadores en vivo">
            <div className="live-grid">
              <LiveItem icon={<Mic size={15} />} label="Tu voz">
                <div className="mini-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round((live?.level ?? 0) * 100)}%` }} />
                </div>
                <strong>
                  {live?.speaking ? 'Hablando' : `Silencio ${Math.round(live?.silence ?? 0)} s`}
                </strong>
              </LiveItem>
              <LiveItem icon={<Volume2 size={15} />} label="Velocidad">
                <strong>
                  {stt.current?.live ? (stats.wpm ? `${Math.round(stats.wpm)} ppm` : '—') : 'Al final'}
                </strong>
              </LiveItem>
              <LiveItem icon={<Captions size={15} />} label="Muletillas">
                <strong>{stt.current ? stats.fillers : '—'}</strong>
              </LiveItem>
              <LiveItem icon={<Eye size={15} />} label="Mirada">
                <strong>
                  {live?.vision === 'on'
                    ? live.faceSeen === false
                      ? 'Sin rostro'
                      : live.contact === null
                        ? '—'
                        : `${Math.round(live.contact * 100)} %`
                    : live?.vision === 'loading'
                      ? 'Cargando…'
                      : 'Sin medición'}
                </strong>
              </LiveItem>
              {setup.audience > 0 && (
                <LiveItem icon={<Sparkles size={15} />} label="Atención (simulada)">
                  <div className={`mini-meter ${attention < 40 ? 'low' : ''}`} aria-hidden="true">
                    <span style={{ width: `${attention}%` }} />
                  </div>
                  <strong>{attention >= 70 ? 'Alta' : attention >= 40 ? 'Media' : 'Baja'}</strong>
                </LiveItem>
              )}
            </div>
            {stt.current?.live && (interim || lastFinal) && (
              <p className="live-caption">
                <span>Lo que reconoce la app:</span> {interim || lastFinal}
              </p>
            )}
          </section>
        ) : (
          <p className="caption">Modo sin ayudas: las mediciones aparecen en el informe.</p>
        )}
        <section className="panel" aria-label="Motores en uso">
          <p className="caption">
            Voz: {TTS_TEXT[engines.tts] ?? '—'} · Reconocimiento: {STT_TEXT[engines.stt] ?? '—'} ·
            Interlocutores: {engines.llm ? `modelo ${engines.llm}` : 'reglas del motor'}
            {ai.useLlm && !engines.llm ? ' (sin modelo asignado)' : ''}
          </p>
          {current?.reason && <p className="caption">Por qué esta intervención: {current.reason}</p>}
        </section>
      </aside>
      {confirmCancel && (
        <Confirm
          title="¿Salir sin guardar?"
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

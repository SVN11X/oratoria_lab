import { words } from '@oratoria/defense';
import { analyzeAnswer, answerScore, overlap, similarity } from './analysis';
import { DIFFICULTIES, TEMPERAMENTS, civilityIssues, pick, seeded } from './personas';
import {
  DecisionSchema,
  DECISION_JSON_SCHEMA,
  InterruptSchema,
  QuestionSchema,
  QUESTION_JSON_SCHEMA,
  decisionPrompt,
  extractJson,
  interruptionPrompt,
  questionPrompt,
} from './prompts';
import {
  chairOf,
  chooseArea,
  followUpChance,
  longAnswerInterruption,
  reactionText,
  ruleFollowUp,
  ruleInterruption,
  ruleQuestion,
  speakerOrder,
  stageFor,
  timeNotice,
  openerOf,
  reformulation,
} from './rules';
import { SCENARIOS } from './scenarios';
import type {
  AnswerAnalysis,
  Citation,
  EngineStatus,
  LlmPort,
  Move,
  MoveKind,
  Participant,
  RetrievedChunk,
  Retriever,
  ScenarioDef,
  SessionConfig,
  Stage,
  TurnRecord,
} from './types';

export type EngineDeps = {
  llm?: LlmPort | null;
  retrieve?: Retriever | null;
  rng?: () => number;
  signal?: AbortSignal;
  /** Tiempos máximos por llamada al modelo (ms). */
  timeouts?: { question?: number; decision?: number; interruption?: number };
};
export type AnswerInput = {
  text: string;
  durationSec: number;
  latencySec: number | null;
  interrupted?: boolean;
};

const WEAK = new Set(['parcial', 'sin_sustento', 'evade', 'contradice_documento', 'sin_respuesta']);

/**
 * Motor de conversación con estados explícitos. La interfaz le informa lo que ocurre (exposición,
 * respuestas, tiempo) y el motor decide quién habla, qué pregunta y cuándo repreguntar.
 *
 * Estados: idle → opening → (exposition) → questions → closing → finished.
 * El turno actual siempre es una pregunta esperando respuesta (`current`) o ninguno.
 */
export class ConversationEngine {
  readonly scenario: ScenarioDef;
  status: EngineStatus = 'idle';
  stage: Stage = 'introduccion';
  readonly turns: TurnRecord[] = [];
  readonly moves: Move[] = [];
  readonly notes: string[] = [];
  /** Texto de la exposición con el segundo en que se dijo cada parte. */
  readonly exposition: { text: string; t: number }[] = [];
  readonly memory = {
    covered: new Map<string, number>(),
    asked: [] as string[],
    weak: [] as { area: string; question: string; answer: string }[],
    claims: [] as { turn: number; text: string }[],
  };
  private current: TurnRecord | null = null;
  private currentChunks: RetrievedChunk[] = [];
  private mainAsked = 0;
  private followUps = 0;
  private reformulated = 0;
  private interruptedCurrent = false;
  private interruptionsDone = 0;
  private perf: number[] = [];
  private relevance: Map<string, number> | null = null;
  private seq = 0;
  private rng: () => number;
  private names: Map<string, string>;
  private llmFailures = 0;
  private recentReactions = new Map<string, string[]>();
  private lastOpener = new Map<string, string>();
  private mainCore = '';

  constructor(
    readonly config: SessionConfig,
    private deps: EngineDeps = {},
  ) {
    this.scenario = SCENARIOS[config.scenario];
    if (!config.participants.length) throw new Error('La práctica necesita al menos un interlocutor.');
    this.rng = deps.rng ?? seeded(Date.now() % 2147483647);
    this.names = new Map(config.participants.map((p) => [p.id, p.name]));
  }

  get participants() {
    return this.config.participants;
  }
  get currentTurn() {
    return this.current;
  }
  get llmActive() {
    return !!this.deps.llm && this.llmFailures < 3;
  }
  participant(id: string) {
    return this.participants.find((p) => p.id === id) ?? this.participants[0]!;
  }
  private chair() {
    return chairOf(this.participants, this.scenario);
  }
  private move(kind: MoveKind, speaker: Participant, text: string, extra: Partial<Move> = {}): Move {
    const m: Move = {
      id: `m${++this.seq}`,
      kind,
      speakerId: speaker.id,
      text: text.replace(/\s+/g, ' ').trim(),
      area: null,
      stage: this.stage,
      sources: [],
      reason: '',
      generator: 'reglas',
      ...extra,
    };
    this.moves.push(m);
    return m;
  }
  private note(message: string) {
    if (!this.notes.includes(message)) this.notes.push(message);
  }
  private async llmJson<T>(
    messages: Parameters<LlmPort['complete']>[0],
    parse: (v: unknown) => T,
    timeoutMs: number,
    schema: Record<string, unknown>,
  ): Promise<T | null> {
    const llm = this.deps.llm;
    if (!llm || this.llmFailures >= 3) return null;
    try {
      const raw = await llm.complete(messages, {
        json: true,
        schema,
        signal: this.deps.signal,
        timeoutMs,
        temperature: 0.7,
      });
      const value = parse(extractJson(raw));
      this.llmFailures = 0;
      return value;
    } catch (error) {
      if (this.deps.signal?.aborted) throw error;
      this.llmFailures++;
      this.note(
        this.llmFailures >= 3
          ? 'El modelo de lenguaje falló varias veces seguidas; el resto de la práctica usa las reglas del motor.'
          : `Una intervención se generó con reglas porque el modelo no respondió a tiempo o con un formato válido (${error instanceof Error ? error.message.slice(0, 120) : 'error'}).`,
      );
      return null;
    }
  }
  private async retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
    const material = this.deps.retrieve ? await this.deps.retrieve(query, k).catch(() => []) : [];
    if (material.length) return material;
    return this.expositionChunks(query, Math.min(k, 3));
  }
  /** Sin material cargado, la propia exposición sirve como fuente citada. */
  private expositionChunks(query: string, k: number): RetrievedChunk[] {
    const scored = this.exposition
      .filter((e) => words(e.text).length >= 8)
      .map((e, i) => ({ e, i, s: similarity(query, e.text) + overlap(query, e.text) * 0.3 }))
      .filter((x) => x.s > 0.02)
      .sort((a, b) => b.s - a.s)
      .slice(0, k);
    return scored.map(({ e, i, s }) => ({
      docId: 'exposicion',
      docName: 'Tu exposición',
      chunkId: `exp-${i}`,
      location: `minuto ${Math.floor(e.t / 60)}:${String(Math.round(e.t % 60)).padStart(2, '0')}`,
      excerpt: e.text.slice(0, 240),
      text: e.text,
      score: s,
    }));
  }
  private async computeRelevance() {
    if (!this.deps.retrieve || this.relevance) return;
    const map = new Map<string, number>();
    for (const a of this.scenario.areas) {
      const hits = await this.deps.retrieve(`${a.query} ${this.config.topic}`, 1).catch(() => []);
      map.set(a.id, hits[0]?.score ?? 0);
    }
    const max = Math.max(...map.values(), 1e-9);
    for (const [k, v] of map) map.set(k, (v / max) * 5);
    this.relevance = map;
  }
  private isRepeat(text: string) {
    return this.memory.asked.some((q) => similarity(q, text) >= 0.6);
  }
  private acceptable(text: string | null | undefined): text is string {
    return !!text && text.trim().length >= 8 && civilityIssues(text).length === 0;
  }
  private citationsFrom(ids: string[], chunks: RetrievedChunk[]): Citation[] {
    return [...new Set(ids)]
      .map((id) => (/^S[1-9]\d*$/.test(id) ? chunks[Number(id.slice(1)) - 1] : undefined))
      .filter((c): c is RetrievedChunk => !!c)
      .map((c) => ({
        docId: c.docId,
        docName: c.docName,
        chunkId: c.chunkId,
        location: c.location,
        excerpt: c.excerpt || c.text.slice(0, 240),
      }));
  }
  private performance() {
    const recent = this.perf.slice(-3);
    return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  }

  /** Saludo e invitación a exponer, o primera pregunta si no hay exposición. */
  async start(): Promise<Move[]> {
    if (this.status !== 'idle') throw new Error('La práctica ya comenzó.');
    this.status = 'opening';
    const chair = this.chair();
    const greet = pick(this.scenario.greeting, this.rng);
    await this.computeRelevance();
    if (this.config.openingMinutes > 0 && this.scenario.opening.kind !== 'ninguna') {
      const invite =
        this.scenario.opening.kind === 'exposicion'
          ? ` Dispone de ${this.config.openingMinutes} minutos para su ${this.scenario.opening.label.toLowerCase()}. Puede comenzar cuando esté listo.`
          : '';
      const m = this.move('saludo', chair, `${greet}${invite}`, { reason: 'Apertura de la sesión.' });
      this.status = 'exposition';
      return [m];
    }
    const hello = this.move('saludo', chair, greet, { reason: 'Apertura de la sesión.' });
    this.status = 'questions';
    return [hello, await this.nextQuestion()];
  }
  /** Registra texto reconocido durante la exposición. */
  addExposition(text: string, t: number) {
    if (text.trim()) this.exposition.push({ text: text.trim(), t });
  }
  expositionText() {
    return this.exposition.map((e) => e.text).join(' ');
  }
  /** Interrupción durante la exposición. Devuelve null si no corresponde. */
  async interruptExposition(recent: string): Promise<Move | null> {
    if (
      this.status !== 'exposition' ||
      !this.config.interruptions ||
      this.scenario.opening.kind !== 'exposicion'
    )
      return null;
    const weights = this.participants.map((p) => ({
      p,
      w: TEMPERAMENTS[p.temperament].interrupts * (0.7 + this.rng() * 0.6),
    }));
    const { p } = weights.sort((a, b) => b.w - a.w)[0]!;
    const chunks = await this.retrieve(recent, 3);
    let text = ruleInterruption(recent, this.scenario, p, this.rng),
      generator: Move['generator'] = 'reglas';
    if (this.llmActive && words(recent).length > 15) {
      const r = await this.llmJson(
        interruptionPrompt({
          participant: p,
          others: this.participants.filter((o) => o !== p),
          scenario: this.scenario,
          config: this.config,
          stage: this.stage,
          recent,
          chunks,
        }),
        (v) => InterruptSchema.parse(v),
        this.deps.timeouts?.interruption ?? 15000,
        { type: 'object', properties: { pregunta: { type: 'string' } }, required: ['pregunta'] },
      );
      if (r && this.acceptable(r.pregunta)) {
        text = r.pregunta;
        generator = 'ia';
      }
    }
    this.interruptionsDone++;
    const m = this.move('interrupcion', p, text, {
      generator,
      reason: 'Interrumpe para aclarar algo que acaba de decir.',
    });
    this.setCurrent(m, chunks);
    return m;
  }
  /** Aviso de tiempo por quien preside. */
  timeNotice(kind: '5' | '2' | '0' | 'x'): Move {
    return this.move('aviso', this.chair(), timeNotice(kind, this.scenario, this.chair()), {
      reason: 'Control del tiempo.',
    });
  }
  /** Fin de la exposición: transición y primera pregunta. */
  async endExposition(): Promise<Move[]> {
    if (this.status !== 'exposition') throw new Error('No hay una exposición en curso.');
    this.current = null;
    this.status = 'questions';
    const chair = this.chair();
    const transition = this.move(
      'aviso',
      chair,
      this.scenario.id === 'dificil'
        ? 'Ya. Te escucho, pero tengo algunas cosas que decir.'
        : this.scenario.id === 'entrevista'
          ? 'Gracias. Vamos con algunas preguntas.'
          : 'Muchas gracias. Pasamos ahora a las preguntas.',
      { reason: 'Transición a la ronda de preguntas.' },
    );
    return [transition, await this.nextQuestion()];
  }
  private setCurrent(question: Move, chunks: RetrievedChunk[]) {
    this.current = { question, answer: null };
    this.currentChunks = chunks;
    this.interruptedCurrent = false;
    this.turns.push(this.current);
    this.memory.asked.push(question.core ?? question.text);
  }
  private async nextQuestion(): Promise<Move> {
    const order = speakerOrder(this.participants, this.scenario);
    const p = order[this.mainAsked % order.length]!;
    const stage = stageFor(
      this.mainAsked,
      this.config.questions,
      p,
      this.config.progressive,
      this.performance(),
      this.rng,
    );
    this.stage = stage;
    const area = chooseArea(p, this.scenario, this.memory.covered, this.relevance, this.rng, {
      index: this.mainAsked,
      total: this.config.questions,
    });
    const chunks = await this.retrieve(`${area.query} ${this.config.topic}`, 4);
    this.memory.covered.set(area.id, (this.memory.covered.get(area.id) ?? 0) + 1);
    this.mainAsked++;
    this.followUps = 0;
    this.reformulated = 0;
    let text = '',
      core = '',
      sources: Citation[] = [],
      reason = '',
      generator: Move['generator'] = 'reglas';
    if (this.llmActive) {
      for (let attempt = 0; attempt < 2 && !text; attempt++) {
        const r = await this.llmJson(
          questionPrompt({
            participant: p,
            others: this.participants.filter((o) => o !== p),
            scenario: this.scenario,
            config: this.config,
            stage,
            areaName: area.name,
            areaQuery: area.query,
            chunks,
            exposition: this.expositionText(),
            turns: this.turns,
            asked: this.memory.asked,
            names: this.names,
          }),
          (v) => QuestionSchema.parse(v),
          this.deps.timeouts?.question ?? 45000,
          QUESTION_JSON_SCHEMA,
        );
        if (r && this.acceptable(r.pregunta) && !this.isRepeat(r.pregunta)) {
          text = r.pregunta;
          core = r.pregunta;
          sources = this.citationsFrom(r.fuentes, chunks);
          reason = r.motivo || `Área «${area.name}».`;
          generator = 'ia';
        } else if (r)
          this.note('Se descartó una pregunta del modelo por repetir otra o no cumplir las reglas de trato.');
      }
    }
    if (!text) {
      const rq = ruleQuestion({
        participant: p,
        scenario: this.scenario,
        stage,
        area,
        chunks,
        topic: this.config.topic,
        asked: this.memory.asked,
        weak: this.memory.weak,
        rng: this.rng,
        lastOpener: this.lastOpener.get(p.id),
      });
      this.lastOpener.set(p.id, openerOf(rq.text));
      text = rq.text;
      core = rq.core;
      sources = rq.sources;
      reason = rq.reason;
    }
    const m = this.move('pregunta', p, text, { area: area.id, stage, sources, reason, generator, core });
    this.mainCore = core;
    this.setCurrent(m, chunks);
    return m;
  }

  /** Paciencia ante una respuesta larga, según temperamento, dificultad y escenario. */
  patience(p: Participant) {
    const d = { basica: 1.3, intermedia: 1.1, avanzada: 1, experta: 0.9, extrema: 0.8 }[p.difficulty];
    const s = this.scenario.id === 'dificil' ? 0.8 : this.scenario.id === 'presentacion' ? 0.85 : 1;
    return Math.round(TEMPERAMENTS[p.temperament].patience * d * s);
  }
  /**
   * Interrupción mientras la persona responde (respuesta muy larga o desviada). Es síncrona para
   * poder llamarla cada segundo; devuelve la intervención o null.
   */
  shouldInterruptAnswer(elapsedSec: number, liveText: string): Move | null {
    const c = this.current;
    if (
      !c ||
      c.answer ||
      this.interruptedCurrent ||
      !this.config.interruptions ||
      c.question.kind === 'interrupcion'
    )
      return null;
    const p = this.participant(c.question.speakerId);
    const n = words(liveText).length;
    const strict = p.temperament !== 'amable' && p.temperament !== 'cordial';
    const offTopic = strict && elapsedSec > 30 && n > 60 && overlap(c.question.text, liveText) < 0.08;
    if (elapsedSec < this.patience(p) && !offTopic) return null;
    this.interruptedCurrent = true;
    return this.move('interrupcion', p, longAnswerInterruption(this.scenario, p, offTopic, c.question.text), {
      area: c.question.area,
      reason: offTopic
        ? 'La respuesta se alejó de la pregunta.'
        : `La respuesta superó ${this.patience(p)} s.`,
    });
  }

  /** Registra la respuesta al turno actual y devuelve las siguientes intervenciones. */
  async answer(input: AnswerInput): Promise<Move[]> {
    const c = this.current;
    if (!c || c.answer) throw new Error('No hay una pregunta esperando respuesta.');
    const q = c.question,
      p = this.participant(q.speakerId);
    const extra =
      this.deps.retrieve && words(input.text).length > 6 ? await this.retrieve(input.text, 3) : [];
    const context = [
      ...this.currentChunks,
      ...extra.filter((e) => !this.currentChunks.some((x) => x.chunkId === e.chunkId)),
    ];
    let analysis: AnswerAnalysis = analyzeAnswer({
      question: q.text,
      answer: input.text,
      scenario: this.scenario.id,
      area: q.area,
      retrieved: context,
    });
    const isInterruption = q.kind === 'interrupcion';
    const reformulating = analysis.type === 'pide_reformulacion' || analysis.type === 'no_comprende';
    const maxFollow = Math.max(
      1,
      DIFFICULTIES[p.difficulty].maxFollowUps - (p.temperament === 'amable' ? 1 : 0),
    );
    const canFollow =
      this.config.followUps &&
      !isInterruption &&
      (reformulating ? this.reformulated < 1 : this.followUps < maxFollow);
    const used = this.recentReactions.get(p.id) ?? [];
    let reaction = reactionText(p, analysis, this.rng, used),
      follow: string | null = null,
      followReason = '',
      followSources: Citation[] = [],
      generator: Move['generator'] = 'reglas';
    let decided = false;
    if (this.llmActive && words(input.text).length > 0) {
      const d = await this.llmJson(
        decisionPrompt({
          participant: p,
          others: this.participants.filter((o) => o !== p),
          scenario: this.scenario,
          config: this.config,
          stage: this.stage,
          question: q.text,
          answer: input.text,
          analysis,
          chunks: context,
          allowFollowUp: canFollow,
          turns: this.turns.filter((t) => t !== c),
          names: this.names,
        }),
        (v) => DecisionSchema.parse(v),
        this.deps.timeouts?.decision ?? 30000,
        DECISION_JSON_SCHEMA,
      );
      if (d) {
        decided = true;
        // Una contradicción numérica detectada por reglas tiene evidencia verificable: prevalece.
        const type = analysis.contradictions.length ? 'contradice_documento' : d.tipo;
        analysis = { ...analysis, type, generator: 'ia' };
        if (this.acceptable(d.reaccion) || d.reaccion === '') reaction = d.reaccion || reaction;
        if (canFollow && this.acceptable(d.repregunta) && (reformulating || !this.isRepeat(d.repregunta!))) {
          follow = d.repregunta!;
          followReason = d.motivo || 'El modelo consideró que la respuesta necesitaba precisión.';
          followSources = this.citationsFrom(d.fuentes, context);
          generator = 'ia';
        }
      }
    }
    if (!decided && canFollow) {
      const want = this.rng() < followUpChance(p, analysis);
      const r = want
        ? ruleFollowUp({
            analysis,
            question: reformulating ? this.mainCore || q.core || q.text : q.core || q.text,
            answer: input.text,
            participant: p,
            scenario: this.scenario,
            rng: this.rng,
            fresh: (t) => !this.isRepeat(t),
          })
        : null;
      if (r && reformulating) {
        follow = reformulation(
          this.mainCore || q.core || q.text,
          this.scenario.areas.find((a) => a.id === q.area),
          this.scenario,
        );
        followReason = r.reason;
      } else if (r && !this.isRepeat(r.text)) {
        follow = r.text;
        followReason = r.reason;
      }
    }
    c.answer = {
      text: input.text,
      durationSec: input.durationSec,
      latencySec: input.latencySec,
      interrupted: !!input.interrupted || this.interruptedCurrent,
      analysis,
      feedback: null,
    };
    this.perf.push(answerScore(analysis.type));
    if (reaction) this.recentReactions.set(p.id, [...used, reaction].slice(-3));
    if (!follow && reformulating) reaction = '';
    if (WEAK.has(analysis.type) && q.area && input.text.trim())
      this.memory.weak.push({ area: q.area, question: q.core || q.text, answer: input.text });
    for (const sentence of input.text.split(/(?<=[.!?])\s+/))
      if (/\d|porque|demuestra|resultado|logr/i.test(sentence) && words(sentence).length >= 6)
        this.memory.claims.push({ turn: this.turns.length - 1, text: sentence.trim() });
    this.current = null;

    if (isInterruption) {
      this.status = 'exposition';
      const back =
        this.scenario.id === 'dificil' || this.scenario.id === 'educativa'
          ? 'Sigue, por favor.'
          : 'Gracias. Continúe, por favor.';
      return [
        this.move('aviso', p, reaction && analysis.type !== 'correcta' ? `${reaction} ${back}` : back, {
          answerType: analysis.type,
          reason: 'Retoma la exposición.',
        }),
      ];
    }
    if (follow) {
      if (reformulating) this.reformulated++;
      else this.followUps++;
      const text = reaction && !reformulating ? `${reaction} ${follow}` : follow;
      const m = this.move(reformulating ? 'reformulacion' : 'repregunta', p, text, {
        core: follow,
        area: q.area,
        stage: this.stage,
        sources: followSources.length ? followSources : q.sources,
        reason: followReason,
        generator,
        answerType: analysis.type,
        reaction: reformulating ? undefined : reaction || undefined,
      });
      this.setCurrent(m, context);
      return [m];
    }
    const out: Move[] = [];
    if (reaction)
      out.push(
        this.move('reaccion', p, reaction, {
          answerType: analysis.type,
          reason: 'Reacción a la respuesta.',
          generator,
        }),
      );
    if (this.mainAsked >= this.config.questions) out.push(...this.closing());
    else out.push(await this.nextQuestion());
    return out;
  }
  private closing(): Move[] {
    this.status = 'closing';
    this.current = null;
    const m = this.move('cierre', this.chair(), pick(this.scenario.closing, this.rng), {
      reason: 'Cierre de la sesión.',
    });
    this.status = 'finished';
    return [m];
  }
  /** Termina la práctica antes de tiempo. */
  finish(): Move[] {
    if (this.status === 'finished') return [];
    if (this.current && !this.current.answer) {
      this.turns.splice(this.turns.indexOf(this.current), 1);
      this.current = null;
    }
    return this.closing();
  }
  /** Resumen serializable para el informe. */
  snapshot() {
    return {
      scenario: this.scenario.id,
      config: this.config,
      moves: this.moves,
      turns: this.turns.filter((t) => t.answer),
      exposition: this.exposition,
      notes: [...this.notes],
      llmModel: this.deps.llm?.model ?? null,
      stagesReached: [...new Set(this.moves.map((m) => m.stage))],
      interruptions: this.interruptionsDone,
    };
  }
}
export type EngineSnapshot = ReturnType<ConversationEngine['snapshot']>;

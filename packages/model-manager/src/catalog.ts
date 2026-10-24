import {
  isEmbeddingModel,
  paramsBillions,
  type OllamaModel,
  type OllamaRunning,
  type OllamaShow,
} from './ollama';

export type ModelFunction = 'conversacion' | 'evaluacion' | 'embeddings' | 'stt' | 'tts' | 'vision';
export const FUNCTION_TEXT: Record<ModelFunction, { name: string; what: string }> = {
  conversacion: {
    name: 'Conversación',
    what: 'Da voz a los interlocutores: preguntas, repreguntas y reacciones.',
  },
  evaluacion: { name: 'Evaluación', what: 'Revisa tus respuestas al final y cita evidencias.' },
  embeddings: {
    name: 'Búsqueda en tu material',
    what: 'Convierte tu tesis en vectores para encontrar fragmentos por significado.',
  },
  stt: { name: 'Reconocimiento de voz', what: 'Convierte lo que dices en texto.' },
  tts: { name: 'Voz de los interlocutores', what: 'Convierte el texto de los personajes en voz.' },
  vision: { name: 'Cámara', what: 'Mide mirada, gestos y postura.' },
};
export type Profile = 'eficiente' | 'equilibrado' | 'calidad' | 'personalizado';
export const PROFILE_TEXT: Record<Profile, { name: string; what: string }> = {
  eficiente: {
    name: 'Eficiente',
    what: 'Bajo consumo y respuestas rápidas. Para equipos con 8 GB de RAM o menos.',
  },
  equilibrado: { name: 'Equilibrado', what: 'Buena relación entre calidad y velocidad. Para 16 GB de RAM.' },
  calidad: {
    name: 'Máxima calidad local',
    what: 'Análisis más extenso. Requiere comprobar VRAM, contexto y velocidad real antes de usarlo en conversación.',
  },
  personalizado: { name: 'Personalizado', what: 'Eliges manualmente cada modelo.' },
};

/**
 * Catálogo de modelos de Ollama sugeridos. Tamaños tomados de ollama.com el 17-10-2026; pueden
 * cambiar. La licencia definitiva es la que informa Ollama al instalarlo (/api/show).
 */
export type CatalogEntry = {
  tag: string;
  family: string;
  functions: ModelFunction[];
  params: string;
  downloadGb: string;
  /** RAM libre recomendada para ejecutarlo con contexto moderado (estimación). */
  ramGb: number;
  tier: Exclude<Profile, 'personalizado'>;
  spanish: string;
  note: string;
  source: string;
};
export const CATALOG: CatalogEntry[] = [
  {
    tag: 'qwen3.5:2b',
    family: 'qwen3.5',
    functions: ['conversacion'],
    params: '2B',
    downloadGb: '2,7–3,1',
    ramGb: 5,
    tier: 'eficiente',
    spanish: 'Multilingüe; adecuado para preguntas breves.',
    note: 'Rápido en CPU. Puede ser superficial al evaluar.',
    source: 'https://ollama.com/library/qwen3.5',
  },
  {
    tag: 'qwen3.5:4b',
    family: 'qwen3.5',
    functions: ['conversacion', 'evaluacion'],
    params: '4B',
    downloadGb: '3,3–4,0',
    ramGb: 7,
    tier: 'equilibrado',
    spanish: 'Multilingüe; buen equilibrio para español.',
    note: 'Candidato rápido para GPU de 6 GiB; confirma carga y velocidad con la prueba local.',
    source: 'https://ollama.com/library/qwen3.5',
  },
  {
    tag: 'qwen3.5:9b',
    family: 'qwen3.5',
    functions: ['conversacion', 'evaluacion'],
    params: '9B',
    downloadGb: '6,6–7,6',
    ramGb: 11,
    tier: 'calidad',
    spanish: 'Multilingüe; candidato para análisis académico.',
    note: 'Puede repartir carga entre CPU y GPU. La RAM abundante no garantiza conversación rápida.',
    source: 'https://ollama.com/library/qwen3.5',
  },
  {
    tag: 'gemma4:e4b',
    family: 'gemma4',
    functions: ['conversacion', 'evaluacion'],
    params: 'E4B',
    downloadGb: '6,6–9,5',
    ramGb: 10,
    tier: 'equilibrado',
    spanish: 'Multilingüe (familia Gemma).',
    note: 'Alternativa a Qwen para comparar estilo de preguntas.',
    source: 'https://ollama.com/library/gemma4',
  },
  {
    tag: 'gemma4:12b',
    family: 'gemma4',
    functions: ['conversacion', 'evaluacion'],
    params: '12B',
    downloadGb: '7,7–8,0',
    ramGb: 13,
    tier: 'calidad',
    spanish: 'Multilingüe (familia Gemma).',
    note: 'Para equipos con GPU de 12 GB o 32 GB de RAM.',
    source: 'https://ollama.com/library/gemma4',
  },
  {
    tag: 'qwen3-embedding:0.6b',
    family: 'qwen3-embedding',
    functions: ['embeddings'],
    params: '0,6B',
    downloadGb: '0,64',
    ramGb: 2,
    tier: 'eficiente',
    spanish: 'Multilingüe (100+ idiomas).',
    note: 'Embeddings recomendados para tu tesis en español.',
    source: 'https://ollama.com/library/qwen3-embedding',
  },
  {
    tag: 'bge-m3',
    family: 'bge-m3',
    functions: ['embeddings'],
    params: '567M',
    downloadGb: '1,2',
    ramGb: 2.5,
    tier: 'equilibrado',
    spanish: 'Multilingüe (100+ idiomas), contexto largo.',
    note: 'Alternativa multilingüe con contexto de 8.192 tokens.',
    source: 'https://ollama.com/library/bge-m3',
  },
  {
    tag: 'embeddinggemma',
    family: 'embeddinggemma',
    functions: ['embeddings'],
    params: '300M',
    downloadGb: '0,62',
    ramGb: 1.5,
    tier: 'eficiente',
    spanish: 'Multilingüe.',
    note: 'Ligero; contexto de 2K tokens.',
    source: 'https://ollama.com/library/embeddinggemma',
  },
];

export type Hardware = {
  /** RAM total en GB si se conoce (escritorio) o límite inferior que informa el navegador. */
  ramGb: number | null;
  ramSource: 'sistema' | 'navegador' | 'desconocido';
  cores: number | null;
  gpu: string | null;
  webgpu: boolean;
  /** Puntaje del microbenchmark de CPU (mayor es más rápido), si se ejecutó. */
  cpuScore: number | null;
  /** Solo medidas nativas. Nunca se infieren de la RAM o del nombre de GPU. */
  vramGb?: number | null;
  availableVramGb?: number | null;
  availableRamGb?: number | null;
  cpuBrand?: string | null;
  gpuSource?: 'nvidia-smi' | 'webgpu' | 'webgl' | 'desconocido';
};
export function profileForHardware(h: Hardware): Exclude<Profile, 'personalizado'> {
  // Un microbenchmark JavaScript no permite deducir la RAM física ni la VRAM.
  const capped = h.ramSource === 'navegador' && (h.ramGb ?? 0) >= 8;
  const ram = h.ramGb ?? 0;
  if ((h.vramGb ?? 0) >= 10 && (h.availableVramGb ?? h.vramGb ?? 0) >= 8 && ram >= 15) return 'calidad';
  if (ram >= 15 || capped) return 'equilibrado';
  return 'eficiente';
}

export type AuditDecision =
  'conservar' | 'actualizar' | 'complementar' | 'sustituir' | 'desinstalar' | 'revisar';
export const DECISION_TEXT: Record<AuditDecision, string> = {
  conservar: 'Conservar',
  actualizar: 'Actualizar',
  complementar: 'Complementar',
  sustituir: 'Sustituir',
  desinstalar: 'Desinstalación opcional',
  revisar: 'Revisar',
};
export type AuditItem = {
  name: string;
  family: string;
  params: number | null;
  quantization: string | null;
  sizeBytes: number;
  tasks: ModelFunction[];
  running: boolean;
  vramBytes: number | null;
  decision: AuditDecision;
  reasons: string[];
  suggestion: string | null;
};
/** Familias con una versión más reciente en el catálogo. Ser antiguo por sí solo no implica eliminar. */
const NEWER: Record<string, string> = {
  qwen2: 'qwen3.5',
  'qwen2.5': 'qwen3.5',
  qwen3: 'qwen3.5',
  gemma: 'gemma4',
  gemma2: 'gemma4',
  gemma3: 'gemma4',
};
const familyOf = (m: OllamaModel) => {
  const base = m.name.split(':')[0]!.split('/').pop()!.toLowerCase();
  return base;
};

/**
 * Evalúa los modelos de Ollama que el usuario ya tiene. Primero se reutiliza lo instalado; las
 * recomendaciones se explican y nunca se ejecutan sin confirmación.
 */
export function auditModels(input: {
  installed: OllamaModel[];
  running: OllamaRunning[];
  shows?: Map<string, OllamaShow>;
  hardware: Hardware;
  selected?: Partial<Record<ModelFunction, string>>;
  lastUsed?: Record<string, string>;
}): { items: AuditItem[]; gaps: string[] } {
  const ram = input.hardware.ramGb;
  const items: AuditItem[] = input.installed.map((m) => {
    const caps = input.shows?.get(m.name)?.capabilities;
    const emb = isEmbeddingModel(m, caps);
    const params = paramsBillions(m);
    const tasks: ModelFunction[] = emb
      ? ['embeddings']
      : ['conversacion', ...(params === null || params >= 3 ? (['evaluacion'] as const) : [])];
    if (caps?.includes('vision')) tasks.push('vision');
    const run = input.running.find((r) => r.name === m.name);
    const reasons: string[] = [];
    let decision: AuditDecision = 'conservar',
      suggestion: string | null = null;
    const fam = familyOf(m);
    const sizeGb = m.size / 1e9;
    if (!emb && params !== null && params < 1) {
      decision = 'sustituir';
      reasons.push(
        `Con ${params < 1 ? `${Math.round(params * 1000)} M` : `${params} B`} parámetros suele producir preguntas y evaluaciones poco precisas en español.`,
      );
      suggestion = 'qwen3.5:2b o qwen3.5:4b';
    } else if (ram !== null && sizeGb > ram * 0.75) {
      decision = 'sustituir';
      reasons.push(
        `Ocupa ${sizeGb.toFixed(1)} GB y tu equipo informa ${ram} GB de RAM: probablemente será muy lento o no cargará.`,
      );
      suggestion =
        CATALOG.filter(
          (c) => c.functions.includes(emb ? 'embeddings' : 'conversacion') && c.ramGb <= ram * 0.7,
        ).sort((a, b) => b.ramGb - a.ramGb)[0]?.tag ?? null;
    } else if (NEWER[fam] && !emb) {
      decision = 'actualizar';
      reasons.push(
        `Existe una generación más reciente de la familia (${NEWER[fam]}). Conviene compararlas con la prueba de modelo antes de cambiar.`,
      );
      suggestion =
        CATALOG.find(
          (c) =>
            c.family === NEWER[fam] &&
            (params === null || Math.abs(Number.parseFloat(c.params) - params) <= params),
        )?.tag ?? `${NEWER[fam]}:4b`;
    } else {
      reasons.push(
        emb ? 'Sirve para buscar en tu material por significado.' : 'Puede usarse para conversar y evaluar.',
      );
    }
    if (m.details?.quantization_level) reasons.push(`Cuantización ${m.details.quantization_level}.`);
    if (run)
      reasons.push(
        `Cargado en memoria${run.size_vram ? ` (${(run.size_vram / 1e9).toFixed(1)} GB en GPU)` : ''}.`,
      );
    const isSelected = Object.values(input.selected ?? {}).includes(m.name);
    if (isSelected) reasons.push('Está seleccionado en Oratoria Lab.');
    return {
      name: m.name,
      family: m.details?.family ?? fam,
      params,
      quantization: m.details?.quantization_level ?? null,
      sizeBytes: m.size,
      tasks,
      running: !!run,
      vramBytes: run?.size_vram ?? null,
      decision,
      reasons,
      suggestion,
    };
  });
  // Duplicados: misma familia y tamaño con distinta cuantización.
  const groups = new Map<string, AuditItem[]>();
  for (const it of items) {
    const key = `${familyOf({ name: it.name } as OllamaModel)}|${it.params ?? '?'}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort(
      (a, b) =>
        Number(Object.values(input.selected ?? {}).includes(b.name)) -
          Number(Object.values(input.selected ?? {}).includes(a.name)) || b.sizeBytes - a.sizeBytes,
    )[0]!;
    for (const it of group)
      if (it !== keep && !Object.values(input.selected ?? {}).includes(it.name)) {
        it.decision = 'desinstalar';
        it.reasons.unshift(
          `Parece una variante del mismo modelo que ${keep.name}. Si no la usas, puedes eliminarla para recuperar espacio.`,
        );
      }
  }
  const gaps: string[] = [];
  if (!items.some((i) => i.tasks.includes('embeddings')))
    gaps.push(
      'No tienes un modelo de embeddings: la búsqueda en tu tesis funcionará solo por palabras. Complementa con qwen3-embedding:0.6b (unos 640 MB).',
    );
  if (!items.some((i) => i.tasks.includes('conversacion')))
    gaps.push(
      'No tienes un modelo conversacional en Ollama: los interlocutores usarán las reglas del motor.',
    );
  const chat = items.filter((i) => i.tasks.includes('evaluacion'));
  if (chat.length && chat.every((i) => (i.params ?? 0) >= 9) && (ram ?? 16) < 24)
    gaps.push(
      'Todos tus modelos conversacionales son grandes para tu equipo. Un modelo pequeño (qwen3.5:2b) puede responder más rápido durante la conversación.',
    );
  return { items, gaps };
}

/** Elige modelos por función priorizando lo ya instalado. Devuelve lo que falta descargar. */
export function planProfile(
  profile: Exclude<Profile, 'personalizado'>,
  installed: OllamaModel[],
): {
  assignments: Partial<Record<'conversacion' | 'evaluacion' | 'embeddings', string>>;
  downloads: CatalogEntry[];
} {
  const want = { eficiente: [2, 4.5], equilibrado: [3.5, 9.5], calidad: [7, 16] }[profile] as [
    number,
    number,
  ];
  const chat = installed.filter((m) => !isEmbeddingModel(m)).map((m) => ({ m, p: paramsBillions(m) ?? 0 }));
  const target = { eficiente: 2, equilibrado: 4, calidad: 9 }[profile];
  const preferred = `qwen3.5:${target}b`;
  const sortChat = (a: (typeof chat)[number], b: (typeof chat)[number]) =>
    Number(b.m.name === preferred) - Number(a.m.name === preferred) ||
    Math.abs(a.p - target) - Math.abs(b.p - target);
  const inRange = chat.filter((c) => c.p >= want[0] && c.p <= want[1]).sort(sortChat);
  const fallback = chat.filter((c) => c.p >= 1).sort(sortChat);
  const conv = inRange[0]?.m.name ?? fallback[0]?.m.name;
  const emb =
    installed.find(
      (m) =>
        isEmbeddingModel(m) &&
        /qwen3-embedding|bge-m3|embeddinggemma|multilingual|arctic-embed2/i.test(m.name),
    )?.name ?? installed.find((m) => isEmbeddingModel(m))?.name;
  const downloads: CatalogEntry[] = [];
  if (!conv) downloads.push(CATALOG.find((c) => c.tier === profile && c.functions.includes('conversacion'))!);
  if (!emb)
    downloads.push(
      CATALOG.find(
        (c) =>
          c.functions.includes('embeddings') && (profile === 'eficiente' ? c.tier === 'eficiente' : true),
      )!,
    );
  const fromCatalog = (f: 'conversacion' | 'embeddings') =>
    downloads.find((d) => d.functions.includes(f))?.tag;
  // Compartir el modelo evita recargas; el usuario puede asignar otro evaluador explícitamente.
  const evalModel = conv;
  return {
    assignments: {
      conversacion: conv ?? fromCatalog('conversacion'),
      evaluacion: evalModel ?? fromCatalog('conversacion'),
      embeddings: emb ?? fromCatalog('embeddings'),
    },
    downloads,
  };
}
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',')} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

import whisperTiny from './manifest.json';
import visionManifest from './vision-models.json';

/**
 * Modelos que Oratoria Lab descarga y administra por sí misma en CacheStorage. Cada modelo usa
 * un caché exclusivo: desinstalar borra ese caché completo y nada más.
 */
export type ManagedFile = { path: string; url: string; bytes: number | null; sha256: string | null };
export type ManagedModel = {
  id: string;
  kind: 'stt' | 'tts' | 'vision';
  name: string;
  description: string;
  language: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  revision: string;
  /** Nombre del caché exclusivo de este modelo. */
  cache: string;
  /** Carpeta lógica bajo `models/` usada como clave en el caché. */
  dir: string;
  files: ManagedFile[];
  approxBytes: number;
  ram: string;
  quality: string;
  /** Huella fijada en el código (true) o registrada al instalar (false). */
  pinned: boolean;
  /** Datos propios del motor: género de la voz, hablante, etc. */
  meta?: Record<string, string | number>;
};

const hf = (repo: string, rev: string, path: string) =>
  `https://huggingface.co/${repo}/resolve/${rev}/${path}`;
const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
function whisper(
  id: string,
  repo: string,
  rev: string,
  approx: number,
  ram: string,
  quality: string,
  name: string,
): ManagedModel {
  return {
    id,
    kind: 'stt',
    name,
    description: 'Transcribe tu voz en este equipo. No envía audio a ningún servicio.',
    language: 'Multilingüe, incluye español',
    license: 'MIT (pesos originales de OpenAI Whisper)',
    licenseUrl: 'https://github.com/openai/whisper/blob/main/LICENSE',
    sourceUrl: `https://huggingface.co/${repo}/tree/${rev}`,
    revision: rev,
    cache: `oratoria-model-${id}-${rev.slice(0, 8)}`,
    dir: id,
    files: WHISPER_FILES.map((path) => ({ path, url: hf(repo, rev, path), bytes: null, sha256: null })),
    approxBytes: approx,
    ram,
    quality,
    pinned: false,
  };
}
const PIPER_REPO = 'rhasspy/piper-voices';
const PIPER_REV = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
function piper(
  key: string,
  path: string,
  approx: number,
  meta: Record<string, string | number>,
  description: string,
): ManagedModel {
  return {
    id: `piper-${key}`,
    kind: 'tts',
    name: `Voz ${meta.label}`,
    description,
    language: String(meta.locale),
    license: 'Ver la tarjeta del modelo (MODEL_CARD) en el repositorio de Piper',
    licenseUrl: `https://huggingface.co/${PIPER_REPO}/blob/${PIPER_REV}/${path.replace(/[^/]+$/, 'MODEL_CARD')}`,
    sourceUrl: `https://huggingface.co/${PIPER_REPO}/tree/${PIPER_REV}/${path.replace(/\/[^/]+$/, '')}`,
    revision: PIPER_REV,
    cache: `oratoria-model-piper-${key}`,
    dir: `piper/${key}`,
    files: [
      { path: 'model.onnx', url: hf(PIPER_REPO, PIPER_REV, path), bytes: null, sha256: null },
      { path: 'model.onnx.json', url: hf(PIPER_REPO, PIPER_REV, `${path}.json`), bytes: null, sha256: null },
    ],
    approxBytes: approx,
    ram: '150–300 MB por voz cargada',
    quality:
      'Voz neuronal local (Piper/VITS). Más natural que la mayoría de las voces del sistema; no cambia de emoción.',
    pinned: false,
    meta,
  };
}

const tiny: ManagedModel = {
  id: 'whisper-tiny',
  kind: 'stt',
  name: whisperTiny.name,
  description:
    'Transcribe tu voz en este equipo. Rápido, pero se equivoca más con nombres y términos técnicos.',
  language: 'Multilingüe, incluye español',
  license: whisperTiny.license,
  licenseUrl: whisperTiny.licenseUrl,
  sourceUrl: whisperTiny.sourceUrl,
  revision: whisperTiny.revision,
  cache: `oratoria-whisper-${whisperTiny.revision}`,
  dir: 'whisper-tiny',
  files: whisperTiny.files,
  approxBytes: whisperTiny.totalBytes,
  ram: whisperTiny.estimatedRam,
  quality: 'Básica. Útil para equipos lentos.',
  pinned: true,
};

export const VISION_MODEL: ManagedModel = {
  id: 'vision',
  kind: 'vision',
  name: 'MediaPipe: rostro y postura',
  description:
    'Mide mirada, gestos, manos en la cara y postura. La imagen se analiza en tu equipo y nunca se envía.',
  language: 'No aplica',
  license: visionManifest.license,
  licenseUrl: visionManifest.licenseUrl,
  sourceUrl: visionManifest.sourceUrl,
  revision: visionManifest.runtime,
  cache: 'oratoria-vision-v1',
  dir: 'vision',
  files: visionManifest.models.map((v) => ({
    path: `${v.id}.task`,
    url: v.url,
    bytes: v.bytes,
    sha256: v.sha256,
  })),
  approxBytes: visionManifest.models.reduce((n, v) => n + (v.bytes ?? v.approxBytes), 0),
  ram: '150–300 MB',
  quality:
    'Detecta orientación de cabeza y ojos, manos y hombros. No identifica personas ni infiere emociones.',
  pinned: visionManifest.models.every((v) => !!v.sha256),
};

export const MANAGED: ManagedModel[] = [
  tiny,
  whisper(
    'whisper-base',
    'onnx-community/whisper-base',
    '1846881b6b3a3024392c1eea3ad983695bc23925',
    80e6,
    '0,8–1,5 GB (estimación)',
    'Mejor que Tiny en español; buen equilibrio para transcribir cada respuesta.',
    'Whisper Base multilingüe · Q8',
  ),
  whisper(
    'whisper-small',
    'onnx-community/whisper-small',
    '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    252e6,
    '1,5–3 GB (estimación)',
    'La mejor calidad local en navegador de esta lista; más lenta en CPU.',
    'Whisper Small multilingüe · Q8',
  ),
  piper(
    'es_MX-claude-high',
    'es/es_MX/claude/high/es_MX-claude-high.onnx',
    63.1e6,
    { label: 'masculina (México, alta calidad)', locale: 'es-MX', gender: 'm', speaker: 0 },
    'Voz masculina con acento mexicano, calidad alta.',
  ),
  piper(
    'es_MX-ald-medium',
    'es/es_MX/ald/medium/es_MX-ald-medium.onnx',
    63e6,
    { label: 'masculina (México)', locale: 'es-MX', gender: 'm', speaker: 0 },
    'Voz masculina con acento mexicano.',
  ),
  piper(
    'es_AR-daniela-high',
    'es/es_AR/daniela/high/es_AR-daniela-high.onnx',
    110e6,
    { label: 'femenina (Argentina, alta calidad)', locale: 'es-AR', gender: 'f', speaker: 0 },
    'Voz femenina con acento rioplatense, calidad alta.',
  ),
  piper(
    'es_ES-sharvard-medium',
    'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx',
    77e6,
    { label: 'femenina y masculina (España)', locale: 'es-ES', gender: 'fm', speaker: 0 },
    'Modelo con dos hablantes (femenino y masculino) con acento de España.',
  ),
  piper(
    'es_ES-davefx-medium',
    'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
    63e6,
    { label: 'masculina (España)', locale: 'es-ES', gender: 'm', speaker: 0 },
    'Voz masculina con acento de España.',
  ),
  VISION_MODEL,
];
export const managed = (id: string) => MANAGED.find((m) => m.id === id);

export type ManagedProgress = { received: number; total: number; file: string; phase: 'download' | 'verify' };
export const managedKey = (m: ManagedModel, path: string, base: string) =>
  new URL(`${base}models/${m.dir}/${path}`, location.origin).href;

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

export type ManagedStatus = {
  installed: boolean;
  partial: boolean;
  bytes: number;
  prints: Record<string, string>;
};
/** Estado real del caché: archivos presentes y bytes que ocupan. */
export async function managedStatus(m: ManagedModel, base: string): Promise<ManagedStatus> {
  if (typeof caches === 'undefined') return { installed: false, partial: false, bytes: 0, prints: {} };
  if (!(await caches.has(m.cache))) return { installed: false, partial: false, bytes: 0, prints: {} };
  const cache = await caches.open(m.cache);
  let present = 0,
    bytes = 0;
  const prints: Record<string, string> = {};
  for (const f of m.files) {
    const hit = await cache.match(managedKey(m, f.path, base));
    if (!hit) continue;
    present++;
    prints[f.path] = hit.headers.get('X-Oratoria-SHA256') ?? '';
    bytes += Number(hit.headers.get('X-Oratoria-Bytes') ?? 0) || (await hit.clone().blob()).size;
  }
  return {
    installed: present === m.files.length,
    partial: present > 0 && present < m.files.length,
    bytes,
    prints,
  };
}

/**
 * Descarga y guarda cada archivo con su huella SHA-256. Si el código fija tamaño o huella, se
 * exige que coincidan; si no, se registra la huella al instalar y se comprueba en cada uso.
 * Reutiliza archivos ya verificados para no descargarlos otra vez.
 */
export async function installManaged(
  m: ManagedModel,
  base: string,
  signal: AbortSignal,
  onProgress: (p: ManagedProgress) => void,
  fetcher: typeof fetch = (...a) => fetch(...a),
) {
  const cache = await caches.open(m.cache);
  const total = m.files.reduce((n, f) => n + (f.bytes ?? 0), 0) || m.approxBytes;
  let received = 0;
  for (const file of m.files) {
    signal.throwIfAborted();
    const key = managedKey(m, file.path, base);
    const existing = await cache.match(key);
    if (existing) {
      const bytes = await existing.arrayBuffer();
      const print = await sha256(bytes);
      if (print === (file.sha256 ?? existing.headers.get('X-Oratoria-SHA256'))) {
        received += bytes.byteLength;
        onProgress({ received, total, file: file.path, phase: 'verify' });
        continue;
      }
    }
    const response = await fetcher(file.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body)
      throw new Error(`No se pudo descargar ${file.path} (${response.status}).`);
    const reader = response.body.getReader(),
      parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if ((file.bytes !== null && size > file.bytes) || size > 600e6)
          throw new Error(`${file.path} es más grande de lo esperado.`);
        parts.push(new Uint8Array(value));
        onProgress({ received: received + size, total, file: file.path, phase: 'download' });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    signal.throwIfAborted();
    const bytes = await new Blob(parts).arrayBuffer();
    const print = await sha256(bytes);
    if ((file.bytes !== null && size !== file.bytes) || (file.sha256 !== null && print !== file.sha256))
      throw new Error(`La integridad SHA-256 de ${file.path} no coincide con la versión fijada.`);
    await cache.put(
      key,
      new Response(bytes, {
        headers: {
          'Content-Type': file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          'X-Oratoria-SHA256': print,
          'X-Oratoria-Bytes': String(bytes.byteLength),
        },
      }),
    );
    received += size;
  }
}
/** Comprueba la huella de cada archivo. */
export async function verifyManaged(
  m: ManagedModel,
  base: string,
  onProgress?: (p: ManagedProgress) => void,
) {
  const cache = await caches.open(m.cache);
  let received = 0;
  for (const f of m.files) {
    const hit = await cache.match(managedKey(m, f.path, base));
    if (!hit) return false;
    const bytes = await hit.arrayBuffer();
    const expected = f.sha256 ?? hit.headers.get('X-Oratoria-SHA256');
    if ((f.bytes !== null && bytes.byteLength !== f.bytes) || (await sha256(bytes)) !== expected)
      return false;
    received += bytes.byteLength;
    onProgress?.({ received, total: m.approxBytes, file: f.path, phase: 'verify' });
  }
  return true;
}
/** Lee un archivo verificado del caché; falla si falta o si su huella cambió. */
export async function readManaged(m: ManagedModel, path: string, base: string): Promise<ArrayBuffer> {
  const f = m.files.find((x) => x.path === path);
  if (!f) throw new Error(`El modelo ${m.name} no tiene el archivo ${path}.`);
  const hit = await (await caches.open(m.cache)).match(managedKey(m, path, base));
  if (!hit) throw new Error(`Falta ${m.name}. Instálalo en Configuración → Modelos de IA.`);
  const bytes = await hit.arrayBuffer();
  if ((await sha256(bytes)) !== (f.sha256 ?? hit.headers.get('X-Oratoria-SHA256')))
    throw new Error(`${m.name} está dañado. Desinstálalo y vuelve a instalarlo.`);
  return bytes;
}
/**
 * Desinstalación real: borra el caché exclusivo del modelo y comprueba que ya no existe.
 * Devuelve los bytes que ocupaban sus archivos.
 */
export async function removeManaged(m: ManagedModel, base: string): Promise<{ freedBytes: number }> {
  const { bytes } = await managedStatus(m, base);
  await caches.delete(m.cache);
  if (await caches.has(m.cache)) throw new Error('El navegador no eliminó el caché del modelo.');
  return { freedBytes: bytes };
}

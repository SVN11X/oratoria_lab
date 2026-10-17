import { classifyFace, classifyPose, headAngles, type Point } from '@oratoria/defense';
import manifest from './vision-models.json';
import { basePath } from '../services';

export const VISION = manifest;
export const VISION_CACHE = 'oratoria-vision-v1';
const MAX_BYTES = 40 * 1024 * 1024;
const key = (id: string) => new URL(`${basePath}models/vision/${id}.task`, location.origin).href;
export type VisionProgress = { received: number; total: number; file: string };
export type VisionFrame = {
  face: boolean;
  contact: boolean;
  down: boolean;
  smile: boolean;
  pose: boolean;
  handsVisible: boolean;
  handsMoving: boolean;
  touchFace: boolean;
  tilt: number | null;
  midX: number | null;
  shoulderW: number | null;
};
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}
/** Huella registrada al instalar. Si el manifiesto tiene hash fijado, debe coincidir con él. */
export async function visionStatus(): Promise<{ installed: boolean; prints: Record<string, string> }> {
  if (typeof caches === 'undefined') return { installed: false, prints: {} };
  try {
    const cache = await caches.open(VISION_CACHE),
      prints: Record<string, string> = {};
    for (const m of manifest.models) {
      const hit = await cache.match(key(m.id));
      if (!hit) return { installed: false, prints };
      prints[m.id] = hit.headers.get('X-Oratoria-SHA256') ?? '';
    }
    return { installed: true, prints };
  } catch {
    return { installed: false, prints: {} };
  }
}
export async function removeVision() {
  await caches.delete(VISION_CACHE);
}
export async function installVision(signal: AbortSignal, onProgress: (p: VisionProgress) => void) {
  const cache = await caches.open(VISION_CACHE);
  const total = manifest.models.reduce((n, m) => n + (m.bytes ?? m.approxBytes), 0);
  let received = 0;
  for (const model of manifest.models) {
    signal.throwIfAborted();
    const response = await fetch(model.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body)
      throw new Error(`No se pudo descargar ${model.name} (${response.status}).`);
    const reader = response.body.getReader(),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if (size > MAX_BYTES || (model.bytes !== null && size > model.bytes))
          throw new Error('El archivo descargado es más grande de lo esperado.');
        chunks.push(new Uint8Array(value));
        onProgress({ received: received + size, total, file: model.name });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    signal.throwIfAborted();
    const bytes = await new Blob(chunks).arrayBuffer(),
      print = await sha256(bytes);
    if ((model.bytes !== null && size !== model.bytes) || (model.sha256 !== null && print !== model.sha256))
      throw new Error(`La integridad SHA-256 de ${model.name} no coincide con la versión fijada.`);
    await cache.put(
      key(model.id),
      new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream', 'X-Oratoria-SHA256': print },
      }),
    );
    received += size;
  }
}
async function readModel(id: string, expected: string | null): Promise<Uint8Array> {
  const cache = await caches.open(VISION_CACHE),
    hit = await cache.match(key(id));
  if (!hit) throw new Error('Faltan los modelos de cámara. Descárgalos en Modelos locales.');
  const bytes = await hit.arrayBuffer(),
    print = await sha256(bytes);
  if (print !== (expected ?? hit.headers.get('X-Oratoria-SHA256')))
    throw new Error('Los modelos de cámara están dañados. Elimínalos y descárgalos de nuevo.');
  return new Uint8Array(bytes);
}
export type VisionAnalyzer = { analyze: (video: HTMLVideoElement) => VisionFrame | null; close: () => void };
export async function createVision(): Promise<VisionAnalyzer> {
  const [faceModel, poseModel] = manifest.models;
  const face = await readModel('face', faceModel!.sha256),
    pose = await readModel('pose', poseModel!.sha256);
  const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${basePath}mediapipe`);
  const make = (delegate: 'GPU' | 'CPU') =>
    Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: face.slice(), delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: pose.slice(), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    ]);
  let tasks: Awaited<ReturnType<typeof make>>;
  try {
    tasks = await make('GPU');
  } catch {
    tasks = await make('CPU');
  }
  const [faceTask, poseTask] = tasks;
  let last = 0,
    wrists: { l: Point | null; r: Point | null } | null = null;
  return {
    analyze(video) {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const ts = Math.max(last + 1, Math.round(performance.now()));
      last = ts;
      const f = faceTask.detectForVideo(video, ts),
        p = poseTask.detectForVideo(video, ts);
      const blend: Record<string, number> = {};
      for (const c of f.faceBlendshapes[0]?.categories ?? []) blend[c.categoryName] = c.score;
      const matrix = f.facialTransformationMatrixes[0]?.data;
      const faceSeen = (f.faceLandmarks[0]?.length ?? 0) > 0;
      const fs = faceSeen && matrix ? classifyFace(blend, headAngles(matrix)) : null;
      const ps = p.landmarks[0] ? classifyPose(p.landmarks[0], wrists) : null;
      wrists = ps?.wrists ?? null;
      return {
        face: faceSeen,
        contact: !!fs?.contact,
        down: !!fs?.down,
        smile: !!fs?.smile,
        pose: !!ps,
        handsVisible: !!ps?.handsVisible,
        handsMoving: !!ps?.handsMoving,
        touchFace: !!ps?.touchFace,
        tilt: ps?.tilt ?? null,
        midX: ps?.midX ?? null,
        shoulderW: ps?.shoulderW ?? null,
      };
    },
    close() {
      faceTask.close();
      poseTask.close();
    },
  };
}

/** Geometría y reglas para la cámara. No identifica personas ni infiere emociones. */
export type Point = { x: number; y: number; z?: number; visibility?: number };
export type FaceSignal = { contact: boolean; down: boolean; smile: boolean; yaw: number; pitch: number };
export type PoseSignal = {
  handsVisible: boolean;
  handsMoving: boolean;
  touchFace: boolean;
  tilt: number;
  midX: number;
  shoulderW: number;
  wrists: { l: Point | null; r: Point | null };
};
const deg = (r: number) => (r * 180) / Math.PI;
/**
 * Ángulos de la cabeza a partir de la matriz 4×4 de MediaPipe (orden por columnas).
 * Solo se usan magnitudes, así que el signo de cada eje no cambia las reglas.
 */
export function headAngles(m: number[]): { yaw: number; pitch: number; roll: number } {
  const at = (i: number) => m[i] ?? 0;
  return {
    yaw: deg(Math.atan2(at(8), at(10))),
    pitch: deg(Math.asin(Math.max(-1, Math.min(1, -at(9))))),
    roll: deg(Math.atan2(at(1), at(0))),
  };
}
/**
 * «Contacto» significa rostro orientado hacia la pantalla donde está la comisión y ojos sin
 * desviarse mucho. Es una aproximación: no mide hacia dónde mira exactamente la pupila.
 */
export function classifyFace(
  blend: Record<string, number>,
  angles: { yaw: number; pitch: number },
): FaceSignal {
  const b = (k: string) => blend[k] ?? 0;
  const sideways = Math.max(
    b('eyeLookOutLeft'),
    b('eyeLookOutRight'),
    b('eyeLookInLeft'),
    b('eyeLookInRight'),
  );
  const down = (b('eyeLookDownLeft') + b('eyeLookDownRight')) / 2 > 0.55;
  const contact = Math.abs(angles.yaw) < 22 && Math.abs(angles.pitch) < 22 && sideways < 0.6 && !down;
  return {
    contact,
    down,
    smile: (b('mouthSmileLeft') + b('mouthSmileRight')) / 2 > 0.45,
    yaw: angles.yaw,
    pitch: angles.pitch,
  };
}
const visible = (p: Point | undefined, min = 0.5): p is Point =>
  !!p && (p.visibility ?? 1) >= min && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
/** Usa hombros (11, 12), nariz (0) y muñecas (15, 16) del modelo de pose de MediaPipe. */
export function classifyPose(
  landmarks: Point[],
  previous: { l: Point | null; r: Point | null } | null,
): PoseSignal | null {
  const ls = landmarks[11],
    rs = landmarks[12],
    nose = landmarks[0];
  if (!visible(ls) || !visible(rs)) return null;
  const dx = rs.x - ls.x,
    dy = rs.y - ls.y,
    shoulderW = Math.hypot(dx, dy);
  if (shoulderW < 0.02) return null;
  const tilt = Math.abs(deg(Math.atan2(dy, Math.abs(dx))));
  const lw = visible(landmarks[15]) ? landmarks[15]! : null,
    rw = visible(landmarks[16]) ? landmarks[16]! : null;
  const moved = (now: Point | null, before: Point | null | undefined) =>
    !!now && !!before && Math.hypot(now.x - before.x, now.y - before.y) / shoulderW > 0.05;
  const nearFace = (w: Point | null) =>
    !!w && visible(nose) && Math.hypot(w.x - nose.x, w.y - nose.y) / shoulderW < 0.5;
  return {
    handsVisible: !!(lw || rw),
    handsMoving: moved(lw, previous?.l) || moved(rw, previous?.r),
    touchFace: nearFace(lw) || nearFace(rw),
    tilt,
    midX: (ls.x + rs.x) / 2,
    shoulderW,
    wrists: { l: lw, r: rw },
  };
}
/**
 * Atención simulada del público (0–100). Sube con voz continua y contacto; baja con silencios
 * largos, mirada fuera de la comisión, muletillas seguidas o un ritmo extremo.
 * Es un recurso de práctica, no una medición del público real.
 */
export function nextAttention(
  previous: number,
  s: {
    speaking: number;
    silenceSeconds: number;
    contact: number | null;
    fillersRecent: number;
    wpm: number | null;
  },
): number {
  let delta = (70 - previous) * 0.02;
  if (s.speaking > 0.3) delta += 0.8;
  if (s.silenceSeconds > 4) delta -= Math.min(4, s.silenceSeconds - 3);
  if (s.contact !== null) delta += s.contact > 0.6 ? 1.2 : s.contact < 0.3 ? -3 : -0.5;
  if (s.fillersRecent >= 2) delta -= 1.5 * (s.fillersRecent - 1);
  if (s.wpm !== null && (s.wpm > 185 || s.wpm < 85)) delta -= 1;
  return Math.max(0, Math.min(100, previous + delta));
}

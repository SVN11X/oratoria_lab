import { forwardRef, memo, useEffect, useId, useImperativeHandle, useRef } from 'react';
import type { AnswerType, AvatarLook, Temperament } from '@oratoria/conversation';
import type { Mouth } from '../voice/visemes';

/**
 * Persona ilustrada y animada en SVG. Se dibuja una vez con React y se anima directamente sobre
 * el DOM (sin rerenders) para mantener 60 fps en equipos modestos. No es una figura 3D: es una
 * ilustración vectorial con animación procedural de cabeza, ojos, cejas, boca, manos y torso.
 */
export type AvatarMode = 'idle' | 'listening' | 'speaking' | 'thinking' | 'writing';
export type Gesture = 'rest' | 'write' | 'chin' | 'raise' | 'cross' | 'open';
export type AvatarHandle = {
  setMouth: (m: Mouth) => void;
  setMode: (mode: AvatarMode, lookAt?: number) => void;
  react: (type: AnswerType) => void;
  raiseHand: (on: boolean) => void;
};

const SKIN = ['#f5d6c0', '#ebc3a4', '#d9a682', '#be8762', '#9a6646', '#704530'];
const HAIR = ['#211812', '#3a291d', '#5b3d27', '#8b6a47', '#b9925f', '#c9c9c9'];
const IRIS = ['#5a3b24', '#3e2b1b', '#5f7f4f', '#4c6d8f', '#73583b'];
const CLOTH = ['#2b3a67', '#3c4656', '#5b3a52', '#2e5e57', '#6a4f2e', '#4a3f6b', '#1f2937', '#7a3b3b'];
const SHIRT = ['#f4f6fb', '#dfe7f5', '#f3ece2', '#e8eef0'];
const TIE = ['#8b2f3c', '#2f4f8b', '#3f6b4b', '#6b4f8b'];

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c * amount : (255 - c) * amount))));
  const r = f(n >> 16),
    g = f((n >> 8) & 255),
    b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

type Expression = { brow: number; browAsym: number; smile: number; eye: number; tilt: number; lean: number };
const BASE: Record<Temperament, Expression> = {
  amable: { brow: 0.18, browAsym: 0, smile: 0.4, eye: 1, tilt: 2, lean: 0 },
  cordial: { brow: 0.08, browAsym: 0, smile: 0.22, eye: 1, tilt: 0, lean: 0 },
  serio: { brow: -0.05, browAsym: 0, smile: 0, eye: 0.95, tilt: 0, lean: 0 },
  esceptico: { brow: 0, browAsym: 0.45, smile: -0.05, eye: 0.82, tilt: 5, lean: -1 },
  exigente: { brow: -0.28, browAsym: 0, smile: -0.08, eye: 0.9, tilt: 0, lean: 1 },
  desafiante: { brow: -0.38, browAsym: 0.1, smile: -0.12, eye: 0.88, tilt: -2, lean: -2 },
};
const LISTEN_GESTURE: Record<Temperament, Gesture> = {
  amable: 'rest',
  cordial: 'rest',
  serio: 'rest',
  esceptico: 'chin',
  exigente: 'write',
  desafiante: 'cross',
};

/** Reloj compartido: un solo requestAnimationFrame para todos los avatares visibles. */
const rigs = new Set<Rig>();
let rafId = 0;
function tick(now: number) {
  for (const r of rigs) r.frame(now);
  rafId = rigs.size ? requestAnimationFrame(tick) : 0;
}
const reduced = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

class Rig {
  mode: AvatarMode = 'idle';
  lookAt = 0;
  mouth: Mouth = { open: 0, wide: 0.5, round: 0 };
  private shown: Mouth = { open: 0, wide: 0.5, round: 0 };
  private expr: Expression;
  private target: Expression;
  private reaction: { until: number; expr: Partial<Expression>; nod: number; shake: number } | null = null;
  private nextBlink = 0;
  private blinkUntil = 0;
  private gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
  private gesture: Gesture = 'rest';
  private forced: Gesture | null = null;
  private seed: number;
  constructor(
    private el: Record<string, SVGElement | null>,
    private temperament: Temperament,
    seed: number,
    private mouthGeom: { cx: number; cy: number },
  ) {
    this.seed = seed;
    this.expr = { ...BASE[temperament] };
    this.target = { ...BASE[temperament] };
    this.applyGesture('rest');
  }
  setTemperament(t: Temperament) {
    this.temperament = t;
    this.target = { ...BASE[t] };
  }
  setMode(mode: AvatarMode, lookAt = 0) {
    this.mode = mode;
    this.lookAt = lookAt;
  }
  react(type: AnswerType, now = performance.now()) {
    const good = type === 'correcta' || type === 'reconoce_limitacion';
    const bad = type === 'evade' || type === 'sin_sustento' || type === 'contradice_documento';
    const t = this.temperament;
    this.reaction = {
      until: now + 1800,
      expr: good
        ? { smile: t === 'serio' || t === 'desafiante' ? 0.1 : 0.55, brow: 0.2 }
        : bad
          ? t === 'esceptico'
            ? { browAsym: 0.8, eye: 0.75 }
            : t === 'amable' || t === 'cordial'
              ? { brow: 0.3, smile: 0.05 }
              : { brow: -0.6, smile: -0.2 }
          : { brow: 0.25, browAsym: 0.3, tilt: 7 },
      nod: good ? 1 : 0,
      shake: bad && (t === 'desafiante' || t === 'exigente') ? 1 : 0,
    };
  }
  raiseHand(on: boolean) {
    this.forced = on ? 'raise' : null;
  }
  private applyGesture(g: Gesture) {
    if (g === this.gesture && this.el[`g-${g}`]?.getAttribute('display') !== 'none') return;
    this.gesture = g;
    for (const k of ['rest', 'write', 'chin', 'raise', 'cross', 'open'] as Gesture[])
      this.el[`g-${k}`]?.setAttribute('display', k === g ? 'inline' : 'none');
  }
  frame(now: number) {
    const still = reduced();
    const t = now / 1000 + this.seed * 3.7;
    // Expresión: base del temperamento, modulada por el modo y la reacción en curso.
    const base = { ...BASE[this.temperament] };
    if (this.mode === 'speaking') base.brow += 0.12 + Math.sin(t * 2.3) * 0.08 * (still ? 0 : 1);
    if (this.mode === 'thinking') base.brow -= 0.1;
    const r = this.reaction && this.reaction.until > now ? this.reaction : null;
    if (!r) this.reaction = null;
    Object.assign(this.target, base, r?.expr ?? {});
    const k = still ? 1 : 0.12;
    for (const key of Object.keys(this.expr) as (keyof Expression)[])
      this.expr[key] += (this.target[key] - this.expr[key]) * k;
    // Gestos: hablar con manos abiertas; escuchar según temperamento; pensar tomando notas.
    const g: Gesture =
      this.forced ??
      (this.mode === 'speaking'
        ? Math.sin(t * 0.7 + this.seed) > -0.2
          ? 'open'
          : 'rest'
        : this.mode === 'thinking' || this.mode === 'writing'
          ? 'write'
          : this.mode === 'listening'
            ? Math.sin(t * 0.13 + this.seed) > -0.35
              ? LISTEN_GESTURE[this.temperament]
              : this.temperament === 'exigente'
                ? 'rest'
                : 'write'
            : 'rest');
    this.applyGesture(g);
    // Parpadeo cada 2–6 s.
    if (now > this.nextBlink) {
      this.blinkUntil = now + 130;
      this.nextBlink = now + 2000 + ((Math.sin(t * 13.1) + 1) / 2) * 4000;
    }
    const blink = !still && now < this.blinkUntil ? 0.08 : 1;
    // Mirada: hacia la persona o hacia quien habla, con microsacadas.
    if (now > this.gaze.next) {
      const down = this.mode === 'writing' || (this.mode === 'thinking' && Math.sin(t) > 0) || g === 'write';
      this.gaze.tx = this.lookAt * 3.2 + (still ? 0 : Math.sin(t * 5.3) * 0.8);
      this.gaze.ty = down ? 2.6 : still ? 0 : Math.cos(t * 4.1) * 0.5;
      this.gaze.next = now + 700 + ((Math.cos(t * 7.7) + 1) / 2) * 2200;
    }
    this.gaze.x += (this.gaze.tx - this.gaze.x) * 0.25;
    this.gaze.y += (this.gaze.ty - this.gaze.y) * 0.25;
    // Cabeza: respiración, giro hacia quien habla, asentir o negar.
    let nod = 0,
      shake = 0;
    if (r) {
      const p = 1 - (r.until - now) / 1800;
      nod = r.nod * Math.sin(p * Math.PI * 4) * 3 * (1 - p);
      shake = r.shake * Math.sin(p * Math.PI * 5) * 4 * (1 - p);
    }
    const sway = still ? 0 : Math.sin(t * 0.6) * 1.2 + Math.sin(t * 1.7) * 0.4;
    const speakBob = this.mode === 'speaking' && !still ? Math.sin(t * 6) * 0.6 * this.shown.open : 0;
    const yaw = this.lookAt * 5 + shake;
    const tilt = this.expr.tilt + sway * 0.6;
    const headY = (this.mode === 'writing' || g === 'write' ? 3 : 0) + nod + speakBob + this.expr.lean * 0.3;
    this.el.head?.setAttribute('transform', `translate(${yaw * 0.6} ${headY}) rotate(${tilt} 120 150)`);
    this.el.features?.setAttribute(
      'transform',
      `translate(${yaw * 0.9} ${(g === 'write' ? 1.5 : 0) + nod * 0.4})`,
    );
    const breath = still ? 1 : 1 + Math.sin(t * 1.6) * 0.008;
    this.el.torso?.setAttribute('transform', `translate(${this.expr.lean * 0.8} 0) scale(1 ${breath})`);
    // Ojos y cejas.
    const eyeOpen = Math.max(0.06, Math.min(1.15, this.expr.eye * blink));
    for (const side of ['l', 'r']) {
      this.el[`lid-${side}`]?.setAttribute(
        'transform',
        `translate(0 ${side === 'l' ? 0 : 0}) scale(1 ${eyeOpen})`,
      );
      this.el[`iris-${side}`]?.setAttribute('transform', `translate(${this.gaze.x} ${this.gaze.y})`);
    }
    const b = this.expr.brow * 4,
      asym = this.expr.browAsym * 4;
    this.el['brow-l']?.setAttribute(
      'transform',
      `translate(0 ${-b}) rotate(${this.expr.brow < 0 ? 8 * -this.expr.brow : -3 * this.expr.brow} 104 86)`,
    );
    this.el['brow-r']?.setAttribute(
      'transform',
      `translate(0 ${-b - asym}) rotate(${this.expr.brow < 0 ? -8 * -this.expr.brow : 3 * this.expr.brow} 136 86)`,
    );
    // Boca: interpolación hacia el visema actual.
    const m = this.mode === 'speaking' ? this.mouth : { open: 0, wide: 0.5, round: 0 };
    const mk = still ? 1 : 0.45;
    this.shown = {
      open: this.shown.open + (m.open - this.shown.open) * mk,
      wide: this.shown.wide + (m.wide - this.shown.wide) * mk,
      round: this.shown.round + (m.round - this.shown.round) * mk,
    };
    this.drawMouth();
    // Mano que escribe.
    if (g === 'write' && !still)
      this.el['pen']?.setAttribute(
        'transform',
        `translate(${Math.sin(t * 9) * 2} ${Math.cos(t * 11) * 1.2})`,
      );
    if (g === 'open' && !still)
      this.el['g-open']?.setAttribute('transform', `translate(0 ${Math.sin(t * 3.1) * 2.5})`);
  }
  private drawMouth() {
    const { cx, cy } = this.mouthGeom;
    const o = this.shown.open,
      round = this.shown.round,
      smile = this.expr.smile;
    const half = 9 + this.shown.wide * 6 - round * 5;
    const corner = -smile * 3.2;
    const openH = o * 11;
    const upper = `M ${cx - half} ${cy + corner} Q ${cx - half * 0.5} ${cy - 2.6 - round} ${cx} ${cy - 1.6} Q ${cx + half * 0.5} ${cy - 2.6 - round} ${cx + half} ${cy + corner}`;
    const lowerY = cy + 2.2 + openH;
    const lips = `${upper} Q ${cx} ${lowerY + 3.6 + smile * 2} ${cx - half} ${cy + corner} Z`;
    this.el.lips?.setAttribute('d', lips);
    const inner =
      o > 0.04
        ? `M ${cx - half * 0.8} ${cy + corner * 0.6 + 0.4} Q ${cx} ${cy - 0.6} ${cx + half * 0.8} ${cy + corner * 0.6 + 0.4} Q ${cx} ${lowerY + 1.2} ${cx - half * 0.8} ${cy + corner * 0.6 + 0.4} Z`
        : '';
    this.el.inner?.setAttribute('d', inner);
    this.el.teeth?.setAttribute(
      'd',
      o > 0.22
        ? `M ${cx - half * 0.62} ${cy + 0.3} Q ${cx} ${cy - 0.9} ${cx + half * 0.62} ${cy + 0.3} L ${cx + half * 0.55} ${cy + 2.4} Q ${cx} ${cy + 1.6} ${cx - half * 0.55} ${cy + 2.4} Z`
        : '',
    );
  }
}

type Props = {
  look: AvatarLook;
  temperament: Temperament;
  seed: number;
  label: string;
  className?: string;
};

export const Avatar = memo(
  forwardRef<AvatarHandle, Props>(function Avatar({ look, temperament, seed, label, className }, ref) {
    const uid = useId().replace(/:/g, '');
    const refs = useRef<Record<string, SVGElement | null>>({});
    const rig = useRef<Rig | null>(null);
    const set = (k: string) => (node: SVGElement | null) => {
      refs.current[k] = node;
    };
    useEffect(() => {
      const r = new Rig(refs.current, temperament, seed, { cx: 120, cy: 133 });
      rig.current = r;
      rigs.add(r);
      if (!rafId) rafId = requestAnimationFrame(tick);
      return () => {
        rigs.delete(r);
        rig.current = null;
      };
      // El rig se crea una vez; el temperamento se actualiza abajo.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => rig.current?.setTemperament(temperament), [temperament]);
    useImperativeHandle(ref, () => ({
      setMouth: (m) => {
        if (rig.current) rig.current.mouth = m;
      },
      setMode: (mode, lookAt) => rig.current?.setMode(mode, lookAt),
      react: (type) => rig.current?.react(type),
      raiseHand: (on) => rig.current?.raiseHand(on),
    }));
    const skin = SKIN[look.skin % SKIN.length]!,
      skinD = shade(skin, -0.16),
      skinDD = shade(skin, -0.3),
      hair = HAIR[look.hairStyle === 'canoso' ? 5 : look.hair % HAIR.length]!,
      hairD = shade(hair, -0.25),
      hairL = shade(hair, 0.25),
      cloth = CLOTH[look.accent % CLOTH.length]!,
      clothD = shade(cloth, -0.25),
      clothL = shade(cloth, 0.12),
      shirt = SHIRT[(look.accent + seed) % SHIRT.length]!,
      tie = TIE[(look.accent + 1) % TIE.length]!,
      iris = IRIS[(look.skin + seed) % IRIS.length]!,
      lip = shade(skin, look.gender === 'f' ? -0.28 : -0.2);
    const older = look.age === 'mayor';
    const f = look.gender === 'f';
    const id = (s: string) => `${uid}-${s}`;
    const Eye = ({ x, side }: { x: number; side: 'l' | 'r' }) => (
      <g>
        <clipPath id={id(`eye-${side}`)}>
          <path
            ref={set(`lid-${side}`)}
            d={`M ${x - 9} 101 Q ${x} 93 ${x + 9} 101 Q ${x} 107 ${x - 9} 101 Z`}
            style={{ transformOrigin: `${x}px 100px` }}
          />
        </clipPath>
        <path
          d={`M ${x - 10} 101 Q ${x} 91.5 ${x + 10} 101`}
          fill="none"
          stroke={skinDD}
          strokeOpacity={0.35}
          strokeWidth={1.4}
        />
        <g clipPath={`url(#${id(`eye-${side}`)})`}>
          <rect x={x - 10} y={92} width={20} height={16} fill="#f7f4f0" />
          <g ref={set(`iris-${side}`)}>
            <circle cx={x} cy={100.5} r={4.6} fill={`url(#${id('iris')})`} />
            <circle cx={x} cy={100.5} r={2.1} fill="#141414" />
            <circle cx={x + 1.5} cy={99} r={1.1} fill="#fff" opacity={0.9} />
          </g>
          <rect x={x - 10} y={92} width={20} height={3.5} fill={skinDD} opacity={0.18} />
        </g>
        <path
          d={`M ${x - 9.5} 101 Q ${x} 93.2 ${x + 9.5} 101`}
          fill="none"
          stroke="#2a1d17"
          strokeWidth={1.7}
          strokeLinecap="round"
        />
        {older && (
          <path
            d={`M ${x - 7} 106 Q ${x} 108.5 ${x + 7} 106`}
            fill="none"
            stroke={skinDD}
            strokeOpacity={0.35}
            strokeWidth={0.9}
          />
        )}
      </g>
    );
    return (
      <svg className={`avatar ${className ?? ''}`} viewBox="0 0 240 300" role="img" aria-label={label}>
        <defs>
          <radialGradient id={id('face')} cx="0.42" cy="0.38" r="0.75">
            <stop offset="0" stopColor={shade(skin, 0.08)} />
            <stop offset="0.7" stopColor={skin} />
            <stop offset="1" stopColor={skinD} />
          </radialGradient>
          <linearGradient id={id('hair')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={hairL} />
            <stop offset="0.55" stopColor={hair} />
            <stop offset="1" stopColor={hairD} />
          </linearGradient>
          <linearGradient id={id('cloth')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={clothL} />
            <stop offset="1" stopColor={clothD} />
          </linearGradient>
          <radialGradient id={id('iris')} cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor={shade(iris, 0.35)} />
            <stop offset="1" stopColor={shade(iris, -0.2)} />
          </radialGradient>
          <linearGradient id={id('neck')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={skinDD} />
            <stop offset="0.45" stopColor={skinD} />
          </linearGradient>
        </defs>
        {/* Cabello largo detrás */}
        {(look.hairStyle === 'largo' || (f && look.hairStyle === 'rizado')) && (
          <g ref={set('hairBack')}>
            <path
              d="M 70 92 Q 66 40 120 38 Q 174 40 170 92 L 178 196 Q 150 210 120 206 Q 90 210 62 196 Z"
              fill={`url(#${id('hair')})`}
            />
          </g>
        )}
        <g ref={set('torso')} style={{ transformOrigin: '120px 300px' }}>
          <path
            d="M 28 300 Q 30 214 70 196 Q 96 184 120 184 Q 144 184 170 196 Q 210 214 212 300 Z"
            fill={`url(#${id('cloth')})`}
          />
          {look.outfit === 'traje' && (
            <>
              <path d="M 98 188 L 120 252 L 142 188 Q 131 184 120 184 Q 109 184 98 188 Z" fill={shirt} />
              <path d="M 114 196 L 120 190 L 126 196 L 123 240 L 120 248 L 117 240 Z" fill={tie} />
              <path d="M 96 188 L 118 254 L 104 232 L 88 196 Z" fill={clothD} opacity={0.65} />
              <path d="M 144 188 L 122 254 L 136 232 L 152 196 Z" fill={clothD} opacity={0.65} />
            </>
          )}
          {look.outfit === 'camisa' && (
            <>
              <path
                d="M 28 300 Q 30 214 70 196 Q 96 184 120 184 Q 144 184 170 196 Q 210 214 212 300 Z"
                fill={shirt}
              />
              <path
                d="M 100 186 L 120 206 L 140 186 L 132 200 L 120 212 L 108 200 Z"
                fill={shade(shirt, -0.12)}
              />
              <line x1={120} y1={210} x2={120} y2={300} stroke={shade(shirt, -0.18)} strokeWidth={1.2} />
            </>
          )}
          {look.outfit === 'blusa' && (
            <path d="M 96 188 Q 120 222 144 188 Q 132 184 120 184 Q 108 184 96 188 Z" fill={skinD} />
          )}
          {look.outfit === 'sweater' && (
            <>
              <path d="M 100 186 L 120 206 L 140 186 L 134 196 L 120 210 L 106 196 Z" fill={shirt} />
              <path d="M 94 190 Q 120 214 146 190" fill="none" stroke={clothD} strokeWidth={5} />
            </>
          )}
          {look.outfit === 'chaqueta' && (
            <>
              <path d="M 100 188 Q 120 200 140 188 L 136 300 L 104 300 Z" fill={shade(cloth, 0.55)} />
              <path d="M 98 188 L 112 300 L 92 300 L 84 200 Z" fill={clothD} opacity={0.55} />
              <path d="M 142 188 L 128 300 L 148 300 L 156 200 Z" fill={clothD} opacity={0.55} />
            </>
          )}
        </g>
        <g ref={set('head')}>
          <path d="M 104 138 L 104 186 Q 120 196 136 186 L 136 138 Z" fill={`url(#${id('neck')})`} />
          <ellipse cx={81.5} cy={106} rx={7} ry={11} fill={skinD} />
          <ellipse cx={158.5} cy={106} rx={7} ry={11} fill={skinD} />
          <path
            d="M 82 100 Q 81 56 120 54 Q 159 56 158 100 Q 158 136 138 152 Q 120 163 102 152 Q 82 136 82 100 Z"
            fill={`url(#${id('face')})`}
          />
          <g ref={set('features')}>
            <ellipse cx={99} cy={121} rx={9} ry={5} fill="#e9877a" opacity={f ? 0.16 : 0.08} />
            <ellipse cx={141} cy={121} rx={9} ry={5} fill="#e9877a" opacity={f ? 0.16 : 0.08} />
            <Eye x={104} side="l" />
            <Eye x={136} side="r" />
            <path
              ref={set('brow-l')}
              d="M 94 88 Q 103 83 113 86.5"
              fill="none"
              stroke={hairD}
              strokeWidth={f ? 2.6 : 3.4}
              strokeLinecap="round"
            />
            <path
              ref={set('brow-r')}
              d="M 127 86.5 Q 137 83 146 88"
              fill="none"
              stroke={hairD}
              strokeWidth={f ? 2.6 : 3.4}
              strokeLinecap="round"
            />
            <path
              d="M 119 100 Q 116 114 112.5 120 Q 116 124 120 123.5 Q 124 124 127.5 120"
              fill="none"
              stroke={skinDD}
              strokeOpacity={0.55}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {older && (
              <>
                <path
                  d="M 104 126 Q 108 134 110 140"
                  fill="none"
                  stroke={skinDD}
                  strokeOpacity={0.3}
                  strokeWidth={1}
                />
                <path
                  d="M 136 126 Q 132 134 130 140"
                  fill="none"
                  stroke={skinDD}
                  strokeOpacity={0.3}
                  strokeWidth={1}
                />
              </>
            )}
            <path ref={set('inner')} fill="#4a1f1f" />
            <path ref={set('teeth')} fill="#f6f2ea" />
            <path ref={set('lips')} fill={lip} />
            {look.beard && (
              <path
                d="M 86 112 Q 88 146 120 160 Q 152 146 154 112 Q 150 140 138 146 Q 128 140 120 141 Q 112 140 102 146 Q 90 140 86 112 Z"
                fill={hair}
                opacity={0.88}
              />
            )}
            {look.glasses && (
              <g fill="rgb(255 255 255 / 10%)" stroke="#1f2430" strokeWidth={1.8}>
                <rect x={91} y={91} width={26} height={19} rx={6} />
                <rect x={123} y={91} width={26} height={19} rx={6} />
                <path d="M 117 99 Q 120 96.5 123 99" fill="none" />
                <path d="M 91 97 L 82 95 M 149 97 L 158 95" />
              </g>
            )}
          </g>
          {/* Cabello frontal */}
          {look.hairStyle === 'corto' || look.hairStyle === 'canoso' ? (
            <path
              d="M 80 98 Q 76 52 120 46 Q 164 52 160 98 Q 156 72 140 66 Q 122 74 98 68 Q 84 76 80 98 Z"
              fill={`url(#${id('hair')})`}
            />
          ) : look.hairStyle === 'largo' ? (
            <path
              d="M 78 104 Q 74 46 122 44 Q 168 48 162 104 Q 160 74 146 64 Q 128 70 108 62 Q 86 72 78 104 Z"
              fill={`url(#${id('hair')})`}
            />
          ) : look.hairStyle === 'recogido' ? (
            <>
              <circle cx={120} cy={42} r={17} fill={`url(#${id('hair')})`} />
              <path
                d="M 80 96 Q 78 50 120 48 Q 162 50 160 96 Q 152 66 120 62 Q 88 66 80 96 Z"
                fill={`url(#${id('hair')})`}
              />
            </>
          ) : look.hairStyle === 'calvo' ? (
            <>
              <path
                d="M 80 104 Q 80 88 86 80 L 88 98 Z M 160 104 Q 160 88 154 80 L 152 98 Z"
                fill={`url(#${id('hair')})`}
              />
              <ellipse cx={108} cy={66} rx={14} ry={6} fill="#fff" opacity={0.18} />
            </>
          ) : (
            <g fill={`url(#${id('hair')})`}>
              {[
                [86, 80],
                [96, 64],
                [110, 56],
                [126, 55],
                [140, 60],
                [152, 72],
                [158, 88],
                [82, 94],
                [102, 52],
                [118, 48],
                [134, 50],
              ].map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={11} />
              ))}
            </g>
          )}
        </g>
        {/* Manos y gestos */}
        <g ref={set('g-rest')}>
          <ellipse cx={110} cy={286} rx={16} ry={10} fill={skin} />
          <ellipse cx={130} cy={284} rx={16} ry={10} fill={skinD} />
        </g>
        <g ref={set('g-write')} display="none">
          <rect x={132} y={270} width={58} height={34} rx={3} fill="#fbfaf6" transform="rotate(-6 160 286)" />
          <path
            d="M 140 280 L 178 276 M 140 287 L 172 284 M 140 294 L 176 291"
            stroke="#b9c0d4"
            strokeWidth={1.2}
            transform="rotate(-6 160 286)"
          />
          <g ref={set('pen')}>
            <ellipse cx={156} cy={290} rx={13} ry={9} fill={skin} />
            <path d="M 152 288 L 176 268" stroke="#1f2430" strokeWidth={3} strokeLinecap="round" />
          </g>
          <ellipse cx={96} cy={288} rx={15} ry={9} fill={skinD} />
        </g>
        <g ref={set('g-chin')} display="none">
          <path
            d="M 176 300 Q 168 230 140 170"
            stroke={cloth}
            strokeWidth={20}
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx={133} cy={160} rx={11} ry={12} fill={skin} />
          <ellipse cx={100} cy={288} rx={15} ry={9} fill={skinD} />
        </g>
        <g ref={set('g-raise')} display="none">
          <path
            d="M 186 300 Q 196 240 192 160"
            stroke={cloth}
            strokeWidth={20}
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx={192} cy={150} rx={11} ry={15} fill={skin} />
          <ellipse cx={104} cy={288} rx={15} ry={9} fill={skinD} />
        </g>
        <g ref={set('g-cross')} display="none">
          <path
            d="M 64 252 Q 120 236 176 262"
            stroke={clothD}
            strokeWidth={22}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M 176 252 Q 120 238 64 264"
            stroke={cloth}
            strokeWidth={22}
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx={176} cy={258} rx={10} ry={9} fill={skin} />
          <ellipse cx={64} cy={260} rx={10} ry={9} fill={skinD} />
        </g>
        <g ref={set('g-open')} display="none">
          <path
            d="M 70 300 Q 74 280 84 270"
            stroke={cloth}
            strokeWidth={18}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M 170 300 Q 166 280 156 270"
            stroke={cloth}
            strokeWidth={18}
            strokeLinecap="round"
            fill="none"
          />
          <ellipse cx={86} cy={266} rx={13} ry={8} fill={skin} transform="rotate(-18 86 266)" />
          <ellipse cx={154} cy={266} rx={13} ry={8} fill={skin} transform="rotate(18 154 266)" />
        </g>
      </svg>
    );
  }),
);

/** Silueta simple de una persona del público, con respiración y estado de atención. */
export function AudienceMember({ index, attentive }: { index: number; attentive: boolean }) {
  const skin = SKIN[(index * 3) % SKIN.length]!,
    hair = HAIR[(index * 5) % 5]!,
    cloth = CLOTH[(index * 3) % CLOTH.length]!;
  return (
    <svg viewBox="0 0 40 48" aria-hidden="true">
      <g className="audience-person" style={{ animationDelay: `${(index * 0.41) % 3}s` }}>
        <path d="M 4 48 Q 6 32 20 30 Q 34 32 36 48 Z" fill={cloth} />
        <g transform={attentive ? '' : `rotate(${index % 2 ? 14 : -14} 20 26) translate(0 2)`}>
          <ellipse cx={20} cy={18} rx={9} ry={11} fill={skin} />
          <path d="M 11 17 Q 10 6 20 6 Q 30 6 29 17 Q 26 10 20 11 Q 14 10 11 17 Z" fill={hair} />
        </g>
      </g>
    </svg>
  );
}

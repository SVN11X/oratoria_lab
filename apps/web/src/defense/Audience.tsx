import { memo } from 'react';
import { COMMITTEE } from '@oratoria/defense';

export type PersonState = 'atento' | 'asiente' | 'mira-lado' | 'celular' | 'aburrido' | 'escribe' | 'habla';
const SKIN = ['#f1c7a5', '#d9a07a', '#b97a56', '#8d5a3b', '#e8b993', '#c68a62'];
const HAIR = ['#2b2018', '#4a3426', '#7a5232', '#1d1d22', '#a67b4f', '#5b5b5b'];
const SHIRT = ['#3f6f8f', '#7a4b6b', '#4f7a55', '#8a6a3c', '#5c5f8a', '#8f4c48', '#3d6d6a', '#6b6f75'];
const STATE_TEXT: Record<PersonState, string> = {
  atento: 'te mira',
  asiente: 'asiente',
  'mira-lado': 'mira hacia otro lado',
  celular: 'mira su celular',
  aburrido: 'parece aburrido',
  escribe: 'toma notas',
  habla: 'está hablando',
};
function Person({
  x,
  y,
  scale,
  index,
  state,
  long,
}: {
  x: number;
  y: number;
  scale: number;
  index: number;
  state: PersonState;
  long?: boolean;
}) {
  const skin = SKIN[index % SKIN.length]!,
    hair = HAIR[(index * 5) % HAIR.length]!,
    shirt = SHIRT[(index * 3) % SHIRT.length]!;
  const look =
    state === 'mira-lado'
      ? { rotate: index % 2 ? -14 : 14, dx: index % 2 ? -6 : 6, dy: 0 }
      : state === 'celular' || state === 'escribe'
        ? { rotate: 0, dx: 0, dy: 6 }
        : state === 'aburrido'
          ? { rotate: index % 2 ? 9 : -9, dx: 0, dy: 1 }
          : { rotate: 0, dx: 0, dy: 0 };
  const headDown = state === 'celular' || state === 'escribe' ? 7 : 0;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className={`person state-${state}`}>
      <path d="M-58 4 Q-52 -30 0 -33 Q52 -30 58 4 L64 110 L-64 110 Z" fill={shirt} />
      <path d="M-14 -33 L0 -14 L14 -33 Z" fill="rgba(255,255,255,0.35)" />
      <g
        className={state === 'asiente' ? 'head nod' : 'head'}
        style={{ animationDelay: `${(index * 0.37) % 2}s` }}
        transform={`translate(0 ${headDown}) rotate(${look.rotate} 0 -40)`}
      >
        <rect x={-11} y={-48} width={22} height={20} rx={6} fill={skin} />
        <ellipse cx={0} cy={-78} rx={29} ry={35} fill={skin} />
        {long ? (
          <path
            d="M-31 -78 Q-33 -118 0 -116 Q33 -118 31 -78 L34 -36 L22 -40 L24 -86 Q0 -100 -24 -86 L-22 -40 L-34 -36 Z"
            fill={hair}
          />
        ) : (
          <path d="M-30 -80 Q-31 -117 0 -115 Q31 -117 30 -80 Q26 -98 0 -99 Q-26 -98 -30 -80 Z" fill={hair} />
        )}
        <g className="eyes" style={{ animationDelay: `${(index * 1.13) % 5}s` }}>
          <ellipse
            cx={-11 + look.dx}
            cy={-79 + look.dy}
            rx={3.3}
            ry={state === 'aburrido' ? 1.4 : 4.2}
            fill="#1f2326"
          />
          <ellipse
            cx={11 + look.dx}
            cy={-79 + look.dy}
            rx={3.3}
            ry={state === 'aburrido' ? 1.4 : 4.2}
            fill="#1f2326"
          />
        </g>
        <path
          d={`M-13 -92 L-6 ${state === 'aburrido' ? -91 : -93}`}
          stroke={hair}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <path
          d={`M13 -92 L6 ${state === 'aburrido' ? -91 : -93}`}
          stroke={hair}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {state === 'habla' ? (
          <ellipse className="talking" cx={0} cy={-60} rx={7} ry={4} fill="#6b2d2d" />
        ) : (
          <path
            d={state === 'asiente' || state === 'atento' ? 'M-8 -61 Q0 -56 8 -61' : 'M-7 -59 L7 -59'}
            stroke="#6b3a35"
            strokeWidth={2.4}
            fill="none"
            strokeLinecap="round"
          />
        )}
      </g>
      {state === 'celular' && (
        <g>
          <rect x={-10} y={-24} width={20} height={30} rx={3} fill="#15181b" />
          <rect x={-7.5} y={-21} width={15} height={22} rx={1.5} fill="#8fd0ff" className="phone-glow" />
          <ellipse cx={-12} cy={-6} rx={8} ry={6} fill={skin} />
        </g>
      )}
    </g>
  );
}
export const Audience = memo(function Audience({
  committee,
  audience,
  speaking,
  label,
}: {
  committee: PersonState[];
  audience: PersonState[];
  speaking: number | null;
  label: string;
}) {
  const back = audience.slice(0, 6),
    front = audience.slice(6);
  const row = (list: PersonState[], y: number, scale: number, offset: number) =>
    list.map((state, i) => {
      const span = 860 / Math.max(1, list.length);
      return (
        <Person
          key={`${y}-${i}`}
          x={70 + span / 2 + i * span + (y % 2 ? 18 : 0)}
          y={y}
          scale={scale}
          index={i + offset}
          state={state}
          long={(i + offset) % 3 === 1}
        />
      );
    });
  return (
    <svg className="audience" viewBox="0 0 1000 470" role="img" aria-label={label}>
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2c33" />
          <stop offset="1" stopColor="#2c3e44" />
        </linearGradient>
        <radialGradient id="spot" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(206,242,154,0.35)" />
          <stop offset="1" stopColor="rgba(206,242,154,0)" />
        </radialGradient>
      </defs>
      <rect width="1000" height="470" fill="url(#wall)" />
      <rect y="150" width="1000" height="16" fill="#25363c" />
      {front.length > 0 && row(front, 196, 0.48, 6)}
      {row(back, 244, 0.58, 0)}
      <rect y="262" width="1000" height="40" fill="#22333a" />
      {committee.map((state, i) => {
        const x = 230 + i * 270;
        return (
          <g key={i}>
            {speaking === i && <ellipse cx={x} cy={300} rx={130} ry={120} fill="url(#spot)" />}
            <Person x={x} y={372} scale={1} index={i + 11} state={state} long={i !== 1} />
          </g>
        );
      })}
      <path d="M40 380 L960 380 L1000 470 L0 470 Z" fill="#5a4636" />
      <rect x="40" y="374" width="920" height="10" rx="3" fill="#6d5543" />
      {COMMITTEE.map((m, i) => {
        const x = 230 + i * 270;
        return (
          <g key={m.id} transform={`translate(${x - 92} 398)`}>
            <rect width="184" height="50" rx="5" fill={speaking === i ? '#cef29a' : '#f2efe6'} />
            <text x="92" y="22" textAnchor="middle" fontSize="16" fontWeight="650" fill="#1d2c2a">
              {m.name}
            </text>
            <text x="92" y="40" textAnchor="middle" fontSize="12" fill="#3f4e4c">
              {m.role}
            </text>
          </g>
        );
      })}
      {committee.map((state, i) =>
        state === 'escribe' ? (
          <g key={`n${i}`} transform={`translate(${230 + i * 270 + 18} 362)`}>
            <rect width="44" height="14" rx="2" fill="#fbfaf5" />
            <path d="M8 2 L40 -14" stroke="#253238" strokeWidth="3" strokeLinecap="round" />
          </g>
        ) : null,
      )}
    </svg>
  );
});
export function describeRoom(committee: PersonState[], audience: PersonState[]): string {
  const attentive = audience.filter((s) => s === 'atento' || s === 'asiente').length;
  const parts = COMMITTEE.map((m, i) => `${m.name} ${STATE_TEXT[committee[i] ?? 'atento']}`);
  return `Sala de defensa. ${parts.join('. ')}.${audience.length ? ` ${attentive} de ${audience.length} personas del público están atentas.` : ''}`;
}

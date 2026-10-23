import type { AvatarLook } from '@oratoria/conversation';
import type { HumanConfig } from '../vendor/humanforge/runtime';

/** Apariencia visual, independiente de la voz, el rol y la evaluación. */
export function humanLook(look: AvatarLook, seed: number): Partial<HumanConfig> {
  const male = look.gender === 'm';
  const age = look.age === 'joven' ? 'young' : look.age === 'mayor' ? 'old' : 'middleage';
  const tone = look.skin >= 4 ? 'african' : look.skin === 2 ? 'asian' : 'caucasian';
  const hair =
    look.hairStyle === 'calvo'
      ? null
      : look.hairStyle === 'rizado'
        ? 'afro01'
        : look.hairStyle === 'largo'
          ? 'long01'
          : look.hairStyle === 'recogido'
            ? 'ponytail01'
            : male
              ? seed % 2
                ? 'short01'
                : 'short02'
              : 'bob02';
  return {
    gender: male ? 1 : 0,
    age: look.age === 'joven' ? 0.12 : look.age === 'mayor' ? 0.7 : 0.38,
    weight: 0.43 + (seed % 3) * 0.04,
    muscle: 0.45,
    height: 0.5,
    skin: `${age}_${tone}_${male ? 'male' : 'female'}`,
    skinTint: look.skin === 3 ? '#e0bd9c' : '#ffffff',
    hair,
    hairColor:
      look.hairStyle === 'canoso' || look.age === 'mayor'
        ? '#b8b3ab'
        : ['#211812', '#49301e', '#75512e', '#9a7449', '#c2a478', '#b8b3ab'][look.hair % 6],
    eyes: ['brownlight', 'blue', 'green'][seed % 3],
    clothes: [
      male
        ? look.outfit === 'traje' || look.outfit === 'chaqueta'
          ? 'male_elegantsuit01'
          : 'male_casualsuit01'
        : 'female_elegantsuit01',
    ],
    // Pequeñas diferencias del rostro, además de edad, pelo y vestuario.
    detail: { noseWidth: ((seed % 3) - 1) * 0.15, jawWidth: ((seed % 4) - 1.5) * 0.12 },
  };
}

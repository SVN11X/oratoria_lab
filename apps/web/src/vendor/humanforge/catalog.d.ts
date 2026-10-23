export type Fit = 'female' | 'male' | 'unisex';
export type ClothingSlot = 'outfit' | 'shoes' | 'hat' | 'headwear';
export interface ItemInfo {
    label: string;
    fit: Fit;
}
export declare const HAIR: Record<string, ItemInfo>;
export declare const CLOTHES: Record<string, ItemInfo & {
    slot: ClothingSlot;
}>;
/** Fabric colors for tintable garments (multiplied over a light fabric texture). */
export declare const GARMENT_COLORS: {
    id: string;
    label: string;
    color: string;
}[];
export declare const EYE_LABELS: Record<string, string>;
/** Swatch colors for eye chips (approximate iris color). */
export declare const EYE_SWATCH: Record<string, string>;
/**
 * Natural hair colors, as the tint multiplied over the grey hair textures (they average ~70%
 * brightness, so tints are a bit lighter than the visible result).
 */
export declare const HUMAN_HAIR_COLORS: {
    id: string;
    label: string;
    color: string;
}[];
/** Skin tint presets (multiplied over the skin texture; white = texture as-is). */
export declare const SKIN_TINTS: string[];
/**
 * Skin tone palette shown as swatches. Each tone is a base skin texture family plus a tint
 * (multiplied over it). The texture's age and gender variant is picked automatically from the
 * avatar's age and gender (see skinFor), so users only ever choose a color.
 */
export interface SkinToneDef {
    id: string;
    base: 'caucasian' | 'caucasian2' | 'asian' | 'african';
    tint: string;
}
export declare const HUMAN_SKIN_TONES: SkinToneDef[];
/** Skin texture family of a skin id, e.g. young_caucasian_female2 -> caucasian2. */
export declare function skinBase(id: string): SkinToneDef['base'];
/** The skin texture for a tone family that best matches an age (0..1) and gender (0..1). */
export declare function skinFor(skins: string[], base: string, age: number, gender: number): string | null;
/** Multiply two hex colors (how a tint combines with a skin texture). */
export declare const multiplyHex: (a: string, b: string) => string;
export declare const hexDistance: (a: string, b: string) => number;
export declare function hairInfo(id: string): ItemInfo;
export declare function clothingInfo(id: string): ItemInfo & {
    slot: ClothingSlot;
};
export declare function skinInfo(id: string, tags: string[]): ItemInfo;
export declare const fits: (fit: Fit, gender: "female" | "male" | "any") => boolean;

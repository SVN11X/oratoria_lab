import { Bone, Group, Texture } from 'three';
import { GlbPrimitive } from './glb';
export interface HumanConfig {
    /** 0 = female, 1 = male */
    gender: number;
    /** 0..1 maps to 18..90 years */
    age: number;
    muscle: number;
    weight: number;
    height: number;
    proportions: number;
    cupSize: number;
    firmness: number;
    african: number;
    asian: number;
    caucasian: number;
    /** Detail sliders, -1..1, keyed by DETAIL_SLIDERS id. */
    detail: Record<string, number>;
    skin: string;
    /** Multiplied over the skin texture for fine tone control. */
    skinTint: string;
    eyes: string;
    eyebrows: string | null;
    eyebrowColor: string;
    eyelashes: string | null;
    hair: string | null;
    hairColor: string;
    clothes: string[];
    /** Colors of tintable garments by clothing slot ('outfit', 'headwear'...); unset = the garment's default. */
    garmentColors?: Record<string, string>;
}
export declare const DEFAULT_HUMAN: HumanConfig;
export interface ProxyMeta {
    id: string;
    kind: string;
    file: string;
    triangles: number;
    transparent: boolean;
    tintable: boolean;
    zDepth: number;
    deleteVerts?: [number, number][];
    scale: [number, number, number][];
    texture?: string;
    normalTexture?: string;
    textureSize: number;
    doubleSided: boolean;
    /** Default tint for tintable garments. */
    color?: string;
    /** Headwear that covers the hair: the hair proxy is not shown while it is worn. */
    hidesHair?: boolean;
    roughness?: number;
    /** Texture coordinates are in tiles (repeat wrapping). */
    tileable?: boolean;
    /** Transparent WebP thumbnail, relative to the package root (tools/build-previews.mts). */
    preview?: string;
}
export interface HumanManifest {
    vertexCount: number;
    groundVerts: number[];
    body: {
        file: string;
        vertexCount: number;
        triangles: number;
    };
    shapes: {
        file: string;
        baseOffset: number;
        baseMin: number[];
        baseScale: number[];
        morphs: {
            name: string;
            offset: number;
            count: number;
            scale: number;
            bits: 8 | 16;
        }[];
    };
    bones: {
        name: string;
        parent: number;
        head: number[];
        tail: number[];
    }[];
    proxies: ProxyMeta[];
    /** `swatch`: the skin tone as rendered (hex), from tools/build-previews.mts. */
    skins: {
        id: string;
        tags: string[];
        swatch?: string;
    }[];
    eyes: string[];
    /** Iris color and round iris thumbnail per eye color (tools/build-previews.mts). */
    eyeOptions?: Record<string, {
        swatch: string;
        preview: string;
    }>;
    textureSizes: {
        skin1k: number;
        skin2k: number;
        eyes: number;
    };
    /**
     * JPEG/PNG copies of every WebP texture for decoders without WebP (expo-gl's stb_image),
     * from tools/build-mobile-textures.mts. Files: `<baseUrl or dir>/<key>_<tier>.<ext>`.
     */
    mobileTextures?: {
        dir: string;
        /** Absolute URL of the pack when it is hosted apart from the manifest (e.g. a separate CDN tag). */
        baseUrl?: string;
        tiers: Record<TextureTier, number>;
        files: Record<string, {
            ext: 'jpg' | 'png';
            max: number;
        }>;
    };
    expressions: Record<string, string>;
}
interface Morph {
    idx: Uint16Array;
    d: Int16Array;
    scale: number;
}
/** Loads a texture from a URL. `size` is the known square size (React Native needs it up front). */
export type HumanTextureLoader = (url: string, size: number) => Promise<Texture>;
/** Texture quality tier: max texture edge 512 / 1024 / 2048 px (smaller sources are never upscaled). */
export type TextureTier = '512' | '1k' | '2k';
/** 'webp': the web files. 'mobile': the JPEG/PNG pack (needed by expo-gl, which can't decode WebP). */
export type TextureFormat = 'webp' | 'mobile';
export declare const webTextureLoader: HumanTextureLoader;
export interface HumanPackage {
    baseUrl: string;
    manifest: HumanManifest;
    base: Float32Array;
    morphs: Map<string, Morph>;
    body: GlbPrimitive;
    loadTexture: HumanTextureLoader;
    fetchBinary: (url: string) => Promise<ArrayBuffer>;
    proxyCache: Map<string, Promise<GlbPrimitive>>;
    textureCache: Map<string, Promise<Texture>>;
    textureFormat: TextureFormat;
    /** URL and pixel size of a texture key ('skins/<id>', 'eyes/<id>', 'textures/<name>') at a tier. */
    resolveTexture(key: string, tier: TextureTier, nativeSize: number): {
        url: string;
        size: number;
    };
    /** Load (once per URL) a texture by key and tier. */
    getTexture(key: string, tier: TextureTier, nativeSize: number): Promise<Texture>;
}
export interface LoadOptions {
    loadTexture?: HumanTextureLoader;
    /** Override fetching (e.g. for an offline cache). Must return the raw (still gzipped) bytes. */
    fetch?: (url: string) => Promise<ArrayBuffer>;
    /** Texture files to use. Default 'webp'; the Expo loaders use 'mobile' (falls back to WebP if the pack is missing). */
    textureFormat?: TextureFormat;
    /** Where the mobile pack lives. Default: manifest.mobileTextures.baseUrl, else `<baseUrl>/mobile`. */
    mobileBaseUrl?: string;
}
/** Load the human package (manifest + shapes + body). Proxies/textures load lazily per config. */
export declare function loadHumanPackage(baseUrl: string, opts?: LoadOptions): Promise<HumanPackage>;
/**
 * Every file a config needs for its first textured frame (proxy meshes + textures), so apps can
 * download them ahead of time. Used by preloadHumanPackage.
 */
export declare function humanAssetsFor(pkg: HumanPackage, config: Partial<HumanConfig>, opts?: {
    textureSize?: TextureTier;
    normalMaps?: boolean;
}): {
    meshes: {
        id: string;
        url: string;
    }[];
    textures: {
        url: string;
        size: number;
        key: string;
        nativeSize: number;
    }[];
};
export interface PreloadOptions extends LoadOptions {
    /** The look to warm up (default DEFAULT_HUMAN): its hair, clothes, skin and eyes are downloaded too. */
    config?: Partial<HumanConfig>;
    textureSize?: TextureTier;
    normalMaps?: boolean;
    onProgress?: (done: number, total: number) => void;
}
/**
 * Load the package and download everything the first textured frame of `config` needs. Resolves
 * when those files are fetched (and, with the Expo loaders, on disk), not just the manifest.
 */
export declare function preloadHumanPackage(baseUrl: string, opts?: PreloadOptions): Promise<HumanPackage>;
/** Download the meshes and textures for a config into the package caches (see preloadHumanPackage). */
export declare function warmHumanPackage(pkg: HumanPackage, opts?: Omit<PreloadOptions, keyof LoadOptions>): Promise<void>;
/** Weights of the baked macro basis for a config (see VARIANTS in tools/build-human.ts). */
export declare function macroWeights(c: HumanConfig): Record<string, number>;
/** Full shape (all MakeHuman vertices incl. helpers), metres, before grounding. */
export declare function evaluateShape(pkg: HumanPackage, c: HumanConfig, out?: Float32Array): Float32Array<ArrayBufferLike>;
export declare class HumanAvatar {
    readonly group: Group<import("three").Object3DEventMap>;
    private pkg;
    private body;
    private skeleton;
    private mh;
    private fullIndex;
    private positions;
    private proxies;
    private config;
    private exprNames;
    private exprDeltas;
    private skinMat;
    private version;
    /** Texture tier; set before the first setConfig (changing it later reloads textures). */
    textureSize: TextureTier;
    /** Anisotropic filtering for textures (1 = off). Lower is cheaper on phones. */
    anisotropy: number;
    /** Load clothing normal maps. Turn off for lighter mobile materials. */
    normalMaps: boolean;
    constructor(pkg: HumanPackage);
    get bones(): Bone<import("three").Object3DEventMap>[];
    private alias;
    /** Expression morph attributes from full-shape deltas, either by direct lookup or via proxy refs. */
    private attachMorphs;
    /** Apply a full or partial config. Loads any new hair/clothes/textures, then reshapes. */
    setConfig(patch: Partial<HumanConfig>): Promise<void>;
    getConfig(): HumanConfig;
    /**
     * Re-apply textures after changing textureSize, anisotropy or normalMaps (meshes stay as they
     * are; already-loaded files come from the cache).
     */
    reloadTextures(): Promise<void>;
    /** Expression by ARKit-style name (e.g. 'jawOpen', 'mouthSmile') or MPFB unit name, weight 0..1. */
    setExpression(name: string, weight: number): void;
    get expressionNames(): string[];
    private texture;
    private loadProxy;
    private removeProxy;
    /** CPU reshape: body, proxies, skeleton, faces hidden under clothes. */
    private reshape;
    /** Head height and total height (world space at rest), for camera framing. */
    metrics(): {
        headY: number;
        height: number;
    };
    dispose(): void;
}
export {};

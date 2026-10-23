export interface GlbAttribute {
    array: Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array;
    itemSize: number;
    normalized: boolean;
}
export interface GlbPrimitive {
    attributes: Record<string, GlbAttribute>;
    index: Uint16Array | Uint32Array;
}
export declare function readGlb(buffer: ArrayBuffer): GlbPrimitive;
/** Convert a (possibly normalized integer) attribute to float values. */
export declare function toFloat(a: GlbAttribute): Float32Array;

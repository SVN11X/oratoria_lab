// HumanForge, MIT. See UPSTREAM.md and docs/third-party/humanforge-LICENSE.
// Minimal GLB geometry reader (no DOM, no TextDecoder, no GLTFLoader) so the human
// runtime works the same in browsers and React Native. Reads the first mesh primitive:
// attributes (incl. custom _MH/_REFS/... and KHR_mesh_quantization types) and indices.
const TYPES = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function ascii(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192)
        s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return s;
}
export function readGlb(buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67)
        throw new Error('not a GLB');
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(decodeURIComponent(escape(ascii(new Uint8Array(buffer, 20, jsonLen)))));
    const binStart = 20 + jsonLen + 8;
    const read = (i) => {
        const acc = json.accessors[i];
        const view = json.bufferViews[acc.bufferView];
        const T = TYPES[acc.componentType];
        const size = SIZES[acc.type];
        const out = new T(acc.count * size);
        const start = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const stride = view.byteStride ?? size * T.BYTES_PER_ELEMENT;
        if (stride === size * T.BYTES_PER_ELEMENT && start % T.BYTES_PER_ELEMENT === 0) {
            out.set(new T(buffer, start, acc.count * size));
        }
        else {
            // padded / interleaved: copy element by element
            const getter = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
            for (let e = 0; e < acc.count; e++)
                for (let k = 0; k < size; k++) {
                    out[e * size + k] = dv[getter](start + e * stride + k * T.BYTES_PER_ELEMENT, true);
                }
        }
        return { array: out, itemSize: size, normalized: !!acc.normalized };
    };
    const prim = json.meshes[0].primitives[0];
    const attributes = {};
    for (const [name, idx] of Object.entries(prim.attributes))
        attributes[name] = read(idx);
    const index = read(prim.indices).array;
    return { attributes, index };
}
/** Convert a (possibly normalized integer) attribute to float values. */
export function toFloat(a) {
    if (a.array instanceof Float32Array)
        return a.array;
    const out = new Float32Array(a.array.length);
    const max = a.normalized
        ? a.array instanceof Uint8Array ? 255 : a.array instanceof Uint16Array ? 65535 : a.array instanceof Int8Array ? 127 : a.array instanceof Int16Array ? 32767 : 1
        : 1;
    for (let i = 0; i < out.length; i++)
        out[i] = a.normalized && max !== 1 ? Math.max(-1, a.array[i] / max) : a.array[i];
    return out;
}

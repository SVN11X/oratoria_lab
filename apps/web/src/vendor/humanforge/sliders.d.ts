export interface DetailSlider {
    id: string;
    label: string;
    group: 'head' | 'eyes' | 'nose' | 'mouth' | 'ears' | 'body';
    neg: string[];
    pos: string[];
}
export declare const DETAIL_SLIDERS: DetailSlider[];
/** Macro sliders (0..1), mirroring MakeHuman's macro modifiers. */
export declare const MACRO_SLIDERS: readonly [{
    readonly id: "gender";
    readonly label: "Gender";
    readonly min: "Female";
    readonly max: "Male";
}, {
    readonly id: "age";
    readonly label: "Age";
    readonly min: "18";
    readonly max: "90";
}, {
    readonly id: "muscle";
    readonly label: "Muscle";
    readonly min: "Soft";
    readonly max: "Muscular";
}, {
    readonly id: "weight";
    readonly label: "Weight";
    readonly min: "Thin";
    readonly max: "Heavy";
}, {
    readonly id: "height";
    readonly label: "Height";
    readonly min: "Short";
    readonly max: "Tall";
}, {
    readonly id: "proportions";
    readonly label: "Proportions";
    readonly min: "Uncommon";
    readonly max: "Ideal";
}, {
    readonly id: "cupSize";
    readonly label: "Bust";
    readonly min: "Small";
    readonly max: "Large";
}, {
    readonly id: "firmness";
    readonly label: "Firmness";
    readonly min: "Low";
    readonly max: "High";
}, {
    readonly id: "african";
    readonly label: "African";
    readonly min: "0";
    readonly max: "1";
}, {
    readonly id: "asian";
    readonly label: "Asian";
    readonly min: "0";
    readonly max: "1";
}, {
    readonly id: "caucasian";
    readonly label: "European";
    readonly min: "0";
    readonly max: "1";
}];
export type MacroId = (typeof MACRO_SLIDERS)[number]['id'];
/**
 * FACS-style expression units shipped with MPFB, mapped to the closest ARKit
 * blendshape names so ARKit/MediaPipe face-tracking data can drive them.
 */
export declare const EXPRESSION_UNITS: Record<string, string>;

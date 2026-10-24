export type RenderQuality = 'ligero' | 'equilibrado' | 'alta';
export const RENDER_PROFILES: Record<RenderQuality, { fps: number; pixelRatio: number }> = {
  ligero: { fps: 24, pixelRatio: 1 },
  equilibrado: { fps: 30, pixelRatio: 1.5 },
  alta: { fps: 45, pixelRatio: 2 },
};

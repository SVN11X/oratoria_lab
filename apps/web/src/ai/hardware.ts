import type { Hardware } from '@oratoria/model-manager';
import { systemInfo } from './desktop';

type GpuAdapter = {
  info?: { vendor?: string; architecture?: string; description?: string; device?: string };
};
type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  gpu?: { requestAdapter: () => Promise<GpuAdapter | null> };
};

/** Multiplicación de matrices de 192×192 para estimar la velocidad de la CPU (GFLOP/s aproximados). */
function cpuScore(): number {
  const n = 192,
    a = new Float32Array(n * n).map((_, i) => (i % 7) / 7),
    b = new Float32Array(n * n).map((_, i) => (i % 5) / 5),
    c = new Float32Array(n * n);
  const t0 = performance.now();
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const x = a[i * n + k]!;
      for (let j = 0; j < n; j++) c[i * n + j]! += x * b[k * n + j]!;
    }
  const ms = performance.now() - t0;
  return Math.round(((2 * n * n * n) / (ms / 1000) / 1e9) * 100) / 100;
}

/**
 * Detecta lo que la plataforma permite saber. En el navegador, la memoria es un valor aproximado y
 * limitado (Chrome informa como máximo 8 GB) y no se puede leer el modelo de CPU. En escritorio se
 * usa el sistema operativo.
 */
export async function detectHardware(): Promise<Hardware> {
  const nav = navigator as NavigatorExtras;
  let gpu: string | null = null,
    webgpu = false;
  try {
    const adapter = await nav.gpu?.requestAdapter();
    if (adapter) {
      webgpu = true;
      const i = adapter.info ?? {};
      gpu =
        [i.vendor, i.architecture, i.description || i.device].filter(Boolean).join(' · ') ||
        'GPU compatible con WebGPU';
    }
  } catch {
    webgpu = false;
  }
  const sys = await systemInfo();
  const score = cpuScore();
  if (sys)
    return {
      ramGb: Math.round(sys.totalMemoryBytes / 1e9),
      ramSource: 'sistema',
      cores: sys.cpuCores,
      gpu,
      webgpu,
      cpuScore: score,
    };
  return {
    ramGb: nav.deviceMemory ?? null,
    ramSource: nav.deviceMemory ? 'navegador' : 'desconocido',
    cores: nav.hardwareConcurrency ?? null,
    gpu,
    webgpu,
    cpuScore: score,
  };
}

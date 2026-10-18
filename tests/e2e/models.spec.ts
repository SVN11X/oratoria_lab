import { expect, test, type Page } from '@playwright/test';
import { mockOllama, presetAi, trackExternal } from './helpers';

const HARDWARE = { ramGb: 16, ramSource: 'sistema', cores: 8, gpu: null, webgpu: false, cpuScore: 2 };
const INITIAL = [
  { name: 'qwen2.5:7b', size: 4_700_000_000, family: 'qwen2', params: '7.6B', quant: 'Q4_K_M' },
  { name: 'qwen2.5:0.5b', size: 398_000_000, family: 'qwen2', params: '494M', quant: 'Q4_K_M' },
  {
    name: 'nomic-embed-text:latest',
    size: 274_000_000,
    family: 'nomic-bert',
    params: '137M',
    quant: 'F16',
    embedding: true,
  },
];
const card = (page: Page, name: string) =>
  page.locator('article.model-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const catalogCard = (page: Page, name: string) =>
  page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Modelos para descargar con Ollama' }) })
    .locator('article.model-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
const fn = (page: Page, name: string) =>
  page.locator('.function-card').filter({ has: page.getByText(name, { exact: true }) });

test('gestor de modelos: inventario, auditoría, descarga, prueba, sustitución y desinstalación con la API oficial', async ({
  page,
}) => {
  const ollama = await mockOllama(INITIAL);
  const external = trackExternal(page, [ollama.url]);
  await presetAi(page, { useLlm: true, provider: 'ollama', ollamaUrl: ollama.url, hardware: HARDWARE });
  try {
    await page.goto('/#/settings/models');
    await expect(page.getByText('Conectado · Ollama 0.30.0-prueba · 3 modelos')).toBeVisible();

    // Inventario con datos informados por Ollama, sin inventar los que no informa.
    const seven = card(page, 'qwen2.5:7b');
    await expect(seven.getByText('Actualizar', { exact: true })).toBeVisible();
    await expect(seven.getByText('Cuantización: Q4_K_M')).toBeVisible();
    await expect(seven.getByText('Licencia: Licencia de prueba 2.0')).toBeVisible();
    await expect(seven.getByText('Contexto: 32.768 tokens')).toBeVisible();
    await expect(seven.getByText('Último uso en Oratoria Lab: sin registro')).toBeVisible();
    await expect(card(page, 'qwen2.5:0.5b').getByText('Sustituir', { exact: true })).toBeVisible();
    await expect(card(page, 'nomic-embed-text:latest').getByText('Conservar', { exact: true })).toBeVisible();

    // Asignación por función.
    await fn(page, 'Conversación').getByLabel('Modelo').selectOption('qwen2.5:7b');
    await fn(page, 'Evaluación').getByLabel('Modelo').selectOption('qwen2.5:0.5b');
    await expect(seven.getByText('Seleccionado: Conversación')).toBeVisible();

    // Prueba de velocidad reproducible.
    await seven.getByRole('button', { name: 'Probar velocidad' }).click();
    await expect(seven.getByText(/Prueba del .* JSON válido · español correcto/)).toBeVisible();

    // Descarga desde el catálogo con progreso y verificación de Ollama.
    const catalog = catalogCard(page, 'qwen3.5:4b');
    await catalog.getByRole('button', { name: 'Descargar' }).click();
    await expect(catalog.getByRole('progressbar')).toBeVisible();
    await expect(catalog.getByText('Instalado y verificado por Ollama')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Conectado · Ollama 0.30.0-prueba · 4 modelos')).toBeVisible();

    // Cancelar una descarga deja reintentar.
    const gemma = catalogCard(page, 'gemma4:e4b');
    await gemma.getByRole('button', { name: 'Descargar' }).click();
    await gemma.getByRole('button', { name: 'Cancelar' }).click();
    await expect(gemma.getByText(/Descarga cancelada/)).toBeVisible();
    await expect(gemma.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    // Sustitución guiada: descargar, probar, reasignar y preguntar antes de eliminar.
    await card(page, 'qwen2.5:0.5b').getByRole('button', { name: 'Sustituir por qwen3.5:2b' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Comenzar' }).click();
    await expect(dialog.getByText('Listo: las funciones de qwen2.5:0.5b ahora usan qwen3.5:2b.')).toBeVisible(
      { timeout: 20000 },
    );
    expect(ollama.models.has('qwen2.5:0.5b')).toBe(true);
    await dialog.getByRole('button', { name: 'Revisar si elimino el anterior' }).click();
    const confirm = page.getByRole('dialog', { name: '¿Desinstalar qwen2.5:0.5b?' });
    await expect(confirm.getByText(/Tamaño informado: 398 MB/)).toBeVisible();
    await expect(confirm.getByText(/Está seleccionado/)).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Desinstalar con Ollama' }).click();
    await expect(page.getByText(/qwen2\.5:0\.5b se eliminó con la API oficial de Ollama/)).toBeVisible();
    await expect(card(page, 'qwen2.5:0.5b')).toHaveCount(0);
    await expect(fn(page, 'Evaluación').getByLabel('Modelo')).toHaveValue('qwen3.5:2b');

    // Desinstalar un modelo seleccionado pide reemplazo.
    await seven.getByRole('button', { name: 'Desinstalar' }).click();
    const second = page.getByRole('dialog', { name: '¿Desinstalar qwen2.5:7b?' });
    await second.getByLabel('Reemplazo para sus funciones').selectOption('qwen3.5:4b');
    await second.getByRole('button', { name: 'Desinstalar con Ollama' }).click();
    await expect(
      page.getByText(/qwen2\.5:7b se eliminó.*Sus funciones ahora usan qwen3\.5:4b/),
    ).toBeVisible();
    await expect(fn(page, 'Conversación').getByLabel('Modelo')).toHaveValue('qwen3.5:4b');

    // Solo endpoints oficiales y solo los borrados confirmados.
    const deletes = ollama.calls.filter((c) => c.method === 'DELETE');
    expect(deletes.map((c) => [c.path, (c.body as { model: string }).model])).toEqual([
      ['/api/delete', 'qwen2.5:0.5b'],
      ['/api/delete', 'qwen2.5:7b'],
    ]);
    const paths = new Set(ollama.calls.map((c) => c.path));
    for (const p of paths)
      expect([
        '/api/version',
        '/api/tags',
        '/api/ps',
        '/api/show',
        '/api/pull',
        '/api/delete',
        '/api/generate',
        '/api/chat',
      ]).toContain(p);
    expect(external).toEqual([]);
  } finally {
    await ollama.close();
  }
});

test('sin Ollama, la app explica cómo conectarlo y no hace solicitudes si la IA está desactivada', async ({
  page,
}) => {
  const external = trackExternal(page);
  await page.goto('/#/settings/models');
  await expect(page.getByRole('checkbox', { name: /Usar un modelo de lenguaje/ })).not.toBeChecked();
  await page.waitForTimeout(800);
  expect(external).toEqual([]);
  await presetAi(page, { useLlm: true, ollamaUrl: 'http://127.0.0.1:9' });
  await page.evaluate(() => localStorage.removeItem('oratoria-ai-v1'));
  await page.reload();
  await expect(page.getByText('Sin conexión')).toBeVisible({ timeout: 20000 });
  await page.getByText('Cómo conectar Ollama').click();
  await expect(page.getByText(/OLLAMA_ORIGINS=/).first()).toBeVisible();
});

test('práctica con modelo local simulado: preguntas del modelo y evaluación declarada', async ({ page }) => {
  const ollama = await mockOllama([
    { name: 'qwen3.5:4b', size: 3_400_000_000, family: 'qwen35', params: '4B', quant: 'Q4_K_M' },
  ]);
  await presetAi(page, {
    useLlm: true,
    provider: 'ollama',
    ollamaUrl: ollama.url,
    assign: { conversacion: 'qwen3.5:4b', evaluacion: '', embeddings: '' },
    stt: 'escrito',
    tts: 'texto',
  });
  try {
    await page.goto('/#/practice/tesis');
    await page.getByLabel('Título de la tesis').fill('Robot de navegación autónoma para bodegas');
    await page.getByLabel('Exposición de la tesis (minutos)').selectOption('0');
    await page.getByLabel('Preguntas principales').selectOption('2');
    await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
    await expect(page.getByText(/\[Simulado\]/).first()).toBeVisible({ timeout: 40000 });
    const report = page.getByRole('heading', { name: 'Lo que se observó' });
    for (let i = 0; i < 12; i++) {
      const done = page.getByRole('button', { name: 'Terminé mi respuesta' });
      await expect(done.or(report)).toBeVisible({ timeout: 60000 });
      if (await report.isVisible()) break;
      await page
        .getByLabel('Escribe lo esencial de lo que dices')
        .fill(
          'Elegí A* porque encontró rutas óptimas en 40 pruebas; por ejemplo, el error fue de 12 centímetros.',
        );
      await done.click();
    }
    await expect(report).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('[Simulado] Evaluación del servidor de prueba.')).toBeVisible();
    await expect(page.getByText(/qwen3\.5:4b/).first()).toBeVisible();
    expect(ollama.calls.some((c) => c.path === '/api/chat')).toBe(true);
  } finally {
    await ollama.close();
  }
});

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SCENARIOS } from '@oratoria/conversation';
import { mockOllama, presetAi, trackExternal } from './helpers';

for (const id of ['presentacion', 'debate', 'educativa', 'dificil'] as const) {
  const scenario = SCENARIOS[id];
  test(`${scenario.name}: sesión completa, evaluación e historial`, async ({ page }) => {
    await presetAi(page, { stt: 'escrito', tts: 'texto' });
    await page.goto(`/#/practice/${id}`);
    await page
      .getByLabel(scenario.topicLabel, { exact: true })
      .fill('Propuesta de seguimiento para mejorar el trabajo del equipo');
    await page.getByLabel('Representación de los interlocutores').selectOption('ilustrados');
    await page.getByLabel('Cómo vas a responder').selectOption('texto');
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new Error('El modo escrito no debe solicitar medios.');
      };
    });
    if (scenario.opening.kind !== 'ninguna')
      await page.getByLabel(`${scenario.opening.label} (minutos)`).selectOption('0');
    await page.getByLabel('Preguntas principales').selectOption('2');
    await page.getByRole('button', { name: 'Avanzada', exact: true }).click();
    await page.getByRole('checkbox', { name: /^Repreguntas/ }).uncheck();
    await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
    for (let i = 0; i < 2; i++) {
      await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({
        timeout: 30000,
      });
      await page
        .getByLabel('Escribe lo esencial de lo que dices')
        .fill(
          'Entiendo su punto. Propongo revisar juntos los resultados porque necesitamos comparar los avances con el objetivo. Por ejemplo, podemos registrar tres indicadores cada semana. Reconozco que falta información y acordemos revisarlo el lunes.',
        );
      await page.getByRole('button', { name: 'Terminé mi respuesta' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Lo que se observó' })).toBeVisible({ timeout: 30000 });
    await page.goto('/#/history');
    await expect(page.locator('.session-description').filter({ hasText: scenario.name })).toHaveCount(1);
  });
}

test('una sustitución fallida conserva el modelo actual', async ({ page }) => {
  const ollama = await mockOllama([
    { name: 'qwen2.5:0.5b', size: 398000000, family: 'qwen2', params: '494M', quant: 'Q4_K_M' },
  ]);
  await presetAi(page, {
    useLlm: true,
    provider: 'ollama',
    ollamaUrl: ollama.url,
    assign: { conversacion: 'qwen2.5:0.5b', evaluacion: 'qwen2.5:0.5b', embeddings: '' },
    hardware: { ramGb: 16, ramSource: 'sistema', cores: 8, gpu: null, webgpu: false, cpuScore: 2 },
  });
  await page.route(`${ollama.url}/api/chat`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ message: { content: '{"repregunta":""}' } }),
    }),
  );
  try {
    await page.goto('/#/settings/models');
    await page.getByRole('button', { name: 'Sustituir por qwen3.5:2b' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Comenzar' }).click();
    await expect(page.getByText(/Se conserva el modelo actual/)).toBeVisible({ timeout: 30000 });
    const selected = await page.evaluate(
      () => JSON.parse(localStorage.getItem('oratoria-ai-v1')!).state.assign,
    );
    expect(selected.conversacion).toBe('qwen2.5:0.5b');
    expect(ollama.calls.some((c) => c.path === '/api/delete')).toBe(false);
  } finally {
    await ollama.close();
  }
});

test('personas 3D: recursos locales, movimiento y accesibilidad', async ({ page }) => {
  // La rasterización por software y la captura de cada lienzo tardan más que con GPU.
  test.setTimeout(120000);
  test.skip(
    process.env.PW_SOFTWARE_GL !== '1',
    'Activa PW_SOFTWARE_GL=1 o verifica en un navegador con WebGL.',
  );
  const external = trackExternal(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/practice/tesis');
  const scene = page.locator('.human-committee');
  await expect(scene).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await expect(scene.locator('canvas')).toHaveCount(1);
  await scene.scrollIntoViewIfNeeded();
  const before = await scene.screenshot();
  await expect.poll(async () => (await scene.screenshot()).equals(before), { timeout: 30000 }).toBe(false);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations.map((v) => v.id)).toEqual([]);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Representación de los interlocutores').selectOption('ilustrados');
  await expect(scene).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

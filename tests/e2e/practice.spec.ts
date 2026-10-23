import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THESIS_MD, presetAi, trackExternal } from './helpers';

const ANSWER =
  'Elegí A* porque en las 40 pruebas del circuito de 120 metros encontró rutas óptimas con bajo costo. Por ejemplo, el error medio fue de 12 centímetros. Reconozco como limitación que solo probamos de día.';

/** Responde por escrito cada turno hasta que aparece el informe. */
async function answerUntilReport(page: Page, answer = ANSWER) {
  const report = page.getByRole('heading', { name: 'Lo que se observó' });
  for (let i = 0; i < 20; i++) {
    const done = page.getByRole('button', { name: /Terminé mi respuesta|Respondí, sigo exponiendo/ });
    await expect(done.or(report)).toBeVisible({ timeout: 60000 });
    if (await report.isVisible()) return i;
    await page.getByLabel('Escribe lo esencial de lo que dices').fill(answer);
    await done.click();
  }
  await expect(report).toBeVisible({ timeout: 60000 });
  return 20;
}

test('defensa de tesis con material, reglas, respuestas escritas e informe guardado', async ({ page }) => {
  const external = trackExternal(page);
  await presetAi(page, { stt: 'escrito', tts: 'texto' });
  await page.goto('/#/practice/tesis');
  await page.getByLabel('Representación de los interlocutores').selectOption('ilustrados');
  await expect(page.getByRole('heading', { name: 'Defensa de tesis', exact: true })).toBeVisible();
  await page.getByLabel('Título de la tesis').fill('Robot de navegación autónoma para bodegas');
  await page.getByLabel('Elegir archivos de material académico').setInputFiles({
    name: 'tesis-ficticia.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(THESIS_MD),
  });
  await expect(page.getByLabel('Usar tesis-ficticia.md en esta práctica')).toBeChecked({ timeout: 20000 });
  await page.getByLabel('Exposición de la tesis (minutos)').selectOption('1');
  await page.getByLabel('Preguntas principales').selectOption('2');
  await page.getByRole('button', { name: 'Entrar a la simulación' }).click();

  await expect(page.getByRole('region', { name: 'Sala de Defensa de tesis' })).toBeVisible();
  const exposition = page.getByLabel('Escribe lo esencial de lo que dices');
  await expect(exposition).toBeVisible({ timeout: 30000 });
  await exposition.fill(
    'Presento un robot para bodegas con ROS 2 y LiDAR. Hice 40 pruebas en un circuito de 120 metros y obtuve una tasa de éxito del 92 %.',
  );
  const roomAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    roomAudit.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Terminar y pasar a preguntas' }).click();
  const turns = await answerUntilReport(page);
  const reportAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    reportAudit.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
  expect(turns).toBeGreaterThanOrEqual(2);

  await expect(page.getByRole('heading', { name: 'Preguntas, respuestas y fundamentos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Qué practicar ahora' })).toBeVisible();
  // Las preguntas por reglas citan el material y no se atribuyen a un modelo de lenguaje.
  await expect(page.getByText('tesis-ficticia.md').first()).toBeVisible();
  await expect(page.getByText('[Simulado]')).toHaveCount(0);
  // Los criterios sin datos se informan como «No evaluado», no como nivel bajo.
  await expect(page.getByText('No evaluado').first()).toBeVisible();

  await page.goto('/#/history');
  await expect(page.locator('.session-description').filter({ hasText: 'Defensa de tesis' })).toHaveCount(1);
  await page.goto('/#/progress');
  await expect(page.getByText('Prácticas', { exact: true })).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: 'Ver informe' })).toBeVisible();
  expect(external).toEqual([]);
});

test('entrevista laboral sin presentación inicial y salida sin guardar', async ({ page }) => {
  await presetAi(page, { stt: 'escrito', tts: 'texto' });
  await page.goto('/#/practice/entrevista');
  await page.getByLabel('Representación de los interlocutores').selectOption('ilustrados');
  await page.getByLabel('Cargo al que postulas').fill('Analista de datos');
  await page.getByLabel('Preséntate brevemente (minutos)').selectOption('0');
  await page.getByLabel('Preguntas principales').selectOption('2');
  await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
  const done = page.getByRole('button', { name: 'Terminé mi respuesta' });
  await expect(done).toBeVisible({ timeout: 40000 });
  await page
    .getByLabel('Escribe lo esencial de lo que dices')
    .fill(
      'En mi práctica lideré un análisis de ventas. La situación era un informe lento; mi tarea fue automatizarlo; usé Python y el resultado fue reducir el tiempo en 60 %.',
    );
  await done.click();
  await page.getByRole('button', { name: 'Salir sin guardar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir y descartar' }).click();
  await expect(page.getByRole('heading', { name: 'Entrevista laboral', exact: true })).toBeVisible();
  await page.goto('/#/history');
  await expect(page.locator('.session-description')).toHaveCount(0);
});

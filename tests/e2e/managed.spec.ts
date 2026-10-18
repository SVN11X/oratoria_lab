import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { presetAi } from './helpers';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/piper');
const card = (page: Page, name: string) =>
  page.locator('article.model-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

/**
 * Sin red hacia Hugging Face en las pruebas: las descargas se sirven desde archivos de prueba.
 * La voz es un modelo ONNX mínimo con la interfaz de Piper; no es una voz real.
 */
async function routeModels(page: Page) {
  const onnx = await readFile(resolve(FIXTURES, 'fake-voice.onnx'));
  const json = await readFile(resolve(FIXTURES, 'fake-voice.onnx.json'));
  const requested: string[] = [];
  await page.route('https://huggingface.co/**', async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.includes('rhasspy/piper-voices') && url.endsWith('.onnx.json'))
      return route.fulfill({ status: 200, body: json, contentType: 'application/json' });
    if (url.includes('rhasspy/piper-voices') && url.endsWith('.onnx'))
      return route.fulfill({ status: 200, body: onnx, contentType: 'application/octet-stream' });
    // Cualquier otro archivo recibe bytes que no coinciden con la huella fijada.
    return route.fulfill({
      status: 200,
      body: Buffer.from('contenido alterado'),
      contentType: 'application/octet-stream',
    });
  });
  return requested;
}

test('voz Piper administrada: instalar, verificar, escuchar, usar en una práctica y desinstalar', async ({
  page,
}) => {
  const requested = await routeModels(page);
  const assets: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/piper/')) assets.push(r.url());
  });
  await presetAi(page, {
    stt: 'escrito',
    tts: 'piper',
    piper: { f: 'piper-es_MX-ald-medium', m: 'piper-es_MX-ald-medium' },
  });
  await page.goto('/#/settings/models');
  const voice = card(page, 'Voz masculina (México)');
  await voice.getByRole('button', { name: 'Instalar' }).click();
  await expect(voice.getByText('Instalado', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(voice.getByText(/Huella SHA-256 registrada/)).toBeVisible();
  expect(requested.filter((u) => u.includes('es_MX-ald-medium')).length).toBe(2);

  await voice.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByText('Voz masculina (México): integridad verificada.')).toBeVisible();

  // Fonemas con espeak-ng (WASM) e inferencia con ONNX Runtime en el navegador.
  await voice.getByRole('button', { name: 'Escuchar' }).click();
  await expect(voice.getByRole('button', { name: 'Escuchar' })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(assets.some((u) => u.endsWith('piper_phonemize.data'))).toBe(true);

  // La misma voz en una práctica: sin avisos de fallo de voz.
  await page.goto('/#/practice/entrevista');
  await page.getByLabel('Cargo al que postulas').fill('Analista de datos');
  await page.getByLabel('Preséntate brevemente (minutos)').selectOption('0');
  await page.getByLabel('Preguntas principales').selectOption('2');
  await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
  await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({ timeout: 40000 });
  await expect(page.getByText(/Voz: Voces neuronales Piper \(locales\)/)).toBeVisible();
  await expect(page.getByText(/La voz falló/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Salir sin guardar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salir y descartar' }).click();

  await page.goto('/#/settings/models');
  await voice.getByRole('button', { name: 'Desinstalar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar eliminación' }).click();
  await expect(
    page.getByText(/Voz masculina \(México\) se desinstaló\. Espacio liberado: \d+ kB/),
  ).toBeVisible();
  await expect(voice.getByText('Sin instalar', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => caches.has('oratoria-model-piper-es_MX-ald-medium'))).toBe(false);
});

test('Whisper con huella fijada rechaza archivos alterados', async ({ page }) => {
  await routeModels(page);
  await page.goto('/#/settings/models');
  const tiny = card(page, 'Whisper Tiny multilingüe · Q8');
  await tiny.getByRole('button', { name: 'Instalar' }).click();
  await expect(tiny.getByText(/no coincide con la versión fijada|más grande de lo esperado/)).toBeVisible({
    timeout: 20000,
  });
  await expect(tiny.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(tiny.getByText('Instalado', { exact: true })).toHaveCount(0);
});

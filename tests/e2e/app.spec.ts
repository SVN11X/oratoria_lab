import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
function fixtureWav() {
  // Known synthetic signal used only by tests, never inserted into user history automatically.
  const rate = 16000,
    seconds = 2,
    size = rate * seconds * 2,
    buffer = Buffer.alloc(44 + size);
  buffer.write('RIFF');
  buffer.writeUInt32LE(36 + size, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(size, 40);
  for (let i = 0; i < rate * seconds; i++)
    buffer.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * 200 * i) / rate)), 44 + i * 2);
  return buffer;
}
async function importAndSave(page: Page) {
  await page.goto('/#/studio');
  await page.getByLabel('Nombre de la sesión').fill('Prueba de audio');
  await page
    .getByLabel('Importar audio', { exact: true })
    .setInputFiles({ name: 'synthetic-test.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await page.getByRole('button', { name: 'Analizar audio', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prueba de audio', exact: true })).toBeVisible();
}
test('importar, medir, guardar, editar texto, exportar y eliminar', async ({ page }) => {
  await importAndSave(page);
  await expect(page.getByLabel('Reproducir grabación')).toBeVisible();
  await expect(page.getByText('0:02', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Transcripción', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir segmento' }).click();
  await page.getByLabel('Texto del segmento 1').fill('Eh, este es un ejemplo de una práctica real.');
  await page.getByRole('button', { name: 'Guardar transcripción' }).click();
  await expect(page.getByText('Transcripción guardada.', { exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Métricas CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Prueba de audio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar esta sesión' }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación' }).click();
  await expect(page.getByRole('heading', { name: 'Tu historial está por comenzar' })).toBeVisible();
});
test('captura MediaRecorder con micrófono sintético del navegador', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.goto('/#/studio');
  await page.getByRole('button', { name: 'Grabar audio' }).click();
  await expect(page.getByText('Grabando en tu dispositivo', { exact: true })).toBeVisible();
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByText('Grabación en pausa')).toBeVisible();
  await page.getByRole('button', { name: 'Reanudar', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await expect(page.getByLabel('Reproducir grabación')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardar sesión', exact: true })).toBeEnabled();
});
test('explica un permiso rechazado sin fabricar métricas', async ({ page }) => {
  await page.goto('/#/studio');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permiso rechazado', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: 'Grabar audio' }).click();
  await expect(page.getByRole('alert')).toContainText('No se concedió permiso');
  await expect(page.getByRole('button', { name: 'Guardar sesión', exact: true })).toHaveCount(0);
});
test('recorrido de práctica guiada sin atribuir respuestas a IA', async ({ page }) => {
  await page.goto('/#/practice');
  await page.getByLabel('Cantidad de preguntas').selectOption('1');
  await page.getByRole('button', { name: 'Comenzar práctica' }).click();
  await page
    .getByLabel('Tu respuesta')
    .fill('Mi investigación aborda la navegación autónoma y reconoce sus limitaciones.');
  await page.getByRole('button', { name: 'Terminar práctica', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar práctica escrita' }).click();
  await expect(page.getByRole('heading', { name: 'Defensa de tesis', exact: true })).toBeVisible();
  await expect(page.getByText('Ritmo sobre duración total')).toBeVisible();
  await expect(page.getByText('Solo disponible con audio')).toBeVisible();
});
test('pantalla vacía, tema, responsive y accesibilidad', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost:4173') && !request.url().startsWith('blob:'))
      requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('Todavía no hay sesiones')).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  expect(requests).toEqual([]);
});
test('shell abre sin conexión tras preparar Service Worker', async ({ page, context }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Preparar o actualizar uso offline' }).click();
  await expect(page.getByRole('status')).toContainText('Interfaz offline preparada', { timeout: 120000 });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu voz, con perspectiva.' })).toBeVisible();
  await page.getByRole('link', { name: 'Estudio de grabación' }).click();
  await expect(page.getByRole('button', { name: 'Grabar audio' })).toBeVisible();
});
test('copia completa restaura audio y crea una sesión adicional', async ({ page }) => {
  await importAndSave(page);
  await page.getByRole('button', { name: 'Copia completa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copia de esta sesión' });
  await dialog.getByLabel('Protección del archivo').selectOption('plain');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Preparar descarga' }).click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'Restaurar copia' }).click();
  await page
    .getByLabel('Archivo de copia')
    .setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
  await expect(page.getByRole('button', { name: 'Guardar como sesión nueva' })).toBeEnabled();
  await page.getByRole('button', { name: 'Guardar como sesión nueva' }).click();
  await expect(page.getByRole('status')).toContainText('Copia restaurada');
  await expect(page.locator('.session-description')).toHaveCount(2);
  await page.getByRole('link', { name: 'Abrir sesión', exact: true }).click();
  await expect(page.getByLabel('Reproducir grabación')).toBeVisible();
  await expect(page.getByText('0:02', { exact: true }).first()).toBeVisible();
});
test('copia cifrada rechaza contraseña incorrecta y permite restauración explícita', async ({ page }) => {
  await importAndSave(page);
  await page.getByRole('button', { name: 'Copia completa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copia de esta sesión' });
  const secret = 'Una frase privada para pruebas 2026!';
  await dialog.getByLabel('Contraseña de la copia', { exact: true }).fill(secret);
  await dialog.getByLabel('Repetir contraseña').fill(secret);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Preparar descarga' }).click();
  const file = await download,
    buffer = await readFile((await file.path())!);
  expect(file.suggestedFilename()).toBe('sesion-cifrada.oratoria');
  expect(buffer.toString()).not.toContain('Prueba de audio');
  await page.goto('/#/history');
  await page.getByRole('button', { name: 'Restaurar copia' }).click();
  await page
    .getByLabel('Archivo de copia')
    .setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer });
  await page.getByLabel('Contraseña para abrir la copia').fill('Una contraseña incorrecta para pruebas');
  await page.getByRole('button', { name: 'Abrir copia cifrada' }).click();
  await expect(page.getByRole('alert')).toContainText('contraseña no es correcta');
  await expect(page.getByRole('button', { name: 'Guardar como sesión nueva' })).toBeDisabled();
  await page.getByLabel('Contraseña para abrir la copia').fill(secret);
  await page.getByRole('button', { name: 'Abrir copia cifrada' }).click();
  await expect(page.getByRole('button', { name: 'Guardar como sesión nueva' })).toBeEnabled();
  await expect(page.locator('.session-description')).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar como sesión nueva' }).click();
  await expect(page.locator('.session-description')).toHaveCount(2);
});

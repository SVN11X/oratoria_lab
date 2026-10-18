import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { fixtureWav, trackExternal } from './helpers';
async function importAndSave(page: Page) {
  await page.goto('/#/practice/analizar');
  await page.getByLabel('Nombre de la sesión').fill('Prueba de audio');
  await page
    .getByLabel('Importar audio', { exact: true })
    .setInputFiles({ name: 'synthetic-test.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
  await page.getByRole('button', { name: 'Analizar audio', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar en historial', exact: true }).click();
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
  await page.goto('/#/practice/libre');
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
  await expect(page.getByRole('heading', { name: 'Lo que se midió' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar en historial', exact: true })).toBeEnabled();
});
test('explica un permiso rechazado sin fabricar métricas', async ({ page }) => {
  await page.goto('/#/practice/libre');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permiso rechazado', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: 'Grabar audio' }).click();
  await expect(page.getByRole('alert')).toContainText('No se concedió permiso');
  await expect(page.getByRole('button', { name: 'Guardar en historial', exact: true })).toHaveCount(0);
});
test('inicio sin solicitudes externas, tema oscuro y navegación móvil', async ({ page }) => {
  const external = trackExternal(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Entrena para conversaciones que importan.' }),
  ).toBeVisible();
  await expect(page.getByText('Todavía no hay prácticas')).toBeVisible();
  await page.getByRole('button', { name: /Activar modo (oscuro|claro)/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Abrir navegación' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: 'Prácticas guiadas' })
    .click();
  await expect(page.getByRole('heading', { name: 'Defensa de tesis' }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(external).toEqual([]);
});
for (const theme of ['light', 'dark'] as const)
  test(`accesibilidad WCAG 2.2 AA en modo ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('oratoria-preferences-v1', JSON.stringify({ state: { theme: t }, version: 0 }));
    }, theme);
    for (const path of [
      '/',
      '/#/practice',
      '/#/practice/tesis',
      '/#/practice/libre',
      '/#/history',
      '/#/progress',
      '/#/settings/models',
      '/#/settings/audio',
      '/#/settings/privacy',
      '/#/settings/data',
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.waitForTimeout(400);
      const audit = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        audit.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    }
  });
test('shell abre sin conexión tras preparar Service Worker', async ({ page, context }) => {
  await page.goto('/#/settings/data');
  await page.getByRole('button', { name: 'Preparar o actualizar uso sin conexión' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Interfaz offline preparada' })).toBeVisible({
    timeout: 120000,
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Entrena para conversaciones que importan.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Práctica libre' }).click();
  await expect(page.getByRole('button', { name: 'Grabar audio' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: 'Configuración' })
    .click();
  await expect(page.getByRole('heading', { name: 'Modelos de IA', level: 1 })).toBeVisible();
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
  await expect(page.getByRole('status').filter({ hasText: 'Copia restaurada' })).toBeVisible();
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

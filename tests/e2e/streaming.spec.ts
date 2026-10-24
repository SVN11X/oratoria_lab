import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockOllama, presetAi } from './helpers';

test('el flujo llega a la sala, se valida antes de hablar y el diagnóstico exportado no contiene la respuesta privada', async ({
  page,
}) => {
  const server = await mockOllama(
    [{ name: 'qwen3.5:4b', size: 3e9, family: 'qwen35', params: '4B', quant: 'Q4_K_M' }],
    { streamDelayMs: 70 },
  );
  await presetAi(page, {
    useLlm: true,
    provider: 'ollama',
    ollamaUrl: server.url,
    assign: { conversacion: 'qwen3.5:4b', evaluacion: '', embeddings: '' },
    stt: 'escrito',
    tts: 'texto',
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'oratoria-practice-v1',
      JSON.stringify({
        state: {
          setups: {
            tesis: {
              followUps: false,
              openingMinutes: 0,
              avatars: 'ilustrados',
              inputMode: 'texto',
              questions: 2,
            },
          },
        },
        version: 0,
      }),
    );
  });
  try {
    await page.goto('/#/practice/tesis');
    await page.getByLabel('Título de la tesis').fill('Ensayo privado de integración');
    await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
    const draft = page.getByLabel('Borrador de la intervención');
    await expect(draft).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({ timeout: 30000 });
    await expect(draft).toHaveCount(0);
    const callsBefore = server.calls.filter((c) => c.path === '/api/chat').length;
    const privateAnswer =
      'CLAVE_PRIVADA_7x9: elegí A* porque registré un error de doce centímetros en cuarenta pruebas del circuito.';
    await page.getByLabel('Escribe lo esencial de lo que dices').fill(privateAnswer);
    await page.getByRole('button', { name: 'Terminé mi respuesta' }).click();
    await expect(draft).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({ timeout: 30000 });
    expect(server.calls.filter((c) => c.path === '/api/chat').length - callsBefore).toBe(1);
    await page.getByText('Diagnóstico avanzado', { exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar diagnóstico sin contenido' }).click();
    const downloaded = await downloadEvent;
    const diagnostic = await readFile((await downloaded.path())!, 'utf8');
    expect(diagnostic).not.toContain('CLAVE_PRIVADA');
    expect(diagnostic).not.toContain('Ensayo privado');
    expect(diagnostic).not.toContain(server.url);
    const report = JSON.parse(diagnostic);
    expect(report.turns.at(-1).timings.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(report.turns.at(-1).timings.firstAudioMs).toBeUndefined(); // Solo texto no fabrica audio.
    expect(
      server.calls
        .filter((c) => c.path === '/api/chat')
        .every((c) => (c.body as { stream?: boolean }).stream),
    ).toBe(true);
  } finally {
    await server.close();
  }
});

test('el perfil rápido y el razonamiento se conservan sin cambiar las asignaciones de modelos', async ({
  page,
}) => {
  await presetAi(page, {
    useLlm: true,
    assign: { conversacion: 'qwen2.5:7b', evaluacion: 'qwen3.5:9b', embeddings: 'qwen3-embedding:0.6b' },
  });
  await page.goto('/#/settings/models');
  await page.getByLabel('Perfil de ejecución').selectOption('academica');
  await page.getByLabel('Permitir razonamiento cuando el modelo lo soporte').check();
  await page.reload();
  await expect(page.getByLabel('Perfil de ejecución')).toHaveValue('academica');
  await expect(page.getByLabel('Permitir razonamiento cuando el modelo lo soporte')).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('oratoria-ai-v1')!).state);
  expect(saved.assign).toEqual({
    conversacion: 'qwen2.5:7b',
    evaluacion: 'qwen3.5:9b',
    embeddings: 'qwen3-embedding:0.6b',
  });
});

test('la reindexación usa el original y actualiza el estado de preparación', async ({ page }) => {
  await presetAi(page, { stt: 'escrito', tts: 'texto' });
  await page.goto('/#/practice/tesis');
  await page.getByLabel('Representación de los interlocutores').selectOption('ilustrados');
  await page.getByLabel('Elegir archivos de material académico').setInputFiles({
    name: 'tesis-reindexar.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Estudio ficticio\n\n## Metodología\nSe entrevistó a doce docentes.\n\n## Resultados\nEl indicador alcanzó un 45 %.',
    ),
  });
  await expect(page.getByLabel('Usar tesis-reindexar.md en esta práctica')).toBeChecked();
  await page.getByRole('button', { name: 'Reindexar tesis-reindexar.md' }).click();
  await expect(page.getByText(/Índice reconstruido. El archivo original se conserva/)).toBeVisible();
  await expect(page.getByLabel('Usar tesis-reindexar.md en esta práctica')).toBeChecked();
  await page.getByRole('button', { name: 'Ver estructura de tesis-reindexar.md' }).click();
  await expect(page.getByText(/Áreas detectadas: metodologia, resultados/)).toBeVisible();
});

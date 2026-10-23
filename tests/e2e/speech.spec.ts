import { expect, test } from '@playwright/test';
import { fixtureWav, mockOllama, presetAi } from './helpers';

test('análisis libre: cita verificada, persistencia y eliminación del comentario al editar', async ({
  page,
}) => {
  const local = await mockOllama([
    { name: 'prueba:1b', size: 100, family: 'qwen2', params: '1B', quant: 'Q4_K_M' },
  ]);
  const quote = 'Los resultados muestran un error de cuatro centímetros.';
  await presetAi(page, {
    useLlm: true,
    provider: 'ollama',
    ollamaUrl: local.url,
    assign: { conversacion: 'prueba:1b', evaluacion: 'prueba:1b', embeddings: '' },
    stt: 'escrito',
    tts: 'texto',
  });
  await page.route(`${local.url}/api/chat`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        message: {
          content: JSON.stringify({
            comentarios: [
              {
                cita: quote,
                observacion: 'La cifra está expresada de forma concreta.',
                mejora: 'Agrega el número de ensayos.',
                fuentes: [],
              },
              {
                cita: 'Inventé un fragmento que nunca dijiste.',
                observacion: 'Incorrecto',
                mejora: 'No mostrar',
                fuentes: [],
              },
            ],
          }),
        },
      }),
    }),
  );
  try {
    await page.goto('/#/practice/analizar');
    await page
      .getByLabel('Importar audio', { exact: true })
      .setInputFiles({ name: 'prueba.wav', mimeType: 'audio/wav', buffer: fixtureWav() });
    await page.getByRole('button', { name: 'Analizar audio', exact: true }).click();
    await page.getByLabel('Transcripción manual').fill(quote);
    await page.getByRole('button', { name: 'Comentario de contenido con prueba:1b' }).click();
    await expect(page.getByText('Agrega el número de ensayos.', { exact: false })).toBeVisible();
    await expect(page.getByText('Inventé un fragmento', { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Se descartaron 1 comentarios/)).toBeVisible();
    await page.getByRole('button', { name: 'Guardar en historial', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Comentarios de contenido con evidencias' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText('Agrega el número de ensayos.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Transcripción', exact: true }).click();
    await page.getByLabel('Texto del segmento 1').fill('Una nueva transcripción que reemplaza la anterior.');
    await page.getByRole('button', { name: 'Guardar transcripción' }).click();
    await expect(page.getByRole('heading', { name: 'Comentarios de contenido con evidencias' })).toHaveCount(
      0,
    );
  } finally {
    await local.close();
  }
});

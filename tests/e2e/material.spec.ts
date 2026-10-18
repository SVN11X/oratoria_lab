import { expect, test } from '@playwright/test';
import { makeDocx, makePdf, makePptx } from '../fixtures/office';
import { mockOllama, presetAi } from './helpers';

test('material académico: PDF, DOCX y PPTX, estructura, comparación y búsqueda por significado', async ({
  page,
}) => {
  const ollama = await mockOllama([
    {
      name: 'nomic-embed-text:latest',
      size: 274_000_000,
      family: 'nomic-bert',
      params: '137M',
      quant: 'F16',
      embedding: true,
    },
  ]);
  await presetAi(page, {
    useLlm: true,
    provider: 'ollama',
    ollamaUrl: ollama.url,
    assign: { conversacion: '', evaluacion: '', embeddings: 'nomic-embed-text:latest' },
    stt: 'escrito',
    tts: 'texto',
  });
  try {
    await page.goto('/#/practice/tesis');
    const pdf = makePdf([
      [
        { size: 20, text: '1. Introduccion' },
        { size: 11, text: 'El robot navega en bodegas con ROS 2 y un sensor LiDAR.' },
      ],
      [
        { size: 20, text: '2. Resultados' },
        { size: 11, text: 'Se realizaron 40 pruebas con una tasa de exito del 92 %.' },
      ],
    ]);
    const pptx = makePptx([
      { title: 'Introduccion', body: ['Robot para bodegas con LiDAR'] },
      { title: 'Resultados', body: ['Tasa de exito del 85 %'], notes: 'Explicar las pruebas' },
    ]);
    const docx = makeDocx([
      { text: 'Instrucciones de la defensa', style: 'Heading1' },
      { text: 'La exposicion dura 20 minutos y luego hay preguntas de la comision.' },
    ]);
    await page.getByLabel('Elegir archivos de material académico').setInputFiles([
      { name: 'tesis-robot.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) },
      {
        name: 'presentacion-robot.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        buffer: Buffer.from(pptx),
      },
      {
        name: 'instructivo-defensa.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(docx),
      },
    ]);
    for (const name of ['tesis-robot.pdf', 'presentacion-robot.pptx', 'instructivo-defensa.docx'])
      await expect(page.getByLabel(`Usar ${name} en esta práctica`)).toBeChecked({ timeout: 30000 });
    await expect(page.getByText(/2 páginas/)).toBeVisible();
    await expect(page.getByText(/2 diapositivas/)).toBeVisible();

    await page.getByRole('button', { name: 'Ver estructura de tesis-robot.pdf' }).click();
    await expect(page.getByText('2. Resultados', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Comparar presentación con el documento' }).click();
    await expect(page.getByRole('heading', { name: 'Revisión de la presentación' })).toBeVisible();
    await expect(page.getByText(/85 %/).first()).toBeVisible();

    await page.getByRole('button', { name: /Activar búsqueda por significado/ }).click();
    await expect(page.getByText(/Búsqueda por significado lista \(nomic-embed-text:latest\)/)).toBeVisible({
      timeout: 30000,
    });
    expect(ollama.calls.filter((c) => c.path === '/api/embed').length).toBeGreaterThan(0);
  } finally {
    await ollama.close();
  }
});

import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { presetAi } from './helpers';

const original = 'Texto privado reconocido. ' + 'de la identificación '.repeat(90);
const corrected =
  'Elegí el sensor porque permite medir distancias. Por ejemplo, comparé doce mediciones con una referencia externa y registré la dispersión.';

for (const action of ['corrected', 'confirmed', 'retry'] as const)
  test(`revisión de transcripción: ${action}, conservación del original y tiempo oral`, async ({ page }) => {
    await presetAi(page, {
      stt: 'servidor',
      sttServer: { baseUrl: 'http://localhost:9999/v1', model: 'prueba' },
      tts: 'texto',
      useLlm: false,
    });
    let transcriptions = 0;
    await page.route('http://localhost:9999/v1/audio/transcriptions', async (route) => {
      transcriptions++;
      if (transcriptions === 1) await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ text: action === 'retry' && transcriptions > 1 ? corrected : original }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'oratoria-practice-v1',
        JSON.stringify({
          state: {
            setups: {
              tesis: {
                inputMode: 'voz',
                openingMinutes: 0,
                questions: 2,
                followUps: false,
                interruptions: false,
                camera: false,
                record: false,
                avatars: 'ilustrados',
                autoEnd: 0,
              },
            },
          },
          version: 0,
        }),
      );
      // Señal sintética explícita: comprueba captura y flujo, no exactitud del modelo Whisper.
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const source = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        return destination.stream;
      };
    });
    await page.goto('/#/practice/tesis');
    await page.getByLabel('Título de la tesis').fill('Prueba de revisión de transcripción');
    await page.getByRole('button', { name: 'Entrar a la simulación' }).click();
    await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Hablando', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Terminé mi respuesta' }).click();
    const review = page.getByLabel('Revisa la transcripción antes de enviarla');
    await expect(review).toHaveValue(original.trim());
    await expect(page.getByRole('region', { name: 'Revisión de transcripción' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terminar la práctica ahora' })).toHaveCount(0);
    if (action === 'retry') {
      await page.getByRole('button', { name: 'Volver a responder' }).click();
      await expect(page.getByText('Hablando', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Terminé mi respuesta' }).click();
    } else {
      if (action === 'corrected') await review.fill(corrected);
      else
        await page
          .getByLabel('Confirmo que el texto refleja lo que dije, incluidas las repeticiones.')
          .check();
      await page.getByRole('button', { name: 'Enviar transcripción revisada' }).click();
    }
    await expect(review).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Terminé mi respuesta' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Terminar la práctica ahora' }).click();
    await expect(page.getByRole('heading', { name: 'Lo que se observó' })).toBeVisible({ timeout: 30000 });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Datos (JSON)' }).click();
    const file = await downloadEvent;
    const record = JSON.parse(await readFile((await file.path())!, 'utf8'));
    expect(record.snapshot.turns[0].answer.text).toBe(action === 'confirmed' ? original.trim() : corrected);
    expect(!!record.snapshot.turns[0].answer.transcriptReviewed).toBe(action !== 'retry');
    const measuredTurns = record.diagnostics.turns.filter(
      (turn: { timings: { captureMs?: number } }) => turn.timings.captureMs !== undefined,
    );
    expect(measuredTurns[0].timings.transcriptionMs).toBeGreaterThan(1400);
    const measured = measuredTurns.at(-1);
    expect(
      Math.abs(record.snapshot.turns[0].answer.durationSec * 1000 - measured.timings.captureMs),
    ).toBeLessThan(2);
    expect(record.transcriptReviews[0]).toMatchObject({
      original: original.trim(),
      accepted: action === 'retry' ? '' : action === 'confirmed' ? original.trim() : corrected,
      action,
    });
    expect(JSON.stringify(record.diagnostics)).not.toContain('Texto privado');
    expect(
      record.diagnostics.turns.some(
        (turn: { timings: { reviewMs?: number } }) => turn.timings.reviewMs !== undefined,
      ),
    ).toBe(true);
  });

import { expect, test } from '@playwright/test';

test('simulador de defensa: ronda de preguntas sin servicios externos y con informe', async ({ page }) => {
  await page.goto('/#/defense');
  await expect(page.getByRole('heading', { name: 'Ensaya tu defensa frente a una comisión.' })).toBeVisible();
  await page.getByRole('button', { name: 'Solo ronda de preguntas' }).click();
  await page.getByLabel('Título').fill('Robot de prueba');
  await page
    .getByLabel('Resumen o puntos clave')
    .fill(
      'Resumen ficticio de prueba. El robot usa ROS 2 y un sensor LiDAR para construir un mapa de ocupación.',
    );
  await page.getByLabel('Preguntas en la ronda').selectOption('3');
  for (const name of ['Transcripción en vivo', 'Voz de la comisión'])
    await page.locator('label.toggle-field', { hasText: name }).locator('input').uncheck();
  await page.getByRole('button', { name: 'Entrar a la sala' }).click();
  for (let i = 0; i < 3; i++) {
    const done = page.getByRole('button', { name: 'Terminé mi respuesta' });
    await expect(done).toBeVisible({ timeout: 25000 });
    await page
      .getByLabel('Escribe lo esencial de tu respuesta (opcional)')
      .fill(
        'Respuesta ficticia de prueba con una razón y un ejemplo del trabajo realizado en el laboratorio.',
      );
    await done.click();
  }
  await expect(page.getByRole('heading', { name: 'Lo que más te conviene practicar' })).toBeVisible({
    timeout: 40000,
  });
  await expect(page.getByRole('heading', { name: 'Preguntas y respuestas' })).toBeVisible();
  await page.getByRole('button', { name: 'Practicar de nuevo' }).click();
  await expect(page.getByRole('heading', { name: 'Tus intentos anteriores' })).toBeVisible();
});

import { defineConfig, devices } from '@playwright/test';
// PW_CHROMIUM_PATH permite usar un Chromium ya instalado (por ejemplo en entornos sin descarga de navegadores).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      ...(process.env.PW_SOFTWARE_GL === '1'
        ? {
            args: [
              '--use-fake-device-for-media-stream',
              '--use-fake-ui-for-media-stream',
              '--no-zygote',
              '--in-process-gpu',
              '--use-gl=angle',
              '--use-angle=swiftshader',
              '--enable-unsafe-swiftshader',
              '--ignore-gpu-blocklist',
            ],
          }
        : {}),
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm preview', port: 4173, reuseExistingServer: !process.env.CI, timeout: 30000 },
});

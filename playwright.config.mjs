import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'node tools/serve-dist.mjs',
    port: 4173,
    reuseExistingServer: true,
  },
});

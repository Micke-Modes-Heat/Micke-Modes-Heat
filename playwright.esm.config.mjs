import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: {width: 1400, height: 900},
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
  },
});

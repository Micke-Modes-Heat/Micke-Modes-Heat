import { defineConfig } from 'vitest/config';

// Nur Unit-Tests in tests/ — tests-e2e/ gehört Playwright (npm run test:e2e)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
  },
});

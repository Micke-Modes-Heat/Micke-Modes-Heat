import { defineConfig } from 'vitest/config';

// Nur Unit-Tests in tests/ — tests-e2e/ gehört Playwright (npm run test:e2e)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html', 'json-summary'],
      // Ehrlicher Gesamt-Baseline-Wächter (inkl. großer bislang DOM-gebundener
      // Module). Schwellen werden mit jeder neu erschlossenen Schicht angehoben.
      thresholds: {statements: 3.5, branches: 3.8, functions: 3, lines: 3.8},
    },
  },
});

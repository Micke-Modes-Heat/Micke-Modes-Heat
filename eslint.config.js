import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',          // kein ES-Module — globaler Scope
      globals: {
        ...globals.browser,
        // Leaflet
        L: 'readonly',
        // html2canvas
        html2canvas: 'readonly',
      }
    },
    rules: {
      // ── Fehler finden ──
      'no-undef': 'warn',            // fehlende Variablen (warn statt error wegen cross-file globals)
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-constant-condition': 'warn',
      'no-self-assign': 'error',
      'eqeqeq': ['warn', 'smart'],   // === statt == (smart erlaubt == null)

      // ── Nicht zu streng für Vibecoding ──
      'no-empty': 'off',             // leere catch-Blöcke sind OK
      'no-prototype-builtins': 'off',
      'no-fallthrough': 'off',       // switch fallthrough ist absichtlich
    }
  }
];

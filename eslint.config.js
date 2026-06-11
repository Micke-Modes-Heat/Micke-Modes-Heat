import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',           // ES-Module
      globals: {
        ...globals.browser,
        // Leaflet
        L: 'readonly',
        // html2canvas
        html2canvas: 'readonly',
        // JSZip (per <script> geladen, Nutzung mit typeof-Guard)
        JSZip: 'readonly',
      }
    },
    rules: {
      // ── Echte Fehler finden ──
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'warn',
      'no-constant-condition': 'warn',
      'eqeqeq': ['warn', 'smart'],   // === statt == (smart erlaubt == null)

      // ── Seit ESM Phase 2 aktiv: fängt fehlende Imports (Dev-Crashes) in CI ──
      'no-undef': 'error',
      'no-import-assign': 'error',   // Zuweisungen an Imports → Setter verwenden (Muster: setMeritOrderKeys)

      // ── Bewusst deaktiviert ──
      'no-unused-vars': 'off',       // exports used from other modules

      // ── Nicht zu streng ──
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
      'no-fallthrough': 'off',       // switch fallthrough ist absichtlich
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        // Globale Funktionen/Variablen aus den geladenen Scripts
        CalcEngine: 'readonly',
        _dispatchCore: 'readonly',
        _calcKostenShared: 'readonly',
        _optScore: 'readonly',
        _optAnnF: 'readonly',
        _optInvestProKw: 'readonly',
        _defaultGuetegrad: 'readonly',
        _buildOptWorkerCode: 'readonly',
        ERZEUGER_CFG: 'readonly',
        _PV_MONTH: 'readonly',
        _PV_SUN: 'readonly',
        makePvProfile8760: 'readonly',
        standardDNs: 'readonly',
        getUWertForDN: 'readonly',
        getWLD: 'readonly',
        stromEmF: 'readonly', stromEmFLZ: 'readonly',
        gasEmF: 'readonly', heizoelEmF: 'readonly',
        pelletsEmF: 'readonly', hhsEmF: 'readonly',
        fernwaermeEmF: 'readonly',
        pefStrom: 'readonly', pefWP: 'readonly',
        pefGas: 'readonly', pefHeizoel: 'readonly',
        pefPellets: 'readonly', pefHhs: 'readonly',
        pefFernwaerme: 'readonly', PEF_KAPPUNG: 'readonly',
        GEG_VERDRAENGUNG_RATIO: 'readonly',
        // config.test.js globals
        KMR_KOSTEN: 'readonly',
        KABEL_TYPEN: 'readonly',
        NUTZUNG_DEFAULTS: 'readonly',
        OPT_INVEST_DEFAULT: 'readonly',
        OPT_NUTZUNG: 'readonly',
        OPT_IH: 'readonly',
        OPT_MERIT_ORDER: 'readonly',
        // netz-physik.test.js globals
        getKostenProM: 'readonly',
        getVFlowForDN: 'readonly',
        getWLDColor: 'readonly',
        lerpColor: 'readonly',
        // wirtschaft-wgk.test.js globals
        _calcBausteinJK: 'readonly',
        _calcBausteinJKDetail: 'readonly',
      }
    },
    rules: {
      'no-undef': 'warn',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    }
  }
];

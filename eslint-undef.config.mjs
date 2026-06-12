// Temporäre Prüf-Config: wie eslint.config.js, aber mit aktivem no-undef,
// um fehlende Imports (Dev-Modus-Crashes) mechanisch zu finden.
import base from './eslint.config.js';

export default base.map(cfg =>
  cfg.files && cfg.files.includes('src/**/*.js')
    ? { ...cfg, rules: { ...cfg.rules, 'no-undef': 'error' } }
    : cfg
);

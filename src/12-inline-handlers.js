// ── Event-Delegation für data-* Handler ──────────────────────────────────
// Ersetzt inline onclick/oninput/onchange — Handler-Code steht in data-Attributen.
import { _renderOptKostenUebersicht } from './07b-analysis-economics.js';

(function() {
  // Allowed prefixes: function call, event., this., document., !function, or multi-statement starting with one of these
  const _SAFE = /^\s*(!?\s*)?([\w$][\w$]*\s*\(|event\.|this\.|document\.)/;
  function exec(el, code) {
    if (!_SAFE.test(code)) {
      console.warn('[Security] Blocked data-handler with unexpected pattern:', code);
      return;
    }
    try { new Function('event', code).call(el, event); }
    catch(e) { console.error('Handler-Fehler:', code, e); }
  }

  document.addEventListener('click', function(event) {
    const el = event.target.closest('[data-click]');
    if (el) exec(el, el.dataset.click);
  });

  document.addEventListener('input', function(event) {
    const el = event.target.closest('[data-input]');
    if (el) exec(el, el.dataset.input);
  });

  document.addEventListener('change', function(event) {
    const el = event.target.closest('[data-change]');
    if (el) exec(el, el.dataset.change);
  });

  document.addEventListener('keydown', function(event) {
    const el = event.target.closest('[data-keydown]');
    if (el) exec(el, el.dataset.keydown);
  });
})();

// ── Spezielle addEventListener-Registrierungen ──────────────────────────
document.getElementById('opt-erklaerung-details').addEventListener('toggle', function() {
  document.getElementById('opt-erklaerung-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
});
document.getElementById('opt-kosten-details').addEventListener('toggle', function() {
  document.getElementById('opt-kosten-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
  if (this.open) _renderOptKostenUebersicht();
});

// ── Event-Delegation für data-* Handler ──────────────────────────────────
// Ersetzt inline onclick/oninput/onchange — Handler-Code steht in data-Attributen.
import { _renderOptKostenUebersicht } from './07b-analysis-economics.js';

// Allowed prefixes: function call, event., this., document., !function, or multi-statement starting with one of these
const _SAFE = /^\s*(!?\s*)?([\w$][\w$]*\s*\(|event\.|this\.|document\.|window\.)/;
function exec(el, code, event) {
  if (!_SAFE.test(code)) {
    console.warn('[Security] Blocked data-handler with unexpected pattern:', code);
    return;
  }
  try { new Function('event', code).call(el, event); }
  catch(e) { console.error('Handler-Fehler:', code, e); }
}

/** Hängt die data-*-Delegation an ein Dokument — das Haupt-Dokument und das Auswertungsfenster (src/55). */
export function inlineHandlerAnbinden(doc) {
  if (doc._inlineHandlerAn) return;
  doc._inlineHandlerAn = true;
  doc.addEventListener('click', function(event) {
    const el = event.target.closest('[data-click]');
    if (el) {
      if (!el.classList.contains('asset-palette-btn') && window._pendingAssetType) {
        window.cancelPendingAsset?.();
      }
      exec(el, el.dataset.click, event);
    }
  });

  doc.addEventListener('input', function(event) {
    const el = event.target.closest('[data-input]');
    if (el) exec(el, el.dataset.input, event);
  });

  doc.addEventListener('change', function(event) {
    const el = event.target.closest('[data-change]');
    if (el) exec(el, el.dataset.change, event);
  });

  doc.addEventListener('keydown', function(event) {
    const el = event.target.closest('[data-keydown]');
    if (el) exec(el, el.dataset.keydown, event);
  });
}
inlineHandlerAnbinden(document);

// ── Spezielle addEventListener-Registrierungen ──────────────────────────
document.getElementById('opt-erklaerung-details').addEventListener('toggle', function() {
  document.getElementById('opt-erklaerung-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
});
document.getElementById('opt-kosten-details').addEventListener('toggle', function() {
  document.getElementById('opt-kosten-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
  if (this.open) _renderOptKostenUebersicht();
});
document.getElementById('spot-preise-details').addEventListener('toggle', function() {
  document.getElementById('spot-preise-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
});

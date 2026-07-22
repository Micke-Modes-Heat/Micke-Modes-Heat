// Gemeinsamer Abschluss einer Optimierungslauf-Sitzung. Liegt bewusst zwischen
// Orchestrierung und Worker-Darstellung, damit diese Module sich nicht importieren.
export function _optFinished() {
  window._optRunning = false;
  window._optWorker = null;
  window._optWorkers = [];
  const btn = document.getElementById('btn-opt-start');
  if (btn) {
    btn.removeAttribute('data-running');
    btn.innerHTML = '&#x26A1; Beste Varianten suchen';
    btn.disabled = false;
  }
}

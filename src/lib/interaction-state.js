// @ts-check
import { appLifecycle } from './lifecycle.js';

/** @typedef {{id:string,label:string,hint:string,cancel:()=>void,startedAt:string}} ActiveInteraction */
/** @type {ActiveInteraction|null} */
let active = null;
let transitioning = false;
let escapeBound = false;

function renderStatus() {
  if (typeof document === 'undefined') return;
  let banner = document.getElementById('map-interaction-status');
  if (!active) {
    banner?.remove();
    document.body?.removeAttribute('data-map-tool');
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'map-interaction-status';
    banner.setAttribute('role','status');
    banner.setAttribute('aria-live','polite');
    Object.assign(banner.style, {
      position:'fixed',left:'50%',bottom:'22px',transform:'translateX(-50%)',zIndex:'10050',
      maxWidth:'min(720px,calc(100vw - 28px))',padding:'9px 12px',borderRadius:'8px',
      background:'rgba(12,18,28,.94)',border:'1px solid rgba(79,195,247,.65)',color:'#eef7fb',
      boxShadow:'0 5px 22px rgba(0,0,0,.35)',fontSize:'12px',pointerEvents:'auto'
    });
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<strong>${active.label}</strong><span style="margin-left:8px;color:#b0bec5">${active.hint}</span><button type="button" data-cancel-map-tool style="margin-left:12px;border:1px solid rgba(255,255,255,.25);border-radius:5px;background:transparent;color:inherit;padding:2px 7px;cursor:pointer">Abbrechen (Esc)</button>`;
  banner.querySelector('[data-cancel-map-tool]')?.addEventListener('click', () => cancelInteraction());
  document.body?.setAttribute('data-map-tool',active.id);
}

function bindEscape() {
  if (escapeBound || typeof document === 'undefined') return;
  appLifecycle.listen(document,'keydown', event => {
    if (/** @type {KeyboardEvent} */ (event).key !== 'Escape' || !active) return;
    event.preventDefault();
    cancelInteraction();
  });
  escapeBound = true;
}

/**
 * Aktiviert genau ein Kartenwerkzeug. Ein zuvor aktives Werkzeug wird über
 * dessen registrierten Abbruch-Lebenszyklus vollständig beendet.
 * @param {{id:string,label:string,hint?:string,cancel:()=>void}} interaction
 */
export function beginInteraction(interaction) {
  if (!interaction?.id || typeof interaction.cancel !== 'function') throw new TypeError('Karteninteraktion benötigt ID und cancel()');
  if (active?.id === interaction.id) return false;
  if (active) cancelInteraction(active.id);
  active = {id:interaction.id,label:interaction.label || interaction.id,hint:interaction.hint || '',cancel:interaction.cancel,startedAt:new Date().toISOString()};
  bindEscape();
  renderStatus();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mapinteractionchange',{detail:getActiveInteraction()}));
  return true;
}

/** @param {string} [id] */
export function cancelInteraction(id) {
  if (!active || (id && active.id !== id) || transitioning) return false;
  const previous = active;
  active = null;
  transitioning = true;
  try { previous.cancel(); }
  finally {
    transitioning = false;
    renderStatus();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mapinteractionchange',{detail:null}));
  }
  return true;
}

/** Erfolgreicher Abschluss ohne erneuten Aufruf von cancel(). @param {string} id */
export function commitInteraction(id) {
  if (!active || active.id !== id) return false;
  active = null;
  renderStatus();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mapinteractionchange',{detail:null}));
  return true;
}

export function getActiveInteraction() {
  return active ? {id:active.id,label:active.label,hint:active.hint,startedAt:active.startedAt} : null;
}

/** Nur für Projektwechsel und Tests. */
export function resetInteractionState() {
  if (active) cancelInteraction();
  active = null;
  renderStatus();
}

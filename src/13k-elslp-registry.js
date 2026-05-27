// ── 13k-elslp-registry.js — Elektrisches SLP-Profil-Register ────────────────
//
// Enthält die BDEW-Standardlastprofile mit spezifischer Leistung [W/m²]
// für die automatische kW-Ermittlung aus Gebäudeflächen.
// Unabhängig von den Wärme-Nutzungstypen (02b-gebaeude.js).

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Built-in BDEW-Profile ────────────────────────────────────────────────────
const _ELSLP_BUILTIN = [
  { id:'H0',  label:'Haushalt',                      gruppe:'Wohnen',         wpm2: 12 },
  { id:'G0',  label:'Gewerbe allgemein',              gruppe:'Gewerbe',        wpm2: 20 },
  { id:'G1',  label:'Gewerbe werktags 8–18 Uhr',     gruppe:'Gewerbe',        wpm2: 22 },
  { id:'G2',  label:'Gewerbe mit Abendverbrauch',    gruppe:'Gewerbe',        wpm2: 15 },
  { id:'G3',  label:'Gewerbe durchlaufend',           gruppe:'Gewerbe',        wpm2: 30 },
  { id:'G4',  label:'Laden / Friseur',                gruppe:'Handel',         wpm2: 35 },
  { id:'G5',  label:'Bäckerei',                       gruppe:'Handel',         wpm2: 55 },
  { id:'G6',  label:'Wochenendbetrieb',               gruppe:'Gewerbe',        wpm2: 14 },
  { id:'L0',  label:'Landwirtschaft allgemein',       gruppe:'Landwirtschaft', wpm2:  6 },
  { id:'L1',  label:'Landwirtschaft Milchwirtschaft', gruppe:'Landwirtschaft', wpm2:  9 },
  { id:'L2',  label:'Landwirtschaft Eigenerzeugung',  gruppe:'Landwirtschaft', wpm2:  5 },
];

// W/m²-Overrides für Built-in-Profile (projekt-persistent, editierbar im Modal)
export let ELSLP_WPM2 = {};   // { slpId: wpm2 } — überschreibt _ELSLP_BUILTIN[].wpm2

// Custom-Profile (projekt-persistent, voll editierbar)
export let ELSLP_CUSTOM = [];  // [{ id, label, gruppe, wpm2 }]

// ── Zugriffshelfer ───────────────────────────────────────────────────────────
export function getElSlpProfiles() { return [..._ELSLP_BUILTIN, ...ELSLP_CUSTOM]; }
export function getElSlpById(id)   { return getElSlpProfiles().find(p => p.id === id) || null; }
export function isBuiltinElSlp(id) { return _ELSLP_BUILTIN.some(p => p.id === id); }
export function getElSlpWpm2(id)   {
  if (ELSLP_WPM2[id] != null) return ELSLP_WPM2[id];
  return getElSlpById(id)?.wpm2 ?? 15;
}

// Gruppen für Dropdown-Optgroup
export function getElSlpGruppen() {
  const seen = new Set();
  return getElSlpProfiles().map(p => p.gruppe).filter(g => { if (seen.has(g)) return false; seen.add(g); return true; });
}

// ── Profil-Verwaltungs-Modal ─────────────────────────────────────────────────
export function showElSlpModal(onClose) {
  document.getElementById('elslp-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id        = 'elslp-modal';
  overlay.className = 'ep-modal-overlay';
  overlay.style.zIndex = '25000';

  const modal = document.createElement('div');
  modal.className = 'ep-modal';
  modal.style.cssText = 'width:580px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden;';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });

  function _close() { overlay.remove(); onClose?.(); }

  function _render() {
    const builtinRows = _ELSLP_BUILTIN.map(p => {
      const wpm2 = ELSLP_WPM2[p.id] ?? p.wpm2;
      const changed = ELSLP_WPM2[p.id] != null && ELSLP_WPM2[p.id] !== p.wpm2;
      return `<tr data-slpid="${esc(p.id)}" class="elslp-row">
        <td><span class="aw-slp-tag">${esc(p.id)}</span></td>
        <td class="elslp-label">${esc(p.label)}</td>
        <td class="elslp-gruppe">${esc(p.gruppe)}</td>
        <td style="text-align:right;">
          <input class="aw-cfg-input elslp-wpm2" type="number"
            data-slpid="${esc(p.id)}" value="${wpm2}" min="0.1" max="9999" step="0.5"
            style="width:60px;${changed?'border-color:#f9a825;':''}"
            title="${changed ? 'Geändert (Standard: '+p.wpm2+' W/m²)' : ''}">
        </td>
        <td style="text-align:center;">
          ${changed ? `<button class="nt-del-btn" data-reset="${esc(p.id)}" title="Auf Standard zurücksetzen">↺</button>` : '<span style="color:var(--muted);font-size:9px;">—</span>'}
        </td>
      </tr>`;
    }).join('');

    const customRows = ELSLP_CUSTOM.length === 0
      ? `<tr><td colspan="5" class="nt-empty" style="padding:8px;">Keine eigenen Profile vorhanden</td></tr>`
      : ELSLP_CUSTOM.map((p, i) => `<tr data-idx="${i}" class="elslp-row">
          <td>
            <input class="aw-cfg-input elslp-id-inp" type="text"
              data-idx="${i}" data-field="id" value="${esc(p.id)}"
              style="width:52px;font-family:'DM Mono',monospace;text-transform:uppercase;">
          </td>
          <td>
            <input class="aw-cfg-input elslp-label-inp" type="text"
              data-idx="${i}" data-field="label" value="${esc(p.label)}" style="width:160px;">
          </td>
          <td>
            <input class="aw-cfg-input elslp-gruppe-inp" type="text"
              data-idx="${i}" data-field="gruppe" value="${esc(p.gruppe)}" style="width:110px;">
          </td>
          <td style="text-align:right;">
            <input class="aw-cfg-input elslp-wpm2-custom" type="number"
              data-idx="${i}" value="${p.wpm2}" min="0.1" max="9999" step="0.5" style="width:60px;">
          </td>
          <td style="text-align:center;">
            <button class="nt-del-btn" data-del="${i}" title="Löschen">✕</button>
          </td>
        </tr>`).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0;">
        <span style="font-size:12px;color:var(--accent);font-weight:600;">⚡ SLP-Profile verwalten</span>
        <button class="ebp-close" id="elslp-close">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:12px 16px;">

        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">
          BDEW-Standard (W/m² anpassbar)
        </div>
        <table class="aw-nt-table" style="margin-bottom:14px;">
          <thead><tr>
            <th>ID</th><th>Bezeichnung</th><th>Gruppe</th>
            <th style="text-align:right;">W/m²</th>
            <th style="text-align:center;">Reset</th>
          </tr></thead>
          <tbody>${builtinRows}</tbody>
        </table>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">
            Eigene Profile
          </div>
          <button class="aw-cfg-apply-btn" id="elslp-add" style="font-size:9px;padding:2px 8px;">+ Hinzufügen</button>
        </div>
        <table class="aw-nt-table" id="elslp-custom-table">
          <thead><tr>
            <th>ID</th><th>Bezeichnung</th><th>Gruppe</th>
            <th style="text-align:right;">W/m²</th>
            <th></th>
          </tr></thead>
          <tbody>${customRows}</tbody>
        </table>

        <div style="margin-top:10px;font-size:9px;color:var(--muted);font-style:italic;">
          W/m² = spezifische Spitzenlast. Formel: kW = Fläche [m²] × W/m² ÷ 1000
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px;background:var(--surface2);border-top:1px solid var(--border);flex-shrink:0;">
        <button class="ep-modal-btn" id="elslp-cancel">Abbrechen</button>
        <button class="ep-modal-btn primary" id="elslp-save">Speichern ✓</button>
      </div>`;

    // Events
    modal.querySelector('#elslp-close').onclick  = _close;
    modal.querySelector('#elslp-cancel').onclick = _close;

    // Reset Built-in W/m²
    modal.querySelectorAll('[data-reset]').forEach(btn => {
      btn.onclick = () => { delete ELSLP_WPM2[btn.dataset.reset]; _render(); };
    });

    // Eigenes Profil löschen
    modal.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => { ELSLP_CUSTOM.splice(parseInt(btn.dataset.del), 1); _render(); };
    });

    // Neues Profil hinzufügen
    modal.querySelector('#elslp-add').onclick = () => {
      ELSLP_CUSTOM.push({ id:'NEU', label:'Neues Profil', gruppe:'Eigene', wpm2:15 });
      _render();
      // Fokus auf letztes ID-Feld
      const inputs = modal.querySelectorAll('.elslp-id-inp');
      inputs[inputs.length - 1]?.focus();
      inputs[inputs.length - 1]?.select();
    };

    // Speichern
    modal.querySelector('#elslp-save').onclick = () => {
      // Built-in W/m² Overrides
      modal.querySelectorAll('.elslp-wpm2').forEach(inp => {
        const id  = inp.dataset.slpid;
        const val = parseFloat(inp.value);
        const def = _ELSLP_BUILTIN.find(p => p.id === id)?.wpm2 ?? 15;
        if (!isNaN(val) && val !== def) ELSLP_WPM2[id] = val;
        else delete ELSLP_WPM2[id];
      });
      // Custom Profile updaten
      modal.querySelectorAll('#elslp-custom-table tbody tr[data-idx]').forEach(row => {
        const i = parseInt(row.dataset.idx);
        if (!ELSLP_CUSTOM[i]) return;
        const idInp    = row.querySelector('.elslp-id-inp');
        const labelInp = row.querySelector('.elslp-label-inp');
        const gruppeInp= row.querySelector('.elslp-gruppe-inp');
        const wpm2Inp  = row.querySelector('.elslp-wpm2-custom');
        if (idInp)    ELSLP_CUSTOM[i].id     = idInp.value.trim().toUpperCase() || ELSLP_CUSTOM[i].id;
        if (labelInp) ELSLP_CUSTOM[i].label  = labelInp.value.trim() || ELSLP_CUSTOM[i].label;
        if (gruppeInp)ELSLP_CUSTOM[i].gruppe = gruppeInp.value.trim() || 'Eigene';
        if (wpm2Inp)  ELSLP_CUSTOM[i].wpm2   = parseFloat(wpm2Inp.value) || ELSLP_CUSTOM[i].wpm2;
      });
      _close();
    };
  }

  _render();
}

// Window-Bridge
setTimeout(() => { window.showElSlpModal = showElSlpModal; }, 0);

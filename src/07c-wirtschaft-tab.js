// ── Wirtschaftlichkeit-Tab (Detail der aktiven Variante) ────────────────
// Top-Level View, eingebunden über setViewMode('wirtschaft').
//
// Phase 4a: KPI-Bar + Stacked-Bar + Donut + 4 Akkordeon-Tabellen,
//           alles aus echten Daten der aktiven Variante (read-only).
// Phase 4b: Editierlogik, Add/Remove/Vorlage einfügen, Energieprofil.

import {
  activeVariantId, varianten,
  addKostenpunkt, removeKostenpunkt, updateKostenpunkt,
  hideAutoId, unhideAutoId, createKostenPunkt,
  getActiveHiddenAutoIds,
} from './01-globals-varianten.js';
import { getWirtschaftSummary } from './07b-analysis-economics.js';
import { CalcEngine } from './08-calc-engine.js';
import { getAllVorlagen, KATEGORIEN, saveUserVorlage, loadUserVorlagen } from './config/kostenkomponenten-cfg.js';

// ── Berechnungs-Annahme pro Baustein-Typ ──────────────────────────────
// Erzeuger ('ce' gesetzt): Kostenkurve aus CalcEngine.INVEST_KURVEN holen.
// Pauschale ('fixed' gesetzt): festgelegte Annahme-Beschreibung.
const BAUSTEIN_INFO = {
  // Wärmeerzeuger — Kostenkurve aus KWW-Technikkatalog 2025
  lwwp:        { ce: 'LuftWP',        pKwKey: 'lwwp',        source: 'KWW-Technikkatalog 2025' },
  fg:          { ce: 'FlussWP',       pKwKey: 'fg',          source: 'KWW-Technikkatalog 2025' },
  geo_wp:      { ce: 'GeoWP',         pKwKey: 'geo',         source: 'KWW-Technikkatalog 2025' },
  gk:          { ce: 'Gaskessel',     pKwKey: 'gaskessel',   source: 'KWW-Technikkatalog 2025' },
  hko:         { ce: 'Heizoel',       pKwKey: 'heizoel',     source: 'KWW-Technikkatalog 2025' },
  bhkw:        { ce: 'BHKW',          pKwKey: 'bhkw',        source: 'KWW-Technikkatalog 2025' },
  pk:          { ce: 'Pellets',       pKwKey: 'pellets',     source: 'KWW-Technikkatalog 2025' },
  hhs_kessel:  { ce: 'Hackschnitzel', pKwKey: 'hhs',         source: 'KWW-Technikkatalog 2025' },
  stromkessel: { ce: 'Stromkessel',   pKwKey: 'stromkessel', source: 'KWW-Technikkatalog 2025' },
  // Pauschale Annahmen (in _calcKostenShared hinterlegt)
  geo_sonden:    { fixed: '95 €/m Bohrtiefe',                detail: ctx => `${Math.round(ctx.bohrMeter)} m Sonden` },
  pk_lager:      { fixed: '100 €/kW Pellet-Leistung',         detail: ctx => `${Math.round(ctx.pKw.pellets || 0)} kW` },
  hhs_lager:     { fixed: '150 €/kW HHS-Leistung',            detail: ctx => `${Math.round(ctx.pKw.hhs || 0)} kW` },
  bhkw_hydr:     { fixed: '150 €/kW BHKW-thermisch',          detail: ctx => `${Math.round(ctx.pKw.bhkw || 0)} kW` },
  fw_pumpe:      { fixed: '80 €/kW Fernwärme',                detail: ctx => `${Math.round(ctx.pKw.fernwaerme || 0)} kW` },
  solarthermie:  { fixed: '300 €/m² Kollektorfläche',         detail: ctx => `${Math.round(ctx.stM2)} m²` },
  thermSpeicher: { fixed: '40–100 €/kWh (je Volumen + Speichertyp)' },
  puffer:        { fixed: '25 €/kWh (1 h Volllast pauschal)' },
  schornstein:   { fixed: '60 €/kW Verbrennungsleistung' },
  schallschutz:  { fixed: '75 €/kW (Luft-WP + BHKW)' },
  entstaubung:   { fixed: '20–40 k€ pauschal (je Bio-Leistung)' },
  huest:         { fixed: '5–15 k€ pro Gebäude (je Avg-Last)', detail: ctx => `${ctx.nGeb} Gebäude` },
  netzanschluss: { fixed: '40 €/kW elektrische Leistung' },
  fg_entnahme:   { fixed: '300 €/kW Flusswasser-WP' },
  waermenetz:    { fixed: 'Aus Trassen-Berechnung (Modul stromnetz-invest)' },
  bauteil:       { fixed: '5 % der Basis-Investition (Hülle, Boden, Türen)' },
  hydr_elt:      { fixed: '12 % der Basis-Investition (Hydraulik + Elektrik)' },
  planung:       { fixed: '10 % der Basis-Investition' },
  unvorg:        { fixed: '7 % der Basis-Investition (Risikopuffer)' },
};

// Vollständigen Tooltip-Text für eine Zeile bauen (mehrzeilig, für title-Attribut).
function bausteinTooltip(b, ctx) {
  const info = BAUSTEIN_INFO[b.id];
  const lines = [];
  if (info?.ce && CalcEngine?.INVEST_KURVEN?.[info.ce]) {
    const K = CalcEngine.INVEST_KURVEN[info.ce];
    const kw = ctx.pKw[info.pKwKey] || 0;
    const eurPerKw = kw > 0.1 ? CalcEngine.investEurProKw(info.ce, kw) : 0;
    if (kw > 0) {
      const isZen = kw > (K.maxDez || 100);
      const a = isZen ? K.aZen : K.aDez;
      const bExp = isZen ? K.bZen : K.bDez;
      if (a && bExp) lines.push(`Kostenkurve: ${a} × P^(${(bExp - 1).toFixed(2)})  →  ${Math.round(eurPerKw)} €/kW @ ${Math.round(kw)} kW (${isZen ? 'zentral' : 'dezentral'})`);
      else if (eurPerKw > 0) lines.push(`Spez.: ${Math.round(eurPerKw)} €/kW bei ${Math.round(kw)} kW`);
    }
    if (info.source) lines.push(`Quelle: ${info.source}`);
  } else if (info?.fixed) {
    lines.push(`Annahme: ${info.fixed}`);
    if (info.detail) try { lines.push(`Aktuell: ${info.detail(ctx)}`); } catch {}
  }
  return lines.join('\n');
}

// ── Edit-Helper: schreiben in window-Overrides + triggern calcWirtschaftPanel + re-render ──
function _showLoading() {
  const c = document.getElementById('wirtschaft-content');
  if (!c) return;
  let ov = c.querySelector('.wt-loading');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'wt-loading';
    ov.innerHTML = '<div class="wt-loading-dot"></div><div class="wt-loading-dot"></div><div class="wt-loading-dot"></div>';
    c.style.position = 'relative';
    c.appendChild(ov);
  }
  ov.style.display = 'flex';
}
function _hideLoading() {
  const ov = document.querySelector('#wirtschaft-content .wt-loading');
  if (ov) ov.style.display = 'none';
}
function _triggerRecalc() {
  _showLoading();
  // Mikrotask, damit der Browser den Loading-Overlay rendert bevor die Berechnung blockiert
  Promise.resolve().then(() => {
    if (typeof window.calcWirtschaftPanel === 'function') {
      try { window.calcWirtschaftPanel(); } catch (e) { console.warn(e); }
    }
    refreshWirtschaftView();
    _hideLoading();
  });
}

window._wirtBausteineOverrides = window._wirtBausteineOverrides || {};
window._wirtVdiOverrides       = window._wirtVdiOverrides       || {};

// User-IDs erkennen: User-Kostenpunkte haben IDs der Form 'kp_xxx' (siehe _newKpId).
function _isUserKp(id) { return typeof id === 'string' && id.startsWith('kp_'); }

// Wert: Zahl oder leerer String. Bei Auto-Baustein: leer = Override entfernen.
// Bei User-Baustein: direkter Update auf den KostenPunkt.
export function setInvOverride(id, raw) {
  const txt = String(raw).trim().replace(/\./g, '').replace(',', '.');
  const n = txt === '' ? null : parseFloat(txt);
  if (_isUserKp(id)) {
    if (n != null && !isNaN(n) && n >= 0) updateKostenpunkt(id, { invest: Math.round(n) });
  } else {
    if (txt === '') delete window._wirtBausteineOverrides[id];
    else if (n != null && !isNaN(n) && n >= 0) window._wirtBausteineOverrides[id] = Math.round(n);
  }
  _triggerRecalc();
}
export function setVdiOverride(id, field, raw) {
  const txt = String(raw).trim().replace(',', '.');
  const n = txt === '' ? null : parseFloat(txt);
  if (_isUserKp(id)) {
    const map = { n: 'ndOverride', inst: 'instOverride', wart: 'wartOverride', bedien: 'bedOverride' };
    const f = map[field];
    if (f) {
      if (txt === '' || isNaN(n)) updateKostenpunkt(id, { [f]: undefined });
      else if (n >= 0)            updateKostenpunkt(id, { [f]: n });
    }
  } else {
    if (txt === '') {
      if (window._wirtVdiOverrides[id]) {
        delete window._wirtVdiOverrides[id][field];
        if (!Object.keys(window._wirtVdiOverrides[id]).length) delete window._wirtVdiOverrides[id];
      }
    } else if (n != null && !isNaN(n) && n >= 0) {
      window._wirtVdiOverrides[id] = window._wirtVdiOverrides[id] || {};
      window._wirtVdiOverrides[id][field] = n;
    }
  }
  _triggerRecalc();
}
export function resetInvOverride(id) { delete window._wirtBausteineOverrides[id]; _triggerRecalc(); }
export function resetVdiOverride(id, field) {
  if (window._wirtVdiOverrides[id]) {
    delete window._wirtVdiOverrides[id][field];
    if (!Object.keys(window._wirtVdiOverrides[id]).length) delete window._wirtVdiOverrides[id];
  }
  _triggerRecalc();
}

// Zeile entfernen: User-Baustein → komplett löschen, Auto-Baustein → ausblenden.
export function deleteKostenRow(id, isUser) {
  if (isUser) removeKostenpunkt(id);
  else hideAutoId(id);
  _triggerRecalc();
}
// Ausgeblendeten Auto-Baustein wiederherstellen.
export function unhideKostenRow(id) {
  unhideAutoId(id);
  _triggerRecalc();
}
// Neuen User-Kostenpunkt aus Vorlage hinzufügen.
// Bei User-Vorlagen aus localStorage werden die Defaults direkt als Override
// in den KP geschrieben (sonst würde calcWirtschaftPanel sie nicht finden).
export function addKostenFromVorlage(typeKey) {
  const allVorlagen = getAllVorlagen();
  const v = allVorlagen.find(x => x.typeKey === typeKey);
  const kp = createKostenPunkt({ typeKey, name: v?.name });
  if (v?.isUser) {
    if (v.n      != null) kp.ndOverride   = v.n;
    if (v.inst   != null) kp.instOverride = v.inst;
    if (v.wart   != null) kp.wartOverride = v.wart;
    if (v.bedien != null) kp.bedOverride  = v.bedien;
  }
  addKostenpunkt(kp);
  _triggerRecalc();
}
// Neuen User-Kostenpunkt mit eigenem Namen hinzufügen.
export function addKostenCustom() {
  const kp = createKostenPunkt({ typeKey: 'sonstiges', name: 'Eigene Position', invest: 0 });
  addKostenpunkt(kp);
  _triggerRecalc();
}

// User-Position als wiederverwendbare Vorlage in localStorage speichern.
export async function saveAsVorlage(kp, currentLabel) {
  const name = await showPrompt({
    title: 'Als Vorlage speichern',
    message: 'Diese Position wird in deine persönliche Vorlagen-Bibliothek gespeichert und steht in allen Projekten zur Verfügung.',
    defaultValue: currentLabel || kp.name || 'Eigene Vorlage',
    placeholder: 'Vorlagen-Name',
    confirmLabel: 'Speichern',
  });
  if (!name) return;
  // Slug + Timestamp für eindeutigen typeKey
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
  const typeKey = 'user_' + slug + '_' + Date.now().toString(36).slice(-4);
  saveUserVorlage(typeKey, {
    kategorie: 'sonst',
    name,
    n:      kp.ndOverride   ?? 20,
    inst:   kp.instOverride ?? 0,
    wart:   kp.wartOverride ?? 0,
    bedien: kp.bedOverride  ?? 0,
  });
  _triggerRecalc();
}
// Eingabeparameter (Strompreis, Zins, …) in DOM-Input des alten Float-Panels schreiben + recalc.
// Spezialfall: wirt-pct-* → in window._wirtPctSettings persistieren.
export function setEingabeParam(domId, raw) {
  if (domId && domId.startsWith('wirt-pct-')) {
    const key = domId.replace('wirt-pct-', '');
    const num = parseFloat(String(raw).replace(',', '.'));
    window._wirtPctSettings = window._wirtPctSettings || {};
    if (isFinite(num) && num >= 0) window._wirtPctSettings[key] = num;
    else delete window._wirtPctSettings[key];
  }
  const el = document.getElementById(domId);
  if (el) el.value = raw;
  _triggerRecalc();
}

// Helper für editierbare Tabellen-Zelle. invOv/vdiOv aus context.overrides.
function editCellInv(b, value, invOv) {
  const isOv = invOv[b.id] != null;
  const v = isOv ? invOv[b.id] : value;
  return `<td class="wt-edit-cell"><div class="wt-cell-input-wrap">
    <input class="wt-cell-input r${isOv ? ' override' : ''}" value="${formatInputNum(v)}"
      data-edit="inv" data-id="${escAttr(b.id)}">
    ${isOv ? `<button class="wt-cell-reset" data-reset-inv="${escAttr(b.id)}" title="Auf Auto-Wert zurücksetzen">↺</button>` : ''}
  </div></td>`;
}
function editCellVdi(b, field, value, vdiOv, suffix) {
  const isOv = vdiOv[b.id] && vdiOv[b.id][field] != null;
  const v = isOv ? vdiOv[b.id][field] : value;
  return `<td class="wt-edit-cell"><div class="wt-cell-input-wrap">
    <input class="wt-cell-input c${isOv ? ' override' : ''}" value="${formatInputNum(v)}"
      data-edit="vdi" data-id="${escAttr(b.id)}" data-field="${field}">
    <span style="font-size:10px;color:var(--muted);">${suffix || ''}</span>
    ${isOv ? `<button class="wt-cell-reset" data-reset-vdi="${escAttr(b.id)}" data-reset-field="${field}" title="Auf Auto-Wert zurücksetzen">↺</button>` : ''}
  </div></td>`;
}
function formatInputNum(v) {
  if (v == null || isNaN(v)) return '';
  // Ganzzahl → keine Nachkommastelle, sonst max. 2
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ',');
}
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// Custom Prompt-Dialog mit Texteingabe — gibt Promise<string|null> zurück.
function showPrompt({ title, message, defaultValue = '', confirmLabel = 'Speichern', cancelLabel = 'Abbrechen', placeholder = '' }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'wt-confirm-overlay';
    ov.innerHTML = `
      <div class="wt-confirm-box">
        <div class="wt-confirm-title">${escHtml(title)}</div>
        <div class="wt-confirm-msg">${escHtml(message)}</div>
        <input type="text" class="wt-prompt-input" placeholder="${escAttr(placeholder)}" value="${escAttr(defaultValue)}">
        <div class="wt-confirm-actions">
          <button class="wt-confirm-cancel">${escHtml(cancelLabel)}</button>
          <button class="wt-confirm-ok">${escHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const inp = ov.querySelector('.wt-prompt-input');
    const close = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') { e.preventDefault(); close(inp.value.trim() || null); }
    };
    ov.querySelector('.wt-confirm-cancel').addEventListener('click', () => close(null));
    ov.querySelector('.wt-confirm-ok').addEventListener('click', () => close(inp.value.trim() || null));
    ov.addEventListener('click', e => { if (e.target === ov) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => { inp.focus(); inp.select(); }, 10);
  });
}

// Custom Confirm-Dialog im Tool-Stil — gibt Promise<boolean> zurück.
function showConfirm({ title, message, confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'wt-confirm-overlay';
    ov.innerHTML = `
      <div class="wt-confirm-box">
        <div class="wt-confirm-title">${escHtml(title)}</div>
        <div class="wt-confirm-msg">${escHtml(message)}</div>
        <div class="wt-confirm-actions">
          <button class="wt-confirm-cancel">${escHtml(cancelLabel)}</button>
          <button class="wt-confirm-ok ${danger ? 'danger' : ''}">${escHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const close = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
    ov.querySelector('.wt-confirm-cancel').addEventListener('click', () => close(false));
    ov.querySelector('.wt-confirm-ok').addEventListener('click', () => close(true));
    ov.addEventListener('click', e => { if (e.target === ov) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('.wt-confirm-ok').focus(), 10);
  });
}

// Kompakte Annahme für die Tabellen-Spalte (kurz, 1 Zeile).
function bausteinNotice(b, ctx) {
  const info = BAUSTEIN_INFO[b.id];
  if (!info) return '';
  if (info.ce) {
    const kw = ctx.pKw[info.pKwKey] || 0;
    const eurPerKw = kw > 0.1 ? CalcEngine.investEurProKw(info.ce, kw) : 0;
    return eurPerKw > 0 ? `${Math.round(eurPerKw)} €/kW` : '';
  }
  if (info.fixed) return info.fixed.split('(')[0].trim();
  return '';
}

// ── Label-Tabellen für Bausteine + Energieträger ────────────────────────
const BAUSTEIN_LABELS = {
  lwwp: 'Luft-WP (Anlage)',
  fg: 'FG-WP (Anlage)',
  geo_wp: 'Geo-WP (Anlage)',
  geo_sonden: 'Sondenbohrungen',
  pk: 'Pelletkessel',
  pk_lager: 'Pellet-Lager',
  hhs_kessel: 'HHS-Kessel',
  hhs_lager: 'HHS-Lager',
  hko: 'Heizölkessel',
  gk: 'Gaskessel',
  bhkw: 'BHKW',
  bhkw_hydr: 'BHKW Hydraulik',
  stromkessel: 'Stromkessel',
  fw_pumpe: 'Fernwärme-Pumpe',
  solarthermie: 'Solarthermie',
  thermSpeicher: 'Wärmespeicher (Optimizer)',
  puffer: 'Pufferspeicher',
  schornstein: 'Schornstein',
  schallschutz: 'Schallschutz',
  entstaubung: 'Entstaubung',
  huest: 'Hausanschlussstationen',
  netzanschluss: 'Netzanschluss',
  fg_entnahme: 'FG-Entnahmebauwerk',
  waermenetz: 'Wärmenetz',
  bauteil: 'Bauteil / Hülle',
  hydr_elt: 'Hydr. + Elt. Anbindung',
  planung: 'Planung',
  unvorg: 'Unvorhergesehenes',
};
const ENERGY_LABELS = {
  lwwp: 'Strom Luft-WP', fg: 'Strom FG-WP', geo: 'Strom Geo-WP',
  stromkessel: 'Strom Stromkessel',
  fernwaerme: 'Fernwärme', gaskessel: 'Erdgas (Kessel)',
  bhkw: 'Erdgas (BHKW) − Stromerlös',
  heizoel: 'Heizöl', pellets: 'Pellets', hhs: 'Hackschnitzel',
};
// Donut-Farben (round-robin durchrotieren)
const DONUT_COLORS = ['#4dd0e1', '#ab47bc', '#d4a855', '#f9a825', '#66bb6a', '#a1887f', '#29b6f6', '#ce93d8', '#ff9800', '#78909c'];

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtEur(v) {
  if (!isFinite(v)) return '— €';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' M€';
  if (Math.abs(v) >= 1e3) return Math.round(v).toLocaleString('de-DE') + ' €';
  return Math.round(v) + ' €';
}
function fmtEurA(v) { return fmtEur(v) + '/a'; }
// Kompakte Variante für KPI-Bar: ab 1 Mio. → "1,14 M€"
function fmtEurCompact(v) {
  if (!isFinite(v)) return '— €';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' M€';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' k€';
  return Math.round(v) + ' €';
}
function fmtPct(v, d = 1) { return v.toFixed(d) + ' %'; }
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ── Render-Hook ──────────────────────────────────────────────────────────
export function refreshWirtschaftView() {
  const container = document.getElementById('wirtschaft-content');
  if (!container) return;
  try {
    _refreshWirtschaftViewInner(container);
  } catch (e) {
    console.error('[Wirtschaft] Render fehlgeschlagen:', e);
    container.innerHTML = `<div class="wt-empty">
      <b style="color:var(--c-red);">⚠ Fehler beim Render des Wirtschaft-Tabs</b><br><br>
      <span style="color:var(--muted);">${escHtml(e.message || String(e))}</span><br><br>
      <span class="acc-key">Tipp:</span> einmal „Grundlage berechnen" anklicken, dann F5. Wenn der Fehler bleibt, siehst du Details in der Browser-Konsole (F12).
    </div>`;
  }
}

function _refreshWirtschaftViewInner(container) {
  const data = getWirtschaftSummary();
  if (!data.ready) {
    container.innerHTML = `<div class="wt-empty">${escHtml(data.reason)}</div>`;
    return;
  }

  const variantName = activeVariantId === null
    ? 'Basisdaten'
    : (varianten.find(v => v.id === activeVariantId)?.name || '—');

  container.innerHTML = `
    <div class="wt-hint-banner">
      <b>Aktive Variante:</b> ${escHtml(variantName)} · alle Werte beziehen sich auf den aktuellen Stand.
    </div>
    ${renderKpiBar(data.summary)}
    <div class="wt-charts-row">
      ${renderStackedBar(data.summary)}
      ${renderDonut(data.bausteine, data.summary.investGesamt)}
    </div>
    ${renderInvestAcc(data.bausteine, data.summary, data.context)}
    ${renderEnergyAcc(data.energy, data.summary, data.hourly, window._dispatchEnergy || {}, data.inputs)}
    ${renderBetriebAcc(data.bausteine, data.summary)}
    ${renderCo2Acc(data.summary, data.co2Rows, data.inputs)}
    ${renderEingabeAcc(data.inputs)}
  `;

  // Akkordeon-Toggle
  container.querySelectorAll('.wt-acc-header').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
  });
  // Donut-Klick → Drill-down zur Tabellenzeile
  container.querySelectorAll('[data-baustein-id]').forEach(el => {
    el.addEventListener('click', () => _drillToBaustein(el.dataset.bausteinId));
  });

  // ── Edit-Listener für Investitions-Tabelle ──
  container.querySelectorAll('input[data-edit]').forEach(inp => {
    inp.addEventListener('change', () => {
      const kind = inp.dataset.edit;
      const id = inp.dataset.id;
      if (kind === 'inv')           setInvOverride(id, inp.value);
      else if (kind === 'vdi')      setVdiOverride(id, inp.dataset.field, inp.value);
      else if (kind === 'user-name') {
        updateKostenpunkt(id, { name: inp.value });
        _triggerRecalc();
      }
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  // Mülleimer pro Zeile (Auto-Baustein ausblenden / User-Position löschen)
  container.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.delId;
      const isUser = btn.dataset.delUser === '1';
      const label = btn.dataset.delLabel || 'diese Position';
      if (isUser) {
        const ok = await showConfirm({
          title: 'Position löschen?',
          message: `„${label}" aus dieser Variante entfernen?`,
          confirmLabel: 'Löschen',
          danger: true,
        });
        if (!ok) return;
      } else {
        const ok = await showConfirm({
          title: 'Auto-Baustein ausblenden?',
          message: `„${label}" für diese Variante ausblenden. Wiederherstellbar über den Banner unter der Tabelle.`,
          confirmLabel: 'Ausblenden',
          danger: false,
        });
        if (!ok) return;
      }
      deleteKostenRow(id, isUser);
    });
  });
  // Wiederherstellen-Buttons (Hidden-Banner)
  container.querySelectorAll('[data-unhide-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      unhideKostenRow(btn.dataset.unhideId);
    });
  });
  // Als-Vorlage-Speichern-Buttons (nur bei User-Positionen)
  container.querySelectorAll('[data-save-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      // Aktuellen KostenPunkt aus aktiver Variante holen
      const id = btn.dataset.saveId;
      const label = btn.dataset.saveLabel || '';
      const kps = (typeof window.getActiveKostenpunkte === 'function') ? (window.getActiveKostenpunkte() || []) : [];
      const kp = kps.find(k => k.id === id);
      if (!kp) return;
      await saveAsVorlage(kp, label);
    });
  });
  // Vorlagen-Dropdown + „Eigene Position"-Button
  container.querySelectorAll('.wt-vorlage-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const tk = sel.value;
      if (tk) { addKostenFromVorlage(tk); sel.value = ''; }
    });
  });
  container.querySelectorAll('.wt-add-custom').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); addKostenCustom(); });
  });
  container.querySelectorAll('[data-reset-inv]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); resetInvOverride(btn.dataset.resetInv); });
  });
  container.querySelectorAll('[data-reset-vdi]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); resetVdiOverride(btn.dataset.resetVdi, btn.dataset.resetField); });
  });
  // ── Edit-Listener für Eingabeparameter ──
  container.querySelectorAll('input[data-param]').forEach(inp => {
    inp.addEventListener('change', () => setEingabeParam(inp.dataset.param, inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  // EmF-Toggle (Heute / Ø Nutzungsdauer / 2050)
  container.querySelectorAll('[data-emf-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.dataset.emfVal);
      if (!isFinite(val)) return;
      setEingabeParam('strom-emf', val);
    });
  });

  // Energiekosten-Profil interaktiv aufsetzen
  if (data.hourly && data.hourly.eur && data.hourly.eur.length === 8760) {
    mountEnergyProfile(container, data.hourly);
  }
}

// ── KPI-Bar ──────────────────────────────────────────────────────────────
function renderKpiBar(s) {
  const co2Spez = s.totalWaerme > 0 ? (s.co2ta * 1e6 / (s.totalWaerme * 1000)) : 0;
  return `
    <div class="wt-kpi-bar">
      <div class="wt-kpi primary" title="Gesamtkosten pro Jahr (${fmtEurA(s.jahreskosten)})"><div class="wt-kpi-val">${fmtEurCompact(s.jahreskosten)}/a</div><div class="wt-kpi-lbl">Gesamtkosten / Jahr</div></div>
      <div class="wt-kpi spec" title="Spezifische Wärmegestehungskosten"><div class="wt-kpi-val">${s.wgk.toFixed(2)} ct/kWh</div><div class="wt-kpi-lbl">Spez. WGK</div></div>
      <div class="wt-kpi invest" title="Gesamtinvestition (${fmtEur(s.investGesamt)})"><div class="wt-kpi-val">${fmtEurCompact(s.investGesamt)}</div><div class="wt-kpi-lbl">Gesamtinvestition</div></div>
      <div class="wt-kpi spec" title="Erneuerbare-Energien-Anteil"><div class="wt-kpi-val">${fmtPct(s.eeAnteil, 0)}</div><div class="wt-kpi-lbl">EE-Anteil</div></div>
      <div class="wt-kpi co2" title="CO₂-Faktor je kWh thermisch"><div class="wt-kpi-val">${Math.round(co2Spez)} g/kWh</div><div class="wt-kpi-lbl">CO₂-Faktor Wärme</div></div>
    </div>
  `;
}

// ── Stacked-Bar (jährliche Kostenzusammensetzung) ────────────────────────
function renderStackedBar(s) {
  const total = Math.max(1, s.jahreskosten);
  const blocks = [
    { lbl: 'Kapital',          val: s.kapitalJk, color: '#4dd0e1' },
    { lbl: 'Betrieb (W+I+B)',  val: s.betriebJk, color: '#ab47bc' },
    { lbl: 'Energie',          val: s.energieJk, color: '#f9a825' },
    { lbl: 'CO₂ (EEFB)',       val: s.co2Jk,     color: '#e53935' },
    { lbl: 'PV / Batt.',       val: s.pvJk,      color: '#66bb6a' },
  ];
  const max = Math.max(1, ...blocks.map(b => Math.abs(b.val)));
  const rows = blocks.map(b => `
    <div class="wt-stack-row" title="${escHtml(b.lbl)}: ${fmtEurA(b.val)} (${fmtPct(b.val/total*100, 1)})">
      <div class="wt-stack-lbl" style="--swatch:${b.color};">${escHtml(b.lbl)}</div>
      <div class="wt-stack-bar"><div class="wt-stack-fill" style="width:${Math.max(0, b.val/max*100)}%;background:${b.color};"></div></div>
      <div class="wt-stack-val">${fmtEurA(b.val)}</div>
    </div>
  `).join('');
  return `
    <div class="wt-chart-card">
      <div class="wt-chart-title">Jährliche Kostenzusammensetzung</div>
      ${rows}
      <div class="wt-stack-row total">
        <div class="wt-stack-lbl">Gesamt</div>
        <div class="wt-stack-bar"></div>
        <div class="wt-stack-val" style="color:var(--accent);">${fmtEurA(s.jahreskosten)}</div>
      </div>
    </div>
  `;
}

// ── Donut (Investitionsaufschlüsselung) ──────────────────────────────────
function renderDonut(bausteine, investGesamt) {
  const positive = bausteine.filter(b => b.inv > 0);
  positive.sort((a, b) => b.inv - a.inv);
  const top = positive.slice(0, 8);
  const rest = positive.slice(8);
  const restSum = rest.reduce((s, b) => s + b.inv, 0);
  const items = [...top.map((b, i) => ({ id: b.id, name: BAUSTEIN_LABELS[b.id] || b.label || b.id, inv: b.inv, color: DONUT_COLORS[i % DONUT_COLORS.length] }))];
  if (restSum > 0) items.push({ id: '__rest__', name: `Sonstiges (${rest.length} Pos.)`, inv: restSum, color: '#78909c' });
  const total = investGesamt > 0 ? investGesamt : items.reduce((s, x) => s + x.inv, 0);

  const R = 56, CIRC = 2 * Math.PI * R;
  let offset = 0;
  const segs = items.map(it => {
    const len = (it.inv / Math.max(1, total)) * CIRC;
    const seg = `<circle class="wt-donut-seg" data-baustein-id="${escAttr(it.id)}" cx="85" cy="85" r="${R}" fill="none" stroke="${it.color}" stroke-width="28" stroke-dasharray="${len.toFixed(1)} ${(CIRC - len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 85 85)" style="cursor:pointer;transition:stroke-width 0.15s;"><title>${escHtml(it.name)}: ${fmtEur(it.inv)} (${fmtPct(it.inv/total*100, 1)}) — Klicken für Detail</title></circle>`;
    offset += len;
    return seg;
  }).join('');

  const legend = items.map(it => `
    <div class="wt-donut-row" data-baustein-id="${escAttr(it.id)}" style="cursor:pointer;" title="Klicken für Detail in der Tabelle">
      <div class="wt-donut-color" style="background:${it.color};"></div>
      <div class="wt-donut-name">${escHtml(it.name)}</div>
      <div class="wt-donut-val">${fmtEur(it.inv)}</div>
      <div class="wt-donut-pct">${fmtPct(it.inv/total*100, 1)}</div>
    </div>
  `).join('');

  return `
    <div class="wt-chart-card">
      <div class="wt-chart-title">Investitionsaufschlüsselung (${fmtEur(total)}) <span style="font-style:italic;text-transform:none;letter-spacing:0;color:var(--accent);">— klick auf Segment</span></div>
      <div class="wt-donut-wrap">
        <svg class="wt-donut-svg" width="170" height="170" viewBox="0 0 170 170">
          ${segs}
          <text x="85" y="82" text-anchor="middle" font-family="DM Mono, monospace" font-size="13" fill="var(--text)" font-weight="500">${fmtEur(total).replace(' M€', 'M€')}</text>
          <text x="85" y="98" text-anchor="middle" font-size="9" fill="var(--muted)">Gesamt</text>
        </svg>
        <div class="wt-donut-legend">${legend}</div>
      </div>
    </div>
  `;
}

// Drill-down: scroll zur Tabellenzeile + kurz hervorheben
function _drillToBaustein(id) {
  if (id === '__rest__') {
    // „Sonstiges" → einfach zur Tabelle scrollen
    const tbl = document.querySelector('#wirtschaft-content .wt-cost-table');
    if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const inp = document.querySelector(`#wirtschaft-content input[data-edit="inv"][data-id="${CSS.escape(id)}"]`);
  if (!inp) return;
  const tr = inp.closest('tr');
  if (!tr) return;
  tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  tr.classList.add('wt-row-highlight');
  setTimeout(() => tr.classList.remove('wt-row-highlight'), 1800);
}

// ── Akkordeon: Investitionskosten ────────────────────────────────────────
function renderInvestAcc(bausteine, s, ctx) {
  const visible = bausteine.filter(b => b.inv > 0 || b.isUser);
  visible.sort((a, b) => b.inv - a.inv);
  const sumInv = visible.reduce((acc, b) => acc + b.inv, 0);
  const sumAnn = visible.reduce((acc, b) => acc + b.detail.annuitaet, 0);
  const sumWI  = visible.reduce((acc, b) => acc + b.detail.instandhaltung + b.detail.wartung, 0);
  const sumBed = visible.reduce((acc, b) => acc + (b.vdi.bedien || 0), 0);

  const invOv = ctx.overrides?.inv || {};
  const vdiOv = ctx.overrides?.vdi || {};
  const hidden = getActiveHiddenAutoIds() || [];
  const rows = visible.map(b => {
    const tip = bausteinTooltip(b, ctx);
    const notice = b.isUser ? '' : bausteinNotice(b, ctx);
    const labelText = b.isUser
      ? (b.label || 'Eigene Position')
      : (BAUSTEIN_LABELS[b.id] || b.label || b.id);
    return `
    <tr title="${escHtml(tip)}" style="${tip ? 'cursor:help;' : ''}">
      <td>${b.isUser
        ? `<input class="wt-cell-input name override" data-edit="user-name" data-id="${escAttr(b.id)}" value="${escAttr(labelText)}" title="Eigener Name (frei editierbar)">`
        : escHtml(labelText)
      }</td>
      ${editCellInv(b, b.inv, invOv)}
      ${editCellVdi(b, 'n',      b.vdi.n,      vdiOv, 'a')}
      <td class="r">${fmtEur(b.detail.annuitaet)}</td>
      ${editCellVdi(b, 'inst',   b.vdi.inst || 0,   vdiOv, '%')}
      ${editCellVdi(b, 'wart',   b.vdi.wart || 0,   vdiOv, '%')}
      <td class="r">${fmtEur(b.detail.instandhaltung + b.detail.wartung)}</td>
      ${editCellVdi(b, 'bedien', b.vdi.bedien || 0, vdiOv, 'h')}
      <td class="muted"><i>${b.isUser ? 'Eigene Position' : escHtml(notice)}</i></td>
      <td class="wt-row-actions">
        ${b.isUser ? `<button class="wt-row-save" data-save-id="${escAttr(b.id)}" data-save-label="${escAttr(labelText)}" title="Als Vorlage speichern">💾</button>` : ''}
        <button class="wt-row-del" data-del-id="${escAttr(b.id)}" data-del-user="${b.isUser ? '1' : '0'}" data-del-label="${escAttr(labelText)}" title="${b.isUser ? 'Position löschen' : 'Auto-Baustein ausblenden'}">🗑</button>
      </td>
    </tr>`;
  }).join('');

  // Add-Row und Vorlagen-Dropdown — User-Vorlagen kommen oben in eigene Gruppe
  const vorlagen = getAllVorlagen();
  const vorlagenGroups = {};
  vorlagen.forEach(v => {
    const cat = v.isUser ? '★ Eigene Vorlagen' : (KATEGORIEN[v.kategorie]?.label || 'Andere');
    if (!vorlagenGroups[cat]) vorlagenGroups[cat] = [];
    vorlagenGroups[cat].push(v);
  });
  // Eigene Vorlagen oben einsortieren
  const sortedKeys = Object.keys(vorlagenGroups).sort((a, b) => {
    if (a.startsWith('★')) return -1;
    if (b.startsWith('★')) return 1;
    return 0;
  });
  const optGroups = sortedKeys.map(cat => `
    <optgroup label="${escHtml(cat)}">
      ${vorlagenGroups[cat].map(v => `<option value="${escAttr(v.typeKey)}">${escHtml(v.name)}${v.spez ? ` (${v.spez} €/kW)` : ''}</option>`).join('')}
    </optgroup>
  `).join('');

  // Hidden-Auto-Banner (wenn etwas ausgeblendet ist)
  const hiddenLabels = hidden
    .map(id => BAUSTEIN_LABELS[id] || id)
    .filter(Boolean);
  const hiddenBanner = hidden.length ? `
    <div style="font-size:10px;color:var(--muted);margin-top:8px;padding:6px 10px;background:var(--surface2);border:1px dashed var(--border);border-radius:4px;">
      <b>Ausgeblendete Auto-Bausteine:</b>
      ${hidden.map((id, i) => `<button class="wt-unhide" data-unhide-id="${escAttr(id)}" style="background:transparent;border:1px solid var(--border);color:var(--muted);font-family:inherit;font-size:10px;padding:2px 8px;border-radius:3px;cursor:pointer;margin:0 4px 0 6px;">↺ ${escHtml(BAUSTEIN_LABELS[id] || id)}</button>`).join('')}
    </div>` : '';

  return `
    <div class="wt-acc open">
      <div class="wt-acc-header">
        <div class="wt-acc-title"><span class="wt-acc-arrow">▶</span><span class="wt-acc-dot" style="background:#4dd0e1;"></span><span>Investitionskosten</span></div>
        <div class="wt-acc-sum" style="color:#4dd0e1;">${fmtEur(s.investGesamt)}</div>
      </div>
      <div class="wt-acc-body">
        <div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic;">
          💡 Hover über eine Zeile zeigt Kostenkurve und Quelle. Mülleimer (links) entfernt Auto-Bausteine aus dieser Variante oder löscht eigene Positionen.
        </div>
        <div class="wt-table-scroll">
          <table class="wt-cost-table">
            <thead><tr>
              <th style="min-width:200px;">Position</th>
              <th class="r">Investition</th><th class="c">ND</th><th class="r">Annuität</th>
              <th class="c">Inst. %</th><th class="c">Wart. %</th><th class="r">W+I €/a</th><th class="c">Bed. h/a</th>
              <th>Annahme</th>
              <th style="width:32px;"></th>
            </tr></thead>
            <tbody>
              ${rows || '<tr><td colspan="10" class="muted">Keine Investitionspositionen vorhanden.</td></tr>'}
              <tr class="wt-add-row">
                <td colspan="10">
                  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;">
                    <span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">+ Position hinzufügen:</span>
                    <select class="wt-vorlage-select" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:11px;font-family:inherit;cursor:pointer;flex:1 1 auto;min-width:200px;">
                      <option value="">— Vorlage wählen —</option>
                      ${optGroups}
                    </select>
                    <button class="wt-add-custom" style="background:transparent;border:1px dashed var(--border);color:var(--muted);font-family:inherit;font-size:11px;padding:5px 14px;border-radius:4px;cursor:pointer;">+ Eigene Position</button>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot><tr>
              <td><b>Gesamtinvestition</b></td>
              <td class="r" style="color:var(--accent);">${fmtEur(sumInv)}</td>
              <td class="c muted">—</td>
              <td class="r" style="color:var(--accent);">${fmtEur(sumAnn)}</td>
              <td class="c muted">—</td><td class="c muted">—</td>
              <td class="r" style="color:var(--accent);">${fmtEur(sumWI)}</td>
              <td class="c">${sumBed} h</td>
              <td class="muted"><i>Spez.: ${s.investGesamt && Object.values(ctx.pKw).reduce((a,b)=>a+(b||0),0) > 0 ? Math.round(s.investGesamt / Object.values(ctx.pKw).reduce((a,b)=>a+(b||0),0)) : 0} €/kW</i></td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>
        ${hiddenBanner}
      </div>
    </div>
  `;
}

// ── Akkordeon: Energiekosten ────────────────────────────────────────────
// Verbrauch (kWh) + Preis (ct/kWh) pro Energieträger berechnen.
// Quelle: window._dispatchEnergy + Eingabe-Preise aus inputs.prices.
function _energyRowDetails(e, en, prices, etas) {
  const k = e.key;
  if (!k || k === '_co2' || k === '_pv') return null;
  const ed = en[k] || {};
  let verbKwh = 0, preisCt = 0, einheit = 'kWh';
  if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
    verbKwh = (ed.elMwh || 0) * 1000;
    preisCt = prices.strom;
  } else if (k === 'fernwaerme') {
    verbKwh = (ed.waermeMwh || 0) * 1000;
    preisCt = prices.fw;
  } else if (k === 'gaskessel' || k === '_autoGk') {
    verbKwh = etas.gaskessel > 0 ? (ed.waermeMwh || 0) / etas.gaskessel * 1000 : 0;
    preisCt = prices.gas;
  } else if (k === 'heizoel') {
    verbKwh = etas.heizoel > 0 ? (ed.waermeMwh || 0) / etas.heizoel * 1000 : 0;
    preisCt = prices.hko;
  } else if (k === 'pellets') {
    verbKwh = etas.pellets > 0 ? (ed.waermeMwh || 0) / etas.pellets * 1000 : 0;
    preisCt = prices.pk;
  } else if (k === 'hhs') {
    verbKwh = etas.hhs > 0 ? (ed.waermeMwh || 0) / etas.hhs * 1000 : 0;
    preisCt = prices.hhs;
  } else if (k === 'bhkw') {
    const etaTh = etas.bhkw / (1 + etas.bhkwSigma);
    verbKwh = etaTh > 0 ? (ed.waermeMwh || 0) / etaTh * 1000 : 0;
    preisCt = prices.gas;
    einheit = 'kWh Gas';
  }
  return { verbKwh, preisCt, einheit };
}
function renderEnergyAcc(energy, s, hourly, en, inputs) {
  const prices = inputs.prices;
  const etas = inputs.etas;
  // Filter: CO₂ und PV haben eigene Akkordeons, hier nicht doppelt anzeigen
  const erzRows = energy.filter(e => e.key && e.key !== '_co2' && e.key !== '_pv');
  const fmtKwh = v => v >= 1000 ? (v/1000).toFixed(1) + ' MWh' : Math.round(v) + ' kWh';

  const rows = erzRows.map(e => {
    const d = _energyRowDetails(e, en, prices, etas);
    const verbCell = d && d.verbKwh > 0 ? fmtKwh(d.verbKwh) : '—';
    const preisCell = d && d.preisCt > 0 ? d.preisCt.toFixed(1) + ' ct/kWh' : '—';
    return `<tr title="${escHtml(e.detail || '')}" style="${e.detail ? 'cursor:help;' : ''}">
      <td>${escHtml(e.label)}</td>
      <td class="r">${escHtml(verbCell)}</td>
      <td class="r">${escHtml(preisCell)}</td>
      <td class="r">${fmtEurA(e.kosten)}</td>
      <td class="muted"><i>${escHtml(e.detail || '—')}</i></td>
    </tr>`;
  }).join('');
  const sumKosten = erzRows.reduce((sum, e) => sum + e.kosten, 0);
  const profileMarkup = hourly && hourly.eur && hourly.eur.length === 8760 ? `
    <div class="wt-profile" id="wt-profile">
      <div class="wt-profile-toolbar">
        <div class="wt-profile-title">Energiekosten-Profil <em>stundengenau</em></div>
        <div class="wt-tg" data-grp="zoom">
          <button data-zoom="jahr" class="active">Jahr</button>
          <button data-zoom="monat">Monat</button>
          <button data-zoom="woche">Woche</button>
          <button data-zoom="tag">Tag</button>
        </div>
        <div class="wt-tg" data-grp="nav">
          <button data-nav="-1" title="Zurück">‹</button>
          <span class="wt-nav-label" id="wt-nav-label">—</span>
          <button data-nav="1" title="Vor">›</button>
        </div>
        <div class="wt-tg" data-grp="unit">
          <button data-unit="eur" class="active">€</button>
          <button data-unit="ct">ct/kWh</button>
        </div>
      </div>
      <div class="wt-profile-wrap">
        <svg class="wt-profile-svg" id="wt-profile-svg" preserveAspectRatio="none"></svg>
        <div class="wt-profile-tip" id="wt-profile-tip"></div>
      </div>
      <div class="wt-profile-summary"><span id="wt-profile-summary" class="acc">Σ —</span></div>
    </div>` : '';
  return `
    <div class="wt-acc open">
      <div class="wt-acc-header">
        <div class="wt-acc-title"><span class="wt-acc-arrow">▶</span><span class="wt-acc-dot" style="background:#f9a825;"></span><span>Energiekosten</span></div>
        <div class="wt-acc-sum" style="color:#f9a825;">${fmtEurA(s.energieJk)}</div>
      </div>
      <div class="wt-acc-body">
        ${profileMarkup}
        <div class="wt-table-scroll" style="margin-top:14px;">
          <table class="wt-cost-table">
            <thead><tr>
              <th>Energieträger</th>
              <th class="r">Verbrauch</th>
              <th class="r">Preis</th>
              <th class="r">Kosten/a</th>
              <th>Berechnung</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="muted">Keine aktiven Energieträger.</td></tr>'}</tbody>
            <tfoot><tr>
              <td><b>Summe Energie</b></td>
              <td class="r muted">—</td>
              <td class="r muted">—</td>
              <td class="r" style="color:var(--accent);">${fmtEurA(sumKosten)}</td>
              <td class="muted"><i>Preise editierbar im Akkordeon „Eingabeparameter" unten</i></td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── Energiekosten-Profil: stundengenaues Säulen-/Linien-Diagramm ────────
function mountEnergyProfile(container, hourly) {
  const svg = container.querySelector('#wt-profile-svg');
  const tip = container.querySelector('#wt-profile-tip');
  const sumEl = container.querySelector('#wt-profile-summary');
  const navLbl = container.querySelector('#wt-nav-label');
  if (!svg) return;

  const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const MON_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  const HOURS = 8760;
  let zoom = 'jahr', unit = 'eur', offsetDay = 0;

  const dayToDate = d => { let m = 0, rem = d; while (m < 12 && rem >= MON_DAYS[m]) { rem -= MON_DAYS[m]; m++; } return { m, d: rem + 1 }; };
  const dateLabel = () => {
    const dt = dayToDate(offsetDay);
    if (zoom === 'jahr')  return 'Gesamtjahr';
    if (zoom === 'monat') return MONATE[dt.m];
    if (zoom === 'woche') {
      const end = (offsetDay + 6) % 365; const dtE = dayToDate(end);
      return `${dt.d}.${dt.m+1}. – ${dtE.d}.${dtE.m+1}.`;
    }
    return `${dt.d}. ${MONATE[dt.m]}`;
  };
  const slice = () => {
    if (zoom === 'jahr')  return [0, HOURS];
    if (zoom === 'monat') { const dt = dayToDate(offsetDay); let s = 0; for (let i = 0; i < dt.m; i++) s += MON_DAYS[i] * 24; return [s, s + MON_DAYS[dt.m] * 24]; }
    if (zoom === 'woche') return [offsetDay * 24, offsetDay * 24 + 168];
    return [offsetDay * 24, offsetDay * 24 + 24];
  };
  const binHrs = () => (zoom === 'jahr' || zoom === 'monat') ? 24 : 1;
  const xLabels = (n) => {
    if (zoom === 'jahr') {
      // n = 365 Tage: Monatsnamen an Monatsanfängen platzieren, sonst leer
      const out = new Array(n).fill('');
      const MM = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
      let acc = 0;
      for (let m = 0; m < 12; m++) {
        if (acc < n) out[acc] = MM[m];
        acc += MON_DAYS[m];
      }
      return out;
    }
    if (zoom === 'monat') { const dt = dayToDate(offsetDay), days = MON_DAYS[dt.m], out = []; for (let i = 1; i <= days; i++) out.push((i % 5 === 0 || i === 1) ? String(i) : ''); return out; }
    if (zoom === 'woche') { const out = []; for (let i = 0; i < n; i++) { const d = Math.floor(i/24), dt = dayToDate(offsetDay + d); out.push(i % 24 === 0 ? `${dt.d}.${dt.m+1}.` : ''); } return out; }
    const out = []; for (let i = 0; i < 24; i++) out.push(i % 3 === 0 ? `${i}h` : ''); return out;
  };
  const fmt = v => v >= 1000 ? (v/1000).toFixed(1) + 'k €' : Math.round(v) + ' €';

  function render() {
    const [s, e] = slice();
    const bin = binHrs();
    const n = Math.ceil((e - s) / bin);
    const bins = [];
    for (let b = 0; b < n; b++) {
      let eur = 0, kwh = 0;
      const bs = s + b * bin, be = Math.min(s + (b+1) * bin, e);
      for (let h = bs; h < be; h++) { eur += hourly.eur[h] || 0; kwh += hourly.kwhTh[h] || 0; }
      const ct = kwh > 0 ? (eur * 100) / kwh : 0;
      bins.push({ eur, kwh, ct });
    }
    const yMax = Math.max(...bins.map(b => unit === 'eur' ? b.eur : b.ct), 0.001) * 1.05;
    const W = Math.max(400, Math.round(svg.parentElement.clientWidth || 800)), H = 220;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const padL = 58, padR = 12, padT = 12, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const xStep = plotW / n, barW = Math.max(1.2, xStep * 0.85);

    let m = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH * (1 - i/4);
      const v = yMax * i / 4;
      m += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--border)" stroke-width="0.5" opacity="0.5"/>`;
      const lbl = unit === 'eur' ? fmt(v) : v.toFixed(1) + ' ct';
      m += `<text x="${padL-5}" y="${y+3}" text-anchor="end" font-family="DM Mono, monospace" font-size="9" fill="var(--muted)">${lbl}</text>`;
    }
    if (unit === 'eur') {
      bins.forEach((b, i) => {
        const x = padL + i * xStep + (xStep - barW) / 2;
        const h = (b.eur / yMax) * plotH;
        const y = padT + plotH - h;
        m += `<rect class="wt-profile-bar" data-i="${i}" x="${x}" y="${y}" width="${barW}" height="${h}" fill="#f9a825" rx="1"/>`;
      });
    } else {
      const pts = bins.map((b, i) => [padL + i * xStep + xStep/2, padT + plotH - (b.ct / yMax) * plotH]);
      m += `<path d="${pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="none" stroke="#f9a825" stroke-width="1.6"/>`;
      pts.forEach((p, i) => { m += `<circle class="wt-profile-bar" data-i="${i}" cx="${p[0]}" cy="${p[1]}" r="${n < 200 ? 2.5 : 1.5}" fill="#f9a825"/>`; });
    }
    const labels = xLabels(n);
    labels.forEach((l, i) => { if (l) { const x = padL + i * xStep + xStep/2; m += `<text x="${x}" y="${H-10}" text-anchor="middle" font-family="DM Mono, monospace" font-size="9" fill="var(--muted)">${l}</text>`; } });
    svg.innerHTML = m;

    svg.querySelectorAll('.wt-profile-bar').forEach(el => {
      el.addEventListener('mousemove', ev => {
        const i = +el.dataset.i, b = bins[i];
        const dt = (zoom === 'monat' || zoom === 'jahr')
          ? (() => { const d = dayToDate(offsetDay + (zoom === 'jahr' ? Math.floor(i * 365 / 12) : i)); return `${d.d}. ${MONATE[d.m].slice(0,3)}`; })()
          : (zoom === 'woche')
            ? (() => { const d = Math.floor(i/24), hr = i%24, x = dayToDate(offsetDay + d); return `${x.d}.${x.m+1}. ${String(hr).padStart(2,'0')}:00`; })()
            : `${String(i).padStart(2,'0')}:00`;
        tip.innerHTML = `<b style="color:var(--accent);">${dt}</b><br>Kosten: ${b.eur.toFixed(2)} €<br>Wärme: ${b.kwh.toFixed(1)} kWh<sub>th</sub><br><span style="color:var(--muted);">${b.ct.toFixed(2)} ct/kWh<sub>th</sub></span>`;
        tip.style.display = 'block';
        const wrap = svg.parentElement.getBoundingClientRect();
        let lx = ev.clientX - wrap.left + 12, ly = ev.clientY - wrap.top + 12;
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        if (lx + tw > wrap.width - 4) lx = ev.clientX - wrap.left - tw - 12;
        if (ly + th > wrap.height - 4) ly = ev.clientY - wrap.top - th - 12;
        tip.style.left = Math.max(4, lx) + 'px';
        tip.style.top  = Math.max(4, ly) + 'px';
      });
      el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      el.addEventListener('click', () => {
        const i = +el.dataset.i;
        if (zoom === 'jahr')  { let acc = 0; for (let mi = 0; mi < 12; mi++) { if (acc + MON_DAYS[mi] > Math.floor(i*365/12)) { offsetDay = acc; break; } acc += MON_DAYS[mi]; } setZoom('monat'); }
        else if (zoom === 'monat') { offsetDay = offsetDay + i; setZoom('tag'); }
        else if (zoom === 'woche') { offsetDay = offsetDay + Math.floor(i/24); setZoom('tag'); }
      });
    });

    const sumEur = bins.reduce((a, b) => a + b.eur, 0);
    const sumKwh = bins.reduce((a, b) => a + b.kwh, 0);
    const avgCt = sumKwh > 0 ? (sumEur * 100) / sumKwh : 0;
    sumEl.innerHTML = `Σ ${fmt(sumEur)} · Ø ${avgCt.toFixed(1)} ct/kWh<sub>th</sub> · ${(sumKwh/1000).toFixed(0)} MWh<sub>th</sub>`;
    navLbl.textContent = dateLabel();
  }

  function setZoom(z) {
    zoom = z;
    container.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('active', b.dataset.zoom === z));
    if (zoom === 'jahr')  offsetDay = 0;
    if (zoom === 'monat') { const dt = dayToDate(offsetDay); let s = 0; for (let i = 0; i < dt.m; i++) s += MON_DAYS[i]; offsetDay = s; }
    if (zoom === 'woche') offsetDay = Math.floor(offsetDay / 7) * 7;
    render();
  }
  function setUnit(u) {
    unit = u;
    container.querySelectorAll('[data-unit]').forEach(b => b.classList.toggle('active', b.dataset.unit === u));
    render();
  }
  function nav(dir) {
    if (zoom === 'jahr') return;
    if (zoom === 'monat') { const dt = dayToDate(offsetDay); let m2 = (dt.m + dir + 12) % 12; let s = 0; for (let i = 0; i < m2; i++) s += MON_DAYS[i]; offsetDay = s; }
    if (zoom === 'woche') offsetDay = (offsetDay + dir * 7 + 365) % 365;
    if (zoom === 'tag')   offsetDay = (offsetDay + dir + 365) % 365;
    render();
  }

  container.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => setZoom(b.dataset.zoom)));
  container.querySelectorAll('[data-unit]').forEach(b => b.addEventListener('click', () => setUnit(b.dataset.unit)));
  container.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => nav(+b.dataset.nav)));

  let resizeT;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(render, 80); };
  window.addEventListener('resize', onResize);

  render();
}

// ── Akkordeon: Betriebskosten (W+I+B) ────────────────────────────────────
function renderBetriebAcc(bausteine, s) {
  const sumWI  = bausteine.reduce((a, b) => a + b.detail.instandhaltung + b.detail.wartung, 0);
  const sumBed = bausteine.reduce((a, b) => a + b.detail.bedienung, 0);
  const total = sumWI + sumBed;
  return `
    <div class="wt-acc">
      <div class="wt-acc-header">
        <div class="wt-acc-title"><span class="wt-acc-arrow">▶</span><span class="wt-acc-dot" style="background:#ab47bc;"></span><span>Betriebskosten (W + I + B)</span></div>
        <div class="wt-acc-sum" style="color:#ab47bc;">${fmtEurA(total)}</div>
      </div>
      <div class="wt-acc-body">
        <div class="wt-table-scroll">
          <table class="wt-cost-table">
            <thead><tr><th>Position</th><th class="r">€/a</th><th>Erläuterung</th></tr></thead>
            <tbody>
              <tr><td>Wartung & Instandhaltung</td><td class="r">${fmtEurA(sumWI)}</td><td class="muted"><i>Summe pro Komponente · VDI 2067</i></td></tr>
              <tr><td>Bedienkosten</td><td class="r">${fmtEurA(sumBed)}</td><td class="muted"><i>Σ Bedienstunden × Lohn</i></td></tr>
            </tbody>
            <tfoot><tr><td><b>Summe Betrieb</b></td><td class="r" style="color:var(--accent);">${fmtEurA(total)}</td><td class="muted"><i>${s.investGesamt > 0 ? fmtPct(total/s.investGesamt*100, 1) : '— %'} von Investition</i></td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── Akkordeon: CO₂-Kosten ────────────────────────────────────────────────
function renderCo2Acc(s, co2Rows, inputs) {
  const pCo2 = inputs?.pCo2 || 0;
  const rows = (co2Rows || []).map(r => {
    const dim = r.gerechnet ? '' : 'opacity:0.45;';
    const note = r.gerechnet ? r.mengenLabel : (r.mengenLabel + ' · nicht in Kosten (kein CO₂-Preis oder „nur fossile")');
    return `<tr style="${dim}">
      <td>${escHtml(r.label)}${r.fossil ? '' : ' <span style="font-size:9px;color:var(--muted);">(nicht-fossil)</span>'}</td>
      <td class="r">${r.tCo2.toFixed(1)} t/a</td>
      <td class="r">${r.gerechnet ? fmtEurA(r.kosten) : '— €'}</td>
      <td class="muted"><i>${escHtml(note)}</i></td>
    </tr>`;
  }).join('');
  const sumT = (co2Rows || []).reduce((sum, r) => sum + (r.gerechnet ? r.tCo2 : 0), 0);
  const spezG = s.totalWaerme > 0 ? Math.round((co2Rows || []).reduce((sum, r) => sum + r.tCo2, 0) * 1e6 / (s.totalWaerme * 1000)) : 0;
  return `
    <div class="wt-acc">
      <div class="wt-acc-header">
        <div class="wt-acc-title"><span class="wt-acc-arrow">▶</span><span class="wt-acc-dot" style="background:#e53935;"></span><span>CO₂-Kosten (interner Ansatz EEFB)</span></div>
        <div class="wt-acc-sum" style="color:#e53935;">${fmtEurA(s.co2Jk)}</div>
      </div>
      <div class="wt-acc-body">
        <div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic;">
          CO₂-Preis: <b style="color:var(--text);">${pCo2} €/t</b> · Faktoren je Energieträger aus dem ⚙ Kennwerte-Panel · spez. CO₂ Wärme: ${spezG} g/kWh<sub>th</sub>
        </div>
        <div class="wt-table-scroll">
          <table class="wt-cost-table">
            <thead><tr>
              <th>Energieträger</th>
              <th class="r">Emission</th>
              <th class="r">Kosten/a</th>
              <th>Berechnung</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="muted">Keine CO₂-Emittenten aktiv.</td></tr>'}</tbody>
            <tfoot><tr>
              <td><b>Summe</b></td>
              <td class="r">${sumT.toFixed(1)} t/a</td>
              <td class="r" style="color:var(--accent);">${fmtEurA(s.co2Jk)}</td>
              <td class="muted"><i>${s.totalWaerme > 0 ? (s.co2Jk*100/s.totalWaerme/1000).toFixed(2) : 0} ct/kWh<sub>th</sub></i></td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ── Akkordeon: Eingabeparameter (Preise · Zinssatz · Lohn · CO₂-Faktor) ────
function renderEingabeAcc(inputs) {
  const p = inputs.prices;
  const param = (lbl, id, val, unit) => `
    <div class="wt-param-row">
      <label>${escHtml(lbl)}</label>
      <div class="wt-param-input-wrap">
        <input class="wt-param-input" data-param="${id}" value="${formatInputNum(val)}">
        <span class="wt-param-unit">${escHtml(unit)}</span>
      </div>
    </div>`;
  // Aktuelle Strom-EmF aus DOM lesen
  const stromEmFNow = parseFloat(document.getElementById('strom-emf')?.value) || 363;
  const stromEmFLZ  = parseFloat(document.getElementById('strom-emf-lz')?.value) || 72;
  const stromEmFMid = Math.round((stromEmFNow + stromEmFLZ) / 2);
  const isHeute  = Math.abs(stromEmFNow - parseFloat(document.getElementById('strom-emf-default')?.value || 363)) < 0.5 && stromEmFNow > stromEmFMid + 5;
  const isMittel = Math.abs(stromEmFNow - stromEmFMid) < 1;
  const is2050   = Math.abs(stromEmFNow - stromEmFLZ) < 1;
  return `
    <div class="wt-acc" style="margin-top:22px;border-color:rgba(212,168,85,0.4);">
      <div class="wt-acc-header" style="background:rgba(212,168,85,0.10);">
        <div class="wt-acc-title"><span class="wt-acc-arrow">▶</span><span class="wt-acc-dot" style="background:var(--accent);"></span><span>Eingabeparameter (Preise · Zinssatz · Lohn)</span></div>
        <div class="wt-acc-sum" style="font-size:10px;color:var(--muted);font-family:inherit;font-weight:400;">Änderungen wirken sofort auf alle Werte</div>
      </div>
      <div class="wt-acc-body">
        <div class="wt-params-grid">
          ${param('Strompreis WP',     'wirt-p-strom', p.strom, 'ct/kWh')}
          ${param('Erdgaspreis',       'wirt-p-gas',   p.gas,   'ct/kWh')}
          ${param('Pelletpreis',       'wirt-p-pk',    p.pk,    'ct/kWh')}
          ${param('Hackschnitzelpreis','wirt-p-hhs',   p.hhs,   'ct/kWh')}
          ${param('Fernwärmepreis',    'wirt-p-fw',    p.fw,    'ct/kWh')}
          ${param('Heizölpreis',       'wirt-p-hko',   p.hko,   'ct/kWh')}
          ${param('CO₂-Preis (EEFB)',  'wirt-p-co2',   inputs.pCo2, '€/t')}
          ${param('Kalkulationszins',  'wirt-zins',    inputs.zins, '%/a')}
          ${param('Lohnkosten',        'wirt-lohn',    inputs.lohn, '€/h')}
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
            Prozentuale Zuschläge auf Basisinvestition <span style="text-transform:none;letter-spacing:0;font-style:italic;">(HOAI/KfW-typisch)</span>
          </div>
          <div class="wt-params-grid">
            ${param('Bauteil',           'wirt-pct-bauteil', (window._wirtPctSettings?.bauteil ?? 5),  '%')}
            ${param('Hydr. + Elt. + MSR','wirt-pct-hydr',    (window._wirtPctSettings?.hydr    ?? 12), '%')}
            ${param('Planung',           'wirt-pct-planung', (window._wirtPctSettings?.planung ?? 10), '%')}
            ${param('Unvorhergesehenes', 'wirt-pct-unvorg',  (window._wirtPctSettings?.unvorg  ?? 7),  '%')}
          </div>
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
            <label style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">Strom-CO₂-Faktor:</label>
            <div class="wt-tg" data-grp="emf">
              <button class="${isHeute ? 'active' : ''}"  data-emf-mode="heute"  data-emf-val="363">Heute (363&nbsp;g)</button>
              <button class="${isMittel ? 'active' : ''}" data-emf-mode="mittel" data-emf-val="${stromEmFMid}">Ø&nbsp;Nutzungsdauer (${stromEmFMid}&nbsp;g)</button>
              <button class="${is2050 ? 'active' : ''}"   data-emf-mode="2050"   data-emf-val="${stromEmFLZ}">Ø&nbsp;2030–2050 (${stromEmFLZ}&nbsp;g)</button>
            </div>
            <span style="font-size:10px;color:var(--muted);font-style:italic;">aktuell: <b style="color:var(--text);">${stromEmFNow} g/kWh</b> · für 20a-Annuität ist „Ø Nutzungsdauer" üblich</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Sichere Window-Exposition (für IIFE-Build-Robustheit) ─────────────────
// main.js iteriert zwar Object.entries und expose-d alles, aber im IIFE-Build
// kann das je nach Bündelungs-Reihenfolge unzuverlässig sein. Daher direkt:
if (typeof window !== 'undefined') {
  window.refreshWirtschaftView = refreshWirtschaftView;
  window.setInvOverride = setInvOverride;
  window.setVdiOverride = setVdiOverride;
  window.resetInvOverride = resetInvOverride;
  window.resetVdiOverride = resetVdiOverride;
  window.deleteKostenRow = deleteKostenRow;
  window.unhideKostenRow = unhideKostenRow;
  window.addKostenFromVorlage = addKostenFromVorlage;
  window.addKostenCustom = addKostenCustom;
  window.saveAsVorlage = saveAsVorlage;
  window.setEingabeParam = setEingabeParam;
}

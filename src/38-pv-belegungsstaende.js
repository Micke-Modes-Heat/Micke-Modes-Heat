// ── 38-pv-belegungsstaende.js — benannte Fassungen der Dachbelegung ─────────
//
// Arbeitsweise (Nutzerentscheidung 07.10.2026): Die automatische Belegung (36)
// ermittelt Belegungen, OHNE die Dächer zu belegen, und speichert sie als
// „Belegungsstand". Ein Stand lässt sich
//   👁 ansehen    — eigene, nur lesende Kartenebene (Flächen + Module); das
//                   Projekt bleibt unverändert, zum Vorstellen.
//   ⤓ aktivieren  — wird zur Arbeitsbelegung: Flächen an die Gebäude, PV-Assets
//                   angelegt/angepasst, Stromnetz rechnet mit. Ein Strg+Z-Schritt
//                   (Planungstransaktion). Danach weiter bearbeiten und
//                   zurückspeichern oder als neuen Stand sichern.
//   ★ Potenzial   — Anlagenpotenzial der PV-Analyse (09d, _pvAnalyse.potenzialStandId)
//   ☀ Auslegung   — Auslegung in der PV-Analyse mit Speicher (09d belegungsVarianten.standId)
//
// Unabhängig von den Planungsvarianten: die tragen weiter ihre eigene
// Arbeitsbelegung (lib/varianten-regeln PV-Belegung je Variante).
// Rechenkern: lib/pv-belegungsstaende.js. Nichts importiert dieses Modul —
// 25 (Panel), 36 (Vorschau), 09d (PV-Analyse) und 03c (Projektdatei) rufen über window.*.

import { map } from './02b-gebaeude.js';
import { _hasBelegung, buildPvModuleOverlay, calcGebKwp, calcGebKwpKorr, escHtml, getGebPvModules } from './03c-gebaeude-io.js';
import { deleteAsset, getAssetsForBuilding } from './13a-assets-core.js';
import { pvmPlanungsSchrittMerken, pvModusMarkiereKarte, pvModusRender } from './25-pv-modus.js';
import { pvBelegungAnwenden } from './lib/varianten-regeln.js';
import { pvbsDachAbweichung, pvbsFelder, pvbsGleich, pvbsNeu, pvbsPlan, pvbsSummen } from './lib/pv-belegungsstaende.js';

const LILA  = '#b39ddb';
const GELB  = '#ffd54f';
const GRUEN = '#66bb6a';
const ROT   = '#ef5350';
const ORANGE = '#ffb74d';

const _bs = {
  /** @type {any[]} */
  liste: [],
  /** Stand, aus dem die Arbeitsbelegung zuletzt aktiviert bzw. gespeichert wurde */
  aktivId: null,
  /** aufgeklappte Zeile im Panel */
  offenId: null,
  /** Liste im Panel eingeklappt? */
  zu: false,
};
/** @type {null | { id:string, gruppe:any, versteckt:any[] }} */
let _ansicht = null;

const _fmt = (x, d = 0) => (Number.isFinite(x) ? x : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _geb = () => window.gebaeude || [];
const _neueId = () => 'bs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _heute = () => new Date().toLocaleDateString('de-DE');
const _gibtEs = () => { const ids = new Set(_geb().map(g => String(g.id))); return id => ids.has(String(id)); };

export function pvbsListe() { return _bs.liste; }
export function pvbsStand(id) { return _bs.liste.find(s => s.id === id) || null; }

/**
 * Kennzahlen eines Stands für die PV-Analyse: Gebäude-IDs (String), kWp je Dach
 * (ertragskorrigiert, wie die PV-Assets), Summen. Nur Gebäude, die es noch gibt.
 */
export function pvbsKennzahlen(id) {
  const s = pvbsStand(id);
  if (!s) return null;
  const gibtEs = _gibtEs();
  const dachKwp = {};
  for (const [gid, e] of Object.entries(s.geb)) if (gibtEs(gid)) dachKwp[gid] = +e.kwpKorr || 0;
  const sum = pvbsSummen(s, gibtEs);
  return { id: s.id, name: s.name, beschreibung: s.beschreibung, stand: s.stand, netz: s.netz,
    dachKwp, ids: new Set(Object.keys(dachKwp)), summeKwp: sum.kwpKorr, daecher: sum.daecher,
    fehlend: Object.keys(s.geb).length - sum.daecher };
}

/** Belegung im Projekt: nur Gebäude MIT Belegung → { [gebId]: felder } */
function _projektBelegung() {
  const out = {};
  for (const g of _geb()) if (_hasBelegung(g)) out[g.id] = pvbsFelder(g);
  return out;
}

function _projektEintrag(g) {
  return { felder: pvbsFelder(g), kwp: calcGebKwp(g) || 0, kwpKorr: calcGebKwpKorr(g) || 0,
    module: getGebPvModules(g).count || 0 };
}

/** Ist die Arbeitsbelegung schon als Stand gesichert (irgendeiner gleich)? */
function _gesicherterStand() {
  const akt = _projektBelegung();
  const a = pvbsStand(_bs.aktivId);
  if (a && pvbsGleich(a, akt)) return a;
  return _bs.liste.find(s => pvbsGleich(s, akt)) || null;
}

function _nachAenderung() {
  window._pvBelegungenRefresh?.();          // Liste in der PV-Analyse (Karte 04)
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// ANLEGEN
// ══════════════════════════════════════════════════════════════════════════

/**
 * Stand aus der Vorschau der automatischen Belegung (36). `zeilen` = Dächer, die
 * „Übernehmen" belegen würde, mit Rechenkopie aus pvmProbe({mitKopie}). Dazu
 * kommt die schon vorhandene Belegung aller übrigen Dächer — der Stand zeigt die
 * ganze Liegenschaft so, wie sie nach dem Übernehmen aussähe.
 * @returns {any} der neue Stand
 */
export function pvbsAusVorschau(zeilen, meta = {}) {
  const eintraege = {};
  for (const g of _geb()) if (_hasBelegung(g)) eintraege[g.id] = _projektEintrag(g);
  for (const z of zeilen) {
    if (!z.kopie) continue;
    eintraege[z.g.id] = {
      felder: { ...pvbsFelder(z.kopie), pvAktiv: true, pvModus: 'flaechen' },
      dach: pvbsDachAbweichung(z.g, z.kopie),
      kwp: z.kwp, kwpKorr: z.kwpKorr, module: z.module,
    };
  }
  const s = pvbsNeu({ id: _neueId(), name: meta.name, herkunft: 'auto', beschreibung: meta.beschreibung,
    eintraege, netz: meta.netz || null, stand: _heute() });
  _bs.liste.push(s);
  if (meta.potenzial) pvbsPotenzial(s.id, true);
  _nachAenderung();
  return s;
}

/** Arbeitsbelegung als neuen Stand sichern. */
export function pvbsAktuellSpeichern(name) {
  const n = name ?? prompt('Name des Belegungsstands:', `Belegung ${_heute()}`);
  if (n == null) return null;
  const eintraege = {};
  for (const g of _geb()) if (_hasBelegung(g)) eintraege[g.id] = _projektEintrag(g);
  if (!Object.keys(eintraege).length && !confirm('Im Projekt ist kein Dach belegt. Trotzdem einen leeren Stand anlegen?')) return null;
  const s = pvbsNeu({ id: _neueId(), name: n.trim() || `Belegung ${_heute()}`, herkunft: 'projekt',
    beschreibung: 'aus der Arbeitsbelegung gespeichert', eintraege, stand: _heute() });
  _bs.liste.push(s);
  _bs.aktivId = s.id;
  window.showHint?.(`💾 Belegungsstand „${s.name}" gespeichert (${Object.keys(eintraege).length} Dächer).`, 5000);
  _nachAenderung();
  return s;
}

/** Arbeitsbelegung in einen bestehenden Stand zurückschreiben. */
export function pvbsUeberschreiben(id) {
  const alt = pvbsStand(id);
  if (!alt) return;
  if (!confirm(`Belegungsstand „${alt.name}" mit der aktuellen Arbeitsbelegung überschreiben?`)) return;
  const eintraege = {};
  for (const g of _geb()) if (_hasBelegung(g)) eintraege[g.id] = _projektEintrag(g);
  const neu = pvbsNeu({ id: alt.id, name: alt.name, herkunft: alt.herkunft === 'auto' ? 'kopie' : alt.herkunft,
    beschreibung: alt.herkunft === 'auto' ? `${alt.beschreibung}; danach von Hand bearbeitet` : alt.beschreibung,
    eintraege, stand: _heute(), netz: null });   // Netzprüfung der Vorschau gilt nicht mehr
  _bs.liste[_bs.liste.indexOf(alt)] = neu;
  _bs.aktivId = id;
  if (_ansicht?.id === id) pvbsAnsehen(id, true);
  window.pvMarkStale?.();
  window.showHint?.(`💾 „${neu.name}" aktualisiert (${Object.keys(eintraege).length} Dächer).`, 5000);
  _nachAenderung();
}

export function pvbsUmbenennen(id) {
  const s = pvbsStand(id);
  if (!s) return;
  const n = prompt('Neuer Name:', s.name);
  if (n == null || !n.trim()) return;
  s.name = n.trim().slice(0, 80);
  _nachAenderung();
}

export function pvbsLoeschen(id) {
  const s = pvbsStand(id);
  if (!s) return;
  const pva = window._pvAnalyse;
  const nAusl = (pva?.belegungsVarianten || []).filter(b => b.standId === id).length;
  const pot = pva?.potenzialStandId === id;
  if (!confirm(`Belegungsstand „${s.name}" löschen?`
    + (pot ? '\n\nEr ist das Anlagenpotenzial der PV-Analyse — dort gilt danach wieder die Projektbelegung.' : '')
    + (nAusl ? `\n\n${nAusl} Auslegung(en) der PV-Analyse hängen daran und werden mit entfernt.` : '')
    + '\n\nDie Dächer im Projekt bleiben, wie sie sind.')) return;
  if (_ansicht?.id === id) pvbsAnsichtEnde();
  _bs.liste = _bs.liste.filter(x => x !== s);
  if (_bs.aktivId === id) _bs.aktivId = null;
  if (pot) pva.potenzialStandId = null;
  if (nAusl) {
    const rest = pva.belegungsVarianten.filter(b => b.standId !== id);
    pva.belegungsVarianten = rest.length ? rest : null;
  }
  if (pot || nAusl) window.pvMarkStale?.();
  _nachAenderung();
}

// ══════════════════════════════════════════════════════════════════════════
// PV-ANALYSE
// ══════════════════════════════════════════════════════════════════════════

/** Stand als Anlagenpotenzial der PV-Analyse setzen (an = undefined: umschalten). */
export function pvbsPotenzial(id, an) {
  const pva = window._pvAnalyse;
  if (!pva) return;
  const neu = an === undefined ? pva.potenzialStandId !== id : !!an;
  pva.potenzialStandId = neu ? id : (pva.potenzialStandId === id ? null : pva.potenzialStandId);
  window.pvMarkStale?.();
  window._pvPotenzialRefresh?.();
  _nachAenderung();
}

/** Stand als Auslegung (mit Speicher) in die PV-Analyse geben bzw. wieder herausnehmen. */
export function pvbsAuslegung(id) {
  const pva = window._pvAnalyse;
  const s = pvbsStand(id);
  if (!pva || !s) return;
  const da = (pva.belegungsVarianten || []).filter(b => b.standId === id);
  if (da.length) {
    const rest = pva.belegungsVarianten.filter(b => b.standId !== id);
    pva.belegungsVarianten = rest.length ? rest : null;
    window.pvMarkStale?.();
  } else {
    window.pvaBelegungAnlegen?.({ standId: id, name: s.name, speicher: 'wirt' });
    window.showHint?.(`☀ „${s.name}" steht als Auslegung in der PV-Analyse (Karte „04 Anlagenpotenzial“, Speicher wählbar). Dort „Auslegungen berechnen".`, 7000);
  }
  _nachAenderung();
}

// ══════════════════════════════════════════════════════════════════════════
// ANSEHEN — nur lesende Kartenebene
// ══════════════════════════════════════════════════════════════════════════

function _pvPane() {
  if (!map.getPane('pvPane')) map.createPane('pvPane').style.zIndex = '401';
  return 'pvPane';
}

/** Projekt-PV ausblenden (merken, was wirklich auf der Karte war) */
function _projektPvAusblenden() {
  const weg = [];
  for (const g of _geb()) {
    for (const fl of g.pvFlaechen || []) {
      for (const l of [fl.layer, fl.svgLayer]) if (l && map.hasLayer(l)) { map.removeLayer(l); weg.push(l); }
    }
    if (g._pvModuleLayer && map.hasLayer(g._pvModuleLayer)) { map.removeLayer(g._pvModuleLayer); weg.push(g._pvModuleLayer); }
  }
  return weg;
}

/**
 * Stand auf der Karte zeigen: Belegungsflächen und Module aus Rechenkopien der
 * Gebäude — kein Gebäude wird verändert, Speichern/Variantenwechsel bleiben sicher.
 */
export function pvbsAnsehen(id, neuZeichnen = false) {
  const s = pvbsStand(id);
  if (!s) return;
  if (_ansicht?.id === id && !neuZeichnen) { pvbsAnsichtEnde(); return; }
  if (_ansicht) pvbsAnsichtEnde(false);
  window.showHint?.(`⏳ „${s.name}" wird gezeichnet …`, 0);
  setTimeout(() => {
    try {
      const pane = _pvPane();
      const versteckt = _projektPvAusblenden();
      const gruppe = L.layerGroup();
      const nachId = new Map(_geb().map(g => [String(g.id), g]));
      let n = 0;
      for (const [gid, e] of Object.entries(s.geb)) {
        const g = nachId.get(String(gid));
        if (!g) continue;
        const t = { ...g, ...(e.dach || {}), ...e.felder, _pvModCache: null, _pvModSig: null, _pvModuleLayer: null };
        for (const fl of t.pvFlaechen || []) {
          if (!Array.isArray(fl.polygon) || fl.polygon.length < 3) continue;
          const sperr = fl.typ === 'sperr';
          L.polygon(fl.polygon, { color: sperr ? '#78909c' : '#ffb300', weight: sperr ? 1 : 1.5, dashArray: sperr ? '3 3' : null,
            fillColor: sperr ? '#455a64' : GELB, fillOpacity: sperr ? 0.25 : 0.12, pane, interactive: false }).addTo(gruppe);
        }
        const ov = buildPvModuleOverlay(getGebPvModules(t));
        if (ov) L.svgOverlay(ov.svgEl, ov.bounds, { opacity: 1, interactive: false, pane }).addTo(gruppe);
        n++;
      }
      gruppe.addTo(map);
      _ansicht = { id, gruppe, versteckt };
      _bannerZeigen(s, n);
      window.hideHint?.();
    } catch (err) {
      console.error(err);
      window.showHint?.('Ansicht fehlgeschlagen: ' + err.message, 6000);
    }
    pvModusRender();
  }, 30);
}

/** Ansicht beenden: eigene Ebene weg, Projekt-PV wieder einblenden. */
export function pvbsAnsichtEnde(rendern = true) {
  if (!_ansicht) return;
  try { map.removeLayer(_ansicht.gruppe); } catch { /* schon weg */ }
  for (const l of _ansicht.versteckt) { try { l.addTo(map); } catch { /* Layer inzwischen ersetzt */ } }
  _ansicht = null;
  document.getElementById('pvbs-banner')?.remove();
  window.updateSperrVisibility?.();
  if (rendern) pvModusRender();
}

export function pvbsAnsichtId() { return _ansicht?.id || null; }

function _bannerZeigen(s, n) {
  document.getElementById('pvbs-banner')?.remove();
  const k = pvbsKennzahlen(s.id);
  const div = document.createElement('div');
  div.id = 'pvbs-banner';
  div.style.cssText = 'position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:1200;display:flex;align-items:center;gap:10px;'
    + `padding:6px 12px;border-radius:18px;background:rgba(20,24,34,.94);border:1px solid ${LILA};color:#eceff1;`
    + 'font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:calc(100vw - 32px);';
  div.innerHTML = `<span style="color:${LILA};">👁 Ansicht</span>
    <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.name)}</b>
    <span style="color:#b0bec5;font-family:'DM Mono',monospace;white-space:nowrap;">${n} Dächer · ${_fmt(k?.summeKwp)} kWp</span>
    <span style="color:#90a4ae;font-size:11px;white-space:nowrap;">Projekt unverändert</span>
    <button data-click="pvbsAnsichtEnde()" style="cursor:pointer;background:transparent;border:1px solid ${LILA};border-radius:12px;color:${LILA};font-size:11px;padding:1px 9px;">Ansicht beenden</button>`;
  document.body.appendChild(div);
}

// ══════════════════════════════════════════════════════════════════════════
// AKTIVIEREN — Stand wird Arbeitsbelegung
// ══════════════════════════════════════════════════════════════════════════

export function pvbsAktivieren(id) {
  const s = pvbsStand(id);
  if (!s) return;
  const gesichert = _gesicherterStand();
  const nBelegt = _geb().filter(_hasBelegung).length;
  if (gesichert?.id === id) { window.showHint?.(`„${s.name}" ist bereits die Arbeitsbelegung.`, 4000); return; }
  if (nBelegt && !gesichert) {
    const sichern = confirm(`Die aktuelle Arbeitsbelegung (${nBelegt} Dächer) ist noch nicht als Belegungsstand gespeichert.\n\n`
      + 'OK = vorher als Stand sichern · Abbrechen = ohne Sichern weiter');
    if (sichern && !pvbsAktuellSpeichern()) return;
  }
  if (!confirm(`Belegungsstand „${s.name}" aktivieren?\n\nDie Dachbelegung im Projekt wird ersetzt (${Object.keys(s.geb).length} Dächer belegt, übrige Dächer leer). `
    + 'PV-Assets werden angelegt bzw. angepasst, das Stromnetz rechnet mit.\nStrg+Z im PV-Modus nimmt den Schritt zurück.')) return;
  pvbsAnsichtEnde(false);
  window.showHint?.(`⏳ „${s.name}" wird aktiviert …`, 0);
  setTimeout(() => {
    try { _aktivierenLauf(s); }
    catch (err) {
      console.error(err);
      window.showHint?.('Aktivieren fehlgeschlagen: ' + err.message, 8000);
      return;
    }
    _bs.aktivId = id;
    pvmPlanungsSchrittMerken();
    window.pvuNachlauf?.();
    window.calcStromPanel?.();
    window.renderList?.();
    window.renderGebPvPanel?.();
    window.showHint?.(`⤓ „${s.name}" ist jetzt die Arbeitsbelegung. Strg+Z im PV-Modus nimmt den Schritt zurück.`, 7000);
    pvModusMarkiereKarte();
    _nachAenderung();
  }, 30);
}

function _aktivierenLauf(s) {
  const gebaeude = _geb();
  const vorherBelegt = new Set(gebaeude.filter(_hasBelegung).map(g => g.id));
  const lauf = () => {
    const plan = pvbsPlan(gebaeude, s, () => (window._gebPvFlCounter = (window._gebPvFlCounter || 0) + 1));
    const vorher = new Map();
    const dachGeaendert = [];
    for (const g of gebaeude) {
      const d = plan.dach.get(g.id);
      if (!d) continue;
      let anders = false;
      for (const [k, v] of Object.entries(d)) if (g[k] !== v) { g[k] = v; anders = true; }
      if (anders) dachGeaendert.push(g);
    }
    const geaendert = pvBelegungAnwenden(gebaeude, plan.belegung, vorher);
    for (const g of dachGeaendert) if (!geaendert.includes(g)) geaendert.push(g);
    for (const g of geaendert) { g._pvModCache = null; g._pvModSig = null; }
    window.variantenPvNeuZeichnen?.(geaendert, vorher);
    // PV-Assets: belegte Dächer → kWp ins Asset (legt es ggf. an); Dächer, die
    // vorher Flächen hatten und jetzt leer sind → Asset weg. PV-Assets ohne
    // Flächen (von Hand eingetragen) bleiben unberührt.
    const geaendertIds = new Set(geaendert.map(g => g.id));
    for (const g of gebaeude) {
      if (_hasBelegung(g)) {
        const hatAsset = getAssetsForBuilding(g.id).some(a => a.type === 'PV');
        if (geaendertIds.has(g.id) || !hatAsset) window.pvuFixOne?.(g.id, { ohneNachlauf: true });
      } else if (vorherBelegt.has(g.id)) {
        for (const a of getAssetsForBuilding(g.id).filter(x => x.type === 'PV')) deleteAsset(a.id, true);
      }
    }
  };
  if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction(`PV-Belegungsstand „${s.name}" aktivieren`, lauf);
  else lauf();
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-BLOCK (in 25 _html über window.pvbsBlockHtml)
// ══════════════════════════════════════════════════════════════════════════

const _knopf = (klick, inhalt, titel, farbe, an = false) => `<button class="btn-xs" data-click="${klick}" title="${escHtml(titel)}"
    style="padding:1px 6px;${farbe ? `border-color:${farbe};color:${an ? '#10131a' : farbe};${an ? `background:${farbe};` : ''}` : ''}">${inhalt}</button>`;

export function pvbsBlockHtml() {
  const pva = window._pvAnalyse;
  const gesichert = _gesicherterStand();
  const aktiv = pvbsStand(_bs.aktivId);
  const geaendert = aktiv && gesichert?.id !== aktiv.id;
  const nBelegt = _geb().filter(_hasBelegung).length;
  const gibtEs = _gibtEs();

  const zeile = s => {
    const sum = pvbsSummen(s, gibtEs);
    const istAnsicht = _ansicht?.id === s.id;
    const istArbeit = gesichert?.id === s.id;
    const pot = pva?.potenzialStandId === s.id;
    const ausl = (pva?.belegungsVarianten || []).some(b => b.standId === s.id);
    const offen = _bs.offenId === s.id;
    const status = [
      istArbeit ? `<span style="color:${GRUEN};" title="Entspricht der Arbeitsbelegung im Projekt">● aktiv</span>` : '',
      !istArbeit && aktiv?.id === s.id ? `<span style="color:${ORANGE};" title="Zuletzt aktiviert — die Arbeitsbelegung weicht inzwischen ab (bearbeitet oder zurückgenommen)">○ zuletzt</span>` : '',
      pot ? `<span style="color:${GELB};" title="Anlagenpotenzial der PV-Analyse">★</span>` : '',
      ausl ? `<span style="color:${ORANGE};" title="Auslegung in der PV-Analyse">☀</span>` : '',
    ].filter(Boolean).join(' ');
    return `
      <div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);${istAnsicht ? `background:${LILA}14;` : ''}">
        <div style="display:flex;align-items:center;gap:4px;font-size:10px;">
          <span style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-click="pvbsZeile('${s.id}')"
            title="${escHtml(`${s.name}${s.beschreibung ? ' — ' + s.beschreibung : ''} · Stand ${s.stand}`)}">${offen ? '▾' : '▸'} ${escHtml(s.name)}</span>
          ${status}
          ${_knopf(`pvbsAnsehen('${s.id}')`, '👁', istAnsicht ? 'Ansicht beenden' : 'Auf der Karte ansehen — das Projekt bleibt unverändert', LILA, istAnsicht)}
          ${_knopf(`pvbsAktivieren('${s.id}')`, '⤓', 'Als Arbeitsbelegung übernehmen (PV-Assets, Stromnetz) — ein Strg+Z-Schritt', GRUEN)}
        </div>
        <div style="font-size:9px;color:var(--muted);padding-left:10px;font-family:'DM Mono',monospace;">${sum.daecher} Dächer · ${_fmt(sum.kwpKorr)} kWp${
          s.netz?.geprueft ? (s.netz.vertraeglich ? ` · <span style="color:${GRUEN};">netzverträglich</span>` : ` · <span style="color:${ORANGE};">über Netzgrenze</span>`) : ''}</div>
        ${offen ? `
        <div style="display:flex;flex-wrap:wrap;gap:3px;padding:3px 0 2px 10px;">
          ${_knopf(`pvbsPotenzial('${s.id}')`, pot ? '★ Potenzial' : '☆ als Potenzial', 'Anlagenpotenzial der PV-Analyse (statt der Projektbelegung)', GELB, pot)}
          ${_knopf(`pvbsAuslegung('${s.id}')`, ausl ? '☀ Auslegung ✓' : '☀ als Auslegung', 'Als Auslegung mit Speicher in die PV-Analyse geben bzw. herausnehmen', ORANGE, ausl)}
          ${_knopf(`pvbsUeberschreiben('${s.id}')`, '↻ mit Arbeitsbelegung', 'Diesen Stand mit der aktuellen Arbeitsbelegung überschreiben', '')}
          ${_knopf(`pvbsUmbenennen('${s.id}')`, '✎', 'Umbenennen', '')}
          ${_knopf(`pvbsLoeschen('${s.id}')`, '🗑', 'Stand löschen (Projekt bleibt unverändert)', ROT)}
        </div>
        ${s.beschreibung ? `<div style="font-size:9px;color:var(--muted);padding:0 0 2px 10px;line-height:1.35;">${escHtml(s.beschreibung)}</div>` : ''}` : ''}
      </div>`;
  };

  const kopf = `<div style="display:flex;align-items:center;gap:5px;cursor:pointer;" data-click="pvbsZeile('__zu')">
      <span style="flex:1;color:${LILA};font-weight:600;font-size:11px;">📚 Belegungsstände${_bs.liste.length ? ` (${_bs.liste.length})` : ''}</span>
      <span style="font-size:10px;color:var(--muted);">${_bs.zu ? '▸' : '▾'}</span>
    </div>`;
  if (_bs.zu) return `<div style="margin-top:6px;border:1px solid ${LILA}55;border-radius:5px;padding:5px 7px;">${kopf}</div>`;

  const arbeit = `<div style="font-size:9px;color:var(--muted);margin:3px 0 4px;line-height:1.4;">
      Arbeitsbelegung: ${nBelegt} Dächer${gesichert ? ` = <span style="color:${GRUEN};">„${escHtml(gesichert.name)}“</span>`
        : nBelegt ? ` · <span style="color:${ORANGE};">nicht gespeichert</span>` : ''}${geaendert ? ` · zuletzt aktiviert: „${escHtml(aktiv.name)}“` : ''}
    </div>`;
  const leer = !_bs.liste.length ? `<div style="font-size:9px;color:var(--muted);line-height:1.45;margin-bottom:4px;">
      Noch keine. „⚡ Dächer automatisch belegen“ → Vorschau → „💾 Als Belegungsstand speichern“ — z. B. „Alle Dächer · Maximal“ als Gesamtpotenzial.
      Oder die Arbeitsbelegung unten sichern.</div>` : '';
  return `
    <div style="margin-top:6px;border:1px solid ${LILA}55;border-radius:5px;padding:5px 7px;background:${LILA}0a;">
      ${kopf}
      ${arbeit}
      ${leer}
      <div style="max-height:260px;overflow-y:auto;">${_bs.liste.map(zeile).join('')}</div>
      <div style="display:flex;gap:4px;margin-top:5px;">
        <button class="btn-xs" style="flex:1;border-color:${LILA};color:${LILA};" data-click="pvbsAktuellSpeichern()"
          title="Die Belegung, die gerade im Projekt ist, als neuen Stand sichern">💾 Arbeitsbelegung als Stand</button>
        ${geaendert ? _knopf(`pvbsUeberschreiben('${aktiv.id}')`, '↻', `„${aktiv.name}“ mit der Arbeitsbelegung überschreiben`, ORANGE) : ''}
      </div>
    </div>`;
}

export function pvbsZeile(id) {
  if (id === '__zu') _bs.zu = !_bs.zu;
  else _bs.offenId = _bs.offenId === id ? null : id;
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// PROJEKTDATEI (03c)
// ══════════════════════════════════════════════════════════════════════════

export function pvbsCapture() {
  return _bs.liste.length ? JSON.parse(JSON.stringify({ liste: _bs.liste, aktivId: _bs.aktivId })) : null;
}

export function pvbsRestore(d) {
  pvbsAnsichtEnde(false);
  _bs.liste = Array.isArray(d?.liste) ? d.liste : [];
  _bs.aktivId = d?.aktivId && _bs.liste.some(s => s.id === d.aktivId) ? d.aktivId : null;
  _bs.offenId = null;
}

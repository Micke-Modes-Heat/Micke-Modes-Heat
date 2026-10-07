// ── 38-pv-belegungsstaende.js — benannte Fassungen der Dachbelegung ─────────
//
// Arbeitsweise (Nutzerentscheidungen 07.10.2026):
//   • Es gibt NUR gespeicherte Belegungsstände. Die Dachbelegung im Projekt ist
//     immer genau einer davon („im Projekt"); Änderungen im PV-Modus landen
//     automatisch in ihm. Belegte Dächer ohne Stand → Stand „Projektbelegung".
//   • Drei Rollen, je genau ein Inhaber:
//       ✎ Im Projekt     — liegt auf den Dächern: PV-Assets, Stromnetz, Gutachten
//       👁 Angezeigt      — auf der Karte (Standard: der Stand im Projekt; ein
//                           anderer nur als lesende Ebene, Projekt unverändert)
//       ★ PV-Analyse     — Grundlage des Variantenvergleichs (09d potenzialStandId,
//                           null = der Stand im Projekt)
//     Dazu ☀ „als Auslegung": zusätzlich als eigene Auslegung mit Speicher rechnen.
//   • Öffnen (✎) bringt einen Stand ins Projekt (Planungstransaktion, ein Strg+Z-Schritt).
//
// Abgleich statt Ereignis-Haken (pvbsAbgleich): bei jedem Zeichnen des Panels,
// vor dem Speichern und vor der PV-Analyse wird die Projektbelegung mit dem Stand
// im Projekt verglichen (Signatur, dann genau). Entspricht sie einem anderen
// Stand (Strg+Z, Variantenwechsel) → der wird „im Projekt". Nach Variantenwechsel
// oder Laden ohne Treffer → neuer Stand. Sonst → automatisch speichern.
//
// Rechenkern: lib/pv-belegungsstaende.js. Nichts importiert dieses Modul —
// 25 (Panel), 36 (Vorschau), 09d (PV-Analyse), 03c (Projektdatei) und 01
// (Variantenwechsel) rufen über window.*.

import { map } from './02b-gebaeude.js';
import { _hasBelegung, buildPvModuleOverlay, calcGebKwp, calcGebKwpKorr, escHtml, getGebPvModules } from './03c-gebaeude-io.js';
import { deleteAsset, getAssetsForBuilding } from './13a-assets-core.js';
import { pvmPlanungsSchrittMerken, pvModusMarkiereKarte, pvModusRender } from './25-pv-modus.js';
import { pvBelegungAnwenden } from './lib/varianten-regeln.js';
import { pvbsDachAbweichung, pvbsFelder, pvbsGleich, pvbsNeu, pvbsPlan, pvbsSummen } from './lib/pv-belegungsstaende.js';

const LILA   = '#b39ddb';
const GELB   = '#ffd54f';
const GRUEN  = '#66bb6a';
const ROT    = '#ef5350';
const ORANGE = '#ffb74d';

const _bs = {
  /** @type {any[]} */
  liste: [],
  /** Stand im Projekt (liegt auf den Dächern, wird bearbeitet) */
  projektId: null,
  /** aufgeklappte Zeile im Panel */
  offenId: null,
  /** Liste im Panel eingeklappt? */
  zu: false,
};
/** @type {null | { id:string, gruppe:any, versteckt:any[] }} */
let _ansicht = null;
/** Signatur der Projektbelegung beim letzten Abgleich */
let _letzteSig = null;
/** Belegung kam von außen (Laden, Variantenwechsel): passenden Stand suchen, nicht überschreiben */
let _neuAufloesen = true;

const _fmt = (x, d = 0) => (Number.isFinite(x) ? x : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _geb = () => window.gebaeude || [];
const _neueId = () => 'bs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _heute = () => new Date().toLocaleDateString('de-DE');
const _gibtEs = () => { const ids = new Set(_geb().map(g => String(g.id))); return id => ids.has(String(id)); };

export function pvbsListe() { return _bs.liste; }
export function pvbsStand(id) { return _bs.liste.find(s => s.id === id) || null; }
/** Stand im Projekt (nach Abgleich) — id oder null. */
export function pvbsProjektId() { pvbsAbgleich(); return _bs.projektId; }
/** Grundlage der PV-Analyse: gewählter Stand oder der Stand im Projekt. */
function _analyseId() {
  const id = window._pvAnalyse?.potenzialStandId;
  return id && pvbsStand(id) ? id : _bs.projektId;
}

// ══════════════════════════════════════════════════════════════════════════
// ABGLEICH PROJEKT ↔ STAND IM PROJEKT
// ══════════════════════════════════════════════════════════════════════════

/** Billige Signatur der Projektbelegung — nur bei Änderung wird genau verglichen. */
function _projektSig() {
  const teile = [];
  for (const g of _geb()) {
    if (!_hasBelegung(g)) continue;
    const fls = (g.pvFlaechen || []).map(f => `${f.typ}${Math.round((f.flaeche || 0) * 10)}/${f.polygon?.length || 0}${f.auto || ''}${f.azimut ?? ''}${f.neigung ?? ''}`).join(',');
    teile.push(`${g.id}:${fls}:${g.pvFlBelegung ?? ''}:${g.pvFlGcr ?? ''}:${g.pvFlAusrichtung ?? ''}:${g.dachform ?? ''}:${g.dachNeigung ?? ''}:${g.dachAzimut ?? ''}`);
  }
  return teile.join('|');
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

function _projektEintraege() {
  const e = {};
  for (const g of _geb()) if (_hasBelegung(g)) e[g.id] = _projektEintrag(g);
  return e;
}

function _variantenName() {
  try { return window.aktiverVariantenName?.() || ''; } catch { return ''; }
}

/**
 * Projektbelegung und „Stand im Projekt" in Einklang bringen. Billig, solange
 * sich nichts geändert hat (Signatur). Siehe Kopfkommentar.
 * @returns {any|null} Stand im Projekt
 */
export function pvbsAbgleich() {
  const sig = _projektSig();
  if (sig === _letzteSig && !_neuAufloesen) return pvbsStand(_bs.projektId);
  const akt = _projektBelegung();
  const leer = !Object.keys(akt).length;
  const ps = pvbsStand(_bs.projektId);
  if (ps && pvbsGleich(ps, akt)) {
    // Gleiche Flächen — Kennzahlen trotzdem auffrischen (Dachform/Modulmaße ändern kWp)
    for (const [id, e] of Object.entries(_projektEintraege())) if (ps.geb[id]) Object.assign(ps.geb[id], pvbsNeu({ id: 'x', eintraege: { [id]: e } }).geb[id]);
  } else {
    const treffer = _bs.liste.find(s => s !== ps && pvbsGleich(s, akt));
    if (treffer) {
      _bs.projektId = treffer.id;                          // Strg+Z, Variantenwechsel zurück, …
    } else if (_neuAufloesen || !ps) {
      if (leer) _bs.projektId = null;
      else {
        const vn = _variantenName();
        const s = pvbsNeu({ id: _neueId(), name: vn && vn !== 'Hauptplan' ? `Projektbelegung – ${vn}` : 'Projektbelegung',
          herkunft: 'projekt', beschreibung: 'aus der Belegung im Projekt übernommen', eintraege: _projektEintraege(), stand: _heute() });
        _bs.liste.push(s);
        _bs.projektId = s.id;
      }
    } else {
      // Bearbeitet → automatisch in den Stand im Projekt speichern
      const neu = pvbsNeu({ id: ps.id, name: ps.name, herkunft: ps.herkunft === 'auto' ? 'bearbeitet' : ps.herkunft,
        beschreibung: ps.herkunft === 'auto' && !/bearbeitet/.test(ps.beschreibung) ? `${ps.beschreibung}; danach von Hand bearbeitet` : ps.beschreibung,
        eintraege: _projektEintraege(), stand: _heute(), netz: null });   // Netzprüfung der Vorschau gilt nicht mehr
      _bs.liste[_bs.liste.indexOf(ps)] = neu;
      window.pvMarkStale?.();
      if (_ansicht) {
        pvbsAnsichtEnde(false);
        window.showHint?.(`Ansicht beendet — bearbeitet wird „${neu.name}“ (im Projekt), Änderungen werden dort gespeichert.`, 6000);
      }
    }
    window._pvBelegungenRefresh?.();
  }
  _letzteSig = sig;
  _neuAufloesen = false;
  return pvbsStand(_bs.projektId);
}

/** 01 nach dem Laden einer Planungsvariante: deren Belegung kam von außen. */
export function pvbsVarianteGewechselt() {
  _neuAufloesen = true;
  if (_ansicht) pvbsAnsichtEnde(false);
}

/**
 * Kennzahlen eines Stands für die PV-Analyse: Gebäude-IDs (String), kWp je Dach
 * (ertragskorrigiert, wie die PV-Assets), Summen. Nur Gebäude, die es noch gibt.
 */
export function pvbsKennzahlen(id) {
  pvbsAbgleich();
  const s = pvbsStand(id);
  if (!s) return null;
  const gibtEs = _gibtEs();
  const dachKwp = {};
  for (const [gid, e] of Object.entries(s.geb)) if (gibtEs(gid)) dachKwp[gid] = +e.kwpKorr || 0;
  const sum = pvbsSummen(s, gibtEs);
  return { id: s.id, name: s.name, beschreibung: s.beschreibung, stand: s.stand, netz: s.netz,
    imProjekt: s.id === _bs.projektId,
    dachKwp, ids: new Set(Object.keys(dachKwp)), summeKwp: sum.kwpKorr, daecher: sum.daecher,
    fehlend: Object.keys(s.geb).length - sum.daecher };
}

function _nachAenderung() {
  window._pvBelegungenRefresh?.();          // Liste + Analyse-Grundlage in der PV-Analyse (Karte 04)
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// ANLEGEN, KOPIEREN, UMBENENNEN, LÖSCHEN
// ══════════════════════════════════════════════════════════════════════════

/**
 * Stand aus der Vorschau der automatischen Belegung (36). `zeilen` = Dächer, die
 * „Übernehmen" belegen würde, mit Rechenkopie aus pvmProbe({mitKopie}). Dazu
 * kommt die schon vorhandene Belegung aller übrigen Dächer — der Stand zeigt die
 * ganze Liegenschaft so, wie sie nach dem Übernehmen aussähe.
 */
export function pvbsAusVorschau(zeilen, meta = {}) {
  pvbsAbgleich();
  const eintraege = _projektEintraege();
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
  if (meta.potenzial) pvbsAnalyse(s.id);
  _nachAenderung();
  return s;
}

/** Kopie eines Stands — z. B. um eine Fassung zu behalten, bevor man sie bearbeitet. */
export function pvbsKopie(id) {
  pvbsAbgleich();
  const s = pvbsStand(id);
  if (!s) return;
  const name = prompt('Name der Kopie:', `${s.name} (Kopie)`);
  if (name == null) return;
  const k = JSON.parse(JSON.stringify(s));
  k.id = _neueId();
  k.name = (name.trim() || `${s.name} (Kopie)`).slice(0, 80);
  k.herkunft = 'kopie';
  k.stand = _heute();
  _bs.liste.splice(_bs.liste.indexOf(s) + 1, 0, k);
  _bs.offenId = k.id;
  window.showHint?.(`⧉ „${k.name}“ angelegt. Zum Bearbeiten „✎ öffnen“ — die Kopie kommt dann ins Projekt.`, 6000);
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
  pvbsAbgleich();
  const s = pvbsStand(id);
  if (!s) return;
  if (s.id === _bs.projektId) {
    alert(`„${s.name}“ liegt gerade im Projekt und kann nicht gelöscht werden.\n\nErst einen anderen Stand öffnen (✎).`);
    return;
  }
  const pva = window._pvAnalyse;
  const nAusl = (pva?.belegungsVarianten || []).filter(b => b.standId === id).length;
  const pot = pva?.potenzialStandId === id;
  if (!confirm(`Belegungsstand „${s.name}“ löschen?`
    + (pot ? '\n\nEr ist die Grundlage der PV-Analyse — danach rechnet sie mit dem Stand im Projekt.' : '')
    + (nAusl ? `\n\n${nAusl} Auslegung(en) der PV-Analyse hängen daran und werden mit entfernt.` : ''))) return;
  if (_ansicht?.id === id) pvbsAnsichtEnde();
  _bs.liste = _bs.liste.filter(x => x !== s);
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

/** Stand als Grundlage der PV-Analyse (Variantenvergleich) wählen. */
export function pvbsAnalyse(id) {
  const pva = window._pvAnalyse;
  if (!pva) return;
  pva.potenzialStandId = id === _bs.projektId ? null : id;   // null = folgt dem Stand im Projekt
  window.pvMarkStale?.();
  _nachAenderung();
}

/** Stand zusätzlich als Auslegung (mit Speicher) in der PV-Analyse rechnen bzw. herausnehmen. */
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
    window.showHint?.(`☀ „${s.name}“ wird in der PV-Analyse als eigene Auslegung gerechnet (Speicher in Karte „04“ wählbar). Dort „Auslegungen berechnen“.`, 7000);
  }
  _nachAenderung();
}

// ══════════════════════════════════════════════════════════════════════════
// ANZEIGEN — nur lesende Kartenebene
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
 * Einen Stand auf der Karte zeigen. Der Stand im Projekt ist ohnehin zu sehen —
 * für ihn heißt „anzeigen" nur, eine andere Ansicht zu beenden. Andere Stände
 * kommen als lesende Ebene aus Rechenkopien; kein Gebäude wird verändert.
 */
export function pvbsAnsehen(id) {
  pvbsAbgleich();
  const s = pvbsStand(id);
  if (!s) return;
  if (id === _bs.projektId || _ansicht?.id === id) { pvbsAnsichtEnde(); return; }
  if (_ansicht) pvbsAnsichtEnde(false);
  window.showHint?.(`⏳ „${s.name}“ wird gezeichnet …`, 0);
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
          L.polygon(fl.polygon, { color: sperr ? '#78909c' : LILA, weight: sperr ? 1 : 1.5, dashArray: sperr ? '3 3' : '5 3',
            fillColor: sperr ? '#455a64' : LILA, fillOpacity: sperr ? 0.25 : 0.1, pane, interactive: false }).addTo(gruppe);
        }
        const ov = buildPvModuleOverlay(getGebPvModules(t));
        if (ov) L.svgOverlay(ov.svgEl, ov.bounds, { opacity: 1, interactive: false, pane }).addTo(gruppe);
        n++;
      }
      gruppe.addTo(map);
      _ansicht = { id, gruppe, versteckt };
      _bannerZeigen(s, n);
      if (window.pvModusAktiv) pvModusMarkiereKarte();
      window.hideHint?.();
    } catch (err) {
      console.error(err);
      window.showHint?.('Anzeige fehlgeschlagen: ' + err.message, 6000);
    }
    _nachAenderung();
  }, 30);
}

/** Andere Ansicht beenden: eigene Ebene weg, die Dächer des Projekts wieder zeigen. */
export function pvbsAnsichtEnde(rendern = true) {
  if (!_ansicht) return;
  try { map.removeLayer(_ansicht.gruppe); } catch { /* schon weg */ }
  for (const l of _ansicht.versteckt) { try { l.addTo(map); } catch { /* Layer inzwischen ersetzt */ } }
  _ansicht = null;
  document.getElementById('pvbs-banner')?.remove();
  window.updateSperrVisibility?.();
  if (window.pvModusAktiv) pvModusMarkiereKarte();
  if (rendern) _nachAenderung();
}

export function pvbsAnsichtId() { return _ansicht?.id || null; }

/**
 * PV-Modus-Färbung während einer Ansicht (25 pvModusMarkiereKarte): Dächer des
 * angezeigten Stands lila, übrige neutral — sonst zeigten die Umrisse weiter die
 * Belegung im Projekt und widersprächen der Ansicht.
 * @returns {boolean} true = gefärbt (PV-Modus färbt dann nicht selbst)
 */
export function pvbsMarkiereKarte() {
  const s = _ansicht && pvbsStand(_ansicht.id);
  if (!s || !window.pvModusAktiv) return false;
  for (const g of _geb()) {
    if (!g.polygonLayer) continue;
    if (s.geb[g.id] || s.geb[String(g.id)]) g.polygonLayer.setStyle({ color: LILA, weight: 1.5, dashArray: '', fillColor: LILA, fillOpacity: 0.06 });
    else g.polygonLayer.setStyle({ color: 'rgba(255,255,255,.35)', weight: 1, dashArray: '3 4', fillColor: '#ffffff', fillOpacity: 0.02 });
  }
  return true;
}

function _bannerZeigen(s, n) {
  document.getElementById('pvbs-banner')?.remove();
  const k = pvbsKennzahlen(s.id);
  const p = pvbsStand(_bs.projektId);
  const div = document.createElement('div');
  div.id = 'pvbs-banner';
  div.style.cssText = 'position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:1200;display:flex;align-items:center;gap:10px;flex-wrap:wrap;'
    + `padding:6px 12px;border-radius:18px;background:rgba(20,24,34,.94);border:1px solid ${LILA};color:#eceff1;`
    + 'font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:calc(100vw - 32px);';
  div.innerHTML = `<span style="color:${LILA};">👁 Angezeigt</span>
    <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.name)}</b>
    <span style="color:#b0bec5;font-family:'DM Mono',monospace;white-space:nowrap;">${n} Dächer · ${_fmt(k?.summeKwp)} kWp</span>
    <span style="color:#90a4ae;font-size:11px;white-space:nowrap;">nur Ansicht · im Projekt: „${escHtml(p?.name || '—')}“</span>
    <button data-click="pvbsOeffnen('${s.id}')" style="cursor:pointer;background:transparent;border:1px solid ${GRUEN};border-radius:12px;color:${GRUEN};font-size:11px;padding:1px 9px;">✎ öffnen</button>
    <button data-click="pvbsAnsichtEnde()" style="cursor:pointer;background:transparent;border:1px solid ${LILA};border-radius:12px;color:${LILA};font-size:11px;padding:1px 9px;">Ansicht beenden</button>`;
  document.body.appendChild(div);
}

// ══════════════════════════════════════════════════════════════════════════
// ÖFFNEN — Stand kommt ins Projekt
// ══════════════════════════════════════════════════════════════════════════

export function pvbsOeffnen(id) {
  pvbsAbgleich();                                     // offene Änderungen sichern
  const s = pvbsStand(id);
  if (!s) return;
  if (id === _bs.projektId) { pvbsAnsichtEnde(); window.showHint?.(`„${s.name}“ liegt bereits im Projekt.`, 4000); return; }
  const alt = pvbsStand(_bs.projektId);
  if (!confirm(`„${s.name}“ zum Bearbeiten öffnen?\n\n`
    + `Die Dächer im Projekt zeigen danach diesen Stand (${Object.keys(s.geb).length} Dächer belegt, übrige leer); `
    + 'PV-Assets und Stromnetz werden angepasst. Änderungen werden automatisch in ihm gespeichert.'
    + (alt ? `\n„${alt.name}“ bleibt gespeichert.` : '')
    + '\n\nStrg+Z im PV-Modus nimmt den Schritt zurück.')) return;
  pvbsAnsichtEnde(false);
  window.showHint?.(`⏳ „${s.name}“ wird geöffnet …`, 0);
  setTimeout(() => {
    try { _oeffnenLauf(s); }
    catch (err) {
      console.error(err);
      window.showHint?.('Öffnen fehlgeschlagen: ' + err.message, 8000);
      return;
    }
    _bs.projektId = id;
    _letzteSig = _projektSig();
    pvmPlanungsSchrittMerken();
    window.pvuNachlauf?.();
    window.calcStromPanel?.();
    window.renderList?.();
    window.renderGebPvPanel?.();
    window.pvMarkStale?.();
    window.showHint?.(`✎ „${s.name}“ liegt jetzt im Projekt — Änderungen werden automatisch gespeichert. Strg+Z nimmt das Öffnen zurück.`, 7000);
    pvModusMarkiereKarte();
    _nachAenderung();
  }, 30);
}

function _oeffnenLauf(s) {
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
  if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction(`PV-Belegungsstand „${s.name}“ öffnen`, lauf);
  else lauf();
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-BLOCK (in 25 _html über window.pvbsBlockHtml)
// ══════════════════════════════════════════════════════════════════════════

const _knopf = (klick, inhalt, titel, farbe, an = false) => `<button class="btn-xs" data-click="${klick}" title="${escHtml(titel)}"
    style="padding:1px 6px;${farbe ? `border-color:${farbe};color:${an ? '#10131a' : farbe};${an ? `background:${farbe};` : ''}` : ''}">${inhalt}</button>`;
const _rolle = (farbe, text, titel) => `<span title="${escHtml(titel)}" style="font-size:8.5px;font-weight:700;letter-spacing:.04em;padding:0 5px;border-radius:7px;
    background:${farbe};color:#10131a;white-space:nowrap;">${text}</span>`;

export function pvbsBlockHtml() {
  const ps = pvbsAbgleich();
  const pva = window._pvAnalyse;
  const anzeigeId = _ansicht?.id || _bs.projektId;
  const analyseId = _analyseId();
  const gibtEs = _gibtEs();

  const zeile = s => {
    const sum = pvbsSummen(s, gibtEs);
    const imProjekt = s.id === _bs.projektId;
    const angezeigt = s.id === anzeigeId;
    const analyse = s.id === analyseId;
    const ausl = (pva?.belegungsVarianten || []).some(b => b.standId === s.id);
    const offen = _bs.offenId === s.id;
    const rollen = [
      imProjekt ? _rolle(GRUEN, 'IM PROJEKT', 'Liegt auf den Dächern (PV-Assets, Stromnetz, Gutachten) — Änderungen werden hier gespeichert') : '',
      angezeigt ? _rolle(LILA, 'ANGEZEIGT', 'Ist gerade auf der Karte zu sehen') : '',
      analyse ? _rolle(GELB, 'PV-ANALYSE', 'Grundlage des Variantenvergleichs in der PV-Analyse') : '',
      ausl ? _rolle(ORANGE, '☀ AUSLEGUNG', 'Wird in der PV-Analyse zusätzlich als eigene Auslegung mit Speicher gerechnet') : '',
    ].filter(Boolean).join(' ');
    return `
      <div style="padding:4px 0 3px;border-bottom:1px solid rgba(255,255,255,.06);${imProjekt ? `border-left:3px solid ${GRUEN};padding-left:4px;` : 'padding-left:7px;'}">
        <div style="display:flex;align-items:center;gap:4px;font-size:10.5px;">
          <span style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${imProjekt ? 'font-weight:600;' : ''}" data-click="pvbsZeile('${s.id}')"
            title="${escHtml(`${s.name}${s.beschreibung ? ' — ' + s.beschreibung : ''} · Stand ${s.stand}`)}">${offen ? '▾' : '▸'} ${escHtml(s.name)}</span>
          ${_knopf(`pvbsAnsehen('${s.id}')`, '👁', angezeigt && !imProjekt ? 'Ansicht beenden' : imProjekt ? 'Liegt im Projekt und ist ohnehin zu sehen' : 'Auf der Karte anzeigen — das Projekt bleibt unverändert', LILA, angezeigt && !imProjekt)}
          ${imProjekt ? '' : _knopf(`pvbsOeffnen('${s.id}')`, '✎ öffnen', 'Ins Projekt holen und bearbeiten — Änderungen werden automatisch gespeichert (ein Strg+Z-Schritt)', GRUEN)}
        </div>
        ${rollen ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin:2px 0 1px 10px;">${rollen}</div>` : ''}
        <div style="font-size:9px;color:var(--muted);padding-left:10px;font-family:'DM Mono',monospace;">${sum.daecher} Dächer · ${_fmt(sum.kwpKorr)} kWp${
          s.netz?.geprueft ? (s.netz.vertraeglich ? ` · <span style="color:${GRUEN};">netzverträglich</span>` : ` · <span style="color:${ORANGE};">über Netzgrenze</span>`) : ''}</div>
        ${offen ? `
        <div style="display:flex;flex-wrap:wrap;gap:3px;padding:4px 0 2px 10px;">
          ${_knopf(`pvbsAnalyse('${s.id}')`, analyse ? '★ PV-Analyse' : '☆ für PV-Analyse', 'Mit diesem Stand rechnet die PV-Analyse ihren Variantenvergleich', GELB, analyse)}
          ${_knopf(`pvbsAuslegung('${s.id}')`, ausl ? '☀ Auslegung ✓' : '☀ als Auslegung', 'Zusätzlich als eigene Auslegung mit Speicher in der PV-Analyse rechnen', ORANGE, ausl)}
          ${_knopf(`pvbsKopie('${s.id}')`, '⧉ Kopie', 'Kopie anlegen — z. B. um diese Fassung zu behalten, bevor man sie bearbeitet', '')}
          ${_knopf(`pvbsUmbenennen('${s.id}')`, '✎ Name', 'Umbenennen', '')}
          ${imProjekt ? '' : _knopf(`pvbsLoeschen('${s.id}')`, '🗑', 'Stand löschen (die Dächer im Projekt bleiben unverändert)', ROT)}
        </div>
        ${s.beschreibung ? `<div style="font-size:9px;color:var(--muted);padding:0 0 2px 10px;line-height:1.35;">${escHtml(s.beschreibung)}</div>` : ''}` : ''}
      </div>`;
  };

  const kopf = `<div style="display:flex;align-items:center;gap:5px;cursor:pointer;" data-click="pvbsZeile('__zu')">
      <span style="flex:1;color:${LILA};font-weight:600;font-size:11px;">📚 Belegungsstände${_bs.liste.length ? ` (${_bs.liste.length})` : ''}</span>
      <span style="font-size:10px;color:var(--muted);">${_bs.zu ? '▸' : '▾'}</span>
    </div>`;
  if (_bs.zu) return `<div style="margin-top:6px;border:1px solid ${LILA}55;border-radius:5px;padding:5px 7px;">${kopf}</div>`;

  const name = id => { const s = pvbsStand(id); return s ? `„${escHtml(s.name)}“` : '<span style="color:var(--muted);">—</span>'; };
  const uebersicht = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 6px;font-size:9.5px;margin:4px 0 5px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;align-items:baseline;">
      ${_rolle(GRUEN, 'IM PROJEKT', 'Liegt auf den Dächern')}<span>${name(_bs.projektId)}${ps ? ' <span style="color:var(--muted);">· Änderungen werden hier gespeichert</span>' : ' <span style="color:var(--muted);">· noch keine Dächer belegt</span>'}</span>
      ${_rolle(LILA, 'ANGEZEIGT', 'Auf der Karte')}<span>${name(anzeigeId)}${_ansicht ? ` <a style="cursor:pointer;color:${LILA};text-decoration:underline;" data-click="pvbsAnsichtEnde()">beenden</a>` : ''}</span>
      ${_rolle(GELB, 'PV-ANALYSE', 'Grundlage des Variantenvergleichs')}<span>${name(analyseId)}</span>
    </div>`;
  const leer = !_bs.liste.length ? `<div style="font-size:9px;color:var(--muted);line-height:1.45;margin-bottom:4px;">
      Noch keine. „⚡ Dächer automatisch belegen“ → Vorschau → „💾 Als Belegungsstand speichern“ — z. B. „Alle Dächer · Maximal“ als Gesamtpotenzial.
      Sobald Dächer belegt werden, entsteht der Stand „Projektbelegung“ von selbst.</div>` : '';
  return `
    <div style="margin-top:6px;border:1px solid ${LILA}55;border-radius:5px;padding:5px 7px;background:${LILA}0a;">
      ${kopf}
      ${_bs.liste.length ? uebersicht : ''}
      ${leer}
      <div style="max-height:300px;overflow-y:auto;">${_bs.liste.map(zeile).join('')}</div>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;line-height:1.4;">Zeile anklicken für ☆ PV-Analyse · ☀ Auslegung · ⧉ Kopie · Name · Löschen.</div>
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
  pvbsAbgleich();                                     // letzte Änderungen in den Stand im Projekt
  return _bs.liste.length ? JSON.parse(JSON.stringify({ liste: _bs.liste, projektId: _bs.projektId })) : null;
}

export function pvbsRestore(d) {
  pvbsAnsichtEnde(false);
  _bs.liste = Array.isArray(d?.liste) ? d.liste : [];
  const pid = d?.projektId ?? d?.aktivId ?? null;        // aktivId: Projektdateien vor dem 07.10.2026 (zweite Fassung)
  _bs.projektId = pid && _bs.liste.some(s => s.id === pid) ? pid : null;
  _bs.offenId = null;
  _letzteSig = null;
  _neuAufloesen = true;                                   // Projektbelegung kam aus der Datei — erst zuordnen
}

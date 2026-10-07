// ── 36-pv-auto-belegung.js — „Dächer automatisch belegen" im PV-Modus ────────
//
// Massenbelegung statt Dach für Dach. Drei Fragen, unten immer eine Vorschau:
//   ① Welche Dächer?  Umfang (alle · Neubauten · PV-Pflicht-Fälle · Auswahl ·
//      Bereich auf der Karte · Netzgebiet eines Trafos) und Eignung
//      (Mindestgröße, Nutzungstypen; belegte/abgerissene/ausgeschlossene raus).
//   ② Wie belegen?    Wie „Grundriss als Fläche" mit den Vorgaben des PV-Modus
//      (Dachform, Neigung, Belegungsgrad, Nordseite aussparen) — 25 pvmProbe
//      rechnet das auf einer Kopie, 25 pvmStapelBelegen schreibt es.
//   ③ Wie viel?       Maximal (jedes Dach voll) oder netzverträglich: dieselbe
//      Netzrechnung wie die Netzaufnahme (28 pvnaModell + Core pvnaFuellen),
//      beste Erträge zuerst, jedes Dach nur GANZ oder gar nicht
//      (Nutzerentscheidung 06.10.2026). Schon geplante PV hat Vorrang (Vorlast).
//
// Die Vorschau ändert nichts am Projekt; „Übernehmen" ist ein Strg+Z-Schritt.
// Nichts importiert dieses Modul — Panel und Karte rufen es über window.*
// (pvabBlockHtml / pvabMarkiereKarte), damit 25 kein Rückimport braucht.

import { map } from './02b-gebaeude.js';
import { polygonAreaM2 } from './02c-karte-werkzeuge.js';
import { _hasBelegung, escHtml } from './03c-gebaeude-io.js';
import { ASSETS, TYPE_RANK } from './13a-assets-core.js';
import { pvmProbe, pvmStapelBelegen, pvModusMarkiereKarte, pvModusRender } from './25-pv-modus.js';
import { pvnaEinstellungen, pvnaIstNeubau, pvnaJahre, pvnaModell } from './28-pv-netzaufnahme.js';
import { pvnaFuellen } from './lib/pv-netzaufnahme-core.js';

const CYAN  = '#4dd0e1';
const GRUEN = '#66bb6a';
const ROT   = '#ef5350';
const GRAU  = '#9e9e9e';
const GELB  = '#ffd54f';

const UMFAENGE = [
  ['alle',    'Alle Dächer'],
  ['neubau',  'Nur Neubauten'],
  ['pflicht', 'PV-Pflicht-Fälle'],
  ['auswahl', 'Ausgewählte Gebäude'],
  ['bereich', 'Bereich auf der Karte'],
  ['trafo',   'Netzgebiet eines Trafos'],
];

const _ab = {
  offen: false,
  umfang: 'alle',
  trafoId: null,
  /** @type {any} L.LatLngBounds */
  bereich: null,
  minM2: 50,
  /** ausgeschlossene Nutzungstyp-IDs ('' = ohne Typ) */
  ohneNutzung: new Set(),
  nutzungOffen: false,
  menge: 'max',               // 'max' | 'netz'
  ohneNetzBelegen: false,
  /** @type {null | {zeilen:any[], sig:string, netz:any}} */
  vorschau: null,
};
let _bereichLayer = null;
/** Trafo-Zuordnung (Gebäude-ID → Trafo-Asset-ID) für den Umfang „Netzgebiet". */
let _trafoCache = null;

const _name = g => g?.name || ('Gebäude ' + g?.id);
const _fmt = (x, d = 0) => (Number.isFinite(x) ? x : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const _int = v => { const n = parseInt(v); return Number.isFinite(n) ? n : null; };
const _flaeche = g => parseFloat(g.flaeche) || polygonAreaM2(g.polygon) || 0;
/** Vorgaben + Auswahl, mit denen eine Vorschau gerechnet wurde. */
const _sig = () => JSON.stringify([window.pvModusVorgabe || null, _ab.umfang, _ab.trafoId, _ab.minM2,
  [..._ab.ohneNutzung].sort(), _ab.menge, _ab.bereich ? _ab.bereich.toBBoxString() : null]);

const _nordSektor = () => window.pvModusVorgabe?.nordSektor ?? 45;

function _nutzungsLabel(id) {
  if (!id) return 'ohne Typ';
  return window.getNutzungstypById?.(id)?.label || String(id);
}

function _trafos() {
  return ASSETS.items.filter(a => a.type === 'Trafo')
    .map(a => ({ id: a.id, name: a.name || ('Trafo ' + a.id), kva: a.props?.leistungKVA }));
}

/**
 * Wert eines Gebäudes in einer Knoten-Map (knotenEl/knotenTrafo aus pvnaModell).
 * Gebäude hängen meist über ihre eigenen Assets im Netz (NSHV, Verbraucher, PV)
 * — gesucht wird erst das Gebäude selbst, dann seine Assets, das tiefste
 * (PV vor Verbraucher vor NSHV) zuerst: dort speist die neue Anlage ein.
 */
function _gebKnoten(gId, karte) {
  if (karte.has(gId)) return karte.get(gId);
  const eigene = ASSETS.items.filter(a => a.buildingId === gId)
    .sort((a, b) => (TYPE_RANK[b.type] ?? 6) - (TYPE_RANK[a.type] ?? 6));
  for (const a of eigene) if (karte.has(a.id)) return karte.get(a.id);
  return null;
}

function _trafoZuordnung() {
  if (_trafoCache) return _trafoCache;
  const ein = pvnaEinstellungen();
  const m = pvnaModell({ ...ein, quelle: 'alle', flaechen: 'alle' });
  _trafoCache = m.info.knotenTrafo || new Map();
  return _trafoCache;
}

function _pflichtIds() {
  const liste = window.pvPflichtGebaeudeliste?.() || [];
  return new Set(liste.filter(f => f.pflichtFall === 'neubau' || f.pflichtFall === 'dachsanierung'
    || (f.pflichtFall !== 'keine' && (f.neubau || f.dachsanierung))).map(f => f.id));
}

/**
 * Kandidaten nach Umfang und Eignung. `vorNutzung` = alle, die nur noch am
 * Nutzungstyp scheitern könnten (für die Auswahlliste der Typen).
 */
function _kandidaten() {
  const { stich, ziel } = pvnaJahre(pvnaEinstellungen());
  const jahr = Math.max(ziel, new Date().getFullYear());
  const raus = { belegt: 0, klein: 0, nutzung: 0, weg: 0 };
  let umfangOk;
  if (_ab.umfang === 'neubau') umfangOk = g => pvnaIstNeubau(g, stich);
  else if (_ab.umfang === 'pflicht') { const ids = _pflichtIds(); umfangOk = g => ids.has(g.id); }
  else if (_ab.umfang === 'auswahl') umfangOk = g => !!g.selected;
  else if (_ab.umfang === 'bereich') {
    const b = _ab.bereich;
    // Gebäude zählt, wenn seine Mitte im Rahmen liegt — angeschnittene Randgebäude nicht
    umfangOk = g => {
      if (!b) return false;
      let la = 0, ln = 0;
      for (const p of g.polygon) { la += +p.lat; ln += +p.lng; }
      return b.contains([la / g.polygon.length, ln / g.polygon.length]);
    };
  } else if (_ab.umfang === 'trafo') {
    const zu = _ab.trafoId != null ? _trafoZuordnung() : null;
    umfangOk = g => !!zu && _gebKnoten(g.id, zu) === _ab.trafoId;
  } else umfangOk = () => true;

  const vorNutzung = [], liste = [];
  for (const g of (window.gebaeude || [])) {
    if (!Array.isArray(g.polygon) || g.polygon.length < 3 || !umfangOk(g)) continue;
    const aj = _int(g.abrissjahr);
    if (window.isExcluded?.(g.id) || (aj != null && aj <= jahr)) { raus.weg++; continue; }
    if (_hasBelegung(g)) { raus.belegt++; continue; }
    if (_flaeche(g) < _ab.minM2) { raus.klein++; continue; }
    vorNutzung.push(g);
    if (_ab.ohneNutzung.has(g.nutzungstyp || '')) { raus.nutzung++; continue; }
    liste.push(g);
  }
  return { liste, vorNutzung, raus, stich };
}

// ══════════════════════════════════════════════════════════════════════════
// VORSCHAU
// ══════════════════════════════════════════════════════════════════════════

// Hinweis „⏳ …" erst zeichnen lassen; Timer statt rAF (pausiert in verdeckten Tabs)
const _naechsterFrame = () => new Promise(r => setTimeout(r, 30));

export async function pvabVorschau() {
  const { liste } = _kandidaten();
  if (!liste.length) { alert('Keine passenden Dächer — Umfang oder Mindestgröße anpassen.'); return; }
  window.showHint?.(`⏳ Probebelegung von ${liste.length} Dächern …`, 0);
  await _naechsterFrame();
  try {
    const zeilen = [];
    for (const g of liste) {
      const p = pvmProbe(g);
      if (!p || !(p.kwp > 0)) zeilen.push({ g, kwp: 0, kwpKorr: 0, status: 'leer', grund: 'kein Modul passt' });
      else zeilen.push({ g, kwp: p.kwp, kwpKorr: p.kwpKorr, module: p.module, status: 'voll', grund: '' });
    }
    const netz = _ab.menge === 'netz' ? _netzPruefen(zeilen) : null;
    _ab.vorschau = { zeilen, sig: _sig(), netz };
    window.hideHint?.();
  } catch (err) {
    console.error(err);
    window.showHint?.('Vorschau fehlgeschlagen: ' + err.message, 6000);
  }
  pvModusRender();
  pvModusMarkiereKarte();
}

function _begrenzerText(b, info) {
  if (!b) return '';
  const label = b.elementId ? (info.elInfo.get(b.elementId)?.label || b.elementId) : '';
  if (b.art === 'trafo') return 'Trafo voll: ' + label;
  if (b.art === 'strom') return 'Kabel voll: ' + label;
  if (b.art === 'spannung') return 'Spannungsanhebung > Grenze (' + label + ')';
  if (b.art === 'vorbelastet') return 'schon ausgelastet: ' + label;
  return label;
}

/**
 * Netzprüfung wie die Netzaufnahme: radiales Modell im Rechenjahr, alle schon
 * geplanten PV-Anlagen/-Dächer als Vorlast, die Kandidaten gierig nach Ertrag
 * — jedes nur ganz. Setzt status 'netz' bzw. 'ohneNetz' an den Zeilen.
 */
function _netzPruefen(zeilen) {
  const ein = pvnaEinstellungen();
  const { ziel } = pvnaJahre(ein);
  // Rechenjahr: spätestens, wenn der letzte Neubau unter den Kandidaten steht
  const jahr = Math.max(ziel, ...zeilen.map(z => _int(z.g.baujahr) || 0));
  const m = pvnaModell({ ...ein, quelle: 'alle', flaechen: 'alle', jahr });
  const { knotenEl, dachInfo, einspFaktor } = m.info;
  _trafoCache = m.info.knotenTrafo || null;
  const kandIds = new Set(zeilen.map(z => z.g.id));
  const gebById = new Map((window.gebaeude || []).map(g => [g.id, g]));
  const elemente = m.eingabe.elemente.map(e => ({ ...e }));
  const elById = new Map(elemente.map(e => [e.id, e]));

  // Bereits Geplantes hat Vorrang: PV-Assets und Gebäude mit aktiver PV → Vorlast
  let vorlastKwp = 0;
  for (const d of m.eingabe.daecher) {
    const inf = dachInfo.get(d.id);
    if (inf?.gebId != null && kandIds.has(inf.gebId)) continue;
    if (String(d.id).startsWith('G:') && !gebById.get(inf?.gebId)?.pvAktiv) continue;   // nur Dachpotenzial
    // Neu angelegte PV-Assets haben oft kein eigenes Kabel → über ihr Gebäude
    const el = elById.get(d.elementId) || (inf?.gebId != null ? elById.get(_gebKnoten(inf.gebId, knotenEl)) : null);
    if (!el) continue;
    el.vorlastKw = (+el.vorlastKw || 0) + d.kwpMax * (d.einspFaktor || einspFaktor);
    vorlastKwp += d.kwpMax;
  }

  const daecher = [];
  const nachId = new Map();
  for (const z of zeilen) {
    if (z.status !== 'voll') continue;
    const elementId = _gebKnoten(z.g.id, knotenEl);
    if (elementId == null || !elById.has(elementId)) { z.status = 'ohneNetz'; z.grund = 'nicht ans Stromnetz angebunden'; continue; }
    daecher.push({ id: z.g.id, elementId, kwpMax: z.kwp, ertragFaktor: z.kwpKorr / z.kwp, einspFaktor });
    nachId.set(z.g.id, z);
  }
  const r = pvnaFuellen({ elemente, daecher, pruefpunkte: m.eingabe.pruefpunkte,
    duGrenzePct: m.eingabe.duGrenzePct, ganzOderGar: true });
  for (const d of r.daecher) {
    const z = nachId.get(d.id);
    if (z && !(d.kwp > 0)) { z.status = 'netz'; z.grund = _begrenzerText(d.begrenzer, m.info); }
  }
  return { jahr, vorlastKwp, einspFaktor, duGrenzePct: m.eingabe.duGrenzePct,
    unbekannteQs: m.info.unbekannteQs.length, ersatzQs: m.info.ersatzQs,
    ohneTrafo: !m.eingabe.elemente.some(e => e.typ === 'trafo') };
}

export async function pvabUebernehmen() {
  const v = _ab.vorschau;
  if (!v) return;
  const ziele = v.zeilen.filter(z => z.status === 'voll' || (z.status === 'ohneNetz' && _ab.ohneNetzBelegen)).map(z => z.g);
  if (!ziele.length) { alert('Kein Dach zum Belegen.'); return; }
  window.showHint?.(`⏳ ${ziele.length} Dächer werden belegt …`, 0);
  await _naechsterFrame();
  _ab.vorschau = null;
  _trafoCache = null;
  const { anzahl, summe } = pvmStapelBelegen(ziele);
  window.showHint?.(`✓ ${anzahl} Dächer belegt · Σ ${_fmt(summe)} kWp. Strg+Z nimmt den ganzen Schritt zurück.`, 8000);
}

export function pvabVerwerfen() {
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

// ══════════════════════════════════════════════════════════════════════════
// BEREICH AUF DER KARTE
// ══════════════════════════════════════════════════════════════════════════

function _bereichZeigen() {
  const soll = _ab.offen && _ab.umfang === 'bereich' && _ab.bereich && window.pvModusAktiv;
  if (!soll) { if (_bereichLayer) { map.removeLayer(_bereichLayer); _bereichLayer = null; } return; }
  if (!_bereichLayer) {
    _bereichLayer = L.rectangle(_ab.bereich, { color: CYAN, weight: 2, dashArray: '6 4', fillOpacity: 0.05, interactive: false }).addTo(map);
  } else _bereichLayer.setBounds(_ab.bereich);
}

/**
 * Rechteck mit gedrückter Maustaste aufziehen. Läuft über Capture-Listener am
 * Kartencontainer: Gebäudepolygone schlucken ihre Mausereignisse
 * (bubblingMouseEvents:false), und ein Klick auf ein Dach würde im PV-Modus
 * sonst eine neue Fläche beginnen.
 */
export function pvabBereichZiehen() {
  if (window.pvabZiehtBereich) return;
  const cont = map.getContainer();
  window.pvabZiehtBereich = true;
  window.showHint?.('Bereich aufziehen: Maustaste gedrückt halten und ziehen · Esc bricht ab', 6000);
  const cursorVorher = cont.style.cursor;
  cont.style.cursor = 'crosshair';
  map.dragging.disable();
  let start = null, rahmen = null;
  const ll = ev => map.mouseEventToLatLng(ev);
  const schlucken = ev => { ev.stopPropagation(); ev.preventDefault(); };
  const down = ev => {
    if (ev.button !== 0) return;
    schlucken(ev);
    start = ll(ev);
    rahmen = L.rectangle(L.latLngBounds(start, start), { color: CYAN, weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(map);
  };
  const move = ev => { if (!start) return; schlucken(ev); rahmen.setBounds(L.latLngBounds(start, ll(ev))); };
  const up = ev => { if (!start) return; schlucken(ev); ende(L.latLngBounds(start, ll(ev))); };
  const taste = ev => { if (ev.key === 'Escape') { schlucken(ev); ende(null); } };
  function ende(bounds) {
    cont.removeEventListener('mousedown', down, true);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', up, true);
    document.removeEventListener('keydown', taste, true);
    // Der Klick, den der Browser nach mouseup erzeugt, darf kein Dach treffen
    setTimeout(() => cont.removeEventListener('click', schlucken, true), 0);
    cont.style.cursor = cursorVorher;
    map.dragging.enable();
    if (rahmen) map.removeLayer(rahmen);
    window.pvabZiehtBereich = false;
    const sw = bounds?.getSouthWest(), ne = bounds?.getNorthEast();
    if (bounds && sw && ne && map.distance(sw, ne) > 2) {
      _ab.bereich = bounds;
      _ab.vorschau = null;
      window.hideHint?.();
    }
    _bereichZeigen();
    pvModusRender();
    pvModusMarkiereKarte();
  }
  cont.addEventListener('mousedown', down, true);
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mouseup', up, true);
  cont.addEventListener('click', schlucken, true);
  document.addEventListener('keydown', taste, true);
}

// ══════════════════════════════════════════════════════════════════════════
// KARTE
// ══════════════════════════════════════════════════════════════════════════

/**
 * Färbt die Dächer, solange der Block offen ist: Kandidaten cyan, in der
 * Vorschau grün (wird belegt) / rot (Netz zu knapp) / grau (ohne Netz,
 * kein Modul); schon belegte Dächer wie im PV-Modus.
 * @returns {boolean} true = Karte ist gefärbt (PV-Modus färbt dann nicht selbst)
 */
export function pvabMarkiereKarte() {
  _bereichZeigen();
  if (!_ab.offen || !window.pvModusAktiv) return false;
  const status = new Map();
  if (_ab.vorschau) for (const z of _ab.vorschau.zeilen) status.set(z.g.id, z.status);
  else for (const g of _kandidaten().liste) status.set(g.id, 'kandidat');
  const farbe = { kandidat: CYAN, voll: GRUEN, netz: ROT, ohneNetz: _ab.ohneNetzBelegen ? GRUEN : GRAU, leer: GRAU };
  for (const g of (window.gebaeude || [])) {
    if (!g.polygonLayer) continue;
    const st = status.get(g.id);
    if (st) {
      const f = farbe[st];
      g.polygonLayer.setStyle({ color: f, weight: 2, dashArray: st === 'ohneNetz' || st === 'leer' ? '4 4' : '',
        fillColor: f, fillOpacity: st === 'kandidat' ? 0.12 : 0.28 });
    } else if (_hasBelegung(g)) {
      g.polygonLayer.setStyle({ color: '#ffb300', weight: 1.5, dashArray: '', fillColor: GELB, fillOpacity: 0.08 });
    } else {
      g.polygonLayer.setStyle({ color: 'rgba(255,255,255,.35)', weight: 1, dashArray: '3 4', fillColor: '#ffffff', fillOpacity: 0.02 });
    }
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-BLOCK (in 25 _html über window.pvabBlockHtml)
// ══════════════════════════════════════════════════════════════════════════

export function pvabBlockHtml() {
  if (!_ab.offen) {
    return `<button class="btn-xs" style="width:100%;margin-top:6px;border-color:${CYAN};color:${CYAN};"
        data-click="pvabToggle()" title="Viele Dächer auf einmal belegen — alle, Neubauten, PV-Pflicht, ein Bereich oder ein Trafo-Netzgebiet, wahlweise netzverträglich">
        ⚡ Dächer automatisch belegen …</button>`;
  }
  const { liste, vorNutzung, raus, stich } = _kandidaten();
  const opt = (w, l, an) => `<option value="${w}"${an ? ' selected' : ''}>${escHtml(l)}</option>`;
  const umfangLabel = w => w === 'neubau' ? `Nur Neubauten (nach ${stich})` : UMFAENGE.find(u => u[0] === w)[1];

  let umfangZusatz = '';
  if (_ab.umfang === 'bereich') {
    umfangZusatz = `<div style="display:flex;gap:4px;margin-top:4px;">
        <button class="btn-xs" style="flex:1;${_ab.bereich ? '' : `border-color:${CYAN};color:${CYAN};`}" data-click="pvabBereichZiehen()"
          title="Mit gedrückter Maustaste ein Rechteck auf der Karte aufziehen">▭ ${_ab.bereich ? 'Neu aufziehen' : 'Bereich aufziehen'}</button>
        ${_ab.bereich ? `<button class="btn-xs" data-click="pvabSet('bereich','')" title="Bereich entfernen">✕</button>` : ''}
      </div>`;
  } else if (_ab.umfang === 'trafo') {
    const tr = _trafos();
    umfangZusatz = tr.length
      ? `<select class="inp-field" style="margin-top:4px;" data-change="pvabSet('trafoId',this.value)">
          ${opt('', '— Trafo wählen —', _ab.trafoId == null)}
          ${tr.map(t => opt(String(t.id), `${t.name}${t.kva ? ` (${t.kva} kVA)` : ''}`, String(_ab.trafoId) === String(t.id))).join('')}
        </select>`
      : `<div style="font-size:9px;color:var(--muted);margin-top:3px;">Im Projekt gibt es noch keinen Trafo.</div>`;
  }

  // Nutzungstypen, die unter den Kandidaten vorkommen
  const typen = new Map();
  for (const g of vorNutzung) { const k = g.nutzungstyp || ''; typen.set(k, (typen.get(k) || 0) + 1); }
  const nAus = [..._ab.ohneNutzung].filter(k => typen.has(k)).length;
  const typZeilen = [...typen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `
      <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;padding:1px 0;">
        <input type="checkbox" ${_ab.ohneNutzung.has(k) ? '' : 'checked'} style="accent-color:${CYAN};cursor:pointer;"
          data-change="pvabNutzung('${escHtml(k)}',this.checked)"/>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_nutzungsLabel(k))}</span>
        <span style="font-family:'DM Mono',monospace;color:var(--muted);">${n}</span>
      </label>`).join('');

  const ausgelassen = [raus.belegt && `${raus.belegt} schon belegt`, raus.klein && `${raus.klein} < ${_ab.minM2} m²`,
    raus.nutzung && `${raus.nutzung} Nutzung`, raus.weg && `${raus.weg} ausgeschl./abgerissen`].filter(Boolean).join(' · ');

  const radio = (w, l, titel) => `<label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;" title="${titel}">
      <input type="radio" name="pvab-menge" ${_ab.menge === w ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
        data-change="pvabSet('menge','${w}')"/>${l}</label>`;

  return `
    <div style="margin-top:6px;border:1px solid ${CYAN}66;border-radius:5px;padding:6px 7px;background:${CYAN}0d;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
        <span style="flex:1;color:${CYAN};font-weight:600;font-size:11px;">⚡ Dächer automatisch belegen</span>
        <button class="btn-xs" data-click="pvabToggle()" title="Schließen">✕</button>
      </div>
      <div class="inp-group">
        <div class="inp-label">① Welche Dächer?</div>
        <select class="inp-field" data-change="pvabSet('umfang',this.value)">
          ${UMFAENGE.map(([w]) => opt(w, umfangLabel(w), _ab.umfang === w)).join('')}
        </select>
        ${umfangZusatz}
      </div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px;">
        <span style="flex:1;color:var(--muted);" title="Kleinere Gebäude (Garagen, Schuppen) bleiben frei">Mindestgröße</span>
        <input class="inp-field" type="number" min="0" step="10" value="${_ab.minM2}" style="width:58px;padding:2px 4px;"
          data-change="pvabSet('minM2',this.value)"/>
        <span style="color:var(--muted);">m²</span>
      </div>
      ${typen.size ? `
      <div style="font-size:9px;color:var(--muted);margin-top:5px;cursor:pointer;display:flex;gap:4px;" data-click="pvabSet('nutzungOffen','')">
        <span style="flex:1;text-transform:uppercase;letter-spacing:.06em;">Nutzungstypen${nAus ? ` (${nAus} ausgenommen)` : ''}</span>
        <span>${_ab.nutzungOffen ? '▾' : '▸'}</span>
      </div>
      ${_ab.nutzungOffen ? `<div style="max-height:110px;overflow-y:auto;margin-top:2px;">${typZeilen}</div>` : ''}` : ''}
      <div class="inp-group" style="margin-top:6px;">
        <div class="inp-label">② Belegung</div>
        <div style="font-size:9px;color:var(--muted);line-height:1.4;">Grundriss als Fläche mit den „Vorgaben für neue Dächer" (unten) — bei LoD2-Daten je Dachfläche mit echter Neigung und Ausrichtung.</div>
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;margin-top:3px;"
          title="Beim Satteldach die nach Norden zeigende Hälfte frei lassen (Sektor ±${_nordSektor()}° um Nord, unter „Vorgaben für neue Dächer“ einstellbar). Ohne Haken werden beide Dachseiten belegt.">
          <input type="checkbox" ${window.pvModusVorgabe?.nordSperr !== false ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
            data-change="pvmVorgabe('nordSperr',this.checked)"/>Nordseiten aussparen
        </label>
      </div>
      <div class="inp-group" style="margin-top:6px;">
        <div class="inp-label">③ Wie viel?</div>
        <div style="display:flex;flex-direction:column;gap:2px;">
          ${radio('max', 'Maximal — jedes Dach voll', 'Netzgrenzen werden nicht geprüft')}
          ${radio('netz', 'Netzverträglich (Bestandsnetz)', 'Wie die PV-Netzaufnahme: ohne Kabel- oder Trafo-Ertüchtigung. Beste Erträge zuerst, jedes Dach ganz oder gar nicht; bereits geplante PV hat Vorrang.')}
        </div>
        ${_ab.menge === 'netz' ? `
        <label style="display:flex;align-items:center;gap:4px;font-size:10px;cursor:pointer;margin-top:3px;"
          title="Gebäude ohne Verbindung zum erfassten Stromnetz — ihre Netzgrenze ist unbekannt">
          <input type="checkbox" ${_ab.ohneNetzBelegen ? 'checked' : ''} style="accent-color:${CYAN};cursor:pointer;"
            data-change="pvabSet('ohneNetzBelegen',this.checked)"/>Dächer ohne Netzanbindung trotzdem belegen
        </label>` : ''}
      </div>
      <div style="font-size:10px;margin-top:6px;padding-top:5px;border-top:1px solid var(--border);">
        <b style="color:${CYAN};">${liste.length}</b> Dächer kommen in Frage${ausgelassen ? `<div style="font-size:9px;color:var(--muted);">ausgelassen: ${ausgelassen}</div>` : ''}
      </div>
      ${_vorschauHtml(liste.length)}
    </div>`;
}

function _vorschauHtml(nKand) {
  const v = _ab.vorschau;
  if (!v) {
    return `<button class="btn-xs" style="width:100%;margin-top:5px;border-color:${CYAN};color:${CYAN};"
        ${nKand ? '' : 'disabled'} data-click="pvabVorschau()"
        title="Probebelegung rechnen und auf der Karte zeigen — ändert noch nichts">🔍 Vorschau berechnen</button>`;
  }
  const veraltet = v.sig !== _sig();
  const gruppe = st => v.zeilen.filter(z => z.status === st);
  const sum = zs => zs.reduce((s, z) => s + z.kwpKorr, 0);
  const voll = gruppe('voll'), netz = gruppe('netz'), ohne = gruppe('ohneNetz'), leer = gruppe('leer');
  const belegen = _ab.ohneNetzBelegen ? voll.concat(ohne) : voll;
  const zeile = (farbe, n, text, kwp) => n ? `<div style="display:flex;align-items:center;gap:5px;font-size:10px;">
      <span style="width:9px;height:9px;border-radius:2px;background:${farbe};flex:none;"></span>
      <span style="flex:1;">${n} ${text}</span>
      ${kwp != null ? `<span style="font-family:'DM Mono',monospace;">${_fmt(kwp)} kWp</span>` : ''}</div>` : '';
  const gruende = netz.concat(_ab.ohneNetzBelegen ? [] : ohne).slice(0, 8).map(z => `
      <div style="font-size:9px;color:var(--muted);display:flex;gap:4px;cursor:pointer;" data-click="pvmWaehle(${z.g.id})" title="${escHtml(z.grund)}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_name(z.g))}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;">${escHtml(z.grund)}</span>
      </div>`).join('');
  const n = v.netz;
  const netzInfo = n ? `<div style="font-size:9px;color:var(--muted);line-height:1.4;margin-top:4px;">
      Netzjahr ${n.jahr} · ${_fmt(n.einspFaktor, 1)} kW/kWp · ΔU ≤ ${_fmt(n.duGrenzePct, 1)} %${n.vorlastKwp > 0 ? ` · ${_fmt(n.vorlastKwp)} kWp schon geplant (Vorrang)` : ''}
      ${n.ohneTrafo ? `<br><span style="color:${ROT};">Kein Trafo im Netzjahr — es gibt kein Netz zum Anschließen.</span>` : ''}
      ${n.unbekannteQs && !n.ersatzQs ? `<br>⚠ ${n.unbekannteQs} Kabel ohne Querschnitt begrenzen nicht (Ersatzquerschnitt in der PV-Netzaufnahme).` : ''}
    </div>` : '';
  return `
    <div style="margin-top:6px;padding:5px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;">
      ${veraltet ? `<div style="font-size:9px;color:${GELB};margin-bottom:3px;">Auswahl oder Vorgaben geändert — Vorschau neu berechnen.</div>` : ''}
      ${zeile(GRUEN, belegen.length, 'werden belegt', sum(belegen))}
      ${zeile(ROT, netz.length, 'Netz zu knapp', sum(netz))}
      ${_ab.ohneNetzBelegen ? '' : zeile(GRAU, ohne.length, 'ohne Netzanbindung', sum(ohne))}
      ${zeile(GRAU, leer.length, 'kein Modul passt', null)}
      ${gruende ? `<div style="margin-top:4px;max-height:96px;overflow-y:auto;">${gruende}</div>` : ''}
      ${netzInfo}
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;border-color:${GRUEN};color:${GRUEN};" ${belegen.length && !veraltet ? '' : 'disabled'}
          data-click="pvabUebernehmen()" title="Belegungsflächen anlegen, kWp in die PV-Assets — ein Strg+Z-Schritt">✓ ${belegen.length} Dächer belegen</button>
        <button class="btn-xs" data-click="${veraltet ? 'pvabVorschau()' : 'pvabVerwerfen()'}" title="${veraltet ? 'Neu berechnen' : 'Vorschau verwerfen'}">${veraltet ? '↻' : '✕'}</button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════════════

export function pvabToggle() {
  _ab.offen = !_ab.offen;
  if (!_ab.offen) _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvabSet(feld, wert) {
  if (feld === 'umfang') _ab.umfang = UMFAENGE.some(u => u[0] === wert) ? wert : 'alle';
  else if (feld === 'trafoId') {
    const t = _trafos().find(x => String(x.id) === String(wert));
    _ab.trafoId = t ? t.id : null;
    _trafoCache = null;
  }
  else if (feld === 'bereich') _ab.bereich = null;
  else if (feld === 'minM2') _ab.minM2 = Math.max(0, parseFloat(wert) || 0);
  else if (feld === 'menge') _ab.menge = wert === 'netz' ? 'netz' : 'max';
  else if (feld === 'ohneNetzBelegen') { _ab.ohneNetzBelegen = !!wert; pvModusRender(); pvModusMarkiereKarte(); return; }
  else if (feld === 'nutzungOffen') { _ab.nutzungOffen = !_ab.nutzungOffen; pvModusRender(); return; }
  _ab.vorschau = null;                     // andere Auswahl → Karte zeigt gleich die neuen Kandidaten
  if (feld === 'umfang' && wert === 'bereich' && !_ab.bereich) setTimeout(pvabBereichZiehen, 0);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvabNutzung(id, an) {
  if (an) _ab.ohneNutzung.delete(id); else _ab.ohneNutzung.add(id);
  _ab.vorschau = null;
  pvModusRender();
  pvModusMarkiereKarte();
}

/** PV-Modus endet (25 pvModusStop): Vorschau und Bereichsrahmen weg. */
export function pvabBeenden() {
  _ab.vorschau = null;
  _ab.offen = false;
  _trafoCache = null;
  _bereichZeigen();
}

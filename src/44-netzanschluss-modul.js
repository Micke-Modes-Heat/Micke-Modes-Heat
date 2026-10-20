// ── 44-netzanschluss-modul.js — Netzanschluss-Modul (Auswertung › Strom › Netzanschluss) ──
//
// Eigene Seite in der Analyseansicht. Immer sichtbar (Kopf): Datenstand, Zieljahr-Schieber und die
// Antwort in drei Kacheln (Bezug reicht bis …, Einspeisung reicht bis …, Empfehlung). Darunter drei Schritte:
//   1. Bedarf    — Bezug je Jahr aus der Bedarfsprognose (wie NAP-Analyse und Gutachten 5.3),
//                  Einspeisung aus den Erzeuger-Assets je Jahr, gegen die NAP-Grenzen.
//   2. Wege      — Leistungsleiter (Bedarf, Netzebene und Wege A–D auf einer Achse, lib/netzanschluss-check),
//                  Tabelle der Wege, FNN-Bänder im Detail (lib/anschlussebenen.js), darunter Umspannwerke,
//                  Karte und Direktanschluss (43-umspannwerke.js, rendert in #na-modul-uw).
//   3. Ergebnis  — Textbaustein mit Quellen und Leistungstabelle (CSV) für die Netzanschlussanfrage.
//
// Stammdaten (Netzbetreiber, Vertrag, NAP-Grenzen) bleiben unter ⚡ Strom-Grundlagen (22); das
// Modul liest sie nur. Gerechnet wird für die aktive Variante.

import { ASSETS } from './13a-assets-core.js';
import { globalYear, aktiverVariantenName } from './01-globals-varianten.js';
import { ncReihe, ncZieljahr, ncUeberschreitung, ncWege, ncAntwort, ncBaustein, ncCsv, ncBedarfSvg, ncLeiterSvg, ncCheckliste, ncMassnahme } from './lib/netzanschluss-check.js';
import { mrStatusAusStand } from './lib/massnahmen-register.js';
import { createId } from './lib/util.js';
import { aeSvg, aeEinordnung, aeKva, AE_QUELLE } from './lib/anschlussebenen.js';
import { bpAssetLeistung } from './lib/bedarfsprognose.js';
import { uwRender, uwZielVorgabe, uwAuswahlBewertet, uwOsmStand, uwParameter, uwZielVonHand, uwKartenmodusSchliessen } from './43-umspannwerke.js';

const SECTION = 'netzanschluss';          // data-section in #analyse-view-tabs
const WRAP_ID = 'analyse-na-wrap';
const SCHRITTE = [
  { id: 'bedarf', label: '1 · Bedarf' },
  { id: 'wege', label: '2 · Wege' },
  { id: 'ergebnis', label: '3 · Ergebnis' },
];
// Frühere Schritt-Kennungen (Absprünge, Projektdateien) landen im neuen Schritt
const SCHRITT_ALIAS = { ebene: 'wege', optionen: 'wege' };
const schrittId = id => SCHRITT_ALIAS[id] || id;
// Bezug/Einspeisung in Mitteltönen — lesbar auf hellem und dunklem Grund
const FARBE = { bezug: '#3d8fd1', einsp: '#d9577f', band: 'var(--ok,#66bb6a)', ok: 'var(--ok,#66bb6a)', warn: 'var(--warn,#ffb74d)', bad: 'var(--crit,#ef5350)', na: 'var(--muted)' };
const STIL_KNOPF = 'font-size:12px;padding:3px 9px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;';

let _schritt = 'bedarf';
let _zieljahrHand = null;
let _letzte = null;   // letzte Rechnung (für Kopieren/CSV)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const de = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const kw = v => (v >= 1000 ? `${de(v / 1000, v >= 10000 ? 0 : 1)} MW` : `${de(v)} kW`);
const grenzwert = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

function _themaFarben() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => cs.getPropertyValue(n).trim() || f;
  return {
    text: v('--text', '#e0e0e0'), muted: v('--muted', '#9e9e9e'), linie: v('--border', '#3a3a3a'), raute: v('--surface', '#1e1e1e'),
    ok: v('--ok', '#66bb6a'), okFlaeche: v('--ok-bg', 'rgba(102,187,106,.14)'), warn: v('--warn', '#ffb74d'), bad: v('--crit', '#ef5350'),
    fest: v('--line-2', '#777'), flaeche: v('--surface-2', 'rgba(127,127,127,.08)'), band: v('--ok', '#66bb6a'),
  };
}

/* ── Rechnung ───────────────────────────────────────────────────────────── */
function _rechnen() {
  const stand = typeof window.napBedarfsStand === 'function' ? window.napBedarfsStand() : null;
  const assets = ASSETS.items || [];
  const heute = stand?.dataYear || globalYear || new Date().getFullYear();
  const zjAuto = ncZieljahr(stand, assets) || heute;
  const zieljahr = Math.max(heute, _zieljahrHand || zjAuto);
  const bis = Math.min(heute + 30, Math.max(zieljahr, heute + 10));
  const reihe = ncReihe({ stand, assets, von: heute, bis });
  const z0 = reihe[0], zZ = reihe.find(r => r.jahr === zieljahr) || reihe[reihe.length - 1];
  const grenzen = { bezugKw: grenzwert(window.elNapMaxBezugKw), einspKw: grenzwert(window.elNapMaxEinspKw) };
  const ziel = { jahr: zZ.jahr, bezugKw: zZ.bezugKw, einspKw: zZ.einspKw };
  // Zielleistung an den Direktanschluss weitergeben (wirkt nur ohne Handeingabe dort)
  uwZielVorgabe(ziel.bezugKw / 1000, ziel.einspKw / 1000);
  const uw = uwAuswahlBewertet();
  const p = uwParameter();
  const wege = ncWege({ ziel, grenzen, reihe, p, uw });
  const antwort = ncAntwort({ reihe, ziel, grenzen, wege, heute });
  const erzeuger = assets.filter(a => bpAssetLeistung(a).genKW > 0).length;
  return { stand, assets, heute, zjAuto, zieljahr, reihe, z0, ziel, grenzen, uw, p, wege, antwort, erzeuger, variante: aktiverVariantenName?.() || '' };
}

/* ── Seite in Auswertung › Strom ────────────────────────────────────────── */
// Früher ein schwebendes Fenster über der Karte; jetzt ein Abschnitt der Analyseansicht
// (eingehängt wie NAP-Lastgang/Knotenpunkt-Analyse, 04a ruft Build/Show über window).

/** Reiter + Seitenbereich einmalig einhängen (idempotent). */
export function naBuildAnalyseSection() {
  const tabBar = $('analyse-view-tabs');
  let btn = tabBar?.querySelector(`[data-section="${SECTION}"]`);
  if (tabBar && !btn) {
    btn = document.createElement('button');
    btn.className = 'analyse-section-tab';
    btn.dataset.section = SECTION;
    btn.textContent = 'Netzanschluss';
    btn.title = 'Netzanschluss: reicht die vereinbarte Leistung? Bedarf je Jahr, Anschlussebene, Wege zum Umspannwerk und Textbaustein für die Netzanschlussanfrage.';
    btn.addEventListener('click', () => window.setAnalyseSection?.(SECTION));
    tabBar.appendChild(btn);
  }
  // Direkt hinter „NAP-Lastgang“ einordnen (der Reiter entsteht evtl. erst später)
  const nap = tabBar?.querySelector('[data-section="nap"]');
  if (btn && nap && nap.nextElementSibling !== btn) nap.after(btn);
  if (!$(WRAP_ID)) {
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.style.display = 'none';
    wrap.innerHTML = '<div id="na-modul-body" class="na-seite"></div>';
    $('center-analyse-view')?.appendChild(wrap);
  }
}

export function naShowSection(visible) {
  naBuildAnalyseSection();
  const wrap = $(WRAP_ID);
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (visible) { uwKartenmodusSchliessen(); naModulRender(); }   // Kartenmodus gehört zur Karte
}

const _offen = () => {
  const wrap = $(WRAP_ID), view = $('center-analyse-view');
  return !!wrap && wrap.style.display !== 'none' && !!view && view.style.display !== 'none';
};

/** Zur Seite springen (Prozessleiste Auswertung, Navigation Strom › Netzanschluss). */
function _seiteZeigen() {
  naBuildAnalyseSection();
  if (typeof window.uiGeheZu === 'function' && document.body.classList.contains('ui-lkebw')) window.uiGeheZu('auswertung', SECTION);
  else { window.setViewMode?.('analyse'); window.setAnalyseSection?.(SECTION); }
}

/** Früher: Fenster ein/aus. Jetzt: Seite öffnen (Knopf in Planung › Strom, Befehlssuche). */
export function naModulToggle() {
  _seiteZeigen();
}

/** Öffnen, optional direkt in einem Schritt (Absprung aus den Strom-Grundlagen). */
export function naModulOeffnen(schritt) {
  if (SCHRITTE.some(s => s.id === schrittId(schritt))) _schritt = schrittId(schritt);
  _seiteZeigen();
  naModulRender();
}

// Kartenaktionen aus Schritt 3 (Umspannwerk zeigen, von Hand setzen) brauchen die Karte:
// 43 ruft vorher naKarteBenutzen() und nach dem Setzen naZurueckZurSeite().
let _kamVonSeite = false;
export function naKarteBenutzen() {
  if (!_offen()) return false;
  _kamVonSeite = true;
  if (typeof window.uiSchritt === 'function' && document.body.classList.contains('ui-lkebw')) window.uiSchritt('planung', { sparte: 'strom' });
  else window.setViewMode?.('karte');
  return true;
}
export function naZurueckZurSeite() {
  if (!_kamVonSeite) return;
  _kamVonSeite = false;
  _seiteZeigen();
}

export function naModulSchritt(id) {
  id = schrittId(id);
  if (!SCHRITTE.some(s => s.id === id)) return;
  _schritt = id;
  naModulRender();
}

/** Zieljahr setzen (leer = Endausbau). Das Endausbau-Jahr selbst gilt nicht als Handwert. */
export function naModulZieljahr(wert) {
  const j = parseInt(wert, 10);
  _zieljahrHand = Number.isFinite(j) && j > 1990 && j < 2100 && j !== _letzte?.zjAuto ? j : null;
  naModulRender();
}

/** Schieber: während des Ziehens alles außer dem Schieber selbst neu zeichnen, sonst verliert er den Griff. */
export function naModulZieljahrSchieben(wert) {
  const j = parseInt(wert, 10);
  if (!Number.isFinite(j)) return;
  _zieljahrHand = j !== _letzte?.zjAuto ? j : null;
  naModulRender({ regler: false });
  const anz = $('na-zj-anzeige');
  if (anz && _letzte) anz.innerHTML = _zieljahrAnzeige(_letzte);
}

const TEILE = ['na-kopf', 'na-regler', 'na-antwort', 'na-reiter', 'na-inhalt'];

/** Neu zeichnen — nur, wenn die Seite sichtbar ist (43 und 22 rufen das nach jeder Änderung). */
export function naModulRender(opt = {}) {
  if (!_offen()) return;
  const body = $('na-modul-body');
  if (!body) return;
  let d;
  try { d = _rechnen(); }
  catch (e) {
    body.innerHTML = `<div style="padding:12px;color:${FARBE.bad};font-size:12.5px;">⚠ Rechnung fehlgeschlagen: ${esc(e.message)}</div>`;
    return;
  }
  _letzte = d;
  if (TEILE.some(id => !$(id))) body.innerHTML = TEILE.map(id => `<div id="${id}"></div>`).join('');
  $('na-kopf').innerHTML = _kopfHtml(d);
  if (opt.regler !== false) $('na-regler').innerHTML = _reglerHtml(d);
  $('na-antwort').innerHTML = _antwortHtml(d);
  $('na-reiter').innerHTML = _reiterHtml();
  $('na-inhalt').innerHTML = { bedarf: _bedarfHtml, wege: _wegeHtml, ergebnis: _ergebnisHtml }[_schritt](d);
  if (_schritt === 'wege') uwRender();
}

/* ── Kopf: Grundlage und Datenstand ─────────────────────────────────────── */
const STUFE_TOKEN = { ok: 'ok', warn: 'warn', bad: 'crit' };

function _chip(stufe, text, klick, titel) {
  const t = STUFE_TOKEN[stufe];
  const farbe = t ? `var(--${t})` : 'var(--muted)';
  const stil = `display:inline-flex;align-items:center;gap:6px;font-size:12.5px;line-height:1.4;padding:2px 10px;border-radius:999px;font-family:inherit;
    border:1px solid ${stufe === 'bad' ? farbe : 'var(--border)'};background:${stufe === 'bad' ? 'var(--crit-bg,rgba(239,83,80,.12))' : 'transparent'};
    color:${stufe === 'bad' ? farbe : 'var(--text)'};${klick ? 'cursor:pointer;' : ''}`;
  const punkt = `<span style="width:7px;height:7px;border-radius:50%;background:${farbe};flex:none;"></span>`;
  return klick
    ? `<button type="button" data-click="${klick}" title="${esc(titel || '')}" style="${stil}">${punkt}${text}</button>`
    : `<span title="${esc(titel || '')}" style="${stil}">${punkt}${text}</span>`;
}

function _kopfHtml(d) {
  const { stand, grenzen: g } = d;
  const chips = [];
  chips.push(stand?.basisKw > 0
    ? _chip('ok', `Lastgang ${esc(stand.quelle || stand.dataYear)} · ${kw(stand.basisKw)} Spitze`, 'sgMjOeffnen()', 'Gemessener Lastgang (⚡ Strom-Grundlagen)')
    : _chip('bad', 'Lastgang fehlt – Bezug nur aus Maßnahmen', 'sgMjOeffnen()', 'Messjahr unter ⚡ Strom-Grundlagen laden'));
  const grenzText = `${g.bezugKw ? `${de(g.bezugKw)} kVA` : '—'} / ${g.einspKw ? `${de(g.einspKw)} kW` : '—'}`;
  chips.push(g.bezugKw && g.einspKw ? _chip('ok', `Vereinbart ${grenzText}`, 'sgNaOeffnen()', 'NAP-Grenzen bearbeiten')
    : g.bezugKw || g.einspKw ? _chip('warn', `Vereinbart ${grenzText}`, 'sgNaOeffnen()', 'Eine Richtung fehlt — NAP-Grenzen ergänzen')
    : _chip('bad', 'Vereinbarte Leistung fehlt', 'sgNaOeffnen()', 'NAP-Grenzen eintragen — ohne sie lässt sich keine Überschreitung bestimmen'));
  chips.push(d.erzeuger
    ? _chip('ok', `${d.erzeuger} Erzeuger · ${kw(d.z0.einspKw)} heute`, '', 'Erzeuger-Assets mit Nennleistung (PV, KWK, Wind, Batterie)')
    : _chip('na', 'keine Erzeuger', '', 'Keine Erzeuger-Assets — Einspeisung 0'));
  chips.push(d.uw ? _chip('ok', `${esc(d.uw.name || 'Umspannwerk')} gewählt`, "naModulSchritt('wege')", 'Umspannwerk für den Direktanschluss (Weg C)')
    : _chip('na', 'kein Umspannwerk gewählt', "naModulSchritt('wege')", 'Unter „2 · Wege" Umspannwerke laden und eines wählen'));
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:12px;color:var(--muted);margin:8px 0 6px;">
      <span>Variante <b style="color:var(--text);">${esc(d.variante || '—')}</b></span>
      <span>Messjahr <b style="color:var(--text);">${d.heute}</b></span>
      <button data-click="naModulRender()" title="Neu rechnen (z. B. nach Änderung der NAP-Grenzen oder Assets)" style="${STIL_KNOPF}margin-left:auto;">⟳ neu rechnen</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${chips.join('')}</div>`;
}

/* ── Zieljahr-Schieber ──────────────────────────────────────────────────── */
function _zieljahrAnzeige(d) {
  return `<b style="color:var(--text);font-size:15px;">${d.zieljahr}</b> `
    + (_zieljahrHand ? `<a href="#" data-click="event.preventDefault();naModulZieljahr('')" style="color:var(--accent);" title="Zurück auf den Endausbau der Bedarfsprognose">↺ Endausbau ${d.zjAuto}</a>` : '<span>(Endausbau)</span>');
}

function _reglerHtml(d) {
  const max = Math.min(d.heute + 30, Math.max(d.zjAuto + 5, d.heute + 10));
  const pct = max > d.heute ? (d.zjAuto - d.heute) / (max - d.heute) * 100 : 0;
  return `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;font-size:12.5px;color:var(--muted);margin-bottom:10px;">
      <label for="na-zieljahr">Zieljahr</label>
      <div style="position:relative;padding-bottom:12px;">
        <input id="na-zieljahr" type="range" min="${d.heute}" max="${max}" step="1" value="${d.zieljahr}" data-input="naModulZieljahrSchieben(this.value)"
          style="width:100%;accent-color:var(--brand,#00bcd4);margin:0;" title="Bis wann soll der Anschluss reichen?"/>
        <span style="position:absolute;left:0;bottom:-2px;font-size:11px;">${d.heute}</span>
        <span style="position:absolute;left:${pct.toFixed(1)}%;transform:translateX(-50%);bottom:-2px;font-size:11px;white-space:nowrap;${pct > 85 ? 'display:none;' : ''}">▲ Endausbau</span>
        <span style="position:absolute;right:0;bottom:-2px;font-size:11px;">${max}</span>
      </div>
      <span id="na-zj-anzeige" style="white-space:nowrap;min-width:150px;">${_zieljahrAnzeige(d)}</span>
    </div>`;
}

/* ── Antwort: drei Kacheln ──────────────────────────────────────────────── */
function _kachel(art, a, { empfehlung = false, klick = '' } = {}) {
  const t = STUFE_TOKEN[a.stufe];
  const hg = empfehlung && a.weg ? 'var(--brand-weak,rgba(0,188,212,.12))' : t ? `var(--${t}-bg,rgba(127,127,127,.1))` : 'transparent';
  const rand = empfehlung && a.weg ? 'var(--brand,#00bcd4)' : t ? `var(--${t})` : 'var(--border)';
  const farbe = empfehlung && a.weg ? 'var(--brand,#00bcd4)' : t ? `var(--${t})` : 'var(--muted)';
  return `<div ${klick ? `data-click="${klick}" role="button" tabindex="0"` : ''} style="background:${hg};border:1px solid ${rand};border-radius:6px;padding:9px 12px;
      display:flex;flex-direction:column;gap:2px;min-width:0;${klick ? 'cursor:pointer;' : ''}">
      <span style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:${farbe};">${art}</span>
      <span style="font-size:17px;font-weight:700;line-height:1.25;color:var(--text);">${esc(a.satz)}</span>
      <span style="font-size:12px;color:var(--muted);">${esc(a.unter)}</span></div>`;
}

function _antwortHtml(d) {
  const a = d.antwort, zj = d.ziel.jahr;
  const empf = a.empfehlung.weg && a.empfehlung.weg !== 'A' && _schritt !== 'wege' ? "naModulSchritt('wege')" : '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:14px;">
      ${_kachel(`<span style="color:${FARBE.bezug};">●</span> Bezug`, a.bezug)}
      ${_kachel(`<span style="color:${FARBE.einsp};">●</span> Einspeisung`, a.einsp)}
      ${_kachel(`Empfehlung bis ${zj}`, a.empfehlung, { empfehlung: true, klick: empf })}
    </div>`;
}

function _reiterHtml() {
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px;">
    ${SCHRITTE.map(s => `<button data-click="naModulSchritt('${s.id}')" style="font-size:12.5px;padding:4px 12px;border-radius:4px;cursor:pointer;
      border:1px solid ${s.id === _schritt ? 'var(--brand,#00bcd4)' : 'var(--border)'};background:${s.id === _schritt ? 'var(--brand-weak,rgba(0,188,212,.18))' : 'transparent'};
      color:${s.id === _schritt ? 'var(--text)' : 'var(--muted)'};font-weight:${s.id === _schritt ? 600 : 400};">${s.label}</button>`).join('')}</div>`;
}

/* ── 1 · Bedarf ─────────────────────────────────────────────────────────── */
function _bedarfHtml(d) {
  const { reihe, z0, ziel, grenzen, stand } = d;
  const uB = ncUeberschreitung(reihe, 'bezugKw', grenzen.bezugKw);
  const uE = ncUeberschreitung(reihe, 'einspKw', grenzen.einspKw);
  const ueber = (u, g) => !g ? '<span style="color:var(--muted);">keine Grenze</span>'
    : u == null ? `<span style="color:${FARBE.ok};">nicht bis ${reihe[reihe.length - 1].jahr}</span>`
    : u <= d.heute ? `<span style="color:${FARBE.bad};">schon heute</span>`
    : `<span style="color:${FARBE.warn};">ab ${u}</span>`;
  const zeile = (name, farbe, feld, g, einheit, u) => `<tr>
      <td style="padding:4px 6px;color:${farbe};font-weight:600;">${name}</td>
      <td style="padding:4px 6px;text-align:right;">${kw(z0[feld])}</td>
      <td style="padding:4px 6px;text-align:right;">${kw(ziel[feld])}</td>
      <td style="padding:4px 6px;text-align:right;">${g ? `${de(g)} ${einheit}` : '—'}</td>
      <td style="padding:4px 6px;">${ueber(u, g)}</td></tr>`;
  // Fehlende Daten (Lastgang, NAP-Grenzen) stehen als rote Chips im Kopf
  const abgewaehlt = (stand?.massnahmen || []).filter(m => !m.checked).length;
  const leer = !reihe.some(r => r.bezugKw > 0 || r.einspKw > 0);
  const diagramm = leer
    ? `<div style="padding:22px 10px;text-align:center;font-size:12.5px;color:var(--muted);border:1px dashed var(--border);border-radius:6px;">
        Noch keine Leistungsdaten — Lastgang unter ⚡ Strom-Grundlagen laden bzw. Verbraucher und Erzeuger im Elektro-Tab anlegen.</div>`
    : ncBedarfSvg({ reihe, grenzen, zieljahr: ziel.jahr, farben: { ..._themaFarben(), bezug: FARBE.bezug, einsp: FARBE.einsp } });
  return `${diagramm}
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px;">
      <thead><tr style="color:var(--muted);font-size:12px;text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:4px 6px;"></th><th style="padding:4px 6px;text-align:right;">${d.heute}</th><th style="padding:4px 6px;text-align:right;">Zieljahr ${ziel.jahr}</th>
        <th style="padding:4px 6px;text-align:right;">vereinbart</th><th style="padding:4px 6px;">Überschreitung</th></tr></thead>
      <tbody>${zeile('Bezug', FARBE.bezug, 'bezugKw', grenzen.bezugKw, 'kVA', uB)}${zeile('Einspeisung', FARBE.einsp, 'einspKw', grenzen.einspKw, 'kW', uE)}</tbody>
    </table>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5;">
      Bezug: Bedarfsprognose wie Gutachten 5.3 — gemessene Höchstlast ${stand?.basisKw > 0 ? `${kw(stand.basisKw)} (${esc(stand.quelle || stand.dataYear)})` : '—'} plus Neubau/Rückbau,
      Gleichzeitigkeitsfaktor ${de(stand?.gzf ?? 1, 2)}${abgewaehlt ? `, ${abgewaehlt} Maßnahme(n) abgewählt` : ''}.
      <a href="#" data-click="event.preventDefault();ggBedarfNapOeffnen()" style="color:var(--accent);">Maßnahmen und GZF in der NAP-Analyse</a>.
      Einspeisung: Nennleistung aller Erzeuger (PV, KWK, Wind, Batterie im Einspeisebetrieb), die im Jahr stehen, ohne Gleichzeitigkeitsfaktor.
      Vergleich wie im Gutachten: kW gegen vereinbarte kVA.</div>`;
}

/* ── 2 · Wege ───────────────────────────────────────────────────────────── */
function _leiterHtml(d) {
  const sw = stil => `<span style="display:inline-block;width:24px;height:10px;border-radius:2px;vertical-align:middle;margin-right:4px;${stil}"></span>`;
  const svg = ncLeiterSvg({ ziel: d.ziel, p: d.p, wege: d.wege, farben: { ..._themaFarben(), bezug: FARBE.bezug, einsp: FARBE.einsp } });
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px;">
      <b style="font-size:13.5px;">Welcher Weg trägt den Bedarf ${d.ziel.jahr}?</b>
      <span style="display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);">
        <span>${sw('background:var(--ok,#66bb6a);')}belastbar (Vertrag, eigenes Kabel)</span>
        <span>${sw('background:repeating-linear-gradient(135deg,var(--ok,#66bb6a) 0 2px,transparent 2px 6px);border:1px solid var(--ok,#66bb6a);')}Annahme / Orientierung</span>
        <span><span style="color:${FARBE.bezug};">●</span> Bezug <span style="color:${FARBE.einsp};">●</span> Einspeisung <span style="color:${FARBE.einsp};">|</span> Einspeisezusage</span>
      </span></div>
    <div style="overflow-x:auto;"><div style="min-width:620px;">${svg}</div></div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 12px;line-height:1.5;">
      Grün hinterlegt = Weg trägt den Bedarf im Zieljahr. Maßgeblich ist die größere der beiden Leistungen, umgerechnet mit cos φ ${de(d.p.cosPhi, 2)} in kVA.
      Der Streifen oben fasst die FNN-Bänder je Netzebene zusammen (Mauszeiger darauf zeigt die Einzelbänder).</div>`;
}

function _wegeHtml(d) {
  return _leiterHtml(d) + _optionenHtml(d) + _ebeneDetailHtml(d)
    + '<div id="na-modul-uw" style="border-top:1px solid var(--border);padding-top:6px;"></div>';
}

/** FNN-Bänder im Detail — früher eigener Schritt „Ebene", jetzt aufklappbar unter den Wegen. */
function _ebeneDetailHtml(d) {
  return `<details style="margin:0 0 10px;"><summary style="font-size:12px;color:var(--muted);cursor:pointer;">Anschlussebenen im Detail (FNN-Bänder und Beispiel-TAB)</summary>
    <div style="margin-top:6px;">${_ebeneHtml(d)}</div></details>`;
}

function _ebeneHtml(d) {
  const { z0, ziel } = d;
  const marker = [
    { kva: z0.bezugKw, farbe: FARBE.bezug, label: `B ${d.heute}`, gestrichelt: true },
    { kva: ziel.bezugKw, farbe: FARBE.bezug, label: `B ${ziel.jahr}` },
    { kva: z0.einspKw, farbe: FARBE.einsp, label: `E ${d.heute}`, gestrichelt: true },
    { kva: ziel.einspKw, farbe: FARBE.einsp, label: `E ${ziel.jahr}` },
  ].filter(m => m.kva > 0 && !(m.gestrichelt && Math.abs(m.kva - (m.farbe === FARBE.bezug ? ziel.bezugKw : ziel.einspKw)) < 1));
  const block = (titel, farbe, kva) => {
    if (!(kva > 0)) return `<div style="flex:1;min-width:220px;"><b style="color:${farbe};">${titel}</b><div style="color:var(--muted);font-size:12px;">kein Wert</div></div>`;
    const e = aeEinordnung(kva);
    return `<div style="flex:1;min-width:220px;border-left:3px solid ${farbe};padding-left:8px;">
        <b style="color:${farbe};">${titel}: ${aeKva(kva)}</b>
        <div style="font-size:12px;margin-top:2px;"><span style="color:var(--muted);">häufig:</span> ${e.haeufig.length ? e.haeufig.map(b => esc(b.name)).join(' · ') : '—'}</div>
        <div style="font-size:12px;"><span style="color:var(--muted);">kommt vor:</span> ${e.moeglich.length ? e.moeglich.map(b => esc(b.name)).join(' · ') : '—'}</div>
        <div style="font-size:12px;"><span style="color:var(--muted);">Beispiel-TAB:</span> ${esc(e.tab?.lang || '—')}</div></div>`;
  };
  return `${aeSvg({ farben: { ..._themaFarben(), band: FARBE.band }, marker })}
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:12.5px;">
      ${block(`Bezug ${ziel.jahr}`, FARBE.bezug, ziel.bezugKw)}${block(`Einspeisung ${ziel.jahr}`, FARBE.einsp, ziel.einspKw)}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;line-height:1.5;">
      Bänder: kräftig = häufig, blass = kommt vor; gestrichelte Marker = Messjahr, durchgezogen = Zieljahr. Die Bänder stammen aus realisierten
      Erzeugungsanlagen; für den Bezug gelten sie als Orientierung. Verbindlich ist die TAB des zuständigen Netzbetreibers.
      Quelle: ${esc(AE_QUELLE)}.</div>`;
}

/** Wege A–D als Karten: Status, Kennzahlen, nächster Schritt; der empfohlene Weg ist markiert. */
function _optionenHtml(d) {
  const empf = d.antwort.empfehlung.weg;
  const karte = w => {
    const st = STUFE_TOKEN[w.ampel.stufe];
    const farbe = st ? `var(--${st})` : 'var(--muted)';
    const istEmpf = w.id === empf;
    const zeile = (k, v) => `<dt style="color:var(--muted);">${k}</dt><dd style="margin:0;text-align:right;font-variant-numeric:tabular-nums;">${esc(v)}</dd>`;
    const n = w.naechster || {};
    const naechster = n.aktion
      ? `<button type="button" data-click="naWegAktion('${n.aktion}')" style="all:unset;cursor:pointer;color:var(--accent);font-weight:600;">→ ${esc(n.text)}</button>`
      : `<span style="color:var(--muted);">${esc(n.text || '')}</span>`;
    return `<div style="position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;background:var(--surface,transparent);border-radius:6px;
        border:${istEmpf ? '2px solid var(--brand,#00bcd4)' : '1px solid var(--border)'};padding:${istEmpf ? '9px 11px' : '10px 12px'};${w.ampel.stufe === 'na' ? 'opacity:.75;' : ''}">
        ${istEmpf ? '<span style="position:absolute;top:-10px;right:10px;background:var(--brand,#00bcd4);color:var(--on-brand,#fff);font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;">Empfohlen</span>' : ''}
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="flex:none;width:24px;height:24px;border-radius:4px;border:1px solid var(--line-2,var(--border));background:var(--surface-2,transparent);display:grid;place-items:center;font-weight:700;font-size:13px;">${w.id}</span>
          <b style="font-size:13.5px;line-height:1.25;">${esc(w.kurz)}</b></div>
        <span style="align-self:flex-start;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;color:${farbe};background:${st ? `var(--${st}-bg,transparent)` : 'var(--surface-2,transparent)'};">${esc(w.ampel.text)}</span>
        <span style="font-size:12px;color:var(--muted);line-height:1.35;">${esc(w.titel)}</span>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:1px 8px;margin:0;font-size:12px;">
          ${zeile('trägt', w.traegt)}${zeile('Kosten', w.kosten)}${zeile('zahlt', w.zahlt)}${zeile('Ebene', w.ebene)}</dl>
        <div style="margin-top:auto;padding-top:6px;border-top:1px solid var(--border);font-size:12.5px;">${naechster}</div>
      </div>`;
  };
  return `${uwZielVonHand() ? `<div style="font-size:12px;color:${FARBE.warn};margin-bottom:6px;">⚠ Der Direktanschluss rechnet mit einer Zielleistung von Hand (unten im Umspannwerk-Abschnitt unter „Annahmen").</div>` : ''}
    <style>.na-wege-rahmen{container-type:inline-size}.na-wege{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:10px}
      @container (max-width:860px){.na-wege{grid-template-columns:repeat(2,minmax(0,1fr))}}@container (max-width:440px){.na-wege{grid-template-columns:1fr}}</style>
    <div class="na-wege-rahmen"><div class="na-wege">${d.wege.map(karte).join('')}</div></div>
    <div style="font-size:11px;color:var(--muted);margin:6px 0 10px;">Kosten des Direktanschlusses als Spanne −20 % / +40 % (eigene Richtwerte, unter „Annahmen" änderbar).
      Ob Netz und Umspannwerk die Leistung aufnehmen, klärt nur die Netzanschlussanfrage.</div>`;
}

/** Nächster Schritt aus einer Wege-Karte. */
export function naWegAktion(aktion) {
  if (aktion === 'grenzen') window.sgNaOeffnen?.();
  else if (aktion === 'ergebnis') naModulSchritt('ergebnis');
  else if (aktion === 'uw-zeigen') window.uwZeigen?.();
  else if (aktion === 'uw-waehlen') $('na-modul-uw')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (aktion === 'pva') {
    if (typeof window.uiGeheZu === 'function' && document.body.classList.contains('ui-lkebw')) window.uiGeheZu('auswertung', 'pva');
    else { window.setViewMode?.('analyse'); window.setAnalyseSection?.('pva'); }
  }
}

/* ── 3 · Ergebnis ───────────────────────────────────────────────────────── */
function _bausteinText(d) {
  const uw = d.uw ? { ...d.uw } : null;
  return ncBaustein({ stand: d.stand, ziel: d.ziel, grenzen: d.grenzen, reihe: d.reihe, uw, osmStand: uwOsmStand() });
}

const _napAsset = () => (ASSETS.items || []).find(a => a.type === 'NAP') || null;
const _naMassnahme = nap => (nap?.massnahmen || []).find(m => m?.netzanschlussWeg) || null;
const _euro = n => (n > 0 ? `${Math.round(n).toLocaleString('de-DE')} €` : '—');

/** Steckbrief: Kennzahlen, Textbaustein, Maßnahme-Übernahme und Checkliste für die Anfrage. */
function _ergebnisHtml(d) {
  const text = _bausteinText(d);
  const sKva = Math.max(d.ziel.bezugKw, d.ziel.einspKw) / (d.p.cosPhi || 1);
  const empf = d.antwort.empfehlung;
  const zahl = (label, wert, farbe = 'var(--text)') => `<div style="background:var(--surface-2,rgba(127,127,127,.08));border-radius:4px;padding:6px 9px;min-width:0;">
      <div style="font-size:11.5px;color:var(--muted);">${label}</div><div style="font-size:16px;font-weight:700;color:${farbe};font-variant-numeric:tabular-nums;">${wert}</div></div>`;
  const kopf = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">
      ${zahl(`Bezug ${d.ziel.jahr}`, kw(d.ziel.bezugKw), FARBE.bezug)}${zahl(`Einspeisung ${d.ziel.jahr}`, kw(d.ziel.einspKw), FARBE.einsp)}
      ${zahl('maßgeblich', aeKva(sKva))}${zahl('Empfehlung', esc(empf.weg ? `Weg ${empf.weg}` : '—'))}</div>`;
  const baustein = `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Textbaustein (z. B. für das Gutachten im Anschluss an 5.1.1) — Variante ${esc(d.variante || '—')}, Zieljahr ${d.ziel.jahr}${d.uw ? `, Umspannwerk ${esc(d.uw.name || 'ohne Namen')}` : ''}.</div>
    <div id="na-modul-baustein" style="font-size:12.5px;line-height:1.6;padding:10px 12px;border:1px solid var(--border);border-radius:6px;user-select:text;">${esc(text)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">
      <button data-click="naBausteinKopieren()" style="${STIL_KNOPF}">Text kopieren</button>
      <button data-click="naLeistungstabelleCsv()" style="${STIL_KNOPF}" title="Bezug und Einspeisung je Jahr mit den vereinbarten Grenzen — Anlage zur Netzanschlussanfrage">⤓ Leistungstabelle (CSV)</button>
      <span id="na-modul-status" style="font-size:12px;color:var(--muted);"></span>
    </div>`;
  return `${kopf}
    <div class="na-erg-rahmen"><style>.na-erg-rahmen{container-type:inline-size}.na-erg{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:16px;align-items:start}
      @container (max-width:760px){.na-erg{grid-template-columns:1fr}}</style>
      <div class="na-erg">
        <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">${_massnahmeHtml(d)}<div>${baustein}</div></div>
        ${_checklisteHtml(d)}
      </div></div>`;
}

/* Maßnahme: ein Weg wird als Maßnahme am NAP-Asset der aktiven Variante angelegt (bzw. aktualisiert). */
let _massnWeg = null;   // null = Empfehlung

function _massnahmeHtml(d) {
  const nap = _napAsset();
  const vorhanden = _naMassnahme(nap);
  const wegId = _massnWeg || vorhanden?.netzanschlussWeg || d.antwort.empfehlung.weg || 'B';
  const weg = d.wege.find(w => w.id === wegId) || d.wege[1];
  const v = ncMassnahme({ weg, reihe: d.reihe, grenzen: d.grenzen, ziel: d.ziel, p: d.p, heute: d.heute, uw: d.uw });
  const optionen = d.wege.map(w => `<option value="${w.id}"${w.id === weg.id ? ' selected' : ''}>${w.id} · ${esc(w.kurz)}${w.id === d.antwort.empfehlung.weg ? ' (empfohlen)' : ''}</option>`).join('');
  const nr = vorhanden ? window.massnahmeEintrag?.(vorhanden)?.nr : null;
  const knopf = !nap
    ? `<span style="font-size:12px;color:var(--c-orange);">Kein NAP-Asset im Projekt — im Elektro-Tab anlegen, dann lässt sich der Weg als Maßnahme übernehmen.</span>`
    : `<button data-click="naMassnahmeUebernehmen()" style="${STIL_KNOPF}background:var(--brand,#00bcd4);border-color:var(--brand,#00bcd4);color:var(--on-brand,#fff);font-weight:600;">
        ${vorhanden ? 'Maßnahme aktualisieren' : 'Als Maßnahme übernehmen'}</button>`;
  return `<div style="border:1px solid var(--border);border-left:3px solid var(--brand,#00bcd4);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
        <b style="font-size:13.5px;">Maßnahme für die Variante ${esc(d.variante || '—')}</b>
        <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center;">Weg
          <select class="inp-field" data-change="naMassnahmeWeg(this.value)" style="font-size:12px;">${optionen}</select></label></div>
      <div style="font-size:12.5px;">${esc(v.titel)}</div>
      <div style="font-size:12px;color:var(--muted);">Jahr <b style="color:var(--text);">${v.jahr}</b> · Kosten <b style="color:var(--text);">${_euro(v.kosten)}</b>${v.kosten ? ' (Schätzung, Mitte der Spanne)' : ' (Angebot des Netzbetreibers abwarten)'} · Stand „Empfohlen", am NAP-Asset</div>
      ${vorhanden ? `<div style="font-size:12px;color:var(--muted);">Bereits angelegt${nr ? ` als <b style="color:var(--text);">M${String(nr).padStart(2, '0')}</b>` : ''}: ${esc(vorhanden.titel)} (${vorhanden.jahr ?? '—'}) — Übernehmen ersetzt sie.</div>` : ''}
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${knopf}<span id="na-massn-status" style="font-size:12px;color:var(--muted);"></span></div>
    </div>`;
}

export function naMassnahmeWeg(id) {
  _massnWeg = ['A', 'B', 'C', 'D'].includes(id) ? id : null;
  naModulRender();
}

export function naMassnahmeUebernehmen() {
  const d = _letzte, nap = _napAsset();
  if (!d || !nap) return;
  const vorhanden = _naMassnahme(nap);
  const wegId = _massnWeg || vorhanden?.netzanschlussWeg || d.antwort.empfehlung.weg || 'B';
  const weg = d.wege.find(w => w.id === wegId);
  if (!weg) return;
  const v = ncMassnahme({ weg, reihe: d.reihe, grenzen: d.grenzen, ziel: d.ziel, p: d.p, heute: d.heute, uw: d.uw });
  const mutate = () => {
    nap.massnahmen = nap.massnahmen || [];
    const m = _naMassnahme(nap);
    const felder = { titel: v.titel, typ: v.typ, jahr: v.jahr, kosten: v.kosten, netzanschlussWeg: v.weg };
    if (m) Object.assign(m, felder);
    else nap.massnahmen.push({ id: createId('m'), ...felder, status: mrStatusAusStand('empfohlen'), newProps: {}, dependsOn: [], phaseId: null });
  };
  const label = vorhanden ? 'Netzanschluss-Maßnahme aktualisieren' : 'Netzanschluss-Maßnahme anlegen';
  let ok = false;
  if (typeof window.runPlanningTransaction === 'function') {
    try { window.runPlanningTransaction(label, mutate); ok = true; } catch (e) { console.warn(label, e); }
  }
  if (!ok) { mutate(); try { window.massnahmenAbgleichen?.(); } catch (e) { console.warn('Maßnahmenliste:', e); } }
  _massnWeg = null;
  naModulRender();
  const nr = window.massnahmeEintrag?.(_naMassnahme(nap))?.nr;
  const st = $('na-massn-status');
  if (st) st.textContent = `✓ ${vorhanden ? 'aktualisiert' : 'angelegt'}${nr ? ` als M${String(nr).padStart(2, '0')}` : ''} — zu finden unter Übergreifend › Maßnahmen und Fahrplan`;
}

/* Checkliste für die Netzanschlussanfrage */
let _haken = { lageplan: false, zustaendigkeit: false };

function _checklisteHtml(d) {
  const liste = ncCheckliste({
    reihe: d.reihe, stand: d.stand, grenzen: d.grenzen, erzeuger: d.erzeuger, netzbetreiber: window.naNetzbetreiberName,
    empfWeg: d.antwort.empfehlung.weg, uwGewaehlt: !!d.uw, haken: _haken,
  });
  const offen = liste.filter(x => x.stufe === 'fehlt').length;
  const zeile = x => {
    const zeichen = x.stufe === 'ok' ? '<span style="color:var(--ok,#66bb6a);font-weight:700;">✓</span>'
      : x.stufe === 'na' ? '<span style="color:var(--muted);">–</span>' : '<span style="color:var(--crit,#ef5350);font-weight:700;">✗</span>';
    const links = x.manuell
      ? `<input type="checkbox" ${_haken[x.id] ? 'checked' : ''} data-change="naHaken('${x.id}',this.checked)" title="von Hand abhaken" style="margin:2px 0 0;accent-color:var(--brand,#00bcd4);"/>`
      : zeichen;
    const aktion = x.aktion && x.stufe !== 'na'
      ? ` <a href="#" data-click="event.preventDefault();naCheckAktion('${x.aktion}')" style="color:var(--accent);">${x.aktion === 'csv' ? 'speichern' : 'öffnen'}</a>` : '';
    return `<li style="display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;align-items:start;${x.stufe === 'na' ? 'opacity:.65;' : ''}">
        ${links}<div><span style="font-size:13px;">${esc(x.text)}</span>
        <span style="display:block;font-size:11.5px;color:var(--muted);">${esc(x.hinweis)}${aktion}</span></div></li>`;
  };
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;min-width:0;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:8px;">
        <b style="font-size:13.5px;">Für die Netzanschlussanfrage</b>
        <span style="font-size:12px;color:${offen ? 'var(--warn,#ffb74d)' : 'var(--ok,#66bb6a)'};">${offen ? `${offen} offen` : 'vollständig'}</span></div>
      <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;">${liste.map(zeile).join('')}</ul>
    </div>`;
}

export function naHaken(id, an) {
  if (!(id in _haken)) return;
  _haken = { ..._haken, [id]: !!an };
  naModulRender();
}

export function naCheckAktion(aktion) {
  if (aktion === 'csv') naLeistungstabelleCsv();
  else if (aktion === 'lastgang') window.sgMjOeffnen?.();
  else if (aktion === 'grenzen') window.sgNaOeffnen?.();
  else if (aktion === 'uw') naModulSchritt('wege');
  else if (aktion === 'lageplan') {
    if (typeof window.uiGeheZu === 'function' && document.body.classList.contains('ui-lkebw')) window.uiGeheZu('auswertung', 'liegenschaftsbilder');
    else { window.setViewMode?.('analyse'); window.setAnalyseSection?.('liegenschaftsbilder'); }
  }
}

export function naBausteinKopieren() {
  const status = $('na-modul-status');
  const text = _letzte ? _bausteinText(_letzte) : '';
  const fertig = ok => { if (status) status.textContent = ok ? '✓ kopiert' : '⚠ Kopieren nicht möglich — Text markieren und Strg+C'; };
  if (!text) return fertig(false);
  try { navigator.clipboard.writeText(text).then(() => fertig(true), () => fertig(false)); }
  catch (e) { void e; fertig(false); }
}

export function naLeistungstabelleCsv() {
  if (!_letzte) return;
  const csv = '﻿' + ncCsv(_letzte.reihe, _letzte.grenzen);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Leistungstabelle_Netzanschluss_${_letzte.heute}-${_letzte.reihe[_letzte.reihe.length - 1].jahr}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  const status = $('na-modul-status');
  if (status) status.textContent = '✓ Leistungstabelle gespeichert';
}

/* ── Projektdatei ───────────────────────────────────────────────────────── */
export function naModulCapture() {
  const haken = Object.values(_haken).some(Boolean);
  if (!_zieljahrHand && !haken) return null;
  return { ...(_zieljahrHand ? { zieljahr: _zieljahrHand } : {}), ...(haken ? { haken: { ..._haken } } : {}) };
}
export function naModulRestore(s) {
  const j = parseInt(s?.zieljahr, 10);
  _zieljahrHand = Number.isFinite(j) ? j : null;
  _haken = { lageplan: !!s?.haken?.lageplan, zustaendigkeit: !!s?.haken?.zustaendigkeit };
  _massnWeg = null;
  naModulRender();
}

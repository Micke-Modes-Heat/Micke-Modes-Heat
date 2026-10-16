// ── 44-netzanschluss-modul.js — Netzanschluss-Modul (Elektro › 3 · Auswerten › Netzanschluss) ──
//
// Eigenes Fenster mit vier Schritten:
//   1. Bedarf    — Bezug je Jahr aus der Bedarfsprognose (wie NAP-Analyse und Gutachten 5.3),
//                  Einspeisung aus den Erzeuger-Assets je Jahr, gegen die NAP-Grenzen; erstes Jahr
//                  der Überschreitung je Richtung.
//   2. Ebene     — typische Anschlussebene nach Leistung (lib/anschlussebenen.js) mit Markern
//                  „heute" und „Zieljahr".
//   3. Optionen  — Wege A–D mit Ampel (lib/netzanschluss-check.js), darunter Umspannwerke,
//                  Karte und Direktanschluss (43-umspannwerke.js, rendert in #na-modul-uw).
//   4. Ergebnis  — Textbaustein mit Quellen und Leistungstabelle (CSV) für die Netzanschlussanfrage.
//
// Stammdaten (Netzbetreiber, Vertrag, NAP-Grenzen) bleiben unter ⚡ Strom-Grundlagen (22); das
// Modul liest sie nur. Gerechnet wird für die aktive Variante.

import { ASSETS } from './13a-assets-core.js';
import { globalYear, aktiverVariantenName } from './01-globals-varianten.js';
import { ncReihe, ncZieljahr, ncUeberschreitung, ncWege, ncBaustein, ncCsv, ncBedarfSvg } from './lib/netzanschluss-check.js';
import { aeSvg, aeEinordnung, aeKva, AE_QUELLE } from './lib/anschlussebenen.js';
import { uwRender, uwZielVorgabe, uwAuswahlBewertet, uwOsmStand, uwParameter, uwZielVonHand } from './43-umspannwerke.js';

const PANEL_ID = 'na-modul-panel';
const SCHRITTE = [
  { id: 'bedarf', label: '1 · Bedarf' },
  { id: 'ebene', label: '2 · Ebene' },
  { id: 'optionen', label: '3 · Optionen' },
  { id: 'ergebnis', label: '4 · Ergebnis' },
];
const FARBE = { bezug: '#4fc3f7', einsp: '#ef9a9a', band: '#66bb6a', ok: '#66bb6a', warn: '#ffb74d', bad: '#ef5350', na: 'var(--muted)' };
const STIL_KNOPF = 'font-size:10px;padding:3px 9px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;';

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
  return { text: v('--text', '#e0e0e0'), muted: v('--muted', '#9e9e9e'), linie: v('--border', '#3a3a3a'), raute: v('--surface', '#1e1e1e') };
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
  return { stand, assets, heute, zjAuto, zieljahr, reihe, z0, ziel, grenzen, uw, p, wege, variante: aktiverVariantenName?.() || '' };
}

/* ── Fenster ────────────────────────────────────────────────────────────── */
function _ensurePanel() {
  let panel = $(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel cyan-border';
  // horizontal zentriert wie die übrigen float-panels (left:50% + translateX(-50%) aus dem Stylesheet)
  panel.style.cssText = 'top:64px;width:760px;max-width:calc(100vw - 40px);max-height:86vh;padding:0 16px 14px;overflow:auto;display:none;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:var(--c-teal);font-size:12px;font-weight:600;">🔌 Netzanschluss</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;" data-click="naModulToggle()">✕</span>
    </div>
    <div id="na-modul-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

const _offen = () => $(PANEL_ID)?.style.display === 'block';

export function naModulToggle() {
  const panel = _ensurePanel();
  panel.style.display = _offen() ? 'none' : 'block';
  if (_offen()) naModulRender();
}

/** Öffnen, optional direkt in einem Schritt (Absprung aus den Strom-Grundlagen). */
export function naModulOeffnen(schritt) {
  _ensurePanel().style.display = 'block';
  if (SCHRITTE.some(s => s.id === schritt)) _schritt = schritt;
  naModulRender();
}

export function naModulSchritt(id) {
  if (!SCHRITTE.some(s => s.id === id)) return;
  _schritt = id;
  naModulRender();
}

export function naModulZieljahr(wert) {
  const j = parseInt(wert, 10);
  _zieljahrHand = Number.isFinite(j) && j > 1990 && j < 2100 ? j : null;
  naModulRender();
}

/** Neu zeichnen — nur, wenn das Fenster offen ist (43 ruft das nach jeder Änderung). */
export function naModulRender() {
  if (!_offen()) return;
  const body = $('na-modul-body');
  if (!body) return;
  let d;
  try { d = _rechnen(); }
  catch (e) {
    body.innerHTML = `<div style="padding:12px;color:${FARBE.bad};font-size:11px;">⚠ Rechnung fehlgeschlagen: ${esc(e.message)}</div>`;
    return;
  }
  _letzte = d;
  const inhalt = { bedarf: _bedarfHtml, ebene: _ebeneHtml, optionen: _optionenHtml, ergebnis: _ergebnisHtml }[_schritt](d);
  body.innerHTML = _kopfHtml(d) + inhalt;
  if (_schritt === 'optionen') uwRender();
}

/* ── Kopf: Grundlage, Zieljahr, Schritte ────────────────────────────────── */
function _kopfHtml(d) {
  const g = d.grenzen;
  const grenzText = g.bezugKw || g.einspKw
    ? `<span style="color:${FARBE.bezug};">${g.bezugKw ? `${de(g.bezugKw)} kVA` : '—'}</span> / <span style="color:${FARBE.einsp};">${g.einspKw ? `${de(g.einspKw)} kW` : '—'}</span>`
    : `<span style="color:${FARBE.warn};">nicht eingetragen</span>`;
  const reiter = SCHRITTE.map(s => `<button data-click="naModulSchritt('${s.id}')" style="font-size:11px;padding:4px 12px;border-radius:4px;cursor:pointer;
      border:1px solid ${s.id === _schritt ? '#00bcd4' : 'var(--border)'};background:${s.id === _schritt ? 'rgba(0,188,212,.18)' : 'transparent'};
      color:${s.id === _schritt ? 'var(--text)' : 'var(--muted)'};font-weight:${s.id === _schritt ? 600 : 400};">${s.label}</button>`).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:4px 16px;font-size:10px;color:var(--muted);margin:6px 0 8px;line-height:1.6;">
      <span>Variante <b style="color:var(--text);">${esc(d.variante || '—')}</b></span>
      <span>Messjahr <b style="color:var(--text);">${d.heute}</b></span>
      <span>Zieljahr <input class="inp-field" type="number" min="${d.heute}" max="${d.heute + 30}" value="${d.zieljahr}" data-change="naModulZieljahr(this.value)"
        style="width:62px;font-size:10px;padding:1px 4px;" title="Leer = Endausbau der Bedarfsprognose (${d.zjAuto})"/>
        ${_zieljahrHand ? `<a href="#" data-click="event.preventDefault();naModulZieljahr('')" style="color:var(--accent);">↺ ${d.zjAuto}</a>` : '<span>(Endausbau)</span>'}</span>
      <span>vereinbart ${grenzText} <a href="#" data-click="event.preventDefault();sgNaOeffnen()" style="color:var(--accent);">bearbeiten</a></span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${reiter}
      <button data-click="naModulRender()" title="Neu rechnen (z. B. nach Änderung der NAP-Grenzen oder Assets)" style="${STIL_KNOPF}margin-left:auto;">⟳</button></div>`;
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
  const hinweise = [];
  if (!(stand?.basisKw > 0)) hinweise.push(`⚠ Kein gemessener Lastgang: Der Bezug enthält nur die geplanten Maßnahmen. Messjahr unter ⚡ Strom-Grundlagen laden.`);
  if (!grenzen.bezugKw && !grenzen.einspKw) hinweise.push(`⚠ NAP-Grenzen fehlen — ohne vereinbarte Leistung lässt sich keine Überschreitung bestimmen. <a href="#" data-click="event.preventDefault();sgNaOeffnen()" style="color:var(--accent);">eintragen</a>`);
  const abgewaehlt = (stand?.massnahmen || []).filter(m => !m.checked).length;
  const leer = !reihe.some(r => r.bezugKw > 0 || r.einspKw > 0);
  const diagramm = leer
    ? `<div style="padding:22px 10px;text-align:center;font-size:11px;color:var(--muted);border:1px dashed var(--border);border-radius:6px;">
        Noch keine Leistungsdaten — Lastgang unter ⚡ Strom-Grundlagen laden bzw. Verbraucher und Erzeuger im Elektro-Tab anlegen.</div>`
    : ncBedarfSvg({ reihe, grenzen, zieljahr: ziel.jahr, farben: { ..._themaFarben(), bezug: FARBE.bezug, einsp: FARBE.einsp } });
  return `${diagramm}
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;">
      <thead><tr style="color:var(--muted);font-size:10px;text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:4px 6px;"></th><th style="padding:4px 6px;text-align:right;">${d.heute}</th><th style="padding:4px 6px;text-align:right;">Zieljahr ${ziel.jahr}</th>
        <th style="padding:4px 6px;text-align:right;">vereinbart</th><th style="padding:4px 6px;">Überschreitung</th></tr></thead>
      <tbody>${zeile('Bezug', FARBE.bezug, 'bezugKw', grenzen.bezugKw, 'kVA', uB)}${zeile('Einspeisung', FARBE.einsp, 'einspKw', grenzen.einspKw, 'kW', uE)}</tbody>
    </table>
    ${hinweise.map(h => `<div style="font-size:10px;color:${FARBE.warn};margin-top:6px;">${h}</div>`).join('')}
    <div style="font-size:9.5px;color:var(--muted);margin-top:8px;line-height:1.5;">
      Bezug: Bedarfsprognose wie Gutachten 5.3 — gemessene Höchstlast ${stand?.basisKw > 0 ? `${kw(stand.basisKw)} (${esc(stand.quelle || stand.dataYear)})` : '—'} plus Neubau/Rückbau,
      Gleichzeitigkeitsfaktor ${de(stand?.gzf ?? 1, 2)}${abgewaehlt ? `, ${abgewaehlt} Maßnahme(n) abgewählt` : ''}.
      <a href="#" data-click="event.preventDefault();ggBedarfNapOeffnen()" style="color:var(--accent);">Maßnahmen und GZF in der NAP-Analyse</a>.
      Einspeisung: Nennleistung aller Erzeuger (PV, KWK, Wind, Batterie im Einspeisebetrieb), die im Jahr stehen, ohne Gleichzeitigkeitsfaktor.
      Vergleich wie im Gutachten: kW gegen vereinbarte kVA.</div>`;
}

/* ── 2 · Ebene ──────────────────────────────────────────────────────────── */
function _ebeneHtml(d) {
  const { z0, ziel } = d;
  const marker = [
    { kva: z0.bezugKw, farbe: FARBE.bezug, label: `B ${d.heute}`, gestrichelt: true },
    { kva: ziel.bezugKw, farbe: FARBE.bezug, label: `B ${ziel.jahr}` },
    { kva: z0.einspKw, farbe: FARBE.einsp, label: `E ${d.heute}`, gestrichelt: true },
    { kva: ziel.einspKw, farbe: FARBE.einsp, label: `E ${ziel.jahr}` },
  ].filter(m => m.kva > 0 && !(m.gestrichelt && Math.abs(m.kva - (m.farbe === FARBE.bezug ? ziel.bezugKw : ziel.einspKw)) < 1));
  const block = (titel, farbe, kva) => {
    if (!(kva > 0)) return `<div style="flex:1;min-width:220px;"><b style="color:${farbe};">${titel}</b><div style="color:var(--muted);font-size:10px;">kein Wert</div></div>`;
    const e = aeEinordnung(kva);
    return `<div style="flex:1;min-width:220px;border-left:3px solid ${farbe};padding-left:8px;">
        <b style="color:${farbe};">${titel}: ${aeKva(kva)}</b>
        <div style="font-size:10px;margin-top:2px;"><span style="color:var(--muted);">häufig:</span> ${e.haeufig.length ? e.haeufig.map(b => esc(b.name)).join(' · ') : '—'}</div>
        <div style="font-size:10px;"><span style="color:var(--muted);">kommt vor:</span> ${e.moeglich.length ? e.moeglich.map(b => esc(b.name)).join(' · ') : '—'}</div>
        <div style="font-size:10px;"><span style="color:var(--muted);">Beispiel-TAB:</span> ${esc(e.tab?.lang || '—')}</div></div>`;
  };
  return `${aeSvg({ farben: { ..._themaFarben(), band: FARBE.band }, marker })}
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:11px;">
      ${block(`Bezug ${ziel.jahr}`, FARBE.bezug, ziel.bezugKw)}${block(`Einspeisung ${ziel.jahr}`, FARBE.einsp, ziel.einspKw)}</div>
    <div style="font-size:9.5px;color:var(--muted);margin-top:8px;line-height:1.5;">
      Bänder: kräftig = häufig, blass = kommt vor; gestrichelte Marker = Messjahr, durchgezogen = Zieljahr. Die Bänder stammen aus realisierten
      Erzeugungsanlagen; für den Bezug gelten sie als Orientierung. Verbindlich ist die TAB des zuständigen Netzbetreibers.
      Quelle: ${esc(AE_QUELLE)}.</div>`;
}

/* ── 3 · Optionen ───────────────────────────────────────────────────────── */
function _optionenHtml(d) {
  const pill = a => `<span style="display:inline-block;font-size:10px;line-height:1.3;padding:1px 8px;border-radius:10px;border:1px solid ${FARBE[a.stufe]};color:${FARBE[a.stufe]};">${esc(a.text)}</span>`;
  const zeilen = d.wege.map(w => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:5px 6px;vertical-align:top;"><b>${w.id}</b></td>
      <td style="padding:5px 6px;vertical-align:top;">${esc(w.titel)}</td>
      <td style="padding:5px 6px;vertical-align:top;text-align:right;white-space:nowrap;">${esc(w.traegt)}</td>
      <td style="padding:5px 6px;vertical-align:top;">${esc(w.kosten)}</td>
      <td style="padding:5px 6px;vertical-align:top;white-space:nowrap;">${esc(w.ebene)}</td>
      <td style="padding:5px 6px;vertical-align:top;">${pill(w.ampel)}</td></tr>`).join('');
  return `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Bedarf ${d.ziel.jahr}:
      <b style="color:${FARBE.bezug};">Bezug ${kw(d.ziel.bezugKw)}</b> · <b style="color:${FARBE.einsp};">Einspeisung ${kw(d.ziel.einspKw)}</b>
      ${uwZielVonHand() ? `<span style="color:${FARBE.warn};">— Direktanschluss rechnet mit einer Zielleistung von Hand</span>` : ''}</div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:10.5px;min-width:600px;">
      <thead><tr style="color:var(--muted);font-size:9.5px;text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:4px 6px;">Weg</th><th style="padding:4px 6px;"></th><th style="padding:4px 6px;text-align:right;">trägt B / E</th>
        <th style="padding:4px 6px;">Kosten</th><th style="padding:4px 6px;">Ebene</th><th style="padding:4px 6px;">Bewertung</th></tr></thead>
      <tbody>${zeilen}</tbody></table></div>
    <div style="font-size:9.5px;color:var(--muted);margin:4px 0 10px;">Kosten des Direktanschlusses als Spanne −20 % / +40 % (eigene Richtwerte, unter „Annahmen" änderbar).
      Ob Netz und Umspannwerk die Leistung aufnehmen, klärt nur die Netzanschlussanfrage.</div>
    <div id="na-modul-uw" style="border-top:1px solid var(--border);padding-top:6px;"></div>`;
}

/* ── 4 · Ergebnis ───────────────────────────────────────────────────────── */
function _bausteinText(d) {
  const uw = d.uw ? { ...d.uw } : null;
  return ncBaustein({ stand: d.stand, ziel: d.ziel, grenzen: d.grenzen, reihe: d.reihe, uw, osmStand: uwOsmStand() });
}

function _ergebnisHtml(d) {
  const text = _bausteinText(d);
  return `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Textbaustein (z. B. für das Gutachten im Anschluss an 5.1.1) — Grundlage: Variante ${esc(d.variante || '—')}, Zieljahr ${d.ziel.jahr}${d.uw ? `, Umspannwerk ${esc(d.uw.name || 'ohne Namen')}` : ', kein Umspannwerk gewählt'}.</div>
    <div id="na-modul-baustein" style="font-size:11.5px;line-height:1.6;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:rgba(var(--ink),.02);user-select:text;">${esc(text)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">
      <button data-click="naBausteinKopieren()" style="${STIL_KNOPF}">📋 Text kopieren</button>
      <button data-click="naLeistungstabelleCsv()" style="${STIL_KNOPF}" title="Bezug und Einspeisung je Jahr mit den vereinbarten Grenzen — Anlage zur Netzanschlussanfrage">⤓ Leistungstabelle (CSV)</button>
      <span id="na-modul-status" style="font-size:10px;color:var(--muted);"></span>
    </div>
    <div style="font-size:9.5px;color:var(--muted);margin-top:10px;line-height:1.5;">
      Für die Netzanschlussanfrage zusätzlich: Lageplan mit Übergabestation (🗺️ Liegenschaftsbilder), gemessener Lastgang (⚡ Strom-Grundlagen),
      geplante Erzeugungsanlagen mit Inbetriebnahmejahr. Die Übernahme eines Weges als Maßnahme in die Variante ist noch nicht umgesetzt.</div>`;
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
  return _zieljahrHand ? { zieljahr: _zieljahrHand } : null;
}
export function naModulRestore(s) {
  const j = parseInt(s?.zieljahr, 10);
  _zieljahrHand = Number.isFinite(j) ? j : null;
  naModulRender();
}

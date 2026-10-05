// ── 34-witterung.js — Messjahr und Witterungsbereinigung des hochgeladenen Wärmelastgangs ──
// Gradtagzahlen G20/15 aus dem Open-Meteo-Archiv (ERA5-Reanalyse, Tagesmitteltemperatur am Standort) für das Messjahr
// und die Jahre davor. Der Faktor wirkt in glBerechnen (06b) auf den gemessenen Lastgang; Rechnung: lib/witterung.js.
import { WB, gradtagzahlenJeJahr, wbFaktor } from './lib/witterung.js';

let _wb = { messjahr: '', aktiv: false, jahre: WB.standardJahre, ergebnis: null };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function getWitterung() { return structuredClone(_wb); }
export function setWitterung(d) {
  const x = d && typeof d === 'object' ? d : {};
  const mj = parseInt(x.messjahr, 10);
  _wb = { messjahr: mj > 1990 ? mj : '', aktiv: !!x.aktiv, jahre: Math.min(30, Math.max(5, parseInt(x.jahre, 10) || WB.standardJahre)),
    ergebnis: x.ergebnis && Number.isFinite(x.ergebnis.faktor) ? x.ergebnis : null };
  wbRender();
}

/** Faktor, falls die Bereinigung aktiv ist und zum eingestellten Messjahr passt; sonst null. */
export function wbAktiverFaktor() {
  const e = _wb.ergebnis;
  return _wb.aktiv && e && e.messjahr === _wb.messjahr && Number.isFinite(e.faktor) ? e.faktor : null;
}

function standort() {
  const m = window.map;
  try { const c = m?.getCenter?.(); if (c) return { lat: c.lat, lng: c.lng }; } catch (e) { void e; }
  return null;
}

export async function wbLaden() {
  const mj = Number(_wb.messjahr);
  const s = standort();
  const info = document.getElementById('wb-info');
  if (!(mj > 1990) || mj >= new Date().getFullYear()) { if (info) info.textContent = 'Bitte ein abgeschlossenes Messjahr eintragen.'; return; }
  if (!s) { if (info) info.textContent = 'Kein Kartenstandort verfügbar.'; return; }
  if (info) info.textContent = 'Lade Tagestemperaturen …';
  const von = mj - _wb.jahre;
  const url = 'https://archive-api.open-meteo.com/v1/archive'
    + `?latitude=${s.lat.toFixed(4)}&longitude=${s.lng.toFixed(4)}`
    + `&start_date=${von}-01-01&end_date=${mj}-12-31&daily=temperature_2m_mean&timezone=Europe%2FBerlin`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const d = await res.json();
    const zeit = d.daily?.time || [], temp = d.daily?.temperature_2m_mean || [];
    const g = gradtagzahlenJeJahr(zeit, temp);
    // Tagesmittel des Messjahres (ohne 29.02.) für die Einordnung der Spitzenlast (lib/gutachten-lastgang.js)
    const tageT = zeit.map((t, i) => [t, temp[i]]).filter(([t]) => t.startsWith(`${mj}-`) && !t.endsWith('-02-29')).map(([, x]) => Math.round(x * 10) / 10);
    const f = wbFaktor(g, mj, _wb.jahre);
    if (!f) throw new Error('zu wenige vollständige Jahre');
    _wb.ergebnis = { ...f, messjahr: mj, tageT: tageT.length === 365 ? tageT : null, lat: s.lat, lng: s.lng, quelle: 'Open-Meteo-Archiv (ERA5)', geladen: new Date().toISOString() };
    _wb.aktiv = true;
    wbRender();
    window.glBerechnenAuto?.();
  } catch (e) {
    if (info) info.textContent = `⚠ Gradtagzahlen nicht verfügbar: ${e.message}`;
  }
}

export function wbFeld(feld, wert) {
  if (feld === 'messjahr') { const j = parseInt(wert, 10); _wb.messjahr = j > 1990 ? j : ''; }
  else if (feld === 'jahre') _wb.jahre = Math.min(30, Math.max(5, parseInt(wert, 10) || WB.standardJahre));
  else if (feld === 'aktiv') _wb.aktiv = !!wert;
  else return;
  wbRender();
  window.glBerechnenAuto?.();
}

export function wbRender() {
  const box = document.getElementById('wb-box');
  if (!box) return;
  const e = _wb.ergebnis, passt = e && e.messjahr === _wb.messjahr;
  box.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:10px;color:var(--muted);margin-top:6px;">
      <label title="Jahr, aus dem der hochgeladene Lastgang stammt">Messjahr
        <input class="inp-field" type="number" style="width:58px;padding:2px 4px;font-size:10px;" value="${esc(_wb.messjahr)}" data-change="wbFeld('messjahr',this.value)"></label>
      <label title="Vergleichszeitraum: Mittel der Jahre vor dem Messjahr">Mittel über
        <input class="inp-field" type="number" style="width:40px;padding:2px 4px;font-size:10px;" min="5" max="30" value="${_wb.jahre}" data-change="wbFeld('jahre',this.value)"> J.</label>
      <button class="btn-secondary" style="padding:2px 8px;font-size:10px;" data-click="wbLaden()" title="Tagesmitteltemperaturen am Kartenstandort laden und Gradtagzahlen G20/15 berechnen">Gradtagzahlen laden</button>
    </div>
    <label style="display:flex;gap:5px;align-items:center;font-size:10px;margin-top:4px;color:var(--text);">
      <input type="checkbox" ${_wb.aktiv ? 'checked' : ''} ${passt ? '' : 'disabled'} data-change="wbFeld('aktiv',this.checked)"> Lastgang witterungsbereinigen</label>
    <div id="wb-info" style="font-size:9px;color:var(--muted);margin-top:2px;line-height:1.4;">${passt
      ? `G20/15 ${e.messjahr}: ${nf(e.gMess)} Kd · Mittel ${e.vonJahr}–${e.bisJahr}: ${nf(e.gMittel)} Kd → Faktor ${nf(e.faktor, 3)} (${e.faktor > 1 ? 'Messjahr wärmer als üblich' : 'Messjahr kälter als üblich'})`
      : 'Ohne Bereinigung wird der Lastgang unverändert verwendet.'}</div>`;
}

setTimeout(() => wbRender(), 0);

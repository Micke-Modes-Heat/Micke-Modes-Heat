// ── 09a-pv-profile.js — PV-Profil, Datei-Upload, Preise, Invest ──
// ── Synthetisches PV-Profil (normiert, Summe = 1.0 über 8760h) ───────────
// Sonnenaufgang / Sonnenuntergang (ganze Stunde, lokale Zeit) je Monat
import { freiflaechen, gebaeude } from './01-globals-varianten.js';
import { calcFFKwp, updateBhkwDisplay, updateGasKesselDisplay, updateStromkesselDisplay } from './03a-erzeuger.js';
import { hidePanels } from './03b-netz.js';
import { calcGebKwp } from './03c-gebaeude-io.js';
import { GL_MONTH_HOURS } from './06a-gbi-lastgang.js';
import { calcWirtschaftPanel } from './07b-analysis-economics.js';
import { CalcEngine } from './08-calc-engine.js';
import { calcStromPanel } from './09b-pv-calc.js';

export const _PV_SUN = [[8,16],[7,17],[6,18],[5,20],[5,21],[4,21],[4,21],[5,20],[6,19],[7,18],[8,16],[8,16]];

// Monatliche Ertragsanteile je Ausrichtung (Deutschland ~51°N)
export const _PV_MONTH = {
  // Süd 30° Neigung: Winterernte höher durch steilen Winkel
  sued:    [0.026,0.039,0.076,0.109,0.134,0.144,0.139,0.128,0.097,0.060,0.028,0.020],
  // Ost-West 10° flach: Sommer-Mittag schwächer, aber breiterer Tagesertrag
  ostwest: [0.024,0.036,0.072,0.107,0.138,0.150,0.145,0.132,0.094,0.056,0.026,0.020]
};

// Empfohlene spezifische Erträge (kWh/kWp·a) je Ausrichtung
export const _PV_SPEZ_DEFAULT = { sued: 1050, ostwest: 950 };

export function pvAusrichtungChanged() {
  const ausrichtung = document.getElementById('pv-ausrichtung')?.value || 'sued';
  const spezField = document.getElementById('pv-spez');
  if (spezField) spezField.value = _PV_SPEZ_DEFAULT[ausrichtung] || 1000;
  // Profil-Cache invalidieren
  window._pvProfileCache = null;
  calcStromPanel();
}

export function makePvProfile8760(ausrichtung) {
  ausrichtung = ausrichtung || document.getElementById('pv-ausrichtung')?.value || 'sued';
  const monthFrac = _PV_MONTH[ausrichtung] || _PV_MONTH.sued;
  const result = new Float32Array(8760);
  let ptr = 0;
  for (let m = 0; m < 12; m++) {
    const [rise, set] = _PV_SUN[m];
    const mFrac = monthFrac[m];
    const daysInMonth = GL_MONTH_HOURS[m] / 24;

    // Tagesprofil: Süd = spitze Sinusglocke, OW/flach = breiteres Plateau
    const shape = new Array(24).fill(0);
    let shapeSum = 0;
    const span = set - rise;
    for (let h = rise; h < set; h++) {
      const t = (h - rise) / span;  // 0..1
      if (ausrichtung === 'sued') {
        // Klassische Sinusglocke (Mittagsspitze)
        shape[h] = Math.sin(Math.PI * t);
      } else {
        // Ost-West / flach: zwei Peaks morgens+abends, flacheres Mittagstal
        // cos²-abgeflachte Glocke → breiterer Ertrag über den Tag
        const s = Math.sin(Math.PI * t);
        shape[h] = s * (0.7 + 0.3 * Math.cos(Math.PI * (t - 0.5)));
      }
      shapeSum += shape[h];
    }
    if (shapeSum > 0) shape.forEach((v, i, a) => { a[i] = v / shapeSum; });
    const perHour = mFrac / daysInMonth;
    for (let d = 0; d < daysInMonth; d++) {
      for (let h = 0; h < 24; h++) {
        if (ptr < 8760) result[ptr++] = perHour * shape[h];
      }
    }
  }
  return result;
}

// ── PV-Upload ─────────────────────────────────────────────────────────────
export function pvFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const tokens = text.split(/[\n\r;,]+/).map(s => s.trim()).filter(s => s !== '' && !isNaN(s));
    if (tokens.length < 100) { alert('Zu wenig Werte — bitte 8760-Werte-CSV hochladen.'); return; }
    const arr = new Float32Array(8760);
    let sum = 0, pMax = 0;
    for (let i = 0; i < 8760; i++) {
      const v = parseFloat(tokens[i]) || 0;
      arr[i] = v; sum += v; if (v > pMax) pMax = v;
    }
    window.elPvH = arr;
    document.getElementById('pv-kwp').value = '';
    document.getElementById('pv-upload-info').textContent =
      `${file.name} · ${(sum/1000).toFixed(0)} MWh/a · max ${Math.round(pMax)} kW`;
    document.getElementById('pv-clear-btn').style.display = '';
    document.getElementById('pv-file-input').value = '';
    calcStromPanel();
  };
  reader.readAsText(file);
}

export function pvClear() {
  window.elPvH = null;
  document.getElementById('pv-upload-info').textContent = '';
  document.getElementById('pv-clear-btn').style.display = 'none';
  document.getElementById('pv-file-input').value = '';
  calcStromPanel();
}

// ── PV-Panel ─────────────────────────────────────────────────────────────
export function togglePvPanel() {
  const p = document.getElementById('pv-panel');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
}

// ── Batteriespeicher ──────────────────────────────────────────────────────
export function toggleBatteriePanel() {
  const p = document.getElementById('batterie-panel');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
}

export function getBatParams() {
  // Gibt { kapKwh, leistKw, eta } zurück, oder null wenn deaktiviert (Kapazität = 0)
  const kapKwh  = parseFloat(document.getElementById('bat-kapazitaet')?.value) || 0;
  const leistKw = parseFloat(document.getElementById('bat-leistung')?.value)   || 0;
  if (kapKwh <= 0 || leistKw <= 0) return null;
  return { kapKwh, leistKw, eta: 0.90 };
}

// ── CSV-Upload ────────────────────────────────────────────────────────────
// Format: Spalte 1 = Zeitstempel (beliebig), Spalte 2 = Leistung in kW.
// Alternativ: nur eine Spalte (reiner Werte-Dump).
// Unterstützte Trennzeichen: Semikolon, Tab, Komma.
// Dezimaltrennzeichen: Punkt oder Komma (wird automatisch erkannt).
// Unterstützt sowohl 15-min (35.040 Werte) als auch Stunden-Lastgänge (8.760 Werte).
export function stromFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    // BOM entfernen (UTF-8 BOM bei manchen Excel-Exporten)
    const text = e.target.result.replace(/^﻿/, '');

    // ── Zeilen aufteilen ──
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 100) {
      alert('Zu wenig Zeilen im CSV (< 100). Bitte Format prüfen.');
      return;
    }

    // ── Spaltentrenner erkennen (aus den ersten 5 Zeilen) ──
    // Priorität: Semikolon → Tab → Komma
    const probe = lines.slice(0, 5).join('\n');
    const sep = probe.includes(';') ? ';' : probe.includes('\t') ? '\t' : ',';

    // ── Spaltenanzahl und Wert-Spalte bestimmen ──
    // Hat die erste Zeile ≥ 2 Spalten? → Zeitstempel+Wert-Format
    const firstCols  = lines[0].split(sep);
    const hasTwo     = firstCols.length >= 2;
    // Wert-Spaltenindex: 1 wenn Zeitstempel vorhanden, sonst 0
    // Prüfen: wenn Spalte 0 kein reiner Zahlenwert ist, nehmen wir Spalte 1
    const col0raw    = firstCols[0].trim().replace(',', '.');
    const col1raw    = hasTwo ? firstCols[1].trim().replace(',', '.') : '';
    const col0isNum  = !isNaN(parseFloat(col0raw)) && /^-?[\d.]+$/.test(col0raw);
    const col1isNum  = hasTwo && !isNaN(parseFloat(col1raw));
    // Wert-Spalte: Spalte 1 wenn vorhanden und Spalte 0 kein reiner Float (= Zeitstempel)
    const valCol     = (hasTwo && !col0isNum) ? 1 : (hasTwo && col1isNum) ? 1 : 0;

    // ── Header überspringen ──
    // Erste Zeile ist Header wenn die Wert-Spalte dieser Zeile nicht numerisch ist
    const firstVal   = (lines[0].split(sep)[valCol] || '').trim().replace(',', '.');
    const startIdx   = isNaN(parseFloat(firstVal)) ? 1 : 0;

    // ── Werte einlesen ──
    const values = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(sep);
      if (cols.length <= valCol) continue;
      // Dezimalkomma → Dezimalpunkt
      const raw = cols[valCol].trim().replace(',', '.');
      const v   = parseFloat(raw);
      if (!isNaN(v)) values.push(v);
    }

    const n = values.length;
    if (n < 100) {
      alert(`Zu wenig verwertbare Werte (${n}) gefunden.\n\nBitte prüfen:\n• Trennzeichen (Semikolon, Tab oder Komma)\n• Dezimalzeichen (Punkt oder Komma)\n• Leistungswert in Spalte 2`);
      return;
    }

    // ── Auflösung erkennen (Toleranz für Schaltjahre ±200 Werte) ──
    const is15min  = n >= 34800 && n <= 36000;   // ~35.040 Viertelstundenwerte
    const isHourly = n >= 8560  && n <= 9000;    // ~8.760 Stundenwerte

    if (!is15min && !isHourly) {
      alert(
        `Unbekannte Wertanzahl: ${n.toLocaleString('de-DE')} Zeilen mit Messwert.\n\n` +
        `Erwartet:\n• 35.040 Werte — 15-min-Lastgang (Viertelstundenwerte)\n` +
        `• 8.760 Werte  — Stunden-Lastgang\n\n` +
        `Erkannter Trennzeichen: "${sep === '\t' ? 'Tab' : sep}" · Wert-Spalte: ${valCol + 1}`
      );
      return;
    }

    // ── Array befüllen ──
    const dt  = is15min ? 0.25 : 1.0;
    const N   = Math.min(n, is15min ? 35136 : 8784); // max inkl. Schaltjahr
    const arr = new Float32Array(N);
    let sum = 0, pMax = 0;
    for (let i = 0; i < N; i++) {
      const v = values[i];
      arr[i] = v; sum += v; if (v > pMax) pMax = v;
    }

    // ── Ersten Zeitstempel aus Spalte 1 extrahieren (für NAP-Analyse) ──
    let firstDate = null;
    if (valCol > 0 && startIdx < lines.length) {
      const tsRaw = (lines[startIdx].split(sep)[0] || '').trim().replace(/['"]/g, '');
      // Deutsches Format: DD.MM.YYYY HH:MM oder DD.MM.YYYY
      let m = tsRaw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (m) firstDate = new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
      // ISO-Format: YYYY-MM-DD HH:MM
      if (!firstDate) {
        m = tsRaw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) firstDate = new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
      }
    }
    // Fallback: 1. Januar des aktuellen Jahres
    window.elQuartierStartDate = (firstDate && !isNaN(firstDate.getTime()))
      ? firstDate : new Date(new Date().getFullYear(), 0, 1);
    window.elQuartierFilename  = file.name;

    // ── Speichern: 15-min nativ + stündliche Ableitung für Rückwärtskompatibilität ──
    if (is15min) {
      window.elQuartierH15        = arr;
      window.elQuartierResolution = 15;
      const arrH = new Float32Array(8760);
      const nH   = Math.min(Math.floor(N / 4), 8760);
      for (let h = 0; h < nH; h++) {
        arrH[h] = ((arr[h*4] || 0) + (arr[h*4+1] || 0) + (arr[h*4+2] || 0) + (arr[h*4+3] || 0)) / 4;
      }
      window.elQuartierH = arrH;
    } else {
      window.elQuartierH15        = null;
      window.elQuartierResolution = 60;
      const arrH = new Float32Array(8760);
      for (let i = 0; i < Math.min(N, 8760); i++) arrH[i] = arr[i];
      window.elQuartierH = arrH;
    }

    // ── UI-Update ──
    document.getElementById('strom-quartier-mwh').value = '';
    const mwh    = (sum * dt / 1000).toFixed(0);
    const resLbl = is15min
      ? `15-min · ${N.toLocaleString('de-DE')} Werte`
      : `stündlich · ${N.toLocaleString('de-DE')} Werte`;
    document.getElementById('strom-upload-info').textContent =
      `${file.name} · ${Number(mwh).toLocaleString('de-DE')} MWh/a · max ${Math.round(pMax).toLocaleString('de-DE')} kW · ${resLbl}`;
    document.getElementById('strom-clear-btn').style.display = '';
    document.getElementById('strom-file-input').value = '';
    calcStromPanel();

    // ── NAP-Analyse benachrichtigen (falls offen oder bereits geladen) ──
    if (typeof window.napOnStromGrundlagenChanged === 'function') {
      window.napOnStromGrundlagenChanged();
    }
  };
  reader.readAsText(file);
}

export function stromClear() {
  window.elQuartierH          = null;
  window.elQuartierH15        = null;
  window.elQuartierResolution = null;
  window.elQuartierStartDate  = null;
  window.elQuartierFilename   = null;
  document.getElementById('strom-upload-info').textContent = '';
  document.getElementById('strom-clear-btn').style.display = 'none';
  document.getElementById('strom-file-input').value = '';
  calcStromPanel();
  // NAP-Analyse: Strom-Grundlagen-Daten entfernen
  if (typeof window.napOnStromGrundlagenChanged === 'function') {
    window.napOnStromGrundlagenChanged();
  }
}

// ── Spot-Preis-Upload ─────────────────────────────────────────────────────
// Unterstützt SMARD-Export (Datum von;Datum bis;EUR/MWh) und ENTSO-E (datetime,price).
// Erkennt automatisch EUR/MWh vs. ct/kWh und 15-min vs. Stunden-Auflösung.
export function spotPreisFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result.replace(/^﻿/, '');
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 50) { alert('Zu wenig Zeilen in der Spot-Preis-CSV.'); return; }

    // Trennzeichen erkennen
    const probe = lines.slice(0, 5).join('\n');
    const sep = probe.includes(';') ? ';' : probe.includes('\t') ? '\t' : ',';

    // Preis-Spalte aus Header suchen (letzte Spalte mit Preis-Stichwort)
    const hdr = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g,''));
    let priceCol = -1;
    for (let i = hdr.length - 1; i >= 0; i--) {
      const h = hdr[i];
      if (h.includes('eur') || h.includes('preis') || h.includes('price') ||
          h.includes('ct') || h === 'p' || h.includes('mwh')) {
        priceCol = i; break;
      }
    }
    // Fallback: letzte numerische Spalte der ersten Datenzeile
    if (priceCol < 0) {
      const row1 = (lines[1] || '').split(sep);
      for (let i = row1.length - 1; i >= 0; i--) {
        if (!isNaN(parseFloat(row1[i].trim().replace(',','.')))) { priceCol = i; break; }
      }
    }
    if (priceCol < 0) { alert('Preis-Spalte nicht erkannt. Bitte CSV-Format prüfen.'); return; }

    const startIdx = isNaN(parseFloat((lines[0].split(sep)[priceCol] || '').trim().replace(',','.'))) ? 1 : 0;

    // Werte einlesen
    const values = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(sep);
      if (priceCol >= cols.length) continue;
      const v = parseFloat(cols[priceCol].trim().replace(/['"]/g,'').replace(',','.'));
      if (!isNaN(v)) values.push(v);
    }

    const n = values.length;
    const is15min  = n >= 34800 && n <= 36000;
    const isHourly = n >= 8560  && n <= 9000;
    if (!is15min && !isHourly) {
      alert(`Unbekannte Wertanzahl: ${n.toLocaleString('de-DE')} Werte.\nErwartet: 35.040 (15-min) oder 8.760 (Stunden).`);
      return;
    }

    // Einheit erkennen: EUR/MWh (Median > 5) → in ct/kWh umrechnen
    const sorted  = [...values].sort((a, b) => a - b);
    const median  = sorted[Math.floor(sorted.length / 2)];
    const factor  = Math.abs(median) > 5 ? 0.1 : 1;  // EUR/MWh → ct/kWh
    const einheit = factor < 1 ? 'EUR/MWh → ct/kWh' : 'ct/kWh';

    const N   = Math.min(n, is15min ? 35136 : 8784);
    const arr = new Float32Array(N);
    let sum = 0, pMin = Infinity, pMax = -Infinity;
    for (let i = 0; i < N; i++) {
      const v = values[i] * factor;
      arr[i] = v; sum += v;
      if (v > pMax) pMax = v;
      if (v < pMin) pMin = v;
    }
    const avg = sum / N;

    window.elSpotPreiseH        = arr;
    window.elSpotPreiseFilename = file.name;

    const resLbl = is15min ? `15-min · ${N.toLocaleString('de-DE')} Werte` : `stündlich · ${N.toLocaleString('de-DE')} Werte`;
    document.getElementById('spot-upload-info').textContent =
      `${file.name} · Ø ${avg.toFixed(1)} ct/kWh · ${pMin.toFixed(0)}–${pMax.toFixed(0)} ct · ${einheit} · ${resLbl}`;
    document.getElementById('spot-clear-btn').style.display = '';
    document.getElementById('spot-file-input').value = '';

    // PV-Analyse Spot-Status aktualisieren
    if (typeof window._pvUpdateSpotStatus === 'function') window._pvUpdateSpotStatus();
  };
  reader.readAsText(file);
}

export function spotPreisClear() {
  window.elSpotPreiseH        = null;
  window.elSpotPreiseFilename = null;
  document.getElementById('spot-upload-info').textContent = '';
  document.getElementById('spot-clear-btn').style.display = 'none';
  document.getElementById('spot-file-input').value = '';
  if (typeof window._pvUpdateSpotStatus === 'function') window._pvUpdateSpotStatus();
}

export function _onGaspreisChange(srcId) {
  const val = document.getElementById(srcId)?.value;
  // wirt-p-gas is the single source of truth for gas price
  if (srcId !== 'wirt-p-gas') {
    const el = document.getElementById('wirt-p-gas');
    if (el && el.value !== val) el.value = val;
  }
  calcWirtschaftPanel();
  updateGasKesselDisplay();
  updateBhkwDisplay();
}

export function _onStrompreisChange(srcId) {
  const val = document.getElementById(srcId)?.value;
  for (const id of ['wirt-p-strom', 'strom-preis-bezug']) {
    if (id === srcId) continue;
    const el = document.getElementById(id);
    if (el && el.value !== val) el.value = val;
  }
  // Eigenverbrauchspreise synchronisieren (= vermiedene Bezugskosten)
  const bezug = parseFloat(val) || 35;
  const pvEigen = document.getElementById('pv-preis-eigen');
  if (pvEigen) pvEigen.value = bezug;
  const bhkwEigen = document.getElementById('bhkw-preis-eigen');
  if (bhkwEigen) bhkwEigen.value = bezug;
  calcStromPanel();  // MUSS vor calcWirtschaftPanel: aktualisiert _bhkwStromErloes mit neuem Preis
  calcWirtschaftPanel();
  updateBhkwDisplay();
  updateStromkesselDisplay();
}

// ── PV-Vergütungsmodell Dropdown ─────────────────────────────────────────
export function onPvVergModellChange() {
  const modell = document.getElementById('pv-verg-modell')?.value || 'teil';
  const einspEl = document.getElementById('strom-preis-einsp');
  const hintEl = document.getElementById('pv-verg-hint');
  const pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 100;
  let einsp = 8.1, hint = '';
  switch (modell) {
    case 'teil':
      // EEG §48 Teileinspeisung: gestaffelt nach Anlagengröße
      if (pvKwp <= 10) einsp = 8.1;
      else if (pvKwp <= 40) einsp = 7.0;
      else if (pvKwp <= 100) einsp = 5.7;
      else if (pvKwp <= 400) einsp = 5.7;
      else einsp = 5.7;
      hint = 'EEG §48 Teileinspeisung: bis 10 kWp 8,1 ct, bis 40 kWp 7,0 ct, ab 40 kWp 5,7 ct/kWh';
      break;
    case 'voll':
      // EEG §48 Volleinspeisung: höhere Vergütung
      if (pvKwp <= 10) einsp = 12.9;
      else if (pvKwp <= 40) einsp = 10.8;
      else if (pvKwp <= 100) einsp = 10.8;
      else if (pvKwp <= 400) einsp = 10.8;
      else einsp = 10.8;
      hint = 'EEG §48 Volleinspeisung: bis 10 kWp 12,9 ct, ab 10 kWp 10,8 ct/kWh';
      break;
    case 'ausschreibung':
      einsp = 5.5;
      hint = 'Ausschreibungszuschlag PV >1 MWp: ca. 5,0–6,0 ct/kWh (mittlerer Zuschlagswert)';
      break;
    case 'markt':
      einsp = 7.5;
      hint = 'Marktprämienmodell: Marktwert Solar (ca. 7–8 ct/kWh, variiert mit Börsenpreis)';
      break;
    case 'manuell':
      hint = 'Manuell: Einspeisungspreis frei einstellbar';
      break;
  }
  if (modell !== 'manuell' && einspEl) einspEl.value = einsp;
  if (hintEl) hintEl.textContent = hint;
  calcStromPanel();
}

// ── PV-Invest Auto-Update ────────────────────────────────────────────────
export function updatePvInvestAuto() {
  const autoChk = document.getElementById('pv-invest-auto');
  const invEl = document.getElementById('opt-pv-invest');
  if (!autoChk?.checked || !invEl) return;
  const kwp = (parseFloat(document.getElementById('pv-kwp')?.value) || 0)
    + gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0)
    + freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
  if (typeof CalcEngine !== 'undefined' && kwp > 0) {
    calcStromPanel._updating = true;
    invEl.value = CalcEngine.getPvInvestPerKwp(kwp);
    calcStromPanel._updating = false;
  }
  calcStromPanel();
}


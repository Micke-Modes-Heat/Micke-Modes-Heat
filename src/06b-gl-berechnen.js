// ── 06b-gl-berechnen.js — Hauptberechnung, Synthese, Skalierung, Solarthermie ──
// ── Auto-Trigger ──────────────────────────────────────────────────────────
import { gebaeude, globalYear, isExcluded } from './01-globals-varianten.js';
import { getComputedStats, map } from './02b-gebaeude.js';
import { polygonAreaM2 } from './02c-karte-werkzeuge.js';
import { redrawVerbindungslinien } from './03a-erzeuger.js';
import { hideHint, showHint } from './03c-gebaeude-io.js';
import { glGetGesamtMwh, glGetMonatswerte, glGetTempH, glLastgangKw, glRenderPreview, glRenderSplit, glUpdateKlimaStatus, glUpdateStatus } from './06a-gbi-lastgang.js';
import { onSystemStateUpdated, updateAllDeckungen } from './06c-dispatch-core.js';
import { CalcEngine } from './08-calc-engine.js';
import { readNum } from './lib/util.js';
import { polygonCenter } from './02c-karte-werkzeuge.js';
import { isErzeugerAktiv } from './06c-dispatch-core.js';
import { _PV_SUN, makePvProfile8760 } from './09a-pv-profile.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';
// Auto-ergänzte Imports (ESM-Migration Phase 1, tools/fix-missing-imports.mjs)
import { setThermSpeicherAktiv, thermSpeicherAktiv } from './01-globals-varianten.js';

export let _glAutoTimer  = null;
export let _glIsRunning  = false;

export function glKannBerechnen() {
  if (glLastgangKw) return true;
  if (glGetMonatswerte().some(v => v !== null)) return true;
  if (glGetGesamtMwh()) return true;
  return gebaeude.some(g => parseFloat(g.waerme) > 0 || parseFloat(g.heizlast) > 0);
}

export function glBerechnenDebounced(delay = 1000) {
  clearTimeout(_glAutoTimer);
  if (!glKannBerechnen()) return;
  const dot = document.getElementById('gl-status-dot');
  if (dot) dot.className = 'gl-status-dot pending';
  _glAutoTimer = setTimeout(async () => {
    if (!_glIsRunning) await glBerechnen();
  }, delay);
}

export function glBerechnenAuto() {
  glUpdateStatus();
  glBerechnenDebounced();
}

// ── Hauptberechnung ───────────────────────────────────────────────────────
async function glBerechnen() {
  if (_glIsRunning) return;
  _glIsRunning = true;
  const btn = document.getElementById('gl-run-btn');
  btn.textContent = '⏳ Berechne…'; btn.disabled = true;

  try {
    const stadt       = document.getElementById('gl-stadt').value;
    const normAt      = readNum('gl-norm-at', -12, -30, 0);
    const netzverlust = readNum('gl-netzverlust', 10, 0, 50);
    const vl5         = readNum('gl-vl5', 90, 30, 130);
    const vl15        = readNum('gl-vl15', 60, 20, 100);
    const profil1     = document.getElementById('gl-profil1').value || 'HEF33';
    const profil2     = document.getElementById('gl-profil2').value || null;
    let gew1 = parseFloat(document.getElementById('gl-gew1').value) || 50;
    let gew2 = parseFloat(document.getElementById('gl-gew2').value) || 0;
    // Normieren auf 100 %
    const gewSum = gew1 + gew2;
    if (gewSum > 0 && Math.abs(gewSum - 100) > 0.1) { gew1 = gew1 / gewSum * 100; gew2 = gew2 / gewSum * 100; }
    let gesamt        = glGetGesamtMwh();
    const monatswerte = glGetMonatswerte();
    const hatMonat    = monatswerte.some(v => v !== null);
    const monatSum    = monatswerte.reduce((a, b) => a + (b || 0), 0);

    // DWD-Temperaturprofil laden (falls gewählt)
    const klimaJahr = document.getElementById('gl-klimajahr').value;
    const tempHResult = await glGetTempH(stadt, klimaJahr);
    const tempHDwd    = tempHResult.tempH;
    const tempHFallback = tempHResult.fallback;
    glUpdateKlimaStatus(tempHFallback);

    // Fall bestimmen
    let lastgangKw; // Float32Array 8760h
    let gesamtMwh;
    let nurGebaeude = false; // Flag: Lastgang stammt nur aus Gebäudedaten (ohne explizite Verbrauchsangabe)
    let synState = null;     // CalcEngine-Ergebnis der Synthese (Fälle 3–5) — für tempState wiederverwendet

    if (glLastgangKw && !hatMonat) {
      // Fall 1: Direkt (Lastgang hochgeladen → Verluste bereits enthalten)
      lastgangKw = glLastgangKw;
      gesamtMwh = lastgangKw.reduce((a, b) => a + b, 0) / 1000;

    } else if (glLastgangKw && hatMonat) {
      // Fall 2: Gleitende Monatsskalierung (Verluste bereits enthalten)
      lastgangKw = glSkaliereMitMonaten(glLastgangKw, monatswerte);
      gesamtMwh = lastgangKw.reduce((a, b) => a + b, 0) / 1000;

    } else {
      // Fälle 3–5: Synthese via CalcEngine
      // Gesamtmenge ermitteln — Gebäude als Fallback wenn kein manueller Gesamt
      if (!hatMonat && !gesamt) {
        // Exakt dieselbe zeit- und variantenabhängige Gebäudesumme wie in der
        // Kennzahlen-Kachel verwenden. Rohwerte aller Gebäude würden auch
        // ausgeschlossene, noch nicht gebaute oder bereits abgerissene Objekte
        // einrechnen und konnten den Lastgang um ein Mehrfaches überhöhen.
        const gebSumMwh = gebaeude.reduce((sum,g) => {
          if (isExcluded(g.id)) return sum;
          return sum+(getComputedStats(g,globalYear).waerme || 0);
        },0);
        if (gebSumMwh > 0) { gesamt = gebSumMwh; nurGebaeude = true; }
        else throw new Error('Bitte Gesamtverbrauch oder Monatswerte eingeben.');
      }
      if (hatMonat && (!gesamt || Math.abs(gesamt - monatSum) < 1)) {
        gesamtMwh = monatSum; // Fall 3
      } else if (hatMonat && gesamt && gesamt < monatSum - 1) {
        gesamtMwh = monatSum; // Gesamtverbrauch < Σ Monatswerte → Fall 3
      } else {
        gesamtMwh = gesamt || monatSum; // Fall 4 oder 5
      }

      // CalcEngine für Lastgang-Synthese aufrufen (ohne Erzeuger)
      synState = await CalcEngine.run({
        stadt, normAussentemp: normAt,
        tempH: tempHDwd,   // DWD-Profil (ggf. TRY-Kassel-Fallback)
        sigProfil1: profil1, sigProfil2: profil2,
        gewicht1: gew1, gewicht2: gew2,
        vlMinus5: vl5, vl15,
        gesamtenergieMwh: gesamtMwh,
        erzeuger: [],
        energiepreise: {}, kapitalzins: 4,
        twwNetzAnteil: 0, twwAnteilVonTwwNetz: 0,
      });

      lastgangKw = new Float32Array(8760);
      for (let i = 0; i < 8760; i++) lastgangKw[i] = (synState.lastgangMwhH[i] || 0) * 1000;

      // Fälle 3+4: Monatswerte als Floor anwenden
      if (hatMonat) {
        lastgangKw = glAnwendeMonatsfloor(lastgangKw, monatswerte, gesamtMwh);
      }
    }

    // Netzverluste
    const nvPct = Math.min(netzverlust, 50);
    const nvFaktor = 1 - nvPct / 100;
    let nutzwaermeMwh, gesamtMwhMitNV;

    if (nurGebaeude) {
      // Nur Gebäudedaten → Netzverluste AUFSCHLAGEN (Energie + Leistung)
      // Heizlast ergibt sich aus dem Synthese-Lastgang (pMaxKw), nicht aus Σ Einzel-Heizlasten
      // → GLF ist implizit durch die Profilsynthese aus Gesamtenergie abgedeckt
      const aufschlag = 1 / nvFaktor; // z.B. 10% Verlust → Faktor 1.111
      nutzwaermeMwh = lastgangKw.reduce((a, b) => a + b, 0) / 1000;
      for (let i = 0; i < lastgangKw.length; i++) lastgangKw[i] *= aufschlag;
      gesamtMwhMitNV = lastgangKw.reduce((a, b) => a + b, 0) / 1000;
    } else {
      // Fälle 1–4: Eingegebene/hochgeladene Werte enthalten Verluste bereits
      gesamtMwhMitNV = lastgangKw.reduce((a, b) => a + b, 0) / 1000;
      nutzwaermeMwh = gesamtMwhMitNV * nvFaktor;
    }

    // Temperaturprofil: aus synState wiederverwenden (Fall 3-5) oder neu berechnen (Fall 1-2)
    const tempState = synState?.tempH ? synState : await CalcEngine.run({
      stadt, normAussentemp: normAt,
      tempH: tempHDwd || undefined,
      sigProfil1: profil1, sigProfil2: profil2,
      gewicht1: gew1, gewicht2: gew2,
      vlMinus5: vl5, vl15,
      gesamtenergieMwh: gesamtMwhMitNV,
      erzeuger: [],
      energiepreise: {}, kapitalzins: 4,
      twwNetzAnteil: 0, twwAnteilVonTwwNetz: 0,
    });

    // Jahresdauerlinie vorberechnen (für Schnellschätzung Phase B)
    const jdl = Float32Array.from(lastgangKw).sort((a, b) => b - a);

    // systemState befüllen
    window.systemState = {
      // Rohdaten
      lastgangKw,
      tempH: tempState.tempH,
      vlH: tempState.vlH,
      jahresdauerlinie: jdl,
      // Metadaten
      gesamtMwhMitNV,
      nutzwaermeMwh,
      netzverlustPct: netzverlust,
      nurGebaeude,
      pMaxKw: Math.max(...lastgangKw),
      tMin: Math.min(...tempState.tempH),
      // Parameter
      stadt, normAussentemp: normAt,
      vlMinus5: vl5, vl15,
      sigProfil1: profil1, sigProfil2: profil2,
      gewicht1: gew1, gewicht2: gew2,
      // Zeitstempel
      berechnetAm: new Date().toISOString(),
    };

    // Basis-Lastgang für jahresweise Skalierung speichern
    window._basisLastgangKw = new Float32Array(lastgangKw);
    window._basisYear = globalYear;
    window._basisGebWaermeSumme = gebaeude.reduce((s, g) => {
      if (isExcluded(g.id)) return s;
      const st = getComputedStats(g, globalYear);
      return s + (st.waerme || 0);
    }, 0);

    // Gebäude auf Nutzwärme skalieren — NUR wenn externer Lastgang geladen
    // Bei Synthese aus Gebäudedaten ist der Lastgang bereits aus den Gebäudewerten abgeleitet
    if (!nurGebaeude) {
      glSkalierGebaeude(nutzwaermeMwh, window.systemState.pMaxKw);
    } else {
      const el = document.getElementById('skalier-hint');
      if (el) el.style.display = 'none';
    }

    // Vorschau des Lastgangs anzeigen (auch bei Syntheselastgang)
    glRenderPreview(lastgangKw, window.systemState.pMaxKw);

    // Lastgang hat immer Vorrang: tot-waerme/tot-hl aus systemState
    document.getElementById('tot-waerme').textContent =
      Math.round(gesamtMwhMitNV).toLocaleString('de-DE', {maximumFractionDigits: 1});
    document.getElementById('tc-waerme').title = `${Math.round(gesamtMwhMitNV)} MWh/a inkl. Netzverluste (Lastgang).\nOhne Verluste: ${Math.round(nutzwaermeMwh)} MWh/a`;
    document.getElementById('tot-hl').textContent =
      Math.round(window.systemState.pMaxKw).toLocaleString('de-DE', {maximumFractionDigits: 1});
    document.getElementById('tot-hl-lbl').textContent = 'Netz-Spitzenlast (kW)';
    const normheizlastKw = gebaeude.reduce((s,g) => s + (getComputedStats(g,globalYear).heizlast||0), 0);
    document.getElementById('tot-hl-sub').textContent =
      `Σ Gebäude: ${Math.round(normheizlastKw).toLocaleString('de-DE')} kW`;
    document.getElementById('tc-hl').title = `Maßgebende Spitzenlast aus dem berechneten Lastgang inklusive Netzverlusten: ${Math.round(window.systemState.pMaxKw)} kW.\nSumme der Gebäude-Normheizlasten (DIN 12831): ${Math.round(normheizlastKw)} kW.`;

    // Status aktualisieren
    const dot = document.getElementById('gl-status-dot');
    dot.className = 'gl-status-dot ok';
    document.getElementById('gl-status-text').textContent =
      `✓ Berechnet: ${Math.round(gesamtMwhMitNV).toLocaleString('de-DE')} MWh/a · P_max ${Math.round(window.systemState.pMaxKw).toLocaleString('de-DE')} kW · T_min ${window.systemState.tMin.toFixed(1)}°C`;

    // Energiesplit-Chart aktualisieren
    glRenderSplit(lastgangKw, netzverlust);

    // Andere Panels benachrichtigen
    if (typeof onSystemStateUpdated === 'function') onSystemStateUpdated();

  } catch(err) {
    console.error('Grundlagen-Fehler:', err);
    const errDot = document.getElementById('gl-status-dot');
    if (errDot) errDot.className = 'gl-status-dot error';
    const errText = document.getElementById('gl-status-text');
    if (errText) errText.textContent = '⚠ ' + (err.message || 'Unbekannter Fehler');
    showHint('⚠ Berechnungsfehler: ' + (err.message || 'Unbekannter Fehler'));
  } finally {
    _glIsRunning = false;
    btn.dataset.manual = '0';
    btn.textContent = '⚡ Grundlage berechnen'; btn.disabled = false;
  }
}

// ── Fall 2: Gleitende Monatsskalierung ───────────────────────────────────
export function glSkaliereMitMonaten(arr, monatswerte) {
  const MONAT_STUNDEN = [744,672,744,720,744,720,744,744,720,744,720,744]; // Jan–Dez
  const result = new Float32Array(8760);

  // Faktoren pro Monat berechnen
  const faktoren = new Float32Array(12);
  let h = 0;
  for (let m = 0; m < 12; m++) {
    const stunden = MONAT_STUNDEN[m];
    let sum = 0;
    for (let i = 0; i < stunden && h + i < 8760; i++) sum += arr[h + i];
    const monatSumMwh = sum / 1000;
    faktoren[m] = (monatswerte[m] != null && monatSumMwh > 0)
      ? monatswerte[m] / monatSumMwh : 1;
    h += stunden;
  }

  // Glättung: gleitender Mittelwert der Faktoren über Monatsgrenzen
  // Für jede Stunde: lineares Interpolieren zwischen Monatsmitte-Faktoren
  const mMitte = []; // Stunde der Monatsmitte
  let hStart = 0;
  for (let m = 0; m < 12; m++) {
    mMitte.push(hStart + Math.floor(MONAT_STUNDEN[m] / 2));
    hStart += MONAT_STUNDEN[m];
  }

  for (let i = 0; i < 8760; i++) {
    // Nächste zwei Monatsmittelpunkte finden
    let m1 = 11, m2 = -1;
    for (let m = 0; m < 12; m++) {
      if (mMitte[m] <= i) m1 = m;
      if (mMitte[m] > i && m2 < 0) m2 = m;
    }
    if (m2 < 0) m2 = 0; // Wrap: nach Dez-Mitte → Jan-Mitte
    // Lineares Interpolieren zwischen m1 und m2
    let h1 = mMitte[m1], h2 = mMitte[m2];
    if (h2 <= h1) h2 += 8760; // Jahreswechsel-Wrap (Dez→Jan)
    let iAdj = i;
    if (i < h1) iAdj += 8760; // Stunde vor Jan-Mitte: virtual wrap
    const t = h2 > h1 ? (iAdj - h1) / (h2 - h1) : 0;
    const f = faktoren[m1] * (1 - t) + faktoren[m2] * t;
    result[i] = arr[i] * Math.max(0, f);
  }
  return result;
}

// ── Fall 4: Monatsfloor anwenden ─────────────────────────────────────────
export function glAnwendeMonatsfloor(arr, monatswerte, gesamtMwh) {
  const MONAT_STUNDEN = [744,672,744,720,744,720,744,744,720,744,720,744];
  const result = Float32Array.from(arr);
  let h = 0;
  for (let m = 0; m < 12; m++) {
    const stunden = MONAT_STUNDEN[m];
    if (monatswerte[m] == null) { h += stunden; continue; }
    const floor = monatswerte[m] * 1000; // kWh
    let sum = 0;
    for (let i = 0; i < stunden && h + i < 8760; i++) sum += result[h + i];
    if (sum < floor) {
      // Gleichmäßig auffüllen
      const add = (floor - sum) / stunden;
      for (let i = 0; i < stunden && h + i < 8760; i++) result[h + i] += add;
    }
    h += stunden;
  }
  // Auf Gesamtmenge skalieren
  const sumNeu = result.reduce((a, b) => a + b, 0) / 1000;
  if (sumNeu > 0 && gesamtMwh) {
    const f = gesamtMwh / sumNeu;
    for (let i = 0; i < 8760; i++) result[i] *= f;
  }
  return result;
}

// ── Skalierungsfaktoren berechnen & Hinweis anzeigen (Gebäudedaten bleiben unverändert) ──
export function glSkalierGebaeude(nutzwaermeMwh, pMaxKw) {
  const el = document.getElementById('skalier-hint');
  if (typeof gebaeude === 'undefined' || !gebaeude.length) {
    if (el) el.style.display = 'none';
    return;
  }
  const sumWaerme = gebaeude.reduce((a, g) => a + (g.waerme || 0), 0);
  const sumHl     = gebaeude.reduce((a, g) => a + (parseFloat(g.heizlast) || 0), 0);
  if (sumWaerme <= 0) { if (el) el.style.display = 'none'; return; }

  const fW = nutzwaermeMwh / sumWaerme;
  const fH = (pMaxKw && sumHl > 0) ? pMaxKw / sumHl : fW;

  // Faktoren in systemState speichern (für Netzberechnung)
  if (window.systemState) {
    window.systemState.skalierFaktorW = fW;
    window.systemState.skalierFaktorH = fH;
  }

  // Hinweis auf der Karte
  if (!el) return;
  const richtungW = fW > 1.01 ? 'hochskaliert' : fW < 0.99 ? 'runterskaliert' : null;
  const richtungH = fH > 1.01 ? 'hochskaliert' : fH < 0.99 ? 'runterskaliert' : null;
  if (richtungW || richtungH) {
    const pctW = ((fW - 1) * 100).toFixed(1);
    const pctH = ((fH - 1) * 100).toFixed(1);
    const teile = [];
    if (richtungW) teile.push(`Verbrauch ×${fW.toFixed(2)} (${pctW > 0 ? '+' : ''}${pctW} %)`);
    if (richtungH && Math.abs(fH - fW) > 0.005) teile.push(`Heizlast ×${fH.toFixed(2)} (${pctH > 0 ? '+' : ''}${pctH} %)`);
    el.textContent = `ℹ Gebäude intern skaliert — ${teile.join(' · ')} — Lastgang hat Vorrang`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ── Solarthermie ─────────────────────────────────────────────────────────
export function toggleSolarthermiePanel() {
  const p = document.getElementById('solarthermie-panel');
  if (!p) return;
  p.style.display = p.style.display === 'none' || !p.style.display ? 'block' : 'none';
  if (p.style.display === 'block') updateSolarthermieDisplay();
}

export function updateSolarthermieDisplay() {
  const fl = parseFloat(document.getElementById('st-flaeche')?.value) || 0;
  const spez = parseFloat(document.getElementById('st-spez')?.value) || 400;
  window.solarthermieAktiv = fl > 0;
  const ertragMwh = fl * spez / 1000;
  const peakKw = fl * 0.7; // Spitzenleistung ~700 W/m² bei guter Einstrahlung
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('st-ertrag', ertragMwh > 0 ? ertragMwh.toFixed(1) + ' MWh/a' : '—');
  el('st-peak', peakKw > 0 ? Math.round(peakKw) + ' kW' : '—');
}

export function clearSolarthermie() {
  window.solarthermieAktiv = false;
  const el = document.getElementById('st-flaeche'); if (el) el.value = 0;
  // Karten-Layer entfernen
  if (window._stPolygonLayer) { map.removeLayer(window._stPolygonLayer); window._stPolygonLayer = null; }
  if (window._stSvgLayer) { map.removeLayer(window._stSvgLayer); window._stSvgLayer = null; }
  window._stPolygon = null;
  const srcEl = document.getElementById('st-flaeche-src');
  if (srcEl) srcEl.textContent = '';
  updateSolarthermieDisplay();
  updateAllDeckungen();
  if (typeof redrawVerbindungslinien === 'function') redrawVerbindungslinien();
}

// ── Solarthermie Kartenzeichnung ──
export let _stDrawPoints = [];
export let _stDrawPolyline = null;
export let _stDrawStartMarker = null;

export function startDrawST() {
  cancelDrawST();
  _stDrawPoints = [];
  showHint('Eckpunkte des Kollektorfelds anklicken · Startpunkt (rot) erneut anklicken zum Abschließen · Rechtsklick = Zurück');
  map.getContainer().style.cursor = 'crosshair';
  document.getElementById('btn-st-draw').style.display = 'none';
  document.getElementById('btn-st-cancel').style.display = '';
  map.on('click', _stMapClick);
  map.on('contextmenu', _stMapUndo);
}

export function cancelDrawST() {
  if (_stDrawPolyline) { map.removeLayer(_stDrawPolyline); _stDrawPolyline = null; }
  if (_stDrawStartMarker) { map.removeLayer(_stDrawStartMarker); _stDrawStartMarker = null; }
  _stDrawPoints = [];
  map.getContainer().style.cursor = '';
  map.off('click', _stMapClick);
  map.off('contextmenu', _stMapUndo);
  hideHint();
  document.getElementById('btn-st-draw').style.display = '';
  document.getElementById('btn-st-cancel').style.display = 'none';
}

export function _stMapClick(e) {
  const latlng = e.latlng;
  // Schließen wenn auf Startpunkt geklickt
  if (_stDrawPoints.length >= 3 && _stDrawStartMarker) {
    const start = _stDrawPoints[0];
    const dist = map.latLngToLayerPoint(latlng).distanceTo(map.latLngToLayerPoint(L.latLng(start.lat, start.lng)));
    if (dist < 15) { _finishDrawST(); return; }
  }
  _stDrawPoints.push({ lat: latlng.lat, lng: latlng.lng });
  if (_stDrawPoints.length === 1) {
    _stDrawStartMarker = L.circleMarker(latlng, { radius: 7, color: '#e53935', fillColor: '#e53935', fillOpacity: 0.8, weight: 2 }).addTo(map);
  }
  if (_stDrawPolyline) map.removeLayer(_stDrawPolyline);
  _stDrawPolyline = L.polyline(_stDrawPoints.map(p => [p.lat, p.lng]), { color: '#ffab40', weight: 2, dashArray: '6,4' }).addTo(map);
}

export function _stMapUndo(e) {
  e.originalEvent.preventDefault();
  if (_stDrawPoints.length > 0) {
    _stDrawPoints.pop();
    if (_stDrawPoints.length === 0 && _stDrawStartMarker) { map.removeLayer(_stDrawStartMarker); _stDrawStartMarker = null; }
    if (_stDrawPolyline) map.removeLayer(_stDrawPolyline);
    if (_stDrawPoints.length > 0) {
      _stDrawPolyline = L.polyline(_stDrawPoints.map(p => [p.lat, p.lng]), { color: '#ffab40', weight: 2, dashArray: '6,4' }).addTo(map);
    }
  }
}

export function _finishDrawST() {
  if (_stDrawPoints.length < 3) return;
  const pts = [..._stDrawPoints];
  cancelDrawST();
  window._stPolygon = pts;
  const areaM2 = polygonAreaM2(pts);
  document.getElementById('st-flaeche').value = Math.round(areaM2);
  const srcEl = document.getElementById('st-flaeche-src');
  if (srcEl) srcEl.textContent = '(aus Karte)';
  _attachSTLayer(pts);
  updateSolarthermieDisplay();
  updateAllDeckungen();
  if (typeof redrawVerbindungslinien === 'function') redrawVerbindungslinien();
}

export function _attachSTLayer(pts) {
  if (window._stPolygonLayer) map.removeLayer(window._stPolygonLayer);
  if (window._stSvgLayer) map.removeLayer(window._stSvgLayer);
  // Polygon-Rahmen
  window._stPolygonLayer = L.polygon(pts.map(p => [p.lat, p.lng]), {
    color: 'rgba(255,171,64,0.85)', weight: 2,
    fillColor: 'rgba(255,171,64,0.15)', fillOpacity: 1
  }).addTo(map);
  window._stPolygonLayer.on('click', () => {
    const p = document.getElementById('solarthermie-panel');
    if (p && (p.style.display === 'none' || !p.style.display)) toggleSolarthermiePanel();
  });
  if (pts.length < 3) return;
  // Kollektor-Visualisierung (kupferfarbene Reihen)
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  if (maxLat === minLat || maxLng === minLng) return;
  const W = 1000, H = 1000;
  const polyPts = pts.map(p => {
    const x = ((p.lng - minLng) / (maxLng - minLng) * W).toFixed(1);
    const y = ((maxLat - p.lat) / (maxLat - minLat) * H).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  // Flachkollektoren: kupferfarbene Reihen, enger Reihenabstand (GCR ~80%)
  const colFill = 'rgba(183,110,57,0.78)';
  const colFrame = 'rgba(121,85,72,0.50)';
  const colGlass = 'rgba(255,183,77,0.30)';
  const nRows = 14;
  const nCols = 6;
  const gcr = 0.80;
  const rowPitch = H / nRows;
  const rowH = rowPitch * gcr;
  const colW = W / nCols;
  let shapes = '';
  for (let i = 0; i < nRows; i++) {
    const y0 = (i * rowPitch + (rowPitch - rowH) / 2).toFixed(1);
    shapes += `<rect x="0" y="${y0}" width="${W}" height="${rowH.toFixed(1)}" fill="${colFill}"/>`;
    // Vertikale Trennlinien
    for (let c = 1; c < nCols; c++) {
      const cx = (c * colW).toFixed(1);
      shapes += `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${(parseFloat(y0) + rowH).toFixed(1)}" stroke="${colFrame}" stroke-width="1.5"/>`;
    }
    // Glas-Glanz oben
    shapes += `<rect x="0" y="${y0}" width="${W}" height="${(rowH * 0.15).toFixed(1)}" fill="${colGlass}"/>`;
  }
  const clipId = `st-clip`;
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.style.overflow = 'hidden';
  svgEl.innerHTML = `<defs><clipPath id="${clipId}"><polygon points="${polyPts}"/></clipPath></defs>` +
                    `<g clip-path="url(#${clipId})">${shapes}</g>`;
  const bounds = [[minLat, minLng], [maxLat, maxLng]];
  window._stSvgLayer = L.svgOverlay(svgEl, bounds, { opacity: 1, interactive: false, zIndex: 201 }).addTo(map);
}

export function makeStProfile8760(flaecheOverride) {
  const fl = flaecheOverride != null ? flaecheOverride : (parseFloat(document.getElementById('st-flaeche')?.value) || 0);
  const spez = parseFloat(document.getElementById('st-spez')?.value) || 400;
  if (fl <= 0) return null;
  const totalKwh = fl * spez; // kWh/a (Nutzer-Zielwert)

  const ss = window.systemState;
  const tempH = ss?.tempH;
  const vlH   = ss?.vlH;

  // ── Temperaturabhängiges Kollektormodell (wenn Wetterdaten vorhanden) ──
  // Flachkollektor-Kennlinie nach DIN EN ISO 9806:
  //   η = η₀ − a₁·ΔT/G − a₂·ΔT²/G
  // Typische Werte für guten Flachkollektor (Nahwärme-Niveau):
  //   η₀ = 0.80, a₁ = 3.5 W/(m²·K), a₂ = 0.015 W/(m²·K²)
  // Mittlere Kollektortemperatur Tm ≈ Vorlauf − 10 K
  if (tempH && vlH && tempH.length >= 8760) {
    const eta0 = 0.80;
    const a1   = 3.5;    // W/(m²·K)
    const a2   = 0.015;  // W/(m²·K²)

    // Monatliche Spitzen-Einstrahlung Süd 45° [W/m²] — Deutschland ~51°N
    const G_PEAK = [280, 400, 550, 700, 800, 850, 830, 750, 600, 400, 280, 230];
    const MDAYS  = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const profile = new Float32Array(8760);
    let rawTotal = 0;
    let ptr = 0;

    for (let m = 0; m < 12; m++) {
      const [rise, set] = _PV_SUN[m];
      const span  = set - rise;
      const gPeak = G_PEAK[m];

      for (let d = 0; d < MDAYS[m]; d++) {
        for (let h = 0; h < 24; h++) {
          if (ptr >= 8760) break;
          let qKw = 0;
          if (h >= rise && h < set && gPeak > 0) {
            const tNorm = (h - rise + 0.5) / span; // 0..1, Stundenmitte
            const G = gPeak * Math.sin(Math.PI * tNorm); // W/m²
            if (G > 50) { // Mindest-Einstrahlung
              const Tm = vlH[ptr] - 10; // mittlere Kollektortemp
              const dT = Tm - tempH[ptr]; // Übertemperatur Kollektor − Umgebung
              const eta = eta0 - a1 * dT / G - a2 * dT * dT / G;
              if (eta > 0.01) {
                qKw = eta * G * fl / 1000; // kW
              }
            }
          }
          profile[ptr] = qKw;
          rawTotal += qKw;
          ptr++;
        }
      }
    }

    // Jahresertrag auf Nutzer-Zielwert skalieren (Profilform bleibt, Summe = totalKwh)
    if (rawTotal > 0) {
      const scale = totalKwh / rawTotal;
      for (let t = 0; t < 8760; t++) profile[t] *= scale;
    }
    return profile;
  }

  // Fallback ohne Wetterdaten: PV-basiertes Profil (weniger genau)
  const norm = makePvProfile8760('sued');
  const profile = new Float32Array(8760);
  for (let t = 0; t < 8760; t++) profile[t] = norm[t] * totalKwh;
  return profile;
}

// ── Wärmespeicher ────────────────────────────────────────────────────────
export function toggleThermSpeicherPanel() {
  const p = document.getElementById('therm-speicher-panel');
  if (!p) return;
  p.style.display = p.style.display === 'none' || !p.style.display ? 'block' : 'none';
  if (p.style.display === 'block') updateThermSpeicherDisplay();
}

export function tsTypChanged() {
  const typ = document.getElementById('ts-typ')?.value;
  const presets = {
    puffer:   { dt: 40, verlust: 0.5,  entlade: 200 },
    gross:    { dt: 40, verlust: 0.1,  entlade: 500 },
    saisonal: { dt: 30, verlust: 0.02, entlade: 100 },
  };
  const p = presets[typ] || presets.puffer;
  document.getElementById('ts-dt').value = p.dt;
  document.getElementById('ts-verlust').value = p.verlust;
  document.getElementById('ts-entlade-kw').value = p.entlade;
  const ladeEl = document.getElementById('ts-lade-kw');
  if (ladeEl) ladeEl.value = p.entlade;
  // Volumen automatisch aus WP-Leistung berechnen
  const vol = _autoSpeicherVolumen(typ, p.dt);
  document.getElementById('ts-volumen').value = vol;
  updateThermSpeicherDisplay();
  updateAllDeckungen();
}

// ── Automatische Speichergrößen-Empfehlung ──
// Puffer: 3h WP-Überbrückung, Groß: 12h, Saisonal: Fallback auf Preset
export function _autoSpeicherVolumen(typ, dt) {
  // Gesamte aktive WP-Leistung ermitteln
  const wpKeys = ['lwwp', 'fg', 'geo'];
  let wpKwGesamt = 0;
  for (const k of wpKeys) {
    if (typeof isErzeugerAktiv === 'function' && isErzeugerAktiv(k)) {
      const id = ERZEUGER_CFG[k]?.leistungId;
      wpKwGesamt += id ? (parseFloat(document.getElementById(id)?.value) || 0) : 0;
    }
  }
  if (wpKwGesamt <= 0) {
    // Fallback: Preset-Werte wenn keine WP aktiv
    return typ === 'saisonal' ? 5000 : typ === 'gross' ? 1000 : 50;
  }
  const stunden = typ === 'saisonal' ? 48 : typ === 'gross' ? 12 : 3;
  const vol = Math.round(wpKwGesamt * stunden / (1.16 * (dt || 40)));
  // Auf sinnvolle Schritte runden (5er für Puffer, 50er für Groß, 100er für Saisonal)
  const step = typ === 'saisonal' ? 100 : typ === 'gross' ? 50 : 5;
  return Math.max(step, Math.round(vol / step) * step);
}

export function updateThermSpeicherDisplay() {
  const p = getThermSpeicherParams();
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (p) {
    el('ts-kap', p.kapKwh.toFixed(0) + ' kWh (' + (p.kapKwh / 1000).toFixed(1) + ' MWh)');
    setThermSpeicherAktiv(true);
  } else {
    el('ts-kap', '—');
    setThermSpeicherAktiv(false);
  }
  if (typeof redrawThermSpeicherMap === 'function') redrawThermSpeicherMap();
}

export function getThermSpeicherParams() {
  const vol = parseFloat(document.getElementById('ts-volumen')?.value) || 0;
  if (vol <= 0) return null;
  const dt = parseFloat(document.getElementById('ts-dt')?.value) || 40;
  const verlustPctH = parseFloat(document.getElementById('ts-verlust')?.value) || 0.5;
  const entladeKw = parseFloat(document.getElementById('ts-entlade-kw')?.value) || 200;
  const ladeKw = parseFloat(document.getElementById('ts-lade-kw')?.value) || entladeKw;
  const kapKwh = vol * 1.16 * dt; // V × ρc/3600 × ΔT ≈ V × 1.16 × ΔT
  return { vol, dt, kapKwh, verlustRate: verlustPctH / 100, entladeKw, ladeKw };
}

export function clearThermSpeicher() {
  setThermSpeicherAktiv(false);
  document.getElementById('ts-volumen').value = 0;
  _removeThermSpeicherMapLayers();
  updateThermSpeicherDisplay();
  updateAllDeckungen();
}

// ── Wärmespeicher Kartenvisualisierung ────────────────────────────────────
export function _removeThermSpeicherMapLayers() {
  if (window._tsSvgLayer) { map.removeLayer(window._tsSvgLayer); window._tsSvgLayer = null; }
  if (window._tsPolygonLayer) { map.removeLayer(window._tsPolygonLayer); window._tsPolygonLayer = null; }
  if (window._tsIconMarker) { map.removeLayer(window._tsIconMarker); window._tsIconMarker = null; }
}

export function redrawThermSpeicherMap() {
  _removeThermSpeicherMapLayers();
  if (!thermSpeicherAktiv) return;
  const typ = document.getElementById('ts-typ')?.value || 'puffer';
  if (typ === 'saisonal') {
    _drawErdbeckenSpeicher();
  } else {
    _drawSpeicherIcon();
  }
}

export function _drawSpeicherIcon() {
  // Dezentes Icon an der Heizzentrale
  const zId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (!zId || isNaN(zId)) return;
  const g = gebaeude.find(x => x.id === zId);
  if (!g || !g.polygon) return;
  const center = polygonCenter(g.polygon);
  // Leicht versetzt (Südost) damit es nicht auf dem Gebäude-Label liegt
  const offsetLat = center.lat - 0.00008;
  const offsetLng = center.lng + 0.00012;
  const p = getThermSpeicherParams();
  const kapStr = p ? Math.round(p.kapKwh) + ' kWh' : '';
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:rgba(38,166,154,0.85);color:#fff;border-radius:5px;padding:2px 5px;font-size:10px;font-family:'DM Mono',monospace;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,0.25);display:flex;align-items:center;gap:4px;">
      <svg width="16" height="20" viewBox="0 0 16 20" style="flex-shrink:0;">
        <rect x="3" y="2" width="10" height="16" rx="1.5" fill="rgba(255,255,255,0.25)" stroke="#fff" stroke-width="1"/>
        <rect x="5.5" y="1" width="5" height="2" rx="0.8" fill="rgba(255,255,255,0.5)"/>
        <rect x="5" y="9" width="6" height="7" rx="0.5" fill="rgba(255,87,34,0.7)"/>
        <rect x="0" y="5" width="2.5" height="10" rx="1" fill="rgba(255,255,255,0.3)" stroke="#fff" stroke-width="0.6"/>
        <circle cx="1.2" cy="13.5" r="1.3" fill="#ef5350"/>
        <rect x="0.7" y="8" width="1" height="6" rx="0.3" fill="#ef5350"/>
      </svg>
      <span>${kapStr}</span>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
  window._tsIconMarker = L.marker([offsetLat, offsetLng], { icon, interactive: true, zIndexOffset: 500 })
    .addTo(map)
    .on('click', () => {
      const p = document.getElementById('therm-speicher-panel');
      if (p && (p.style.display === 'none' || !p.style.display)) toggleThermSpeicherPanel();
    });
}

export function _drawErdbeckenSpeicher() {
  // Erdbeckenspeicher: Haldenform (abgeflachter Hügel) an der Heizzentrale
  const zId = parseInt(document.getElementById('netz-zentrale')?.value);
  if (!zId || isNaN(zId)) return;
  const g = gebaeude.find(x => x.id === zId);
  if (!g || !g.polygon) return;
  const center = polygonCenter(g.polygon);

  const vol = parseFloat(document.getElementById('ts-volumen')?.value) || 5000;
  const tiefe = 8; // Typisch 5-12m, Mittelwert 8m
  const grundflaeche = vol / tiefe; // m²
  // Böschung: Oberfläche ca. 40% größer als Grundfläche
  const oberflaeche = grundflaeche * 1.4;
  const radiusM = Math.sqrt(oberflaeche / Math.PI);

  // Versetzt südlich der Heizzentrale
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(center.lat * Math.PI / 180));
  const cLat = center.lat - dLat * 2.5;
  const cLng = center.lng + dLng * 0.5;

  // Polygon (Ellipse) für den Erdbecken-Grundriss
  const nPts = 36;
  const polyPts = [];
  const rx = dLng * 1.2;
  const ry = dLat;
  for (let i = 0; i < nPts; i++) {
    const angle = (i / nPts) * 2 * Math.PI;
    polyPts.push([cLat + ry * Math.sin(angle), cLng + rx * Math.cos(angle)]);
  }
  window._tsPolygonLayer = L.polygon(polyPts, {
    color: 'rgba(38,166,154,0.7)', weight: 2,
    fillColor: 'rgba(38,166,154,0.25)', fillOpacity: 1
  }).addTo(map);
  window._tsPolygonLayer.on('click', () => {
    const p = document.getElementById('therm-speicher-panel');
    if (p && (p.style.display === 'none' || !p.style.display)) toggleThermSpeicherPanel();
  });

  // SVG-Overlay: Haldenform (Erdwall mit Böschung)
  const bounds = [[cLat - ry * 1.1, cLng - rx * 1.1], [cLat + ry * 1.1, cLng + rx * 1.1]];
  const W = 400, H = 400;
  const cx = W / 2, cy = H / 2;
  const rX = W * 0.42, rY = H * 0.42;

  // Haldenform: äußerer Rand (Böschungsfuß), innerer Rand (Kronenrand), Plateau oben
  const outerEllipse = [];
  const innerEllipse = [];
  const shrink = 0.6; // Kronenfläche = 60% vom Grundriss
  for (let i = 0; i <= nPts; i++) {
    const a = (i / nPts) * 2 * Math.PI;
    outerEllipse.push(`${(cx + rX * Math.cos(a)).toFixed(1)},${(cy + rY * Math.sin(a)).toFixed(1)}`);
    innerEllipse.push(`${(cx + rX * shrink * Math.cos(a)).toFixed(1)},${(cy + rY * shrink * Math.sin(a)).toFixed(1)}`);
  }

  const kapStr = getThermSpeicherParams() ? Math.round(getThermSpeicherParams().kapKwh).toLocaleString('de-DE') + ' kWh' : '';
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.style.overflow = 'visible';
  svgEl.innerHTML = `
    <!-- Böschung (Gradient von außen nach innen) -->
    <defs>
      <radialGradient id="ts-halde-grad" cx="50%" cy="45%" r="50%">
        <stop offset="50%" stop-color="rgba(38,166,154,0.35)"/>
        <stop offset="85%" stop-color="rgba(38,166,154,0.15)"/>
        <stop offset="100%" stop-color="rgba(38,166,154,0.05)"/>
      </radialGradient>
    </defs>
    <!-- Äußere Böschung -->
    <polygon points="${outerEllipse.join(' ')}" fill="url(#ts-halde-grad)" stroke="rgba(38,166,154,0.5)" stroke-width="1.5"/>
    <!-- Böschungslinien (Höhenlinien-Effekt) -->
    <ellipse cx="${cx}" cy="${cy}" rx="${rX * 0.85}" ry="${rY * 0.85}" fill="none" stroke="rgba(38,166,154,0.2)" stroke-width="0.8" stroke-dasharray="4,3"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rX * 0.72}" ry="${rY * 0.72}" fill="none" stroke="rgba(38,166,154,0.2)" stroke-width="0.8" stroke-dasharray="4,3"/>
    <!-- Kronenfläche (Plateau oben) -->
    <polygon points="${innerEllipse.join(' ')}" fill="rgba(38,166,154,0.45)" stroke="rgba(38,166,154,0.6)" stroke-width="1.2"/>
    <!-- Schattierung Nordseite (3D-Effekt) -->
    <ellipse cx="${cx}" cy="${cy * 0.92}" rx="${rX * shrink * 0.9}" ry="${rY * shrink * 0.4}" fill="rgba(0,77,64,0.12)"/>
    <!-- Beschriftung -->
    <!-- Behälter mit Thermometer -->
    <rect x="${cx-8}" y="${cy-11}" width="14" height="20" rx="2" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.8)" stroke-width="1.2"/>
    <rect x="${cx-5}" y="${cy-12}" width="7" height="3" rx="1" fill="rgba(255,255,255,0.5)"/>
    <rect x="${cx-5.5}" y="${cy}" width="8" height="7" rx="1" fill="rgba(255,87,34,0.6)"/>
    <rect x="${cx-13}" y="${cy-6}" width="3.5" height="13" rx="1.5" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" stroke-width="0.8"/>
    <circle cx="${cx-11.2}" cy="${cy+5.5}" r="2" fill="#ef5350"/>
    <rect x="${cx-11.8}" y="${cy-2}" width="1.3" height="8" rx="0.4" fill="#ef5350"/>
    <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="'DM Mono',monospace" font-size="13" fill="rgba(255,255,255,0.75)">${kapStr}</text>
  `;

  window._tsSvgLayer = L.svgOverlay(svgEl, bounds, { opacity: 1, interactive: false, zIndex: 200 }).addTo(map);
}

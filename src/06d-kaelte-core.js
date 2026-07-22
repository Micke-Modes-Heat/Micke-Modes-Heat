// ── 06d-kaelte-core.js — Kälteversorgung: EER-Berechnung, Kältelast, Dispatch ──
//
// Spiegelbild zur Wärme-WP (06c-dispatch-core.js / 08-calc-engine.js):
//   Wärme:  COP = η  · T_VL / (T_VL − T_Quelle)        [Quelle = kalte Seite]
//   Kälte:  EER = η_K · T_KW / (T_RW − T_KW)            [T_KW = nützliche kalte Seite,
//                                                         T_RW = warme Rückkühlseite]
// Alles stundenscharf über 8.760 h, gleiche Genauigkeit wie die Wärmepumpen.
//
// Konventionen (bewusst symmetrisch zur Wärme gehalten):
// - T_KW ist die Kaltwasser-Vorlauftemperatur und wird — wie bei der Wärme die
//   Vorlauftemperatur als Kondensationstemperatur — direkt als Verdampfer-Temperatur
//   verwendet (kein zusätzlicher Approach). Reale Übertragungsverluste stecken im
//   Gütegrad η_K.
// - Referenz-EER bei Eurovent A35/W7 (Luft 35 °C, Kaltwasser 7 °C) für das
//   Leistungs-Derating der Nennleistung.

import { DAYS_PER_YEAR } from './lib/physik-konstanten.js';

// 24-h-Schablone Kälte — Nachmittags-Peak (Solar-/Belegungslast), Gegenstück zur
// Heiz-Schablone mit Morgen-/Abend-Peak. Normiert wird beim Anwenden.
export const SCHABLONE_24H_KAELTE = [
  0.45, 0.40, 0.37, 0.35, 0.34, 0.35, 0.40, 0.50,
  0.65, 0.82, 0.98, 1.12, 1.25, 1.38, 1.48, 1.50,
  1.45, 1.35, 1.20, 1.02, 0.85, 0.70, 0.58, 0.50,
];

// Spez. Kältebedarf je Nutzungstyp (kWh/m²a) — Klimakälte/Komfortkühlung.
// Richtwerte; im UI editierbar. Rechenzentrum = Prozesskälte (ganzjährig).
export const KAELTE_DEFAULTS = {
  buero:        { spez: 35,  label: 'Büro' },
  ghd:          { spez: 30,  label: 'GHD/Handel' },
  schule:       { spez: 15,  label: 'Schule' },
  oeffentlich:  { spez: 25,  label: 'Öffentlich' },
  industrie:    { spez: 40,  label: 'Industrie' },
  rechenzentrum:{ spez: 800, label: 'Rechenzentrum' },
  mfh:          { spez: 10,  label: 'Wohnen (MFH)' },
};

const MONTH_START_H = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];

// ── Rückkühl-/Quelltemperatur (Kondensatorseite) ──────────────────────────
// 'luft'   → Außentemperatur (+ optionaler Approach des luftgekühlten Verflüssigers)
// 'quelle' → kaltes Medium wie bei der Wärme-WP (Fließgewässer / Erdsonde) — relevant
//            für freie Kühlung und wassergekühlte Maschinen.
// DOM-frei testbar; geo-dt-absenkung wird nur gelesen, wenn ein document existiert.
export function _kaelteQuelleTemp(quelleKey, tAussen, t) {
  if (quelleKey === 'lwwp' || quelleKey === 'luft') return tAussen;
  if (quelleKey === 'fg') {
    const d = Math.floor(t / 24);
    return Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (d - 119) / DAYS_PER_YEAR));
  }
  // Geothermie: Erdreich ~10 °C ±2 K, ggf. Entzugsabsenkung aus Fachplanung
  const d = Math.floor(t / 24);
  let dt = 0;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('geo-dt-absenkung');
    if (el) dt = parseFloat(el.value) || 0;
  }
  return 10 + 2 * Math.sin(2 * Math.PI * (d - 75) / DAYS_PER_YEAR) - dt;
}

export function _rueckkuehlTemp(modus, quelleKey, tAussen, t, approachLuft = 0) {
  if (modus === 'quelle') return _kaelteQuelleTemp(quelleKey, tAussen, t);
  return tAussen + approachLuft;
}

// ── EER (Carnot, Kühlbetrieb) ─────────────────────────────────────────────
// EER = min( η_K · T_KW / (T_RW − T_KW) , cap )  — Kelvin
export function calcEER(tKwC, tRwC, guetegradK, cap = 10) {
  const tKwK = tKwC + 273.15;
  const tRwK = tRwC + 273.15;
  const hub = Math.max(tRwK - tKwK, 0.1);
  return Math.min((tKwK / hub) * guetegradK, cap);
}

// Referenz-EER bei Eurovent A35/W7 (für Nennleistungs-Derating)
export function eerRef(guetegradK) {
  return calcEER(7, 35, guetegradK, Infinity); // (280,15/28)·η ≈ 10,0·η
}

// ── Kältelast-Synthese (8.760 h) ──────────────────────────────────────────
// Kühlgradstunden-Ansatz, Spiegelbild zur Heizlast-Synthese (calcLastgang):
//   - Tagesmittel der Außentemperatur → Kühlgrad max(0, T_mittel − Kühlgrenze)
//   - Verteilung über 24-h-Schablone mit Nachmittags-Peak
//   - Skalierung auf vorgegebene Jahres-Kältemenge (MWh/a)
// Rückgabe: Float32Array Kältelast in kW je Stunde.
export function synthKaelteLastgang(tempH, kuehlgrenzeC, jahresKaelteMwh) {
  const n = tempH.length, nd = Math.floor(n / 24);
  const out = new Float32Array(n);
  if (!(jahresKaelteMwh > 0) || nd === 0) return out;

  // Tagesmittel + Kühlgrade
  const cd = new Float32Array(nd);
  let cdSum = 0;
  for (let d = 0; d < nd; d++) {
    let s = 0;
    for (let h = 0; h < 24; h++) s += tempH[d * 24 + h];
    const tm = s / 24;
    cd[d] = Math.max(0, tm - kuehlgrenzeC);
    cdSum += cd[d];
  }
  if (cdSum <= 0) return out; // kein Kühlbedarf im Klima

  const schSum = SCHABLONE_24H_KAELTE.reduce((a, b) => a + b, 0);
  const shape = new Float32Array(n);
  let shapeSum = 0;
  for (let d = 0; d < nd; d++) {
    const tagAnteil = cd[d] / cdSum;
    for (let h = 0; h < 24 && d * 24 + h < n; h++) {
      const v = tagAnteil * (SCHABLONE_24H_KAELTE[h] / schSum);
      shape[d * 24 + h] = v;
      shapeSum += v;
    }
  }
  const eKwh = jahresKaelteMwh * 1000;
  if (shapeSum > 0) for (let i = 0; i < n; i++) out[i] = shape[i] / shapeSum * eKwh; // kWh/h = kW
  return out;
}

// Monatsskalierung (optional): verteilt Jahresmenge gemäß Monatswerten um.
export function kaelteMonatsfloor(lastKw, monatswerteMwh) {
  const n = lastKw.length, nd = Math.floor(n / 24);
  const tpm = [31, nd > 365 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = new Float32Array(lastKw);
  let h = 0;
  for (let m = 0; m < 12; m++) {
    const nH = tpm[m] * 24;
    if (monatswerteMwh[m] != null) {
      let s = 0;
      for (let i = h; i < h + nH && i < n; i++) s += out[i];
      if (s > 0) {
        const f = (monatswerteMwh[m] * 1000) / s;
        for (let i = h; i < h + nH && i < n; i++) out[i] *= f;
      }
    }
    h += nH;
  }
  return out;
}

// ── Kälte-Dispatch (8.760 h) ──────────────────────────────────────────────
// cfg:
//   lastKw   : Float32Array  — Kältelast [kW]
//   tempH    : Float32Array  — Außentemperatur [°C]
//   tKwC     : number        — Kaltwasser-Vorlauf [°C]
//   erzList  : [{
//     key, art:'reversibel'|'chiller',
//     leistKw, guetegradK,
//     rueckkuehlModus:'luft'|'quelle', quelleKey, approachLuft,
//     freecool:bool, freecoolDtMin, eerFreecool
//   }, ...]            — Reihenfolge = Merit-Order (freie Kühlung greift implizit zuerst)
//   recordHourly : bool
// Rückgabe: { kaelteKwh, stromKwh, …, seerGesamt, monthlyEer, restKwh }
export function kaelteDispatch8760(cfg) {
  const { lastKw, tempH, tKwC, erzList, recordHourly } = cfg;
  const n = lastKw.length;

  const eerRefByKey = {};
  const res = {
    kaelteKwh: {}, stromKwh: {}, kaelteKwhM: {}, stromKwhM: {},
    freecoolKwh: {}, restKwh: 0,
    hourly: recordHourly ? {} : null,
    stromH: recordHourly ? new Float32Array(n) : null,
    eerH: recordHourly ? {} : null,
  };
  for (const e of erzList) {
    eerRefByKey[e.key] = eerRef(e.guetegradK) || 1;
    res.kaelteKwh[e.key] = 0; res.stromKwh[e.key] = 0; res.freecoolKwh[e.key] = 0;
    res.kaelteKwhM[e.key] = new Float32Array(12);
    res.stromKwhM[e.key] = new Float32Array(12);
    if (recordHourly) { res.hourly[e.key] = new Float32Array(n); res.eerH[e.key] = new Float32Array(n); }
  }

  let curMonth = 0;
  for (let t = 0; t < n; t++) {
    if (curMonth < 11 && t >= MONTH_START_H[curMonth + 1]) curMonth++;
    let rest = lastKw[t];
    if (rest <= 0.0001) continue;

    for (const e of erzList) {
      if (rest <= 0.0001) break;
      if (e.leistKw <= 0) continue;

      const tRw = _rueckkuehlTemp(e.rueckkuehlModus, e.quelleKey, tempH[t], t, e.approachLuft || 0);
      const tQ = e.rueckkuehlModus === 'quelle' ? tRw : null;
      const freecoolActive = e.freecool && tQ != null && tQ <= tKwC - (e.freecoolDtMin ?? 2);

      let eer, erreichbarKw;
      if (freecoolActive) {
        eer = e.eerFreecool ?? 20;          // nur Pumpenstrom
        erreichbarKw = e.leistKw;            // volle Übertragerleistung
      } else {
        eer = calcEER(tKwC, tRw, e.guetegradK);
        erreichbarKw = e.leistKw * (eer / eerRefByKey[e.key]);
      }

      const pK = Math.min(erreichbarKw, rest);
      if (pK <= 0.0001) continue;
      rest -= pK;

      res.kaelteKwh[e.key] += pK;
      res.kaelteKwhM[e.key][curMonth] += pK;
      const el = eer > 0 ? pK / eer : 0;
      res.stromKwh[e.key] += el;
      res.stromKwhM[e.key][curMonth] += el;
      if (freecoolActive) res.freecoolKwh[e.key] += pK;
      if (recordHourly) {
        res.hourly[e.key][t] = pK;
        res.eerH[e.key][t] = eer;
        res.stromH[t] += el;
      }
    }
    res.restKwh += rest; // ungedeckte Kältelast (Spitzen)
  }

  // SEER je Erzeuger + gesamt
  res.seer = {};
  let kTot = 0, elTot = 0;
  for (const e of erzList) {
    const k = res.kaelteKwh[e.key], el = res.stromKwh[e.key];
    res.seer[e.key] = el > 0 ? k / el : 0;
    kTot += k; elTot += el;
  }
  res.kaelteTotKwh = kTot;
  res.stromTotKwh = elTot;
  res.seerGesamt = elTot > 0 ? kTot / elTot : 0;
  res.monthlyEer = Array.from({ length: 12 }, (_, m) => {
    let k = 0, el = 0;
    for (const e of erzList) { k += res.kaelteKwhM[e.key][m]; el += res.stromKwhM[e.key][m]; }
    return el > 0 ? k / el : 0;
  });
  return res;
}

// ════════════════════════════════════════════════════════════════════════
// DOM-Orchestrierung (Panel „Kälteversorgung")
// ════════════════════════════════════════════════════════════════════════

function _num(id, def = 0) {
  const el = document.getElementById(id);
  if (!el) return def;
  const v = parseFloat(el.value);
  return isNaN(v) ? def : v;
}
function _checked(id) { return !!document.getElementById(id)?.checked; }
function _set(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

export function toggleKaeltePanel() {
  const p = document.getElementById('kaelte-panel');
  if (!p) return;
  p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
  if (p.style.display === 'block') updateKaelte();
}

// Last-Eingabemodus umschalten (Direkt MWh/a ↔ flächenbasiert)
export function kaelteLastModeChanged() {
  const mode = document.getElementById('kaelte-last-mode')?.value || 'direkt';
  const dir = document.getElementById('kaelte-last-direkt-wrap');
  const fl = document.getElementById('kaelte-last-flaeche-wrap');
  if (dir) dir.style.display = mode === 'direkt' ? '' : 'none';
  if (fl) fl.style.display = mode === 'flaeche' ? '' : 'none';
  updateKaelte();
}

// Nutzungstyp gewählt → spez. Kältebedarf vorbelegen
export function kaelteNutzungChanged() {
  const typ = document.getElementById('kaelte-nutzung')?.value;
  const def = KAELTE_DEFAULTS[typ];
  if (def) { const el = document.getElementById('kaelte-spez'); if (el) el.value = def.spez; }
  updateKaelte();
}

// Reversible WP an Wärme-WP gekoppelt → Nennleistung der Wärme-WP übernehmen
function _waermeWpLeistung(quelleKey) {
  if (quelleKey === 'luft') return _num('lwwp-leistung', 0);
  if (quelleKey === 'fg')   return _num('fg-leistung', 0);
  if (quelleKey === 'geo')  return _num('geo-leistung-eff', 0) || _num('geo-leistung', 0);
  return 0;
}

// Jahres-Kältemenge (MWh/a) aus dem gewählten Eingabemodus
function _kaelteJahresMwh() {
  const mode = document.getElementById('kaelte-last-mode')?.value || 'direkt';
  if (mode === 'flaeche') {
    const flaeche = _num('kaelte-flaeche', 0);
    const spez = _num('kaelte-spez', 0);
    return flaeche * spez / 1000; // m² × kWh/m²a → MWh/a
  }
  return _num('kaelte-mwh', 0);
}

// Erzeuger-Liste aus den UI-Slots aufbauen
function _kaelteReadErzList() {
  const list = [];
  const mkQuelle = (sel) => sel === 'luft'
    ? { rueckkuehlModus: 'luft', quelleKey: 'luft' }
    : { rueckkuehlModus: 'quelle', quelleKey: sel }; // 'fg' | 'geo'

  if (_checked('kaelte-revwp-on')) {
    const quelle = document.getElementById('kaelte-revwp-quelle')?.value || 'luft';
    const auto = _checked('kaelte-revwp-auto');
    const leistKw = auto ? _waermeWpLeistung(quelle) : _num('kaelte-revwp-kw', 0);
    list.push({
      key: 'revwp', art: 'reversibel', label: 'Reversible WP',
      leistKw, guetegradK: _num('kaelte-revwp-gg', 0.38), color: '#4dd0e1',
      ...mkQuelle(quelle),
      approachLuft: quelle === 'luft' ? _num('kaelte-revwp-approach', 5) : 0,
      freecool: quelle !== 'luft' && _checked('kaelte-revwp-freecool'),
      freecoolDtMin: _num('kaelte-freecool-dt', 2),
      eerFreecool: _num('kaelte-freecool-eer', 20),
      auto,
    });
  }
  if (_checked('kaelte-chiller-on')) {
    const quelle = document.getElementById('kaelte-chiller-quelle')?.value || 'luft';
    list.push({
      key: 'chiller', art: 'chiller', label: 'Kältemaschine',
      leistKw: _num('kaelte-chiller-kw', 0), guetegradK: _num('kaelte-chiller-gg', 0.40), color: '#0288d1',
      ...mkQuelle(quelle),
      approachLuft: quelle === 'luft' ? _num('kaelte-chiller-approach', 5) : 0,
      freecool: quelle !== 'luft' && _checked('kaelte-chiller-freecool'),
      freecoolDtMin: _num('kaelte-freecool-dt', 2),
      eerFreecool: _num('kaelte-freecool-eer', 20),
    });
  }
  return list;
}

// Hauptberechnung + Render. Speichert window.kaelteState für Integration.
export function updateKaelte() {
  const panel = document.getElementById('kaelte-panel');
  if (!panel || panel.style.display === 'none') return;

  const ss = window.systemState;
  const hint = document.getElementById('kaelte-hint');
  if (!ss || !ss.tempH) {
    if (hint) { hint.style.display = 'block'; hint.textContent = '⚡ Zuerst „Grundlage berechnen" – Temperaturprofil wird für die Kältelast benötigt.'; }
    _renderKaelteResults(null);
    return;
  }
  if (hint) hint.style.display = 'none';

  const jahresMwh = _kaelteJahresMwh();
  const kuehlgrenze = _num('kaelte-kuehlgrenze', 12);
  const tKwC = _num('kaelte-kw-vl', 7);
  const erzList = _kaelteReadErzList();

  const lastKw = synthKaelteLastgang(ss.tempH, kuehlgrenze, jahresMwh);
  let peakKw = 0; for (let i = 0; i < lastKw.length; i++) if (lastKw[i] > peakKw) peakKw = lastKw[i];

  const res = (erzList.length && jahresMwh > 0)
    ? kaelteDispatch8760({ lastKw, tempH: ss.tempH, tKwC, erzList, recordHourly: true })
    : null;

  window.kaelteState = res ? {
    jahresMwh, kuehlgrenze, tKwC, peakKw,
    erzList, lastKw,
    kaelteTotMwh: res.kaelteTotKwh / 1000,
    stromTotMwh: res.stromTotKwh / 1000,
    seerGesamt: res.seerGesamt,
    stromH: res.stromH,
    restMwh: res.restKwh / 1000,
    freecoolMwh: erzList.reduce((s, e) => s + (res.freecoolKwh[e.key] || 0), 0) / 1000,
    perErz: erzList.map(e => ({
      key: e.key, label: e.label, art: e.art, auto: e.auto,
      quelleKey: e.quelleKey, rueckkuehlModus: e.rueckkuehlModus,
      leistKw: e.leistKw, guetegradK: e.guetegradK,
      kaelteMwh: res.kaelteKwh[e.key] / 1000,
      stromMwh: res.stromKwh[e.key] / 1000,
      seer: res.seer[e.key],
    })),
    monthlyEer: res.monthlyEer,
    berechnetAm: new Date().toISOString(),
  } : null;

  // Stundenscharfer Kältestrom für spätere PV-/Netz-Kopplung bereitstellen
  window._kaelteElHourly = res ? res.stromH : null;

  if (window.kaelteState) _kaelteEconomics(window.kaelteState, erzList);
  _renderKaelteResults(window.kaelteState);
  // Kältestrom unmittelbar in PV/Batterie/Netzbezug und Lastspitzen nachführen.
  if (typeof window.calcStromPanel === 'function') window.calcStromPanel();
}

// Wirtschaftlichkeit & CO₂ (in sich geschlossen, ohne Eingriff in die Wärme-WGK).
// Reversible WP: nur Reversibilitäts-Aufschlag (€/kW) — die Maschine selbst steckt
// bereits in der Wärme-Investition. Dedizierte Kältemaschine: Vollinvest (€/kW).
function _kaelteEconomics(ks, erzList) {
  const preisCt = _num('strom-preis-bezug', 35);          // ct/kWh
  const zins = _num('kaelte-zins', 4) / 100;
  const emfStrom = (typeof window.stromEmF === 'number') ? window.stromEmF : 363; // g/kWh
  const chillerEurKw = _num('kaelte-invest-chiller', 400);
  const revwpEurKw = _num('kaelte-invest-revwp', 80);

  let invest = 0;
  for (const e of erzList) {
    if (e.leistKw <= 0) continue;
    invest += e.leistKw * (e.art === 'reversibel' ? revwpEurKw : chillerEurKw);
  }
  const n = 20; // Nutzungsdauer Kältetechnik (VDI 2067)
  const annFaktor = zins > 0 ? (zins * Math.pow(1 + zins, n)) / (Math.pow(1 + zins, n) - 1) : 1 / n;
  const wartPct = 0.02; // 2 %/a Wartung+Instandhaltung (kompakter VDI-Ansatz)

  const stromKosten = ks.stromTotMwh * 1000 * preisCt / 100;       // €/a
  const kapitalKosten = invest * annFaktor;                       // €/a
  const wartung = invest * wartPct;                               // €/a
  const jahreskosten = stromKosten + kapitalKosten + wartung;     // €/a
  const wgkKaelte = ks.kaelteTotMwh > 0 ? jahreskosten / ks.kaelteTotMwh / 10 : 0; // ct/kWh_kälte
  const co2t = ks.stromTotMwh * 1000 * emfStrom / 1e6;            // t CO₂/a

  ks.invest = invest;
  ks.stromKostenEur = stromKosten;
  ks.jahreskostenEur = jahreskosten;
  ks.wgkKaelteCt = wgkKaelte;
  ks.co2TonnenA = co2t;
}

function _renderKaelteResults(ks) {
  if (!ks) {
    ['kaelte-res-seer', 'kaelte-res-kaelte', 'kaelte-res-strom', 'kaelte-res-rest', 'kaelte-res-freecool',
     'kaelte-res-invest', 'kaelte-res-stromkosten', 'kaelte-res-wgk', 'kaelte-res-co2'].forEach(id => _set(id, '—'));
    const wrap = document.getElementById('kaelte-eer-wrap'); if (wrap) wrap.style.display = 'none';
    const ebd = document.getElementById('kaelte-erz-breakdown'); if (ebd) ebd.innerHTML = '';
    return;
  }
  const f1 = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const f0 = (v) => Math.round(v).toLocaleString('de-DE');
  _set('kaelte-res-seer', ks.seerGesamt > 0 ? ks.seerGesamt.toFixed(2) : '—');
  _set('kaelte-res-kaelte', f1(ks.kaelteTotMwh) + ' MWh/a');
  _set('kaelte-res-strom', f1(ks.stromTotMwh) + ' MWh/a');
  _set('kaelte-res-rest', ks.restMwh > 0.05 ? '⚠ ' + f1(ks.restMwh) + ' MWh/a ungedeckt' : '0 (vollständig gedeckt)');
  _set('kaelte-res-freecool', ks.freecoolMwh > 0.05
    ? f1(ks.freecoolMwh) + ' MWh/a (' + (ks.freecoolMwh / ks.kaelteTotMwh * 100).toFixed(0) + ' %)'
    : '—');

  // Wirtschaftlichkeit & CO₂
  if (ks.invest != null) {
    _set('kaelte-res-invest', f0(ks.invest) + ' €');
    _set('kaelte-res-stromkosten', f0(ks.stromKostenEur) + ' €/a');
    _set('kaelte-res-wgk', ks.wgkKaelteCt > 0 ? ks.wgkKaelteCt.toFixed(1) + ' ct/kWh' : '—');
    _set('kaelte-res-co2', f1(ks.co2TonnenA) + ' t/a');
  }

  // Erzeuger-Aufschlüsselung
  const bd = document.getElementById('kaelte-erz-breakdown');
  if (bd) {
    bd.innerHTML = ks.perErz.filter(e => e.kaelteMwh > 0.01).map(e => {
      const q = e.rueckkuehlModus === 'luft' ? 'luftgek.' : (e.quelleKey === 'fg' ? 'Fließgew.' : 'Erdsonde');
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;">
        <span style="color:var(--text);"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${kaelteErzColor(e.key)};margin-right:4px;"></span>${e.label} <span style="color:var(--muted);font-size:9px;">(${q}${e.auto ? ', gekoppelt' : ''})</span></span>
        <span style="font-family:'DM Mono',monospace;">${f1(e.kaelteMwh)} MWh · SEER ${e.seer.toFixed(2)}</span>
      </div>`;
    }).join('') || '<div style="color:var(--muted);font-size:10px;">Kein Kälteerzeuger aktiv.</div>';
  }

  _renderEerChart(ks.monthlyEer);
}

function kaelteErzColor(key) { return key === 'revwp' ? '#4dd0e1' : '#0288d1'; }

// Monats-EER-Chart (Stil identisch zum Wärme-COP-Chart)
export function _renderEerChart(monthlyEer) {
  const wrap = document.getElementById('kaelte-eer-wrap');
  const svgEl = document.getElementById('kaelte-eer-svg');
  if (!wrap || !svgEl) return;
  const maxV = Math.max(...monthlyEer);
  if (maxV < 0.5) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  const W = 300, H = 80, PAD = { l: 24, r: 4, t: 6, b: 16 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
  const yMax = maxV * 1.15;
  const xStep = iW / 12;
  const MONATE = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const color = '#26c6da';

  // Lücken (EER=0, kein Bedarf) nicht als Linie auf 0 ziehen → als Punkte zeigen
  let d = '', started = false, pts = '';
  monthlyEer.forEach((c, mi) => {
    const x = PAD.l + (mi + 0.5) * xStep;
    const y = PAD.t + iH - (c / yMax) * iH;
    if (c > 0) {
      d += (started ? 'L' : 'M') + `${x.toFixed(1)},${y.toFixed(1)}`;
      started = true;
      pts += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${color}"/>`;
    } else {
      started = false;
    }
  });
  const yBot = PAD.t + iH;
  let axes = `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${yBot}" stroke="#2a3050" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${yBot}" x2="${PAD.l + iW}" y2="${yBot}" stroke="#2a3050" stroke-width="1"/>`;
  [1, 2, 3].forEach(i => {
    const v = yMax * i / 3;
    const y = PAD.t + iH - (v / yMax) * iH;
    axes += `<line x1="${PAD.l}" y1="${y}" x2="${PAD.l + iW}" y2="${y}" stroke="#2a3050" stroke-width="0.4"/>
      <text x="${PAD.l - 2}" y="${y + 3}" text-anchor="end" fill="#7a8099" font-size="7">${v.toFixed(1)}</text>`;
  });
  MONATE.forEach((m, mi) => {
    axes += `<text x="${(PAD.l + (mi + 0.5) * xStep).toFixed(1)}" y="${yBot + 11}" text-anchor="middle" fill="#7a8099" font-size="7">${m}</text>`;
  });
  svgEl.innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>${pts}${axes}`;
}

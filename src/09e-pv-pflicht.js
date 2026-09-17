// ── 09e-pv-pflicht.js — Landesrechtliche PV-Pflicht: App-Schicht und Übersicht ──
//
// Gerechnet wird in lib/pv-pflicht.js (DOM-frei, getestet), die Länderdaten stehen
// in config/pv-pflicht-laender.js. Hier steht alles, was das Gebäudemodell und die
// Oberfläche betrifft: Aufbereitung der Gebäude, Bestimmung des Bundeslandes, die
// Gebäude-Übersicht und die kurze §-Zeile für Gebäudekarte und PV-Modus.
//
// WARUM DIE PFLICHT GEBÄUDESCHARF BLEIBT: § 32a BbgBO & Co. verpflichten das
// einzelne Gebäude, nicht die Liegenschaft. Eine Summe über das Quartier kann
// deshalb „erfüllt" aussehen, während einzelne Dächer unterbelegt sind — und
// umgekehrt. Die Übersicht (pvPflichtUebersichtOeffnen) ist der Ort, an dem sich
// Soll und geplante Auslegung je Gebäude gegenüberstehen.
//
// UNABHÄNGIG VOM JAHRES-SLIDER: Der auslösende Fall wird gegen das ECHTE
// Kalenderjahr geprüft, nicht gegen globalYear. Sonst hinge die Pflichtleistung
// daran, wohin der Betrachtungsjahr-Regler gerade geschoben ist — ein Gebäude ist
// aber ein geplanter Neubau, egal welches Jahr man gerade ansieht.

import { gebaeude, isExcluded } from './01-globals-varianten.js';
import { getNutzungstypById } from './02b-gebaeude.js';
import { _pvWpM2Global, calcGebKwp, escHtml, getDachDefaultNeigung, pvNettoFlaeche } from './03c-gebaeude-io.js';
import { getAssetsForBuilding } from './13a-assets-core.js';
import { EIGNUNG_PAUSCHAL_PCT, PV_PFLICHT_LISTE, PV_PFLICHT_META } from './config/pv-pflicht-laender.js';
import { detectBundesland } from './lib/bundeslaender.js';
import { bezugFlaechenName, bezugFlaechenNameDekliniert, pvPflichtSumme } from './lib/pv-pflicht.js';

const LILA = '#9575cd';
const LILA_HELL = '#b39ddb';

/** Auswahl für den Pflichtfall je Gebäude. '' = automatisch erkennen. */
export const PFLICHT_FALL_OPTIONEN = Object.freeze([
  { wert: '',              label: 'automatisch' },
  { wert: 'neubau',        label: 'Neubau' },
  { wert: 'dachsanierung', label: 'Dachsanierung' },
  { wert: 'keine',         label: 'nicht pflichtig' },
]);

// ══════════════════════════════════════════════════════════════════════════════
// AUFBEREITUNG
// ══════════════════════════════════════════════════════════════════════════════

/** Bundesland: Handauswahl im PVA-Panel hat Vorrang, sonst aus dem Schwerpunkt der Gebäude. */
export function pvPflichtLandId() {
  const gewaehlt = window._pvAnalyse?.pflichtLand;
  if (gewaehlt) return gewaehlt;
  let lat = 0, lon = 0, n = 0;
  for (const g of (gebaeude || [])) {
    const la = Number.isFinite(g.lat) ? g.lat : g.polygon?.[0]?.[0];
    const lo = Number.isFinite(g.lng) ? g.lng : g.polygon?.[0]?.[1];
    if (Number.isFinite(la) && Number.isFinite(lo)) { lat += la; lon += lo; n++; }
  }
  return n > 0 ? detectBundesland(lat / n, lon / n) : null;
}

/**
 * Geplante Leistung eines Gebäudes für die PFLICHTPRÜFUNG — die Modul-Nennleistung.
 *
 * Das Landesrecht verlangt Modulfläche bzw. installierte Leistung, nicht Ertrag.
 * Das PV-Asset trägt dagegen die ausrichtungskorrigierte Leistung: overwritePvAsset
 * schreibt calcGebKwpKorr, also Nennleistung × Ausrichtungsfaktor. Ein Ost-West-
 * oder Norddach stünde damit bei der Pflichtprüfung schlechter da, als es rechtlich
 * ist. Deshalb hat das Dachmodell (calcGebKwp = platzierte Module × Modul-Wp)
 * Vorrang; das Asset zählt nur, wenn es die einzige Quelle ist.
 *
 * Folge: Die Summe hier kann vom „Anlagenpotenzial" im PVA-Panel abweichen — das
 * rechnet bewusst mit den korrigierten Asset-Werten weiter, weil daraus Ertrag und
 * Wirtschaftlichkeit folgen. Die Übersicht weist die Differenz je Gebäude aus.
 *
 * @param {any} g
 * @returns {{ kwp: number, quelle: 'dach'|'asset'|'keine', dachKwp: number, assetKwp: number|null }}
 */
export function pvGeplantDetail(g) {
  const pv = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
  const assetKwp = pv ? (parseFloat(pv.props?.leistungKWp) || 0) : null;
  const dachKwp  = g.pvAktiv ? (calcGebKwp(g) || 0) : 0;
  if (dachKwp > 0)        return { kwp: dachKwp, quelle: 'dach', dachKwp, assetKwp };
  if (assetKwp != null)   return { kwp: assetKwp, quelle: 'asset', dachKwp: 0, assetKwp };
  return { kwp: 0, quelle: 'keine', dachKwp: 0, assetKwp: null };
}

/** Nennleistung eines Gebäudes für die Pflichtprüfung. @param {any} g */
export function pvGeplanteKwp(g) {
  return pvGeplantDetail(g).kwp;
}

/**
 * Gebäude für den Pflicht-Rechenkern aufbereiten.
 *
 * Auslösender Fall, in dieser Reihenfolge:
 *   1. Handeingabe am Gebäude (g.pvPflichtFall) — schlägt alles
 *   2. Neubau        — baujahr liegt in der Zukunft (savePlan 'neubau')
 *   3. Dachsanierung — Sanierungseintrag, der ausdrücklich das Dach betrifft
 *                      (sa.dach). Ohne dieses Merkmal ist eine energetische
 *                      Sanierung nicht von einer Dachsanierung unterscheidbar.
 */
export function pvPflichtGebaeudeliste() {
  const heute = new Date().getFullYear();
  const liste = [];
  for (const g of (gebaeude || [])) {
    if (isExcluded(g.id)) continue;
    if (g.abrissjahr && g.abrissjahr <= heute) continue;   // heute schon abgerissen
    const typ = getNutzungstypById(g.nutzungstyp);
    const dachSan = (g.sanierungen || []).find(sa => sa?.dach === true);
    liste.push({
      id: g.id,
      name: g.name || g.gebaeudenummer || `Gebäude ${g.id}`,
      grundflaecheM2: parseFloat(g.flaeche) || 0,
      dachNeigung:    g.dachNeigung ?? getDachDefaultNeigung(g.dachform || 'sattel'),
      wohnen:         typ?.gruppe === 'Wohnen',
      geeignetM2:     pvNettoFlaeche(g),
      nutzflaecheM2:  (parseFloat(g.flaeche) || 0) * (parseInt(g.stockwerke) || typ?.stockwerke || 1),
      neubau:         Number.isFinite(g.baujahr) && g.baujahr > heute,
      dachsanierung:  !!dachSan,
      sanAnteilPct:   dachSan?.dachAnteilPct ?? null,
      istKwp:         pvGeplanteKwp(g),
      pflichtFall:    g.pvPflichtFall || '',
    });
  }
  return liste;
}

/** Aktuelle Pflichtlage des Projekts — Ergebnis von pvPflichtSumme. */
export function pvPflichtAktuell() {
  const s = window._pvAnalyse || {};
  return pvPflichtSumme(pvPflichtGebaeudeliste(), pvPflichtLandId(), {
    wpProM2: _pvWpM2Global(),
    annahme: s.pflichtAnnahme || 'auto',
    eignungPauschalPct: EIGNUNG_PAUSCHAL_PCT,
  });
}

/** Pflichtlage eines einzelnen Gebäudes (oder null, wenn es nicht erfasst ist). */
export function pvPflichtFuerGebaeude(gebId) {
  const pf = pvPflichtAktuell();
  return [...pf.faelle, ...pf.ohneFall].find(f => f.id === gebId) || null;
}

/** Pflichtfall am Gebäude setzen — aus der Übersicht heraus. */
export function pvPflichtFallSetzen(gebId, wert) {
  const g = (gebaeude || []).find(x => x.id === gebId);
  if (!g) return;
  if (wert) g.pvPflichtFall = wert; else delete g.pvPflichtFall;
  window.pvMarkStale?.();
  pvPflichtUebersichtRender();
  window.pvPflichtRefresh?.();
  window.renderList?.();
}

// ══════════════════════════════════════════════════════════════════════════════
// KURZE §-ZEILE — Gebäudekarte (03c) und PV-Modus (25)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Einzeiler für ein Gebäude: Soll, Ist und Abstand. Leer, wenn für dieses Gebäude
 * keine Pflicht greift — die Karte soll nicht mit Nicht-Fällen zugestellt werden.
 * @param {number} gebId
 * @returns {string} HTML
 */
export function pvPflichtBadgeHtml(gebId) {
  const pf = pvPflichtAktuell();
  if (!pf.aktiv || !pf.regel?.pflicht) return '';
  const f = pf.faelle.find(x => x.id === gebId);
  if (!f) return '';

  const norm = escHtml(pf.regel.norm || '');
  if (!pf.bezifferbar) {
    return `<div style="margin-top:6px;padding:4px 7px;border-radius:4px;font-size:9px;line-height:1.5;
      background:rgba(149,117,205,0.10);border:1px solid rgba(149,117,205,0.3);color:${LILA_HELL};">
      § pflichtig nach ${norm} — Landesrecht nennt keinen Flächenanteil</div>`;
  }

  const farbe = f.erfuellt ? '#66bb6a' : '#ef5350';
  const text  = f.erfuellt
    ? `erfüllt (+${Math.abs(f.deltaKwp).toFixed(1)} kWp)`
    : `es fehlen ${Math.abs(f.deltaKwp).toFixed(1)} kWp`;
  return `<div style="margin-top:6px;padding:4px 7px;border-radius:4px;font-size:9px;line-height:1.5;
    background:rgba(149,117,205,0.10);border:1px solid rgba(149,117,205,0.3);"
    title="${escHtml(f.rechenweg)}">
    <span style="color:${LILA_HELL};">§ ${norm}</span>
    <span style="color:var(--muted);"> · Soll </span><span style="color:${LILA_HELL};font-weight:600;">${f.kwp.toFixed(1)} kWp</span>
    <span style="color:var(--muted);"> · geplant </span><span style="color:#ffd54f;" title="Modul-Nennleistung — für die Pflicht zählt die Modulfläche, nicht der Ertrag">${f.istKwp.toFixed(1)} kWp<span style="color:var(--muted);font-size:8px;"> Nennl.</span></span>
    <br><span style="color:${farbe};font-weight:600;">${text}</span>
    <span style="color:#607d8b;"> — ${escHtml(f.rechenweg)}</span>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// INFOZEILE IM PVA-PANEL
// ══════════════════════════════════════════════════════════════════════════════

/** Infozeile unter der Länderauswahl — Sollleistung oder der Grund, warum es keine gibt. */
export function pvPflichtInfoHtml() {
  const pf = pvPflichtAktuell();
  const rahmen = (farbe, inhalt) =>
    `<div style="font-size:10px;line-height:1.55;color:${farbe};">${inhalt}</div>`;

  if (!pf.aktiv || !pf.regel) return rahmen('#78909c', escHtml(pf.grund || 'Kein Bundesland bestimmt.'));
  if (!pf.regel.pflicht)      return rahmen('#78909c', escHtml(pf.grund));
  if (!pf.faelle.length) {
    return rahmen('#78909c', `${escHtml(pf.regel.land)} · ${escHtml(pf.regel.norm)}<br>${escHtml(pf.grund)}`);
  }

  const knopf = `<button class="btn-xs" style="width:100%;margin-top:6px;border-color:${LILA};color:${LILA_HELL};"
    data-click="pvPflichtUebersichtOeffnen()"
    title="Soll und geplante Auslegung je Gebäude — die Pflicht gilt je Gebäude, nicht für die Liegenschaft">▦ Gebäude-Übersicht</button>`;

  if (!pf.bezifferbar) {
    return rahmen('#ffb74d', `${escHtml(pf.regel.norm)}: ${pf.faelle.length} pflichtige Gebäude, `
      + 'aber kein Flächenanteil im Landesrecht beziffert — die Variante liefert keine Leistung.') + knopf;
  }

  const zaehl = (fall) => pf.faelle.filter(f => f.fall === fall).length;
  const faelleTxt = [
    zaehl('neubau')        ? `${zaehl('neubau')}× Neubau` : '',
    zaehl('dachsanierung') ? `${zaehl('dachsanierung')}× Dachsanierung` : '',
    zaehl('angenommen')    ? `${zaehl('angenommen')}× angenommen` : '',
  ].filter(Boolean).join(' · ');
  const unterdeckt = pf.faelle.filter(f => !f.erfuellt).length;

  return `
    <div style="display:flex;align-items:baseline;gap:7px;">
      <span style="font-family:'DM Mono',monospace;font-size:15px;color:${LILA_HELL};">${pf.kwp.toFixed(0)}</span>
      <span style="font-size:10px;color:var(--muted);">kWp Pflicht · ${escHtml(pf.regel.kurz)} ${escHtml(pf.regel.norm)}</span>
    </div>
    <div style="font-size:10px;color:#78909c;line-height:1.55;margin-top:2px;">
      ${escHtml(faelleTxt)} · ${pf.regel.anteilPct.toFixed(0)} % der ${escHtml(bezugFlaechenNameDekliniert(pf.regel))}
      <br>geplant an diesen Gebäuden: <span style="color:#ffd54f;">${pf.istKwp.toFixed(0)} kWp</span>
      ${unterdeckt
        ? ` · <span style="color:#ef5350;font-weight:600;">${unterdeckt} Gebäude unter Soll</span>`
        : ' · <span style="color:#66bb6a;">alle Gebäude erfüllen ihr Soll</span>'}
      ${pf.regel.anteilHerkunft === 'verordnung' ? '<br><span style="color:#ffb74d;">Anteil aus der Rechtsverordnung — vor Nutzung prüfen.</span>' : ''}
      ${pf.annahmen.length ? `<br>${escHtml(pf.annahmen[0])}` : ''}
      <br>Stand ${escHtml(PV_PFLICHT_META.stand)} · keine Rechtsberatung
    </div>
    ${knopf}`;
}

/** Infozeile nach Änderung von Land oder Annahme neu zeichnen. */
export function pvPflichtRefresh() {
  const el = document.getElementById('pva-pflicht-info');
  if (el) el.innerHTML = pvPflichtInfoHtml();
}

// ══════════════════════════════════════════════════════════════════════════════
// GEBÄUDE-ÜBERSICHT
// ══════════════════════════════════════════════════════════════════════════════

const MODAL_ID = 'pv-pflicht-modal';

/** @type {HTMLElement|null} */
let _modal = null;

export function pvPflichtUebersichtOeffnen() {
  if (!_modal) {
    _modal = document.createElement('div');
    _modal.id = MODAL_ID;
    _modal.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(8,12,24,0.97);'
      + 'display:none;align-items:flex-start;justify-content:center;';
    _modal.innerHTML =
      '<div style="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;'
      + 'padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">'
      + `<span style="font-size:13px;font-weight:600;color:${LILA_HELL};">§ PV-Pflicht je Gebäude</span>`
      + '<span id="pv-pflicht-x" style="cursor:pointer;font-size:22px;color:#90a4ae;padding:4px 10px;line-height:1;user-select:none;">✕</span></div>'
      + '<div id="pv-pflicht-body" style="width:96vw;max-width:1500px;margin-top:56px;max-height:calc(100vh - 70px);overflow:auto;padding:8px 0 40px 0;"></div>';
    document.body.appendChild(_modal);
    _modal.querySelector('#pv-pflicht-x')?.addEventListener('click', pvPflichtUebersichtSchliessen);
    _modal.addEventListener('click', (e) => { if (e.target === _modal) pvPflichtUebersichtSchliessen(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') pvPflichtUebersichtSchliessen();
    });
  }
  _modal.style.display = 'flex';
  pvPflichtUebersichtRender();
}

export function pvPflichtUebersichtSchliessen() {
  if (_modal) _modal.style.display = 'none';
}

/** Tabelle neu zeichnen (auch nach Änderung eines Pflichtfalls). */
export function pvPflichtUebersichtRender() {
  const body = document.getElementById('pv-pflicht-body');
  if (!body || _modal?.style.display === 'none') return;
  body.innerHTML = _uebersichtHtml();
}

function _uebersichtHtml() {
  const pf  = pvPflichtAktuell();
  const nf  = (v, d = 0) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE',
    { minimumFractionDigits: d, maximumFractionDigits: d });

  if (!pf.aktiv || !pf.regel) {
    return `<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">${escHtml(pf.grund || 'Kein Bundesland bestimmt.')}</div>`;
  }
  if (!pf.regel.pflicht) {
    return `<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">${escHtml(pf.grund)}</div>`;
  }

  const r = pf.regel;
  const alle = [...pf.faelle, ...pf.ohneFall];
  const unterdeckt = pf.faelle.filter(f => !f.erfuellt);

  // ── Kopf: die Regel im Klartext, damit der Rechenweg ohne Nachschlagen lesbar ist ──
  const kopf = `
  <div style="margin:0 0 12px 0;padding:11px 14px;border-radius:7px;
       background:rgba(149,117,205,0.08);border:1px solid rgba(149,117,205,0.3);font-size:11px;line-height:1.7;">
    <div style="font-weight:600;color:${LILA_HELL};font-size:12px;">${escHtml(r.land)} · ${escHtml(r.norm)}</div>
    <div style="color:var(--muted);">
      Pflicht je Gebäude: <b style="color:var(--text);">${nf(r.anteilPct)} % der ${escHtml(bezugFlaechenNameDekliniert(r))}</b>
      als Modulfläche, umgerechnet mit <b style="color:var(--text);">${nf(_pvWpM2Global())} W/m²</b> Modulleistung
      ${r.minDachM2 ? ` · erst ab ${nf(r.minDachM2)} m² Dachfläche` : ''}
      ${r.minNutzflaecheM2 ? ` · erst ab ${nf(r.minNutzflaecheM2)} m² Nutzfläche` : ''}
      ${r.gilt === 'nichtwohn' ? ' · nur Nichtwohngebäude' : ''}
    </div>
    <div style="color:var(--muted);">
      Verglichen wird mit der <b style="color:var(--text);">Modul-Nennleistung</b> aus dem Dachmodell
      (platzierte Module × Modul-Wp), nicht mit der ausrichtungskorrigierten Leistung im PV-Asset —
      das Gesetz fordert Modulfläche, nicht Ertrag. Die Spalte kann deshalb vom Anlagenpotenzial
      im PV-Panel abweichen; wo das vorkommt, steht es in der Zeile.
    </div>
    <div style="color:var(--muted);">
      Bruttodachfläche = Grundfläche ÷ cos(Dachneigung)${r.bezug === 'geeignet'
        ? ` · geeignete Fläche = gezeichnete Belegung − Sperrflächen, ohne Zeichnung pauschal ${EIGNUNG_PAUSCHAL_PCT} % der Bruttodachfläche`
        : ''}
    </div>
    <div style="color:#607d8b;margin-top:3px;">
      Der auslösende Fall wird gegen das laufende Kalenderjahr geprüft, nicht gegen den Jahres-Regler —
      die Pflicht hängt an der Planung, nicht am Betrachtungsjahr. Je Gebäude überschreibbar.
    </div>
    <div style="color:#607d8b;">${escHtml(PV_PFLICHT_META.disclaimer)}</div>
  </div>`;

  // ── Summenzeile ──
  const summe = `
  <div style="display:flex;flex-wrap:wrap;gap:20px;margin-bottom:11px;padding:9px 14px;border-radius:7px;
       background:var(--surface2);border:1px solid var(--border);font-size:11px;">
    <span style="color:var(--muted);">Pflichtige Gebäude <b style="color:var(--text);font-family:'DM Mono',monospace;">${pf.faelle.length}</b></span>
    <span style="color:var(--muted);">Soll gesamt <b style="color:${LILA_HELL};font-family:'DM Mono',monospace;">${nf(pf.kwp, 1)} kWp</b></span>
    <span style="color:var(--muted);" title="Summe der Modul-Nennleistung der pflichtigen Gebäude">geplant gesamt (Nennleistung) <b style="color:#ffd54f;font-family:'DM Mono',monospace;">${nf(pf.istKwp, 1)} kWp</b></span>
    <span style="color:var(--muted);">Bilanz <b style="color:${pf.istKwp >= pf.kwp ? '#66bb6a' : '#ef5350'};font-family:'DM Mono',monospace;">${
      (pf.istKwp - pf.kwp >= 0 ? '+' : '−') + nf(Math.abs(pf.istKwp - pf.kwp), 1)} kWp</b></span>
    ${unterdeckt.length
      ? `<span style="color:#ef5350;font-weight:600;">${unterdeckt.length} Gebäude unter ihrem Soll</span>`
      : '<span style="color:#66bb6a;">jedes Gebäude erfüllt sein Soll</span>'}
  </div>
  <div style="font-size:10.5px;color:#78909c;margin-bottom:9px;line-height:1.6;">
    Die Summe ist nur eine Information: Das Gesetz verpflichtet das einzelne Gebäude.
    Ein Überschuss auf einem Dach verrechnet sich nicht mit einer Unterdeckung auf einem anderen.
  </div>`;

  const th = (label, tip, rechts) =>
    `<th style="padding:5px 7px;text-align:${rechts ? 'right' : 'left'};white-space:nowrap;"${tip ? ` title="${escHtml(tip)}"` : ''}>${label}</th>`;

  let html = kopf + summe + `
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--muted);border-bottom:1px solid var(--border);font-size:10px;">
        ${th('Gebäude')}
        ${th('Pflichtfall', 'Automatisch erkannt oder am Gebäude gesetzt — die Handeingabe schlägt die Erkennung')}
        ${th('Dachfläche', 'Bruttodachfläche = Grundfläche ÷ cos(Neigung)', true)}
        ${th('Bezugsfläche', bezugFlaechenName(r) + ' — Grundlage der Pflichtrechnung', true)}
        ${th('Soll', 'Pflichtleistung dieses Gebäudes', true)}
        ${th('geplant', 'Modul-Nennleistung aus dem Dachmodell — ohne Ausrichtungskorrektur, weil das Gesetz Modulfläche fordert und nicht Ertrag', true)}
        ${th('Δ', 'geplant − Soll', true)}
        ${th('Rechenweg / Grund')}
      </tr>
    </thead>
    <tbody>`;

  for (const f of alle) {
    const pflichtig = f.pflichtig;
    const ok = f.erfuellt;
    const geb = (gebaeude || []).find(x => x.id === f.id);
    const det = geb ? pvGeplantDetail(geb) : { quelle: 'keine', assetKwp: null, dachKwp: 0 };
    // Das PV-Asset trägt die ausrichtungskorrigierte Leistung; hier zählt die
    // Nennleistung. Weicht beides ab, gehört das in die Zeile — sonst wirkt die
    // Summe gegenüber dem Anlagenpotenzial im Panel wie ein Rechenfehler.
    const assetAbweichung = det.quelle === 'dach' && det.assetKwp != null
      && Math.abs(det.assetKwp - det.dachKwp) > 0.5
      ? `PV-Asset trägt ${nf(det.assetKwp, 1)} kWp (ausrichtungskorrigiert) — für die Pflicht zählt die Nennleistung`
      : det.quelle === 'asset'
        ? 'nur PV-Asset vorhanden, kein Dachmodell — Wert ist ausrichtungskorrigiert'
        : '';
    const zeilenBg = !pflichtig ? 'transparent' : ok ? 'rgba(102,187,106,0.05)' : 'rgba(239,83,80,0.07)';
    const td = (inhalt, farbe, rechts) =>
      `<td style="padding:5px 7px;${rechts ? "text-align:right;font-family:'DM Mono',monospace;" : ''}white-space:nowrap;${farbe ? `color:${farbe};` : ''}">${inhalt}</td>`;

    const sel = `<select data-change="pvPflichtFallSetzen(${f.id}, this.value)"
      style="background:var(--surface);color:${f.manuell ? LILA_HELL : 'var(--muted)'};border:1px solid var(--border);
      border-radius:3px;font-size:10px;padding:2px 4px;max-width:130px;">
      ${PFLICHT_FALL_OPTIONEN.map(o => {
        const g = (gebaeude || []).find(x => x.id === f.id);
        const aktuell = g?.pvPflichtFall || '';
        const zusatz = o.wert === '' && !f.manuell
          ? ` (${pflichtig ? (f.fall === 'neubau' ? 'Neubau' : f.fall === 'dachsanierung' ? 'Dachsanierung' : 'angenommen') : 'kein Fall'})`
          : '';
        return `<option value="${o.wert}"${aktuell === o.wert ? ' selected' : ''}>${escHtml(o.label + zusatz)}</option>`;
      }).join('')}
    </select>`;

    html += `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);background:${zeilenBg};">
        ${td(`<span style="color:${pflichtig ? LILA_HELL : '#546e7a'};">§</span> ${escHtml(f.name || ('#' + f.id))}`, 'var(--text)')}
        <td style="padding:5px 7px;">${sel}</td>
        ${td(nf(f.dachM2), 'var(--muted)', true)}
        ${td(pflichtig ? nf(f.bezugsM2) : '—', 'var(--muted)', true)}
        ${td(pflichtig && pf.bezifferbar ? nf(f.kwp, 1) : '—', LILA_HELL, true)}
        ${td(f.istKwp > 0 ? nf(f.istKwp, 1) : '—', f.istKwp > 0 ? '#ffd54f' : '#546e7a', true)}
        ${td(pflichtig && pf.bezifferbar
             ? (f.deltaKwp >= 0 ? '+' : '−') + nf(Math.abs(f.deltaKwp), 1)
             : '—',
             pflichtig && pf.bezifferbar ? (ok ? '#66bb6a' : '#ef5350') : '#546e7a', true)}
        <td style="padding:5px 7px;color:#78909c;font-size:10px;">${
          escHtml(pflichtig ? (f.rechenweg || f.grund) : f.grund)}${
          f.annahmen.length ? `<br><span style="color:#ffb74d;">${escHtml(f.annahmen.join(' · '))}</span>` : ''}${
          assetAbweichung ? `<br><span style="color:#4fc3f7;">${escHtml(assetAbweichung)}</span>` : ''}</td>
      </tr>`;
  }

  html += '</tbody></table>';

  if (unterdeckt.length) {
    html += `
    <div style="margin-top:12px;padding:9px 13px;border-radius:6px;font-size:10.5px;line-height:1.7;
         background:rgba(239,83,80,0.10);border:1px solid rgba(239,83,80,0.35);">
      <b style="color:#ef5350;">${unterdeckt.length} Gebäude unter ihrem Soll.</b>
      <span style="color:var(--muted);">Häufige Ursachen, in dieser Reihenfolge prüfen:</span>
      <ol style="margin:4px 0 0 18px;padding:0;color:#90a4ae;">
        <li>Pflichtiges Gebäude ohne geplante PV — steht hier mit „geplant —".</li>
        <li>Bezugsfläche: ${escHtml(r.land)} rechnet auf die ${escHtml(bezugFlaechenNameDekliniert(r))}.
            ${r.bezug !== 'geeignet'
              ? 'Das ist die GESAMTE Dachfläche, auch die Nordseite und alles, was als Sperrfläche ausgespart ist.'
              : 'Sperrflächen mindern sie also, eine fehlende Zeichnung wird pauschal geschätzt.'}</li>
        <li>Dachmodell und PV-Asset laufen auseinander — die Zeile weist das aus. Für die Pflicht
            zählt die Nennleistung aus dem Dachmodell, für Ertrag und Wirtschaftlichkeit das Asset.</li>
      </ol>
    </div>`;
  }

  (r.hinweise || []).length && (html += `
    <div style="margin-top:10px;font-size:10px;color:#78909c;line-height:1.7;">
      ${(r.hinweise || []).map(h => `• ${escHtml(h)}`).join('<br>')}
    </div>`);

  return html;
}

// ── window-Bridge für data-click/data-change und für Module, die keinen Import
//    auf dieses Modul haben dürfen (03c und 25 würden sonst einen Zyklus bilden) ──
window.pvPflichtAktuell           = pvPflichtAktuell;
window.pvPflichtLandId            = pvPflichtLandId;
window.pvPflichtInfoHtml          = pvPflichtInfoHtml;
window.pvPflichtUebersichtOeffnen = pvPflichtUebersichtOeffnen;
window.pvPflichtFallSetzen        = pvPflichtFallSetzen;
window.pvPflichtBadgeHtml         = pvPflichtBadgeHtml;
window.pvPflichtRefresh           = pvPflichtRefresh;

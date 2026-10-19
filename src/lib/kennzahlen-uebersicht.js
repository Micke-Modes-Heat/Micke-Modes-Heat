// @ts-check
// ── lib/kennzahlen-uebersicht.js — Auswertung › Übersicht: Kacheln Wärme · Strom · übergreifend ──
//
// Rein, ohne DOM (Vitest). Die Oberfläche (51-kennzahlen.js) sammelt fertige Rechenergebnisse ein
// und reicht sie hier herein; hier wird nichts nachgerechnet außer Summen und Anteilen:
//   Wärme       systemState (Bedarf, Spitzenlast), _lastWgk, Einsatzplanung (CO₂, EE-Anteil)
//   Strom       Strombilanz aus calcStromPanel (Netzbezug, Spitze, PV, Eigenverbrauch),
//               Stempel der letzten Elektroberechnung (Trafo _calcPeakLoadPct, Kabel mit _calcJahr)
//   übergreifend Primärenergie und CO₂ der Wärme + Netzstrom der übrigen Verbraucher × Faktor,
//               Investition und Jahreskosten aus calcWirtschaftPanel (VDI 2067)
//
// Zustand je Kachel: ok · veraltet (Ergebnis liegt vor, Planung seitdem geändert) · fehlt (nicht
// gerechnet, mit Sprung zur Stelle, an der gerechnet bzw. eingegeben wird) · leer (nichts geplant).
// „veraltet“ kommt aus uiSchrittStatus (src/49) — derselbe Begriff wie in der Prozessleiste.

/** @typedef {'ok'|'veraltet'|'fehlt'|'leer'} KzZustand */
/** @typedef {'gerechnet'|'veraltet'|'offen'} KzRechenstand */
/**
 * @typedef {Object} KzKachel
 * @property {string} id         Element-ID des Werts ohne Präfix (av-kpi-<id>)
 * @property {string} titel
 * @property {string} tip        Erklärung (Fragezeichen)
 * @property {KzZustand} zustand
 * @property {string} [wert]     formatierter Wert (ok/veraltet)
 * @property {string} [einheit]
 * @property {string} [text]     Ersatztext statt Wert (fehlt/leer)
 * @property {string} [sub]      Zusatzzeile unter dem Wert
 * @property {{label:string, click:string}} [sprung]
 * @property {{pct:number, ziel?:number, warn?:boolean}} [balken]
 * @property {string} [farbe]    Akzent (CSS-Farbe)
 */

/** Sprungziele — data-click-Ausdrücke wie in der übrigen Oberfläche. */
export const KZ_SPRUNG = Object.freeze({
  waermeErzeuger: { label: 'Zur Wärmeplanung', click: "uiSchritt('planung',{sparte:'waerme'}); uiWaermeTab('erzeuger')" },
  waermeGebaeude: { label: 'Zum Bestand', click: "uiSchritt('bestand')" },
  stromPlanung:   { label: 'Zur Stromplanung', click: "uiSchritt('planung',{sparte:'strom'})" },
  stromPv:        { label: 'PV planen', click: "elTab('pv'); uiSchritt('planung',{sparte:'strom'})" },
  elRechnen:      { label: 'Jetzt berechnen', click: 'elCalcAssets(); refreshAnalyseView()' },
  napGrenze:      { label: 'Eintragen', click: 'sgNaOeffnen()' },
  wirtschaft:     { label: 'Zur Wirtschaftlichkeit', click: "setAnalyseSection('wirtschaft')" },
});

const _zahl = v => typeof v === 'number' && Number.isFinite(v);

/** Deutsches Zahlenformat. */
export function kzNum(v, d = 0) {
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Euro kompakt: 1,40 Mio. € · 520 T€ · 900 €. */
export function kzEuro(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return { wert: kzNum(v / 1e6, 2), einheit: 'Mio. €' };
  if (a >= 1e4) return { wert: kzNum(v / 1e3, 0), einheit: 'T€' };
  return { wert: kzNum(v, 0), einheit: '€' };
}

/** Zustand einer Kachel aus dem Rechenstand ihrer Quelle. */
const _zustand = stand => (stand === 'veraltet' ? 'veraltet' : 'ok');

const _fehlt = (k, text, sprung) => ({ ...k, zustand: /** @type {KzZustand} */ ('fehlt'), text, sprung });
const _leer  = (k, text, sprung) => ({ ...k, zustand: /** @type {KzZustand} */ ('leer'), text, sprung });

/**
 * @param {Object} e
 * @param {KzRechenstand} e.waermeStand
 * @param {{mwh:number|null, pMaxKw:number|null, wgk:number|null, co2T:number|null, eePct:number|null, hatErzeuger:boolean}} e.waerme
 * @returns {KzKachel[]}
 */
export function kzWaerme({ waermeStand, waerme: w }) {
  const z = _zustand(waermeStand);
  const offen = waermeStand === 'offen';
  const sprung = w.hatErzeuger ? KZ_SPRUNG.waermeGebaeude : KZ_SPRUNG.waermeErzeuger;
  const k = [];

  const bedarf = { id: 'waerme', titel: 'Wärmebedarf', farbe: 'var(--c-orange)', einheit: 'MWh/a',
    tip: 'Gesamter Wärmebedarf des Quartiers pro Jahr, inkl. Netzverluste.' };
  k.push(!offen && _zahl(w.mwh) && w.mwh > 0 ? { ...bedarf, zustand: z, wert: kzNum(w.mwh) } : _fehlt(bedarf, 'nicht gerechnet', sprung));

  const spitze = { id: 'pmax', titel: 'Spitzenlast', farbe: 'var(--c-red)', einheit: 'kW',
    tip: 'Höchste Wärmeleistung, die in einer einzelnen Stunde des Jahres benötigt wird — bestimmt die nötige Erzeuger-Gesamtleistung.' };
  k.push(!offen && _zahl(w.pMaxKw) && w.pMaxKw > 0 ? { ...spitze, zustand: z, wert: kzNum(w.pMaxKw) } : _fehlt(spitze, 'nicht gerechnet', sprung));

  // Ab hier braucht es die Einsatzplanung — ohne Erzeuger gibt es sie nicht
  const ohneErz = (kachel) => (w.hatErzeuger ? _fehlt(kachel, 'nicht gerechnet', KZ_SPRUNG.waermeErzeuger)
    : _leer(kachel, 'keine Erzeuger geplant', KZ_SPRUNG.waermeErzeuger));

  const wgk = { id: 'wgk', titel: 'Wärmegestehungskosten', farbe: 'var(--c-amber)', einheit: 'ct/kWh',
    tip: 'Was kostet eine kWh Wärme aus dem Gesamtsystem? Enthält Investition, Wartung, Energie — abzgl. Stromerlöse.' };
  k.push(_zahl(w.wgk) && w.wgk > 0 ? { ...wgk, zustand: z, wert: kzNum(w.wgk, 1) } : ohneErz(wgk));

  const co2 = { id: 'co2', titel: 'CO₂-Emissionen Wärme', farbe: 'var(--muted)', einheit: 't/a',
    tip: 'Jährliche CO₂-Emissionen aller Wärmeerzeuger. Wärmepumpen: indirekt über Strommix. BHKW: Gutschrift für verdrängten Netzstrom.' };
  k.push(_zahl(w.co2T) && w.co2T > 0.01 ? { ...co2, zustand: z, wert: kzNum(w.co2T, w.co2T < 100 ? 1 : 0) } : ohneErz(co2));

  const ee = { id: 'ee', titel: 'Erneuerbarer Anteil', farbe: 'var(--c-green)', einheit: '%',
    tip: 'Anteil erneuerbarer Energien an der Wärmeversorgung (WP, Pellets, HHS, Solarthermie, Speicher). Ziel: mind. 65 %.' };
  k.push(_zahl(w.eePct) ? { ...ee, zustand: z, wert: kzNum(w.eePct), balken: { pct: Math.min(100, w.eePct), ziel: 65 } } : ohneErz(ee));
  return k;
}

/**
 * @param {Object} e
 * @param {KzRechenstand} e.waermeStand  Strombilanz hängt an der Einsatzplanung (WP-Strom)
 * @param {{netzbezugMwh:number, netzbezugSpitzeKw:number, gesamtMwh:number, pvErtragMwh:number, pvEigenMwh:number, pvKwp:number}|null} e.bilanz
 * @param {number|null} e.capKva       vereinbarte Anschlussleistung (Max. Bezug, kVA)
 * @param {{stand:KzRechenstand, hatNetz:boolean, hatTrafo:boolean, jahr:number|null,
 *          trafo:{name:string, pct:number}|null, kabel:{name:string, pct:number}|null, nKabel:number}} e.el
 * @returns {KzKachel[]}
 */
export function kzStrom({ waermeStand, bilanz: b, capKva, el }) {
  const zB = _zustand(waermeStand);
  const k = [];

  const bezug = { id: 'strombezug', titel: 'Strombezug', farbe: 'var(--c-blue)', einheit: 'MWh/a',
    tip: 'Strom aus dem öffentlichen Netz pro Jahr: Gebäude, Wärmepumpen, Stromkessel und Kälte abzüglich PV/BHKW-Eigenstrom (stündliche Strombilanz).' };
  k.push(b ? { ...bezug, zustand: zB, wert: kzNum(b.netzbezugMwh),
    sub: b.gesamtMwh > 0 ? `Bedarf ${kzNum(b.gesamtMwh)} MWh/a` : '' } : _fehlt(bezug, 'nicht gerechnet', KZ_SPRUNG.stromPlanung));

  const nap = { id: 'nap', titel: 'Spitzenlast Netzanschluss', farbe: 'var(--c-blue)', einheit: 'kW',
    tip: 'Höchster Stundenwert des Netzbezugs aus der Strombilanz (Stundenmittel, nach PV/BHKW/Batterie). '
       + 'Der Gutachtenwert (5.3, Netzanschluss-Modul) rechnet über die Bedarfsprognose mit Gleichzeitigkeit und kann abweichen. '
       + 'Anteil: kW gegen die vereinbarte Anschlussleistung in kVA, wie im Gutachten.' };
  if (!b) k.push(_fehlt(nap, 'nicht gerechnet', KZ_SPRUNG.stromPlanung));
  else {
    const kachel = { ...nap, zustand: zB, wert: kzNum(b.netzbezugSpitzeKw) };
    if (capKva && capKva > 0) {
      const pct = b.netzbezugSpitzeKw / capKva * 100;
      kachel.sub = `${kzNum(pct)} % von ${kzNum(capKva)} kVA vereinbart`;
      kachel.balken = { pct: Math.min(100, pct), warn: pct > 100 };
    } else {
      kachel.sub = 'vereinbarte Leistung fehlt';
      kachel.sprung = KZ_SPRUNG.napGrenze;
    }
    k.push(kachel);
  }

  const pv = { id: 'pv', titel: 'PV-Erzeugung', farbe: 'var(--c-amber)', einheit: 'MWh/a',
    tip: 'Jahresertrag aller PV-Anlagen (Gebäude, Freiflächen, pauschal) aus der Strombilanz.' };
  const pvEv = { id: 'pv-ev', titel: 'PV-Eigenverbrauch', farbe: 'var(--c-green)', einheit: '%',
    tip: 'Anteil des PV-Stroms, der in der Liegenschaft verbraucht wird (direkt, über Batterie oder Wärmepumpe in den Wärmespeicher) — Rest wird eingespeist.' };
  if (!b) {
    k.push(_fehlt(pv, 'nicht gerechnet', KZ_SPRUNG.stromPlanung), _fehlt(pvEv, 'nicht gerechnet', KZ_SPRUNG.stromPlanung));
  } else if (!(b.pvErtragMwh > 0)) {
    k.push(_leer(pv, 'keine PV geplant', KZ_SPRUNG.stromPv), _leer(pvEv, 'keine PV geplant', KZ_SPRUNG.stromPv));
  } else {
    k.push({ ...pv, zustand: zB, wert: kzNum(b.pvErtragMwh), sub: b.pvKwp > 0 ? `${kzNum(b.pvKwp)} kWp` : '' });
    const q = b.pvEigenMwh / b.pvErtragMwh * 100;
    k.push({ ...pvEv, zustand: zB, wert: kzNum(q), sub: `${kzNum(b.pvEigenMwh)} MWh/a selbst genutzt`, balken: { pct: Math.min(100, q) } });
  }

  // Netz: Stempel der letzten Elektroberechnung (elCalcAssets) — nicht die Schnellberechnung
  const zE = _zustand(el.stand);
  const jahr = el.jahr ? `Rechenjahr ${el.jahr}` : '';
  const trafo = { id: 'trafo', titel: 'Höchste Trafo-Auslastung', farbe: 'var(--c-violet)', einheit: '%',
    tip: 'Höchste Auslastung eines Transformators aus der letzten Elektroberechnung (Planung › Strom › Berechnen).' };
  const kabel = { id: 'kabel', titel: 'Höchste Kabel-Auslastung', farbe: 'var(--c-violet)', einheit: '%',
    tip: 'Höchste Auslastung eines Kabels aus der letzten Elektroberechnung (Strom gegen zulässigen Strom inkl. Verlegebedingungen).' };
  if (!el.hatNetz) {
    k.push(_leer(trafo, 'kein Stromnetz geplant', KZ_SPRUNG.stromPlanung), _leer(kabel, 'kein Stromnetz geplant', KZ_SPRUNG.stromPlanung));
  } else if (el.stand === 'offen') {
    k.push(_fehlt(trafo, 'nicht gerechnet', KZ_SPRUNG.elRechnen), _fehlt(kabel, 'nicht gerechnet', KZ_SPRUNG.elRechnen));
  } else {
    // 0 % heißt: in der Rechnung hing keine Last daran (z. B. Verbraucher ohne Leistung, Trafo ohne NS-Kabel)
    const ausl = (kachel, x, ohne) => (!x ? _leer(kachel, ohne, KZ_SPRUNG.stromPlanung)
      : x.pct <= 0 ? { ..._leer(kachel, 'keine Last angeschlossen', KZ_SPRUNG.stromPlanung), sub: jahr }
      : { ...kachel, zustand: zE, wert: kzNum(x.pct), sub: [x.name, jahr].filter(Boolean).join(' · '),
          balken: { pct: Math.min(100, x.pct), ziel: 100, warn: x.pct > 100 } });
    k.push(ausl(trafo, el.trafo, el.hatTrafo ? 'kein Ergebnis' : 'kein Trafo im Netz'));
    k.push(ausl(kabel, el.kabel, 'keine Kabel gerechnet'));
  }
  return k;
}

/**
 * Übergreifend. Primärenergie und CO₂: Wärme wie Emissionen-Reiter (Einsatzplanung inkl. WP-Strom)
 * plus Netzstrom der übrigen Verbraucher (Gebäude, Kälte) aus der Strombilanz × Netzstromfaktor.
 * PV-Strom, den die Wärmepumpen nutzen, mindert die Wärmeseite dort nicht — bewusst konservativ.
 * @param {Object} e
 * @param {KzRechenstand} e.waermeStand
 * @param {{peWaermeMwh:number|null, co2WaermeT:number|null, uebrigerNetzMwh:number|null,
 *          fpStrom:number, efStromGkWh:number, investEur:number|null, jkEur:number|null, hatErzeuger:boolean}} e.g
 * @returns {KzKachel[]}
 */
export function kzGesamt({ waermeStand, g }) {
  const z = _zustand(waermeStand);
  const k = [];
  const sprungW = KZ_SPRUNG.waermeErzeuger;
  const restMwh = _zahl(g.uebrigerNetzMwh) ? Math.max(0, /** @type {number} */ (g.uebrigerNetzMwh)) : null;

  const teile = (waerme, strom, einheit, d = 0) =>
    `Wärme ${kzNum(waerme, d)} · übriger Strom ${strom == null ? '—' : kzNum(strom, d)} ${einheit}`;

  const pe = { id: 'pe', titel: 'Primärenergie', farbe: 'var(--c-blue)', einheit: 'MWh/a',
    tip: 'Nicht erneuerbarer Primärenergieeinsatz (GEG Anlage 4): Wärmeerzeuger wie im Reiter Emissionen › Primärenergie '
       + 'plus Netzstrom der übrigen Verbraucher × fp Strom. Ohne Strombilanz nur Wärme.' };
  if (_zahl(g.peWaermeMwh) && /** @type {number} */ (g.peWaermeMwh) > 0) {
    const peStrom = restMwh == null ? null : restMwh * g.fpStrom;
    const sum = /** @type {number} */ (g.peWaermeMwh) + (peStrom || 0);
    k.push({ ...pe, zustand: z, wert: kzNum(sum), sub: teile(/** @type {number} */ (g.peWaermeMwh), peStrom, 'MWh') });
  } else k.push(g.hatErzeuger ? _fehlt(pe, 'nicht gerechnet', sprungW) : _leer(pe, 'keine Erzeuger geplant', sprungW));

  const co2 = { id: 'co2-ges', titel: 'CO₂ gesamt', farbe: 'var(--muted)', einheit: 't/a',
    tip: 'CO₂ der Wärmeversorgung (wie Kachel Wärme) plus Netzstrom der übrigen Verbraucher × Emissionsfaktor Strom. '
       + 'Ohne Strombilanz nur Wärme.' };
  if (_zahl(g.co2WaermeT) && /** @type {number} */ (g.co2WaermeT) > 0.01) {
    const co2Strom = restMwh == null ? null : restMwh * g.efStromGkWh / 1000;
    const sum = /** @type {number} */ (g.co2WaermeT) + (co2Strom || 0);
    k.push({ ...co2, zustand: z, wert: kzNum(sum, sum < 100 ? 1 : 0), sub: teile(/** @type {number} */ (g.co2WaermeT), co2Strom, 't', sum < 100 ? 1 : 0) });
  } else k.push(g.hatErzeuger ? _fehlt(co2, 'nicht gerechnet', sprungW) : _leer(co2, 'keine Erzeuger geplant', sprungW));

  const inv = { id: 'invest', titel: 'Investition', farbe: 'var(--c-teal)',
    tip: 'Investition der Wärmeversorgung nach VDI 2067 aus der Wirtschaftlichkeit (Erzeuger, Speicher, Wärmenetz, Nebenkosten). '
       + 'PV, Batterie und Stromnetz-Maßnahmen sind dort nicht enthalten.' };
  const jk = { id: 'jk', titel: 'Jahreskosten', farbe: 'var(--c-teal)',
    tip: 'Annuitätische Gesamtkosten der Wärmeversorgung nach VDI 2067 (Kapital, Betrieb, Energie inkl. CO₂-Preis) aus der Wirtschaftlichkeit.' };
  const ohneWirt = kachel => (g.hatErzeuger ? _fehlt(kachel, 'nicht gerechnet', KZ_SPRUNG.wirtschaft) : _leer(kachel, 'keine Erzeuger geplant', sprungW));
  if (_zahl(g.investEur) && /** @type {number} */ (g.investEur) > 0) {
    const e = kzEuro(/** @type {number} */ (g.investEur));
    k.push({ ...inv, zustand: z, wert: e.wert, einheit: e.einheit, sub: 'Wärmeversorgung, VDI 2067' });
  } else k.push(ohneWirt(inv));
  if (_zahl(g.jkEur) && /** @type {number} */ (g.jkEur) > 0) {
    const e = kzEuro(/** @type {number} */ (g.jkEur));
    k.push({ ...jk, zustand: z, wert: e.wert, einheit: e.einheit + '/a', sub: 'Wärmeversorgung, annuitätisch' });
  } else k.push(ohneWirt(jk));
  return k;
}

/** Kurztext zum Rechenstand einer Gruppe (Kopfzeile). */
export function kzStandText(stand) {
  return stand === 'veraltet' ? 'veraltet — neu berechnen' : stand === 'gerechnet' ? 'gerechnet'
    : stand === 'teilweise' ? 'teilweise gerechnet' : 'nicht gerechnet';
}

/**
 * Stand der Stromgruppe: Bilanz (läuft mit der Einsatzplanung) und Netzrechnung zusammen.
 * @param {KzRechenstand} waermeStand  @param {KzRechenstand} elStand
 * @param {boolean} hatBilanz  @param {boolean} hatNetz
 * @returns {KzRechenstand|'teilweise'}
 */
export function kzStromStand(waermeStand, elStand, hatBilanz, hatNetz) {
  if (!hatBilanz && elStand === 'offen') return 'offen';
  if (elStand === 'veraltet' || (hatBilanz && waermeStand === 'veraltet')) return 'veraltet';
  if (hatBilanz && (elStand === 'gerechnet' || !hatNetz)) return 'gerechnet';
  return 'teilweise';
}

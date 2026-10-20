// ── lib/gutachten-elektro-fazit.js — Gutachten Kapitel 5 (Kernaussagen, 5.6, 5.7) und 9.2 ──
// DOM- und importfrei. 17-gutachten-grafik.js sammelt die Ergebnisse der Kapitel 5.1–5.5 (Anschluss,
// internes Netz, PV, Notstrom, Ladeinfrastruktur, Kosten) und übergibt sie hier als einfache Zahlen;
// daraus entstehen die Kernaussagen mit Ampel, die Bewertung der PV-Auslegungen und die Maßnahmenliste.
//
// Ampel (status): 'ok' in Ordnung · 'pruefen' zu prüfen · 'handeln' Handlungsbedarf · 'offen' Angaben fehlen.

export const EF_STATUS = Object.freeze({ ok: 'in Ordnung', pruefen: 'prüfen', handeln: 'Handlungsbedarf', offen: 'Angaben fehlen' });

/** Gewichte der PV-Bewertung (Summe 100) — Vorschlag; Netzverträglichkeit vor Autarkie, weil Netzausbau Zeit und Geld kostet. */
export const EF_PV_GEWICHTE = Object.freeze({ wirtschaft: 40, netz: 30, autarkie: 20, invest: 10 });
export const EF_PV_KRITERIEN = Object.freeze({ wirtschaft: 'Wirtschaftlichkeit', netz: 'Netzverträglichkeit', autarkie: 'Autarkie', invest: 'Investition' });

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n0 = v => Math.round(v).toLocaleString('de-DE');
const eur = v => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mio. €`
  : `${n0(Math.round(v / 1000) * 1000)} €`);

/**
 * Kernaussagen zu Kapitel 5 — eine Zeile je Thema: { thema, kapitel, status, ergebnis }.
 * d.anschluss  { endKw, capKva, zieljahr, erstesJahr }      — resultierende vs. vereinbarte Anschlussleistung (5.3.4)
 * d.einspeisung { kw, zusageKw, quelle, pvLabel }             — maßgebliche Einspeisung vs. Einspeisezusage;
 *                                                               quelle 'pv' = Rückspeisung der PV-Auslegung, sonst Zubau
 * d.netz       { zubau, ungeloest, bestand, erstesJahr, bis } — Engpass-Sweep (5.4.1); null = kein Netzmodell
 * d.pv         { label, kwp, batKwh, autarkiePct, ueberKwp, bnKwp } — weiterverfolgte Auslegung (5.4.2); null = nicht gerechnet
 * d.notstrom   { berechnet, erforderlichKw, bestandKw, geplantKw } — 5.4.3 / Kapitel 8
 * d.lade       { parks, zubauKw, zuleitung }                  — 5.4.4
 * d.kosten     { investEur, offen }                            — 5.5 (bezifferte Summe, Zahl der nicht bezifferten Posten)
 */
export function efKernaussagen(d = {}) {
  const z = [];
  const a = d.anschluss;
  if (a && ok(a.endKw)) {
    const zj = a.zieljahr ? ` (${a.zieljahr})` : '';
    if (!ok(a.capKva) || a.capKva <= 0) {
      z.push({ thema: 'Netzanschluss', kapitel: '5.3.4', status: 'offen',
        ergebnis: `Resultierende Anschlussleistung ${n0(a.endKw)} kW${zj}; vereinbarte Anschlussleistung liegt nicht vor.` });
    } else {
      const reserve = a.capKva - a.endKw;
      z.push(reserve < 0
        ? { thema: 'Netzanschluss', kapitel: '5.4.1', status: 'handeln',
            ergebnis: `${n0(a.endKw)} kW${zj} gegenüber ${n0(a.capKva)} kVA vereinbart: Erhöhung um mindestens ${n0(-reserve)} kW beantragen`
              + (ok(a.erstesJahr) ? `, erforderlich ab ${a.erstesJahr}.` : '.') }
        : { thema: 'Netzanschluss', kapitel: '5.3.4', status: reserve / a.capKva < 0.1 ? 'pruefen' : 'ok',
            ergebnis: `${n0(a.endKw)} kW${zj} innerhalb der vereinbarten ${n0(a.capKva)} kVA (Reserve ${n0(reserve)} kW)`
              + (reserve / a.capKva < 0.1 ? ', weitgehend ausgeschöpft.' : '.') });
    }
  }
  const e = d.einspeisung;
  if (e && e.kw > 0) {
    // quelle 'pv': Rückspeisespitze der weiterverfolgten PV-Auslegung (größer als die geplanten Assets des Netzmodells)
    const was = e.quelle === 'pv'
      ? `Rückspeisung bis ${n0(e.kw)} kW${e.pvLabel ? ` (PV „${e.pvLabel}“)` : ''}`
      : `Zubau ${n0(e.kw)} kW Einspeiseleistung`;
    z.push(!ok(e.zusageKw) || e.zusageKw <= 0
      ? { thema: 'Einspeisung', kapitel: '5.3.4', status: 'offen', ergebnis: `${was}; Einspeisezusage liegt nicht vor.` }
      : e.kw > e.zusageKw
        ? { thema: 'Einspeisung', kapitel: '5.4.1', status: 'handeln', ergebnis: `${was} über der Einspeisezusage von ${n0(e.zusageKw)} kW: Erhöhung beantragen.` }
        : { thema: 'Einspeisung', kapitel: '5.3.4', status: 'ok', ergebnis: `${was} innerhalb der Einspeisezusage von ${n0(e.zusageKw)} kW.` });
  }
  const nz = d.netz;
  if (!nz) {
    z.push({ thema: 'Internes Stromnetz', kapitel: '5.4.1', status: 'offen', ergebnis: 'Kein Netzmodell; Bewertung nach Begehung.' });
  } else {
    const teile = [];
    if (nz.zubau) teile.push(`${nz.zubau} ${nz.zubau === 1 ? 'Engpass' : 'Engpässe'} durch Zubau${ok(nz.erstesJahr) ? ` ab ${nz.erstesJahr}` : ''}`);
    if (nz.ungeloest) teile.push(`${nz.ungeloest} davon nur mit Änderung der Netzstruktur lösbar`);
    if (nz.bestand) teile.push(`${nz.bestand} Betriebsmittel mit zu prüfenden Bestandsdaten`);
    z.push({ thema: 'Internes Stromnetz', kapitel: '5.4.1',
      status: nz.zubau || nz.ungeloest ? 'handeln' : nz.bestand ? 'pruefen' : 'ok',
      ergebnis: teile.length ? teile.join('; ') + '.' : `Keine Engpässe bis ${nz.bis}.` });
  }
  const pv = d.pv;
  if (!pv) {
    z.push({ thema: 'Photovoltaik', kapitel: '5.4.2', status: 'offen', ergebnis: 'PV-Auslegungen nicht berechnet.' });
  } else {
    const kern = `„${pv.label}“: ${n0(pv.kwp)} kWp${pv.batKwh > 0 ? ` mit ${n0(pv.batKwh)} kWh Speicher` : ''}`
      + (ok(pv.autarkiePct) ? `, Autarkie ${n0(pv.autarkiePct)} %` : '');
    z.push(pv.ueberKwp > 0
      ? { thema: 'Photovoltaik', kapitel: '5.4.2', status: 'pruefen',
          ergebnis: `${kern}; ${n0(pv.ueberKwp)} kWp über der Aufnahme des Bestandsnetzes${ok(pv.bnKwp) ? ` (${n0(pv.bnKwp)} kWp)` : ''}, Netzertüchtigung nötig.` }
      : { thema: 'Photovoltaik', kapitel: '5.4.2', status: 'ok', ergebnis: `${kern}; ohne Netzertüchtigung anschließbar.` });
  }
  const ns = d.notstrom;
  if (ns) {
    const vorhanden = (ns.bestandKw || 0) + (ns.geplantKw || 0);
    z.push(!ns.berechnet
      ? { thema: 'Notstromversorgung', kapitel: '5.4.3', status: vorhanden > 0 ? 'pruefen' : 'offen',
          ergebnis: (ns.bestandKw > 0 ? `Netzersatzanlagen mit ${n0(ns.bestandKw)} kW im Bestand` : 'Keine Netzersatzanlage im Bestand')
            + '; Auslegung steht aus (vgl. Kapitel 8).' }
      : ns.erforderlichKw > vorhanden + 0.5
        ? { thema: 'Notstromversorgung', kapitel: '5.4.3', status: 'handeln',
            ergebnis: `Erforderlich ${n0(ns.erforderlichKw)} kW, vorhanden bzw. geplant ${n0(vorhanden)} kW.` }
        : { thema: 'Notstromversorgung', kapitel: '5.4.3', status: 'ok', ergebnis: `Erforderliche ${n0(ns.erforderlichKw)} kW sind abgedeckt.` });
  }
  const l = d.lade;
  if (l && l.parks > 0) {
    z.push({ thema: 'Ladeinfrastruktur', kapitel: '5.4.4', status: l.zuleitung > 0 ? 'pruefen' : 'ok',
      ergebnis: (l.zubauKw > 0.5 ? `Zubau ${n0(l.zubauKw)} kW` : 'Kein Zubau vorgesehen')
        + (l.zuleitung > 0 ? `; Zuleitungen von ${l.zuleitung} ${l.zuleitung === 1 ? 'Ladepark' : 'Ladeparks'} prüfen.` : '.') });
  }
  const k = d.kosten;
  if (k) {
    z.push({ thema: 'Investitionen', kapitel: '5.5', status: k.offen > 0 ? 'offen' : 'ok',
      ergebnis: k.investEur > 0
        ? `${k.offen > 0 ? 'Mindestens ' : ''}${eur(k.investEur)}${k.offen > 0 ? `; ${k.offen} Posten noch nicht beziffert` : ''}.`
        : 'Keine bezifferbaren Investitionen.' });
  }
  return z;
}

/**
 * Bewertung der PV-Auslegungen (5.6): je Kriterium 0–100 Punkte, gewichtet zur Gesamtnote.
 * Wirtschaftlichkeit: Kapitalwert im Verhältnis zum besten (≤ 0 → 0) · Autarkie: im Verhältnis zur höchsten ·
 * Netzverträglichkeit: 100, wenn die Auslegung ins Bestandsnetz passt, sonst Bestandsnetz-kWp ÷ Auslegung ·
 * Investition: geringste ÷ eigene. Kriterien ohne Wert zählen nicht (die übrigen Gewichte gelten anteilig).
 * auslegungen: [{ id, label, kwp, batKwh, investEur, kapitalwert, autarkiePct }] · bnKwp: Aufnahme des Bestandsnetzes
 */
export function efPvBewertung({ auslegungen = [], bnKwp = null, gewichte = EF_PV_GEWICHTE } = {}) {
  const A = auslegungen.filter(a => a && a.kwp > 0);
  if (A.length < 2) return null;
  const max = k => Math.max(...A.map(a => a[k]).filter(ok));
  const kwMax = max('kapitalwert'), autMax = max('autarkiePct');
  const invMin = Math.min(...A.map(a => a.investEur).filter(v => ok(v) && v > 0));
  const punkte = a => ({
    wirtschaft: ok(a.kapitalwert) && kwMax > 0 ? Math.max(0, 100 * a.kapitalwert / kwMax) : NaN,
    netz: ok(bnKwp) && bnKwp > 0 ? (a.kwp <= bnKwp * 1.01 ? 100 : 100 * bnKwp / a.kwp) : NaN,
    autarkie: ok(a.autarkiePct) && autMax > 0 ? 100 * a.autarkiePct / autMax : NaN,
    invest: ok(a.investEur) && a.investEur > 0 && ok(invMin) ? 100 * invMin / a.investEur : NaN,
  });
  const zeilen = A.map(a => {
    const p = punkte(a);
    const gw = Object.keys(p).filter(k => ok(p[k]));
    const summe = gw.reduce((s, k) => s + gewichte[k], 0);
    return { a, punkte: p, gesamt: summe > 0 ? gw.reduce((s, k) => s + gewichte[k] * p[k], 0) / summe : NaN };
  }).sort((x, y) => (ok(y.gesamt) ? y.gesamt : -1) - (ok(x.gesamt) ? x.gesamt : -1));
  zeilen.forEach((z, i) => { z.rang = i + 1; });
  return { zeilen, gewichte };
}

/**
 * Maßnahmenliste Elektrotechnik (5.7, 9.2): [{ bereich, massnahme, bis, investEur, begruendung, kapitel }], nach Jahr sortiert.
 * d wie efKernaussagen, dazu:
 * d.heute, d.vorlaufJ                  — laufendes Jahr, Vorlauf des Netzbetreibers (Antrag vor dem ersten Überschreitungsjahr)
 * d.positionen [{ gruppe, label, umfang, investEur, jahr }] — Kostenpositionen aus 5.5 (lib/elektro-kosten.js)
 */
export function efMassnahmen(d = {}) {
  const heute = d.heute || new Date().getFullYear();
  const out = [];
  const a = d.anschluss;
  if (a && ok(a.capKva) && a.capKva > 0 && a.endKw > a.capKva) {
    const ab = ok(a.erstesJahr) ? Math.max(heute, a.erstesJahr) : heute;
    out.push({ bereich: 'Netzanschluss', kapitel: '5.4.1', massnahme: `Antrag auf Erhöhung der Anschlussleistung auf mindestens ${n0(Math.ceil(a.endKw))} kVA`,
      bis: Math.max(heute, ab - (d.vorlaufJ ?? 2)), investEur: d.positionen?.filter(p => p.gruppe === 'netzanschluss').reduce((s, p) => s + (p.investEur || 0), 0) || null,
      begruendung: `Resultierende Anschlussleistung ${n0(a.endKw)} kW über der vereinbarten von ${n0(a.capKva)} kVA` });
  } else if (a && !(a.capKva > 0)) {
    out.push({ bereich: 'Netzanschluss', kapitel: '5.1.1', massnahme: 'Vereinbarte Anschlussleistung und Einspeisezusage beim Netzbetreiber erfragen',
      bis: heute, investEur: null, begruendung: 'Grundlage für die Bewertung des Netzanschlusses fehlt' });
  }
  const e = d.einspeisung;
  if (e && e.kw > 0 && ok(e.zusageKw) && e.kw > e.zusageKw) {
    out.push({ bereich: 'Netzanschluss', kapitel: '5.4.1', massnahme: `Erhöhung der Einspeisezusage auf mindestens ${n0(Math.ceil(e.kw))} kW beantragen`,
      bis: heute, investEur: null,
      begruendung: `${e.quelle === 'pv' ? 'Rückspeisung der PV-Auslegung' : 'Einspeiseleistung des Zubaus'} über der Zusage von ${n0(e.zusageKw)} kW` });
  }
  if (d.netz?.bestand > 0) {
    out.push({ bereich: 'Internes Stromnetz', kapitel: '5.4.1', massnahme: `Bestandsdaten von ${d.netz.bestand} Betriebsmitteln bei der Begehung prüfen`,
      bis: heute, investEur: null, begruendung: 'rechnerisch schon im Bestand überlastet – Hinweis auf fehlende oder falsche Bestandsdaten' });
  }
  // Kostenpositionen des internen Netzes je Umsetzungsjahr zusammengefasst, damit die Liste lesbar bleibt
  const netz = (d.positionen || []).filter(p => p.gruppe === 'netz');
  const jeJahr = new Map();
  for (const p of netz) {
    const j = ok(p.jahr) ? p.jahr : null;
    if (!jeJahr.has(j)) jeJahr.set(j, []);
    jeJahr.get(j).push(p);
  }
  for (const [j, ps] of jeJahr) {
    const invest = ps.reduce((s, p) => s + (p.investEur || 0), 0);
    out.push({ bereich: 'Internes Stromnetz', kapitel: '5.4.1',
      massnahme: ps.length === 1 ? ps[0].label : `Ertüchtigung internes Netz: ${ps.length} Maßnahmen`,
      bis: j, investEur: invest > 0 ? invest : null,
      begruendung: ps.length === 1 ? 'Engpass bzw. geplante Netzmaßnahme' : `u. a. ${ps.slice(0, 2).map(p => p.umfang || p.label).join(', ')}` });
  }
  if (d.netz?.ungeloest > 0) {
    out.push({ bereich: 'Internes Stromnetz', kapitel: '5.4.1', massnahme: `Netzstruktur für ${d.netz.ungeloest} ${d.netz.ungeloest === 1 ? 'Engpass' : 'Engpässe'} ohne Standardlösung planen`,
      bis: ok(d.netz.erstesJahr) ? d.netz.erstesJahr : null, investEur: null, begruendung: 'keine Standardertüchtigung ausreichend' });
  }
  for (const p of (d.positionen || []).filter(x => x.gruppe === 'pv')) {
    out.push({ bereich: 'Photovoltaik', kapitel: '5.4.2', massnahme: `PV-Anlage ${p.label} (${p.umfang})`, bis: ok(p.jahr) ? p.jahr : null,
      investEur: p.investEur || null, begruendung: 'weiterverfolgte Auslegung, Wirtschaftlichkeit siehe Kapitel 5.5' });
  }
  if (d.pv?.ueberKwp > 0) {
    // netzInKosten: Rechenstand mit Ausbautreppe — die Ertüchtigung steckt schon in der PV-Investition, nicht doppelt zählen
    const inKosten = !!d.pv.netzInKosten;
    out.push({ bereich: 'Photovoltaik', kapitel: '5.4.2', massnahme: `Netzertüchtigung für ${n0(d.pv.ueberKwp)} kWp PV über der Aufnahme des Bestandsnetzes`,
      bis: null, investEur: !inKosten && d.pv.netzInvestEur > 0 ? d.pv.netzInvestEur : null,
      begruendung: 'Auslegung überschreitet die Aufnahme des bestehenden Netzes'
        + (inKosten ? '; Kosten in der Investition der PV-Anlage enthalten'
          : d.pv.netzInvestEur > 0 ? '; Kosten aus der Netzaufnahme-Analyse, nicht in der Summe von Kapitel 5.5' : '') });
  }
  for (const p of (d.positionen || []).filter(x => x.gruppe === 'notstrom')) {
    out.push({ bereich: 'Notstromversorgung', kapitel: '5.4.3', massnahme: `${p.label} (${p.umfang})`, bis: ok(p.jahr) ? p.jahr : null,
      investEur: p.investEur || null, begruendung: 'Versorgung der notstromberechtigten Verbraucher' });
  }
  if (d.notstrom && !d.notstrom.berechnet && !(d.notstrom.bestandKw > 0)) {
    out.push({ bereich: 'Notstromversorgung', kapitel: '5.4.3', massnahme: 'Notstromkonzept erstellen (notstromberechtigte Verbraucher, Aggregat, Einspeisepunkte)',
      bis: null, investEur: null, begruendung: 'keine Netzersatzanlage im Bestand, Auslegung steht aus' });
  }
  for (const p of (d.positionen || []).filter(x => x.gruppe === 'lade')) {
    out.push({ bereich: 'Ladeinfrastruktur', kapitel: '5.4.4', massnahme: `${p.label} (${p.umfang})`, bis: ok(p.jahr) ? p.jahr : null,
      investEur: p.investEur || null, begruendung: 'geplanter Ausbau' });
  }
  if (d.lade?.zuleitung > 0) {
    out.push({ bereich: 'Ladeinfrastruktur', kapitel: '5.4.4', massnahme: `Zuleitungen von ${d.lade.zuleitung} ${d.lade.zuleitung === 1 ? 'Ladepark' : 'Ladeparks'} prüfen`,
      bis: heute, investEur: null, begruendung: 'Zuleitung rechnerisch überlastet' });
  }
  // Jahr zuerst, ohne Jahr ans Ende; gleiche Jahre in der Reihenfolge oben (Anschluss vor Netz vor Anlagen)
  return out.map((m, i) => ({ ...m, i })).sort((x, y) => (x.bis ?? 9999) - (y.bis ?? 9999) || x.i - y.i).map(({ i, ...m }) => { void i; return m; });
}

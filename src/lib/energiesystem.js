// ── lib/energiesystem.js — Überblick „Energiesystem der Liegenschaft“ (Gutachten-Abbildung) ──
// DOM-frei (Vitest). Die Oberfläche (17-gutachten-grafik.js) sammelt die Projektdaten ein; hier wird daraus
// das Modell der Prinzipskizze: Bezug von außen, Stromschiene mit Erzeugern und Speichern, Kopplung Strom↔Wärme,
// Wärmeschiene mit Erzeugern und Speichern, Verbraucher.
//
//   esModell(eingang)   eingang = { stand, strom, waermeIst, waermeZiel, netz, verbrauch }
//
// stand 'ist':  Strom = Anlagen im Bestand, Wärme = Bestandsanlage (Wärme-Grundlagen).
// stand 'ziel': Strom = Bestand + Planung (geplant markiert), Wärme = Erzeuger der aktuellen Variante (Einsatzplanung).

/** Wärmeerzeuger: Bestandsanlage-Typ bzw. Dispatch-Schlüssel → Platz in der Skizze. */
const ES_WAERME = Object.freeze({
  // Kopplung (zwischen Strom- und Wärmeschiene)
  bhkw:         { ort: 'kopplung', titel: 'BHKW', icon: 'gas', traeger: 'gas', richtung: 'kwk' },
  lwwp:         { ort: 'kopplung', titel: 'Luft-Wärmepumpe', icon: 'air', richtung: 'wp' },
  geo:          { ort: 'kopplung', titel: 'Erdwärmepumpe', icon: 'geo', richtung: 'wp' },
  fg:           { ort: 'kopplung', titel: 'Flusswasser-Wärmepumpe', icon: 'water', richtung: 'wp' },
  waermepumpe:  { ort: 'kopplung', titel: 'Wärmepumpe', icon: 'air', richtung: 'wp' },
  stromkessel:  { ort: 'kopplung', titel: 'Elektrokessel', icon: 'blitz', richtung: 'wp' },
  // nur Wärme
  gaskessel:    { ort: 'waerme', titel: 'Gaskessel', icon: 'gas', traeger: 'gas' },
  heizoel:      { ort: 'waerme', titel: 'Heizölkessel', icon: 'oil', traeger: 'heizoel' },
  pellets:      { ort: 'waerme', titel: 'Pelletkessel', icon: 'wood', traeger: 'biomasse' },
  hhs:          { ort: 'waerme', titel: 'Hackschnitzelkessel', icon: 'wood', traeger: 'biomasse' },
  solarthermie: { ort: 'waerme', titel: 'Solarthermie', icon: 'sun' },
  speicher:     { ort: 'waerme', titel: 'Wärmespeicher', icon: 'tank' },
  fernwaerme:   { ort: 'quelle' },
});

/** Bestandsanlage-Typ (lib/bestandsanlage BA_TYPEN) → Schlüssel oben. */
const ES_BA_TYP = Object.freeze({
  nt_gaskessel: 'gaskessel', bw_gaskessel: 'gaskessel', oelkessel: 'heizoel', bhkw_gas: 'bhkw',
  pelletkessel: 'pellets', hhs_kessel: 'hhs', waermepumpe: 'waermepumpe', elektrokessel: 'stromkessel',
  fernwaerme: 'fernwaerme', solarthermie: 'solarthermie',
});

/** Titel mit Bauart aus der Bestandsanlage, wo sie mehr sagt als der Sammelbegriff. */
const ES_BA_TITEL = Object.freeze({ nt_gaskessel: 'NT-Gaskessel', bw_gaskessel: 'Brennwertkessel' });

/** Bezug von außen, in der Reihenfolge der linken Spalte. */
export const ES_QUELLEN = Object.freeze([
  { key: 'strom', titel: 'Stromnetz', icon: 'mast' },
  { key: 'gas', titel: 'Erdgas', icon: 'gas' },
  { key: 'heizoel', titel: 'Heizöl', icon: 'oil' },
  { key: 'biomasse', titel: 'Biomasse', icon: 'wood' },
  { key: 'fernwaerme', titel: 'Fernwärme', icon: 'mast' },
]);

const zahl = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null; };
const fmt = (v, dez = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez });
const kw = (v, einheit = 'kW') => `${fmt(v, v < 10 ? 1 : 0)} ${einheit}`;
const summe = (liste, feld) => {
  const w = liste.map(x => zahl(x[feld])).filter(v => v != null);
  return w.length ? w.reduce((s, v) => s + v, 0) : null;
};
const anzahlText = (n, titel, mehrzahl) => (n > 1 ? `${n} ${mehrzahl || ES_MEHRZAHL[titel] || titel}` : titel);
const ES_MEHRZAHL = Object.freeze({ Wärmepumpe: 'Wärmepumpen', 'Luft-Wärmepumpe': 'Luft-Wärmepumpen', Solarthermie: 'Solarthermieanlagen' });

/**
 * Stromseitige Anlagen bündeln: je Typ ein Kasten, bei gemischtem Bestand und Planung zwei.
 * @param {{typ:string, props:object, geplant?:boolean}[]} liste
 */
function esStromElemente(liste, mitPlanung) {
  const out = [];
  const typen = [
    { typ: 'PV', titel: 'Photovoltaik', mehrzahl: 'PV-Anlagen', icon: 'sun',
      zeile: l => { const s = summe(l.map(e => e.props), 'leistungKWp'); return s ? kw(s, 'kWp') : ''; } },
    { typ: 'Wind', titel: 'Windenergieanlage', mehrzahl: 'Windenergieanlagen', icon: 'wind',
      zeile: l => { const s = summe(l.map(e => e.props), 'leistungKW'); return s ? kw(s) : ''; } },
    { typ: 'Batterie', titel: 'Batteriespeicher', icon: 'batterie',
      zeile: l => {
        const p = summe(l.map(e => e.props), 'leistungKW'), k = summe(l.map(e => e.props), 'kapazitaetKWh');
        return [p && kw(p), k && kw(k, 'kWh')].filter(Boolean).join(' · ');
      } },
    { typ: 'H2', titel: 'Wasserstoffspeicher', icon: 'tank',
      zeile: l => { const s = summe(l.map(e => e.props), 'elektrolyseKW'); return s ? `Elektrolyse ${kw(s)}` : ''; } },
    { typ: 'Nsa', titel: 'Netzersatzanlage', mehrzahl: 'Netzersatzanlagen', icon: 'motor',
      zeile: l => { const s = summe(l.map(e => e.props), 'leistungKW'); return s ? kw(s) : ''; } },
  ];
  // je Typ EIN Kasten: Bestand und Planung zusammen, die Planung als grüne Zusatzzeile („+ 400 kWp geplant“);
  // nur geplant → der ganze Kasten gilt als geplant
  for (const t of typen) {
    const bestand = liste.filter(e => e.typ === t.typ && !e.geplant);
    const plan = mitPlanung ? liste.filter(e => e.typ === t.typ && e.geplant) : [];
    if (!bestand.length && !plan.length) continue;
    const nurPlan = !bestand.length;
    const basis = nurPlan ? plan : bestand;
    const zp = !nurPlan && plan.length ? t.zeile(plan) : '';
    out.push({ id: t.typ, titel: anzahlText(basis.length, t.titel, t.mehrzahl), zeile: t.zeile(basis),
               zeilePlan: plan.length && !nurPlan ? (zp ? `+ ${zp} geplant` : '+ Ausbau geplant') : '',
               icon: t.icon, geplant: nurPlan, speicher: t.typ === 'Batterie' || t.typ === 'H2', notstrom: t.typ === 'Nsa' });
  }
  return out;
}

/** Ladeinfrastruktur als Verbraucher an der Stromschiene. */
function esLade(liste, mitPlanung) {
  const l = liste.filter(e => e.typ === 'Lade' && (mitPlanung || !e.geplant));
  if (!l.length) return null;
  const punkte = l.reduce((s, e) => s + (zahl(e.props.anzahlPunkte) || 0) + (zahl(e.props.anzahlSchnell) || 0), 0);
  return { titel: 'Ladeinfrastruktur', zeile: punkte ? `${fmt(punkte)} Ladepunkte` : '', geplant: l.every(e => e.geplant) };
}

/** Wärmeseite des Ist-Zustands aus der Bestandsanlage (Wärme-Grundlagen). */
function esWaermeIst(ba, stromListe) {
  const gruppen = new Map();
  for (const e of ba?.erzeuger || []) {
    const key = ES_BA_TYP[e.typ];
    if (!key) continue;
    const titelKey = ES_BA_TITEL[e.typ] ? e.typ : key;
    const g = gruppen.get(titelKey) || { key, titel: ES_BA_TITEL[e.typ] || ES_WAERME[key]?.titel, liste: [] };
    g.liste.push(e);
    gruppen.set(titelKey, g);
  }
  // BHKW nur als Strom-Asset erfasst (Messkonzept kennt es von dort) → trotzdem zeigen
  const kwkAsset = (stromListe || []).filter(e => e.typ === 'KWK' && !e.geplant);
  if (kwkAsset.length && ![...gruppen.values()].some(g => g.key === 'bhkw')) {
    gruppen.set('bhkw', { key: 'bhkw', titel: 'BHKW', liste: kwkAsset.map(e => ({ thermKw: e.props.leistungThKW, elKw: e.props.leistungElKW })) });
  }
  const out = [];
  let fernwaerme = null;
  for (const g of gruppen.values()) {
    const def = ES_WAERME[g.key];
    const th = summe(g.liste, 'thermKw'), el = summe(g.liste, 'elKw');
    if (def.ort === 'quelle') { fernwaerme = { zeile: th ? `${kw(th)} Anschluss` : '' }; continue; }
    const zeile = def.richtung === 'kwk'
      ? [el && kw(el, 'kW el.'), th && kw(th, 'kW th.')].filter(Boolean).join(' · ')
      : th ? kw(th, 'kW th.') : '';
    out.push({ id: g.key + (g.titel !== def.titel ? `-${g.titel}` : ''), key: g.key, titel: anzahlText(g.liste.length, g.titel),
               zeile, icon: def.icon, traeger: def.traeger || null, ort: def.ort, richtung: def.richtung || null, geplant: false });
  }
  const puffer = zahl(ba?.pufferM3);
  if (puffer) out.push({ id: 'speicher', key: 'speicher', titel: 'Pufferspeicher', zeile: `${fmt(puffer, puffer < 10 ? 1 : 0)} m³`,
                         icon: 'tank', ort: 'waerme', traeger: null, speicher: true, geplant: false });
  return { elemente: out, fernwaerme };
}

/**
 * Wärmeseite des Zielbilds aus der Einsatzplanung der aktuellen Variante.
 * @param {{key:string, waermeMwh:number}[]} dispatch  ohne _autoGk — der ist schon in seinen Kesselschlüssel aufgelöst
 */
function esWaermeZiel(dispatch) {
  const liste = (dispatch || []).filter(d => d && d.waermeMwh > 0.05);
  const gesamt = liste.filter(d => d.key !== 'speicher').reduce((s, d) => s + d.waermeMwh, 0);
  const anteil = d => (gesamt > 0 ? `${fmt(Math.round(d.waermeMwh / gesamt * 100))} % der Wärme` : '');
  const out = [];
  let fernwaerme = null;
  // gleicher Schlüssel zweimal (Kessel + automatischer Spitzenlastkessel) → ein Kasten
  const nachKey = new Map();
  for (const d of liste) nachKey.set(d.key, { ...d, waermeMwh: (nachKey.get(d.key)?.waermeMwh || 0) + d.waermeMwh, spitze: d.spitze || nachKey.get(d.key)?.spitze });
  for (const d of nachKey.values()) {
    const def = ES_WAERME[d.key];
    if (!def) continue;
    if (def.ort === 'quelle') { fernwaerme = { zeile: anteil(d) }; continue; }
    out.push({ id: d.key, key: d.key, titel: def.titel, zusatz: d.spitze ? 'Spitzenlast' : '',
               zeile: d.key === 'speicher' ? 'Lastverschiebung' : anteil(d), icon: def.icon, traeger: def.traeger || null,
               ort: def.ort, richtung: def.richtung || null, speicher: d.key === 'speicher', geplant: false });
  }
  return { elemente: out, fernwaerme };
}

/** Reihenfolge auf der Schiene: Brennstoff zuerst (kurze Brennstoffleitungen), Speicher zuletzt. */
const esReihung = e => (e.traeger === 'gas' ? 0 : e.traeger === 'heizoel' ? 1 : e.traeger === 'biomasse' ? 2 : e.speicher ? 9 : 5);

/**
 * @param {object} eingang
 * @param {'ist'|'ziel'} eingang.stand
 * @param {{typ:string, props:object, geplant?:boolean}[]} eingang.strom   Assets (PV, Wind, Batterie, H2, Nsa, Lade, KWK)
 * @param {object} [eingang.waermeIst]   Bestandsanlage (baNormalisiere)
 * @param {{key:string, waermeMwh:number, spitze?:boolean}[]} [eingang.waermeZiel]
 * @param {object} [eingang.netz]        { nb, spannung, ns, trafostationen, anschlussKw, einspKw }
 * @param {object} [eingang.verbrauch]   { gebaeude, stromMwh, stromMaxKw, waermeMwh, heizlastKw }
 * @param {string} [eingang.heizzentrale]  Ort der Heizzentrale (Bestandsanlage) für die Beschriftung der Wärmeschiene
 */
export function esModell(eingang = {}) {
  const ziel = eingang.stand === 'ziel';
  const strom = (eingang.strom || []).filter(e => e && e.typ);
  const stromElemente = esStromElemente(strom, ziel);
  const w = ziel ? esWaermeZiel(eingang.waermeZiel) : esWaermeIst(eingang.waermeIst, strom);
  const kopplung = w.elemente.filter(e => e.ort === 'kopplung').sort((a, b) => esReihung(a) - esReihung(b));
  const waerme = w.elemente.filter(e => e.ort === 'waerme').sort((a, b) => esReihung(a) - esReihung(b));
  const netz = eingang.netz || {};
  const v = eingang.verbrauch || {};

  const traeger = new Set([...kopplung, ...waerme].map(e => e.traeger).filter(Boolean));
  const quellen = ES_QUELLEN.filter(q => q.key === 'strom' || traeger.has(q.key) || (q.key === 'fernwaerme' && w.fernwaerme))
    .map(q => {
      let zeile = '';
      if (q.key === 'strom') zeile = netz.nb || '';
      else if (q.key === 'fernwaerme') zeile = w.fernwaerme?.zeile || '';
      else zeile = q.key === 'gas' ? 'Gasnetz' : 'Anlieferung';
      return { ...q, zeile };
    });

  const hatWaerme = kopplung.length + waerme.length > 0 || !!w.fernwaerme;
  // kurz, weil die Beschriftung neben der Kopplung wenig Platz hat; ausgeschrieben steht die Spannung am Stromnetz links
  const stromSchiene = [
    String(netz.spannung || (netz.ns ? 'Niederspannung' : '')).replace(/^Mittelspannung/, 'MS').replace(/^Niederspannung/, 'NS'),
    netz.trafostationen > 0 ? `${fmt(netz.trafostationen)} Trafostation${netz.trafostationen > 1 ? 'en' : ''}` : '',
  ].filter(Boolean).join(' · ');
  const hz = String(eingang.heizzentrale || '').trim();
  const waermeSchiene = hz ? (/zentrale/i.test(hz) ? hz : `Heizzentrale ${hz}`) : '';

  const fehlt = [];
  if (!(v.stromMwh > 0)) fehlt.push('Stromverbrauch (Lastgang)');
  if (!(v.waermeMwh > 0)) fehlt.push('Wärmebedarf');
  if (!hatWaerme) fehlt.push(ziel ? 'Wärmeerzeuger der Variante (Einsatzplanung)' : 'Bestandsanlage Wärme');

  return {
    stand: ziel ? 'ziel' : 'ist',
    quellen,
    strom: stromElemente,
    kopplung,
    waerme,
    fernwaerme: !!w.fernwaerme,
    lade: esLade(strom, ziel),
    stromSchiene,
    hatWaerme,
    waermeSchiene,
    netzSpannung: netz.spannung || '',
    nap: {
      anschluss: zahl(netz.anschlussKw) ? kw(zahl(netz.anschlussKw), 'kVA') : '',
      einspeisung: zahl(netz.einspKw) ? kw(zahl(netz.einspKw)) : '',
      zweirichtung: !!zahl(netz.einspKw) || stromElemente.some(e => !e.speicher && !e.notstrom) || kopplung.some(e => e.richtung === 'kwk'),
    },
    verbraucher: {
      gebaeude: v.gebaeude > 0 ? v.gebaeude : null,
      strom: v.stromMwh > 0 ? `${fmt(v.stromMwh, v.stromMwh < 10 ? 1 : 0)} MWh/a` : '',
      stromMax: v.stromMaxKw > 0 ? `max. ${kw(v.stromMaxKw)}` : '',
      waerme: v.waermeMwh > 0 ? `${fmt(v.waermeMwh, v.waermeMwh < 10 ? 1 : 0)} MWh/a` : '',
      heizlast: v.heizlastKw > 0 ? `max. ${kw(v.heizlastKw)}` : '',
    },
    fehlt,
  };
}

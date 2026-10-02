// ── lib/gutachten-gebaeude.js — Gebäudebestand und bauliche Entwicklung für das Gutachten (Kapitel 1.3 Hochbau) ──
// DOM- und importfrei (bis auf die Textwerkzeuge der Wärme-Lib), damit Auswertung und Fallunterscheidungen in
// Vitest direkt prüfbar sind.
//
//   gbAuswertung(gebaeude, statsFn, opts)   Zahlen: Ist-Bestand, Jahresverlauf, Ereignisse (Neubau, Abriss, Sanierung)
//   gbTextBestand / gbTextVeraenderung / gbTextEntwicklung   Absätze aus Text und Platzhaltern (siehe lib/gutachten-waerme-texte.js)
//
// Begriffe: Ist-Bestand = Gebäude mit Baujahr VOR dem Stichjahr (Standard 2026); Neubau = Baujahr ab Stichjahr.
// Das Ist-Jahr ist Stichjahr − 1. Die Jahreswerte kommen aus statsFn(gebaeude, jahr) = getComputedStats des Tools:
// { waerme (MWh/a), heizlast (kW), status: 'bestand' | 'saniert' | 'geplant' | 'abgerissen' }.

import { F, wtHilfen } from './gutachten-waerme-texte.js';

const { num, ok, nf, pct, liste, summe, kleinN, absatz } = wtHilfen;

export const GB_STICHJAHR = 2026;

/** Baualtersklassen nach den Wärmeschutz-Meilensteinen (1. WSchV 1977/78, 1995, EnEV 2002, GEG ab 2016). */
export const GB_BAUALTER = [
  { label: 'vor 1949', bis: 1948 }, { label: '1949–1978', bis: 1978 }, { label: '1979–1994', bis: 1994 },
  { label: '1995–2001', bis: 2001 }, { label: '2002–2015', bis: 2015 }, { label: 'ab 2016', bis: Infinity },
];

/** Klassen des spezifischen Wärmebedarfs in kWh/(m²·a). */
export const GB_SPEZ_KLASSEN = [
  { label: 'unter 50', bis: 50 }, { label: '50–100', bis: 100 }, { label: '100–150', bis: 150 },
  { label: '150–200', bis: 200 }, { label: '200–250', bis: 250 }, { label: 'über 250', bis: Infinity },
];

export const GB_SCHWELLEN = {
  spezKwhM2: { sehrNiedrig: 60, niedrig: 100, mittel: 150, hoch: 200 },   // Ø spezifischer Bedarf: Klassengrenzen
  altbestandAnteil: { hoch: 60, mittel: 30 },                              // % der Gebäude vor 1979
  konzentrationTop3: 50,                                                    // % des Bedarfs, ab dem von Großverbrauchern gesprochen wird
  auffaelligkeit: 1.5,                                                      // Vielfaches des Mittelwerts
  sanierungsquoteProzent: { niedrig: 0.6, hoch: 1.0 },                      // „übliche“ Größenordnung 0,7 bis 0,8 % pro Jahr
  heizlastSteigt: 1.2, heizlastSinkt: 0.8, konstantBand: 0.05, zwischenspitze: 0.08,
};

const jahrVon = v => { const j = parseInt(v, 10); return Number.isFinite(j) ? j : null; };
const zahlVon = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

/**
 * Wertet die Gebäude aus.
 * opts: { stichjahr = 2026, bis = 2050, ausgeschlossen = id => false }
 * Ergebnis: { stichjahr, istJahr, endJahr, anzahl: { gesamt, bestand, neubau, abriss, saniert }, ist, jahre, ereignisse, ereignisseJahr }
 */
export function gbAuswertung(gebaeude, statsFn, opts = {}) {
  const stich = opts.stichjahr ?? GB_STICHJAHR;
  const bis = opts.bis ?? 2050;
  const aus = opts.ausgeschlossen || (() => false);
  const geb = (gebaeude || []).filter(g => g && !aus(g.id));
  const ist = stich - 1;
  const bj = g => jahrVon(g.baujahr), aj = g => jahrVon(g.abrissjahr);
  const istNeubau = g => bj(g) !== null && bj(g) >= stich;
  const aktiv = st => st.status === 'bestand' || st.status === 'saniert';
  const stats = (g, y) => statsFn(g, y);

  // Ereignisse je Gebäude
  const ereignisse = [];
  for (const g of geb) {
    const name = g.name || `Gebäude ${g.id}`;
    if (istNeubau(g)) {
      const st = stats(g, bj(g));
      ereignisse.push({ jahr: bj(g), art: 'neubau', name, nutzung: g.nutzung || '', deltaMwh: st.waerme || 0, deltaKw: st.heizlast || 0, flaecheM2: zahlVon(g.flaeche) });
    }
    if (aj(g) !== null && aj(g) >= stich && aj(g) < 9999) {
      const st = stats(g, aj(g) - 1);
      ereignisse.push({ jahr: aj(g), art: 'abriss', name, nutzung: g.nutzung || '', deltaMwh: -(st.waerme || 0), deltaKw: -(st.heizlast || 0), flaecheM2: -zahlVon(g.flaeche) });
    }
    for (const s of g.sanierungen || []) {
      if (!(s.jahr >= stich)) continue;
      const vor = stats(g, s.jahr - 1), nach = stats(g, s.jahr);
      if (!aktiv(nach)) continue;
      ereignisse.push({
        jahr: s.jahr, art: 'sanierung', name, nutzung: g.nutzung || '', deltaMwh: (nach.waerme || 0) - (vor.waerme || 0), deltaKw: (nach.heizlast || 0) - (vor.heizlast || 0),
        flaecheM2: 0, vorSpez: vor.spez, nachSpez: nach.spez,
      });
    }
  }
  ereignisse.sort((a, b) => a.jahr - b.jahr || a.art.localeCompare(b.art) || a.name.localeCompare(b.name, 'de'));
  const ereignisseJahr = [];
  for (const e of ereignisse) {
    let x = ereignisseJahr.find(y => y.jahr === e.jahr && y.art === e.art);
    if (!x) ereignisseJahr.push(x = { jahr: e.jahr, art: e.art, anzahl: 0, deltaMwh: 0, deltaKw: 0, namen: [] });
    x.anzahl++; x.deltaMwh += e.deltaMwh; x.deltaKw += e.deltaKw; x.namen.push(e.name);
  }

  // Jahresverlauf: vom Ist-Jahr bis zum letzten Ereignis (höchstens bis `bis`)
  const endJahr = ereignisse.length ? Math.min(bis, Math.max(...ereignisse.map(e => e.jahr))) : ist;
  const jahre = [];
  for (let y = ist; y <= endJahr; y++) {
    const j = {
      jahr: y, anzahl: 0, bedarfMwh: 0, heizlastKw: 0, flaecheM2: 0, flaecheMitBedarf: 0, bedarfMitFlaeche: 0, heizlastMitFlaeche: 0,
      segmente: { unsaniert: { bedarfMwh: 0, heizlastKw: 0, flaecheM2: 0, anzahl: 0 }, saniert: { bedarfMwh: 0, heizlastKw: 0, flaecheM2: 0, anzahl: 0 }, neubau: { bedarfMwh: 0, heizlastKw: 0, flaecheM2: 0, anzahl: 0 } },
    };
    for (const g of geb) {
      const st = stats(g, y);
      if (!aktiv(st)) continue;
      const seg = j.segmente[istNeubau(g) ? 'neubau' : st.status === 'saniert' ? 'saniert' : 'unsaniert'];
      const fl = zahlVon(g.flaeche);
      j.anzahl++; seg.anzahl++;
      j.bedarfMwh += st.waerme || 0; seg.bedarfMwh += st.waerme || 0;
      j.heizlastKw += st.heizlast || 0; seg.heizlastKw += st.heizlast || 0;
      j.flaecheM2 += fl; seg.flaecheM2 += fl;
      if (fl > 0) { j.flaecheMitBedarf += fl; j.bedarfMitFlaeche += st.waerme || 0; j.heizlastMitFlaeche += st.heizlast || 0; }
    }
    j.spezKwhM2 = j.flaecheMitBedarf > 0 ? (j.bedarfMitFlaeche * 1000) / j.flaecheMitBedarf : NaN;
    j.spezWM2 = j.flaecheMitBedarf > 0 ? (j.heizlastMitFlaeche * 1000) / j.flaecheMitBedarf : NaN;
    jahre.push(j);
  }

  return {
    stichjahr: stich, istJahr: ist, endJahr, bis,
    anzahl: {
      gesamt: geb.length, neubau: geb.filter(istNeubau).length, bestand: geb.length - geb.filter(istNeubau).length,
      abriss: geb.filter(g => aj(g) !== null && aj(g) >= stich && aj(g) < 9999).length,
      saniert: geb.filter(g => (g.sanierungen || []).some(s => s.jahr >= stich)).length,
    },
    ist: gbIst(geb.filter(g => !istNeubau(g)), statsFn, ist, jahre[0]),
    jahre, ereignisse, ereignisseJahr,
  };
}

/** Auswertung des Ist-Bestands: Nutzung, Baualter, spezifische Verbräuche, Großverbraucher, Datenherkunft. */
function gbIst(bestand, statsFn, istJahr, jahr0) {
  const zeilen = bestand.map(g => {
    const st = statsFn(g, istJahr);
    const fl = zahlVon(g.flaeche);
    const bedarf = st.waerme || 0;
    return {
      id: g.id, name: g.name || `Gebäude ${g.id}`, nutzung: g.nutzung || 'ohne Angabe', baujahr: jahrVon(g.baujahr), flaecheM2: fl,
      bedarfMwh: bedarf, heizlastKw: st.heizlast || 0, spezKwhM2: fl > 0 && bedarf > 0 ? (bedarf * 1000) / fl : NaN,
      aktiv: st.status === 'bestand' || st.status === 'saniert', gesetzt: !!(g.waermeManual || g.heizlastManual),
    };
  }).filter(z => z.aktiv);

  const gruppe = (schluesselFn, vorgabe) => {
    const m = new Map(vorgabe ? vorgabe.map(v => [v, { label: v, anzahl: 0, flaecheM2: 0, bedarfMwh: 0 }]) : []);
    for (const z of zeilen) {
      const k = schluesselFn(z);
      if (!m.has(k)) m.set(k, { label: k, anzahl: 0, flaecheM2: 0, bedarfMwh: 0 });
      const x = m.get(k); x.anzahl++; x.flaecheM2 += z.flaecheM2; x.bedarfMwh += z.bedarfMwh;
    }
    return [...m.values()];
  };
  const nutzung = gruppe(z => z.nutzung).sort((a, b) => b.bedarfMwh - a.bedarfMwh);
  const klasseAlter = z => (z.baujahr === null ? 'ohne Angabe' : GB_BAUALTER.find(k => z.baujahr <= k.bis).label);
  const baualter = gruppe(klasseAlter, GB_BAUALTER.map(k => k.label));
    const mitSpez = zeilen.filter(z => ok(z.spezKwhM2));
  const spezKlassen = GB_SPEZ_KLASSEN.map(k => ({ label: k.label, bis: k.bis, anzahl: 0, bedarfMwh: 0 }));
  for (const z of mitSpez) { const k = spezKlassen.find(x => z.spezKwhM2 < x.bis); k.anzahl++; k.bedarfMwh += z.bedarfMwh; }
  const jahreMitBj = zeilen.map(z => z.baujahr).filter(j => j !== null).sort((a, b) => a - b);
  const median = jahreMitBj.length ? (jahreMitBj.length % 2 ? jahreMitBj[(jahreMitBj.length - 1) / 2] : (jahreMitBj[jahreMitBj.length / 2 - 1] + jahreMitBj[jahreMitBj.length / 2]) / 2) : NaN;
  const nachBedarf = [...zeilen].sort((a, b) => b.bedarfMwh - a.bedarfMwh);
  const nachSpez = [...mitSpez].sort((a, b) => b.spezKwhM2 - a.spezKwhM2);
  const bedarf = summe(zeilen, z => z.bedarfMwh);
  const vor1979 = zeilen.filter(z => z.baujahr !== null && z.baujahr <= 1978);
  return {
    anzahl: zeilen.length, flaecheM2: summe(zeilen, z => z.flaecheM2), bedarfMwh: bedarf, heizlastKw: summe(zeilen, z => z.heizlastKw),
    spezKwhM2: jahr0?.spezKwhM2 ?? NaN, spezWM2: jahr0?.spezWM2 ?? NaN,
    nutzung, baualter, spezKlassen, baujahrMittel: jahreMitBj.length ? summe(jahreMitBj, x => x) / jahreMitBj.length : NaN, baujahrMedian: median,
    anteilVor1979Pct: zeilen.length ? (vor1979.length / zeilen.length) * 100 : NaN,
    bedarfVor1979Pct: bedarf > 0 ? (summe(vor1979, z => z.bedarfMwh) / bedarf) * 100 : NaN,
    ohneBaujahr: zeilen.filter(z => z.baujahr === null).length, ohneFlaeche: zeilen.filter(z => !(z.flaecheM2 > 0)).length,
    gesetzt: zeilen.filter(z => z.gesetzt).length, geschaetzt: zeilen.filter(z => !z.gesetzt).length,
    top: nachBedarf.slice(0, 3).map(z => ({ name: z.name, bedarfMwh: z.bedarfMwh, anteilPct: bedarf > 0 ? (z.bedarfMwh / bedarf) * 100 : 0 })),
    top3AnteilPct: bedarf > 0 ? (summe(nachBedarf.slice(0, 3), z => z.bedarfMwh) / bedarf) * 100 : NaN,
    hoechsterSpez: nachSpez[0] || null, niedrigsterSpez: nachSpez[nachSpez.length - 1] || null,
    zeilen: nachBedarf,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Texte
 * ═══════════════════════════════════════════════════════════════════════ */
const spezKlasse = v => {
  const s = GB_SCHWELLEN.spezKwhM2;
  return v < s.sehrNiedrig ? 'sehrNiedrig' : v < s.niedrig ? 'niedrig' : v < s.mittel ? 'mittel' : v < s.hoch ? 'hoch' : 'sehrHoch';
};
export { spezKlasse as gbSpezKlasse };

const art = { neubau: 'Neubau', abriss: 'Abriss', sanierung: 'energetische Sanierung' };

/** 1.3.1 Gebäudebestand (Ist). */
export function gbTextBestand(a, o = {}) {
  const i = a.ist;
  const out = [];
  if (!i || i.anzahl === 0) {
    out.push(absatz(`Es besteht kein Gebäudebestand: Gebäude mit Baujahr vor ${a.stichjahr} sind nicht vorhanden. Die Liegenschaft besteht ausschließlich aus geplanten Neubauten; sie sind in Kapitel 1.3.2 beschrieben.`));
    return out;
  }
  out.push(absatz(`Der Gebäudebestand (Baujahr vor ${a.stichjahr}) umfasst ${nf(i.anzahl)} ${kleinN(i.anzahl, 'Gebäude', 'Gebäude')}`
    + (i.flaecheM2 > 0 ? ` mit zusammen ${nf(i.flaecheM2)} m² Fläche` : '')
    + `. Der Wärmebedarf beträgt ${nf(i.bedarfMwh)} MWh pro Jahr, die Summe der Einzelheizlasten ${nf(i.heizlastKw)} kW.`
    + ' Die Summe der Einzelheizlasten ist nicht die Spitzenlast der Liegenschaft; diese liegt wegen der Gleichzeitigkeit niedriger (Kapitel 2.2).'));

  // Nutzung
  if (i.nutzung.length === 1) {
    out.push(absatz(`Der gesamte Bestand wird als ${i.nutzung[0].label} genutzt.`));
  } else if (i.nutzung.length > 1 && i.bedarfMwh > 0) {
    const top = i.nutzung.slice(0, 3).map(n => `${n.label} (${pct((n.bedarfMwh / i.bedarfMwh) * 100)}, ${nf(n.anzahl)} ${kleinN(n.anzahl, 'Gebäude', 'Gebäude')})`);
    out.push(absatz(`Nach Nutzung entfällt der Wärmebedarf vor allem auf ${liste(top)}`
      + (i.nutzung.length > 3 ? `; hinzu kommen ${nf(i.nutzung.length - 3)} weitere Nutzungsarten` : '') + '.'));
  }

  // Baualter
  if (ok(i.baujahrMittel)) {
    const a79 = i.anteilVor1979Pct;
    const klass = a79 >= GB_SCHWELLEN.altbestandAnteil.hoch ? 'Der Bestand ist überwiegend unsanierter Altbestand mit entsprechend hohem Einsparpotenzial.'
      : a79 >= GB_SCHWELLEN.altbestandAnteil.mittel ? 'Ein bedeutender Teil des Bestands ist Altbestand mit Einsparpotenzial; daneben steht jüngerer Bestand.'
        : 'Der Bestand ist überwiegend jüngeren Datums; das Einsparpotenzial durch Sanierung ist geringer.';
    out.push(absatz(`Das mittlere Baujahr liegt bei ${Math.round(i.baujahrMittel)} (Median ${Math.round(i.baujahrMedian)}). ${pct(a79)} der Gebäude und ${pct(i.bedarfVor1979Pct)} des Wärmebedarfs entfallen auf Gebäude, die vor 1979, also vor der ersten Wärmeschutzverordnung, errichtet wurden. ${klass}`));
  }

  // Spezifischer Bedarf
  if (ok(i.spezKwhM2)) {
    const klasse = spezKlasse(i.spezKwhM2);
    const bereich = i.spezKlassen.filter(k => k.anzahl > 0);
    const haupt = [...bereich].sort((x, y) => y.anzahl - x.anzahl)[0];
    out.push(absatz(`Der flächengewichtete spezifische Wärmebedarf beträgt ${nf(i.spezKwhM2)} kWh/(m²·a), die spezifische Heizlast ${nf(i.spezWM2)} W/m². `, {
      sehrNiedrig: 'Das ist ein sehr niedriger Wert, wie er für Neubauten oder weitgehend sanierte Gebäude typisch ist.',
      niedrig: 'Das ist ein niedriger Wert, der auf gedämmte oder jüngere Gebäude hindeutet.',
      mittel: 'Das ist ein mittlerer Wert, wie er für teilsanierten Bestand typisch ist.',
      hoch: 'Das ist ein hoher Wert, der auf überwiegend unsanierten Bestand hindeutet.',
      sehrHoch: 'Das ist ein sehr hoher Wert, der erheblichen Sanierungsbedarf anzeigt.',
    }[klasse], haupt ? ` Die meisten Gebäude (${nf(haupt.anzahl)} von ${nf(summe(bereich, k => k.anzahl))}) liegen im Bereich ${haupt.label} kWh/(m²·a).` : ''));
  }

  // Konzentration und Auffälligkeiten
  if (i.anzahl > 3 && ok(i.top3AnteilPct)) {
    out.push(absatz(i.top3AnteilPct >= GB_SCHWELLEN.konzentrationTop3
      ? `Wenige Großverbraucher bestimmen den Bedarf: ${liste(i.top.map(t => t.name))} stehen zusammen für ${pct(i.top3AnteilPct)} des Wärmebedarfs. Sie sind für Wärmeversorgung und Netzauslegung besonders maßgebend.`
      : `Der Bedarf verteilt sich auf viele Gebäude; die drei größten Verbraucher (${liste(i.top.map(t => t.name))}) stehen zusammen für ${pct(i.top3AnteilPct)}.`));
  }
  const h = i.hoechsterSpez, n = i.niedrigsterSpez;
  if (h && ok(i.spezKwhM2) && i.anzahl > 1) {
    const teile = [];
    if (h.spezKwhM2 >= i.spezKwhM2 * GB_SCHWELLEN.auffaelligkeit) teile.push(`${h.name} mit ${nf(h.spezKwhM2)} kWh/(m²·a) liegt beim ${nf(h.spezKwhM2 / i.spezKwhM2, 1)}-Fachen des Mittelwerts und ist eine Priorität für Sanierungsmaßnahmen`);
    if (n && n !== h && n.spezKwhM2 <= i.spezKwhM2 / GB_SCHWELLEN.auffaelligkeit) teile.push(`${n.name} mit ${nf(n.spezKwhM2)} kWh/(m²·a) liegt deutlich unter dem Mittelwert`);
    if (teile.length) out.push(absatz(`Auffällig: ${teile.join('; ')}.`));
  }

  // Datenherkunft
  const g = i.gesetzt, s = i.geschaetzt;
  out.push(absatz(g === 0
    ? `Die Wärmebedarfe und Heizlasten aller ${nf(i.anzahl)} Gebäude sind Schätzwerte aus Fläche, Baujahr und Nutzung auf Basis üblicher Gebäudetypologien (IWU/TABULA); gesetzte oder gemessene Gebäudewerte liegen nicht vor.`
    : s === 0
      ? `Die Wärmebedarfe und Heizlasten aller ${nf(i.anzahl)} Gebäude sind vorgegebene Werte (Messung, Abrechnung oder Eingabe).`
      : `Von ${nf(i.anzahl)} Gebäuden beruhen ${nf(g)} auf vorgegebenen Werten (Messung, Abrechnung oder Eingabe), ${nf(s)} auf Schätzwerten aus Fläche, Baujahr und Nutzung (IWU/TABULA).`));
  const luecken = [];
  if (i.ohneBaujahr > 0) luecken.push(`${nf(i.ohneBaujahr)} ${kleinN(i.ohneBaujahr, 'Gebäude ohne Baujahr (als Bestand ohne Altersklasse geführt)', 'Gebäude ohne Baujahr (als Bestand ohne Altersklasse geführt)')}`);
  if (i.ohneFlaeche > 0) luecken.push(`${nf(i.ohneFlaeche)} ${kleinN(i.ohneFlaeche, 'Gebäude ohne Flächenangabe', 'Gebäude ohne Flächenangabe')} (bei den flächenbezogenen Kennwerten nicht berücksichtigt)`);
  if (luecken.length) out.push(absatz(`Lücken in den Gebäudedaten: ${liste(luecken)}.`));
  if (o.quelleGebaeude) out.push(absatz(`Die Gebäudedaten stammen aus ${o.quelleGebaeude}.`));
  else out.push(absatz('Die Gebäudedaten (Fläche, Baujahr, Nutzung) stammen aus ', F('Quelle der Gebäudedaten, z. B. Liegenschaftsunterlagen, Begehung, OSM'), '.'));
  return out;
}

/** 1.3.2 Bauliche Veränderungen (Abriss, Sanierung, Neubau). */
export function gbTextVeraenderung(a) {
  const out = [];
  const ev = a.ereignisse;
  const ist = a.ist;
  const stich = a.stichjahr;
  if (!ev.length) {
    out.push(absatz(`Bauliche Veränderungen (Neubau, Abriss, energetische Sanierung) sind ab ${stich} nicht hinterlegt. Der Gebäudebestand bleibt im Betrachtungszeitraum unverändert; der Soll-Bedarf entspricht dem Ist-Bedarf. Geplante Veränderungen sind ergänzt durch `, F('geplante bauliche Veränderungen'), '.'));
    return out;
  }
  const von = ev.map(e => e.jahr), j0 = Math.min(...von), j1 = Math.max(...von);
  const nGeb = new Set(ev.map(e => e.name)).size;
  out.push(absatz(`Ab ${stich} sind ${nf(ev.length)} bauliche ${kleinN(ev.length, 'Veränderung', 'Veränderungen')} an ${nf(nGeb)} ${kleinN(nGeb, 'Gebäude', 'Gebäuden')} vorgesehen, zeitlich verteilt zwischen ${j0} und ${j1}`
    + (a.anzahl.bestand === 0 ? '. Die Liegenschaft besteht ausschließlich aus Neubauten.' : `: ${liste([a.anzahl.neubau ? `${nf(a.anzahl.neubau)} Neubau${a.anzahl.neubau === 1 ? '' : 'ten'}` : '', a.anzahl.abriss ? `${nf(a.anzahl.abriss)} ${kleinN(a.anzahl.abriss, 'Abriss', 'Abrisse')}` : '', a.anzahl.saniert ? `${nf(a.anzahl.saniert)} ${kleinN(a.anzahl.saniert, 'Sanierung', 'Sanierungen')}` : ''].filter(Boolean))}.`)));

  const gruppe = k => ev.filter(e => e.art === k);
  const jahresrang = liste_ => { const m = new Map(); for (const e of liste_) m.set(e.jahr, (m.get(e.jahr) || 0) + 1); return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]; };
  const spanneText = l => { const a1 = Math.min(...l.map(e => e.jahr)), a2 = Math.max(...l.map(e => e.jahr)); return a1 === a2 ? `im Jahr ${a1}` : `zwischen ${a1} und ${a2}`; };

  const nb = gruppe('neubau');
  if (nb.length) {
    const mwh = summe(nb, e => e.deltaMwh), kw = summe(nb, e => e.deltaKw), fl = summe(nb, e => e.flaecheM2);
    const spez = fl > 0 && mwh > 0 ? (mwh * 1000) / fl : NaN;
    const p = [`Neubau: ${nf(nb.length)} ${kleinN(nb.length, 'Gebäude wird', 'Gebäude werden')} ${spanneText(nb)} errichtet`, fl > 0 ? ` (zusammen ${nf(fl)} m² Fläche)` : '',
      `. Sie erhöhen den Wärmebedarf um ${nf(mwh)} MWh pro Jahr und die Summe der Einzelheizlasten um ${nf(kw)} kW.`];
    if (ok(spez) && ist && ok(ist.spezKwhM2) && ist.anzahl > 0) {
      const d = ((spez - ist.spezKwhM2) / ist.spezKwhM2) * 100;
      p.push(` Mit durchschnittlich ${nf(spez)} kWh/(m²·a) liegen die Neubauten ${Math.abs(d) < 5 ? 'auf dem Niveau des Bestands' : `${pct(Math.abs(d))} ${d < 0 ? 'unter' : 'über'} dem Bestand (${nf(ist.spezKwhM2)} kWh/(m²·a))`}.`);
    } else if (ok(spez)) p.push(` Der durchschnittliche spezifische Bedarf beträgt ${nf(spez)} kWh/(m²·a).`);
    const rang = nb.length > 1 ? jahresrang(nb) : null;
    if (rang && rang[1] > 1) p.push(` Schwerpunkt ist das Jahr ${rang[0]} mit ${nf(rang[1])} Neubauten.`);
    if (nb.length <= 4) p.push(` Betroffen: ${liste(nb.map(e => e.name))}.`);
    out.push(absatz(...p));
  }

  const ab = gruppe('abriss');
  if (ab.length) {
    const mwh = -summe(ab, e => e.deltaMwh), kw = -summe(ab, e => e.deltaKw);
    const anteil = ist && ist.anzahl > 0 ? (ab.length / ist.anzahl) * 100 : NaN;
    out.push(absatz(`Abriss: ${nf(ab.length)} ${kleinN(ab.length, 'Gebäude wird', 'Gebäude werden')} ${spanneText(ab)} abgerissen`, ok(anteil) ? ` (${pct(anteil, 1)} des Bestands)` : '',
      `. Dadurch entfallen ${nf(mwh)} MWh Wärmebedarf pro Jahr und ${nf(kw)} kW Heizlast.`, ab.length <= 4 ? ` Betroffen: ${liste(ab.map(e => e.name))}.` : '',
      ist && ist.anzahl > 0 && ab.length / ist.anzahl > 0.3 ? ' Der Abriss betrifft einen erheblichen Teil des Bestands und verändert die Struktur der Wärmeabnahme deutlich; die Netztrasse ist darauf zu überprüfen.' : ''));
  }

  const sa = gruppe('sanierung');
  if (sa.length) {
    const mwh = -summe(sa, e => e.deltaMwh), kw = -summe(sa, e => e.deltaKw);
    const spanne = Math.max(1, a.endJahr - stich + 1);
    const quote = ist && ist.anzahl > 0 ? (new Set(sa.map(e => e.name)).size / ist.anzahl / spanne) * 100 : NaN;
    const mitSpez = sa.filter(e => ok(num(e.vorSpez)) && ok(num(e.nachSpez)) && e.vorSpez > 0);
    const einsparung = mitSpez.length ? (summe(mitSpez, e => (e.vorSpez - e.nachSpez) / e.vorSpez) / mitSpez.length) * 100 : NaN;
    const q = GB_SCHWELLEN.sanierungsquoteProzent;
    const p = [`Energetische Sanierung: ${nf(sa.length)} ${kleinN(sa.length, 'Gebäude wird', 'Gebäude werden')} ${spanneText(sa)} saniert. Der Wärmebedarf sinkt dadurch um ${nf(mwh)} MWh pro Jahr, die Heizlast um ${nf(kw)} kW`];
    if (ok(einsparung)) p.push(` (im Mittel ${pct(einsparung)} je Gebäude)`);
    p.push('.');
    if (ok(quote)) {
      p.push(` Bezogen auf den Bestand entspricht das einer Sanierungsquote von ${nf(quote, 2)} % pro Jahr. `);
      p.push(quote < q.niedrig ? 'Das liegt unter der in Deutschland derzeit üblichen Größenordnung von 0,7 bis 0,8 % pro Jahr.'
        : quote > q.hoch ? 'Das liegt deutlich über der in Deutschland derzeit üblichen Größenordnung von 0,7 bis 0,8 % pro Jahr; die Annahme ist ambitioniert und sollte durch Maßnahmenplanung und Finanzierung hinterlegt sein.'
          : 'Das liegt in der in Deutschland derzeit üblichen Größenordnung von 0,7 bis 0,8 % pro Jahr.');
    }
    if (sa.length <= 4) p.push(` Betroffen: ${liste(sa.map(e => e.name))}.`);
    out.push(absatz(...p));
  }

  // Bilanz am Ende des Betrachtungszeitraums
  const j = a.jahre;
  if (j.length >= 2) {
    const j0b = j[0], j1b = j[j.length - 1];
    const netto = j1b.bedarfMwh - j0b.bedarfMwh;
    const teile = [];
    const mwh = (k) => summe(gruppe(k), e => e.deltaMwh);
    if (nb.length) teile.push(`Neubau ${mwh('neubau') >= 0 ? '+' : '−'}${nf(Math.abs(mwh('neubau')))} MWh`);
    if (ab.length) teile.push(`Abriss −${nf(Math.abs(mwh('abriss')))} MWh`);
    if (sa.length) teile.push(`Sanierung −${nf(Math.abs(mwh('sanierung')))} MWh`);
    out.push(absatz(`In der Bilanz ${netto > 0.5 ? 'steigt' : netto < -0.5 ? 'sinkt' : 'bleibt'} der Wärmebedarf bis ${j1b.jahr} ${Math.abs(netto) > 0.5 ? `um ${nf(Math.abs(netto))} MWh pro Jahr (${teile.join(', ')})` : 'nahezu unverändert'}. `,
      'Die zeitliche Abfolge und die Auswirkungen auf Heizlast und spezifischen Bedarf zeigt Kapitel 1.3.3.'));
  }
  return out;
}

/** 1.3.3 Entwicklung von Wärmebedarf und Heizlast. */
export function gbTextEntwicklung(a, o = {}) {
  const out = [];
  const j = a.jahre;
  if (j.length < 2) {
    const j0 = j[0];
    out.push(absatz(j0 && j0.bedarfMwh > 0
      ? `Da keine baulichen Veränderungen hinterlegt sind, bleiben Wärmebedarf (${nf(j0.bedarfMwh)} MWh/a), Summe der Heizlasten (${nf(j0.heizlastKw)} kW) und spezifischer Bedarf im Betrachtungszeitraum konstant. Eine zeitliche Entwicklung ist nicht darzustellen.`
      : 'Es liegen keine Gebäudedaten für eine Entwicklung von Wärmebedarf und Heizlast vor.'));
    return out;
  }
  const first = j[0], last = j[j.length - 1];
  const pv = (x, y) => (x > 0 ? ((y - x) / x) * 100 : NaN);
  const rich = d => (d > 0.5 ? 'steigt' : d < -0.5 ? 'sinkt' : 'bleibt');
  const dB = pv(first.bedarfMwh, last.bedarfMwh), dH = pv(first.heizlastKw, last.heizlastKw);
  const maxH = j.reduce((m, x) => (x.heizlastKw > m.heizlastKw ? x : m), j[0]);
  const maxB = j.reduce((m, x) => (x.bedarfMwh > m.bedarfMwh ? x : m), j[0]);

  // Bedarf
  out.push(absatz(first.bedarfMwh > 0
    ? `Der Wärmebedarf der Liegenschaft ${rich(dB)} von ${nf(first.bedarfMwh)} MWh/a im Ist-Zustand (${first.jahr}) auf ${nf(last.bedarfMwh)} MWh/a im Jahr ${last.jahr}${Math.abs(dB) > 0.5 ? ` (${dB > 0 ? '+' : '−'}${pct(Math.abs(dB), 1)})` : ''}.`
      + (maxB !== last && maxB !== first && maxB.bedarfMwh > Math.max(first.bedarfMwh, last.bedarfMwh) * 1.01 ? ` Zwischenzeitlich erreicht er im Jahr ${maxB.jahr} mit ${nf(maxB.bedarfMwh)} MWh/a sein Maximum.` : '')
    : `Im Ist-Zustand (${first.jahr}) besteht kein Wärmebedarf. Er entsteht erst durch die Neubauten und erreicht im Jahr ${last.jahr} ${nf(last.bedarfMwh)} MWh/a.`));

  // Heizlast
  if (first.heizlastKw > 0) {
    out.push(absatz(`Die Summe der Einzelheizlasten ${rich(dH)} von ${nf(first.heizlastKw)} kW auf ${nf(last.heizlastKw)} kW${Math.abs(dH) > 0.5 ? ` (${dH > 0 ? '+' : '−'}${pct(Math.abs(dH), 1)})` : ''}.`,
      Math.abs(dH - dB) >= 5 && ok(dH) && ok(dB) ? ` Die Heizlast ${dH > dB ? 'steigt stärker bzw. sinkt schwächer' : 'steigt schwächer bzw. sinkt stärker'} als der Jahreswärmebedarf, weil Sanierung und Neubau Leistung und Arbeit unterschiedlich verändern.` : ''));
  } else if (last.heizlastKw > 0) {
    out.push(absatz(`Die Summe der Einzelheizlasten erreicht im Jahr ${last.jahr} ${nf(last.heizlastKw)} kW.`));
  }

  // Spezifische Werte
  if (ok(first.spezKwhM2) && ok(last.spezKwhM2)) {
    const d = pv(first.spezKwhM2, last.spezKwhM2);
    out.push(absatz(`Der flächengewichtete spezifische Wärmebedarf ${rich(d)} von ${nf(first.spezKwhM2)} auf ${nf(last.spezKwhM2)} kWh/(m²·a)${Math.abs(d) > 0.5 ? ` (${d > 0 ? '+' : '−'}${pct(Math.abs(d), 1)})` : ''}. `,
      d < -2 ? 'Treiber sind die energetische Sanierung und die effizienteren Neubauten.' : d > 2 ? 'Der Anstieg beruht darauf, dass Gebäude mit hohem spezifischem Bedarf hinzukommen oder effiziente Gebäude entfallen.' : 'Sanierung und Neubau gleichen sich im spezifischen Bedarf aus.'));
  } else if (ok(last.spezKwhM2)) {
    out.push(absatz(`Der flächengewichtete spezifische Wärmebedarf beträgt im Jahr ${last.jahr} ${nf(last.spezKwhM2)} kWh/(m²·a).`));
  }

  // Verlauf und Folgerung für die Auslegung
  if (first.heizlastKw > 0) {
    const ratioEnd = last.heizlastKw / first.heizlastKw, ratioMax = maxH.heizlastKw / first.heizlastKw;
    const s = GB_SCHWELLEN;
    let folge;
    if (ratioMax >= s.heizlastSteigt && maxH === last) {
      folge = `Die Heizlast wächst bis ${last.jahr} auf das ${nf(ratioEnd, 2)}-Fache des Ist-Werts. Die Wärmeerzeugung ist deshalb auf den späteren Bedarf auszulegen oder modular und stufenweise auszubauen; eine Auslegung auf den heutigen Bestand wäre zu klein.`;
    } else if (ratioMax >= s.heizlastSteigt) {
      folge = `Die Heizlast steigt zunächst bis ${maxH.jahr} auf ${nf(maxH.heizlastKw)} kW (${nf(ratioMax, 2)}-Faches des Ist-Werts) und sinkt danach auf ${nf(last.heizlastKw)} kW. Maßgebend für die Auslegung ist das Maximum im Jahr ${maxH.jahr}; der spätere Rückgang spricht dafür, die Leistung modular zu halten, um keine dauerhaft überdimensionierte Anlage zu errichten.`;
    } else if (ratioEnd <= s.heizlastSinkt) {
      folge = `Die Heizlast sinkt bis ${last.jahr} um ${pct((1 - ratioEnd) * 100)}. Eine Auslegung auf die heutige Spitzenlast würde zu einer dauerhaft überdimensionierten Anlage führen; der Sanierungsfortschritt ist bei der Dimensionierung und beim Zeitpunkt der Erneuerung zu berücksichtigen.`;
    } else if (Math.abs(ratioEnd - 1) <= s.konstantBand && ratioMax >= 1 + s.zwischenspitze && maxH !== first && maxH !== last) {
      folge = `Am Ende des Betrachtungszeitraums liegt die Heizlast nahezu auf dem heutigen Wert, steigt aber zwischenzeitlich bis ${maxH.jahr} auf ${nf(maxH.heizlastKw)} kW (${pct((ratioMax - 1) * 100)} über dem Ist-Wert). Diese Spitze ist bei der Auslegung zu berücksichtigen; sie kann durch eine modulare, zeitlich gestaffelte Leistung abgedeckt werden.`;
    } else if (Math.abs(ratioEnd - 1) <= s.konstantBand && ratioMax < 1 + s.zwischenspitze) {
      folge = 'Die Heizlast bleibt im Betrachtungszeitraum nahezu konstant; die Auslegung kann sich am heutigen Wert orientieren.';
    } else {
      folge = ratioEnd > 1
        ? `Die Heizlast steigt moderat um ${pct((ratioEnd - 1) * 100)}; eine Reserve in dieser Größenordnung sollte in der Auslegung vorgesehen werden.`
        : `Die Heizlast sinkt moderat um ${pct((1 - ratioEnd) * 100)}; die Auslegung kann auf den heutigen Wert erfolgen, eine spätere Leistungsanpassung ist nicht zwingend.`;
    }
    out.push(absatz(folge));
  }
  if (ok(num(o.lastgangJahr))) out.push(absatz(`Für den Soll-Lastgang in Kapitel 2.2 ist das Jahr ${o.lastgangJahr} maßgebend.`));
  out.push(absatz('Die Entwicklung beruht ausschließlich auf den hinterlegten baulichen Veränderungen (Neubau, Abriss, energetische Sanierung). Änderungen des Nutzerverhaltens, der Witterung durch den Klimawandel, der Nutzung und weitere Nachverdichtung sind nicht berücksichtigt.'));
  return out;
}

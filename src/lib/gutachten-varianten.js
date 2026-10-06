// ── lib/gutachten-varianten.js — Ergänzende Gutachtentexte zum Variantenvergleich Wärme ──
// Rahmenbedingungen (Preise, PEF, CO₂-Faktoren), Zweistoffbrenner als Resilienz- und Spitzenlasteinheit, Gegenüberstellung
// der Varianten, Klimarelevanz heute/künftig/kumuliert mit Referenzszenarien, Kostenkomponenten, PV-Eigenstrom und
// Energiepreissensitivität. DOM-frei; Variantendaten wie in wtNormalisiere (name, erzeuger[{key, leistungKw, waermeMwh, elMwh}],
// co2T, co2LzT, jahreskostenEur, wgkCt).
import { F, wtHilfen } from './gutachten-waerme-texte.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;
const L = kw => (kw >= 1000 ? `${nf(kw / 1000, 1)} MW` : `${nf(kw)} kW`);

/** Primärenergiefaktoren nicht erneuerbar nach GEG Anlage 4. */
export const VA_PEF = Object.freeze({ Erdgas: 1.1, Heizöl: 1.1, Strom: 1.8, Holz: 0.2, Fernwärme: 0.7 });

/** Quelle des CO₂-Kostenansatzes (Vorgabe des Auftraggebers). */
export const VA_CO2_QUELLE = 'gemäß EEFB';

/** Bezugszeitraum und Quellen des Strom-Emissionsfaktors: heute (UBA, Strommix inkl. Vorketten), künftig Mittel 2030–2050 (IINAS). */
export const VA_STROM_EF = Object.freeze({ quelleHeute: 'UBA, Strommix inkl. Vorketten', quelleLz: 'IINAS, Mittel 2030–2050', von: 2030, bis: 2050 });

/** Brennstoff-Wirkungsgrade für die Aufteilung der Energiekosten nach Energieträger. */
export const VA_ETA = Object.freeze({ gaskessel: 0.92, _autoGk: 0.92, heizoel: 0.92, pellets: 0.9, hhs: 0.85, bhkwTh: 0.5, stromkessel: 0.99, fernwaerme: 1 });

const WP = new Set(['lwwp', 'geo', 'fg']);
const KESSEL_FOSSIL = new Set(['gaskessel', '_autoGk', 'heizoel']);

/** Energiebilanz einer Variante je Energieträger (MWh Endenergie) und Anteile an der Wärme. */
export function vaEnergie(v) {
  const e = {};
  const eta = { ...VA_ETA, ...(v.eta || {}) };   // Wirkungsgrade aus den Erzeuger-Panels, sonst Standard
  let waerme = 0, wp = 0, sk = 0, fossil = 0, strom = 0, gas = 0, oel = 0, pellets = 0, hhs = 0, fw = 0;
  for (const x of v.erzeuger || []) {
    const w = Number(x.waermeMwh) || 0, el = Number(x.elMwh) || 0;
    if (x.key === '_thermSpeicher') continue;
    waerme += w;
    if (WP.has(x.key)) { wp += w; strom += el > 0 ? el : 0; }
    else if (x.key === 'stromkessel') { sk += w; strom += el > 0 ? el : w / eta.stromkessel; }
    else if (x.key === 'gaskessel' || x.key === '_autoGk') { fossil += w; gas += w / eta.gaskessel; }
    else if (x.key === 'heizoel') { fossil += w; oel += w / eta.heizoel; }
    else if (x.key === 'bhkw') { fossil += w; gas += w / eta.bhkwTh; }
    else if (x.key === 'pellets') pellets += w / eta.pellets;
    else if (x.key === 'hhs') hhs += w / eta.hhs;
    else if (x.key === 'fernwaerme') fw += w;
  }
  const p = x => (waerme > 0 ? (x / waerme) * 100 : NaN);
  Object.assign(e, { waerme, strom, gas, oel, pellets, hhs, fw, wpPct: p(wp), skPct: p(sk), fossilPct: p(fossil), strombasiertPct: p(wp + sk) });
  return e;
}

/** Leistung eines Erzeugertyps in einer Variante. */
const leistung = (v, pruef) => (v.erzeuger || []).filter(x => pruef(x.key)).reduce((s, x) => s + (Number(x.leistungKw) || 0), 0);

/* ── Rahmenbedingungen ───────────────────────────────────────────────────── */
/** Tabellenzeilen: Energieträger, Preis, PEF, CO₂ heute, CO₂ Ø Zeitraum. o: { preise: {strom, gas, oel, pellets, hhs}, ef: {gas, oel, pellets, strom, stromLz}, co2PreisEurT } */
export function vaRahmenZeilen(o) {
  const z = [];
  const p = o.preise || {}, ef = o.ef || {};
  const zeile = (name, preis, pef, heute, quelleH, lz, quelleL) => z.push({ werte: [name, ok(preis) ? `${nf(preis, 1)} ct/kWh` : '—', nf(pef, 1), `${nf(heute)} g/kWh`, quelleH, `${nf(lz)} g/kWh`, quelleL] });
  if (ok(p.gas)) zeile('Erdgas', p.gas, VA_PEF.Erdgas, ef.gas, 'GEG Anl. 9', ef.gas, 'GEG Anl. 9');
  if (ok(p.oel)) zeile('Heizöl', p.oel, VA_PEF.Heizöl, ef.oel, 'GEG Anl. 9', ef.oel, 'GEG Anl. 9');
  if (ok(p.strom)) zeile('Strom (Wärmepumpe)', p.strom, VA_PEF.Strom, ef.strom, VA_STROM_EF.quelleHeute, ef.stromLz, VA_STROM_EF.quelleLz);
  if (ok(p.pellets)) zeile('Holzpellets', p.pellets, VA_PEF.Holz, ef.pellets, 'GEG Anl. 9', ef.pellets, 'GEG Anl. 9');
  return z;
}

export function vaTextRahmen(o = {}) {
  return [
    absatz('Aufbauend auf der energetischen Analyse und der Potenzialbetrachtung werden im Variantenvergleich verschiedene Versorgungslösungen hinsichtlich ihrer klimarelevanten und ökonomischen Unterschiede untersucht. Der Vergleich beginnt mit der Klimarelevanz und schließt mit der Wirtschaftlichkeit; zunächst werden die für alle Varianten geltenden Rahmenbedingungen erläutert.'),
    absatz('Die verwendeten Primärenergie- und CO₂-Emissionsfaktoren sowie die Energiepreise sind in der folgenden Tabelle zusammengefasst. ',
      ok(o.efStromGeg) && ok(o.efStrom) && o.efStromGeg > o.efStrom
        ? `Für den Strombezug wird abweichend vom pauschalen Wert des GEG (${nf(o.efStromGeg)} g CO₂e/kWh) der aktuelle Emissionsfaktor des Umweltbundesamtes für den Strommix inklusive Vorketten (${nf(o.efStrom)} g CO₂e/kWh) angesetzt, da der GEG-Wert die tatsächlichen Emissionen des Netzstroms nicht mehr hinreichend abbildet. `
        : '',
      ok(o.efStromLz) ? `Für die künftige Entwicklung wird ergänzend der mittlere Emissionsfaktor für den Zeitraum ${VA_STROM_EF.von} bis ${VA_STROM_EF.bis} nach IINAS (${nf(o.efStromLz)} g CO₂e/kWh) berücksichtigt, um die fortschreitende Dekarbonisierung des deutschen Strommix über die gesamte Betrachtungsperiode abzubilden. ` : '',
      ok(o.co2PreisEurT) ? `Für die CO₂-Kosten wird ein Ansatz von ${nf(o.co2PreisEurT)} €/t CO₂e verwendet${o.co2Quelle ? ` (${o.co2Quelle})` : ''}.` : ['Der CO₂-Kostenansatz beträgt ', F('CO₂-Preis in €/t und Quelle'), '.']),
  ];
}

/* ── Zweistoffbrenner: Resilienz und Spitzenlast ─────────────────────────── */
/** o: { varianten, pMaxKw, vorgabeZsb } */
export function vaTextResilienz(o = {}) {
  const V = o.varianten || [];
  if (!V.length) return [];
  const zsb = V.map(v => leistung(v, k => KESSEL_FOSSIL.has(k)));
  const alle = zsb.every(k => k > 0);
  const volle = ok(o.pMaxKw) && zsb.every(k => k >= o.pMaxKw * 0.995);
  const kw = Math.max(...zsb);
  if (!alle) {
    return [absatz('Nicht alle Varianten enthalten einen fossil betriebenen Spitzenlast- und Resilienzkessel. Die Absicherung bei Ausfall der Hauptwärmeerzeuger ist daher je Variante zu bewerten: ', F('Resilienzkonzept je Variante'), '.')];
  }
  return [
    absatz(`Aus Resilienzgründen wird in allen Varianten ein Zweistoffbrenner (Erdgas/Heizöl) `, o.vorgabeZsb ? `gemäß ${o.vorgabeZsb} ` : ['gemäß ', F('Vorgabe zum Zweistoffbrenner (Erlass/Schreiben)', ''), ' '],
      `mit einer Leistung von ${L(kw)} vorgesehen`, volle ? ', der die gesamte Heizlast der Liegenschaft allein abdecken kann. Damit ist bei einem vollständigen Ausfall der Hauptwärmeerzeuger – etwa durch technische Störungen, eine Unterbrechung der Gasversorgung oder Wartungsarbeiten – die Wärmeversorgung auch bei Normaußentemperatur sichergestellt.' : '.',
      ' Die Zweistofffähigkeit mit Erdgas als Primärbrennstoff und Heizöl als Rückfallebene erhöht die Versorgungssicherheit zusätzlich.'),
    absatz('Der Zweistoffbrenner übernimmt je nach Auslegung zusätzlich einen geringen Anteil der Spitzenlast bei sehr niedrigen Außentemperaturen. Eine Auslegung der Wärmepumpe auf die volle Heizlast unter Worst-Case-Bedingungen ist wegen der sehr geringen Volllaststunden und der nachlassenden Wärmepumpenleistung bei tiefen Außentemperaturen wirtschaftlich nicht sinnvoll.'),
  ];
}

/* ── Gegenüberstellung ───────────────────────────────────────────────────── */
export function vaGegenueberstellung(V, pMaxKw) {
  const kopf = ['Wärmeerzeuger / Kriterium', ...V.map(v => v.name)];
  const zeilen = [];
  const typen = [['geo', 'Erdwärme-Wärmepumpe'], ['lwwp', 'Luft-Wasser-Wärmepumpe'], ['fg', 'Fließgewässer-Wärmepumpe'], ['stromkessel', 'Stromdirektkessel'], ['pellets', 'Pelletkessel'], ['hhs', 'Hackschnitzelkessel'], ['bhkw', 'BHKW']];
  for (const [k, n] of typen) {
    const w = V.map(v => leistung(v, x => x === k));
    if (w.some(x => x > 0)) zeilen.push({ werte: [n, ...w.map(x => (x > 0 ? L(x) : '–'))] });
  }
  const zsb = V.map(v => leistung(v, x => KESSEL_FOSSIL.has(x)));
  if (zsb.some(x => x > 0)) zeilen.push({ werte: ['Zweistoffbrenner / Resilienzkessel', ...zsb.map(x => (x > 0 ? L(x) : '–'))] });
  const en = V.map(vaEnergie);
  const anteil = (label, f) => zeilen.push({ werte: [label, ...en.map(e => (ok(f(e)) && f(e) > 0.05 ? pct(f(e)) : '–'))] });
  anteil('Deckungsanteil Wärmepumpe', e => e.wpPct);
  if (en.some(e => e.skPct > 0.05)) anteil('Deckungsanteil Stromdirektkessel', e => e.skPct);
  anteil('Deckungsanteil fossile Kessel', e => e.fossilPct);
  anteil('Anteil strombasierte Wärmeerzeugung', e => e.strombasiertPct);
  if (ok(pMaxKw)) zeilen.push({ werte: ['Volle Resilienz durch fossilen Kessel', ...zsb.map(x => (x >= pMaxKw * 0.995 ? '✔' : '✘'))] });
  return { kopf, zeilen };
}

/* ── Klimarelevanz ───────────────────────────────────────────────────────── */
/** o: { varianten (mit co2T, co2LzT), jahrHeute, jahrZiel, jahreKum, gesamtMwh, efGas, bestandCo2T } */
export function vaTextKlima(o = {}) {
  const V = (o.varianten || []).filter(v => ok(v.co2T) && ok(v.co2LzT));
  if (V.length < 2) return [];
  const jh = o.jahrHeute || new Date().getFullYear(), jz = o.jahrZiel || 2045, n = o.jahreKum || 20;
  const red = v => (v.co2T > 0 ? ((v.co2T - v.co2LzT) / v.co2T) * 100 : 0);
  const bestZiel = [...V].sort((a, b) => a.co2LzT - b.co2LzT)[0], schlechtZiel = [...V].sort((a, b) => b.co2LzT - a.co2LzT)[0];
  const bestRed = [...V].sort((a, b) => red(b) - red(a))[0];
  const en = new Map(V.map(v => [v, vaEnergie(v)]));
  const out = [];
  const alleStrom = V.every(v => en.get(v).strombasiertPct >= 50);
  out.push(absatz(`Die Emissionsanalyse für heute und den Mittelwert ${VA_STROM_EF.von}–${VA_STROM_EF.bis} verdeutlicht die unterschiedlichen Dynamiken der Versorgungskonzepte. `,
    alleStrom ? 'Da alle Varianten überwiegend strombasiert sind, profitieren sie von der fortschreitenden Dekarbonisierung des Stromnetzes; ihre Emissionen gehen in jedem Fall deutlich zurück. ' : '',
    `Die stärkste relative Reduktion erzielt ${bestRed.name} (von ${nf(bestRed.co2T)} auf ${nf(bestRed.co2LzT)} t CO₂e/a, rund ${pct(red(bestRed))}); `,
    bestZiel === bestRed ? 'sie erreicht damit zugleich den ökologischen Bestwert. ' : `den ökologischen Bestwert erreicht ${bestZiel.name} mit ${nf(bestZiel.co2LzT)} t CO₂e/a. `,
    `Den höchsten künftigen Wert weist ${schlechtZiel.name} mit ${nf(schlechtZiel.co2LzT)} t CO₂e/a auf`,
    en.get(schlechtZiel).fossilPct > 5 ? `, da der fossile Anteil von ${pct(en.get(schlechtZiel).fossilPct)} nicht von der Dekarbonisierung des Stromnetzes profitiert.` : '.'));
  const refs = [];
  if (o.gesamtMwh > 0 && ok(o.efGas)) refs.push({ name: 'eine vollständig über Erdgas gedeckte Wärmeversorgung', t: (o.gesamtMwh / (o.eta?.gaskessel || VA_ETA.gaskessel)) * o.efGas / 1000 });
  if (o.bestandCo2T > 0) refs.push({ name: 'der gegenwärtige Bestand', t: o.bestandCo2T });
  if (refs.length) {
    const minV = Math.min(...V.map(v => v.co2LzT)), maxV = Math.max(...V.map(v => v.co2LzT));
    out.push(absatz(`Zur Einordnung: ${liste(refs.map(r => `${r.name} verursacht rund ${nf(r.t)} t CO₂e pro Jahr`))}. `,
      `Künftig unterschreiten die Varianten ${liste(refs.map(r => `${r.name.startsWith('eine') ? 'die reine Erdgasversorgung' : 'den heutigen Bestand'} um etwa ${nf((1 - maxV / r.t) * 100)} bis ${nf((1 - minV / r.t) * 100)} %`))}. `,
      'Gemessen daran erscheinen die Unterschiede zwischen den Konzepten verhältnismäßig klein; alle Varianten stellen eine erhebliche ökologische Verbesserung dar.'));
  }
  const kum = V.map(v => ({ v, t: v.co2LzT * n })).sort((a, b) => a.t - b.t);
  out.push(absatz(`Über den Zeitraum ${VA_STROM_EF.von} bis ${VA_STROM_EF.bis} (${n} Jahre, mittlerer Strom-Emissionsfaktor nach IINAS) ergeben sich kumuliert: ${kum.map(x => `${x.v.name} ${nf(x.t)} t CO₂e`).join(', ')}. `,
    kum.length >= 2 && kum[kum.length - 1].t > kum[0].t * 1.5
      ? `Die höchste Summe liegt um den Faktor ${nf(kum[kum.length - 1].t / kum[0].t, 1)} über der niedrigsten; bereits ein geringfügig höherer fossiler Anteil führt über die Jahre zu einer erheblichen Mehrbelastung.`
      : ''));
  if (V.some(v => en.get(v).fossilPct > 1)) {
    out.push(absatz('Die fossilen Kessel werden als Zweistoffbrenner ausgeführt und hier mit Erdgas bilanziert. Da Heizöl einen höheren Emissionsfaktor als Erdgas hat, würde ein Betrieb mit Heizöl die Bilanz der Varianten mit fossilem Anteil weiter verschlechtern.'));
  }
  out.push(absatz(`Klimaneutralität bis ${jz} setzt voraus, dass auch der verbleibende fossile Spitzenlastanteil bis dahin ersetzt wird.`));
  return out;
}

/* ── Wirtschaftlichkeit ──────────────────────────────────────────────────── */
export function vaTextKostenKomponenten(o = {}) {
  return [
    absatz('Die jährlichen Gesamtkosten der Varianten setzen sich aus folgenden Komponenten zusammen:'),
    absatz('• Energiekosten: Aufwendungen für die eingesetzten Energieträger (z. B. Strom, Gas, Pellets). Sie bilden Verbrauch und Bezugspreise ab und sind in der Regel der größte laufende Kostenblock,'),
    absatz('• Kapitalkosten: jährliche anteilige Investitionskosten, die über die Nutzungsdauer der Komponenten annuitätisch verteilt und verzinst werden,'),
    absatz('• Betriebskosten: wiederkehrende Ausgaben für Wartung, Instandhaltung, Bedienung und Reinigung sowie ggf. Entsorgung von Rückständen,'),
    absatz(`• CO₂-Kosten${o.co2Quelle ? ` ${o.co2Quelle}` : ''}: berechnete CO₂e-Emissionen aller Energieträger multipliziert mit dem Kostenansatz${ok(o.co2PreisEurT) ? ` von ${nf(o.co2PreisEurT)} €/t CO₂e` : ''}.`),
  ];
}

export function vaTextPv(o = {}) {
  return [absatz('Die vorstehenden Ergebnisse beruhen auf dem vollständigen Bezug des Wärmepumpenstroms aus dem öffentlichen Netz. Steht der Liegenschaft Strom aus einer Photovoltaikanlage zu geringeren Gestehungskosten zur Verfügung, sinken die Energiekosten der strombasierten Varianten anteilig; Kapital- und Betriebskosten bleiben unverändert. ',
    'Die Entlastung je Variante beträgt ', F('Wärmegestehungskosten je Variante mit und ohne PV-Eigenstrom (Kapitel PV, Eigenverbrauch für Wärmepumpen)', o.pvText || ''), '. ',
    'Die absolute Entlastung korreliert mit dem Strombedarf der jeweiligen Variante: Den größten Vorteil erzielen Varianten mit hohem strombasiertem Anteil, den geringsten Varianten mit hoher Jahresarbeitszahl oder fossilem Anteil.')];
}

/* ── Energiepreissensitivität ────────────────────────────────────────────── */
export const VA_SZENARIEN = Object.freeze([
  { name: 'Heute', strom: 0, fossil: 0, bio: 0 },
  { name: 'Moderater Anstieg', strom: 10, fossil: 30, bio: 15 },
  { name: 'Energiekrise', strom: 20, fossil: 80, bio: 50 },
]);

/** Mehrkosten je Variante und Szenario aus den Energiemengen und Preisen (ct/kWh). */
export function vaSensitivitaet(V, preise, szenarien = VA_SZENARIEN) {
  return V.filter(v => ok(v.jahreskostenEur) && v.jahreskostenEur > 0).map(v => {
    const e = vaEnergie(v);
    const kosten = { strom: e.strom * (preise.strom || 0) * 10, fossil: e.gas * (preise.gas || 0) * 10 + e.oel * (preise.oel || 0) * 10, bio: e.pellets * (preise.pellets || 0) * 10 + e.hhs * (preise.hhs || 0) * 10 };
    const sz = szenarien.map(s => {
      const mehr = kosten.strom * s.strom / 100 + kosten.fossil * s.fossil / 100 + kosten.bio * s.bio / 100;
      return { name: s.name, gesamt: v.jahreskostenEur + mehr, mehr, pct: (mehr / v.jahreskostenEur) * 100 };
    });
    return { name: v.name, basis: v.jahreskostenEur, kosten, sz };
  });
}

export function vaTextSensitivitaet(V, preise, szenarien = VA_SZENARIEN) {
  const r = vaSensitivitaet(V, preise, szenarien);
  if (r.length < 2) return [];
  const out = [absatz('Die Wirtschaftlichkeitsbetrachtung basiert auf den heutigen Energiepreisen. Da diese über die Nutzungsdauer erfahrungsgemäß deutlich schwanken, werden drei Preisszenarien gegenübergestellt:')];
  szenarien.forEach((s, i) => out.push(absatz(`• ${s.name}: ${i === 0 ? `aktuelle Preise (Strom ${nf(preise.strom, 1)} ct/kWh, Gas ${nf(preise.gas, 1)} ct/kWh${ok(preise.pellets) ? `, Pellets ${nf(preise.pellets, 1)} ct/kWh` : ''})` : `Strom +${s.strom} %, Gas/Öl +${s.fossil} %, Biomasse +${s.bio} %`}${i < szenarien.length - 1 ? ',' : '.'}`)));
  out.push(absatz('Die Szenarien spiegeln die Erwartung wider, dass fossile Brennstoffe wegen der CO₂-Bepreisung und höherer Marktvolatilität tendenziell stärker steigen als Strom, dessen Preis durch den wachsenden Anteil erneuerbarer Erzeugung mittel- bis langfristig stabilisiert wird; Biomasse liegt dazwischen.'));
  const rang = i => [...r].sort((a, b) => a.sz[i].gesamt - b.sz[i].gesamt).map(x => x.name);
  const last = szenarien.length - 1;
  const spanneP = i => [Math.min(...r.map(x => x.sz[i].pct)), Math.max(...r.map(x => x.sz[i].pct))];
  const [pm0, pm1] = spanneP(1), [pk0, pk1] = spanneP(last);
  const minK = r.reduce((a, b) => (b.sz[last].pct < a.sz[last].pct ? b : a)), maxK = r.reduce((a, b) => (b.sz[last].pct > a.sz[last].pct ? b : a));
  const r0 = rang(0), rk = rang(last);
  const wechsel = r0.join('|') !== rk.join('|');
  out.push(absatz(`Die Gesamtkosten steigen im moderaten Szenario um ${nf(pm0, 1)} bis ${nf(pm1, 1)} %, im Krisenszenario um ${nf(pk0, 1)} % (${minK.name}) bis ${nf(pk1, 1)} % (${maxK.name}). `,
    'Je höher der fossile Anteil an der Wärmeerzeugung, desto stärker fällt der Anstieg aus. ',
    wechsel ? `Die Rangfolge verschiebt sich im Krisenszenario: Günstigste Variante ist dann ${rk[0]} (heute ${r0[0]}).` : `Die Rangfolge bleibt in allen Szenarien unverändert; ${r0[0]} bleibt die günstigste, ${r0[r0.length - 1]} die teuerste Variante.`));
  const mehr = r.map(x => x.sz[last].mehr);
  const g0 = Math.min(...r.map(x => x.sz[last].gesamt)), g1 = Math.max(...r.map(x => x.sz[last].gesamt));
  out.push(absatz(`In absoluten Zahlen liegen die jährlichen Mehrkosten im Krisenszenario zwischen rund ${nf(Math.min(...mehr))} und ${nf(Math.max(...mehr))} €/a. `,
    `Die günstigste und die teuerste Variante trennen im Krisenszenario rund ${nf(g1 - g0)} €/a. `,
    'Die wirtschaftliche Rangfolge ist damit gegenüber Energiepreisschwankungen ', wechsel ? 'nur bedingt robust; die Wahl sollte die Preisentwicklung ausdrücklich berücksichtigen.' : 'robust; die Auswahl der wirtschaftlichsten Lösung bleibt auch unter deutlichen Preisanstiegen stabil.'));
  return out;
}

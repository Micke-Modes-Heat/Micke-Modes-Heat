// ── lib/gutachten-fazit.js — Gutachtentexte Fazit Wärme, Niedertemperatur-Ertüchtigung, Maßnahmenfahrplan,
//    Heizölbevorratung und Übergangsmaßnahmen Resilienz ──
// DOM-frei. Variantendaten wie in lib/gutachten-varianten.js.
import { F, wtHilfen } from './gutachten-waerme-texte.js';
import { vaEnergie, vaSensitivitaet } from './gutachten-varianten.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;
const L = kw => (kw >= 1000 ? `${nf(kw / 1000, 1)} MW` : `${nf(kw)} kW`);
const KESSEL = new Set(['gaskessel', '_autoGk', 'heizoel']);

/* ══════════════════════════════════════════════════════════════════════════
 * Bewertung der Varianten und Empfehlung
 * ═══════════════════════════════════════════════════════════════════════ */
/** o: { varianten, preise, gesamtMwh, efGas, jahreKum, zielJahr, pMaxKw } */
export function faTextBewertung(o = {}) {
  const V = (o.varianten || []).filter(v => ok(v.wgkCt));
  if (V.length < 2) return [absatz('Die Bewertung der Varianten setzt mindestens zwei berechnete Varianten voraus: ', F('Bewertung der Varianten'), '.')];
  const n = o.jahreKum || 20;
  const out = [absatz('Aus den drei Bewertungsachsen Klimabilanz, Wirtschaftlichkeit und Resilienz ergibt sich folgendes Bild:')];
  const mitCo2 = V.filter(v => ok(v.co2LzT));
  if (mitCo2.length >= 2) {
    const s = [...mitCo2].sort((a, b) => a.co2LzT - b.co2LzT);
    const ref = o.gesamtMwh > 0 && ok(o.efGas) ? (o.gesamtMwh / (o.eta?.gaskessel || 0.92)) * o.efGas / 1000 * n : NaN;
    out.push(absatz(`In der Emissionsbilanz erreicht ${s[0].name} künftig die niedrigsten Emissionen (von ${nf(s[0].co2T)} auf ${nf(s[0].co2LzT)} t CO₂e/a), `,
      `gefolgt von ${s[1].name} (${nf(s[1].co2LzT)} t CO₂e/a). Über ${n} Jahre kumuliert liegen die Varianten zwischen ${nf(s[0].co2LzT * n)} und ${nf(s[s.length - 1].co2LzT * n)} t CO₂e`,
      ok(ref) ? `; eine reine Erdgasversorgung käme auf rund ${nf(ref)} t CO₂e, alle Varianten bleiben also um den Faktor ${nf(ref / (s[s.length - 1].co2LzT * n), 0)} bis ${nf(ref / Math.max(1, s[0].co2LzT * n), 0)} darunter.` : '.'));
  }
  const w = [...V].sort((a, b) => a.wgkCt - b.wgkCt);
  const sens = o.preise ? vaSensitivitaet(V, o.preise) : [];
  const rangK = sens.length >= 2 ? [...sens].sort((a, b) => a.sz[a.sz.length - 1].gesamt - b.sz[b.sz.length - 1].gesamt).map(x => x.name) : [];
  out.push(absatz(`Wirtschaftlich ist ${w[0].name} mit ${nf(w[0].wgkCt, 2)} ct/kWh die günstigste Variante, gefolgt von ${liste(w.slice(1).map(v => `${v.name} (${nf(v.wgkCt, 2)} ct/kWh)`))}. `,
    rangK.length ? (rangK[0] === w[0].name ? 'Die Sensitivitätsanalyse zeigt, dass diese Rangfolge auch unter deutlichen Energiepreissteigerungen weitgehend stabil bleibt.' : `Im Krisenszenario der Sensitivitätsanalyse wird ${rangK[0]} zur günstigsten Variante; die Rangfolge der führenden Varianten ist damit preisabhängig.`) : ''));
  const zsb = V.map(v => (v.erzeuger || []).filter(x => KESSEL.has(x.key)).reduce((s, x) => s + (Number(x.leistungKw) || 0), 0));
  if (ok(o.pMaxKw) && zsb.every(k => k >= o.pMaxKw * 0.995)) {
    out.push(absatz(`In der Resilienz sind alle Varianten durch den fossilen Spitzenlast- und Resilienzkessel (${L(Math.min(...zsb))} bis ${L(Math.max(...zsb))}) abgesichert, der die volle Heizlast eigenständig übernehmen kann. `,
      'Unterscheiden lassen sich die Varianten im Verhalten bei einem Ausfall dieses Kessels: Varianten mit hohem Wärmepumpen- oder Stromkesselanteil decken dann den größten Teil des Jahres allein, bivalente Varianten sind an den kältesten Tagen auf den Spitzenlastbeitrag angewiesen.'));
  }
  return out;
}

/** Gewichte der Bewertungsmatrix (Summe 1). */
export const FA_GEWICHTE = Object.freeze({ kosten: 0.35, klima: 0.30, resilienz: 0.20, preis: 0.15 });
export const FA_KRITERIEN = Object.freeze({ kosten: 'Wirtschaftlichkeit', klima: 'Klimawirkung', resilienz: 'Resilienz', preis: 'Preisstabilität' });

/**
 * Bewertungsmatrix: je Kriterium 0–100 Punkte (bester Wert 100, die übrigen im Verhältnis bester ÷ eigener Wert), gewichtet zur Gesamtnote.
 * Kosten: Wärmegestehungskosten · Klima: Emissionen Ø 2030–2050 · Preisstabilität: Kostenanstieg im Krisenszenario ·
 * Resilienz: halb fossiler Kessel ≥ Spitzenlast, halb Anteil der Spitzenlast, den Wärmepumpe und Stromkessel ohne fossilen Kessel decken.
 */
export function faBewertungsmatrix(o = {}) {
  const V = (o.varianten || []).filter(v => ok(v.wgkCt));
  if (V.length < 2) return null;
  const g = o.gewichte || FA_GEWICHTE;
  const sens = o.preise ? vaSensitivitaet(V, o.preise) : [];
  const roh = V.map(v => {
    const kw = k => (v.erzeuger || []).filter(x => k(x.key)).reduce((s, x) => s + (Number(x.leistungKw) || 0), 0);
    const fossilKw = kw(k => KESSEL.has(k)), stromKw = kw(k => ['lwwp', 'geo', 'fg', 'stromkessel'].includes(k));
    const sz = sens.find(x => x.name === v.name);
    return {
      v, kosten: v.wgkCt, klima: ok(v.co2LzT) ? v.co2LzT : v.co2T,
      preis: sz ? sz.sz[sz.sz.length - 1].pct : NaN,
      resilienz: ok(o.pMaxKw) && o.pMaxKw > 0 ? 0.5 * (fossilKw >= o.pMaxKw * 0.995 ? 1 : fossilKw / o.pMaxKw) + 0.5 * Math.min(1, stromKw / o.pMaxKw) : NaN,
    };
  });
  // Verhältnispunkte: niedriger ist besser → 100 × bester ÷ eigener Wert; Resilienz direkt als Erfüllungsgrad in %
  const punkte = (k, hoeherBesser) => {
    const w = roh.map(r => r[k]).filter(ok);
    if (!w.length) return () => NaN;
    if (hoeherBesser) return x => (ok(x) ? Math.max(0, Math.min(100, x * 100)) : NaN);
    const min = Math.max(1e-9, Math.min(...w));
    return x => (!ok(x) ? NaN : x <= min ? 100 : 100 * min / x);
  };
  const p = { kosten: punkte('kosten'), klima: punkte('klima'), preis: punkte('preis'), resilienz: punkte('resilienz', true) };
  const zeilen = roh.map(r => {
    const pk = Object.fromEntries(Object.keys(p).map(k => [k, p[k](r[k])]));
    const gw = Object.keys(pk).filter(k => ok(pk[k]));
    const summeG = gw.reduce((s, k) => s + g[k], 0);
    return { name: r.v.name, v: r.v, roh: r, punkte: pk, gesamt: summeG > 0 ? gw.reduce((s, k) => s + g[k] * pk[k], 0) / summeG : NaN };
  }).sort((x, y) => y.gesamt - x.gesamt);
  return { zeilen, gewichte: g };
}

/** Empfehlung: Gesamtbewertung über Kosten, Klima, Resilienz und Preisstabilität; eine oder zwei führende Varianten. */
export function faTextEmpfehlung(o = {}) {
  const m = faBewertungsmatrix(o);
  if (!m) return [absatz('Empfohlen wird die Umsetzung der Variante ', F('Empfohlene Variante', o.vorzugName && o.vorzugName !== 'auto' ? o.vorzugName : ''), '.')];
  // Vorgabe des Gutachters (Fragebogen): gewählte Variante an die Spitze, die Matrix bleibt als Begründungsrahmen
  const wahl = o.vorzugName && o.vorzugName !== 'auto' ? m.zeilen.find(z => z.name === o.vorzugName) : null;
  if (wahl && wahl !== m.zeilen[0]) {
    const rang = m.zeilen.indexOf(wahl) + 1;
    return [absatz(`Die gewichtete Bewertung nach ${liste(Object.keys(FA_GEWICHTE).map(k => `${FA_KRITERIEN[k]} (${pct(m.gewichte[k] * 100)})`))} sieht ${m.zeilen[0].name} mit ${nf(m.zeilen[0].gesamt)} Punkten vorn; `,
      `${wahl.name} folgt mit ${nf(wahl.gesamt)} Punkten auf Rang ${rang}.`),
    absatz(`Unter Abwägung der liegenschaftsspezifischen Randbedingungen wird dennoch ${wahl.name} als Vorzugsvariante empfohlen. Ausschlaggebend ist `, F('Begründung der Auswahl, z. B. Vorgabe des Nutzers, Flächenverfügbarkeit oder strategische Gewichtung', ''), '.')];
  }
  const w = m.zeilen.map(z => z.v);
  const [a, b] = w;
  const eng = m.zeilen[1].gesamt >= m.zeilen[0].gesamt - 5;
  const en = new Map(w.map(v => [v, vaEnergie(v)]));
  const gText = liste(Object.keys(FA_GEWICHTE).map(k => `${FA_KRITERIEN[k]} (${pct(m.gewichte[k] * 100)})`));
  const best = k => m.zeilen.filter(z => ok(z.punkte[k])).sort((x, y) => y.punkte[k] - x.punkte[k])[0];
  const out = [absatz(`Die Empfehlung stützt sich nicht allein auf die Kosten, sondern auf eine gewichtete Bewertung nach ${gText}. `,
    `Wirtschaftlich führt ${best('kosten').name}, in der Klimawirkung ${best('klima').name}`,
    best('resilienz') ? `, in der Resilienz ${best('resilienz').name}` : '', best('preis') ? ` und in der Preisstabilität ${best('preis').name}` : '', '. ',
    `In der Gesamtbewertung erreicht ${a.name} ${nf(m.zeilen[0].gesamt)} von 100 Punkten, ${b.name} ${nf(m.zeilen[1].gesamt)} Punkte.`)];
  if (eng) {
    const sauber = (en.get(a).fossilPct ?? 0) <= (en.get(b).fossilPct ?? 0) ? a : b;
    const guenstig = a.wgkCt <= b.wgkCt ? a : b;
    out.push(absatz(`Da beide Varianten nahezu gleichauf liegen, wird eine der beiden – ${a.name} oder ${b.name} – als Vorzugsvariante empfohlen. `,
      sauber !== guenstig
        ? `Sie unterscheiden sich vor allem im fossilen Restanteil: ${sauber.name} erreicht mit ${pct(en.get(sauber).fossilPct)} fossilem Anteil die höhere Emissionsfreiheit und ist unabhängiger von Gaspreisen, ${guenstig.name} fällt mit ${nf(guenstig.wgkCt, 2)} ct/kWh wirtschaftlich etwas günstiger aus. Die Wahl ist eine Abwägung zwischen Emissionsfreiheit und Preisstabilität einerseits und etwas niedrigeren Kosten andererseits.`
        : `${sauber.name} ist dabei zugleich günstiger und emissionsärmer.`));
  } else {
    out.push(absatz(`Aus der Gesamtbetrachtung wird ${a.name} als Vorzugsvariante empfohlen.`));
  }
  const fossilMax = Math.max(en.get(a).fossilPct || 0, eng ? en.get(b).fossilPct || 0 : 0);
  if (fossilMax > 0.5) {
    out.push(absatz(`Entscheidend ist, dass ${eng ? 'beide Varianten' : 'die Variante'} den Weg zur vollständigen Klimaneutralität bis ${o.zielJahr || 2045} offen ${eng ? 'halten' : 'hält'}. `,
      'Der verbleibende fossile Spitzenlastanteil ist bewusst klein gehalten und wird über den Kessel abgedeckt, der ohnehin primär als Resilienzebene dient. ',
      'Er kann bis zum Zieljahr schrittweise ersetzt werden, ohne das Grundkonzept zu ändern – etwa durch einen Stromdirektkessel oder durch Wärmepumpen, die bis dahin technisch weiterentwickelt und wirtschaftlich attraktiver sind. Die Empfehlung hält diese Frage bewusst offen.'));
  }
  for (const v of w.slice(eng ? 2 : 1)) {
    const e = en.get(v);
    const geo = (v.erzeuger || []).some(x => x.key === 'geo' && x.leistungKw > 0);
    if (e.strombasiertPct >= 99 && e.skPct > 0.5) {
      out.push(absatz(`Die vollständig strombasierte Variante ${v.name} zeigt, dass ein Verzicht auf den fossilen Spitzenlastanteil technisch bereits heute möglich wäre, ist mit ${nf(v.wgkCt, 2)} ct/kWh derzeit jedoch ${v.wgkCt >= Math.max(...w.map(x => x.wgkCt)) ? 'die teuerste' : 'eine teurere'} Variante. Sie eignet sich eher als Referenz für den späteren Umstellungspfad.`));
    } else if (geo) {
      out.push(absatz(`Die Erdwärmevariante ${v.name} erreicht eine sehr gute Klimabilanz, schneidet mit ${nf(v.wgkCt, 2)} ct/kWh wirtschaftlich jedoch schlechter ab. Hohe Investitionskosten und der Flächenbedarf des Sondenfelds werden durch den geringeren Stromverbrauch nicht ausgeglichen; eine Umsetzung käme vor allem bei strategischer Gewichtung von Klimabilanz oder Netzdienlichkeit in Betracht.`));
    } else {
      const z = m.zeilen.find(x => x.v === v);
      out.push(absatz(`${v.name} liegt in der Gesamtbewertung mit ${nf(z.gesamt)} Punkten (${nf(v.wgkCt, 2)} ct/kWh) hinter den führenden Varianten.`));
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Niedertemperatur-Ertüchtigung
 * ═══════════════════════════════════════════════════════════════════════ */
export const FA_NT = Object.freeze({ gueteGrad: 0.45, quelleC: 2, jahre: 20, eurProGebaeude: 25000 });

/** Überschlägige JAZ aus Carnot × Gütegrad für eine mittlere Vorlauftemperatur. */
export const faJaz = (vlC, quelleC = FA_NT.quelleC, guete = FA_NT.gueteGrad) => guete * (vlC + 273.15) / Math.max(5, vlC - quelleC);

/**
 * Kostenkennwerte der gebäudescharfen Schätzung (Annahmen, netto, Preisstand heute). NGF = 0,85 × BGF.
 * Heizkörperzahl aus der Fläche; Tauschanteil nach Bauzustand (1 gut … 3 schlecht); TWW-Umstellung nach Erzeugungsart.
 */
export const FA_NT_KOSTEN = Object.freeze({
  sockelEur: 2000, planungEurM2: 1.0, m2JeHeizkoerper: 20, abgleichEurHk: 120, tauschEurHk: 1100,
  tauschAnteil: Object.freeze({ 1: 0.15, 2: 0.25, 3: 0.4, ohne: 0.25 }),
  tww: Object.freeze({ speicher: [8000, 50], klein: [1500, 0], fws: [2000, 10], pwt: [2000, 10], dle: [0, 0], keine: [0, 0], ohne: [6000, 0] }),   // [Sockel €, € je kW]
});

/** Gebäudescharfe Kostenschätzung. gebaeude: [{ name, bgfM2, zustand (1–3), twwArt, twwKw }] */
export function faNtKosten(gebaeude, k = FA_NT_KOSTEN) {
  const zeilen = (gebaeude || []).filter(g => g.bgfM2 > 0).map(g => {
    const ngf = g.bgfM2 * 0.85;
    const hk = Math.max(1, Math.round(ngf / k.m2JeHeizkoerper));
    const anteil = k.tauschAnteil[Math.round(Number(g.zustand))] ?? k.tauschAnteil.ohne;
    const [twwSockel, twwJeKw] = k.tww[g.twwArt] || k.tww.ohne;
    const posten = {
      aufnahme: k.sockelEur + ngf * k.planungEurM2,
      abgleich: hk * k.abgleichEurHk,
      heizflaechen: Math.round(hk * anteil) * k.tauschEurHk,
      tww: twwSockel + (Number(g.twwKw) || 0) * twwJeKw,
    };
    return { name: g.name, ngf, hk, tauschHk: Math.round(hk * anteil), posten, summe: Object.values(posten).reduce((a, b) => a + b, 0) };
  });
  const sum = key => zeilen.reduce((a, z) => a + z.posten[key], 0);
  return { zeilen, anzahl: zeilen.length, ngf: zeilen.reduce((a, z) => a + z.ngf, 0), hk: zeilen.reduce((a, z) => a + z.hk, 0),
    posten: { aufnahme: sum('aufnahme'), abgleich: sum('abgleich'), heizflaechen: sum('heizflaechen'), tww: sum('tww') },
    summe: zeilen.reduce((a, z) => a + z.summe, 0) };
}

/**
 * HT vs. NT bei gleicher WP-Wärme. o: { waermeMwh, vlHtC, vlNtC, jazNt (gemessen), strompreisCt, kosten (faNtKosten) oder gebaeude × eurProGebaeude, jahre, efStrom, efStromLz }
 * Ist eine stundenscharfe JAZ für den NT-Fall bekannt, wird die HT-JAZ im Carnot-Verhältnis daraus abgeleitet.
 */
export function faNtVergleich(o) {
  const jazNtModell = faJaz(o.vlNtC), jazHtModell = faJaz(o.vlHtC);
  const jazNt = ok(o.jazNt) && o.jazNt > 1 ? o.jazNt : jazNtModell;
  const jazHt = jazNt * jazHtModell / jazNtModell;
  const stromHt = o.waermeMwh / jazHt, stromNt = o.waermeMwh / jazNt;
  const kHt = stromHt * o.strompreisCt * 10, kNt = stromNt * o.strompreisCt * 10;
  const jahre = o.jahre || FA_NT.jahre;
  const invest = o.kosten?.summe > 0 ? o.kosten.summe : (o.gebaeude || 0) * (o.eurProGebaeude || FA_NT.eurProGebaeude);
  const ersparnis = kHt - kNt;
  return {
    jazHt, jazNt, stromHt, stromNt, kostenHt: kHt, kostenNt: kNt, ctHt: (kHt / (o.waermeMwh * 1000)) * 100, ctNt: (kNt / (o.waermeMwh * 1000)) * 100,
    ersparnis, ersparnisJahre: ersparnis * jahre, invest, amortJahre: ersparnis > 0 ? invest / ersparnis : NaN, netto: ersparnis * jahre - invest, jahre,
    co2Jahr1: ok(o.efStrom) ? (stromHt - stromNt) * o.efStrom / 1000 : NaN, co2Kum: ok(o.efStromLz) ? (stromHt - stromNt) * o.efStromLz / 1000 * jahre : NaN,
  };
}

export function faTextNt(o = {}) {
  if (o.kurz) {
    return [absatz('Alle untersuchten Varianten setzen ein Niedertemperaturnetz voraus oder profitieren erheblich davon. ',
      ok(o.vlHtC) && ok(o.vlNtC) ? `Eine Absenkung der Vorlauftemperatur von heute rund ${nf(o.vlHtC)} °C auf überwiegend rund ${nf(o.vlNtC)} °C verbessert die Jahresarbeitszahl der Wärmepumpen deutlich. ` : '',
      'Es wird empfohlen, die Niedertemperatur-Tauglichkeit der Gebäude (Heizflächen, Trinkwarmwasserbereitung, hydraulischer Abgleich) gebäudescharf zu prüfen und die Ertüchtigung vor Inbetriebnahme der Wärmepumpe abzuschließen.')];
  }
  const out = [
    absatz('Da alle untersuchten Varianten ein Niedertemperaturnetz voraussetzen oder erheblich davon profitieren, wird im Folgenden ein Fahrplan für die schrittweise Umstellung skizziert.'),
    absatz(`Eine effiziente Wärmepumpennutzung setzt deutlich abgesenkte Vorlauftemperaturen voraus. ${ok(o.vlHtC) ? `Während das Wärmenetz heute mit rund ${nf(o.vlHtC)} °C betrieben wird, sinkt die Effizienz einer Wärmepumpe` : 'Die Effizienz einer Wärmepumpe sinkt'} mit jedem Kelvin zusätzlicher Vorlauftemperatur. `,
      ok(o.vlNtC) ? `Ziel ist ein Vorlauftemperaturniveau, das in den meisten Betriebsstunden bei rund ${nf(o.vlNtC)} °C liegt und nur an wenigen sehr kalten Tagen ansteigt. ` : '',
      'Die Liegenschaft ist hinsichtlich Gebäudealter, Bauart und technischer Ausstattung heterogen; die Umstellung erfolgt daher gebäudescharf und schrittweise.'),
  ];
  if (o.waermeMwh > 0 && ok(o.vlHtC) && ok(o.vlNtC) && o.strompreisCt > 0) {
    const r = faNtVergleich(o);
    out.push(absatz(`Der wirtschaftliche Hebel wurde durch eine Gegenüberstellung des Wärmepumpenbetriebs bei gleicher Wärmeabdeckung (${nf(o.waermeMwh / 1000, 2)} GWh/a) im Hoch- und Niedertemperaturbetrieb überschlägig quantifiziert: `,
      `Die Jahresarbeitszahl steigt von ${nf(r.jazHt, 2)} auf ${nf(r.jazNt, 2)}, der Stromverbrauch sinkt von ${nf(r.stromHt / 1000, 2)} auf ${nf(r.stromNt / 1000, 2)} GWh/a (−${pct((1 - r.stromNt / r.stromHt) * 100)}). `,
      `Das entspricht einer jährlichen Einsparung an Stromkosten von rund ${nf(r.ersparnis)} € bzw. rund ${nf(r.ersparnisJahre / 1e6, 1)} Mio. € über ${r.jahre} Jahre.`));
    if (r.invest > 0) {
      const kk = o.kosten;
      out.push(absatz(kk?.summe > 0
        ? `Dem stehen einmalige Ertüchtigungskosten gegenüber. Sie wurden gebäudescharf überschlägig geschätzt – aus Fläche, Bauzustand und Art der Trinkwarmwasserbereitung: Für ${nf(kk.anzahl)} Gebäude mit rund ${nf(kk.ngf)} m² Nettogrundfläche und etwa ${nf(kk.hk)} Heizkörpern ergeben sich rund ${nf(r.invest / 1e6, 2)} Mio. € `
          + `(Bestandsaufnahme und Planung ${nf(kk.posten.aufnahme / 1000)} Tsd. €, hydraulischer Abgleich ${nf(kk.posten.abgleich / 1000)} Tsd. €, Heizflächenanpassung ${nf(kk.posten.heizflaechen / 1000)} Tsd. €, Trinkwarmwasser ${nf(kk.posten.tww / 1000)} Tsd. €). `
        : `Dem stehen einmalige Ertüchtigungskosten gegenüber: Bei ${nf(o.gebaeude)} Gebäuden und rund ${nf(o.eurProGebaeude || FA_NT.eurProGebaeude)} € je Gebäude ergibt sich ein Investitionsaufwand von rund ${nf(r.invest / 1e6, 2)} Mio. €. `,
        ok(r.amortJahre) ? `Die Maßnahme amortisiert sich damit in etwa ${nf(r.amortJahre, 1)} Jahren; nach ${r.jahre} Jahren verbleibt ein Nettovorteil von rund ${nf(r.netto / 1e6, 1)} Mio. €. ` : '',
        'Die Ertüchtigungskosten sind in den übrigen Wirtschaftlichkeitsbetrachtungen nicht enthalten und als eigenständiger Investitionsblock zu berücksichtigen.'));
    }
    if (ok(r.co2Jahr1)) {
      out.push(absatz(`Bezogen auf den heutigen Strommix vermeidet die Niedertemperaturfahrweise bereits im ersten Jahr rund ${nf(r.co2Jahr1)} t CO₂e`,
        ok(r.co2Kum) ? `; mit dem mittleren künftigen Strommix summiert sich die vermiedene Menge über ${r.jahre} Jahre auf rund ${nf(r.co2Kum)} t CO₂e. Der Vorteil verschiebt sich damit im Zeitverlauf zunehmend von der Emissions- auf die Kostenseite.` : '.'));
    }
    out.push(absatz(`Die Jahresarbeitszahlen sind überschlägig ermittelt (${ok(o.jazNt) ? 'Niedertemperatur aus der stundenscharfen Einsatzplanung, Hochtemperatur im Carnot-Verhältnis abgeleitet' : `Carnot-Ansatz mit Gütegrad ${nf(FA_NT.gueteGrad, 2)}`}).`));
  } else {
    out.push(absatz('Die wirtschaftliche Bewertung der Ertüchtigung (Hoch- gegenüber Niedertemperaturbetrieb) setzt Vorlauftemperaturen, Wärmepumpenwärme und Strompreis voraus: ', F('Gegenüberstellung HT/NT'), '.'));
  }
  out.push(absatz('Phase 1 – Bestandsaufnahme: Erfasst werden Typ und Größe der Heizkörper, Raumtyp, ungefähre Raumheizlast sowie Auffälligkeiten wie verkleidete Heizkörper oder defekte Thermostatventile. Ältere Heizkörper sind häufig deutlich überdimensioniert und der Wärmebedarf vieler Räume ist durch Fenstertausch oder Dämmung gesunken; die vorhandenen Heizflächen reichen daher oft auch bei abgesenkter Vorlauftemperatur aus. Parallel wird die Trinkwarmwasserbereitung jedes Gebäudes erfasst; Speichersysteme müssen aus hygienischen Gründen (DVGW W 551) am Austritt mindestens 60 °C erreichen.'));
  out.push(absatz('Phase 2 – Heizflächenanpassung und Trinkwarmwasser: Wo erforderlich, werden Heizflächen vergrößert, durch Niedertemperatur-Konvektoren mit Gebläse ersetzt oder um Flächenheizungen ergänzt. In jedem umgestellten Gebäude ist ein hydraulischer Abgleich durchzuführen; ohne ihn kommt es im Niedertemperaturbetrieb regelmäßig zu kalten Räumen und in der Folge zu einer Anhebung der Heizkurve. Die Trinkwarmwasserbereitung wird je nach Gebäude über einen bivalenten Speicher mit elektrischer Nachheizung oder Booster-Wärmepumpe, über dezentrale Wohnungs- bzw. Etagenstationen oder über elektrische Durchlauferhitzer an Einzelzapfstellen umgestellt; lange Zirkulationsleitungen sind zu prüfen.'));
  out.push(absatz('Phase 3 – Zielzustand: Idealerweise ist die Umstellung zur Inbetriebnahme der Wärmepumpe abgeschlossen, sodass das System vom ersten Tag an im effizienten Auslegungspunkt arbeitet.'));
  out.push(absatz('Die Niedertemperatur-Ertüchtigung ist eine vorrangige, wirtschaftlich wie ökologisch hochwirksame Maßnahme. Sie ist Voraussetzung für die ausgewiesenen Ergebnisse aller Varianten, amortisiert sich innerhalb weniger Jahre und ist ohne verpflichtende Vollsanierung umsetzbar. Die gebäudescharfe Prüfung der Niedertemperatur-Tauglichkeit sollte als eigenständiger Arbeitsschritt in die Fachplanung aufgenommen werden.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Maßnahmenfahrplan
 * ═══════════════════════════════════════════════════════════════════════ */
/** o: { start (Jahr), vorzug: ['V1', 'V3'], pv: { kwp, batKwh, eigenPct, autarkPct, einspeisungMwh }, zielJahr } */
/**
 * Technikprofil einer Variante für den Fahrplan: welche Erzeuger mit Leistung > 0 vorkommen.
 * Ohne Variante gilt das bisherige Standardbild (Wärmepumpe mit fossilem Spitzenlastkessel).
 */
export function faFahrplanProfil(v) {
  if (!v) return { wp: true, lwwp: true, geo: false, fg: false, biomasse: false, fossil: true, bhkw: false, fw: false, sk: false, speicher: false, standard: true };
  const hat = k => (v.erzeuger || []).some(x => x.key === k && ((Number(x.leistungKw) || 0) > 0 || (Number(x.waermeMwh) || 0) > 0 || (Number(x.speicherM3) || 0) > 0));
  const p = { lwwp: hat('lwwp'), geo: hat('geo'), fg: hat('fg'), biomasse: hat('pellets') || hat('hhs'), fossil: [...KESSEL].some(hat), bhkw: hat('bhkw'), fw: hat('fernwaerme'), sk: hat('stromkessel'), speicher: hat('_thermSpeicher') };
  p.wp = p.lwwp || p.geo || p.fg;
  return p;
}

/** Komponenten der Variante mit Leistung, z. B. „Luft-Wasser-Wärmepumpe 800 kW und Gaskessel 1,2 MW“. */
const FA_NAMEN = { lwwp: 'Luft-Wasser-Wärmepumpe', geo: 'Erdwärmepumpe', fg: 'Fließgewässer-Wärmepumpe', gaskessel: 'Gaskessel', _autoGk: 'Spitzenlast-Gaskessel', heizoel: 'Heizölkessel',
  bhkw: 'BHKW', pellets: 'Pelletkessel', hhs: 'Hackschnitzelkessel', stromkessel: 'Elektrodenkessel', fernwaerme: 'Fernwärmeanschluss' };
function komponenten(v) {
  return liste((v?.erzeuger || []).filter(x => FA_NAMEN[x.key] && (Number(x.leistungKw) || 0) > 0)
    .sort((a, b) => (Number(b.waermeMwh) || 0) - (Number(a.waermeMwh) || 0)).map(x => `${FA_NAMEN[x.key]} ${L(x.leistungKw)}`));
}

/**
 * Maßnahmenfahrplan für die Vorzugsvariante. o: { start, zielJahr, variante (Variantenobjekt), vorzug (Namen, Altform),
 * pv: { kwp, batKwh, eigenPct, autarkPct }, ausbau: [{ name, von, bis, anzahl, kostenEur }] (Phasen aus dem Ausbauplaner) }
 */
export function faTextFahrplan(o = {}) {
  const s = Number(o.start) || new Date().getFullYear() + 1;
  const J = (a, b) => (b ? `${s + a}–${s + b}` : `${s + a}`);
  const pv = o.pv || {};
  const v = o.variante || null;
  const p = faFahrplanProfil(v);
  const vz = v ? v.name : o.vorzug && o.vorzug.length ? liste(o.vorzug) : null;
  const out = [];
  if (v) {
    const k = komponenten(v);
    out.push(absatz(`Der Fahrplan bezieht sich auf die Vorzugsvariante ${v.name}${k ? ` (${k})` : ''}`,
      ok(v.investEur) && v.investEur > 0 ? ` mit einer Gesamtinvestition von rund ${v.investEur >= 1e6 ? `${nf(v.investEur / 1e6, 2)} Mio. €` : `${nf(v.investEur / 1000)} Tsd. €`}` : '', '.'));
  }
  out.push(absatz(p.wp
    ? 'Aus der Gesamtbetrachtung ergibt sich eine empfohlene zeitliche Abfolge der Maßnahmen. Leitgedanke ist, dass die Niedertemperatur-Ertüchtigung des Wärmeverteilnetzes Voraussetzung für den effizienten Wärmepumpenbetrieb ist und der Inbetriebnahme der Erzeugeranlage vorausgehen muss.'
    : 'Aus der Gesamtbetrachtung ergibt sich eine empfohlene zeitliche Abfolge der Maßnahmen. Leitgedanke ist, die neue Erzeugung abschnittsweise so zu errichten, dass die Versorgung durchgängig gewährleistet bleibt.'));
  out.push(absatz(`Sofortmaßnahmen (${J(0)}, Neubauten): Bei jedem Neubau sind geeignete Dachflächen mit Photovoltaik zu belegen`,
    pv.kwp > 0 ? `; insgesamt ergibt sich eine installierbare Leistung von rund ${nf(pv.kwp)} kWp${pv.batKwh > 0 ? ` mit einem Batteriespeicher von ${nf(pv.batKwh)} kWh` : ''}${ok(pv.eigenPct) ? ` (Eigenverbrauch ${pct(pv.eigenPct, 1)}${ok(pv.autarkPct) ? `, Autarkie ${pct(pv.autarkPct, 1)}` : ''})` : ''}` : '',
    '. Die endgültige Dimensionierung ist auf die gewählte Wärmeversorgung abzustimmen.'));
  out.push(absatz(`Kurzfristig (${J(0, 1)}): elektrotechnische Bestandsaufnahme (Hauptverteilung, Trafostationen, Anschlussleistung)`,
    p.wp || p.sk ? ' unter Berücksichtigung des künftigen Wärmepumpen- und PV-Betriebs' : ' unter Berücksichtigung des künftigen PV-Betriebs',
    p.wp ? ' sowie gebäudescharfe Bestandsaufnahme der Heizflächen und der Trinkwarmwasserbereitung als Grundlage der Niedertemperatur-Ertüchtigung.' : ' sowie Bestandsaufnahme der Heizzentrale und der Hausstationen.'));
  const planung = [];
  if (p.lwwp) planung.push('Wärmepumpenstandort (Schallschutz, Aufstellfläche)');
  if (p.geo) planung.push('Erdwärmesondenfeld mit Thermal Response Test und wasserrechtlicher Erlaubnis');
  if (p.fg) planung.push('Entnahme- und Rückgabebauwerk mit wasserrechtlicher Erlaubnis');
  if (p.biomasse) planung.push('Brennstofflager und Anlieferung');
  if (p.bhkw) planung.push('BHKW-Einbindung und Stromabnahme');
  if (p.fw) planung.push('Anschlussvertrag und Übergabestation mit dem Fernwärmeversorger');
  if (p.speicher) planung.push('Wärmespeicher');
  if (p.fossil) planung.push('Ausführung des Spitzenlast- und Resilienzkessels einschließlich Kaskadierung');
  if (p.wp || p.sk) planung.push('Klärung der Anschlussleistung mit dem Netzbetreiber');
  out.push(absatz(`Mittelfristig (${J(1, 2)}): vertiefende Fachplanung der Vorzugsvariante${vz ? ` (${vz})` : ''}`, planung.length ? ` mit ${liste(planung)}` : '', '.'));
  if (p.wp) out.push(absatz(`Niedertemperatur-Ertüchtigung (${J(2, 4)}): Anpassung der Heizflächen, Umstellung der Trinkwarmwasserbereitung und hydraulischer Abgleich – gebäudescharf, ohne umfassende Sanierung, innerhalb von rund zwei Jahren und vor Inbetriebnahme der Wärmepumpe abzuschließen.`));
  out.push(absatz(p.wp
    ? `Umsetzung (${J(3, 5)}): Errichtung der Erzeugerkomponenten parallel zur Ertüchtigung; Inbetriebnahme der Wärmepumpe nach abgeschlossener Netzumstellung, modular geplant, sodass die Versorgung durchgängig gewährleistet bleibt.`
    : `Umsetzung (${J(2, 4)}): Errichtung und Inbetriebnahme der Erzeugerkomponenten, modular geplant, sodass die Versorgung durchgängig gewährleistet bleibt.`));
  const ausbau = (o.ausbau || []).filter(a => a && a.name);
  if (ausbau.length) {
    out.push(absatz('Ausbauplanung der Liegenschaft: Die im Ausbauplaner hinterlegten Ausbaustufen sind in den Fahrplan einzuordnen – ',
      ausbau.map(a => `${a.name} (${a.von === a.bis ? a.von : `${a.von}–${a.bis}`}${a.anzahl ? `, ${a.anzahl} ${a.anzahl === 1 ? 'Maßnahme' : 'Maßnahmen'}` : ''}${a.kostenEur > 0 ? `, rund ${nf(a.kostenEur / 1000)} Tsd. €` : ''})`).join('; '), '.'));
  }
  if (p.fossil || p.bhkw) out.push(absatz(`Langfristig (ab ${s + 10}): Prüfung des Ersatzes des fossilen ${p.bhkw && !p.fossil ? 'BHKW' : 'Spitzenlastkessels'} durch einen Elektrokessel oder Wärmepumpen, sobald Strommix und Wirtschaftlichkeit dies zulassen, um die verbleibende fossile Erzeugung bis ${o.zielJahr || 2045} zu substituieren.`));
  out.push(absatz('Begleitend: fortlaufende Beobachtung der Energiepreise; bei deutlicher Abweichung von den angenommenen Szenarien ist die Variantenrangfolge neu zu bewerten.'));
  return out;
}

/** Vorzugsvariante: Vorgabe aus dem Fragebogen, sonst Rang 1 der Bewertungsmatrix, sonst niedrigste Wärmegestehungskosten. */
export function faVorzugsvariante(o = {}, wahl) {
  const V = o.varianten || [];
  if (wahl && wahl !== 'auto') { const v = V.find(x => x.name === wahl); if (v) return v; }
  const m = faBewertungsmatrix(o);
  if (m) return m.zeilen[0].v;
  return [...V].filter(v => ok(v.wgkCt)).sort((a, b) => a.wgkCt - b.wgkCt)[0] || V[0] || null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Resilienz: Heizölbevorratung und Übergangsmaßnahmen
 * ═══════════════════════════════════════════════════════════════════════ */
export const FA_OEL = Object.freeze({ heizwertKwhL: 10, stunden: 72, kurzStunden: 24 });

export function faHeizoeltank(maxKw, mittelKw, stunden = FA_OEL.stunden) {
  const kwh = maxKw * stunden;
  const m3 = kwh / FA_OEL.heizwertKwhL / 1000;
  return { kwh, m3, kante: Math.cbrt(m3), reichweiteH: mittelKw > 0 ? kwh / mittelKw : NaN, literProH: maxKw / FA_OEL.heizwertKwhL, m3Kurz: (maxKw * FA_OEL.kurzStunden) / FA_OEL.heizwertKwhL / 1000 };
}

export function faTextHeizoeltank(o = {}) {
  if (!(o.maxKw > 0)) return [];
  const st = o.stunden || FA_OEL.stunden;
  const r = faHeizoeltank(o.maxKw, o.mittelKw, st);
  return [
    absatz(`Die Heizölbevorratung wird so ausgelegt, dass bei maximaler Heizlast von ${L(o.maxKw)} ein durchgängiger Betrieb über ${nf(st / 24)} Tage bzw. ${nf(st)} Stunden gewährleistet ist. `,
      `Daraus ergibt sich ein Energiebedarf von rund ${nf(r.kwh / 1000, 1)} MWh; bei einem Heizwert von ${nf(FA_OEL.heizwertKwhL)} kWh je Liter entspricht dies einem nutzbaren Speichervolumen von rund ${nf(r.m3, 1)} m³ – anschaulich ein Würfel mit etwa ${nf(r.kante, 2)} m Kantenlänge.`),
    absatz(ok(r.reichweiteH) ? `Bezogen auf die durchschnittliche Heizlast von ${L(o.mittelKw)} reicht dieser Vorrat für rund ${nf(r.reichweiteH)} Betriebsstunden bzw. ${nf(r.reichweiteH / 24, 1)} Tage. ` : '',
      `Für ${FA_OEL.kurzStunden} Stunden bei maximaler Heizlast werden rund ${nf(r.m3Kurz, 1)} m³ benötigt; der stündliche Bedarf liegt dann bei etwa ${nf(r.literProH)} Litern.`),
    absatz('Da der Tank wegen der Alterung des Brennstoffs nicht dauerhaft vollständig befüllt sein soll, ist eine Aufteilung in mehrere einzeln nutzbare Kammern vorzusehen. Kesselwirkungsgrad, Sicherheitsreserven und nicht nutzbare Restmengen sind noch nicht berücksichtigt; das tatsächliche Tankvolumen ist entsprechend größer auszulegen.'),
  ];
}

export function faTextResilienzUebergang() {
  return [absatz('Da die wirksamen Resilienzmaßnahmen investiver Natur sind, bleibt das derzeitige Niveau bis zu ihrer Umsetzung unverändert. Für den Übergangszeitraum wird empfohlen, die Versorgungssicherheit organisatorisch zu stärken: durch eine dokumentierte Notfallorganisation, gesicherte Verfügbarkeit von Personal für die manuelle Umschaltung auf den Netzersatzbetrieb, eine verlässliche Kraftstoffversorgung sowie die Bevorratung kritischer Ersatzteile für alterungsbedingt ausfallgefährdete Komponenten.')];
}

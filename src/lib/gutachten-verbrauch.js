// ── lib/gutachten-verbrauch.js — Gutachtentexte „Ist- und Soll-Wärmeverbrauch“: Datengrundlage, Energiebezug, CO₂ ──
// DOM-frei. Eingabe: baVerbrauchAuswertung / baMixVerschiebung aus lib/bestandsanlage.js.
import { F, wtHilfen } from './gutachten-waerme-texte.js';
import { BA_AUFLOESUNG, baMixVerschiebung } from './bestandsanlage.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;

/** Annahmen für die CO₂-Veranschaulichung. */
export const VB_VERGLEICH = Object.freeze({
  kgCo2ProLiterBenzin: 2.37,     // Verbrennung von 1 l Ottokraftstoff (Umweltbundesamt, gerundet)
  literPro100km: 7.0,            // mittlerer Verbrauch eines Benzin-Pkw (Annahme)
  erdumfangKm: 40075,
});

const BEZUG = { Erdgas: 'den Erdgasbezug', Heizöl: 'den Heizölbezug', Holzpellets: 'den Pelletverbrauch', Holzhackschnitzel: 'den Hackschnitzelverbrauch',
  Strom: 'den Strombezug der Wärmeerzeugung', Fernwärme: 'den Fernwärmebezug', Solar: 'den Solarertrag' };
const groß = t => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Einleitung und Datengrundlage. */
export function vbTextDaten(v) {
  const out = [absatz('Zur Auslegung der zukünftigen Wärmeerzeugung wurden die zur Verfügung gestellten Verbrauchsdaten der Energieträger sowie die Informationen zur vorhandenen und zukünftigen Infrastruktur betrachtet und ausgewertet.')];
  if (!v || !v.anzahlJahre) {
    out.push(absatz('Ausgewertet wurden ', F('Verbrauchsdaten (Energieträger, Zeitraum, Auflösung) – unter 🔥 Wärme-Grundlagen → Bestandsanlage → Verbrauchsdaten erfassen'), '.'));
    return out;
  }
  out.push(absatz(v.vonJahr === v.bisJahr ? `Für das Jahr ${v.vonJahr} konnten die folgenden bereitgestellten Daten ausgewertet werden:`
    : `Für die Jahre ${v.vonJahr} bis ${v.bisJahr} konnten die folgenden bereitgestellten Daten ausgewertet werden:`));
  const nachTraeger = new Map();
  for (const g of v.gruppen) {
    if (!nachTraeger.has(g.traeger)) nachTraeger.set(g.traeger, new Set());
    g.aufloesung.forEach(a => nachTraeger.get(g.traeger).add(a));
  }
  const punkte = [...nachTraeger.entries()];
  punkte.forEach(([t, auf], i) => {
    const a = [...auf].map(x => BA_AUFLOESUNG[x]);
    out.push(absatz(`• ${BEZUG[t] || `den Bezug ${t}`} als ${liste(a)}${i < punkte.length - 1 ? ',' : '.'}`));
  });
  out.push(absatz('Es wird davon ausgegangen, dass die Nutzung der Liegenschaft in den Betrachtungsjahren repräsentativ ist.'));
  return out;
}

/** Energiebezug über die Jahre: Mittel, Spanne, Aufteilung, Verschiebung des Mix. */
export function vbTextBezug(v) {
  const out = [];
  if (!v || !v.anzahlJahre) return out;
  const p = [];
  if (v.anzahlJahre > 1) {
    p.push(`Der Energiebezug der Liegenschaft liegt im Betrachtungszeitraum ${v.vonJahr}–${v.bisJahr} im Mittel bei rund ${nf(v.summeMittel)} MWh/a `,
      `und schwankt zwischen ${nf(v.minJahr.summe)} MWh (${v.minJahr.jahr}) und ${nf(v.maxJahr.summe)} MWh (${v.maxJahr.jahr}). `);
  } else {
    p.push(`Der Energiebezug der Liegenschaft beträgt im Jahr ${v.vonJahr} rund ${nf(v.summeMittel)} MWh. `);
  }
  const d = v.dominant;
  if (d && v.gruppen.length > 1) {
    p.push(`Dominierend ist ${v.anzahlJahre > 1 ? (v.dominantJedesJahr ? 'über alle Jahre ' : 'im Mittel ') : ''}${d.label}, ${d.kwk ? 'das' : 'der'} ${v.anzahlJahre > 1 ? 'im Durchschnitt ' : ''}rund ${nf(d.mittelMwh)} MWh bzw. etwa ${pct(d.anteilPct)} des Gesamtbezugs ausmacht.`);
    const rest = v.gruppen.slice(1).filter(g => g.mittelMwh > 0);
    const teile = rest.map(g => {
      if (g.kwk) return `${g.label} trägt mit rund ${nf(g.mittelMwh)} MWh (ca. ${pct(g.anteilPct)})${v.anzahlJahre > 2 && g.cv < 0.1 ? ' vergleichsweise konstant' : ''} bei`;
      if (g.ee) return `${g.label} stellt mit ${v.anzahlJahre > 1 ? 'durchschnittlich ' : ''}rund ${nf(g.mittelMwh)} MWh (ca. ${pct(g.anteilPct)}) ${rest.filter(x => x.ee).length === 1 ? 'den wesentlichen erneuerbaren Anteil' : 'einen erneuerbaren Anteil'}`;
      return `${g.label} macht rund ${nf(g.mittelMwh)} MWh (ca. ${pct(g.anteilPct)}) aus`;
    });
    if (teile.length) p.push(` ${groß(liste(teile))}.`);
  } else if (d) {
    p.push(`Der gesamte Bezug entfällt auf ${d.label.replace(/^der |^das /, '')}.`);
  }
  out.push(absatz(...p));

  const s = baMixVerschiebung(v);
  if (s) {
    const j = s.jahrDaten;
    const fos = v.gruppen.filter(g => g.fossil), ee = v.gruppen.filter(g => g.ee);
    const wert = gl => `${nf(gl.reduce((x, g) => x + j.werte[g.key], 0))} MWh, ca. ${pct(gl.reduce((x, g) => x + j.anteile[g.key], 0))}`;
    const krise = s.jahr === 2022 || s.jahr === 2023;
    const q = [`Auffällig ist die Entwicklung des Erzeugungsmix: Im Jahr ${s.jahr} ging der fossile Bezug deutlich zurück (${wert(fos)})`,
      ee.length ? `, während der erneuerbare Bezug auf ${wert(ee).replace(', ca.', ' (ca.')}) anstieg` : '',
      krise ? ' – ein Substitutionseffekt, der im zeitlichen Zusammenhang mit den stark gestiegenen Gaspreisen im Zuge der Energiekrise 2022 stehen dürfte.' : '.'];
    if (s.rueckJahr) {
      const r = s.rueckJahr;
      q.push(` Diese Verschiebung blieb jedoch nicht von Dauer: Bis ${r.jahr} stieg der fossile Anteil wieder auf rund ${pct(r.fossilPct)}. Der Anteil fossiler Energieträger am Bezug hat sich damit nach ${s.jahr} wieder erhöht.`);
    }
    out.push(absatz(...q));
  }
  if (ok(v.fossilPctMittel) && v.fossilPctMittel >= 50) {
    const j = v.jahre, steigt = j.length >= 2 && j[j.length - 1].fossilPct - j[j.length - 2].fossilPct >= 2;
    out.push(absatz(`Insgesamt zeigt sich eine strukturell hohe${steigt ? ' und zuletzt erneut steigende' : ''} Abhängigkeit von fossilen Energieträgern (im Mittel ${pct(v.fossilPctMittel)} des Bezugs), die den Handlungsbedarf hinsichtlich einer Dekarbonisierung der Wärmeversorgung unterstreicht.`));
  }
  return out;
}

/** CO₂-Emissionen nach GEG-Faktoren und Veranschaulichung. */
export function vbTextCo2(v) {
  if (!v || !v.anzahlJahre || !(v.co2MittelT > 0)) return [];
  const tr = new Map();
  for (const g of v.gruppen) {
    if (!tr.has(g.traeger)) tr.set(g.traeger, { traeger: g.traeger, faktor: g.faktor, t: 0 });
    tr.get(g.traeger).t += g.co2MittelT;
  }
  const l = [...tr.values()].filter(x => x.t > 0 || x.faktor > 0).sort((a, b) => b.t - a.t);
  const out = [absatz(`Unter Anwendung der spezifischen Emissionsfaktoren nach GEG (Anlage 9) – ${liste(l.map(x => `${nf(x.faktor)} g CO₂e/kWh für ${x.traeger}`))} – `,
    `errechnet sich für die Liegenschaft ein ${v.anzahlJahre > 1 ? 'durchschnittlicher ' : ''}CO₂-Ausstoß von rund ${nf(v.co2MittelT)} t pro Jahr. `,
    l.length > 1 ? `Davon entfallen ${liste(l.map(x => `${nf(x.t)} t CO₂e (${pct((x.t / v.co2MittelT) * 100, 1)}) auf ${x.traeger}`))}.` : '')];
  const c = VB_VERGLEICH;
  const liter = (v.co2MittelT * 1000) / c.kgCo2ProLiterBenzin;
  const km = (liter / c.literPro100km) * 100;
  out.push(absatz(`Zur Veranschaulichung: Die jährliche Emissionsmenge entspricht der Verbrennung von rund ${liter >= 1e6 ? `${nf(liter / 1e6, 2)} Mio.` : nf(liter)} Litern Benzin `,
    `bzw. einer Fahrleistung von etwa ${km >= 1e6 ? `${nf(km / 1e6, 1)} Mio.` : nf(km)} Pkw-Kilometern. Das sind rund ${nf(km / c.erdumfangKm)} Erdumrundungen im Jahr `,
    `oder ${nf(km / c.erdumfangKm / 365, 2)} Erdumrundungen täglich mit einem Benzin-Pkw (Annahmen: ${nf(c.kgCo2ProLiterBenzin, 2)} kg CO₂ je Liter, ${nf(c.literPro100km, 1)} l/100 km).`));
  return out;
}

/** Wahl des Referenzjahrs für die Lastganganalyse. */
export function vbTextReferenzjahr(v, lastgangJahr) {
  if (!v || v.anzahlJahre < 2 || !v.referenzJahr) return [];
  const gleich = lastgangJahr && Number(lastgangJahr) === v.referenzJahr;
  return [absatz(`Die energetische Aufteilung zwischen den Energieträgern entspricht im Jahr ${v.referenzJahr} am stärksten dem Mehrjahresdurchschnitt. `,
    gleich || !lastgangJahr ? `Dieses Jahr wird daher als Referenzzeitraum für die weitere Analyse herangezogen.`
      : `Für die weitere Analyse wird das Jahr ${lastgangJahr} herangezogen; die Abweichung zum repräsentativsten Jahr ist bei der Bewertung zu berücksichtigen.`)];
}

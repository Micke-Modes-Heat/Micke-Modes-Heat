// ── lib/gutachten-anlagentechnik.js — Gutachtentexte „Ist-Zustand Anlagentechnik“ ──
// DOM-frei. Eingaben: Auswertungen aus lib/bestandsanlage.js. Abschnitte: Wärmeerzeuger, Wärmeverteilung und
// Hydraulik, Trinkwarmwasser, Wärmenetz. Fehlende Angaben werden gelbe Platzhalter, nichts wird erfunden.
import { F, wtHilfen } from './gutachten-waerme-texte.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;

/** Leistung lesbar: ab 1 MW in MW mit zwei Nachkommastellen, sonst kW. */
export const atLeistung = kw => (kw >= 1000 ? `${nf(kw / 1000, 2)} MW` : `${nf(kw)} kW`);
const L = atLeistung;
const ARTIKEL_TYP = { bhkw_gas: 'das', waermepumpe: 'die', solarthermie: 'die', fernwaerme: 'die' };
const derDie = (z, gross = false) => { const a = ARTIKEL_TYP[z.typ] || 'der'; return gross ? a[0].toUpperCase() + a.slice(1) : a; };

/** Wärmeerzeuger: Leistungen, Energieträger, Vergleich mit der Heizlast, (n−1), Einordnung, Alter. */
export function atTextErzeuger(a) {
  const out = [];
  if (!a || !a.anzahl) {
    out.push(absatz('Die bestehende Wärmeerzeugung der Liegenschaft besteht aus ',
      F('Bestehende Wärmeerzeuger (Typ, Leistung, Baujahr) – unter 🔥 Wärme-Grundlagen → Bestandsanlage erfassen'), '.'));
    return out;
  }
  const mitL = a.zeilen.filter(z => ok(z.thermKw));
  out.push(absatz(`Der derzeitige Erzeugerpark umfasst ${a.anzahl === 1 ? 'einen Wärmeerzeuger' : `${nf(a.anzahl)} Wärmeerzeuger`}`,
    a.thermKw > 0 ? ` mit einer installierten thermischen Gesamtleistung von ${L(a.thermKw)}` : '',
    a.feuerungKw > 0 ? ` bei einer Feuerungsleistung von ${L(a.feuerungKw)}` : '', '.'));

  // Energieträger
  const haupt = a.traegerAnteile[0];
  if (haupt && ok(haupt.pct) && mitL.length) {
    const hauptZ = mitL.filter(z => z.traeger === haupt.traeger && !z.kwk);
    const rest = mitL.filter(z => !hauptZ.includes(z));
    const p = [];
    if (haupt.pct >= 99.5) p.push(`Die Wärmebereitstellung erfolgt vollständig auf Basis von ${haupt.traeger}.`);
    else if (hauptZ.length) {
      p.push(`Die Wärmebereitstellung erfolgt ${haupt.pct >= 75 ? 'ganz überwiegend' : haupt.pct >= 50 ? 'überwiegend' : 'zu einem wesentlichen Teil'} auf Basis von ${haupt.traeger}: `,
        `${liste(hauptZ.map((z, i) => `${i === 0 ? derDie(z, true) : derDie(z)} ${z.name} (${L(z.thermKw)})`))} ${hauptZ.length > 1 ? 'decken zusammen' : 'deckt'} rund ${pct(hauptZ.reduce((x, z) => x + z.anteilPct, 0))} der thermischen Leistung ab.`);
    }
    if (rest.length && haupt.pct < 99.5) {
      if (ok(a.eePct) && a.eePct < 25 && a.fossilPct >= 50) p.push(' Erneuerbare bzw. hocheffiziente Erzeuger sind bislang nur nachrangig vertreten.');
      const normal = rest.filter(z => !z.kwk), kwk = rest.filter(z => z.kwk);
      if (normal.length) p.push(` ${liste(normal.map((z, i) => `${i === 0 ? derDie(z, true) : derDie(z)} ${z.name} trägt mit ${L(z.thermKw)} etwa ${pct(z.anteilPct)}`))} bei.`);
      for (const z of kwk) {
        p.push(` ${derDie(z, true)} ${z.name} stellt mit ${L(z.thermKw)} rund ${pct(z.anteilPct)} der thermischen Leistung`,
          ok(z.elKw) ? `, liefert daneben jedoch ${L(z.elKw)} elektrische Leistung` : '',
          ' und deckt als Kraft-Wärme-Kopplungsanlage typischerweise den Grundlastbetrieb ab.');
      }
    }
    if (p.length) out.push(absatz(...p));
  }

  // Leistungsvergleich und (n−1)
  if (a.thermKw > 0 && ok(a.heizlastIstKw)) {
    const p = [];
    const soll = ok(a.heizlastSollKw) && Math.abs(a.heizlastSollKw - a.heizlastIstKw) > 0.02 * a.heizlastIstKw ? a.heizlastSollKw : NaN;
    const ist = `die aktuelle Gesamtheizlast (${L(a.heizlastIstKw)})`, kuenftig = `die künftig zu erwartende Heizlast (${L(soll)})`;
    const istDat = `der aktuellen Gesamtheizlast (${L(a.heizlastIstKw)})`;
    const deckIst = a.thermKw >= a.heizlastIstKw, deckSoll = ok(soll) ? a.thermKw >= soll : null;
    p.push('Der Vergleich mit der aus der Gebäudebetrachtung hervorgegangenen Heizlast zeigt, dass die installierte thermische Leistung ');
    if (deckSoll === null) p.push(deckIst ? `${ist} übersteigt; die Leistungsreserve beträgt rund ${L(a.reserveIstKw)}.` : `unter ${istDat} liegt; es fehlen rund ${L(-a.reserveIstKw)}.`);
    else if (deckIst && deckSoll) p.push(`sowohl ${ist} als auch ${kuenftig} übersteigt; es besteht somit eine Leistungsreserve von rund ${L(a.reserveSollKw)} gegenüber dem zukünftigen Bedarf.`);
    else if (deckIst) p.push(`${ist} zwar übersteigt, ${kuenftig} jedoch um rund ${L(-a.reserveSollKw)} unterschreitet; mit der baulichen Entwicklung ist zusätzliche Erzeugungsleistung erforderlich.`);
    else if (deckSoll) p.push(`${ist} derzeit um rund ${L(-a.reserveIstKw)} unterschreitet, ${kuenftig} jedoch deckt.`);
    else p.push(`weder ${ist} noch ${kuenftig} deckt.`);
    if (a.anzahl > 1 && a.groesster && a.n1Erfuellt !== null) {
      p.push(` Bei Ausfall des leistungsstärksten Erzeugers (${a.groesster.name}, ${L(a.groesster.thermKw)}) würde die verbleibende Leistung von rund ${L(a.ohneGroesstenKw)} die Heizlast `,
        a.n1Erfuellt ? 'weiterhin vollständig abdecken; eine (n−1)-Versorgungsredundanz im Auslegungspunkt ist damit gegeben.'
          : 'nicht mehr vollständig abdecken; eine (n−1)-Versorgungsredundanz im Auslegungspunkt ist demnach nicht gegeben.');
    }
    p.push(' Die Heizlast ist hier die Summe der Einzelheizlasten; wegen der Gleichzeitigkeit liegt die tatsächliche Spitzenlast niedriger, der Vergleich ist daher auf der sicheren Seite.');
    out.push(absatz(...p));
  } else if (a.thermKw > 0) {
    out.push(absatz('Ein Vergleich mit der Heizlast setzt Gebäudedaten mit Heizlasten voraus; diese liegen nicht vor.'));
  }

  // Energetische Einordnung
  if (ok(a.fossilPct) && a.fossilPct >= 50) {
    const tr = a.traegerAnteile.find(t => a.zeilen.some(z => z.traeger === t.traeger && z.fossil));
    out.push(absatz(`Aus energetischer Sicht ist der Erzeugerpark ${tr ? `aufgrund des hohen ${tr.traeger}anteils ` : ''}${a.fossilPct >= 80 ? 'weitgehend' : 'überwiegend'} fossil geprägt; im Hinblick auf die Anforderungen des Gebäudeenergiegesetzes bietet er ein erhebliches Dekarbonisierungspotenzial.`));
  } else if (ok(a.eePct) && a.eePct >= 50) {
    out.push(absatz(`Der Erzeugerpark beruht bereits zu rund ${pct(a.eePct)} der thermischen Leistung auf erneuerbaren Energien.`));
  }

  // Alter und Nutzungsdauer
  const mitBj = a.zeilen.filter(z => z.baujahr);
  if (mitBj.length) {
    const jahre = [...new Set(mitBj.map(z => z.baujahr))];
    const ort = a.heizzentrale ? [' zentral in ', F('Heizzentrale (Gebäude)', a.heizzentrale)] : '';
    const p = [];
    if (jahre.length === 1 && mitBj.length === a.anzahl) p.push(`${a.anzahl > 1 ? 'Sämtliche Wärmeerzeuger wurden' : 'Der Wärmeerzeuger wurde'} im Jahr ${jahre[0]}`, ort, ' installiert. ');
    else if (ort) p.push('Die Wärmeerzeuger befinden sich', ort, ` und stammen aus den Jahren ${liste([...jahre].sort((x, y) => x - y).map(String))}. `);
    else p.push(`Die Wärmeerzeuger stammen aus den Jahren ${liste([...jahre].sort((x, y) => x - y).map(String))}. `);
    const gruppen = new Map();
    for (const z of mitBj) { const k = `${z.abgaengigAb}|${z.nutzungsdauer}`; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(z); }
    const sortiert = [...gruppen.values()].sort((x, y) => x[0].abgaengigAb - y[0].abgaengigAb);
    const wer = l => `${liste(l.map((z, i) => `${derDie(z)} ${z.name}`))} (${l[0].nutzungsdauer} Jahre)`;
    const vorbei = sortiert.filter(l => l[0].abgaengigAb <= a.jahr), kommend = sortiert.filter(l => l[0].abgaengigAb > a.jahr);
    for (const l of vorbei) {
      const t = wer(l);
      p.push(`${t[0].toUpperCase()}${t.slice(1)} ${l.length > 1 ? 'haben' : 'hat'} die kalkulatorische Nutzungsdauer nach VDI 2067 bereits ${l[0].abgaengigAb === a.jahr ? 'erreicht' : `seit ${l[0].abgaengigAb} überschritten`}. `);
    }
    if (kommend.length) {
      const [erste, ...rest] = kommend;
      p.push(`Unter Berücksichtigung der kalkulatorischen Nutzungsdauer nach VDI 2067 ${erste.length > 1 ? 'sind' : 'ist'} ${wer(erste)} voraussichtlich ab dem Jahr ${erste[0].abgaengigAb} als abgängig einzustufen`,
        rest.map(l => `, ${wer(l)} ab dem Jahr ${l[0].abgaengigAb}`).join(''), '.');
    }
    if (a.abgaengig.length) p.push(` Ein Ersatz ${a.abgaengig.length === a.anzahl ? 'des gesamten Erzeugerparks' : 'der betroffenen Erzeuger'} ist zeitnah einzuplanen und sollte bereits auf das künftige Versorgungskonzept ausgerichtet sein.`);
    out.push(absatz(...p));
  } else {
    out.push(absatz('Angaben zum Baujahr der Erzeuger liegen nicht vor; eine Einordnung nach der kalkulatorischen Nutzungsdauer ist daher nicht möglich.'));
  }
  return out;
}

/** Wärmeverteilung und Hydraulik der Heizzentrale. */
export function atTextHydraulik(a) {
  const out = [];
  if (!a || !a.anzahl) return out;
  const p = [];
  if (a.anzahl > 1) p.push('Bei der Bestandsanlage handelt es sich um ein multivalentes Heizsystem, in dem mehrere Wärmeerzeuger gemeinsam die Liegenschaft versorgen. ');
  if (ok(a.pufferM3)) {
    const lProKw = a.thermKw > 0 ? (a.pufferM3 * 1000) / a.thermKw : NaN;
    p.push(`Die Erzeuger wirken auf einen zentralen Pufferspeicher mit einem Nennvolumen von ${nf(a.pufferM3, a.pufferM3 < 10 ? 1 : 0)} m³`,
      ok(lProKw) ? ` (rund ${nf(lProKw)} l je kW thermischer Leistung)` : '',
      '. Er fungiert als hydraulische Weiche zur Entkopplung der Volumenströme von Erzeugung und Verbrauch, puffert Lastspitzen und reduziert die Taktung der Wärmeerzeuger.');
  } else {
    p.push('Ein zentraler Pufferspeicher ist ', F('Pufferspeicher vorhanden? Nennvolumen in m³'), '.');
  }
  out.push(absatz(...p));
  out.push(absatz(F('Hydraulische Einbindung der Erzeuger und sekundärseitige Verteilung (z. B. Pumpenstation, Heizkreisverteiler, Rücklaufsammler)', '')));
  if (a.schemaJahr) {
    out.push(absatz(`Es ist darauf hinzuweisen, dass das vorliegende Hydraulikschema den Stand aus dem Jahr ${a.schemaJahr} abbildet. Sofern seitdem hydraulische Anpassungen vorgenommen wurden, konnten diese mangels aktueller Unterlagen zum Zeitpunkt der Berichterstellung nicht berücksichtigt werden.`));
  }
  return out;
}

/** Trinkwarmwasser aus den Gebäudefeldern. */
export function atTextTww(t) {
  const out = [];
  if (!t || !t.anzahlErfasst) {
    out.push(absatz('Die Trinkwarmwasserbereitung (TWW) erfolgt ',
      F('zentral oder dezentral; Erzeugungsart und Leistung je Gebäude in den Gebäudefeldern „TWW-Art“ und „TWW-Leistung“ erfassen'), '.'));
    out.push(absatz(TWW_TEMPERATUR));
    return out;
  }
  const mitTww = t.anzahlErfasst - t.anzahlOhne;
  out.push(absatz('Die Trinkwarmwasserbereitung (TWW) der Liegenschaft erfolgt dezentral auf Gebäudeebene. ',
    `Nach den vorliegenden Unterlagen verfügen die betrachteten Gebäude über eine summierte TWW-Erzeugungsleistung von rund ${nf(t.kw)} kW, verteilt auf ${nf(mitTww)} Gebäude`,
    t.anzahlOhne ? `; an ${nf(t.anzahlOhne)} ${t.anzahlOhne === 1 ? 'Gebäude' : 'Gebäuden'} ist keine eigene TWW-Erzeugung vorhanden` : '', '.'));
  if (t.kw > 0) {
    const p = [];
    if (t.durchlaufKw > 0) {
      const gr = t.groesste.reduce((x, g) => x + g.kw, 0);
      p.push(`Rund ${pct((t.durchlaufKw / t.kw) * 100)} der TWW-Leistung entfallen auf Frischwasserstationen und Plattenwärmetauscher (zusammen ca. ${nf(t.durchlaufKw)} kW)`,
        t.groesste.length >= 2 && gr >= 0.5 * t.durchlaufKw ? `, wobei der Großteil auf wenige Gebäude mit großen Stationen zurückgeht (u. a. ${liste(t.groesste.map(g => `${nf(g.kw)}`))} kW)` : '', '. ');
    }
    const neben = [t.elektrischKw > 0 ? `elektrische Durchlauferhitzer (ca. ${nf(t.elektrischKw)} kW)` : '', t.speicherKw > 0 ? `speicherbasierte Einzellösungen (zusammen ca. ${nf(t.speicherKw)} kW)` : ''].filter(Boolean);
    if (neben.length) {
      const s = liste(neben);
      p.push(`${s[0].toUpperCase()}${s.slice(1)} sind ${t.durchlaufKw > t.elektrischKw + t.speicherKw ? 'nachrangig, ' : ''}aufgrund ${[t.elektrischKw > 0 ? 'der Strombeheizung' : '', t.speicherKw > 0 ? 'der Speicherverluste' : ''].filter(Boolean).join(' bzw. ')} jedoch gesondert zu betrachten. `);
    }
    p.push('Inwiefern die jeweiligen TWW-Erzeugungsleistungen in der Realität benötigt werden, konnte nicht geprüft werden.');
    out.push(absatz(...p));
  }
  out.push(absatz(F('Ergebnisse der Vor-Ort-Dokumentation: dokumentierte TWW-Prinzipien (Speicherladesystem, Durchlaufprinzip) je Gebäude', '')));
  if (t.durchlaufKw > 0 && t.gruppen.length > 1) {
    out.push(absatz('Eine pauschale Zuordnung der als „PWT“ bzw. „FWS“ erfassten Positionen zu einem einheitlichen Prinzip ist nicht zulässig; eine belastbare Einordnung setzt eine gebäudeweise Erfassung der Anlagen und ihrer hydraulischen Einbindung voraus.'));
  }
  out.push(absatz(TWW_TEMPERATUR));
  return out;
}

const TWW_TEMPERATUR = 'Für die spätere Umstellung auf regenerative Erzeuger, insbesondere Wärmepumpen, ist die Warmwassertemperatur der maßgebliche Engpass: '
  + 'Speicherladesysteme erfordern aus Gründen der Trinkwasserhygiene Speichertemperaturen von mindestens 60 °C, Durchlaufsysteme entsprechend hohe Vorlauftemperaturen auf der Heizungsseite. '
  + 'Beides begrenzt eine Absenkung der Netz- bzw. Vorlauftemperatur. Zur Entkopplung der Trinkwarmwasser- von der Netztemperatur kommen dezentrale Nachheizlösungen in Betracht: '
  + 'energetisch günstige Booster-Wärmepumpen oder einfach nachrüstbare, jedoch direktelektrische Heizpatronen. Eine weitere Betrachtung dieser Optionen erfolgt im Variantenvergleich.';

/** Wärmenetz: Datenlage. netz: { imTool: Bestandsnetz im Tool gezeichnet, laengeM } */
export function atTextNetz(a, netz = {}) {
  const hz = a?.heizzentrale ? [' Die Heizzentrale befindet sich in ', F('Heizzentrale (Gebäude)', a.heizzentrale), '.'] : '';
  const daten = a?.netzDaten || 'plan';
  if (netz.imTool && netz.laengeM > 0) {
    return [absatz(`Das Bestandsnetz wurde auf Grundlage der vorliegenden Unterlagen im Planungswerkzeug nachgebildet; die Trassenlänge beträgt rund ${nf(netz.laengeM)} m.`,
      daten !== 'vollstaendig' ? ' Leitungsdurchmesser, Dämmstärken und Durchflüsse liegen nicht vollständig vor und wurden, soweit erforderlich, nach den Auslegungsregeln abgeschätzt.' : '', hz)];
  }
  if (daten === 'keine') return [absatz('Zum Wärmenetz liegen keine Unterlagen vor.', hz)];
  if (daten === 'vollstaendig') return [absatz('Zum Wärmenetz liegen Angaben zu Leitungsdurchmessern, Trassenlängen und Dämmstärken vor; sie sind in die Netzberechnung eingeflossen.', hz)];
  return [absatz('Zum Wärmenetz liegen über den nachfolgenden Plan hinaus keine weiteren Angaben vor – insbesondere nicht zu Leitungsdurchmessern, Trassenlängen, Dämmstärken, Durchflüssen, Energiedurchsätzen oder übertragenen Leistungen.', hz)];
}

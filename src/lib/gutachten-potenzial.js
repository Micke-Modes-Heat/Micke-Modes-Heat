// ── lib/gutachten-potenzial.js — Gutachtentexte Potenzialanalyse ──
// DOM-frei. Abschnitte: Einleitung, nicht berücksichtigte Potenziale (je Potenzial ein Baustein), berücksichtigte
// Potenziale, oberflächennahe Geothermie (Sondenfeld), Tiefengeothermie (Fördermenge), Luft-Wasser-Wärmepumpe,
// Schallemissionen, Biomasse (Pellets/Hackschnitzel). Rechenwerte sind benannte Konstanten; Standortwerte
// (Wärmeleitfähigkeit, Zielhorizonte) kommen aus dem Projekt oder bleiben Platzhalter.
import { F, wtHilfen, wtDeckungsleistung } from './gutachten-waerme-texte.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;
const L = kw => (kw >= 1000 ? `${nf(kw / 1000, 2)} MW` : `${nf(kw)} kW`);

/* ══════════════════════════════════════════════════════════════════════════
 * Einleitung und nicht berücksichtigte Potenziale
 * ═══════════════════════════════════════════════════════════════════════ */
export function ptTextEinleitung() {
  return [absatz('Im folgenden Kapitel wird eine Potenzialanalyse durchgeführt. Ziel ist es, die in Frage kommenden Energiequellen auf ihre Verfügbarkeit, Effizienz und Machbarkeit zu prüfen, um eine nachhaltige und wirtschaftliche Energieversorgung zu gewährleisten. ',
    'Zunächst werden die nicht weiter berücksichtigten Potenziale mit kurzer Begründung beschrieben, anschließend die berücksichtigten Potenziale näher untersucht.')];
}

/** Katalog der nicht berücksichtigten Potenziale mit Standardbegründung. Je Eintrag ein eigener Baustein, der im Gutachten entfernt werden kann. */
export const PT_NICHT = Object.freeze({
  abwaerme: { titel: 'Abwärmepotenziale in der Nähe', text: () => [absatz('In der unmittelbaren Umgebung konnten keine nennenswerten Abwärmequellen (z. B. aus Industrie, Rechenzentren oder Müllverbrennung) identifiziert werden.')] },
  solarthermie: { titel: 'Solarthermie', text: () => [absatz('Wegen der begrenzten Flächen sowie der direkten Flächenkonkurrenz zur Photovoltaik wird die Solarthermie als Energiequelle nicht weiter berücksichtigt. Die Photovoltaik-Potenziale werden im Teil Elektrotechnik betrachtet.')] },
  wasserstoff: { titel: 'Wasserstoffverfeuerung', text: () => [absatz('Aufgrund der unsicheren Verfügbarkeit und Preisentwicklung wird Wasserstoff nicht als Option für die Grundlastversorgung der Liegenschaft herangezogen. Die aktuellen Marktprognosen bieten keine ausreichende Planungssicherheit bezüglich künftiger Preise und Verfügbarkeiten für die Gebäudebeheizung. Ohne verlässliche Perspektive zu Wirtschaftlichkeit und Verfügbarkeit erscheint die Einbindung in das Energiekonzept nicht sinnvoll.')] },
  gasGrundlast: { titel: 'Gasbrennwertkessel (Grundlast)', text: o => [absatz('Um eine klimafreundliche und nachhaltige Wärmeversorgung zu gewährleisten, wird eine primär auf fossilen Brennstoffen basierende Erzeugung nicht weiterverfolgt. ',
    'Als Spitzenlast- bzw. Redundanzkessel wird ', o.vorgabeZsb ? `gemäß ${o.vorgabeZsb} ` : ['gemäß ', F('Vorgabe zum Zweistoffbrenner (Erlass/Schreiben)', ''), ' '], 'ein Zweistoffbrenner (Erdgas/Heizöl) berücksichtigt.')] },
  fernwaerme: { titel: 'Fernwärme', text: () => [absatz('In der näheren Umgebung der Liegenschaft existiert kein Fernwärmenetz, sodass ein Anschluss an eine externe Wärmeversorgung keine Option ist.')] },
  wind: { titel: 'Windkraft', text: () => [absatz('Die Nutzung von Windenergie wird für den betrachteten Standort nicht weiterverfolgt. Aufgrund der begrenzten verfügbaren Flächen und der geringen Abstände zu den Bestandsgebäuden sind die erforderlichen Abstands-, Immissionsschutz- und Sicherheitsanforderungen voraussichtlich nicht oder nur eingeschränkt erfüllbar.')] },
  bioFluessigGas: { titel: 'Flüssige und gasförmige Biomasse', text: () => [
    absatz('Flüssige Biomasse (z. B. Bio-Heizöl) oder gasförmige Biomasse (Biomethan) werden nicht als primäre Vor-Ort-Lösung in Betracht gezogen. Ihr Einsatz würde voraussichtlich nur bilanziell erfolgen, also über den Bezug aus dem öffentlichen Versorgungsnetz oder über entsprechende Zertifikate.'),
    absatz('Da diese Brennstoffe gegenüber Erdgas oder Heizöl keine technischen Änderungen an der Wärmeerzeugung erfordern, ergibt sich kein Mehrwert einer gesonderten technischen Betrachtung. Der Bezug von Biomethan oder Bio-Heizöl ist eine betriebswirtschaftliche Entscheidung, bei der geringere Emissionen über höhere Einkaufspreise erzielt werden.'),
  ] },
});

export function ptTextNicht(key, o = {}) {
  const e = PT_NICHT[key];
  return e ? [absatz(e.titel), ...e.text(o)] : [];
}

/** Berücksichtigte Potenziale: Einleitung zur Energieträger-Matrix. */
export function ptTextBeruecksichtigt(o = {}) {
  const ee = o.ee && o.ee.length ? liste(o.ee) : 'Biomasse, Umweltwärme (Erdreich, Wasser und Luft) über Wärmepumpen sowie Photovoltaik';
  return [absatz(`Als nutzbare Potenziale für die Deckung der Grundlast kommen ${ee} in Betracht. Erdgas und Heizöl werden für die Deckung der Spitzenlast bzw. zur Sicherstellung von Resilienz und Redundanz genutzt. `,
    'Im Folgenden werden die erneuerbaren Potenziale genauer betrachtet; die fossilen Energieträger fließen in den Variantenvergleich ein, werden in der Potenzialanalyse aber nicht vertieft.')];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Oberflächennahe Geothermie
 * ═══════════════════════════════════════════════════════════════════════ */
export const PT_GEO = Object.freeze({ vbh: 2100, flaecheProSondeFaktor: 1 });

export function ptTextGeoGrundlagen() {
  return [
    absatz('Oberflächennahe Geothermie nutzt die im Erdreich gespeicherte Wärme zur Beheizung von Gebäuden und zur Warmwasserbereitung. Eine Wärmepumpe entzieht dem Untergrund Wärme und hebt sie auf das für die Versorgung erforderliche Temperaturniveau an. Erschlossen wird das Erdreich über vertikale Erdwärmesonden in Tiefenbohrungen oder über horizontal verlegte Erdwärmekollektoren.'),
    absatz('Die technische und wirtschaftliche Eignung hängt wesentlich von den geologischen und hydrogeologischen Randbedingungen sowie vom erforderlichen Temperaturniveau des Versorgungssystems ab. Besonders effizient arbeitet eine geothermische Wärmepumpe bei niedrigen Vorlauftemperaturen; im Bestand können daher Anpassungen am Netz, an den Heizflächen oder an den Übergabesystemen erforderlich werden.'),
  ];
}

/** Vor- und Nachteile (Tabellenzeilen). */
export const PT_GEO_ASPEKTE = [
  ['Effizienz', 'Das Erdreich ist eine vergleichsweise konstante, kaum witterungsabhängige Wärmequelle; dadurch sind hohe Jahresarbeitszahlen möglich.'],
  ['CO₂-Emissionen', 'Bei effizientem Betrieb und hohem Anteil erneuerbaren Stroms lässt sich die Wärmeversorgung deutlich dekarbonisieren.'],
  ['Betriebskosten', 'Nach der Investition fallen im Wesentlichen Stromkosten sowie geringe Aufwendungen für Wartung und Instandhaltung an.'],
  ['Investitionskosten', 'Bohrungen, Erschließung und Fachplanung verursachen hohe Anfangskosten.'],
  ['Genehmigungen', 'Erdwärmesonden können wasser-, berg- und bohrrechtlichen Anforderungen unterliegen.'],
  ['Standortabhängigkeit', 'Ungünstige geologische oder hydrogeologische Bedingungen können die Entzugsleistung begrenzen oder eine Nutzung ausschließen.'],
  ['Flächenbedarf', 'Sondenfelder und Kollektoren benötigen ausreichend große, unbebaute und dauerhaft verfügbare Flächen.'],
  ['Systemanpassungen', 'Für einen effizienten Betrieb können niedrigere Vorlauftemperaturen und Anpassungen an Netz, Heizflächen und Übergabe erforderlich sein.'],
  ['Planungsaufwand', 'Für eine belastbare Auslegung sind Bohrdaten, geologische Voruntersuchungen oder ein Thermal Response Test erforderlich.'],
];

export function ptLambdaKlasse(l) {
  return l < 1.5 ? 'eher unterdurchschnittlichen bzw. schwachen' : l < 2.5 ? 'mittleren' : 'guten';
}

/**
 * Sondenfeld nach Leistung und nach Energie.
 * o: { qPerM, tiefe, abstand, jaz, wpKw (Heizleistung WP), waermeMwh (WP-Wärme/a), vbh }
 */
export function ptGeoSondenfeld(o) {
  const vbh = o.vbh || PT_GEO.vbh;
  const entzugKw = (o.qPerM * o.tiefe) / 1000;
  const elKw = o.jaz > 1 ? entzugKw / (o.jaz - 1) : NaN;
  const heizKw = entzugKw + elKw;
  const erdKw = o.wpKw * (o.jaz - 1) / o.jaz;
  const nLeistung = Math.ceil(erdKw / entzugKw);
  const flJe = o.abstand ** 2;
  const nEnergie = o.waermeMwh > 0 ? Math.ceil((o.waermeMwh * 1000 * (o.jaz - 1) / o.jaz) / (entzugKw * vbh)) : NaN;
  return { entzugKw, elKw, heizKw, erdKw, nLeistung, flJe, flLeistung: nLeistung * flJe, nEnergie, flEnergie: nEnergie * flJe, vbh };
}

/** o: { lambda, qPerM, tiefe, tiefe2, abstand, jaz, deckungPct, jdlKw, gesamtMwh, lambdaQuelle } */
export function ptTextGeoBerechnung(o = {}) {
  const out = [];
  if (!(o.qPerM > 0 && o.tiefe > 0 && o.abstand > 0 && o.jaz > 1)) {
    return [absatz('Die Bewertung des Erdwärmepotenzials setzt Angaben zu Wärmeleitfähigkeit, Bohrtiefe und Sondenabstand voraus ', F('Geothermie-Panel ausfüllen'), '.')];
  }
  out.push(absatz('Das Erdwärmepotenzial wird auf Basis ', o.lambdaQuelle ? `${o.lambdaQuelle}` : F('Quelle der Wärmeleitfähigkeit, z. B. geologisches Kartenportal des Landes', ''), ' bewertet. ',
    ok(o.lambda) ? `Demnach lässt sich die Wärmeleitfähigkeit am Standort mit ${nf(o.lambda, 1)} W/(m·K) einordnen; das entspricht einem ${ptLambdaKlasse(o.lambda)} Wert.` : ''));
  const d = o.deckungPct > 0 ? o.deckungPct : 65;
  const wpKw = o.jdlKw && o.jdlKw.length ? wtDeckungsleistung(o.jdlKw, d / 100) : NaN;
  const waermeMwh = o.gesamtMwh > 0 ? o.gesamtMwh * d / 100 : NaN;
  const f1 = ptGeoSondenfeld({ ...o, wpKw, waermeMwh });
  out.push(absatz(`Nach VDI 4640 entspricht die Wärmeleitfähigkeit einer spezifischen Entzugsleistung von etwa ${nf(o.qPerM, 1)} W/m. Bei einer Bohrtiefe von ${nf(o.tiefe)} m können je Erdsonde rund ${nf(f1.entzugKw, 2)} kW Umweltwärme gewonnen werden. `,
    `Unter Berücksichtigung einer Jahresarbeitszahl der Wärmepumpe von ${nf(o.jaz, 1)} ist zusätzlich eine elektrische Antriebsleistung von etwa ${nf(f1.elKw, 1)} kW erforderlich; daraus ergibt sich eine Heizleistung von rund ${nf(f1.heizKw, 2)} kW je Erdsonde.`));
  if (ok(wpKw)) {
    out.push(absatz(`Zur Erreichung einer energetischen Deckungsrate von ${pct(d)} ist eine Wärmepumpenleistung von etwa ${L(wpKw)} erforderlich, von der rund ${L(f1.erdKw)} aus dem Erdreich bereitzustellen sind. `,
      `Daraus ergibt sich rechnerisch ein Bedarf von etwa ${nf(f1.nLeistung)} Erdsonden mit einer Bohrtiefe von jeweils ${nf(o.tiefe)} m. `,
      `Um eine gegenseitige thermische Beeinflussung zu begrenzen, ist nach VDI 4640 ein Abstand von etwa 6 bis 10 m einzuhalten. Bei einem gewählten Abstand von ${nf(o.abstand)} m ist jeder Bohrung rechnerisch eine Fläche von ${nf(f1.flJe)} m² zuzuordnen; für ${nf(f1.nLeistung)} Bohrungen ergibt sich ein Flächenbedarf von rund ${nf(f1.flLeistung)} m².`));
    if (ok(f1.nEnergie)) {
      out.push(absatz(`Erfolgt die Auslegung nicht nur nach der Leistung, sondern nach der jährlich zu entziehenden Wärmemenge, ${f1.nEnergie > f1.nLeistung ? 'erhöht sich der Flächenbedarf deutlich' : 'bleibt die Leistung maßgebend'}: `,
        `Bei höchstens ${nf(f1.vbh)} Volllaststunden je Bohrung werden für eine Deckungsrate von ${pct(d)} etwa ${nf(f1.nEnergie)} Bohrungen und rund ${nf(f1.flEnergie)} m² benötigt.`));
    }
    if (o.tiefe2 > o.tiefe) {
      const f2 = ptGeoSondenfeld({ ...o, tiefe: o.tiefe2, wpKw, waermeMwh });
      out.push(absatz(`Durch eine Vergrößerung der Bohrtiefe auf ${nf(o.tiefe2)} m ließe sich die Anzahl der Erdsonden deutlich verringern: Zur Deckung der Leistung wären etwa ${nf(f2.nLeistung)} Bohrungen (rund ${nf(f2.flLeistung)} m²) erforderlich`,
        ok(f2.nEnergie) ? `, bei einer Auslegung nach der Wärmemenge etwa ${nf(f2.flEnergie)} m².` : '.'));
    }
    out.push(absatz('Ob auf dem Liegenschaftsareal ausreichend geeignete Flächen zur Verfügung stehen, ist anhand des Lageplans zu prüfen: ', F('Bewertung der Flächenverfügbarkeit (Lageplan mit Sondenfeld)', ''), '.'));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tiefengeothermie
 * ═══════════════════════════════════════════════════════════════════════ */
/** Volumenstrom Thermalwasser in l/s für eine Leistung und Spreizung (ρ·c ≈ 4,1 MJ/(m³·K) bei 60–110 °C). */
export function ptFoerdermenge(leistungKw, tVorC, tRueckC) {
  const dT = tVorC - tRueckC;
  return dT > 0 ? leistungKw / (4.1 * dT) : NaN;   // kW / (kJ/(l·K) × K) = l/s
}

export function ptTextTiefengeothermie(o = {}) {
  const faelle = o.faelle || [[65, 35], [110, 50]];
  const p = o.leistungKw;
  const out = [
    absatz('Für eine erste überschlägige Bewertung des hydrothermalen Potenzials werden die geologischen Vertikalschnitte des Standorts ', F('Quelle, z. B. GeoTIS', o.quelle), ' herangezogen. Im Mittelpunkt stehen tief liegende, wasserführende Gesteinshorizonte, aus denen Thermalwasser gefördert, energetisch genutzt und über eine Reinjektionsbohrung in den Untergrund zurückgeführt werden kann.'),
    absatz('Anhand der Schichtfolgen, Tiefenlagen und Isothermen lassen sich potenzielle Zielhorizonte nach ihrem Temperaturniveau einordnen. Ob ein Horizont tatsächlich nutzbar ist, hängt zusätzlich von seiner hydraulischen Ergiebigkeit ab, insbesondere von der nutzbaren Sandsteinmächtigkeit, der Porosität, der Permeabilität und der erreichbaren Förderrate.'),
    absatz(F('Zielhorizonte mit Tiefenlage und Temperaturniveau (Tabelle) und deren Einordnung', '')),
  ];
  if (p > 0) {
    out.push(absatz(`Für die angesetzte thermische Leistung von rund ${L(p)} ergeben sich in Abhängigkeit von der nutzbaren Temperaturspreizung folgende überschlägige Fördermengen: `,
      liste(faelle.map(([v, r]) => `bei einer Fördertemperatur von etwa ${nf(v)} °C und Abkühlung auf ${nf(r)} °C rund ${nf(ptFoerdermenge(p, v, r))} l/s`)), '. ',
      'Diese Werte sind keine Prognose der am Standort erreichbaren Förderrate, sondern hydraulische Zielgrößen. Ob sie dauerhaft erreicht werden, hängt von Transmissivität, Netto-Sandsteinmächtigkeit, Porosität, Permeabilität und zulässiger Druckabsenkung ab.'));
  }
  out.push(absatz('Während das thermische Potenzial anhand der Profile grundsätzlich eingeschätzt werden kann, bestehen hinsichtlich der hydraulischen Ergiebigkeit erhebliche Unsicherheiten. Aus Vertikalschnitten lassen sich weder die lokale Durchlässigkeit noch die dauerhaft erreichbaren Förder- und Reinjektionsraten bestimmen; zudem kann die Fördertemperatur über die Betriebszeit sinken. Eine belastbare Beurteilung ist erst nach vertiefenden Untersuchungen und letztlich einer Erkundungsbohrung mit Förder-, Injektions- und Druckaufbautests möglich.'));
  out.push(absatz('Für eine weiterführende Machbarkeitsbewertung sollten vorhandene Tiefbohrungen und Bohrlochmessungen ausgewertet, die petrophysikalischen Eigenschaften der Zielhorizonte untersucht und gegebenenfalls seismische Erkundungen durchgeführt werden. Eine hydrothermale Anlage wird üblicherweise als Dublette aus Förder- und Reinjektionsbohrung ausgeführt.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Luft-Wasser-Wärmepumpe und Schall
 * ═══════════════════════════════════════════════════════════════════════ */
export const PT_LWWP_VORNACH = {
  vorteile: ['Wärmequelle universell und standortunabhängig verfügbar (keine Quellenerkundung nötig)', 'Weitgehend autarke Erzeugung, nur Strombezug extern', 'Einfache Installation', 'Geringer Wartungsaufwand'],
  nachteile: ['Schallemissionen der Außeneinheiten', 'Flächenbedarf außen (Ventilatoren) und innen (Peripherie, Steuerung)', 'Geringere Arbeitszahl als Sole-Wasser- oder Wasser-Wasser-Systeme', 'Ggf. Anpassungen an Netz und Übergabe für Niedertemperaturbetrieb'],
};

/** o: { vl15, vlMinus5, wpKw, jaz, deckungPct, waermeMwh, stromMwh, platzM2, lastgangJahr } */
export function ptTextLwwp(o = {}) {
  const out = [
    absatz('Grundlage der Berechnung sind der Wärmelastgang der Liegenschaft', o.lastgangJahr ? ` (${o.lastgangJahr})` : '', ', die stundenscharfen Außentemperaturen am Standort, die außenluft- und vorlauftemperaturabhängigen Leistungs- und Effizienzkennwerte der Wärmepumpe sowie die angenommene Heizkurve. ',
      'Für jede Stunde wird aus der Außentemperatur die Vorlauftemperatur und daraus die Leistungszahl bestimmt; der elektrische Leistungsbedarf ergibt sich aus dem Wärmebedarf der Stunde geteilt durch die Leistungszahl.'),
    absatz('Aus energetischer Sicht ist ein Betrieb mit möglichst niedriger Vorlauftemperatur anzustreben. Die untere Grenze ergibt sich aus der Wärmeübertragung der Heizflächen bezogen auf den Leistungsbedarf und aus den Anforderungen der Trinkwarmwasserbereitung. Reicht die Wärmeabgabe bei der angestrebten Vorlauftemperatur nicht aus, sind eine Anhebung der Systemtemperatur oder bauliche Anpassungen erforderlich; eine höhere Systemtemperatur senkt jedoch die Jahresarbeitszahl.'),
  ];
  if (ok(o.vl15) && ok(o.vlMinus5)) {
    out.push(absatz(`Für die Heizkurve wird angenommen, dass die Liegenschaft bis zu einer Außentemperatur von 15 °C mit einer Vorlauftemperatur von ${nf(o.vl15)} °C versorgt werden kann; bis −5 °C steigt die Vorlauftemperatur linear auf ${nf(o.vlMinus5)} °C. `,
      'Die tatsächlich erreichbaren Systemtemperaturen können je nach Ertüchtigungs- und Sanierungsmaßnahmen niedriger oder höher ausfallen.'));
  }
  out.push(absatz('Für die einzelnen Gebäude liegt keine raumweise Heizlastberechnung vor; die Betriebsweise stützt sich daher auf eine Abschätzung der erforderlichen und realisierbaren Vorlauftemperaturen. Es ist nicht auszuschließen, dass in einzelnen Gebäuden Anpassungen, etwa der Austausch oder die Ergänzung von Heizkörpern, erforderlich werden. Für die Trinkwarmwasserbereitung fallen bei abgesenkter Netztemperatur zwingend Anpassungen an (elektrische Nachheizung, Booster-Wärmepumpen oder dezentrale Bereitung).'));
  if (o.wpKw > 0 && ok(o.jaz)) {
    out.push(absatz(`In der untersuchten Auslegung deckt eine Luft-Wasser-Wärmepumpe mit ${L(o.wpKw)} rund ${pct(o.deckungPct)} des Wärmebedarfs`,
      ok(o.waermeMwh) ? ` (${nf(o.waermeMwh)} MWh/a)` : '', `. Die Jahresarbeitszahl beträgt ${nf(o.jaz, 2)}; `,
      `${pct((1 - 1 / o.jaz) * o.deckungPct)} der Wärme stammen aus der Umgebungsluft und ${pct(o.deckungPct / o.jaz)} aus dem Strombezug, der Spitzenlasterzeuger übernimmt ${pct(100 - o.deckungPct)}.`,
      ok(o.stromMwh) ? ` Der Strombedarf der Wärmepumpe beträgt rund ${nf(o.stromMwh)} MWh/a.` : '',
      ok(o.platzM2) ? ` Für die Aufstellung der Verdampfereinheiten ist überschlägig eine Fläche von rund ${nf(o.platzM2)} m² vorzusehen.` : ''));
  }
  out.push(...ptTextLwwpSweep(o.sweep));
  return out;
}

/** Vergleich mehrerer Deckungsgrade (sweep = abLwwpSweep aus lib/gutachten-abbildungen.js). */
export function ptTextLwwpSweep(sweep) {
  const r = (sweep || []).filter(x => x.erreichbar);
  const out = [];
  const spitze = x => (x.restMaxKw < 1 ? 'ein Spitzenlasterzeuger ist rechnerisch nicht mehr erforderlich' : `der Spitzenlasterzeuger muss noch bis zu ${L(x.restMaxKw)} bereitstellen`);
  if (r.length) out.push(absatz(`Um die Auswirkung der Wärmepumpengröße zu zeigen, wurden ${r.length === 1 ? 'ein Deckungsgrad' : `${r.length} Deckungsgrade`} mit derselben Stundensimulation berechnet: `,
    r.map(x => `Für ${pct(x.ziel)} der Jahreswärme ist eine Nennleistung von rund ${L(x.nennKw)} (A2/W35) erforderlich; die Jahresarbeitszahl liegt dann bei ${nf(x.jaz, 2)}, der Strombedarf bei ${nf(x.stromMwh)} MWh/a, und ${spitze(x)}.`).join(' ')));
  if (r.length >= 2) {
    const a = r[0], b = r.at(-1);
    out.push(absatz(`Mit steigendem Deckungsgrad wächst die erforderliche Wärmepumpenleistung überproportional: Für ${nf(b.ziel - a.ziel)} Prozentpunkte mehr Deckung ist die ${nf(b.nennKw / a.nennKw, 1)}-fache Leistung nötig, weil die zusätzlichen Betriebsstunden in die kalten Tage mit geringer Leistungszahl fallen. `,
      b.jaz < a.jaz - 0.05 ? `Die Jahresarbeitszahl sinkt dabei von ${nf(a.jaz, 2)} auf ${nf(b.jaz, 2)}. ` : ''));
    // die letzten Prozentpunkte gesondert: wenig Energie, viel Leistung
    const [c, d] = r.slice(-2);
    if (r.length >= 3 && d.ziel - c.ziel <= 1.0001) {
      out.push(absatz(`Besonders deutlich zeigt sich das ${Math.abs(d.ziel - c.ziel - 1) < 1e-6 ? 'am letzten Prozentpunkt' : `an den letzten ${nf(d.ziel - c.ziel, 1)} Prozentpunkten`}: Für zusätzlich rund ${nf(d.waermeMwh - c.waermeMwh)} MWh/a sind weitere ${L(d.nennKw - c.nennKw)} Wärmepumpenleistung erforderlich `,
        `(${nf(d.nennKw / c.nennKw, 2)}-fache Leistung gegenüber ${pct(c.ziel)}).`));
    }
    out.push(absatz(b.restMaxKw < 1
      ? 'Erst bei vollständiger Deckung entfällt der Spitzenlasterzeuger rechnerisch; die Wärmepumpe muss dann auch in der kältesten Stunde bei höchster Vorlauftemperatur die volle Heizlast liefern. Für die Resilienz bleibt ein zweiter Wärmeerzeuger dennoch erforderlich.'
      : b.restMaxKw > 0.85 * a.restMaxKw
        ? 'Die vom Spitzenlasterzeuger bereitzustellende Leistung bleibt dabei nahezu unverändert, da an den kältesten Tagen die Leistung der Luft-Wasser-Wärmepumpe am geringsten ist.'
        : `Die vom Spitzenlasterzeuger bereitzustellende Leistung sinkt dabei nur von ${L(a.restMaxKw)} auf ${L(b.restMaxKw)}, da an den kältesten Tagen die Leistung der Luft-Wasser-Wärmepumpe am geringsten ist.`));
  }
  const nicht = (sweep || []).find(x => !x.erreichbar);
  if (nicht) out.push(absatz(`Ein Deckungsgrad von ${pct(nicht.ziel)} ist mit der Luft-Wasser-Wärmepumpe allein nicht erreichbar, da sie bei den angesetzten Vorlauftemperaturen in den kältesten Stunden unter der Mindestleistungszahl liegt und abgeschaltet wird${ok(nicht.maxPct) ? `; höchstens ${pct(nicht.maxPct, 1)} sind möglich` : ''}.`));
  return out;
}

/** Immissionsrichtwerte TA Lärm 6.1 außen in dB(A), Tag/Nacht. */
export const PT_TA_LAERM = Object.freeze([
  ['Industriegebiet', 70, 70], ['Gewerbegebiet', 65, 50], ['Kern-, Dorf-, Mischgebiet', 60, 45], ['Allgemeines Wohngebiet', 55, 40], ['Reines Wohngebiet', 50, 35],
]);

/** Freifeld-Abstand (Halbkugel, wie 02c-karte-werkzeuge.js): r = 10^((LWA − 11 − L)/20). */
export const ptSchallRadius = (lwa, ziel) => (lwa <= ziel ? 0 : 10 ** ((lwa - 11 - ziel) / 20));

export function ptTextSchall(o = {}) {
  const out = [absatz('In diesem Abschnitt erfolgt eine erste Beurteilung, ob der Betrieb der Luft-Wasser-Wärmepumpe zu schalltechnischen Konflikten führen kann. Bewertungsgrundlage sind die Immissionsrichtwerte der TA Lärm, insbesondere für allgemeine und reine Wohngebiete in der Nachtzeit. ',
    'Die Ausbreitungsberechnung ist bewusst konservativ: Schallmindernde Faktoren wie Einhausungen, Abschirmung durch Gebäude oder Vegetation bleiben unberücksichtigt.')];
  if (o.lwaDb > 0) {
    const r40 = ptSchallRadius(o.lwaDb, 40), r35 = ptSchallRadius(o.lwaDb, 35), r55 = ptSchallRadius(o.lwaDb, 55);
    out.push(absatz(`Für die ${o.wpKw > 0 ? `${L(o.wpKw)}-` : ''}Luft-Wasser-Wärmepumpe wird ein Schallleistungspegel von ${nf(o.lwaDb)} dB(A) angesetzt. `,
      `Im Freifeld wird der Nachtrichtwert eines allgemeinen Wohngebiets (40 dB(A)) in rund ${nf(r40)} m Abstand eingehalten, der eines reinen Wohngebiets (35 dB(A)) in rund ${nf(r35)} m; 55 dB(A) werden bereits nach rund ${nf(r55)} m unterschritten.`));
  }
  out.push(absatz('Diese überschlägige Berechnung dient der ersten Orientierung in der Vorplanung. Sie ersetzt kein Schallgutachten, das im Genehmigungsverfahren von einem Sachverständigen zu erstellen ist.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Biomasse
 * ═══════════════════════════════════════════════════════════════════════ */
export const PT_BIO = Object.freeze({
  pellets: { name: 'Pellets', heizwertKwhKg: 4.8, schuettdichte: 650, eta: 0.9, lkwT: 24 },
  hhs: { name: 'HHS', heizwertKwhKg: 3.5, schuettdichte: 250, eta: 0.85, lkwT: 22 },
  lagerTage: 10, lagerTiefeM: 5, lagerHoeheM: 5,
});

export const PT_BIO_QUALITATIV = [
  ['Energiedichte', 'hoch (~4,8 kWh/kg)', 'mittel (~3,5 kWh/kg)'],
  ['Restfeuchte', 'gering (< 10 %)', 'hoch (20–35 %)'],
  ['Homogenität', 'sehr gleichmäßig', 'uneinheitlich, grob'],
  ['Lagerbedarf je MWh', 'gering', 'hoch (Flächenlager, Rangierfläche)'],
  ['Fördertechnik', 'einfach (Saug-/Schneckenförderung)', 'aufwändig (Schubboden u. a.)'],
  ['Emissionen (Staub/Lärm)', 'gering', 'höher'],
  ['Anlagengröße', 'gut für kleine/mittlere Anlagen', 'vorteilhaft bei Großanlagen'],
  ['Vorlauftemperatur', 'hoch (> 90 °C)', 'hoch (> 90 °C)'],
  ['Brennstoffkosten', 'höher', 'günstiger'],
];

/** Kennwerte je Brennstoff. o: { waermeMwh, leistungKw, preisCtKwh: { pellets, hhs } } */
export function ptBioKennwerte(o) {
  const out = {};
  for (const k of ['pellets', 'hhs']) {
    const b = PT_BIO[k];
    const brennMwh = o.waermeMwh / b.eta;
    const tA = (brennMwh * 1000) / b.heizwertKwhKg / 1000;
    const kgH = o.leistungKw / b.eta / b.heizwertKwhKg;
    const m3A = (tA * 1000) / b.schuettdichte;
    const lagerM3 = (kgH * 24 * PT_BIO.lagerTage) / b.schuettdichte;
    const preis = o.preisCtKwh?.[k];
    out[k] = {
      kgH, tA, m3A, lagerM3, lagerBreiteM: lagerM3 / (PT_BIO.lagerTiefeM * PT_BIO.lagerHoeheM), lagerFlaecheM2: lagerM3 / PT_BIO.lagerHoeheM,
      kostenEur: ok(preis) ? brennMwh * preis * 10 : NaN, lkwJahr: tA / b.lkwT, lkwTagVolllast: (kgH * 24) / 1000 / b.lkwT,
    };
  }
  return out;
}

export function ptTextBiomasse(o = {}) {
  const out = [
    absatz('Ein potenzieller erneuerbarer Energieträger für die Wärmeversorgung ist Holz, insbesondere in Form von Holzpellets oder Holzhackschnitzeln. Beide erreichen die derzeit maximal gefahrene Vorlauftemperatur des Wärmenetzes zuverlässig, sodass keine Anpassungen am bestehenden Netz erforderlich sind – ein wesentlicher Vorteil gegenüber Wärmepumpen.'),
    absatz('Pellets verbrennen dank hoher Energiedichte und geringer Restfeuchte effizienter und emissionsärmer als Hackschnitzel. Das ermöglicht kompakte Kessel und Lager sowie eine einfache Anlieferung per Silowagen. Hackschnitzel sind günstiger und daher besonders für Großanlagen mit hohem Volllastanteil attraktiv; dem stehen ein hoher Platzbedarf, aufwändige Fördertechnik sowie höhere Staub- und Geräuschemissionen gegenüber.'),
  ];
  if (o.waermeMwh > 0 && o.leistungKw > 0) {
    const k = ptBioKennwerte(o);
    const p = k.pellets, h = k.hhs;
    out.push(absatz(`Für eine angenommene Deckung von ${pct(o.anteilPct ?? 100)} des Wärmebedarfs (${nf(o.waermeMwh)} MWh/a) bei ${L(o.leistungKw)} Kesselleistung ergeben sich `,
      `für Hackschnitzel rund ${nf(h.tA)} t bzw. ${nf(h.m3A)} m³ Brennstoff pro Jahr und für Pellets rund ${nf(p.tA)} t bzw. ${nf(p.m3A)} m³. `,
      `Für ${nf(PT_BIO.lagerTage)} Tage Volllast ist ein Lagervolumen von etwa ${nf(h.lagerM3)} m³ (HHS) bzw. ${nf(p.lagerM3)} m³ (Pellets) vorzuhalten; das Pelletlager benötigt damit nur rund ${pct((p.lagerM3 / h.lagerM3) * 100)} des Hackschnitzellagers. `,
      `Pro Jahr sind etwa ${nf(h.lkwJahr)} (HHS) bzw. ${nf(p.lkwJahr)} (Pellets) Lkw-Anlieferungen erforderlich.`,
      ok(p.kostenEur) && ok(h.kostenEur) ? ` Die Brennstoffkosten betragen rund ${nf(h.kostenEur)} €/a (HHS) gegenüber ${nf(p.kostenEur)} €/a (Pellets); Hackschnitzel bieten damit ein Einsparpotenzial von rund ${nf(p.kostenEur - h.kostenEur)} €/a (${pct(((p.kostenEur - h.kostenEur) / p.kostenEur) * 100)}) – zu Lasten von Fläche, Technik und Emissionen.` : ''));
  }
  out.push(absatz('Für eine nachhaltige Wärmeversorgung sind Herkunft und Qualität des Brennstoffs entscheidend. Holzpellets sollten aus nachweislich nachhaltiger Forstwirtschaft stammen und nach ENplus A1 (DIN EN ISO 17225-2) zertifiziert sein; das Siegel sichert Anforderungen an Herkunft, Aschegehalt, Heizwert und Feuchte.'));
  if (o.bestandPelletKw > 0 && o.jdlKw && o.jdlKw.length) {
    const s = o.jdlKw.reduce((x, v) => x + Math.min(v, o.bestandPelletKw), 0) / o.jdlKw.reduce((x, v) => x + v, 0) * 100;
    out.push(absatz(`Ein Vorteil ist die bereits vorhandene Infrastruktur: Der Pelletkessel in der Heizzentrale mit ${L(o.bestandPelletKw)} könnte als Grundlasterzeuger rechnerisch rund ${pct(s)} der Jahreswärme decken, das sind etwa ${pct((s / 65) * 100)} der nach GEG geforderten 65 % erneuerbaren Wärme.`));
  }
  return out;
}

// ── lib/gutachten-eisspeicher-text.js — Gutachtentext „Eisspeicher-Wärmepumpe“ (Kapitel Technologien) ──
// DOM-frei. Liefert Absätze (Zeichenketten und Platzhalter {feld, wert}) wie die übrigen Wärme-Textbausteine.
// Die Funktionsweise steht immer im Text; Auslegung und Ergebnisse nur, wenn eine Variante den Eisspeicher nutzt.
import { wtHilfen, F } from './gutachten-waerme-texte.js';
import { EIS, eisBewertung, eisGeometrie, eisInvest } from './eisspeicher.js';

const { ok, nf, pct, liste, absatz } = wtHilfen;

const FOLGE_TEXT = {
  lwwp: 'eine Luft-Wasser-Wärmepumpe, die bei ausgeschöpftem Eisspeicher und in der Übergangszeit einspringt',
  gaskessel: 'ein Gaskessel als Spitzenlast- und Resilienzeinheit, der auch bei einem Ausfall der Wärmepumpe die Versorgung sichert',
  heizoel: 'ein Heizölkessel als Spitzenlast- und Resilienzeinheit',
  pellets: 'ein Pelletkessel für Spitzenlast und Redundanz',
  hhs: 'ein Hackschnitzelkessel für Spitzenlast und Redundanz',
  bhkw: 'ein BHKW',
  stromkessel: 'ein Elektrokessel für Spitzenlast',
  fernwaerme: 'ein Fernwärmeanschluss',
  fg: 'eine Flusswasser-Wärmepumpe',
};

/**
 * @param {object} e  { aktiv, volumenM3, absorberM2, maxVereisungZulPct, wpKw, jaz, deckungPct, waermeMwh,
 *                      folgeErzeuger: ['lwwp', 'gaskessel', …], stat: Ergebnis der Stundensimulation oder null }
 */
export function wtEisspeicher(e = {}) {
  const abs = [];
  abs.push(absatz(
    'Ein Eisspeicher ist ein erdverlegter, in der Regel ungedämmter Wasserbehälter, der einer Sole-Wasser-Wärmepumpe ',
    'als Wärmequelle dient. Die Wärmepumpe entzieht dem Wasser zunächst fühlbare Wärme, bis es auf 0 °C abgekühlt ist. ',
    'Anschließend nutzt sie die beim Gefrieren frei werdende Kristallisationswärme: Ein Kubikmeter Wasser gibt dabei rund ',
    `${nf(EIS.latentKwhProM3)} kWh ab, ohne dass die Temperatur weiter sinkt. Diese latente Wärme macht den Großteil der nutzbaren Speicherenergie aus.`,
  ));
  abs.push(absatz(
    'Damit der Speicher nicht vollständig durchfriert, wird er laufend regeneriert. Unverglaste Solar-Luftabsorber nehmen ',
    'Wärme aus Sonnenstrahlung und Umgebungsluft auf; weil sie im kalten Solekreis arbeiten, liefern sie auch bei bedecktem ',
    'Himmel und Außentemperaturen knapp über dem Gefrierpunkt Energie. Zusätzlich strömt Wärme aus dem umgebenden Erdreich ',
    'in den Behälter. Im Sommer kann der Speicher bis etwa 25 °C aufgeladen und das Eis zur passiven Kühlung genutzt werden.',
  ));
  abs.push(absatz(
    'Gegenüber einer Luft-Wasser-Wärmepumpe bleibt die Quelltemperatur im Winter stabil um 0 °C statt der Außentemperatur zu folgen; ',
    'Kältespitzen schlagen deshalb nicht auf Leistung und Effizienz durch, und es entstehen keine Außengeräusche. Gegenüber ',
    'Erdwärmesonden entfallen Tiefbohrungen und deren Genehmigung. Dem stehen der Platzbedarf für Speicher und Absorberfläche ',
    `sowie höhere Investitionen gegenüber. Übliche Auslegungsregeln sind etwa ${nf(EIS.m3ProKw)} m³ Speichervolumen und `,
    `${nf(EIS.absorberM2ProKw, 1)} m² Absorberfläche je kW Heizleistung der Wärmepumpe.`,
  ));

  if (!e.aktiv) {
    abs.push(absatz('In den betrachteten Varianten ist kein Eisspeicher vorgesehen.'));
    return abs;
  }

  const v = Number(e.volumenM3) || 0, a = Number(e.absorberM2) || 0;
  const geo = eisGeometrie(v);
  abs.push(absatz(
    'In der untersuchten Variante dient ein Eisspeicher mit ', F('Speichervolumen', `${nf(v)} m³`),
    ` (Durchmesser rund ${nf(geo.durchmesserM, 1)} m bei gleicher Höhe) als Quelle der Wärmepumpe`,
    ok(e.wpKw) && e.wpKw > 0 ? [' mit ', F('WP-Heizleistung', `${nf(e.wpKw)} kW`)] : '',
    '. Regeneriert wird über ', F('Absorberfläche', `${nf(a)} m²`), ' Solar-Luftabsorber und das Erdreich. ',
    `Die latente Kapazität beträgt bei einem zulässigen Vereisungsgrad von ${pct(e.maxVereisungZulPct || EIS.maxVereisung * 100)} `,
    `rund ${nf(v * EIS.latentKwhProM3 * (e.maxVereisungZulPct || EIS.maxVereisung * 100) / 100 / 1000, 1)} MWh. `,
    ok(e.wpKw) && e.wpKw > 0 ? (() => {
      const vRegel = e.wpKw * EIS.m3ProKw, aRegel = e.wpKw * EIS.absorberM2ProKw;
      const teile = [];
      if (v < vRegel * 0.8) teile.push(`das Speichervolumen unter dem Richtwert von ${nf(vRegel)} m³`);
      if (a < aRegel * 0.8) teile.push(`die Absorberfläche unter dem Richtwert von ${nf(aRegel)} m²`);
      return teile.length ? `Gegenüber den Auslegungsregeln liegt ${liste(teile)}; die Stundensimulation zeigt, ob dies trägt. `
        : 'Speicher und Absorber entsprechen damit mindestens den üblichen Auslegungsregeln. ';
    })() : '',
    `Die Investition für Speicher und Absorber wird mit rund ${nf(eisInvest(v, a) / 1000)} T€ angesetzt (ohne Wärmepumpe).`,
  ));

  const s = e.stat;
  if (s) {
    const b = eisBewertung(s);
    abs.push(absatz(
      'Die stundenscharfe Jahressimulation ergibt einen Wärmeentzug aus dem Speicher von ', F('Entzug Eisspeicher', `${nf(s.entzugKwh / 1000, 1)} MWh/a`),
      `. Die Regeneration stammt zu ${pct(b.absorberAnteil * 100)} aus den Absorbern (${nf(s.absorberKwh / 1000, 1)} MWh/a) und zu `,
      `${pct(b.erdreichAnteil * 100)} aus dem Erdreich (${nf(s.erdreichKwh / 1000, 1)} MWh/a). `,
      s.maxVereisung > 0.005
        ? `Der Speicher ist an ${nf(s.eisStunden)} Stunden teilweise vereist; der höchste Vereisungsgrad liegt bei ${pct(s.maxVereisung * 100)}. `
        : 'Der Speicher vereist im Jahresverlauf nicht; die Regeneration hält ihn durchgehend über 0 °C. ',
      `Die Speichertemperatur bewegt sich zwischen ${nf(s.minTemp, 1)} °C und ${nf(s.maxTemp, 1)} °C.`,
    ));
    abs.push(absatz(
      s.gesperrtH > 200
        ? `An ${nf(s.gesperrtH)} Stunden begrenzt die Vereisungsgrenze die Wärmepumpe. Der Eisspeicher ist damit für den Bedarf unterdimensioniert; Speichervolumen oder Absorberfläche sollten vergrößert werden, sofern die nachfolgenden Erzeuger diese Zeiten nicht bewusst übernehmen sollen.`
        : s.gesperrtH > 0
          ? `An ${nf(s.gesperrtH)} Stunden erreicht der Speicher die Vereisungsgrenze; in dieser Zeit übernehmen die nachfolgenden Erzeuger. Die Auslegung ist knapp, aber tragfähig.`
          : 'Die Vereisungsgrenze wird nicht erreicht; die Wärmepumpe steht ganzjährig ohne Einschränkung durch die Quelle zur Verfügung.',
      ok(e.jaz) && e.jaz > 0 ? ` Die Jahresarbeitszahl der Wärmepumpe beträgt ${nf(e.jaz, 2)}.` : '',
      ok(e.deckungPct) && e.deckungPct > 0 ? ` Sie deckt ${pct(e.deckungPct)} des Wärmebedarfs${ok(e.waermeMwh) ? ` (${nf(e.waermeMwh)} MWh/a)` : ''}.` : '',
    ));
  } else {
    abs.push(absatz(F('Ergebnis Eisspeicher', ''), ' Die Ergebnisse der Stundensimulation liegen noch nicht vor (Einsatzplanung im Erzeugerbereich ausführen).'));
  }

  const folge = (e.folgeErzeuger || []).filter(k => FOLGE_TEXT[k]);
  abs.push(absatz(
    folge.length
      ? `In der Einsatzreihenfolge folgen ${liste(folge.map(k => FOLGE_TEXT[k]))}. `
      : 'Der Eisspeicher-Wärmepumpe ist kein weiterer Erzeuger nachgeordnet; Spitzen und Zeiten mit ausgeschöpfter Quelle deckt der automatisch ergänzte Spitzenlastkessel. ',
    'Die Kombination ermöglicht es, den Eisspeicher auf die Grundlast auszulegen und seltene Kälteperioden wirtschaftlich über den nachgeordneten Erzeuger abzudecken.',
  ));
  abs.push(absatz(
    'Annahmen der Simulation: Absorber unverglast im Solekreis (η₀ 0,85; Wärmeübergang 15 W/(m²·K)), Speicher ungedämmt erdverlegt ',
    '(U 0,9 W/(m²·K), Erdreich 10 ± 4 °C), Soletemperatur 4 K unter Speichertemperatur, Regeneration bis 25 °C, Einstrahlung aus einem ',
    'Monatsmodell. Für die Ausführungsplanung sind die Kennwerte des gewählten Herstellers maßgeblich.',
  ));
  return abs;
}

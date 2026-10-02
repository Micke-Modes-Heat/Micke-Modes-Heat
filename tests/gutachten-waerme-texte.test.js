// Vitest-Tests für lib/gutachten-waerme-texte.js — jede Fallunterscheidung der Wärme-Textbausteine.
import { describe, it, expect } from 'vitest';
import {
  F, wtKlartext, wtNormalisiere, wtEeBewertung, wtVollbenutzungKlasse, wtJazKlasse, wtLeistungsKlasse, wtNetzverlustKlasse, wtVorlaufKlasse,
  wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit,
} from '../src/lib/gutachten-waerme-texte.js';

const lastgang = { pMaxKw: 10000, nutzMwh: 26000, gesamtMwh: 29000, netzverlustPct: 10, netzverlustMwh: 2900, tMinC: -12 };
const wp = { key: 'lwwp', leistungKw: 5000, waermeMwh: 22000, elMwh: 6000 };
const gk = { key: 'gaskessel', leistungKw: 8000, waermeMwh: 7000 };
const bhkw = { key: 'bhkw', leistungKw: 700, waermeMwh: 4000, elMwh: 3000 };
const text = abs => wtKlartext(abs);

describe('Bewertungsschwellen', () => {
  it('ordnet den EE-Anteil den WPG-Stufen zu', () => {
    expect(wtEeBewertung(0).erfuellt).toEqual([]);
    expect(wtEeBewertung(29.9).erfuellt).toEqual([]);
    expect(wtEeBewertung(30).erfuellt).toEqual([2030]);
    expect(wtEeBewertung(79.9).naechstes.jahr).toBe(2040);
    expect(wtEeBewertung(80).erfuellt).toEqual([2030, 2040]);
    expect(wtEeBewertung(100).erfuellt).toEqual([2030, 2040, 2045]);
    expect(wtEeBewertung(NaN).erfuellt).toEqual([]);
  });

  it('klassifiziert Vollbenutzung, JAZ, Leistung, Netzverlust und Vorlauf an den Grenzen', () => {
    expect(wtVollbenutzungKlasse(1799)).toBe('spitzig');
    expect(wtVollbenutzungKlasse(1800)).toBe('typisch');
    expect(wtVollbenutzungKlasse(3000)).toBe('typisch');
    expect(wtVollbenutzungKlasse(3001)).toBe('gleichmaessig');
    expect(wtJazKlasse(4)).toBe('sehrGut'); expect(wtJazKlasse(3.5)).toBe('gut'); expect(wtJazKlasse(2.7)).toBe('maessig'); expect(wtJazKlasse(2.2)).toBe('niedrig');
    expect(wtLeistungsKlasse(0.9)).toBe('unterdeckung'); expect(wtLeistungsKlasse(0.97)).toBe('knapp'); expect(wtLeistungsKlasse(1.1)).toBe('ausreichend');
    expect(wtLeistungsKlasse(1.3)).toBe('komfortabel'); expect(wtLeistungsKlasse(2)).toBe('ueberdimensioniert');
    expect(wtNetzverlustKlasse(5)).toBe('niedrig'); expect(wtNetzverlustKlasse(15)).toBe('ueblich'); expect(wtNetzverlustKlasse(25)).toBe('erhoeht'); expect(wtNetzverlustKlasse(40)).toBe('hoch');
    expect(wtVorlaufKlasse(95)).toBe('hoch'); expect(wtVorlaufKlasse(75)).toBe('mittel'); expect(wtVorlaufKlasse(55)).toBe('nieder'); expect(wtVorlaufKlasse(40)).toBe('kalt');
  });
});

describe('Normalisierung', () => {
  it('berechnet Anteile, Grundlast und EE-Anteil, wenn keiner geliefert wird', () => {
    const n = wtNormalisiere({ lastgang, erzeuger: [wp, gk] });
    expect(n.erz).toHaveLength(2);
    expect(n.grund.key).toBe('lwwp');
    expect(n.eePct).toBeCloseTo(22000 / 29000 * 100, 5);
    expect(n.instKw).toBe(13000);
    expect(n.erz[0].name).toBe('Luft-Wasser-Wärmepumpe');
  });
  it('bevorzugt den gelieferten EE-Anteil und ignoriert leere Erzeuger', () => {
    const n = wtNormalisiere({ eeAnteilPct: 55, erzeuger: [wp, { key: 'heizoel', leistungKw: 0, waermeMwh: 0 }] });
    expect(n.eePct).toBe(55);
    expect(n.erz).toHaveLength(1);
  });
  it('trennt den Speicher von den Erzeugern', () => {
    const n = wtNormalisiere({ erzeuger: [wp, { key: '_thermSpeicher', leistungKw: 1, waermeMwh: 500, speicherM3: 300 }] });
    expect(n.erz).toHaveLength(1);
    expect(n.speicher.speicherM3).toBe(300);
  });
  it('verträgt einen leeren Schnappschuss', () => {
    expect(() => wtNormalisiere()).not.toThrow();
    expect(wtNormalisiere({}).erz).toEqual([]);
  });
});

describe('2.2.1 Dimensionierung WEA', () => {
  it('ohne Lastgang und ohne Erzeuger: nur Platzhalter, kein Zahlenmüll', () => {
    const t = text(wtDimensionierungWea({}));
    expect(t).toContain('[Spitzenlast in kW]');
    expect(t).toContain('[Erzeugerkonzept]');
    expect(t).not.toMatch(/NaN|undefined/);
  });

  it('nennt Bedarf, Spitzenlast, Vollbenutzungsstunden und Außentemperatur', () => {
    const t = text(wtDimensionierungWea({ lastgang, erzeuger: [wp] }));
    expect(t).toContain('29.000 MWh');
    expect(t).toContain('10.000 kW');
    expect(t).toContain('-12,0 °C');
    expect(t).toContain('2.900 h/a');
    expect(t).toContain('typisch');
  });

  it('wertet spitzenlastgeprägte und gleichmäßige Lastgänge unterschiedlich', () => {
    expect(text(wtDimensionierungWea({ lastgang: { ...lastgang, gesamtMwh: 10000 }, erzeuger: [wp] }))).toContain('bivalente Auslegung');
    expect(text(wtDimensionierungWea({ lastgang: { ...lastgang, gesamtMwh: 40000 }, erzeuger: [wp] }))).toContain('hohen Grundlastanteil');
  });

  it('unterscheidet monovalent, bivalent und multivalent', () => {
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp] }))).toContain('monovalent');
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp, gk] }))).toContain('bivalent');
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp, gk, bhkw] }))).toContain('multivalent');
  });

  it('verwendet passende Artikel und Singular/Plural bei den ergänzenden Erzeugern', () => {
    const zwei = text(wtDimensionierungWea({ lastgang, erzeuger: [wp, gk] }));
    expect(zwei).toContain('deckt die Luft-Wasser-Wärmepumpe');
    expect(zwei).toContain('Weiterer Erzeuger ist Gaskessel');
    expect(zwei).toContain('Der Gaskessel (8.000 kW)');
    const drei = text(wtDimensionierungWea({ lastgang, erzeuger: [wp, gk, bhkw] }));
    expect(drei).toContain('Weitere Erzeuger sind Gaskessel und BHKW');
    expect(drei).toContain('Das BHKW (700 kW');
  });

  it('weist auf Redundanz und fossile Spitzenlast hin', () => {
    const t = text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { ...gk, waermeMwh: 1500 }] }));
    expect(t).toContain('überwiegend der Spitzenlast und Redundanz');
  });

  it('meldet Unterdeckung der Spitzenlast', () => {
    const t = text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...wp, leistungKw: 6000 }] }));
    expect(t).toContain('Unterdeckung von 4.000 kW');
  });

  it('meldet knappe, ausreichende, komfortable und überdimensionierte Leistung', () => {
    const mit = kw => text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...wp, leistungKw: kw }] }));
    expect(mit(9700)).toContain('nur knapp unterschritten');
    expect(mit(11000)).toContain('Leistungsreserve beträgt 10,0 %');
    expect(mit(13000)).toContain('komfortablen Reserve');
    expect(mit(20000)).toContain('überdimensioniert');
  });

  it('prüft N-1: erfüllt, teilweise und verfehlt', () => {
    const n1 = (a, b) => text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...wp, leistungKw: a }, { ...gk, leistungKw: b }] }));
    expect(n1(10000, 10000)).toContain('N-1-Kriterium');
    expect(n1(10000, 10000)).toContain('erfüllt damit');
    expect(n1(7000, 8000)).toContain('nicht vollständig erfüllt');
    expect(n1(9000, 3000)).toContain('deutlich verfehlt');
  });

  it('monovalent: fehlende Redundanz', () => {
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp] }))).toContain('keine Redundanz');
  });

  it('bewertet den EE-Anteil in allen Stufen', () => {
    const mitEe = p => text(wtDimensionierungWea({ lastgang, eeAnteilPct: p, erzeuger: [wp, gk] }));
    expect(mitEe(100)).toContain('werden damit eingehalten');
    expect(mitEe(85)).toContain('für 2030 und 2040 erfüllt');
    expect(mitEe(85)).toContain('15,0 %');
    expect(mitEe(50)).toContain('um 30,0 Prozentpunkte verfehlt');
    expect(mitEe(10)).toContain('um 20,0 Prozentpunkte unterschritten');
    expect(mitEe(0)).toContain('vollständig aus nicht erneuerbaren');
  });

  it('nennt CO₂-Emissionen, wenn vorhanden', () => {
    expect(text(wtDimensionierungWea({ lastgang, co2T: 3200, erzeuger: [wp, gk] }))).toContain('3.200 t CO₂e');
  });

  it('bewertet die Wärmepumpe nach Jahresarbeitszahl', () => {
    const mit = el => text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...wp, elMwh: el }, gk] }));
    expect(mit(4400)).toContain('JAZ) beträgt 5,00');
    expect(mit(4400)).toContain('sehr gut');
    expect(mit(6000)).toContain('Dieser Wert ist gut');
    expect(mit(7500)).toContain('mäßig');
    expect(mit(10000)).toContain('niedrig');
  });

  it('verweist bei Wärmepumpen auf Schall, Strombedarf und Erdwärme', () => {
    const t = text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { key: 'geo', leistungKw: 1000, waermeMwh: 2000, elMwh: 500 }] }));
    expect(t).toContain('Kapitel 3.3.2');
    expect(t).toContain('TA Lärm');
    expect(t).toContain('wasserrechtlichen');
  });

  it('Wärmepumpe ohne Strombedarf: JAZ bleibt Platzhalter', () => {
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [{ key: 'lwwp', leistungKw: 5000, waermeMwh: 0 }] }))).toContain('[Jahresarbeitszahl]');
  });

  it('bewertet BHKW nach Vollbenutzungsstunden', () => {
    const mit = h => text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...bhkw, waermeMwh: bhkw.leistungKw * h / 1000 }, gk] }));
    expect(mit(2000)).toContain('Auslastung ist gering');
    expect(mit(4500)).toContain('wirtschaftlich üblichen Bereich');
    expect(mit(7000)).toContain('Auslastung ist hoch');
    expect(mit(4500)).toContain('3.000 MWh Strom');
  });

  it('bewertet Kessel nach ihrem Wärmeanteil und Reservekessel', () => {
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { ...gk, waermeMwh: 500 }] }))).toContain('Spitzenlast- und Redundanzerzeuger');
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { ...gk, waermeMwh: 9000 }] }))).toContain('nennenswerte Anteile');
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [{ ...wp, waermeMwh: 5000 }, { ...gk, waermeMwh: 24000 }] }))).toContain('Hauptwärmeerzeuger');
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { ...gk, waermeMwh: 0 }] }))).toContain('als Reserve vorgesehen');
  });

  it('behandelt Biomasse, Direktstrom, Solarthermie, Fernwärme und Speicher', () => {
    const t = text(wtDimensionierungWea({
      lastgang,
      erzeuger: [wp, { key: 'pellets', leistungKw: 2000, waermeMwh: 3000 }, { key: 'stromkessel', leistungKw: 1000, waermeMwh: 200 },
        { key: 'solarthermie', leistungKw: 500, waermeMwh: 400 }, { key: 'fernwaerme', leistungKw: 3000, waermeMwh: 1000 },
        { key: '_thermSpeicher', leistungKw: 1, waermeMwh: 300 }],
    }));
    expect(t).toContain('Brennstofflogistik');
    expect(t).toContain('nahezu 100 % Wirkungsgrad');
    expect(t).toContain('Flächenkonkurrenz');
    expect(t).toContain('[Primärenergiefaktor / EE-Anteil Fernwärme]');
    expect(t).toContain('[Speichervolumen in m³]');
  });

  it('Direktstrom mit hohem Anteil warnt vor Strompreisabhängigkeit', () => {
    const t = text(wtDimensionierungWea({ lastgang, erzeuger: [wp, { key: 'stromkessel', leistungKw: 4000, waermeMwh: 9000 }] }));
    expect(t).toContain('stark vom Strompreis abhängig');
  });

  it('endet mit Platzhalter für den Standort', () => {
    expect(text(wtDimensionierungWea({ lastgang, erzeuger: [wp] }))).toContain('[Standort der Heizzentrale]');
  });
});

describe('2.2.2 WVN', () => {
  const netz = { laengeM: 12000, anzahlAnschluesse: 150, vlC: 80, rlC: 50, bestand: false };
  it('Platzhalter ohne Daten', () => {
    const t = text(wtWvn({}));
    expect(t).toContain('[Trassenlänge in m]');
    expect(t).toContain('[Vorlauftemperatur in °C]');
    expect(t).not.toMatch(/NaN|undefined/);
  });
  it('unterscheidet Bestandsnetz und Neubaunetz', () => {
    expect(text(wtWvn({ netz: { ...netz, bestand: true } }))).toContain('Bestandsnetz');
    expect(text(wtWvn({ netz }))).toContain('Neubaunetz');
    expect(text(wtWvn({ netz: { laengeM: 100 } }))).toContain('verbindet die Heizzentrale');
  });
  it('berechnet Trasse je Anschluss und Wärmebelegung und wertet sie', () => {
    const t = text(wtWvn({ lastgang, netz }));
    expect(t).toContain('80 m Trasse je Anschluss');
    expect(t).toContain('2.167 kWh je Trassenmeter');
    expect(t).toContain('hoch und spricht');
    expect(text(wtWvn({ lastgang: { ...lastgang, nutzMwh: 2000 }, netz }))).toContain('Dieser Wert ist niedrig');
    expect(text(wtWvn({ lastgang: { ...lastgang, nutzMwh: 12000 }, netz }))).toContain('mittleren Bereich');
  });
  it('wertet Netzverluste in allen Klassen', () => {
    const mit = p => text(wtWvn({ lastgang: { ...lastgang, netzverlustPct: p, netzverlustMwh: 1000 }, netz }));
    expect(mit(5)).toContain('verlustarm');
    expect(mit(15)).toContain('übliches Niveau');
    expect(mit(25)).toContain('erhöhter Wert');
    expect(mit(40)).toContain('hoher Wert');
    expect(mit(15)).toContain('W/m');
  });
  it('wertet Temperaturniveau und Spreizung', () => {
    const mit = (vl, rl) => text(wtWvn({ netz: { ...netz, vlC: vl, rlC: rl } }));
    expect(mit(95, 55)).toContain('Temperaturniveau ist hoch');
    expect(mit(75, 50)).toContain('Temperaturniveau ist mittel');
    expect(mit(60, 35)).toContain('Niedertemperaturnetz');
    expect(mit(40, 25)).toContain('kalte Nahwärme');
    expect(mit(90, 55)).toContain('große Spreizung');
    expect(mit(80, 55)).toContain('üblichen Bereich');
    expect(mit(70, 55)).toContain('geringe Spreizung');
  });
  it('nennt die Hydraulik-Auslegungsregeln und wertet Überschreitungen', () => {
    expect(text(wtWvn({ netz }))).toContain('150 Pa/m');
    expect(text(wtWvn({ netz }))).toContain('250 Pa/m');
    expect(text(wtWvn({ netz: { ...netz, ueberschreitungen: 0 } }))).toContain('keine Überschreitung');
    expect(text(wtWvn({ netz: { ...netz, bestand: true, ueberschreitungen: 3 } }))).toContain('nicht verändert');
    expect(text(wtWvn({ netz: { ...netz, ueberschreitungen: 1 } }))).toContain('1 Strang');
    expect(text(wtWvn({ netz: { ...netz, hydraulik: { dpNetzPaM: 200 } } }))).toContain('200 Pa/m');
  });
});

describe('2.2.3 WH', () => {
  it('Platzhalter ohne Daten', () => {
    expect(text(wtHausstation({}))).toContain('[Anzahl Hausstationen]');
  });
  it('nennt Anzahl, Anschlussleistung und Mittelwert', () => {
    const t = text(wtHausstation({ gebaeude: { anzahl: 40, heizlastSummeKw: 8000 } }));
    expect(t).toContain('40 Hausstationen');
    expect(t).toContain('8.000 kW');
    expect(t).toContain('200 kW je Anschluss');
    expect(text(wtHausstation({ gebaeude: { anzahl: 1 } }))).toContain('1 Hausstation.');
  });
  it('wertet das Temperaturniveau und Trinkwassererwärmung', () => {
    expect(text(wtHausstation({ netz: { vlC: 90 } }))).toContain('für das heutige Temperaturniveau');
    expect(text(wtHausstation({ netz: { vlC: 75 } }))).toContain('Prüfung der Heizflächen');
    const nied = text(wtHausstation({ netz: { vlC: 55 } }));
    expect(nied).toContain('Legionellenschutz');
    expect(nied).toContain('[Konzept Trinkwassererwärmung]');
    expect(text(wtHausstation({ netz: { vlC: 75 } }))).not.toContain('Legionellen');
  });
  it('wertet die Rücklauftemperatur', () => {
    expect(text(wtHausstation({ netz: { rlC: 35 } }))).toContain('günstig');
    expect(text(wtHausstation({ netz: { rlC: 50 } }))).toContain('moderat');
    expect(text(wtHausstation({ netz: { rlC: 65 } }))).toContain('hoch');
  });
  it('nennt die Druckreserve von 0,5 bar', () => {
    expect(text(wtHausstation({}))).toContain('0,5 bar');
  });
});

describe('2.4 Variantenvergleich', () => {
  const A = { name: 'WP + Gaskessel', erzeuger: [{ key: 'lwwp', leistungKw: 5000 }, { key: 'gaskessel', leistungKw: 8000 }], investEur: 6e6, jahreskostenEur: 3.0e6, wgkCt: 11.0, co2T: 4000, eeAnteilPct: 75 };
  const B = { name: 'WP monovalent', investEur: 12e6, jahreskostenEur: 3.4e6, wgkCt: 12.5, co2T: 1200, eeAnteilPct: 100 };
  const C = { name: 'BHKW + WP', investEur: 8e6, jahreskostenEur: 2.8e6, wgkCt: 10.2, co2T: 6500, eeAnteilPct: 40 };

  it('ohne Varianten: Platzhalter', () => {
    expect(text(wtVariantenvergleich({}))).toContain('[Varianten der Wärmeversorgung]');
  });
  it('mit einer Variante: beschreibt sie und fragt weitere ab', () => {
    const t = text(wtVariantenvergleich({ varianten: [A] }));
    expect(t).toContain('Betrachtet wird die Variante „WP + Gaskessel“');
    expect(t).toContain('Luft-Wasser-Wärmepumpe 5.000 kW');
    expect(t).toContain('11,0 ct/kWh');
    expect(t).toContain('[Weitere Varianten');
    expect(t).toContain('Damit erfüllt sie die WPG-Stufe 2030');
  });
  it('mit zwei Varianten: Zielkonflikt mit Vermeidungskosten', () => {
    const t = text(wtVariantenvergleich({ varianten: [A, B] }));
    expect(t).toContain('Zielkonflikt');
    expect(t).toContain('Mehrkosten');
    expect(t).toContain('CO₂-Vermeidungskosten');
    expect(t).toContain('143 €/t'); // (3,4−3,0)·1e6 / (4000−1200)
    expect(t).toContain('WP + Gaskessel ist damit');
  });
  it('wirtschaftlich und ökologisch dieselbe Variante: kein Zielkonflikt', () => {
    const t = text(wtVariantenvergleich({ varianten: [{ ...A, wgkCt: 9, co2T: 900 }, B] }));
    expect(t).toContain('ein Zielkonflikt zwischen Kosten und Klimaschutz besteht nicht');
  });
  it('drei Varianten: Rangfolge und Investitionshinweis', () => {
    const t = text(wtVariantenvergleich({ varianten: [A, B, C] }));
    expect(t).toContain('Rangfolge nach Kosten lautet: BHKW + WP (10,2 ct/kWh), WP + Gaskessel (11,0 ct/kWh), WP monovalent (12,5 ct/kWh)');
    expect(t).toContain('Die geringste Investition erfordert WP + Gaskessel');
  });
  it('nahezu gleichwertige Varianten werden nicht künstlich gerankt', () => {
    const t = text(wtVariantenvergleich({ varianten: [{ ...A, wgkCt: 11, co2T: 4000 }, { ...B, wgkCt: 11.1, co2T: 4050 }] }));
    expect(t).toContain('wirtschaftlich gleichwertig');
    expect(t).toContain('ökologisch kaum');
  });
  it('fehlende Werte einer Variante werden benannt', () => {
    const t = text(wtVariantenvergleich({ varianten: [A, { name: 'Ohne Werte' }] }));
    expect(t).toContain('fehlen die Wirtschaftlichkeitswerte');
    expect(t).not.toMatch(/NaN|undefined/);
  });
  it('nennt Rahmenbedingungen der Berechnung', () => {
    const t = text(wtVariantenvergleich({ varianten: [A, B], wirtschaft: { co2PreisEurT: 120, strompreisCt: 35, gaspreisCt: 10 } }));
    expect(t).toContain('CO₂-Preis von 120 €/t');
    expect(t).toContain('Strompreis von 35,0 ct/kWh');
  });
  it('bewertet die WPG-Erfüllung je Variante', () => {
    const t = text(wtVariantenvergleich({ varianten: [A, B] }));
    expect(t).toContain('alle Stufen des WPG');
    expect(t).toContain('WP + Gaskessel (75,0 %): die WPG-Stufe 2030');
  });
});

describe('2.5 Wirtschaftlichkeit', () => {
  const w = { investEur: 9e6, jahreskostenEur: 3.1e6, wgkCt: 11.2, zinsPct: 3.5, co2PreisEurT: 120, strompreisCt: 35, gaspreisCt: 10 };
  it('ohne Daten: Platzhalter und keine Zahlen', () => {
    const t = text(wtWirtschaftlichkeit({}));
    expect(t).toContain('[Gesamtinvestition in €]');
    expect(t).toContain('[Kalkulationszinssatz in %]');
    expect(t).toContain('[Betrachtungszeitraum in Jahren]');
    expect(t).not.toMatch(/NaN|undefined/);
  });
  it('nennt Methodik, Zins, Preise, Investition und Kosten', () => {
    const t = text(wtWirtschaftlichkeit({ wirtschaft: w, erzeuger: [wp, gk] }));
    expect(t).toContain('VDI 2067');
    expect(t).toContain('3,5 %');
    expect(t).toContain('Strom 35,0 ct/kWh');
    expect(t).toContain('9.000 Tsd. €');
    expect(t).toContain('692 € je kW');
    expect(t).toContain('11,2 ct/kWh');
  });
  it('vergleicht mit dem Fernwärmepreis in beide Richtungen und bei Gleichstand', () => {
    expect(text(wtWirtschaftlichkeit({ wirtschaft: { ...w, fernwaermeCt: 15 } }))).toContain('unter dem angesetzten Fernwärmepreis');
    expect(text(wtWirtschaftlichkeit({ wirtschaft: { ...w, fernwaermeCt: 8 } }))).toContain('über dem angesetzten Fernwärmepreis');
    expect(text(wtWirtschaftlichkeit({ wirtschaft: { ...w, fernwaermeCt: 11.3 } }))).toContain('auf dem Niveau');
  });
  it('nennt Kostentreiber passend zur Technik', () => {
    expect(text(wtWirtschaftlichkeit({ wirtschaft: w, erzeuger: [wp] }))).toContain('von dem Strompreis ab');
    expect(text(wtWirtschaftlichkeit({ wirtschaft: w, erzeuger: [gk] }))).toContain('von dem Gaspreis und dem CO₂-Preis ab');
    expect(text(wtWirtschaftlichkeit({ wirtschaft: w, erzeuger: [{ key: 'heizoel', leistungKw: 100, waermeMwh: 10 }] }))).toContain('Heizölpreis');
    expect(text(wtWirtschaftlichkeit({ wirtschaft: w, erzeuger: [{ key: 'hhs', leistungKw: 100, waermeMwh: 10 }] }))).toContain('Brennstoffpreis für Biomasse');
  });
  it('Variantenspanne und Fördermittel-Platzhalter', () => {
    const t = text(wtWirtschaftlichkeit({ wirtschaft: w, varianten: [{ name: 'A', wgkCt: 10, investEur: 5e6 }, { name: 'B', wgkCt: 12, investEur: 9e6 }] }));
    expect(t).toContain('zwischen 10,0 und 12,0 ct/kWh');
    expect(t).toContain('5.000 und 9.000 Tsd. €');
    expect(t).toContain('[Förderprogramm, z. B. BEW]');
  });
});

describe('2.7 Empfehlung und 6.1 Fazit', () => {
  const A = { name: 'A', wgkCt: 10, co2T: 1000, eeAnteilPct: 100 };
  const B = { name: 'B', wgkCt: 12, co2T: 3000, eeAnteilPct: 60 };
  it('Empfehlung ohne Varianten: Platzhalter', () => {
    expect(text(wtEmpfehlung({}))).toContain('[Empfohlene Variante]');
  });
  it('Empfehlung eindeutig, wenn eine Variante in allem vorn liegt', () => {
    const t = text(wtEmpfehlung({ varianten: [A, B] }));
    expect(t).toContain('wird diese Variante zur Umsetzung empfohlen');
    expect(t).not.toContain('[Empfohlene Variante]');
  });
  it('Empfehlung bleibt dem Gutachter überlassen, wenn Ziele auseinanderlaufen', () => {
    const t = text(wtEmpfehlung({ varianten: [{ ...A, wgkCt: 12 }, { ...B, wgkCt: 9 }] }));
    expect(t).toContain('[Empfohlene Variante]');
    expect(t).toContain('wirtschaftlich am günstigsten ist B');
    expect(t).toContain('geringsten Emissionen hat A');
  });
  it('Einzelvariante: Empfehlung mit oder ohne erfüllte WPG-Stufe', () => {
    expect(text(wtEmpfehlung({ varianten: [A] }))).toContain('alle Stufen des WPG');
    expect(text(wtEmpfehlung({ varianten: [{ name: 'X', eeAnteilPct: 10 }] }))).toContain('30 % wird derzeit nicht erreicht');
  });
  it('Folgeschritte hängen von der Technik ab', () => {
    const luft = text(wtEmpfehlung({ varianten: [A], erzeuger: [wp, gk], netz: { vlC: 85 } }));
    expect(luft).toContain('Netzanschlussantrag');
    expect(luft).toContain('schalltechnisches Gutachten');
    expect(luft).toContain('Absenkung der Netztemperaturen');
    expect(luft).toContain('fossilen Erzeuger');
    const erde = text(wtEmpfehlung({ varianten: [A], erzeuger: [{ key: 'geo', leistungKw: 1000, waermeMwh: 3000 }] }));
    expect(erde).toContain('wasserrechtlichen');
    expect(erde).not.toContain('schalltechnisches');
    expect(erde).toContain('[Förderprogramm, z. B. BEW]');
  });
  it('Fazit fasst Konzept und Ergebnisse zusammen', () => {
    const t = text(wtFazit({ lastgang, erzeuger: [wp, gk], eeAnteilPct: 80, co2T: 1500, wirtschaft: { wgkCt: 11.2, investEur: 9e6 } }));
    expect(t).toContain('29.000 MWh');
    expect(t).toContain('bivalent');
    expect(t).toContain('80,0 %');
    expect(t).toContain('11,2 ct/kWh');
    expect(t).toContain('Handlungsbedarf');
    expect(t).toContain('20,0 %');
  });
  it('Fazit meldet Handlungsbedarf bei Unterdeckung und hohen Netzverlusten', () => {
    const t = text(wtFazit({ lastgang: { ...lastgang, netzverlustPct: 35 }, erzeuger: [{ ...wp, leistungKw: 5000 }], eeAnteilPct: 100 }));
    expect(t).toContain('Netzverluste von 35,0 %');
    expect(t).toContain('deckt die Spitzenlast nicht');
  });
  it('Fazit ohne Erzeuger bleibt Platzhalter', () => {
    expect(text(wtFazit({}))).toContain('[Zusammenfassung des Wärmekonzepts]');
  });
});

describe('Alle Bausteine: keine ungültigen Zahlen', () => {
  const szenarien = [
    {}, { lastgang }, { erzeuger: [wp] }, { lastgang, erzeuger: [wp, gk, bhkw] },
    { lastgang: { pMaxKw: 0, gesamtMwh: 0 }, erzeuger: [{ key: 'lwwp', leistungKw: 0, waermeMwh: 0 }] },
    { lastgang: { pMaxKw: NaN, nutzMwh: null }, erzeuger: [{ key: 'unbekannt', leistungKw: 100, waermeMwh: 50 }] },
    { varianten: [{ name: 'X' }, { name: 'Y' }], wirtschaft: {} },
  ];
  for (const [i, s] of szenarien.entries()) {
    it(`Szenario ${i}`, () => {
      for (const fn of [wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit]) {
        const t = text(fn(s));
        expect(t, fn.name).not.toMatch(/NaN|undefined|Infinity|\[object/);
        expect(t.length, fn.name).toBeGreaterThan(20);
      }
    });
  }
  it('Platzhalter tragen immer einen Feldnamen', () => {
    for (const fn of [wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit]) {
      for (const abs of fn({})) for (const s of abs) if (typeof s !== 'string') expect(s.feld.length).toBeGreaterThan(2);
    }
    expect(F('x', 5).wert).toBe('5');
    expect(F('x').wert).toBe('');
  });
});

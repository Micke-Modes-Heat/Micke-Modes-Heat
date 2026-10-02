// Vitest-Tests für lib/gutachten-waerme-texte.js — jede Fallunterscheidung der Wärme-Textbausteine.
import { describe, it, expect } from 'vitest';
import {
  F, wtKlartext, wtNormalisiere, wtEeBewertung, wtVollbenutzungKlasse, wtJazKlasse, wtLeistungsKlasse, wtNetzverlustKlasse, wtVorlaufKlasse,
  wtProjektTyp, wtDeckungsleistung,
  wtIstZustand, wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit,
} from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);
const lastgang = { pMaxKw: 10000, nutzMwh: 26000, gesamtMwh: 29000, netzverlustPct: 10, netzverlustMwh: 2900, tMinC: -12 };
const wp = { key: 'lwwp', leistungKw: 5000, waermeMwh: 22000, elMwh: 6000 };
const gk = { key: 'gaskessel', leistungKw: 8000, waermeMwh: 7000 };
const bhkw = { key: 'bhkw', leistungKw: 700, waermeMwh: 4000, elMwh: 3000 };
const bestandProjekt = { basisJahr: 2026, lastgangJahr: 2026, anzahl: { gesamt: 40, bestand: 40, neubau: 0 } };
const neubauProjekt = { basisJahr: 2026, lastgangJahr: 2035, anzahl: { gesamt: 12, bestand: 0, neubau: 12 }, ereignisse: [{ jahr: 2028, art: 'neubau', anzahl: 12, deltaMwh: 4300 }], bedarfsverlauf: [{ jahr: 2026, bedarfMwh: 0, heizlastKw: 0 }, { jahr: 2035, bedarfMwh: 4300, heizlastKw: 2100 }] };
const gemischtProjekt = {
  basisJahr: 2026, lastgangJahr: 2040, anzahl: { gesamt: 50, bestand: 40, neubau: 10 },
  ereignisse: [{ jahr: 2030, art: 'neubau', anzahl: 6, deltaMwh: 3000 }, { jahr: 2032, art: 'neubau', anzahl: 4, deltaMwh: 2000 }, { jahr: 2035, art: 'abriss', anzahl: 2, deltaMwh: -800 }, { jahr: 2033, art: 'sanierung', anzahl: 10, deltaMwh: -1500 }],
  bedarfsverlauf: [{ jahr: 2026, bedarfMwh: 20000, heizlastKw: 8000 }, { jahr: 2040, bedarfMwh: 22700, heizlastKw: 9100 }],
};
const V = (name, erzeuger, w = {}) => ({ name, erzeuger, ...w });

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

  it('unterscheidet Bestand, Neubau und gemischt', () => {
    expect(wtProjektTyp(bestandProjekt)).toBe('bestand');
    expect(wtProjektTyp(neubauProjekt)).toBe('neubau');
    expect(wtProjektTyp(gemischtProjekt)).toBe('gemischt');
    expect(wtProjektTyp({ anzahl: { gesamt: 0 } })).toBeNull();
    expect(wtProjektTyp(undefined)).toBeNull();
  });

  it('berechnet die Deckungsleistung aus der Dauerlinie', () => {
    const konstant = new Array(100).fill(100);
    expect(wtDeckungsleistung(konstant, 0.5)).toBeCloseTo(50, 1);
    expect(wtDeckungsleistung(konstant, 1)).toBe(100);
    // 99 Stunden mit 10 kW und eine mit 1000 kW: Gesamt 1990; 40 % = 796 kWh; unterhalb von 10 kW gilt 100·P = 796
    const spitze = [...new Array(99).fill(10), 1000];
    expect(wtDeckungsleistung(spitze, 0.4)).toBeCloseTo(7.96, 1);
    expect(wtDeckungsleistung(spitze, 0.5)).toBeCloseTo(9.95, 1);
    expect(wtDeckungsleistung(spitze, 0.6)).toBeCloseTo(204, 0);   // 99·10 + P = 1194
    expect(wtDeckungsleistung([], 0.5)).toBeNaN();
    expect(wtDeckungsleistung([0, 0], 0.5)).toBeNaN();
  });
});

describe('Normalisierung', () => {
  it('berechnet Anteile, Grundlast und Gesamtleistung je Variante', () => {
    const n = wtNormalisiere({ lastgang, varianten: [V('A', [wp, gk])] });
    const v = n.varianten[0];
    expect(v.erz).toHaveLength(2);
    expect(v.grund.key).toBe('lwwp');
    expect(v.instKw).toBe(13000);
    expect(v.erz[0].name).toBe('Luft-Wasser-Wärmepumpe');
    expect(v.erz[0].anteil).toBeCloseTo(22000 / 29000 * 100, 5);
  });
  it('ignoriert leere Erzeuger und trennt den Speicher', () => {
    const v = wtNormalisiere({ varianten: [V('A', [wp, { key: 'heizoel', leistungKw: 0, waermeMwh: 0 }, { key: '_thermSpeicher', leistungKw: 1, waermeMwh: 500, speicherM3: 300 }])] }).varianten[0];
    expect(v.erz).toHaveLength(1);
    expect(v.speicher.speicherM3).toBe(300);
  });
  it('verträgt einen leeren Schnappschuss', () => {
    expect(() => wtNormalisiere()).not.toThrow();
    expect(wtNormalisiere({}).varianten).toEqual([]);
    expect(wtNormalisiere({}).typ).toBeNull();
  });
});

describe('2.1 Ist-Zustand', () => {
  it('Neubau: kein Ist-Zustand, Kapitel entfällt', () => {
    const t = text(wtIstZustand({ projekt: neubauProjekt }));
    expect(t).toContain('kein Gebäudebestand');
    expect(t).toContain('entfällt');
    expect(t).not.toContain('Spitzenlast');
  });
  it('Bestand: Bedarf, Netzverlust-Herkunft und Platzhalter für die bestehende Erzeugung', () => {
    const t = text(wtIstZustand({ projekt: bestandProjekt, lastgang, herkunft: { lastgang: 'import', netzverlustQuelle: 'prozentwert', netzverlustPct: 10 } }));
    expect(t).toContain('40 Bestandsgebäuden');
    expect(t).toContain('29.000 MWh');
    expect(t).toContain('pauschal mit 10,0 %');
    expect(t).toContain('[Bestehende Wärmeerzeuger');
  });
  it('gemischt: Ist-Zustand nur für den Bestand', () => {
    const t = text(wtIstZustand({ projekt: gemischtProjekt, lastgang }));
    expect(t).toContain('40 Bestandsgebäuden und 10 geplanten Neubauten');
    expect(t).toContain('Ist-Zustand umfasst den Bestand');
  });
  it('ohne Gebäudeliste: Platzhalter statt Behauptung', () => {
    expect(text(wtIstZustand({ lastgang }))).toContain('[bauliche Veränderungen]');
  });
});

describe('Datenherkunft des Lastgangs', () => {
  const herk = (art, extra = {}) => text(wtDimensionierungWea({ lastgang, projekt: bestandProjekt, herkunft: { lastgang: art, stadt: 'Kassel', klimajahr: 'TMY', normAtC: -12, ...extra } }));
  it('hochgeladene Messreihe', () => {
    const t = herk('import', { zeitreihe: { intervallMin: 60, quelle: 'wmz.csv', qualitaet: 'measured' } });
    expect(t).toContain('hochgeladenen Messreihe aus 60-Minuten-Werten');
    expect(t).toContain('wmz.csv');
    expect(t).toContain('[Klimabereinigung erfolgt / nicht erfolgt]');
    expect(t).toContain('belastbar');
    expect(t).not.toContain('Modellrechnung');
  });
  it('als synthetisch gekennzeichnete Reihe wird benannt', () => {
    expect(herk('import', { zeitreihe: { qualitaet: 'synthetic' } })).toContain('als synthetisch gekennzeichnet');
  });
  it('hochgeladene Reihe auf Monatsverbräuche skaliert', () => {
    expect(herk('importMonate')).toContain('monatsweise auf die vorgegebenen Monatsverbräuche skaliert');
  });
  it('synthetisch aus Monatswerten, mit und ohne Jahresverbrauch', () => {
    const t = herk('monateGesamt', { gesamtMwh: 25000 });
    expect(t).toContain('synthetisch aus den vorgegebenen Monatsverbräuchen');
    expect(t).toContain('25.000 MWh');
    expect(t).toContain('wurde die Klimadaten des Standorts Kassel (typisches Wetterjahr (TMY)) mit einer Norm-Außentemperatur von -12,0 °C zugrunde gelegt');
    expect(t).toContain('Norm-Außentemperatur von -12,0 °C');
    expect(t).toContain('gemessenen Lastgang (z. B. 15-Minuten-Werte');
    expect(herk('monate')).not.toContain('vorgegebener Jahresverbrauch');
  });
  it('rein synthetisch aus dem Jahresverbrauch mit Profilen', () => {
    const t = herk('gesamt', { gesamtMwh: 20000, profil1: 'HEF33', profil2: 'GKO33' });
    expect(t).toContain('rein synthetisch aus einem vorgegebenen Jahresverbrauch von 20.000 MWh');
    expect(t).toContain('HEF33 und GKO33');
    expect(t).toContain('ergeben sich aus den Klimadaten des Standorts Kassel');
    expect(t).not.toContain('aus die ');
    expect(t).toContain('reine Modellrechnung');
  });
  it('rein synthetisch aus den Gebäudedaten', () => {
    const t = herk('gebaeude');
    expect(t).toContain('aus den Gebäudedaten');
    expect(t).toContain('Verbrauchsdaten für die Liegenschaft insgesamt lagen nicht vor');
  });
  it('Wetterjahr statt TMY und Postleitzahl', () => {
    const t = herk('gebaeude', { klimajahr: '2022', plz: '34117' });
    expect(t).toContain('Wetterjahr 2022');
    expect(t).toContain('Postleitzahl 34117');
  });
  it('unbekannte Herkunft bleibt Platzhalter', () => {
    expect(text(wtDimensionierungWea({ lastgang, projekt: bestandProjekt }))).toContain('[Datenherkunft des Wärmelastgangs');
  });
  it('gesetzte und geschätzte Gebäudewerte werden gezählt', () => {
    const g = (gesetzt, geschaetzt) => herk('gebaeude', { gebaeude: { gesamt: gesetzt + geschaetzt, gesetzt, geschaetzt } });
    expect(g(0, 40)).toContain('aller 40 Gebäude sind Schätzwerte');
    expect(g(40, 0)).toContain('aller 40 Gebäude sind vorgegebene Werte');
    expect(g(10, 30)).toContain('Von 40 Gebäuden beruhen 10 auf vorgegebenen Werten');
    expect(g(10, 30)).toContain('30 auf Schätzwerten');
  });
  it('Netzverluste: Herkunft aus der Netzberechnung oder pauschal', () => {
    const netz = { laengeM: 1000, vlC: 80, rlC: 50 };
    expect(text(wtWvn({ lastgang, netz, herkunft: { netzverlustQuelle: 'waermenetz' } }))).toContain('leitungsgenauen Berechnung des Wärmenetzes');
    expect(text(wtWvn({ lastgang, netz, herkunft: { netzverlustQuelle: 'waermenetz' } })).match(/2\.900 MWh/g)).toHaveLength(1);
    expect(text(wtWvn({ lastgang, netz, herkunft: { netzverlustQuelle: 'prozentwert', netzverlustPct: 10 } }))).toContain('pauschal mit 10,0 %');
  });
});

describe('2.2.1 Soll-Bedarf und Auslegungsleistung — ohne Versorgungssystem', () => {
  const systemWoerter = /Wärmepumpe|Gaskessel|BHKW|Kessel|Pellet|Biomasse|Solarthermie|monovalent|bivalent|N-1|Jahresarbeitszahl|Redundanz/;
  const stand = (extra = {}) => ({ lastgang, projekt: bestandProjekt, herkunft: { lastgang: 'gebaeude' }, ...extra });

  it('nennt kein Versorgungssystem, auch wenn Varianten und Erzeuger im Projekt stehen', () => {
    const t = text(wtDimensionierungWea(stand({ varianten: [V('A', [wp, gk, bhkw])], projekt: gemischtProjekt })));
    expect(t).not.toMatch(systemWoerter);
    expect(t).toContain('Wahl des Versorgungssystems erfolgt erst im Variantenvergleich');
  });

  it('ohne Daten: Platzhalter, kein Zahlenmüll', () => {
    const t = text(wtDimensionierungWea({}));
    expect(t).toContain('[Spitzenlast in kW]');
    expect(t).toContain('[Reserve in %]');
    expect(t).not.toMatch(/NaN|undefined/);
  });

  it('nennt Jahr, Bedarf, Spitzenlast, Vollbenutzungsstunden und Außentemperatur', () => {
    const t = text(wtDimensionierungWea(stand()));
    expect(t).toContain('für das Jahr 2026 berechnet');
    expect(t).toContain('29.000 MWh');
    expect(t).toContain('10.000 kW');
    expect(t).toContain('-12,0 °C');
    expect(t).toContain('2.900 h/a');
    expect(t).toContain('typisch');
  });

  it('wertet spitzenlastgeprägte und gleichmäßige Lastgänge', () => {
    expect(text(wtDimensionierungWea(stand({ lastgang: { ...lastgang, gesamtMwh: 10000 } })))).toContain('stark von der Spitzenlast geprägt');
    expect(text(wtDimensionierungWea(stand({ lastgang: { ...lastgang, gesamtMwh: 40000 } })))).toContain('hohen Grundlastanteil');
  });

  it('beschreibt Neubau, gemischten Bestand und Bestand ohne Änderungen', () => {
    const neu = text(wtDimensionierungWea(stand({ projekt: neubauProjekt })));
    expect(neu).toContain('ausschließlich aus geplanten Neubauten (12 Gebäuden)');
    expect(neu).toContain('Neubau: 12 Gebäude im Jahr 2028 (+4.300 MWh/a)');
    expect(neu).toContain('beträgt nach Fertigstellung aller Neubauten 4.300 MWh/a (2035)');
    const mix = text(wtDimensionierungWea(stand({ projekt: gemischtProjekt })));
    expect(mix).toContain('40 Bestandsgebäuden und 10 geplanten Neubauten');
    expect(mix).toContain('Neubau: 10 Gebäude zwischen 2030 und 2032 (+5.000 MWh/a)');
    expect(mix).toContain('Abriss: 2 Gebäude im Jahr 2035 (−800 MWh/a)');
    expect(mix).toContain('energetische Sanierung: 10 Gebäude im Jahr 2033 (−1.500 MWh/a)');
    expect(mix).toContain('steigt von 20.000 MWh/a im Jahr 2026 auf 22.700 MWh/a im Jahr 2040 (+13,5 %)');
    expect(mix).toContain('Summe der Gebäudeheizlasten steigt dabei von 8.000 kW auf 9.100 kW');
    const best = text(wtDimensionierungWea(stand()));
    expect(best).toContain('nicht vorgesehen; der Soll-Bedarf entspricht dem Ist-Bedarf');
  });

  it('sinkender und nahezu gleicher Bedarf', () => {
    const verlauf = (a, b) => text(wtDimensionierungWea(stand({ projekt: { ...gemischtProjekt, bedarfsverlauf: [{ jahr: 2026, bedarfMwh: a }, { jahr: 2040, bedarfMwh: b }] } })));
    expect(verlauf(20000, 15000)).toContain('sinkt von 20.000 MWh/a');
    expect(verlauf(20000, 15000)).toContain('−25,0 %');
    expect(verlauf(20000, 20100)).toContain('nahezu unverändert');
  });

  it('nennt Deckungsleistungen und Sommerabschaltung aus der Dauerlinie', () => {
    const jdl = [...new Array(5000).fill(5000), ...new Array(3760).fill(0)];
    const t = text(wtDimensionierungWea(stand({ lastgang: { ...lastgang, pMaxKw: 5000, gesamtMwh: 25000, jdlKw: jdl } })));
    expect(t).toContain('Aus der Jahresdauerlinie folgt');
    expect(t).toContain('für 30 %');
    expect(t).toContain('für 90 %');
    expect(t).toContain('3.760 Stunden des Jahres (43 %)');
    expect(t).toContain('Sommerabschaltung');
    const ohne = text(wtDimensionierungWea(stand({ lastgang: { ...lastgang, jdlKw: new Array(8760).fill(5000) } })));
    expect(ohne).not.toContain('Sommerabschaltung');
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
  it('unterscheidet Bestandsnetz, Neubaunetz und Neubau ohne Bestand', () => {
    expect(text(wtWvn({ projekt: bestandProjekt, netz: { ...netz, bestand: true } }))).toContain('Bestandsnetz');
    expect(text(wtWvn({ projekt: gemischtProjekt, netz }))).toContain('Neubaunetz');
    expect(text(wtWvn({ netz: { laengeM: 100 } }))).toContain('verbindet die Heizzentrale');
    const neubau = text(wtWvn({ projekt: neubauProjekt, netz: { ...netz, bestand: true } }));
    expect(neubau).toContain('besteht kein Wärmenetz');
    expect(neubau).not.toContain('Bestandsnetz');
  });
  it('nennt hinzukommende und entfallende Anschlüsse', () => {
    const t = text(wtWvn({ projekt: gemischtProjekt, netz }));
    expect(t).toContain('kommen 10 Gebäudeanschlüsse hinzu und 2 Anschlüsse entfallen');
    expect(text(wtWvn({ projekt: { ...gemischtProjekt, ereignisse: [{ jahr: 2030, art: 'neubau', anzahl: 1 }] }, netz }))).toContain('kommen 1 Gebäudeanschluss hinzu');
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
  it('wertet Temperaturniveau und Spreizung, ohne Wärmepumpen zu nennen', () => {
    const mit = (vl, rl) => text(wtWvn({ netz: { ...netz, vlC: vl, rlC: rl } }));
    expect(mit(95, 55)).toContain('Temperaturniveau ist hoch');
    expect(mit(75, 50)).toContain('Temperaturniveau ist mittel');
    expect(mit(60, 35)).toContain('Niedertemperaturnetz');
    expect(mit(40, 25)).toContain('kalte Nahwärme');
    expect(mit(90, 55)).toContain('große Spreizung');
    expect(mit(80, 55)).toContain('üblichen Bereich');
    expect(mit(70, 55)).toContain('geringe Spreizung');
    for (const t of [mit(95, 55), mit(75, 50), mit(60, 35), mit(40, 25)]) expect(t).not.toMatch(/Wärmepumpe|Erzeuger/);
  });
  it('nennt die Hydraulik-Auslegungsregeln und wertet Überschreitungen', () => {
    expect(text(wtWvn({ netz }))).toContain('150 Pa/m');
    expect(text(wtWvn({ netz }))).toContain('250 Pa/m');
    expect(text(wtWvn({ netz: { ...netz, ueberschreitungen: 0 } }))).toContain('keine Überschreitung');
    expect(text(wtWvn({ projekt: bestandProjekt, netz: { ...netz, bestand: true, ueberschreitungen: 3 } }))).toContain('nicht verändert');
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
  it('weist auf geschätzte Anschlussleistungen hin', () => {
    expect(text(wtHausstation({ gebaeude: { anzahl: 5, heizlastSummeKw: 500 }, herkunft: { gebaeude: { gesetzt: 0, geschaetzt: 5 } } }))).toContain('Schätzwerte aus Fläche, Baujahr und Nutzung');
    expect(text(wtHausstation({ gebaeude: { anzahl: 5, heizlastSummeKw: 500 }, herkunft: { gebaeude: { gesetzt: 3, geschaetzt: 2 } } }))).not.toContain('Schätzwerte');
  });
  it('wertet das Temperaturniveau und Trinkwassererwärmung', () => {
    expect(text(wtHausstation({ netz: { vlC: 90 } }))).toContain('hohes Temperaturniveau');
    expect(text(wtHausstation({ netz: { vlC: 75 } }))).toContain('Prüfung der Heizflächen');
    const nied = text(wtHausstation({ netz: { vlC: 55 } }));
    expect(nied).toContain('Legionellenschutz');
    expect(nied).toContain('[Konzept Trinkwassererwärmung]');
    expect(text(wtHausstation({ netz: { vlC: 75 } }))).not.toContain('Legionellen');
  });
  it('Neubau: Hausstationen können gleich auf das Temperaturniveau ausgelegt werden', () => {
    expect(text(wtHausstation({ projekt: neubauProjekt, netz: { vlC: 60 } }))).toContain('von Beginn an auf das gewählte Temperaturniveau');
    expect(text(wtHausstation({ projekt: bestandProjekt, netz: { vlC: 60 } }))).not.toContain('von Beginn an');
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

describe('2.4 Variantenvergleich — hier stehen die Versorgungssysteme', () => {
  const A = V('WP + Gaskessel', [{ ...wp }, { ...gk }], { investEur: 6e6, jahreskostenEur: 3.0e6, wgkCt: 11.0, co2T: 4000, eeAnteilPct: 75 });
  const B = V('WP monovalent', [{ key: 'lwwp', leistungKw: 10500, waermeMwh: 29000, elMwh: 8000 }], { investEur: 12e6, jahreskostenEur: 3.4e6, wgkCt: 12.5, co2T: 1200, eeAnteilPct: 100 });
  const C = V('BHKW + WP', [{ ...bhkw }, { key: 'lwwp', leistungKw: 9500, waermeMwh: 25000, elMwh: 7000 }], { investEur: 8e6, jahreskostenEur: 2.8e6, wgkCt: 10.2, co2T: 6500, eeAnteilPct: 40 });
  const mit = (varianten, extra = {}) => text(wtVariantenvergleich({ lastgang, varianten, ...extra }));

  it('ohne Varianten: Platzhalter', () => {
    expect(text(wtVariantenvergleich({}))).toContain('[Varianten der Wärmeversorgung]');
  });
  it('mit einer Variante: beschreibt sie und fragt weitere ab', () => {
    const t = mit([A]);
    expect(t).toContain('Betrachtet wird eine Variante der Wärmeversorgung, „WP + Gaskessel“');
    expect(t).toContain('Soll-Bedarf aus Kapitel 2.2 (29.000 MWh/a, Spitzenlast 10.000 kW)');
    expect(t).toContain('bivalent aus 2 Erzeugern');
    expect(t).toContain('[Weitere Varianten');
    expect(t).toContain('Wärmegestehungskosten von 11,0 ct/kWh');
  });
  it('beschreibt je Variante Konzept, Leistungsbilanz, EE und Technik', () => {
    const t = mit([A, B, C]);
    expect(t).toContain('Die Variante „WP + Gaskessel“ versorgt die Liegenschaft bivalent');
    expect(t).toContain('Die Variante „WP monovalent“ versorgt die Liegenschaft monovalent über die Luft-Wasser-Wärmepumpe');
    expect(t).toContain('Die Variante „BHKW + WP“');
    expect(t).toContain('N-1');
    expect(t).toContain('keine Redundanz');
    expect(t).toContain('Jahresarbeitszahl');
    expect(t).toContain('Vollbenutzungsstunden');
  });
  it('Hinweise zur Technik stehen nur einmal, Zahlen je Variante', () => {
    const t = mit([A, B, C]);
    expect(t.match(/Kapitel 3\.3\.2/g)).toHaveLength(1);
    expect(t.match(/TA Lärm/g)).toHaveLength(1);
    expect(t.match(/Jahresarbeitszahl \(JAZ\) beträgt/g)).toHaveLength(3);
  });
  it('mit zwei Varianten: Zielkonflikt mit Vermeidungskosten', () => {
    const t = mit([A, B]);
    expect(t).toContain('Zielkonflikt');
    expect(t).toContain('Mehrkosten');
    expect(t).toContain('143 €/t');
    expect(t).toContain('WP + Gaskessel ist damit');
  });
  it('wirtschaftlich und ökologisch dieselbe Variante: kein Zielkonflikt', () => {
    expect(mit([{ ...A, wgkCt: 9, co2T: 900 }, B])).toContain('ein Zielkonflikt zwischen Kosten und Klimaschutz besteht nicht');
  });
  it('drei Varianten: Rangfolge und Investitionshinweis', () => {
    const t = mit([A, B, C]);
    expect(t).toContain('Rangfolge nach Kosten lautet: BHKW + WP (10,2 ct/kWh), WP + Gaskessel (11,0 ct/kWh), WP monovalent (12,5 ct/kWh)');
    expect(t).toContain('Die geringste Investition erfordert WP + Gaskessel');
  });
  it('nahezu gleichwertige Varianten werden nicht künstlich gerankt', () => {
    const t = mit([{ ...A, wgkCt: 11, co2T: 4000 }, { ...B, wgkCt: 11.1, co2T: 4050 }]);
    expect(t).toContain('wirtschaftlich gleichwertig');
    expect(t).toContain('ökologisch kaum');
  });
  it('fehlende Werte einer Variante werden benannt', () => {
    const t = mit([A, V('Ohne Werte', [wp])]);
    expect(t).toContain('fehlen die Wirtschaftlichkeitswerte');
    expect(t).not.toMatch(/NaN|undefined/);
  });
  it('nennt Rahmenbedingungen und die WPG-Erfüllung je Variante', () => {
    const t = mit([A, B], { wirtschaft: { co2PreisEurT: 120, strompreisCt: 35, gaspreisCt: 10 } });
    expect(t).toContain('CO₂-Preis von 120 €/t');
    expect(t).toContain('Strompreis von 35,0 ct/kWh');
    expect(t).toContain('WP + Gaskessel (75,0 %): die WPG-Stufe 2030');
    expect(t).toContain('alle Stufen des WPG');
  });
  it('Unterdeckung und überdimensionierte Variante', () => {
    expect(mit([V('Klein', [{ ...wp, leistungKw: 6000 }])])).toContain('Unterdeckung von 4.000 kW');
    expect(mit([V('Groß', [{ ...wp, leistungKw: 20000 }])])).toContain('überdimensioniert');
  });
  it('prüft N-1 je Variante: erfüllt, teilweise, verfehlt', () => {
    const n1 = (a, b) => mit([V('X', [{ ...wp, leistungKw: a }, { ...gk, leistungKw: b }])]);
    expect(n1(10000, 10000)).toContain('erfüllt damit das N-1-Kriterium');
    expect(n1(7000, 8000)).toContain('nicht vollständig erfüllt');
    expect(n1(9000, 3000)).toContain('deutlich verfehlt');
  });
  it('bewertet Wärmepumpe, BHKW, Kessel und weitere Technik', () => {
    const t1 = (e, w) => mit([V('X', e, w)]);
    expect(t1([{ ...wp, elMwh: 4400 }, gk])).toContain('sehr gut');
    expect(t1([{ ...wp, elMwh: 7500 }, gk])).toContain('mäßig');
    expect(t1([{ ...wp, elMwh: 10000 }, gk])).toContain('niedrig');
    expect(t1([{ key: 'lwwp', leistungKw: 5000, waermeMwh: 0 }])).toContain('ist Teil der Variante');
    expect(t1([{ key: 'lwwp', leistungKw: 5000, waermeMwh: 1000 }])).toContain('[Jahresarbeitszahl]');
    expect(t1([{ ...bhkw, waermeMwh: 700 * 2000 / 1000 }, gk])).toContain('Auslastung ist gering');
    expect(t1([{ ...bhkw, waermeMwh: 700 * 7000 / 1000 }, gk])).toContain('Auslastung ist hoch');
    expect(t1([wp, { ...gk, waermeMwh: 500 }])).toContain('Spitzenlast- und Redundanzerzeuger');
    expect(t1([wp, { ...gk, waermeMwh: 24000 }])).toContain('Hauptwärmeerzeuger');
    expect(t1([wp, { ...gk, waermeMwh: 0 }])).toContain('als Reserve vorgesehen');
    expect(t1([wp, { key: 'pellets', leistungKw: 2000, waermeMwh: 3000 }])).toContain('Brennstofflogistik');
    expect(t1([wp, { key: 'stromkessel', leistungKw: 4000, waermeMwh: 9000 }])).toContain('stark vom Strompreis abhängig');
    expect(t1([wp, { key: 'solarthermie', leistungKw: 500, waermeMwh: 400 }])).toContain('Flächenkonkurrenz');
    expect(t1([wp, { key: 'fernwaerme', leistungKw: 3000, waermeMwh: 1000 }])).toContain('[Primärenergiefaktor / EE-Anteil Fernwärme]');
    expect(t1([wp, { key: '_thermSpeicher', leistungKw: 1, waermeMwh: 300 }])).toContain('[Speichervolumen in m³]');
    expect(t1([wp, { key: 'geo', leistungKw: 1000, waermeMwh: 2000, elMwh: 500 }])).toContain('wasserrechtlichen');
  });
  it('bewertet den EE-Anteil je Variante in allen Stufen', () => {
    const ee = p => mit([V('X', [wp, gk], { eeAnteilPct: p, co2T: 1000 })]);
    expect(ee(100)).toContain('werden damit eingehalten');
    expect(ee(85)).toContain('für 2030 und 2040 erfüllt');
    expect(ee(50)).toContain('um 30,0 Prozentpunkte verfehlt');
    expect(ee(10)).toContain('um 20,0 Prozentpunkte unterschritten');
    expect(ee(0)).toContain('vollständig aus nicht erneuerbaren');
    expect(ee(85)).toContain('1.000 t CO₂e');
  });
  it('verwendet passende Artikel und Singular/Plural bei den ergänzenden Erzeugern', () => {
    expect(mit([V('X', [wp, gk])])).toContain('deckt die Luft-Wasser-Wärmepumpe');
    expect(mit([V('X', [wp, gk])])).toContain('Weiterer Erzeuger ist Gaskessel');
    expect(mit([V('X', [wp, gk, bhkw])])).toContain('Weitere Erzeuger sind Gaskessel und BHKW');
    expect(mit([V('X', [wp, gk])])).toContain('Der Gaskessel (8.000 kW)');
  });
});

describe('2.5 Wirtschaftlichkeit', () => {
  const w = { zinsPct: 3.5, co2PreisEurT: 120, strompreisCt: 35, gaspreisCt: 10 };
  const A = V('A', [wp, gk], { investEur: 9e6, jahreskostenEur: 3.1e6, wgkCt: 11.2 });
  const B = V('B', [wp], { investEur: 5e6, wgkCt: 12 });
  it('ohne Daten: Platzhalter und keine Zahlen', () => {
    const t = text(wtWirtschaftlichkeit({}));
    expect(t).toContain('[Investition und Wärmegestehungskosten je Variante]');
    expect(t).toContain('[Kalkulationszinssatz in %]');
    expect(t).toContain('[Betrachtungszeitraum in Jahren]');
    expect(t).not.toMatch(/NaN|undefined/);
  });
  it('nennt Methodik, Zins, Preise und die Werte jeder Variante', () => {
    const t = text(wtWirtschaftlichkeit({ wirtschaft: w, varianten: [A] }));
    expect(t).toContain('VDI 2067');
    expect(t).toContain('3,5 %');
    expect(t).toContain('Strom 35,0 ct/kWh');
    expect(t).toContain('Variante „A“: Gesamtinvestition rund 9.000 Tsd. €');
    expect(t).toContain('692 € je kW');
    expect(t).toContain('jährliche Gesamtkosten 3.100 Tsd. €');
    expect(t).toContain('11,2 ct/kWh');
  });
  it('vergleicht die günstigste Variante mit dem Fernwärmepreis in beide Richtungen und bei Gleichstand', () => {
    const fw = ct => text(wtWirtschaftlichkeit({ wirtschaft: { ...w, fernwaermeCt: ct }, varianten: [A, B] }));
    expect(fw(15)).toContain('unter dem angesetzten Fernwärmepreis');
    expect(fw(8)).toContain('über dem angesetzten Fernwärmepreis');
    expect(fw(11.3)).toContain('auf dem Niveau');
    expect(fw(15)).toContain('Die günstigste Variante (A)');
  });
  it('nennt Kostentreiber passend zur Technik der Varianten', () => {
    const t = tech => text(wtWirtschaftlichkeit({ wirtschaft: w, varianten: [V('X', tech, { wgkCt: 10 })] }));
    expect(t([wp])).toContain('von dem Strompreis ab');
    expect(t([gk])).toContain('von dem Gaspreis und dem CO₂-Preis ab');
    expect(t([{ key: 'heizoel', leistungKw: 100, waermeMwh: 10 }])).toContain('Heizölpreis');
    expect(t([{ key: 'hhs', leistungKw: 100, waermeMwh: 10 }])).toContain('Brennstoffpreis für Biomasse');
  });
  it('Variantenspanne und Fördermittel-Platzhalter', () => {
    const t = text(wtWirtschaftlichkeit({ wirtschaft: w, varianten: [A, B] }));
    expect(t).toContain('zwischen 11,2 und 12,0 ct/kWh');
    expect(t).toContain('5.000 und 9.000 Tsd. €');
    expect(t).toContain('wirtschaftlichste Variante ist A');
    expect(t).toContain('[Förderprogramm, z. B. BEW]');
  });
});

describe('2.7 Empfehlung und 6.1 Fazit', () => {
  const A = V('A', [wp], { wgkCt: 10, co2T: 1000, eeAnteilPct: 100 });
  const B = V('B', [wp, gk], { wgkCt: 12, co2T: 3000, eeAnteilPct: 60 });
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
    expect(text(wtEmpfehlung({ varianten: [V('X', [wp], { eeAnteilPct: 10 })] }))).toContain('30 % wird derzeit nicht erreicht');
  });
  it('Folgeschritte: sicher bei gemeinsamer Technik, bedingt bei nur einem Teil der Varianten', () => {
    const alle = text(wtEmpfehlung({ varianten: [A, B], netz: { vlC: 85 } }));
    expect(alle).toContain('der Netzanschlussantrag');
    expect(alle).not.toContain('(sofern die gewählte Variante dies enthält) der Netzanschlussantrag');
    expect(alle).toContain('schalltechnisches Gutachten');
    expect(alle).toContain('Absenkung der Netztemperaturen');
    expect(alle).toContain('(sofern die gewählte Variante dies enthält) ein Fahrplan zum Ersatz oder zur Umstellung der fossilen Erzeuger');
    const erde = text(wtEmpfehlung({ varianten: [V('E', [{ key: 'geo', leistungKw: 1000, waermeMwh: 3000 }])] }));
    expect(erde).toContain('wasserrechtlichen');
    expect(erde).not.toContain('schalltechnisches');
    expect(erde).toContain('[Förderprogramm, z. B. BEW]');
  });
  it('Fazit nennt Bedarf, Herkunft, Variantenstand und lässt die Empfehlung offen', () => {
    const t = text(wtFazit({ lastgang, projekt: neubauProjekt, herkunft: { lastgang: 'gebaeude' }, varianten: [A, B] }));
    expect(t).toContain('29.000 MWh');
    expect(t).toContain('ausschließlich aus geplanten Neubauten');
    expect(t).toContain('aus den Gebäudedaten synthetisierten Lastgang');
    expect(t).toContain('2 Varianten betrachtet');
    expect(t).toContain('Wirtschaftlich am günstigsten ist A mit 10,0 ct/kWh');
    expect(t).toContain('[Empfohlene Variante]');
    expect(t).toContain('gemessenen Lastgang abzusichern');
    expect(t).toContain('Fahrplan zur Umstellung');
  });
  it('Fazit mit einer Variante nennt deren Ergebnisse', () => {
    const t = text(wtFazit({ lastgang, varianten: [A] }));
    expect(t).toContain('Betrachtet wurde die Variante „A“');
    expect(t).toContain('einen Anteil erneuerbarer Energien von 100,0 %');
    expect(t).toContain('10,0 ct/kWh');
  });
  it('Fazit meldet hohe Netzverluste und bleibt ohne Varianten Platzhalter', () => {
    const t = text(wtFazit({ lastgang: { ...lastgang, netzverlustPct: 35 } }));
    expect(t).toContain('Netzverluste von 35,0 %');
    expect(t).toContain('[Zusammenfassung des Variantenvergleichs]');
    expect(text(wtFazit({}))).toContain('[Zusammenfassung des Wärmebedarfs]');
  });
});

describe('Alle Bausteine: keine ungültigen Zahlen', () => {
  const szenarien = [
    {}, { lastgang }, { varianten: [V('A', [wp])] }, { lastgang, projekt: gemischtProjekt, varianten: [V('A', [wp, gk, bhkw])] },
    { lastgang: { pMaxKw: 0, gesamtMwh: 0 }, varianten: [V('A', [{ key: 'lwwp', leistungKw: 0, waermeMwh: 0 }])] },
    { lastgang: { pMaxKw: NaN, nutzMwh: null }, varianten: [V('A', [{ key: 'unbekannt', leistungKw: 100, waermeMwh: 50 }])] },
    { projekt: neubauProjekt, herkunft: { lastgang: 'gebaeude', gebaeude: { gesamt: 12, gesetzt: 0, geschaetzt: 12 } } },
    { projekt: { anzahl: { gesamt: 3, bestand: 3, neubau: 0 }, bedarfsverlauf: [{ jahr: 2026, bedarfMwh: 0 }, { jahr: 2040, bedarfMwh: 0 }] }, herkunft: { lastgang: 'import' } },
    { varianten: [V('X'), V('Y')], wirtschaft: {} },
  ];
  for (const [i, s] of szenarien.entries()) {
    it(`Szenario ${i}`, () => {
      for (const fn of [wtIstZustand, wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit]) {
        const t = text(fn(s));
        expect(t, fn.name).not.toMatch(/NaN|undefined|Infinity|\[object/);
        expect(t.length, fn.name).toBeGreaterThan(20);
      }
    });
  }
  it('Platzhalter tragen immer einen Feldnamen', () => {
    for (const fn of [wtIstZustand, wtDimensionierungWea, wtWvn, wtHausstation, wtVariantenvergleich, wtWirtschaftlichkeit, wtEmpfehlung, wtFazit]) {
      for (const abs of fn({})) for (const s of abs) if (typeof s !== 'string') expect(s.feld.length).toBeGreaterThan(2);
    }
    expect(F('x', 5).wert).toBe('5');
    expect(F('x').wert).toBe('');
  });
});

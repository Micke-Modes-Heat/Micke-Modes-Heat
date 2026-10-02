// Vitest-Tests für lib/gutachten-gebaeude.js — Auswertung und Texte zu Gebäudebestand und baulicher Entwicklung.
import { describe, it, expect } from 'vitest';
import { gbAuswertung, gbTextBestand, gbTextVeraenderung, gbTextEntwicklung, gbSpezKlasse, GB_BAUALTER } from '../src/lib/gutachten-gebaeude.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);

/** Wie getComputedStats im Tool: Bau-, Abriss- und Sanierungsjahr bestimmen Status und Werte. */
function stats(g, year) {
  let waerme = parseFloat(g.waerme) || 0, spez = parseFloat(g.spez) || 0, heizlast = parseFloat(g.heizlast) || 0;
  const baujahr = g.baujahr ? parseInt(g.baujahr, 10) : 1900;
  const abriss = g.abrissjahr ? parseInt(g.abrissjahr, 10) : 9999;
  let status = 'bestand';
  if (year < baujahr) status = 'geplant';
  if (year >= abriss) status = 'abgerissen';
  if (status !== 'bestand') return { waerme: 0, spez: 0, heizlast: 0, status };
  let aktiv = null;
  for (const s of g.sanierungen || []) if (s.jahr <= year && (!aktiv || s.jahr > aktiv.jahr)) aktiv = s;
  if (aktiv && spez > 0) {
    const r = aktiv.zielSpez / spez;
    waerme *= r; heizlast *= r; spez = aktiv.zielSpez; status = 'saniert';
  }
  return { waerme, spez, heizlast, status };
}

const A = { id: 1, name: 'MFH Nord', nutzung: 'MFH', flaeche: '1000', baujahr: '1965', waerme: '150', spez: '150', heizlast: '60', sanierungen: [{ jahr: 2032, zielSpez: 90 }], waermeManual: true };
const B = { id: 2, name: 'Büro Mitte', nutzung: 'Büro', flaeche: '2000', baujahr: '1990', waerme: '200', spez: '100', heizlast: '80', abrissjahr: '2035', waermeManual: true };
const C = { id: 3, name: 'Schule', nutzung: 'Schule', flaeche: '3000', baujahr: '1975', waerme: '600', spez: '200', heizlast: '240' };
const D = { id: 4, name: 'Neubau Büro', nutzung: 'Büro', flaeche: '1500', baujahr: '2030', waerme: '60', spez: '40', heizlast: '30' };
const E = { id: 5, name: 'Neubau Wohnen', nutzung: 'MFH', flaeche: '1000', baujahr: '2033', waerme: '50', spez: '50', heizlast: '25' };
const F2 = { id: 6, name: 'Halle', nutzung: 'Halle', flaeche: '500', baujahr: '2010', waerme: '25', spez: '50', heizlast: '12' };
const alle = [A, B, C, D, E, F2];
const auswerten = (geb, opts) => gbAuswertung(geb, stats, opts);

describe('gbAuswertung — Zahlen', () => {
  const a = auswerten(alle);
  it('trennt Bestand (vor 2026) und Neubau (ab 2026)', () => {
    expect(a.anzahl).toEqual({ gesamt: 6, neubau: 2, bestand: 4, abriss: 1, saniert: 1 });
    expect(a.istJahr).toBe(2025);
    expect(a.ist.anzahl).toBe(4);
  });
  it('ein Gebäude mit Baujahr 2026 ist Neubau, eines mit 2025 Bestand', () => {
    const x = auswerten([{ ...D, baujahr: '2026' }, { ...A, sanierungen: [], baujahr: '2025' }]);
    expect(x.anzahl).toMatchObject({ neubau: 1, bestand: 1 });
  });
  it('Ist-Bestand: Fläche, Bedarf, Heizlast, spezifische Werte', () => {
    const i = a.ist;
    expect(i.flaecheM2).toBe(6500);
    expect(i.bedarfMwh).toBe(975);
    expect(i.heizlastKw).toBe(392);
    expect(i.spezKwhM2).toBeCloseTo(975 * 1000 / 6500, 5);
    expect(i.spezWM2).toBeCloseTo(392 * 1000 / 6500, 5);
  });
  it('Nutzung sortiert nach Bedarf, Baualter in Klassen', () => {
    expect(a.ist.nutzung.map(n => n.label)).toEqual(['Schule', 'Büro', 'MFH', 'Halle']);
    const k = Object.fromEntries(a.ist.baualter.map(x => [x.label, x.anzahl]));
    expect(k['1949–1978']).toBe(2);   // 1965, 1975
    expect(k['1979–1994']).toBe(1);
    expect(k['2002–2015']).toBe(1);
    expect(k['vor 1949']).toBe(0);
    expect(a.ist.baualter.map(x => x.label)).toEqual(GB_BAUALTER.map(x => x.label));
  });
  it('Anteil vor 1979, Mittel und Median des Baujahrs', () => {
    expect(a.ist.anteilVor1979Pct).toBe(50);
    expect(a.ist.bedarfVor1979Pct).toBeCloseTo((150 + 600) / 975 * 100, 5);
    expect(a.ist.baujahrMittel).toBeCloseTo((1965 + 1990 + 1975 + 2010) / 4, 5);
    expect(a.ist.baujahrMedian).toBe(1982.5);
  });
  it('spezifische Klassen, Großverbraucher, Auffälligkeiten', () => {
    const kl = Object.fromEntries(a.ist.spezKlassen.map(x => [x.label, x.anzahl]));
    expect(kl).toMatchObject({ 'unter 50': 0, '50–100': 1, '100–150': 1, '150–200': 1 });   // Halle 50, Büro 100, MFH 150, Schule 200
    expect(kl['200–250']).toBe(1);
    expect(a.ist.top[0].name).toBe('Schule');
    expect(a.ist.top3AnteilPct).toBeCloseTo((600 + 200 + 150) / 975 * 100, 5);
    expect(a.ist.hoechsterSpez.name).toBe('Schule');
    expect(a.ist.niedrigsterSpez.name).toBe('Halle');
  });
  it('Datenherkunft und Lücken', () => {
    expect(a.ist.gesetzt).toBe(2);
    expect(a.ist.geschaetzt).toBe(2);
    const ohne = auswerten([{ ...A, baujahr: '', flaeche: '' }]);
    expect(ohne.ist.ohneBaujahr).toBe(1);
    expect(ohne.ist.ohneFlaeche).toBe(1);
  });
  it('Ereignisse je Jahr und Art mit Bedarfs- und Heizlastwirkung', () => {
    const j = Object.fromEntries(a.ereignisseJahr.map(e => [`${e.jahr}-${e.art}`, e]));
    expect(Object.keys(j).sort()).toEqual(['2030-neubau', '2032-sanierung', '2033-neubau', '2035-abriss']);
    expect(j['2030-neubau'].deltaMwh).toBe(60);
    expect(j['2032-sanierung'].deltaMwh).toBeCloseTo(150 * 90 / 150 - 150, 5);   // 90 − 150 = −60
    expect(j['2032-sanierung'].deltaKw).toBeCloseTo(36 - 60, 5);
    expect(j['2035-abriss'].deltaMwh).toBe(-200);
    expect(j['2035-abriss'].namen).toEqual(['Büro Mitte']);
  });
  it('Jahresverlauf bis zum letzten Ereignis mit Segmenten', () => {
    expect(a.endJahr).toBe(2035);
    expect(a.jahre[0].jahr).toBe(2025);
    expect(a.jahre.at(-1).jahr).toBe(2035);
    const j2025 = a.jahre.find(j => j.jahr === 2025), j2031 = a.jahre.find(j => j.jahr === 2031), j2033 = a.jahre.find(j => j.jahr === 2033), j2035 = a.jahre.at(-1);
    expect(j2025.bedarfMwh).toBe(975);
    expect(j2025.segmente.neubau.anzahl).toBe(0);
    expect(j2031.segmente.neubau.bedarfMwh).toBe(60);
    expect(j2031.bedarfMwh).toBe(975 + 60);
    expect(j2033.segmente.saniert.bedarfMwh).toBeCloseTo(90, 5);
    expect(j2033.segmente.unsaniert.bedarfMwh).toBe(200 + 600 + 25);
    // 2035: B abgerissen, A saniert (90), Schule 600, Halle 25, Neubauten 110
    expect(j2035.bedarfMwh).toBeCloseTo(90 + 600 + 25 + 60 + 50, 5);
    expect(j2035.anzahl).toBe(5);
    expect(j2035.spezKwhM2).toBeCloseTo(j2035.bedarfMwh * 1000 / j2035.flaecheMitBedarf, 5);
  });
  it('ohne Ereignisse nur das Ist-Jahr', () => {
    const x = auswerten([A, B, C].map(g => ({ ...g, sanierungen: [], abrissjahr: '' })));
    expect(x.ereignisse).toEqual([]);
    expect(x.jahre).toHaveLength(1);
    expect(x.endJahr).toBe(2025);
  });
  it('reiner Neubau: Ist-Bestand leer, Bedarf entsteht erst später', () => {
    const x = auswerten([D, E]);
    expect(x.anzahl).toMatchObject({ bestand: 0, neubau: 2 });
    expect(x.ist.anzahl).toBe(0);
    expect(x.jahre[0].bedarfMwh).toBe(0);
    expect(x.jahre.at(-1).bedarfMwh).toBe(110);
  });
  it('ausgeschlossene Gebäude zählen nicht, und leere Eingaben stören nicht', () => {
    expect(auswerten(alle, { ausgeschlossen: id => id === 3 }).anzahl.gesamt).toBe(5);
    expect(() => auswerten([])).not.toThrow();
    expect(() => auswerten(undefined)).not.toThrow();
    expect(auswerten([]).ist.anzahl).toBe(0);
  });
  it('begrenzt den Verlauf auf das Jahr „bis“', () => {
    expect(auswerten(alle, { bis: 2031 }).endJahr).toBe(2031);
  });
});

describe('Texte: 1.3.1 Gebäudebestand', () => {
  const a = auswerten(alle);
  it('nennt Anzahl, Fläche, Bedarf und Heizlast', () => {
    const t = text(gbTextBestand(a));
    expect(t).toContain('Der Gebäudebestand (Baujahr vor 2026) umfasst 4 Gebäude mit zusammen 6.500 m² Fläche');
    expect(t).toContain('975 MWh pro Jahr');
    expect(t).toContain('392 kW');
    expect(t).toContain('nicht die Spitzenlast der Liegenschaft');
  });
  it('Nutzung: mehrere Nutzungen, eine Nutzung', () => {
    expect(text(gbTextBestand(a))).toContain('vor allem auf Schule (62 %, 1 Gebäude)');
    expect(text(gbTextBestand(a))).toContain('hinzu kommen 1 weitere Nutzungsarten');
    expect(text(gbTextBestand(auswerten([A, { ...B, nutzung: 'MFH' }].map(g => ({ ...g, nutzung: 'MFH', sanierungen: [], abrissjahr: '' })))))).toContain('Der gesamte Bestand wird als MFH genutzt');
  });
  it('Baualter: Altbestand in drei Stufen', () => {
    expect(text(gbTextBestand(a))).toContain('50 % der Gebäude und 77 % des Wärmebedarfs entfallen auf Gebäude, die vor 1979');
    expect(text(gbTextBestand(a))).toContain('bedeutender Teil des Bestands ist Altbestand');
    const alt = auswerten([A, C].map(g => ({ ...g, sanierungen: [] })));
    expect(text(gbTextBestand(alt))).toContain('überwiegend unsanierter Altbestand');
    const jung = auswerten([{ ...F2 }, { ...F2, id: 7, baujahr: '2018' }]);
    expect(text(gbTextBestand(jung))).toContain('überwiegend jüngeren Datums');
  });
  it('spezifischer Bedarf in den Klassen', () => {
    const mit = spez => text(gbTextBestand(auswerten([{ ...C, waerme: String(spez * 3), spez: String(spez) }])));
    expect(mit(40)).toContain('sehr niedriger Wert');
    expect(mit(80)).toContain('niedriger Wert');
    expect(mit(120)).toContain('mittlerer Wert');
    expect(mit(180)).toContain('hoher Wert');
    expect(mit(250)).toContain('sehr hoher Wert');
    expect(gbSpezKlasse(59)).toBe('sehrNiedrig');
  });
  it('Konzentration und Auffälligkeiten', () => {
    const t = text(gbTextBestand(a));
    expect(t).toContain('Wenige Großverbraucher bestimmen den Bedarf: Schule, Büro Mitte und MFH Nord');
    expect(t).toContain('Auffällig: Halle mit 50 kWh/(m²·a) liegt deutlich unter dem Mittelwert');
    expect(t).toContain('mittlere Baujahr liegt bei 1985 (Median 1983)');   // ohne Tausenderpunkt
    expect(t).not.toContain('Priorität für Sanierungsmaßnahmen');   // Schule liegt beim 1,3-Fachen des Mittelwerts, unter der Schwelle
    const viele = Array.from({ length: 10 }, (_, k) => ({ ...C, id: 100 + k, name: `G${k}`, waerme: '100', spez: '100', flaeche: '1000' }));
    expect(text(gbTextBestand(auswerten(viele)))).toContain('Der Bedarf verteilt sich auf viele Gebäude');
    const ausreisser = auswerten([...viele, { ...C, id: 200, name: 'Ausreißer', waerme: '600', spez: '300', flaeche: '2000' }]);
    expect(text(gbTextBestand(ausreisser))).toContain('Ausreißer mit 300 kWh/(m²·a) liegt beim');
    expect(text(gbTextBestand(ausreisser))).toContain('Priorität für Sanierungsmaßnahmen');
  });
  it('hoher und niedriger Ausreißer stehen durch Strichpunkt getrennt', () => {
    const viele = Array.from({ length: 10 }, (_, k) => ({ ...C, id: 100 + k, name: `G${k}`, waerme: '100', spez: '100', flaeche: '1000' }));
    const t = text(gbTextBestand(auswerten([...viele, { ...C, id: 200, name: 'Hoch', waerme: '600', spez: '300', flaeche: '2000' }, { ...C, id: 201, name: 'Tief', waerme: '10', spez: '10', flaeche: '1000' }])));
    expect(t).toMatch(/Priorität für Sanierungsmaßnahmen; Tief mit 10 kWh/);
  });
  it('Datenherkunft: nur geschätzt, nur gesetzt, gemischt', () => {
    expect(text(gbTextBestand(auswerten([C, { ...C, id: 9 }])))).toContain('aller 2 Gebäude sind Schätzwerte');
    expect(text(gbTextBestand(auswerten([A, B].map(g => ({ ...g, sanierungen: [], abrissjahr: '' })))))).toContain('aller 2 Gebäude sind vorgegebene Werte');
    expect(text(gbTextBestand(a))).toContain('Von 4 Gebäuden beruhen 2 auf vorgegebenen Werten');
  });
  it('Lücken und Quelle der Gebäudedaten', () => {
    const t = text(gbTextBestand(auswerten([{ ...A, baujahr: '', flaeche: '' }, C])));
    expect(t).toContain('1 Gebäude ohne Baujahr');
    expect(t).toContain('1 Gebäude ohne Flächenangabe');
    expect(text(gbTextBestand(a))).toContain('[Quelle der Gebäudedaten');
    expect(text(gbTextBestand(a, { quelleGebaeude: 'dem Liegenschaftsverzeichnis' }))).toContain('stammen aus dem Liegenschaftsverzeichnis');
  });
  it('reiner Neubau: es gibt keinen Bestand', () => {
    const t = text(gbTextBestand(auswerten([D, E])));
    expect(t).toContain('Es besteht kein Gebäudebestand');
    expect(t).toContain('Kapitel 1.3.2');
  });
});

describe('Texte: 1.3.2 Bauliche Veränderungen', () => {
  const a = auswerten(alle);
  it('ohne Veränderungen: Soll gleich Ist, Platzhalter für Planungen', () => {
    const t = text(gbTextVeraenderung(auswerten([A, B, C].map(g => ({ ...g, sanierungen: [], abrissjahr: '' })))));
    expect(t).toContain('nicht hinterlegt');
    expect(t).toContain('Soll-Bedarf entspricht dem Ist-Bedarf');
    expect(t).toContain('[geplante bauliche Veränderungen]');
  });
  it('Überblick mit Zahlen und Zeitraum', () => {
    const t = text(gbTextVeraenderung(a));
    expect(t).toContain('Ab 2026 sind 4 bauliche Veränderungen an 4 Gebäuden vorgesehen, zeitlich verteilt zwischen 2030 und 2035');
    expect(t).toContain('2 Neubauten, 1 Abriss und 1 Sanierung');
  });
  it('Neubau: Zahlen, Vergleich mit dem Bestand, Namen', () => {
    const t = text(gbTextVeraenderung(a));
    expect(t).toContain('Neubau: 2 Gebäude werden zwischen 2030 und 2033 errichtet (zusammen 2.500 m² Fläche)');
    expect(t).toContain('um 110 MWh pro Jahr');
    expect(t).toContain('55 kW');
    expect(t).toContain('liegen die Neubauten');
    expect(t).toContain('unter dem Bestand (150 kWh/(m²·a))');
    expect(t).toContain('Betroffen: Neubau Büro und Neubau Wohnen');
  });
  it('Neubau auf Niveau des Bestands und Schwerpunktjahr', () => {
    const gleich = text(gbTextVeraenderung(auswerten([{ ...C, waerme: '300', spez: '100', flaeche: '3000' }, { ...D, waerme: '100', spez: '100', flaeche: '1000' }])));
    expect(gleich).toContain('auf dem Niveau des Bestands');
    const viele = Array.from({ length: 6 }, (_, k) => ({ ...D, id: 300 + k, name: `N${k}`, baujahr: k < 4 ? '2030' : '2031' }));
    const t = text(gbTextVeraenderung(auswerten([C, ...viele])));
    expect(t).toContain('Schwerpunkt ist das Jahr 2030 mit 4 Neubauten');
    expect(t).not.toContain('Betroffen: N0');
  });
  it('Abriss: Anteil am Bestand und große Eingriffe', () => {
    const t = text(gbTextVeraenderung(a));
    expect(t).toContain('Abriss: 1 Gebäude wird im Jahr 2035 abgerissen (25,0 % des Bestands)');
    expect(t).toContain('entfallen 200 MWh');
    expect(t).not.toContain('erheblichen Teil');
    const viel = text(gbTextVeraenderung(auswerten([A, B, C].map((g, i) => ({ ...g, sanierungen: [], abrissjahr: i < 2 ? '2031' : '' })))));
    expect(viel).toContain('erheblichen Teil des Bestands');
  });
  it('Sanierung: Einsparung, Quote und Einordnung', () => {
    const t = text(gbTextVeraenderung(a));
    expect(t).toContain('Energetische Sanierung: 1 Gebäude wird im Jahr 2032 saniert');
    expect(t).toContain('sinkt dadurch um 60 MWh pro Jahr');
    expect(t).toContain('im Mittel 40 % je Gebäude');
    expect(t).toContain('Sanierungsquote von');
    // 1 von 4 Gebäuden in 10 Jahren (2026–2035) → 2,5 %/a: deutlich über üblich
    expect(t).toContain('deutlich über der in Deutschland derzeit üblichen Größenordnung');
    const viele = Array.from({ length: 200 }, (_, k) => ({ ...C, id: 400 + k, name: `S${k}`, sanierungen: k < 1 ? [{ jahr: 2032, zielSpez: 100 }] : [] }));
    expect(text(gbTextVeraenderung(auswerten(viele)))).toContain('unter der in Deutschland derzeit üblichen Größenordnung');
    const mittel = Array.from({ length: 12 }, (_, k) => ({ ...C, id: 500 + k, name: `M${k}`, sanierungen: k < 1 ? [{ jahr: 2035, zielSpez: 100 }] : [] }));
    expect(text(gbTextVeraenderung(auswerten(mittel)))).toContain('in der in Deutschland derzeit üblichen Größenordnung');
  });
  it('Bilanz mit Aufteilung in Neubau, Abriss und Sanierung', () => {
    const t = text(gbTextVeraenderung(a));
    expect(t).toContain('sinkt der Wärmebedarf bis 2035 um 150 MWh pro Jahr');
    expect(t).toContain('Neubau +110 MWh');
    expect(t).toContain('Abriss −200 MWh');
    expect(t).toContain('Sanierung −60 MWh');
    expect(t).toContain('Kapitel 1.3.3');
  });
  it('reiner Neubau: besteht nur aus Neubauten', () => {
    const t = text(gbTextVeraenderung(auswerten([D, E])));
    expect(t).toContain('ausschließlich aus Neubauten');
    expect(t).toContain('Neubau: 2 Gebäude werden zwischen 2030 und 2033 errichtet');
    expect(t).not.toContain('Abriss');
  });
});

describe('Texte: 1.3.3 Entwicklung', () => {
  const verlauf = (heizlasten, bedarf) => ({
    stichjahr: 2026, jahre: heizlasten.map((h, i) => ({ jahr: 2025 + i, bedarfMwh: bedarf[i], heizlastKw: h, spezKwhM2: 100 - i * 5, spezWM2: 50 })),
  });
  it('ohne Veränderungen: konstant, keine Entwicklung', () => {
    expect(text(gbTextEntwicklung(auswerten([A, B, C].map(g => ({ ...g, sanierungen: [], abrissjahr: '' })))))).toContain('Eine zeitliche Entwicklung ist nicht darzustellen');
    expect(text(gbTextEntwicklung({ jahre: [] }))).toContain('keine Gebäudedaten');
  });
  it('Bedarf, Heizlast und spezifische Werte mit Veränderung in Prozent', () => {
    const t = text(gbTextEntwicklung(auswerten(alle)));
    expect(t).toContain('Der Wärmebedarf der Liegenschaft sinkt von 975 MWh/a im Ist-Zustand (2025) auf 825 MWh/a im Jahr 2035 (−15,4 %)');
    expect(t).toContain('Die Summe der Einzelheizlasten');
    expect(t).toContain('flächengewichtete spezifische Wärmebedarf sinkt');
    expect(t).toContain('Treiber sind die energetische Sanierung');
  });
  it('Heizlast steigt: Auslegung auf den späteren Bedarf oder modular', () => {
    const t = text(gbTextEntwicklung(verlauf([100, 120, 150, 180], [500, 600, 700, 800])));
    expect(t).toContain('steigt von 500 MWh/a im Ist-Zustand (2025) auf 800 MWh/a im Jahr 2028 (+60,0 %)');
    expect(t).toContain('wächst bis 2028 auf das 1,80-Fache');
    expect(t).toContain('modular und stufenweise auszubauen');
  });
  it('Heizlast steigt zunächst und sinkt danach: Maximum maßgebend', () => {
    const t = text(gbTextEntwicklung(verlauf([100, 140, 150, 110], [500, 650, 700, 550])));
    expect(t).toContain('steigt zunächst bis 2027 auf 150 kW');
    expect(t).toContain('Zwischenzeitlich erreicht er im Jahr 2027 mit 700 MWh/a sein Maximum');
    expect(t).toContain('Maßgebend für die Auslegung ist das Maximum im Jahr 2027');
  });
  it('Heizlast sinkt deutlich, moderat oder bleibt konstant', () => {
    expect(text(gbTextEntwicklung(verlauf([100, 90, 70], [500, 450, 350])))).toContain('dauerhaft überdimensionierten Anlage');
    expect(text(gbTextEntwicklung(verlauf([100, 95, 90], [500, 480, 450])))).toContain('sinkt moderat um 10 %');
    expect(text(gbTextEntwicklung(verlauf([100, 101, 102], [500, 505, 510])))).toContain('nahezu konstant');
    expect(text(gbTextEntwicklung(verlauf([100, 108, 112], [500, 540, 560])))).toContain('steigt moderat um 12 %');
  });
  it('Zwischenspitze trotz gleichem Endwert wird genannt', () => {
    const t = text(gbTextEntwicklung(verlauf([100, 114, 112, 101], [500, 560, 550, 505])));
    expect(t).toContain('nahezu auf dem heutigen Wert, steigt aber zwischenzeitlich bis 2026 auf 114 kW (14 % über dem Ist-Wert)');
    expect(t).not.toContain('nahezu konstant');
  });
  it('Heizlast und Bedarf entwickeln sich unterschiedlich stark', () => {
    expect(text(gbTextEntwicklung(verlauf([100, 90, 80], [500, 480, 460])))).toContain('Heizlast steigt schwächer bzw. sinkt stärker');
  });
  it('reiner Neubau: Bedarf entsteht erst später', () => {
    const t = text(gbTextEntwicklung(auswerten([D, E])));
    expect(t).toContain('besteht kein Wärmebedarf');
    expect(t).toContain('erreicht im Jahr 2033 110 MWh/a');
  });
  it('nennt das Auslegungsjahr und die Annahmen', () => {
    const t = text(gbTextEntwicklung(auswerten(alle), { lastgangJahr: 2040 }));
    expect(t).toContain('Für den Soll-Lastgang in Kapitel 2.2 ist das Jahr 2040 maßgebend');
    expect(t).toContain('Klimawandel');
  });
});

describe('Alle Texte: keine ungültigen Zahlen', () => {
  const szenarien = [[], [A], [D], alle, [A, { ...B, flaeche: '' }], [{ ...A, baujahr: '', waerme: '' }], [D, E], [C]];
  for (const [i, s] of szenarien.entries()) {
    it(`Szenario ${i}`, () => {
      const a = auswerten(s);
      for (const t of [gbTextBestand(a), gbTextVeraenderung(a), gbTextEntwicklung(a)]) {
        const k = text(t);
        expect(k).not.toMatch(/NaN|undefined|Infinity|\[object/);
        expect(k.length).toBeGreaterThan(20);
      }
    });
  }
});

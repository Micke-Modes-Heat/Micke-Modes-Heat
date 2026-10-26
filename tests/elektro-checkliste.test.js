import { describe, expect, it } from 'vitest';
import { EC_PHASEN, EC_PUNKTE, ecPassend, ecOrtMarken, ecNormalisieren, ecZaehle, ecNaechste, ecKapitelHinweise,
  ecAdressat, ecRueckfragen, ecRueckfragenText, ecRueckfragenCsv, ecUebersicht } from '../src/lib/elektro-checkliste.js';

describe('Elektro-Checkliste', () => {
  it('hat eindeutige ids und jede Aufgabe eine Stelle im Tool', () => {
    const ids = EC_PUNKTE.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EC_PHASEN.length).toBeGreaterThan(10);
    for (const p of EC_PUNKTE) expect(p.orte?.length, p.id).toBeGreaterThan(0);
  });

  it('leitet Marken aus der Stelle ab', () => {
    expect(ecOrtMarken({ schritt: 'planung', sparte: 'strom', elTab: 'netz', panels: ['engpass-panel'], assetTyp: 'NAP' }))
      .toEqual(['s:planung', 'el:netz', 'p:engpass-panel', 'x:NAP']);
    expect(ecOrtMarken({ schritt: 'auswertung', abschnitt: 'nap', elTab: 'netz' })).toEqual(['s:auswertung', 'a:nap']);
    expect(ecOrtMarken({ schritt: 'bestand', bestandAnsicht: 'tabelle' })).toEqual(['s:bestand', 'b:tabelle']);
  });

  it('zeigt bei offenem Fenster dessen Aufgaben statt der des Reiters', () => {
    const reiter = ecPassend(['s:planung', 'el:pruefen']);
    expect(reiter.punkte.map(p => p.id)).toEqual(expect.arrayContaining(['r-netzanalyse', 'r-engpass']));
    const fenster = ecPassend(['s:planung', 'el:pruefen', 'p:engpass-panel']);
    expect(fenster.punkte.map(p => p.id)).toEqual(['r-engpass']);
    expect(ecPassend(['s:irgendwo']).punkte).toEqual([]);
  });

  it('normalisiert, zählt und findet die nächste Aufgabe', () => {
    const stand = ecNormalisieren({ punkte: { 'u-plan': { s: 'erledigt', n: 'liegt vor' }, 'u-lastgang': { s: 'quatsch' }, x: null } });
    expect(stand.punkte['u-plan']).toEqual({ s: 'erledigt', n: 'liegt vor' });
    expect(stand.punkte['u-lastgang']).toBeUndefined();   // ungültiger Status ohne Notiz = offen = nicht gespeichert
    const ph = EC_PHASEN[0];
    expect(ecZaehle(stand, ph.punkte).fertig).toBe(1);
    expect(ecNaechste(stand).id).toBe('u-lastgang');
    expect(ecNormalisieren(null)).toEqual({ v: 1, punkte: {} });
  });
});

describe('Kapitelstand im Gutachten', () => {
  const K = (nr, titel, ebene, texte = 0, figuren = 0, bilder = 0) => ({ nr, titel, ebene, texte, figuren, bilder });
  const stand = { stationsAnlagen: 1, kapitel: [
    K('4', 'Potenzialanalyse', 1, 1),
    K('5', 'Elektrotechnik', 1),
    K('5.1', 'Ist-Zustand', 2), K('5.1.1', 'Liegenschaftsstromnetzanschluss', 3, 1, 1), K('5.1.2', 'Stromnetz intern (MS/NS)', 3, 0, 2),
    K('5.2', 'Stromverbrauchsdaten', 2),
    K('5.6', 'Bewertungsmatrix', 2, 0, 1),
    K('9', 'Fazit, Maßnahmenfahrplan', 1), K('9.1', 'Wärmeversorgung', 2, 1), K('9.2', 'Elektrotechnik', 2, 0, 0, 1),
  ] };

  it('fasst Kapitel 5 zusammen und nennt leere Unterkapitel', () => {
    const h = ecKapitelHinweise(stand);
    expect(h['z-editor'].stufe).toBe('offen');
    expect(h['z-editor'].text).toContain('3 von 4 Unterkapiteln');
    expect(h['z-editor'].text).toContain('leer: 5.2');
    expect(h['z-editor'].text).toContain('2 nur mit Bausteinen');
  });

  it('findet Einzelkapitel über den Titelpfad, nicht über Gleichnamige', () => {
    const h = ecKapitelHinweise(stand);
    expect(h['b-matrix']).toEqual({ stufe: 'ok', text: 'Kap. 5.6: 1 Baustein/Abbildung — kein eigener Text' });
    expect(h['z-fazit'].text).toBe('Kap. 9.2: 1 Bild — kein eigener Text');   // nicht Kapitel 5 „Elektrotechnik“
    expect(h['ga-ziele'].stufe).toBe('leer');                              // Kapitel fehlt im Dokument
    expect(h['z-bilder'].stufe).toBe('ok');
    expect(ecKapitelHinweise(null)).toEqual({});
  });
});

describe('Rückfragen und Übersicht', () => {
  const stand = ecNormalisieren({ punkte: {
    'u-vertrag': { s: 'klaeren', n: 'Wie hoch ist die vereinbarte Leistung?\nGilt ein Einspeiselimit?' },
    'u-plan': { s: 'klaeren', n: '', a: 'auftraggeber' },
    'r-kosten': { s: 'klaeren', n: 'Preisstand 2026; welche Quelle?' },
    'u-lastgang': { s: 'erledigt', n: '', a: 'quatsch' },
  } });

  it('gruppiert nach Adressat mit Vorgabe und eigener Wahl', () => {
    const g = ecRueckfragen(stand);
    expect(g.map(x => x.id)).toEqual(['netzbetreiber', 'auftraggeber', 'intern']);
    expect(g[0].eintraege[0].id).toBe('u-vertrag');
    expect(stand.punkte['u-lastgang'].a).toBeUndefined();   // ungültiger Adressat fällt weg
    expect(ecAdressat(stand, EC_PUNKTE.find(p => p.id === 'u-plan'))).toBe('auftraggeber');
  });

  it('erzeugt Text und CSV', () => {
    const g = ecRueckfragen(stand);
    const text = ecRueckfragenText(g, 'Lindenhof', Date.UTC(2026, 9, 26, 12));
    expect(text).toContain('Rückfragen Elektrotechnik – Lindenhof');
    expect(text).toContain('An: Netzbetreiber');
    expect(text).toContain('   Frage: Wie hoch ist die vereinbarte Leistung?\n   Gilt ein Einspeiselimit?');
    const csv = ecRueckfragenCsv(g);
    expect(csv.split('\r\n')[0]).toBe('Adressat;Phase;Aufgabe;Kapitel;Frage / Notiz;Stand');
    expect(csv).toContain('"Wie hoch ist die vereinbarte Leistung?\nGilt ein Einspeiselimit?"');
    expect(csv).toContain('Preisstand 2026');
  });

  it('fasst den Stand für die Projektseite zusammen', () => {
    const u = ecUebersicht(stand, { 'u-plan': { stufe: 'offen' }, 'u-lastgang': { stufe: 'offen' } });
    expect(u.klaeren).toBe(3);
    expect(u.fertig).toBe(1);
    expect(u.phasen[0]).toMatchObject({ id: 'unterlagen', fertig: 1, toolOffen: 1, begonnen: true });   // erledigte zählen nicht als offen
    expect(u.naechste.id).toBe('u-plan');
  });
});

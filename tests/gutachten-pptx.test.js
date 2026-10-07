// Vitest-Tests für lib/gutachten-pptx.js — Paketaufbau und Stichpunkte.
import { describe, it, expect } from 'vitest';
import { gpxErzeugePaket, gpxStichpunkte } from '../src/lib/gutachten-pptx.js';

describe('PowerPoint-Paket', () => {
  const folien = [
    { art: 'titel', titel: 'Zukünftige Energieversorgung', untertitel: 'Musterkaserne', zeilen: ['Ort', 'Stand'] },
    { art: 'kapitel', nr: '3', titel: 'Wärmeversorgung' },
    { art: 'inhalt', nr: '3.2', titel: 'Verbrauch', unter: 'Abbildung', punkte: ['A & B < C'], bild: { daten: new Uint8Array([1, 2, 3]), breite: 1200, hoehe: 800 } },
    { art: 'punkte', nr: '3.3', titel: 'Netz', punkte: ['Eins', 'Zwei'] },
  ];
  const teile = gpxErzeugePaket(folien, { titel: 'T', fusszeile: 'LKEBw', logo: 'iVBORw0KGgo=' });
  const pfade = teile.map(t => t.pfad);
  it('enthält alle Pflichtteile und je Folie Inhalt und Beziehungen', () => {
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'docProps/core.xml']) expect(pfade).toContain(p);
    for (let i = 1; i <= 4; i++) { expect(pfade).toContain(`ppt/slides/slide${i}.xml`); expect(pfade).toContain(`ppt/slides/_rels/slide${i}.xml.rels`); }
    expect(pfade.filter(p => p.startsWith('ppt/media/'))).toHaveLength(2);   // Logo + eine Abbildung
    const ct = teile.find(t => t.pfad === '[Content_Types].xml').inhalt;
    expect(ct.match(/slide\+xml/g)).toHaveLength(4);
  });
  it('maskiert Text und verknüpft Bilder', () => {
    const f3 = teile.find(t => t.pfad === 'ppt/slides/slide3.xml').inhalt;
    expect(f3).toContain('A &amp; B &lt; C');
    expect(f3).toContain('r:embed="rIdBild"');
    expect(teile.find(t => t.pfad === 'ppt/slides/_rels/slide3.xml.rels').inhalt).toContain('../media/bild2.png');
    expect(teile.find(t => t.pfad === 'ppt/media/bild1.png').base64).toBe(true);
  });
});

describe('Stichpunkte', () => {
  it('bevorzugt Sätze mit Zahlen, lässt Lücken und Querverweise weg', () => {
    const p = gpxStichpunkte([
      [{ text: 'Einleitender Satz ohne jede Zahl darin. Der Bedarf beträgt 4.200 MWh/a (vgl. Kapitel 3.2). Der Zeitraum beträgt ', offen: false }, { text: '[Jahre]', offen: true }, { text: ' Jahre.', offen: false }],
      [{ text: '• Die Spitzenlast liegt bei 2,1 MW.', offen: false }],
    ]);
    expect(p).toEqual(['Der Bedarf beträgt 4.200 MWh/a', 'Die Spitzenlast liegt bei 2,1 MW']);
  });
});

describe('Stichpunkte: Abkürzungen und Länge', () => {
  it('trennt nicht nach „bzw.“, „z. B.“ oder Datumsangaben und kürzt lange Sätze', () => {
    const p = gpxStichpunkte([[{ text: 'Sein Wärmebedarf beträgt 990 MWh pro Jahr bzw. 138 kWh/(m²·a), z. B. nach der Bekanntmachung vom 15. April 2021. '
      + 'Die Anlage hat 3 Kessel mit zusammen 2,4 MW und einer sehr langen Beschreibung, die weit über die zulässige Länge einer Folienzeile hinausgeht und daher gekürzt werden muss, damit sie passt.', offen: false }]]);
    expect(p[0]).toBe('Sein Wärmebedarf beträgt 990 MWh pro Jahr bzw. 138 kWh/(m²·a), z. B. nach der Bekanntmachung vom 15. April 2021');
    expect(p[1].length).toBeLessThanOrEqual(150);
    expect(p[1].endsWith(' …')).toBe(true);
  });
});

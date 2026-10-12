// Vitest-Tests für lib/lade-status.js
import { describe, it, expect } from 'vitest';
import { lsPlan, lsSetze, lsAktiv, lsGebietStand, lsRestUeberspringen, lsZusammenfassung, lsFlaecheM2, lsDauerText } from '../src/lib/lade-status.js';

const M = 111320, LAT = 49, LNG = 8.4, KX = M * Math.cos(LAT * Math.PI / 180);
const ring = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => ({ lat: LAT + y / M, lng: LNG + x / KX }));
const plan = (o = {}) => lsPlan({ gebiet: { ring: ring(100, 100) }, bl: 'bw', kataster: true, optionen: {}, ...o });
const zustand = (s, id) => s.find(x => x.id === id).zustand;

describe('lsFlaecheM2 / lsDauerText', () => {
  it('rechnet die Fläche eines Rings in m²', () => {
    expect(Math.abs(lsFlaecheM2(ring(100, 50)) - 5000)).toBeLessThan(25);   // Kugel vs. 111,32 km/°
    expect(lsFlaecheM2(null)).toBe(0);
  });
  it('formatiert Dauern', () => {
    expect(lsDauerText(8400)).toBe('8 s');
    expect(lsDauerText(65000)).toBe('1:05 min');
  });
});

describe('lsGebietStand', () => {
  it('unterscheidet offen, zeichnen und fertig', () => {
    expect(lsGebietStand({}).zustand).toBe('offen');
    expect(lsGebietStand({ zeichnet: true, punkte: 2 })).toMatchObject({ zustand: 'laeuft', info: expect.stringContaining('mindestens 3') });
    expect(lsGebietStand({ ring: ring(200, 100) })).toMatchObject({ zustand: 'fertig', info: '4 Eckpunkte · 2 ha' });
  });
});

describe('lsPlan', () => {
  it('stellt zehn Schritte auf; nicht gewählte Zusätze sind übersprungen', () => {
    const s = plan();
    expect(s.map(x => x.id)).toEqual(['gebiet', 'kataster', 'osm', 'klein', 'baujahr', 'einfuegen', 'dachform', 'dach', 'strassen', 'baeume']);
    expect(zustand(s, 'gebiet')).toBe('fertig');
    expect(zustand(s, 'kataster')).toBe('offen');
    expect(zustand(s, 'baujahr')).toBe('uebersprungen');     // BW: keine Baujahr-Quelle
    expect(zustand(s, 'dach')).toBe('uebersprungen');
    expect(s.find(x => x.id === 'dach').info).toBe('Nicht gewählt');
  });
  it('Bayern: kein Kataster, OSM direkt; Baujahrquelle in NRW', () => {
    const by = plan({ bl: 'by', kataster: false });
    expect(zustand(by, 'kataster')).toBe('uebersprungen');
    expect(by.find(x => x.id === 'kataster').info).toContain('Bayern');
    const nw = plan({ bl: 'nw', optionen: { strassen: true, sparte: 'beide', baeume: true } });
    expect(zustand(nw, 'baujahr')).toBe('offen');
    expect(nw.find(x => x.id === 'strassen').titel).toContain('Wärme + Elektro');
    expect(zustand(nw, 'baeume')).toBe('offen');
  });
  it('ohne Plangebiet wird der Kartenausschnitt geladen', () => {
    const s = plan({ gebiet: {} });
    expect(zustand(s, 'gebiet')).toBe('uebersprungen');
    expect(s[0].info).toContain('Kartenausschnitt');
  });
});

describe('lsSetze / Zusammenfassung', () => {
  it('führt Zeiten und den aktiven Schritt', () => {
    const s = plan();
    lsSetze(s, 'kataster', 'laeuft', 'Anfrage', 1000);
    expect(lsAktiv(s).id).toBe('kataster');
    expect(lsZusammenfassung(s).phase).toBe('laeuft');
    lsSetze(s, 'kataster', 'fertig', '120 Grundrisse', 4000);
    const k = s.find(x => x.id === 'kataster');
    expect([k.start, k.ende, k.info]).toEqual([1000, 4000, '120 Grundrisse']);
    expect(lsAktiv(s)).toBeNull();
  });
  it('ein Fehler wird nicht von einem späteren fertig/leer überschrieben', () => {
    const s = plan();
    lsSetze(s, 'dachform', 'laeuft');
    lsSetze(s, 'dachform', 'fehler', 'OSM nicht erreichbar');
    lsSetze(s, 'dachform', 'leer', 'Keine Dachangaben');
    expect(s.find(x => x.id === 'dachform')).toMatchObject({ zustand: 'fehler', info: 'OSM nicht erreichbar' });
    lsSetze(s, 'dachform', 'laeuft');
    expect(zustand(s, 'dachform')).toBe('laeuft');
  });
  it('übersprungene Schritte bleiben im Lauf übersprungen', () => {
    const s = plan();                                    // BW: Baujahr übersprungen
    lsSetze(s, 'baujahr', 'laeuft');
    lsSetze(s, 'baujahr', 'leer', 'Keine Angaben');
    expect(s.find(x => x.id === 'baujahr')).toMatchObject({ zustand: 'uebersprungen', start: null });
  });
  it('Rest überspringen beendet den Lauf; Fehler bestimmen die Phase', () => {
    const s = plan();
    lsSetze(s, 'kataster', 'laeuft');
    lsSetze(s, 'kataster', 'fehler', 'x');
    expect(lsZusammenfassung(s).phase).toBe('bereit');
    lsRestUeberspringen(s, 'Abgebrochen');
    const z = lsZusammenfassung(s);
    expect(z.phase).toBe('fehler');
    expect(z.offen).toBe(0);
    expect(z.gesamt).toBe(2);   // Plangebiet + Kataster; Übersprungenes zählt nicht
  });
});

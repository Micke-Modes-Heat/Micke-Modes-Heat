// Vitest-Tests für lib/gutachten-fragen.js und die vom Fragebogen gesteuerten Texte.
import { describe, it, expect } from 'vitest';
import { GF_FRAGEN, gfAntwort, gfNormalisieren, gfQuoten, gfFragenZuKapitel } from '../src/lib/gutachten-fragen.js';
import { ptTextBeruecksichtigt, ptTextNicht, ptTextNichtTechnik } from '../src/lib/gutachten-potenzial.js';
import { gbTextEgb } from '../src/lib/gutachten-gebaeude.js';
import { lgTextSpitzenlast } from '../src/lib/gutachten-lastgang.js';
import { faTextNt } from '../src/lib/gutachten-fazit.js';
import { gdNormalisieren, gdKapitelNummern, GUTACHTEN_STANDARD_GLIEDERUNG } from '../src/lib/gutachten-dokument.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = b => wtKlartext(b);

describe('Fragebogen', () => {
  it('jede Frage gehört zu einem Kapitel der Standardgliederung', () => {
    const nr = new Set(gdKapitelNummern(GUTACHTEN_STANDARD_GLIEDERUNG));
    for (const f of GF_FRAGEN) expect(nr.has(f.kapitel)).toBe(true);
    expect(gfFragenZuKapitel('4').length).toBeGreaterThan(5);
  });
  it('Vorgaben hängen vom Projekt ab; Eisspeicher nur mit Variante', () => {
    expect(gfAntwort({}, 'pot-eis', { inVariante: {} })).toBe('weglassen');
    expect(gfAntwort({}, 'pot-eis', { inVariante: { eis: true } })).toBe('vertieft');
    expect(gfAntwort({ 'pot-eis': 'nicht' }, 'pot-eis', {})).toBe('nicht');
    expect(gfAntwort({ empfehlung: 'V9' }, 'empfehlung', { varianten: ['V1'] })).toBe('auto');   // gelöschte Variante → Vorgabe
    expect(gfAntwort({ empfehlung: 'V1' }, 'empfehlung', { varianten: ['V1'] })).toBe('V1');
  });
  it('Normalisierung und Deckungsgrade', () => {
    expect(gfNormalisieren({ egb: '55', unbekannt: 1, 'pot-nicht': ['wind', 'quatsch'], 'lwwp-quoten': '' })).toEqual({ egb: '55', 'pot-nicht': ['wind'] });
    expect(gfQuoten('90; 65, 100,100, 0, x')).toEqual([65, 90, 100]);
    expect(gfQuoten('')).toEqual([65, 90, 99, 100]);
  });
  it('Dokument behält Antworten und Platzhalter', () => {
    const d = gdNormalisieren({ kapitel: [], fragen: { egb: '40', x: 1 }, platzhalter: { 'Reserve in %': ' 10 ', leer: '' } });
    expect(d.fragen).toEqual({ egb: '40' });
    expect(d.platzhalter).toEqual({ 'Reserve in %': '10' });
  });
});

describe('Texte nach Fragebogen', () => {
  it('Potenziale: Einleitung nennt nur gewählte Techniken', () => {
    const t = text(ptTextBeruecksichtigt({ vertieft: ['Umweltwärme aus der Außenluft'], kurz: ['feste Biomasse'] }));
    expect(t).toContain('Umweltwärme aus der Außenluft, feste Biomasse und Photovoltaik');
    expect(t).toContain('Im Folgenden werden Umweltwärme aus der Außenluft genauer betrachtet');
    expect(t).toContain('Feste Biomasse wird nicht gesondert beschrieben');
    expect(t).not.toContain('Eisspeicher');
    expect(text(ptTextBeruecksichtigt({ vertieft: ['X'], zsb: false }))).toContain('Fossile Energieträger sind nicht Bestandteil');
  });
  it('4.1: Technik mit Begründungsplatzhalter, Fernwärme-Varianten, Zweistoffbrenner abschaltbar', () => {
    const t = text(ptTextNichtTechnik('eis'));
    expect(t.startsWith('## Eisspeicher')).toBe(true);
    expect(t).toContain('[Begründung');
    expect(text(ptTextNicht('fernwaerme', { fernwaerme: 'anfrage' }))).toContain('Anfrage beim Betreiber');
    expect(text(ptTextNicht('fernwaerme', { fernwaerme: 'unwirtschaftlich' }))).toContain('wirtschaftlich nicht darstellbar');
    expect(text(ptTextNicht('gasGrundlast', { zsb: false }))).not.toContain('Zweistoffbrenner');
  });
  it('EGB nach EEFB', () => {
    const a = { anzahl: { neubau: 2, saniert: 1 } };
    const t = text(gbTextEgb(a, 'auto'));
    expect(t).toContain('EEFB, Kabinettbeschluss vom 25.08.2021');
    expect(t).toContain('die 2 Neubauten als EGB 40 und die 1 Sanierung als EGB 55');
    expect(text(gbTextEgb(a, '55'))).toContain('Neubauten als EGB 55');
    expect(gbTextEgb(a, 'keiner')).toEqual([]);
    expect(gbTextEgb({ anzahl: { neubau: 0, saniert: 0 } })).toEqual([]);
  });
  it('Leistungsreserve und NT kurz', () => {
    const lg = Float32Array.from({ length: 8760 }, (_, h) => (h === 100 ? 1000 : 300));
    const tageT = Array.from({ length: 365 }, () => 5);
    expect(text(lgTextSpitzenlast({ lastgangKw: lg, tageT, normAtC: -12, reserve: '20', bestandThermKw: 2000 }))).toContain('Leistungsreserve von 20 %');
    expect(text(lgTextSpitzenlast({ lastgangKw: lg, tageT, normAtC: -12, reserve: 'nein', auffaelligeNutzung: 'Kaserne' }))).not.toContain('Leistungsreserve');
    const nt = faTextNt({ kurz: true, vlHtC: 80, vlNtC: 50 });
    expect(nt).toHaveLength(1);
    expect(text(nt)).toContain('von heute rund 80 °C auf überwiegend rund 50 °C');
  });
});

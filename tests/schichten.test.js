// Vitest-Tests für lib/schichten.js — Planungsschichten, Vererbung, Rückfüllung.
// schichten.js ist importfrei/DOM-frei → direkt als ESM importierbar.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SCHICHT, SCHICHT_META, SCHICHT_REIHENFOLGE, istSchicht, normSchicht, schichtRang,
  schichtAusEndpunkten, schichtBackfill,
  getAktiveSchicht, setAktiveSchicht,
  schichtSichtbar, setSchichtSichtbar, getSichtbareSchichten,
} from '../src/lib/schichten.js';

describe('Schicht-Konstanten', () => {
  it('hat für jede Schicht Metadaten und einen Rang', () => {
    for (const s of SCHICHT_REIHENFOLGE) {
      expect(SCHICHT_META[s]).toBeTruthy();
      expect(SCHICHT_META[s].label).toBeTruthy();
      expect(Number.isFinite(schichtRang(s))).toBe(true);
    }
  });

  it('ordnet die Schichten von Bestand nach Entscheidung', () => {
    expect(schichtRang(SCHICHT.BESTAND)).toBeLessThan(schichtRang(SCHICHT.ENTWICKLUNG));
    expect(schichtRang(SCHICHT.ENTWICKLUNG)).toBeLessThan(schichtRang(SCHICHT.ENTSCHEIDUNG));
  });
});

describe('normSchicht / istSchicht', () => {
  it('erkennt gültige Schichten', () => {
    expect(istSchicht('bestand')).toBe(true);
    expect(istSchicht('entwicklung')).toBe(true);
    expect(istSchicht('entscheidung')).toBe(true);
  });

  it('weist alles Unbekannte zurück, statt es durchzulassen', () => {
    expect(istSchicht('planung')).toBe(false);
    expect(istSchicht(null)).toBe(false);
    expect(istSchicht(undefined)).toBe(false);
    expect(istSchicht('')).toBe(false);
  });

  it('fällt für Unbekanntes auf Bestand zurück — den neutralen Zustand', () => {
    expect(normSchicht(undefined)).toBe(SCHICHT.BESTAND);
    expect(normSchicht('quatsch')).toBe(SCHICHT.BESTAND);
    expect(normSchicht(SCHICHT.ENTWICKLUNG)).toBe(SCHICHT.ENTWICKLUNG);
  });
});

describe('schichtAusEndpunkten', () => {
  it('gibt bei gleichen Endpunkten deren Schicht zurück', () => {
    expect(schichtAusEndpunkten(SCHICHT.BESTAND, SCHICHT.BESTAND)).toBe(SCHICHT.BESTAND);
    expect(schichtAusEndpunkten(SCHICHT.ENTWICKLUNG, SCHICHT.ENTWICKLUNG)).toBe(SCHICHT.ENTWICKLUNG);
  });

  it('lässt die spätere Schicht gewinnen — Kabel zum Neubau ist Entwicklung', () => {
    expect(schichtAusEndpunkten(SCHICHT.BESTAND, SCHICHT.ENTWICKLUNG)).toBe(SCHICHT.ENTWICKLUNG);
    expect(schichtAusEndpunkten(SCHICHT.ENTWICKLUNG, SCHICHT.BESTAND)).toBe(SCHICHT.ENTWICKLUNG);
  });

  it('ist unabhängig von der Reihenfolge der Endpunkte', () => {
    const paare = [
      [SCHICHT.BESTAND, SCHICHT.ENTSCHEIDUNG],
      [SCHICHT.ENTWICKLUNG, SCHICHT.ENTSCHEIDUNG],
    ];
    for (const [a, b] of paare) {
      expect(schichtAusEndpunkten(a, b)).toBe(schichtAusEndpunkten(b, a));
    }
  });

  it('behandelt fehlende Endpunkt-Schichten als Bestand', () => {
    expect(schichtAusEndpunkten(null, undefined)).toBe(SCHICHT.BESTAND);
    expect(schichtAusEndpunkten(null, SCHICHT.ENTSCHEIDUNG)).toBe(SCHICHT.ENTSCHEIDUNG);
  });
});

describe('schichtBackfill', () => {
  it('behält eine bereits gesetzte Schicht unverändert bei', () => {
    expect(schichtBackfill({ schicht: SCHICHT.ENTSCHEIDUNG, baujahr: 1980 }, 2026))
      .toBe(SCHICHT.ENTSCHEIDUNG);
  });

  it('stuft Objekte ohne Baujahr als Bestand ein', () => {
    expect(schichtBackfill({}, 2026)).toBe(SCHICHT.BESTAND);
    expect(schichtBackfill({ baujahr: null }, 2026)).toBe(SCHICHT.BESTAND);
  });

  it('stuft Vergangenheit und laufendes Jahr als Bestand ein', () => {
    expect(schichtBackfill({ baujahr: 1985 }, 2026)).toBe(SCHICHT.BESTAND);
    expect(schichtBackfill({ baujahr: 2026 }, 2026)).toBe(SCHICHT.BESTAND);
  });

  it('stuft Zukunft als Entwicklung ein — nie als Entscheidung', () => {
    expect(schichtBackfill({ baujahr: 2030 }, 2026)).toBe(SCHICHT.ENTWICKLUNG);
    expect(schichtBackfill({ baujahr: '2030' }, 2026)).toBe(SCHICHT.ENTWICKLUNG);
  });

  it('verträgt null/undefined als Objekt', () => {
    expect(schichtBackfill(null, 2026)).toBe(SCHICHT.BESTAND);
    expect(schichtBackfill(undefined, 2026)).toBe(SCHICHT.BESTAND);
  });
});

describe('Aktiver Eingabemodus', () => {
  beforeEach(() => setAktiveSchicht(SCHICHT.BESTAND));

  it('startet im Bestandsmodus', () => {
    expect(getAktiveSchicht()).toBe(SCHICHT.BESTAND);
  });

  it('übernimmt einen gültigen Moduswechsel', () => {
    setAktiveSchicht(SCHICHT.ENTWICKLUNG);
    expect(getAktiveSchicht()).toBe(SCHICHT.ENTWICKLUNG);
  });

  it('fällt bei ungültigem Wert auf Bestand zurück, statt den Modus zu verlieren', () => {
    setAktiveSchicht('quatsch');
    expect(getAktiveSchicht()).toBe(SCHICHT.BESTAND);
  });
});

describe('Sichtbarkeit', () => {
  beforeEach(() => SCHICHT_REIHENFOLGE.forEach(s => setSchichtSichtbar(s, true)));

  it('zeigt anfangs alle Schichten', () => {
    expect(getSichtbareSchichten().size).toBe(SCHICHT_REIHENFOLGE.length);
    SCHICHT_REIHENFOLGE.forEach(s => expect(schichtSichtbar(s)).toBe(true));
  });

  it('blendet einzelne Schichten aus und wieder ein', () => {
    setSchichtSichtbar(SCHICHT.ENTWICKLUNG, false);
    expect(schichtSichtbar(SCHICHT.ENTWICKLUNG)).toBe(false);
    expect(schichtSichtbar(SCHICHT.BESTAND)).toBe(true);
    setSchichtSichtbar(SCHICHT.ENTWICKLUNG, true);
    expect(schichtSichtbar(SCHICHT.ENTWICKLUNG)).toBe(true);
  });

  it('behandelt Objekte ohne Schicht wie Bestand', () => {
    setSchichtSichtbar(SCHICHT.BESTAND, false);
    expect(schichtSichtbar(undefined)).toBe(false);
    setSchichtSichtbar(SCHICHT.BESTAND, true);
    expect(schichtSichtbar(undefined)).toBe(true);
  });

  it('gibt eine Kopie zurück — die Menge darf nicht von außen verändert werden', () => {
    getSichtbareSchichten().clear();
    expect(getSichtbareSchichten().size).toBe(SCHICHT_REIHENFOLGE.length);
  });
});

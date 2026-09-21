// Rechenkern der landesrechtlichen PV-Pflicht (lib/pv-pflicht.js) und die
// Datentabelle dahinter (config/pv-pflicht-laender.js).
//
// Der wichtigste Test ist der auf die Lücken: wo ein Land keinen Flächenanteil
// nennt, darf die Rechnung KEINE Zahl erfinden.
import { describe, expect, it } from 'vitest';
import {
  EIGNUNG_PAUSCHAL_PCT, PV_PFLICHT, PV_PFLICHT_LISTE, PV_PFLICHT_META,
} from '../src/config/pv-pflicht-laender.js';
import {
  bezugFlaechenName, dachflaecheBruttoM2, pflichtCheck, pflichtGebaeude, pflichtRegel,
  projiziereAufDachflaeche, pvPflichtSumme,
} from '../src/lib/pv-pflicht.js';
import { BUNDESLAND_BBOX, detectBundesland } from '../src/lib/bundeslaender.js';

const WP_PRO_M2 = 240;   // 450 Wp auf 1,1 × 1,7 m ≈ 240 W/m²

/** Neubau, 1.000 m² Grundfläche, Flachdach, Nichtwohngebäude. */
function neubau(over = {}) {
  return {
    id: 1, name: 'Halle', grundflaecheM2: 1000, dachNeigung: 0, wohnen: false,
    geeignetM2: 0, nutzflaecheM2: 1000, neubau: true, dachsanierung: false,
    sanAnteilPct: null, ...over,
  };
}

describe('Datentabelle der Länder', () => {
  it('kennt alle 16 Bundesländer, passend zu den Schlüsseln der Koordinatenzuordnung', () => {
    const ausBbox = new Set(BUNDESLAND_BBOX.map(b => b.id));
    expect(Object.keys(PV_PFLICHT)).toHaveLength(16);
    for (const id of Object.keys(PV_PFLICHT)) {
      expect(ausBbox.has(id), `${id} fehlt in BUNDESLAND_BBOX`).toBe(true);
    }
    for (const id of ausBbox) {
      expect(PV_PFLICHT[id], `${id} fehlt in PV_PFLICHT`).toBeDefined();
    }
  });

  it('führt genau die fünf Länder ohne Pflicht', () => {
    const ohne = Object.entries(PV_PFLICHT).filter(([, r]) => !r.pflicht).map(([id]) => id).sort();
    expect(ohne).toEqual(['mv', 'sl', 'sn', 'st', 'th']);
  });

  it('beschreibt jedes Pflicht-Land vollständig', () => {
    for (const [id, r] of Object.entries(PV_PFLICHT)) {
      if (!r.pflicht) continue;
      expect(r.norm, `${id} ohne Norm`).toBeTruthy();
      expect(['brutto', 'dach', 'geeignet'], `${id} Bezug`).toContain(r.bezug);
      expect(['gesetz', 'verordnung', 'unbestimmt'], `${id} Herkunft`).toContain(r.anteilHerkunft);
      expect(['alle', 'nichtwohn', 'landeseigen'], `${id} Geltung`).toContain(r.gilt);
      // Ein Prozentsatz darf nur dort stehen, wo er auch belegt ist.
      if (r.anteilHerkunft === 'unbestimmt') expect(r.anteilPct, `${id}`).toBeNull();
      else expect(r.anteilPct, `${id}`).toBeGreaterThan(0);
    }
  });

  it('trägt Stand und Haftungshinweis', () => {
    expect(PV_PFLICHT_META.stand).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PV_PFLICHT_META.disclaimer).toMatch(/keine Rechtsberatung/i);
  });

  it('liefert eine alphabetisch sortierte Auswahlliste', () => {
    expect(PV_PFLICHT_LISTE).toHaveLength(16);
    expect(PV_PFLICHT_LISTE[0].land).toBe('Baden-Württemberg');
    expect(PV_PFLICHT_LISTE.at(-1).land).toBe('Thüringen');
  });
});

describe('Bruttodachfläche', () => {
  it('Flachdach entspricht der Grundfläche', () => {
    expect(dachflaecheBruttoM2(1000, 0)).toBeCloseTo(1000, 6);
  });

  it('Satteldach projiziert mit 1/cos(Neigung)', () => {
    expect(dachflaecheBruttoM2(1000, 35)).toBeCloseTo(1000 / Math.cos(35 * Math.PI / 180), 3);
  });

  it('begrenzt unsinnige Neigungen und Flächen', () => {
    expect(dachflaecheBruttoM2(1000, 89)).toBeCloseTo(dachflaecheBruttoM2(1000, 75), 6);
    expect(dachflaecheBruttoM2(0, 35)).toBe(0);
    expect(dachflaecheBruttoM2(-5, 35)).toBe(0);
  });
});

describe('Projektion Grundriss → Dachhaut', () => {
  // Alle Flächen im Tool sind auf der Karte gemessen, also Grundriss. Für die
  // Länder mit Bezug „geeignete Dachfläche" zählt aber die Dachhaut.
  it('lässt eine waagerechte Fläche unverändert', () => {
    expect(projiziereAufDachflaeche(500, 0)).toBeCloseTo(500, 6);
  });

  it('vergrößert eine geneigte Fläche um 1/cos(Neigung)', () => {
    expect(projiziereAufDachflaeche(500, 35)).toBeCloseTo(500 / Math.cos(35 * Math.PI / 180), 6);
    expect(projiziereAufDachflaeche(500, 15)).toBeCloseTo(500 / Math.cos(15 * Math.PI / 180), 6);
  });

  it('ist dieselbe Rechnung wie die Bruttodachfläche', () => {
    expect(dachflaecheBruttoM2(1000, 35)).toBeCloseTo(projiziereAufDachflaeche(1000, 35), 6);
  });
});

describe('Bezugsfläche je Landesformulierung', () => {
  it('Brandenburg rechnet 50 % der Dachfläche', () => {
    const r = pflichtGebaeude(neubau(), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(true);
    expect(r.fall).toBe('neubau');
    expect(r.sollM2).toBeCloseTo(500, 6);
    expect(r.kwp).toBeCloseTo(500 * WP_PRO_M2 / 1000, 6);
  });

  it('Berlin rechnet 30 % der Bruttodachfläche', () => {
    const r = pflichtGebaeude(neubau(), pflichtRegel('be'), { wpProM2: WP_PRO_M2 });
    expect(r.sollM2).toBeCloseTo(300, 6);
  });

  it('Bayern rechnet ein Drittel der GEEIGNETEN Fläche, nicht der Dachfläche', () => {
    // geeignetM2 wird bereits als Dachhaut übergeben (09e projiziert den Grundriss)
    const r = pflichtGebaeude(neubau({ geeignetM2: 600 }), pflichtRegel('by'), { wpProM2: WP_PRO_M2 });
    expect(r.bezugsM2).toBe(600);
    expect(r.sollM2).toBeCloseTo(200, 6);
  });

  it('schätzt die geeignete Fläche pauschal, wenn keine Belegung gezeichnet ist — und sagt es', () => {
    const r = pflichtGebaeude(neubau({ geeignetM2: 0 }), pflichtRegel('by'), { wpProM2: WP_PRO_M2 });
    expect(r.bezugsM2).toBeCloseTo(1000 * EIGNUNG_PAUSCHAL_PCT / 100, 6);
    expect(r.annahmen.join(' ')).toMatch(/pauschal/i);
  });
});

describe('Auslöser und Schwellenwerte', () => {
  it('Bestandsgebäude ohne Maßnahme löst nichts aus', () => {
    const r = pflichtGebaeude(neubau({ neubau: false }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(false);
    expect(r.kwp).toBe(0);
    expect(r.grund).toMatch(/kein Neubau/);
  });

  it('Dachsanierung unter der Landesschwelle löst nichts aus (Bremen: 80 %)', () => {
    const basis = neubau({ neubau: false, dachsanierung: true });
    expect(pflichtGebaeude({ ...basis, sanAnteilPct: 60 }, pflichtRegel('hb'), { wpProM2: WP_PRO_M2 }).pflichtig).toBe(false);
    expect(pflichtGebaeude({ ...basis, sanAnteilPct: 90 }, pflichtRegel('hb'), { wpProM2: WP_PRO_M2 }).pflichtig).toBe(true);
  });

  it('Dachfläche unter der Mindestgröße löst nichts aus (Brandenburg: 50 m²)', () => {
    const r = pflichtGebaeude(neubau({ grundflaecheM2: 40 }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(false);
    expect(r.grund).toMatch(/50 m²/);
  });

  it('Schleswig-Holstein nimmt Wohngebäude aus', () => {
    const r = pflichtGebaeude(neubau({ wohnen: true }), pflichtRegel('sh'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(false);
    expect(r.grund).toMatch(/Wohngebäude/);
  });

  it('Annahme „alle" erklärt auch Bestandsgebäude zum Pflichtfall und protokolliert das', () => {
    const r = pflichtGebaeude(neubau({ neubau: false }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2, annahme: 'alle' });
    expect(r.pflichtig).toBe(true);
    expect(r.fall).toBe('angenommen');
    expect(r.annahmen.join(' ')).toMatch(/pauschal angenommen/i);
  });
});

describe('Länder ohne bezifferten Flächenanteil', () => {
  it.each(['nw', 'sh', 'he'])('%s liefert keine erfundene Leistung', (land) => {
    const r = pflichtGebaeude(neubau(), pflichtRegel(land), { wpProM2: WP_PRO_M2 });
    expect(r.kwp).toBe(0);
    expect(r.sollM2).toBe(0);
  });

  it('nennt die pflichtigen Gebäude trotzdem und begründet die fehlende Zahl', () => {
    const pf = pvPflichtSumme([neubau()], 'nw', { wpProM2: WP_PRO_M2 });
    expect(pf.aktiv).toBe(true);
    expect(pf.bezifferbar).toBe(false);
    expect(pf.faelle).toHaveLength(1);
    expect(pf.kwp).toBe(0);
    expect(pf.grund).toMatch(/keinen Flächenanteil/);
  });
});

describe('Summe über das Projekt', () => {
  const gebs = [
    neubau({ id: 1, grundflaecheM2: 1000 }),
    neubau({ id: 2, grundflaecheM2: 600 }),
    neubau({ id: 3, grundflaecheM2: 800, neubau: false }),   // Bestand → zählt nicht
  ];

  it('summiert nur die auslösenden Gebäude', () => {
    const pf = pvPflichtSumme(gebs, 'bb', { wpProM2: WP_PRO_M2 });
    expect(pf.faelle.map(f => f.id)).toEqual([1, 2]);
    expect(pf.ohneFall).toHaveLength(1);
    expect(pf.kwp).toBeCloseTo((500 + 300) * WP_PRO_M2 / 1000, 6);
  });

  it('meldet Länder ohne Pflicht als aktiv, aber ohne Leistung', () => {
    const pf = pvPflichtSumme(gebs, 'sn', { wpProM2: WP_PRO_M2 });
    expect(pf.aktiv).toBe(true);
    expect(pf.kwp).toBe(0);
    expect(pf.grund).toMatch(/keine landesrechtliche PV-Pflicht/);
  });

  it('bleibt ohne Bundesland und bei ausgeschalteter Prüfung stumm', () => {
    expect(pvPflichtSumme(gebs, null).aktiv).toBe(false);
    expect(pvPflichtSumme(gebs, 'bb', { annahme: 'aus' }).aktiv).toBe(false);
  });

  it('führt jede Annahme nur einmal auf, nicht je Gebäude', () => {
    const ohneBelegung = [neubau({ id: 1 }), neubau({ id: 2 }), neubau({ id: 3 })];
    const pf = pvPflichtSumme(ohneBelegung, 'by', { wpProM2: WP_PRO_M2 });
    expect(pf.faelle).toHaveLength(3);
    expect(pf.annahmen).toHaveLength(1);
  });
});

describe('Prüfung der übrigen Varianten', () => {
  const pflicht = { aktiv: true, bezifferbar: true, kwp: 400 };

  it('erkennt Unterschreitung und beziffert den Abstand', () => {
    const c = pflichtCheck(99, pflicht);
    expect(c.relevant).toBe(true);
    expect(c.erfuellt).toBe(false);
    expect(c.deltaKwp).toBeCloseTo(-301, 6);
  });

  it('erkennt Erfüllung', () => {
    expect(pflichtCheck(500, pflicht).erfuellt).toBe(true);
  });

  it('lässt Rundung im Anzeigepfad nicht zur Verletzung werden', () => {
    expect(pflichtCheck(399.5, pflicht).erfuellt).toBe(true);
  });

  it('ist nicht relevant, solange keine bezifferte Pflicht vorliegt', () => {
    for (const p of [null, { aktiv: false }, { aktiv: true, bezifferbar: false, kwp: 0 }]) {
      const c = pflichtCheck(10, p);
      expect(c.relevant).toBe(false);
      expect(c.erfuellt).toBe(true);
    }
  });
});

describe('Soll und Ist je Gebäude', () => {
  it('stellt der Sollleistung die geplante Leistung gegenüber', () => {
    // 1.000 m² Flachdach in BB: 50 % × 1.000 m² × 240 W/m² = 120 kWp Soll
    const r = pflichtGebaeude(neubau({ istKwp: 90 }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.kwp).toBeCloseTo(120, 6);
    expect(r.istKwp).toBe(90);
    expect(r.deltaKwp).toBeCloseTo(-30, 6);
    expect(r.erfuellt).toBe(false);
  });

  it('gilt als erfüllt, sobald die geplante Leistung das Soll erreicht', () => {
    expect(pflichtGebaeude(neubau({ istKwp: 120 }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 }).erfuellt).toBe(true);
    // Rundung im Anzeigepfad darf nicht zur Verletzung werden
    expect(pflichtGebaeude(neubau({ istKwp: 119.5 }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 }).erfuellt).toBe(true);
  });

  it('legt den Rechenweg offen — Fläche, Anteil, Modulleistung, Ergebnis', () => {
    const r = pflichtGebaeude(neubau(), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.rechenweg).toContain('Dachfläche');
    expect(r.rechenweg).toContain('50 %');
    expect(r.rechenweg).toContain('240 W/m²');
    expect(r.rechenweg).toContain('kWp');
  });

  it('benennt die Bezugsfläche je Landesformulierung', () => {
    expect(bezugFlaechenName(pflichtRegel('bb'))).toBe('Dachfläche');
    expect(bezugFlaechenName(pflichtRegel('be'))).toBe('Bruttodachfläche');
    expect(bezugFlaechenName(pflichtRegel('by'))).toBe('geeignete Fläche');
  });

  it('summiert die geplante Leistung nur über die pflichtigen Gebäude', () => {
    const pf = pvPflichtSumme([
      neubau({ id: 1, istKwp: 100 }),
      neubau({ id: 2, istKwp: 50, neubau: false }),   // kein Pflichtfall
    ], 'bb', { wpProM2: WP_PRO_M2 });
    expect(pf.faelle).toHaveLength(1);
    expect(pf.istKwp).toBe(100);
  });
});

describe('Pflichtfall von Hand am Gebäude', () => {
  it('erklärt ein Bestandsgebäude zum Pflichtfall', () => {
    const r = pflichtGebaeude(neubau({ neubau: false, pflichtFall: 'neubau' }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(true);
    expect(r.fall).toBe('neubau');
    expect(r.manuell).toBe(true);
  });

  it('nimmt ein erkanntes Gebäude wieder heraus', () => {
    const r = pflichtGebaeude(neubau({ pflichtFall: 'keine' }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(r.pflichtig).toBe(false);
    expect(r.kwp).toBe(0);
    expect(r.grund).toMatch(/nicht pflichtig/);
  });

  it('schlägt auch die Projekteinstellung „alle Gebäude"', () => {
    const r = pflichtGebaeude(neubau({ pflichtFall: 'keine' }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2, annahme: 'alle' });
    expect(r.pflichtig).toBe(false);
  });

  it('lässt bei „automatisch" die Erkennung arbeiten', () => {
    const auto = pflichtGebaeude(neubau({ pflichtFall: '' }), pflichtRegel('bb'), { wpProM2: WP_PRO_M2 });
    expect(auto.pflichtig).toBe(true);
    expect(auto.manuell).toBe(false);
  });
});

describe('Bundesland aus Koordinaten', () => {
  it('ordnet bekannte Orte zu', () => {
    expect(detectBundesland(48.78, 9.18)).toBe('bw');    // Stuttgart
    expect(detectBundesland(52.52, 13.40)).toBe('be');   // Berlin
    expect(detectBundesland(53.55, 9.99)).toBe('hh');    // Hamburg
  });

  it('liefert null außerhalb Deutschlands und bei unbrauchbaren Werten', () => {
    expect(detectBundesland(41.90, 12.50)).toBeNull();   // Rom
    expect(detectBundesland(NaN, 10)).toBeNull();
    expect(detectBundesland(undefined, undefined)).toBeNull();
  });
});

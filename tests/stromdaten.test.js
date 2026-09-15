import { describe, it, expect } from 'vitest';
import {
  sdParseLastgang, sdJahrAusDateiname, sdSummenreihe, sdKennzahlen, sdJahresuebersicht, sdTrend,
  sdZeitraumText, sdDauerlinie, sdReferenzReihen, sdCapture, sdNormalisieren, sdAusQuartierProfil,
} from '../src/lib/stromdaten.js';

const p2 = n => String(n).padStart(2, '0');

/** 15-min-CSV eines Jahres mit deutschem Zeitstempel und Dezimalkomma. */
function csvViertel(jahr, kw = () => 100) {
  const zeilen = ['Zeitstempel;Leistung kW'];
  const start = new Date(jahr, 0, 1).getTime();
  for (let i = 0; i < 35040; i++) {
    const d = new Date(start + i * 900000);
    zeilen.push(`${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())};`
      + String(kw(i)).replace('.', ','));
  }
  return zeilen.join('\r\n');
}

const reihe = (werte, istViertel) => ({ werte: Float32Array.from(werte), istViertel, startDate: null, dateiname: '' });
const konstant = (n, v) => new Array(n).fill(v);
const messjahr = (id, jahr, kw, bhkwKw = null) => ({
  id, jahr, bezug: reihe(konstant(8760, kw), false), bhkw: bhkwKw == null ? null : reihe(konstant(8760, bhkwKw), false),
});

describe('sdParseLastgang', () => {
  it('liest 15-min-Werte mit Zeitstempel, Kopfzeile und Dezimalkomma', () => {
    const r = sdParseLastgang(csvViertel(2023, i => (i === 5 ? 12.5 : 100)));
    expect(r.fehler).toBeUndefined();
    expect(r.istViertel).toBe(true);
    expect(r.werte.length).toBe(35040);
    expect(r.werte[5]).toBeCloseTo(12.5);
    expect(r.jahr).toBe(2023);
    expect(r.startDate.getFullYear()).toBe(2023);
  });

  it('liest reine Stundenwerte ohne Zeitstempel — dann ohne Jahr', () => {
    const r = sdParseLastgang(konstant(8760, '42').join('\n'));
    expect(r.istViertel).toBe(false);
    expect(r.werte.length).toBe(8760);
    expect(r.jahr).toBeNull();
    expect(r.startDate).toBeNull();
  });

  it('ignoriert ein UTF-8-BOM vor der Kopfzeile', () => {
    // Einspaltig mit Dezimalpunkt — ein Dezimalkomma ohne Semikolon würde wie bisher als Spaltentrenner gelesen
    const r = sdParseLastgang(String.fromCharCode(0xfeff) + 'Wert kW\n' + konstant(8760, '7.5').join('\n'));
    expect(r.werte.length).toBe(8760);
    expect(r.werte[0]).toBeCloseTo(7.5);
  });

  it('meldet eine unbekannte Wertanzahl', () => {
    expect(sdParseLastgang(konstant(5000, '1').join('\n')).fehler).toMatch(/Unbekannte Wertanzahl/);
  });
});

describe('sdJahrAusDateiname', () => {
  it('findet vierstellige Jahre nur als eigene Zahl', () => {
    expect(sdJahrAusDateiname('Lastgang_2023_final.csv')).toBe(2023);
    expect(sdJahrAusDateiname('bezug.csv')).toBeNull();
    expect(sdJahrAusDateiname('120231.csv')).toBeNull();
  });
});

describe('sdSummenreihe / sdKennzahlen', () => {
  it('addiert Bezug (15 min) und BHKW (Stunden) auf Stundenbasis', () => {
    const s = sdSummenreihe(reihe(konstant(35040, 100), true), reihe(konstant(8760, 50), false));
    expect(s.istViertel).toBe(false);
    expect(s.werte.length).toBe(8760);
    expect(s.werte[0]).toBe(150);
    expect(s.abweichungWerte).toBe(0);
  });

  it('rechnet Arbeit, Spitze, Grundlast und Benutzungsdauer', () => {
    const w = konstant(8760, 10); w[100] = 500;
    const k = sdKennzahlen(Float32Array.from(w), false);
    expect(k.arbeitKwh).toBe(8759 * 10 + 500);
    expect(k.spitzeKw).toBe(500);
    expect(k.grundlastKw).toBe(10);
    expect(k.benutzungsdauerH).toBeCloseTo(k.arbeitKwh / 500);
  });
});

describe('sdJahresuebersicht / sdTrend / sdZeitraumText', () => {
  const daten = { referenzId: 'b', jahre: [messjahr('c', 2024, 110), messjahr('a', 2022, 100), messjahr('b', 2023, 100, 10)] };

  it('sortiert nach Jahr, markiert die Referenz und rechnet die Veränderung auf Bezug + BHKW', () => {
    const z = sdJahresuebersicht(daten);
    expect(z.map(x => x.jahr)).toEqual([2022, 2023, 2024]);
    expect(z.map(x => x.referenz)).toEqual([false, true, false]);
    expect(z[0].aenderungProzent).toBeNull();
    expect(z[1].bhkwKwh).toBe(87600);
    expect(z[1].gesamtKwh).toBe(8760 * 110);
    expect(z[1].spitzeKw).toBe(110);
    expect(z[1].aenderungProzent).toBeCloseTo(10);
    expect(z[2].aenderungProzent).toBeCloseTo(0);
  });

  it('bewertet den Trend mit ±5 % Schwelle', () => {
    const z = sdJahresuebersicht(daten);
    expect(sdTrend(z).art).toBe('steigend');
    expect(sdTrend(z.slice(1)).art).toBe('bestaendig');
    expect(sdTrend([{ jahr: 1, gesamtKwh: 100 }, { jahr: 2, gesamtKwh: 90 }]).art).toBe('fallend');
    expect(sdTrend(z.slice(0, 1))).toBeNull();
  });

  it('beschreibt Zeiträume', () => {
    expect(sdZeitraumText([2024, 2022, 2023])).toBe('2022 bis 2024');
    expect(sdZeitraumText([2021, 2024, 2023])).toBe('2021, 2023 und 2024');
    expect(sdZeitraumText([2024])).toBe('2024');
  });
});

describe('sdDauerlinie', () => {
  it('beginnt mit der Spitze und endet mit dem Minimum', () => {
    const d = sdDauerlinie(Float32Array.from([3, 9, 1, 5, 7]), 3);
    expect(d).toEqual([9, 5, 1]);
  });
});

describe('sdReferenzReihen', () => {
  it('liefert ohne Referenz null, mit Referenz die Summenreihe', () => {
    expect(sdReferenzReihen({ jahre: [messjahr('a', 2022, 100)], referenzId: null })).toBeNull();
    const mj = { id: 'v', jahr: 2023, bezug: reihe(konstant(35040, 80), true), bhkw: reihe(konstant(35040, 20), true) };
    const r = sdReferenzReihen({ jahre: [mj], referenzId: 'v' });
    expect(r.aufloesung).toBe(15);
    expect(r.h15.length).toBe(35040);
    expect(r.h.length).toBe(8760);
    expect(r.h[0]).toBe(100);
    expect(r.startDate.getFullYear()).toBe(2023);
    expect(r.dateiname).toMatch(/Bezug \+ BHKW/);
  });
});

describe('Projektdatei', () => {
  it('speichert gerundet und lädt wieder, unbrauchbare Einträge fallen weg', () => {
    const mj = messjahr('a1', 2022, 12.3456);
    const gespeichert = sdCapture({ jahre: [mj], referenzId: 'a1' });
    expect(gespeichert.jahre[0].bezug.werte[0]).toBe(12.35);
    gespeichert.jahre.push({ id: 'kaputt', jahr: 2023, bezug: { werte: [1, 2, 3] } });
    const geladen = sdNormalisieren(JSON.parse(JSON.stringify(gespeichert)));
    expect(geladen.jahre.length).toBe(1);
    expect(geladen.referenzId).toBe('a1');
    expect(geladen.jahre[0].bezug.werte).toBeInstanceOf(Float32Array);
    expect(geladen.jahre[0].bezug.istViertel).toBe(false);
  });

  it('übernimmt einen Altprojekt-Lastgang als einziges Messjahr und Referenz', () => {
    const d = sdAusQuartierProfil({ values: konstant(8760, 5), values15: null, startDate: new Date(2021, 0, 1).toISOString(), filename: 'alt.csv' });
    expect(d.jahre.length).toBe(1);
    expect(d.jahre[0].jahr).toBe(2021);
    expect(d.referenzId).toBe(d.jahre[0].id);
    expect(sdAusQuartierProfil(null).jahre).toEqual([]);
  });
});

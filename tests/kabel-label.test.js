import { describe, it, expect } from 'vitest';
import { parseKabelLabel } from '../src/lib/kabel-label.js';

describe('parseKabelLabel — Schreibweisen von Bestandsplänen', () => {
  it('NS-Kabel: Adern × Querschnitt', () => {
    const r = parseKabelLabel('NYY-J 5x70');
    expect(r.cableType).toBe('NYY');
    expect(r.adern).toBe(5);
    expect(r.crossSection).toBe(70);
    expect(r.nParallel).toBe(1);
    expect(r.msLevel).toBe(false);
    expect(r.bekannt).toBe(true);
  });

  it('Aluminium-NS-Kabel mit großem Querschnitt', () => {
    const r = parseKabelLabel('NAYY-J 4x240');
    expect(r.cableType).toBe('NAYY');
    expect(r.crossSection).toBe(240);
    expect(r.bekannt).toBe(true);
  });

  it('vorangestellter Systemzähler zählt als parallele Systeme', () => {
    const r = parseKabelLabel('3x NA2XS2Y 1x185');
    expect(r.cableType).toBe('NA2XS2Y');
    expect(r.nParallel).toBe(3);
    expect(r.adern).toBe(1);
    expect(r.crossSection).toBe(185);
    expect(r.msLevel).toBe(true);
  });

  it('dreiteilige Zahlengruppe: Systeme × Adern × mm²', () => {
    const r = parseKabelLabel('NA2XS2Y 3x1x185');
    expect(r.nParallel).toBe(3);
    expect(r.adern).toBe(1);
    expect(r.crossSection).toBe(185);
  });

  it('Ziffern im Typkürzel werden nicht als Querschnitt gelesen', () => {
    // "NA2XS2Y" enthält 2 und 2 — ohne Entfernen des Typs käme hier Unsinn heraus
    const r = parseKabelLabel('NA2XS2Y 1x185');
    expect(r.crossSection).toBe(185);
    expect(r.adern).toBe(1);
    expect(r.nParallel).toBe(1);
  });

  it('erkennt MS nur bei 2XS2Y-Typen', () => {
    expect(parseKabelLabel('NYY-J 1x185').msLevel).toBe(false);
    expect(parseKabelLabel('N2XS2Y 1x150').msLevel).toBe(true);
  });

  it('Querschnitt außerhalb der Typtabelle wird als unbekannt markiert', () => {
    const r = parseKabelLabel('NYY-J 5x6');
    expect(r.crossSection).toBe(6);
    expect(r.bekannt).toBe(false);   // NYY-Tabelle startet bei 16 mm²
  });

  it('Kommazahl und ×-Zeichen werden akzeptiert', () => {
    const r = parseKabelLabel('NYY-J 5×2,5');
    expect(r.crossSection).toBe(2.5);
  });

  it('Beschriftung ohne Typangabe liefert wenigstens den Querschnitt', () => {
    const r = parseKabelLabel('4x50');
    expect(r.cableType).toBeNull();
    expect(r.crossSection).toBe(50);
    expect(r.bekannt).toBe(false);
  });

  it('weitere Katalogtypen werden erkannt', () => {
    for (const [txt, typ] of [
      ['NYCWY 4x95/50', 'NYCWY'], ['NAYCWY 3x150/70', 'NAYCWY'], ['N2XY-J 5x16', 'N2XY'],
      ['NA2XY 4x120', 'NA2XY'], ['NKBA 4x70', 'NKBA'], ['NAKBA 3x95', 'NAKBA'],
      ['NFA2X 4x35', 'NFA2X'], ['NYM-J 5x2,5', 'NYM'],
    ]) {
      const r = parseKabelLabel(txt);
      expect(r.cableType, txt).toBe(typ);
      expect(r.bekannt, txt).toBe(true);
      expect(r.msLevel, txt).toBe(false);
    }
  });

  it('Schreibvarianten werden auf den Katalogtyp abgebildet', () => {
    const r = parseKabelLabel('3x NA2XS(F)2Y 1x185');
    expect(r.cableType).toBe('NA2XS2Y');
    expect(r.typText).toBe('NA2XS(F)2Y');
    expect(r.nParallel).toBe(3);
    expect(r.crossSection).toBe(185);
    expect(r.msLevel).toBe(true);
    expect(parseKabelLabel('nyby 4x50').cableType).toBe('NYY');
    expect(parseKabelLabel('NYCY 4x50').cableType).toBe('NYCWY');
    expect(parseKabelLabel('NHXMH-J 3x1,5').cableType).toBe('NYM');
  });

  it('kürzere Typen beißen längere nicht an', () => {
    expect(parseKabelLabel('NAYY 4x150').cableType).toBe('NAYY');
    expect(parseKabelLabel('NAYCWY 3x95/50').cableType).toBe('NAYCWY');
  });

  it('Spannungsangabe entscheidet über MS bei Papierkabeln', () => {
    const ms = parseKabelLabel('NAKBA 3x95 6/10 kV');
    expect(ms.msLevel).toBe(true);
    expect(ms.crossSection).toBe(95);
    expect(parseKabelLabel('NKBA 4x70 0,6/1 kV').msLevel).toBe(false);
  });

  it('leere oder unbrauchbare Eingaben ergeben null', () => {
    expect(parseKabelLabel('')).toBeNull();
    expect(parseKabelLabel(null)).toBeNull();
    expect(parseKabelLabel('Straßenbeleuchtung')).toBeNull();
  });
});

// Vitest-Tests für lib/massnahmen-register.js — Maßnahmenliste (Ebene 1) und Abgleich mit den Objekt-Maßnahmen.
import { describe, it, expect } from 'vitest';
import {
  mrAbgleich, mrGewerk, mrNummer, mrStandAusStatus, mrStatusAusStand,
} from '../src/lib/massnahmen-register.js';

const AUTO = '_autoEngpass';
const ids = () => { let i = 0; return () => `mr${++i}`; };
const w = (ziel, objId, m, objTyp = 'Trafo') => ({ ziel, objId, objLabel: `Obj ${objId}`, objTyp, m });

describe('Stand und Status', () => {
  it('bildet den Stand auf den Rechenstatus ab', () => {
    expect(mrStatusAusStand('vorschlag')).toBe('geplant');
    expect(mrStatusAusStand('empfohlen')).toBe('geplant');
    expect(mrStatusAusStand('beschlossen')).toBe('geplant');
    expect(mrStatusAusStand('umgesetzt')).toBe('umgesetzt');
    expect(mrStatusAusStand('verworfen')).toBe('abgelehnt');
  });
  it('leitet den Stand aus dem Status ab und lässt einen feineren Stand stehen', () => {
    expect(mrStandAusStatus({ status: 'geplant', [AUTO]: true }, null, AUTO)).toBe('vorschlag');
    expect(mrStandAusStatus({ status: 'geplant' }, 'vorschlag', AUTO)).toBe('empfohlen');
    expect(mrStandAusStatus({ status: 'geplant' }, 'beschlossen', AUTO)).toBe('beschlossen');
    expect(mrStandAusStatus({ status: 'abgelehnt' }, 'beschlossen', AUTO)).toBe('verworfen');
    expect(mrStandAusStatus({ status: 'umgesetzt' })).toBe('umgesetzt');
  });
  it('Gewerk und Nummer', () => {
    expect(mrGewerk('kante')).toBe('elektro');
    expect(mrGewerk('asset', 'Trafo')).toBe('elektro');
    expect(mrGewerk('asset', 'PV')).toBe('pv');
    expect(mrGewerk('asset', 'WP')).toBe('waerme');
    expect(mrGewerk('asset', 'Nsa')).toBe('resilienz');
    expect(mrGewerk('gebaeude', 'Gebäude')).toBe('hochbau');
    expect(mrNummer(7)).toBe('M07');
    expect(mrNummer(112)).toBe('M112');
  });
});

describe('mrAbgleich — Übernahme der Altdaten', () => {
  it('legt je Objekt-Maßnahme einen Eintrag an, setzt den Verweis und nummeriert chronologisch', () => {
    const m1 = { id: 'a', titel: 'Kabel tauschen', typ: 'Austausch', jahr: 2031, kosten: 12000, status: 'geplant', variante: null };
    const m2 = { id: 'auto_t1', titel: 'Trafo 1000 kVA', typ: 'Ertuechtigung', jahr: '2028', kosten: 38000, status: 'geplant', variante: 'base', [AUTO]: true };
    const m3 = { id: 'c', titel: 'Sanierung Cluster D', typ: 'Sanierung', jahr: null, status: 'abgelehnt', clusterId: 'cl1', clusterName: 'D' };
    const reg = [];
    const r = mrAbgleich(reg, [w('kante', 'k1', m1), w('asset', 't1', m2), w('gebaeude', 'g1', m3, 'Gebäude')], { neueId: ids(), autoTag: AUTO });
    expect(r.neu).toBe(3);
    expect(reg).toHaveLength(3);
    const e2 = reg.find(e => e.id === m2.massnahmeRef);
    expect(e2).toMatchObject({ nr: 1, stand: 'vorschlag', gewerk: 'elektro', art: 'Ertuechtigung', jahr: 2028, variante: 'base',
      anlass: { quelle: 'engpass' }, kosten: { investEur: 38000, herkunft: 'kennwert' } });
    expect(reg.find(e => e.id === m1.massnahmeRef)).toMatchObject({ nr: 2, stand: 'empfohlen', anlass: { quelle: 'manuell' } });
    expect(reg.find(e => e.id === m3.massnahmeRef)).toMatchObject({ nr: 3, stand: 'verworfen', gewerk: 'hochbau', anlass: { quelle: 'cluster', ref: 'cl1', text: 'D' } });
    // Rechenfelder unverändert (nur das Jahr normalisiert)
    expect(m2).toMatchObject({ status: 'geplant', jahr: 2028, kosten: 38000 });
  });

  it('ist idempotent', () => {
    const m = { id: 'a', titel: 'X', jahr: 2030, kosten: 5, status: 'geplant' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    const vorher = JSON.stringify(reg);
    const r = mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    expect(r.neu).toBe(0);
    expect(JSON.stringify(reg)).toBe(vorher);
  });
});

describe('mrAbgleich — laufender Betrieb', () => {
  it('übernimmt Änderungen an der Wirkung in den Eintrag und behält den feineren Stand', () => {
    const m = { id: 'a', titel: 'Trafo', jahr: 2030, kosten: 1000, status: 'geplant' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    reg[0].stand = 'beschlossen';
    Object.assign(m, { jahr: 2032, kosten: 2500, titel: 'Trafo 1250 kVA' });
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    expect(reg[0]).toMatchObject({ jahr: 2032, titel: 'Trafo 1250 kVA', stand: 'beschlossen', kosten: { investEur: 2500 } });
  });

  it('ein bearbeiteter Vorschlag (Auto-Kennzeichen weg) wird empfohlen', () => {
    const m = { id: 'auto_t1', titel: 'T', jahr: 2029, kosten: 1, status: 'geplant', [AUTO]: true };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids(), autoTag: AUTO });
    expect(reg[0].stand).toBe('vorschlag');
    delete m[AUTO];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids(), autoTag: AUTO });
    expect(reg[0].stand).toBe('empfohlen');
  });

  it('schreibt Änderungen am Eintrag auf alle Wirkungen und Kopien', () => {
    const live = { id: 'a', titel: 'S', jahr: 2030, status: 'geplant' };
    const kopie = { ...live };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', live), w('asset', 't1', kopie)], { neueId: ids() });
    expect(reg).toHaveLength(1);
    // Eintrag geändert (wie künftig in der Maßnahmen-Ansicht): Stand und Jahr
    reg[0].stand = 'verworfen'; reg[0].jahr = 2035;
    reg[0]._sync = { ...reg[0]._sync };   // Wirkungen gelten als unverändert
    mrAbgleich(reg, [w('asset', 't1', live), w('asset', 't1', kopie)], { neueId: ids() });
    expect(live).toMatchObject({ status: 'abgelehnt', jahr: 2035 });
    expect(kopie).toMatchObject({ status: 'abgelehnt', jahr: 2035 });
  });

  it('entfernt Einträge ohne Wirkung, außer bewusst objektlose', () => {
    const m = { id: 'a', titel: 'X', status: 'geplant' };
    const reg = [{ id: 'frei', nr: 9, titel: 'Fachplanung', ohneObjekt: true, stand: 'empfohlen' }];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    expect(reg).toHaveLength(2);
    const r = mrAbgleich(reg, [], { neueId: ids() });
    expect(r.entfernt).toBe(1);
    expect(reg.map(e => e.id)).toEqual(['frei']);
    expect(reg[0].nr).toBe(9);
  });

  it('macht aus einer kopierten Wirkung eine eigene Maßnahme, außer der Eintrag ist mehrfach', () => {
    const m = { id: 'a', titel: 'X', status: 'geplant' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    const kopie = { ...m, id: 'b' };   // Objekt dupliziert
    const r = mrAbgleich(reg, [w('asset', 't1', m), w('asset', 't2', kopie)], { neueId: ids() });
    expect(r.getrennt).toBe(1);
    expect(kopie.massnahmeRef).not.toBe(m.massnahmeRef);
    // mehrfach: beide Wirkungen gehören zu einem Eintrag
    const reg2 = [];
    const a = { id: 'a', titel: 'Paket', status: 'geplant' }, b = { id: 'b', titel: 'Paket', status: 'geplant' };
    mrAbgleich(reg2, [w('gebaeude', 'g1', a)], { neueId: ids() });
    reg2[0].mehrfach = true;
    b.massnahmeRef = a.massnahmeRef;
    mrAbgleich(reg2, [w('gebaeude', 'g1', a), w('gebaeude', 'g2', b)], { neueId: ids() });
    expect(reg2).toHaveLength(1);
    expect(reg2[0].kosten.investEur).toBe(0);
  });

  it('erkennt neu erzeugte Objekt-Maßnahmen ohne Verweis wieder (Nummer bleibt)', () => {
    const reg = [];
    mrAbgleich(reg, [w('gebaeude', 'g1', { id: 'clm_1', titel: 'San', status: 'geplant' })], { neueId: ids() });
    const id = reg[0].id;
    const neu = { id: 'clm_1', titel: 'San', status: 'geplant', jahr: 2033 };   // Paket neu angewendet
    mrAbgleich(reg, [w('gebaeude', 'g1', neu)], { neueId: ids() });
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ id, nr: 1, jahr: 2033 });
    expect(neu.massnahmeRef).toBe(id);
  });

  it('stellt einen Eintrag mit seiner alten Id wieder her (Rückgängig ohne Liste)', () => {
    const m = { id: 'a', titel: 'X', status: 'geplant', massnahmeRef: 'mr_alt' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    expect(reg[0].id).toBe('mr_alt');
  });

  it('schreibt keine Geltung auf Wirkungen, die noch keine haben', () => {
    const m = { id: 'a', titel: 'X', status: 'geplant' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', m)], { neueId: ids() });
    expect('variante' in m).toBe(false);
    expect('variante' in reg[0]).toBe(false);
  });
});

describe('mrAbgleich — Kopien', () => {
  it('das Original behält Eintrag und Nummer, auch wenn die Kopie zuerst kommt', () => {
    const orig = { id: 'a', titel: 'X', status: 'geplant', variante: 'base' };
    const reg = [];
    mrAbgleich(reg, [w('asset', 't1', orig)], { neueId: ids() });
    const id = orig.massnahmeRef;
    const kopie = { ...orig, id: 'a_v2', variante: 'v_2' };   // neue Variante aus dem Hauptplan
    mrAbgleich(reg, [w('asset', 't1', kopie), w('asset', 't1', orig)], { neueId: ids() });
    expect(orig.massnahmeRef).toBe(id);
    expect(reg.find(e => e.id === id)).toMatchObject({ nr: 1, variante: 'base' });
    expect(reg.find(e => e.id === kopie.massnahmeRef)).toMatchObject({ nr: 2, variante: 'v_2' });
  });
});

import { mrDringlichkeitAuto, mrDringlichkeit } from '../src/lib/massnahmen-register.js';
describe('Dringlichkeit', () => {
  it('leitet sie aus dem Jahr ab, solange nichts festgelegt ist', () => {
    expect(mrDringlichkeitAuto(2026, 2026)).toBe('sofort');
    expect(mrDringlichkeitAuto('2028', 2026)).toBe('kurz');
    expect(mrDringlichkeitAuto(2031, 2026)).toBe('mittel');
    expect(mrDringlichkeitAuto(2032, 2026)).toBe('lang');
    expect(mrDringlichkeitAuto(null, 2026)).toBe(null);
    expect(mrDringlichkeit({ jahr: 2040, dringlichkeit: 'kurz' }, 2026)).toBe('kurz');
    expect(mrDringlichkeit({ jahr: 2040 }, 2026)).toBe('lang');
  });
});

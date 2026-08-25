// Vitest-Tests für lib/netz-schwellen.js — Schwellentreppe und Auflösungswege.
import { describe, it, expect } from 'vitest';
import {
  netzKomponenten, blattZuTrafo, komponenteKapazitaetKW, pruefeSchwellen,
  bestandErtuechtigen, schwellenVarianten, schwellenAnalyse,
  SCHWELLEN_KOSTEN, TRAFO_RUECK_FAKTOR,
} from '../src/lib/netz-schwellen.js';

// MS-Ring: NAP ─ SA ─ T1 ─ T2 ─ zurück zur SA (Ring!)
// NS radial: T1 ─ NSHV1 ─ KVS1 ─ PV1 ;  T2 ─ NSHV2 ─ PV2
const ringNetz = () => ({
  assets: [
    { id: 'nap',   type: 'NAP',          name: 'NAP' },
    { id: 'sa',    type: 'Schaltanlage', name: 'SA' },
    { id: 't1',    type: 'Trafo',        name: 'Trafo 1', props: { leistungKVA: 630 } },
    { id: 't2',    type: 'Trafo',        name: 'Trafo 2', props: { leistungKVA: 400 } },
    { id: 'nshv1', type: 'NSHV',         name: 'NSHV 1' },
    { id: 'nshv2', type: 'NSHV',         name: 'NSHV 2' },
    { id: 'kvs1',  type: 'KVS',          name: 'KVS 1' },
    { id: 'pv1',   type: 'PV',           name: 'PV 1' },
    { id: 'pv2',   type: 'PV',           name: 'PV 2' },
  ],
  edges: [
    { id: 'm1', u: 'nap',   v: 'sa',    msLevel: true },
    { id: 'm2', u: 'sa',    v: 't1',    msLevel: true },
    { id: 'm3', u: 't1',    v: 't2',    msLevel: true },
    { id: 'm4', u: 't2',    v: 'sa',    msLevel: true },   // schließt den Ring
    { id: 'n1', u: 't1',    v: 'nshv1' },
    { id: 'n2', u: 'nshv1', v: 'kvs1'  },
    { id: 'n3', u: 'kvs1',  v: 'pv1'   },
    { id: 'n4', u: 't2',    v: 'nshv2' },
    { id: 'n5', u: 'nshv2', v: 'pv2'   },
  ],
});

describe('netzKomponenten', () => {
  it('fasst einen Ring zu GENAU EINER Komponente zusammen', () => {
    const { assets, edges } = ringNetz();
    const k = netzKomponenten(assets, edges);
    expect(k).toHaveLength(1);
    expect(k[0].assetIds).toHaveLength(9);
  });

  it('zählt Ring-Trafos nicht doppelt — der Fehler des radialen Ansatzes', () => {
    const { assets, edges } = ringNetz();
    const [k] = netzKomponenten(assets, edges);
    expect(k.trafoIds.sort()).toEqual(['t1', 't2']);
  });

  it('trennt unverbundene Netze', () => {
    const { assets, edges } = ringNetz();
    assets.push({ id: 'nap2', type: 'NAP' }, { id: 't9', type: 'Trafo', props: { leistungKVA: 250 } });
    edges.push({ id: 'x', u: 'nap2', v: 't9', msLevel: true });
    expect(netzKomponenten(assets, edges)).toHaveLength(2);
  });

  it('sammelt NAP, Trafos und Blätter getrennt', () => {
    const { assets, edges } = ringNetz();
    const [k] = netzKomponenten(assets, edges);
    expect(k.napIds).toEqual(['nap']);
    expect(k.blattIds.sort()).toEqual(['pv1', 'pv2']);
  });

  it('verträgt ein leeres Netz', () => {
    expect(netzKomponenten([], [])).toEqual([]);
  });
});

describe('blattZuTrafo', () => {
  it('findet den Trafo über mehrere NS-Verteilebenen', () => {
    const { assets, edges } = ringNetz();
    expect(blattZuTrafo('pv1', assets, edges)).toBe('t1');
  });

  it('ordnet jede Anlage GENAU einem Trafo zu, obwohl die Trafos im Ring hängen', () => {
    const { assets, edges } = ringNetz();
    expect(blattZuTrafo('pv2', assets, edges)).toBe('t2');
  });

  it('überquert den Ring nicht — sonst wäre die Zuordnung mehrdeutig', () => {
    const { assets, edges } = ringNetz();
    // Ohne MS-Sperre wäre von pv1 aus auch t2 erreichbar; es muss t1 bleiben.
    expect(blattZuTrafo('pv1', assets, edges)).toBe('t1');
  });

  it('gibt null zurück, wenn kein Trafo erreichbar ist', () => {
    const assets = [{ id: 'pv', type: 'PV' }, { id: 'nap', type: 'NAP' }];
    const edges  = [{ id: 'e', u: 'pv', v: 'nap', msLevel: true }];
    expect(blattZuTrafo('pv', assets, edges)).toBeNull();
  });

  it('gibt null zurück für eine gar nicht verkabelte Anlage', () => {
    const { assets } = ringNetz();
    expect(blattZuTrafo('pv1', assets, [])).toBeNull();
  });
});

describe('komponenteKapazitaetKW', () => {
  const komp = () => netzKomponenten(ringNetz().assets, ringNetz().edges)[0];

  it('bevorzugt das NAP-Limit — es liegt unter der Trafosumme', () => {
    const k = komponenteKapazitaetKW(komp(), ringNetz().assets, { napLimitKw: 500 });
    expect(k).toEqual({ kW: 500, quelle: 'nap' });
  });

  it('fällt ohne NAP-Limit auf die Summe der Trafos zurück', () => {
    const k = komponenteKapazitaetKW(komp(), ringNetz().assets, {});
    expect(k.quelle).toBe('trafos');
    expect(k.kW).toBeCloseTo((630 + 400) * 0.95);
  });

  it('ignoriert ein unbrauchbares NAP-Limit', () => {
    expect(komponenteKapazitaetKW(komp(), ringNetz().assets, { napLimitKw: 0 }).quelle).toBe('trafos');
    expect(komponenteKapazitaetKW(komp(), ringNetz().assets, { napLimitKw: 'x' }).quelle).toBe('trafos');
  });
});

describe('pruefeSchwellen', () => {
  const komp = () => netzKomponenten(ringNetz().assets, ringNetz().edges)[0];

  it('meldet frei, solange beide Stufen eingehalten sind', () => {
    const b = pruefeSchwellen(komp(), ringNetz().assets, { nap: 300 }, { napLimitKw: 500 });
    expect(b.stufe).toBe('frei');
    expect(b.trafoVerletzungen).toEqual([]);
    expect(b.napVerletzung).toBeNull();
  });

  it('erkennt eine überschrittene Trafo-Rückspeisegrenze', () => {
    // Trafo 2: 400 kVA × 0,9 = 360 kW Grenze
    const b = pruefeSchwellen(komp(), ringNetz().assets, { nap: 300, t2: 400 }, { napLimitKw: 900 });
    expect(b.stufe).toBe('trafo');
    expect(b.trafoVerletzungen).toHaveLength(1);
    expect(b.trafoVerletzungen[0]).toMatchObject({ id: 't2', ueberKW: 40 });
  });

  it('erkennt das NAP-Limit als höhere Stufe', () => {
    const b = pruefeSchwellen(komp(), ringNetz().assets, { nap: 800, t2: 400 }, { napLimitKw: 500 });
    expect(b.stufe).toBe('nap');
    expect(b.napVerletzung).toMatchObject({ grenzeKW: 500, ueberKW: 300 });
  });

  it('misst die Rückspeisung am NAP, nicht als Summe der Trafos — keine Doppelzählung', () => {
    const b = pruefeSchwellen(komp(), ringNetz().assets, { nap: 500, t1: 300, t2: 300 }, { napLimitKw: 900 });
    expect(b.rueckKW).toBe(500);   // nicht 500+300+300 und nicht 600
  });

  it('nutzt die Trafosumme, wenn die Komponente keinen NAP hat', () => {
    const assets = ringNetz().assets.filter(a => a.id !== 'nap');
    const edges  = ringNetz().edges.filter(e => e.u !== 'nap' && e.v !== 'nap');
    const k = netzKomponenten(assets, edges)[0];
    const b = pruefeSchwellen(k, assets, { t1: 100, t2: 50 }, {});
    expect(b.rueckKW).toBe(150);
  });

  it('gibt die Ausschöpfung in Prozent an', () => {
    const b = pruefeSchwellen(komp(), ringNetz().assets, { nap: 250 }, { napLimitKw: 500 });
    expect(b.ausgeschoepftPct).toBeCloseTo(50);
  });

  it('verträgt fehlende Rückspeisewerte', () => {
    const b = pruefeSchwellen(komp(), ringNetz().assets, {}, { napLimitKw: 500 });
    expect(b.rueckKW).toBe(0);
    expect(b.stufe).toBe('frei');
  });
});

describe('bestandErtuechtigen', () => {
  it('setzt den NAP an den Anfang, wenn er die bindende Grenze ist', () => {
    const befund = {
      napVerletzung: { grenzeKW: 500, rueckKW: 800, ueberKW: 300 },
      trafoVerletzungen: [{ id: 't2', name: 'Trafo 2', kvA: 400, rueckKW: 400, ueberKW: 40 }],
    };
    const e = bestandErtuechtigen(befund);
    expect(e.schritte[0].art).toBe('nap');
    expect(e.schritte[1].art).toBe('trafo');
  });

  it('rechnet die NAP-Erweiterung nach der Überschreitung ab', () => {
    const befund = { napVerletzung: { ueberKW: 300 }, trafoVerletzungen: [] };
    expect(bestandErtuechtigen(befund).kostenEUR).toBe(300 * SCHWELLEN_KOSTEN.napEurProKW);
  });

  it('dimensioniert den Trafo auf die nötige Rückspeiseleistung', () => {
    const befund = { napVerletzung: null, trafoVerletzungen: [
      { id: 't', name: 'T', kvA: 400, rueckKW: 450, ueberKW: 90 },
    ] };
    const [s] = bestandErtuechtigen(befund).schritte;
    // 450 / 0,9 = 500 kVA nötig → 100 kVA Zubau
    expect(s.titel).toContain('500 kVA');
    expect(s.kostenEUR).toBe(100 * SCHWELLEN_KOSTEN.trafoEurProKVA);
  });

  it('weist beim NAP auf die nötige Zusage hin — nicht allein planbar', () => {
    const e = bestandErtuechtigen({ napVerletzung: { ueberKW: 10 }, trafoVerletzungen: [] });
    expect(e.schritte[0].hinweis).toMatch(/Netzbetreiber/);
  });

  it('liefert bei unkritischem Befund nichts zu tun', () => {
    expect(bestandErtuechtigen({ napVerletzung: null, trafoVerletzungen: [] }))
      .toEqual({ schritte: [], kostenEUR: 0 });
  });

  it('akzeptiert abweichende Kostenannahmen', () => {
    const befund = { napVerletzung: { ueberKW: 100 }, trafoVerletzungen: [] };
    const e = bestandErtuechtigen(befund, { ...SCHWELLEN_KOSTEN, napEurProKW: 1 });
    expect(e.kostenEUR).toBe(100);
  });
});

describe('schwellenVarianten', () => {
  const befund = () => ({
    rueckKW: 800, kapazitaetKW: 500,
    napVerletzung: { grenzeKW: 500, rueckKW: 800, ueberKW: 300 },
    trafoVerletzungen: [],
    stufe: 'nap',
  });

  it('stellt Bestand, Erzeugungsnetz und Hybrid gegenüber', () => {
    expect(schwellenVarianten(befund()).map(v => v.id).sort())
      .toEqual(['bestand', 'erzeugungsnetz', 'hybrid']);
  });

  it('markiert genau eine Variante als günstigste', () => {
    expect(schwellenVarianten(befund()).filter(v => v.guenstigste)).toHaveLength(1);
  });

  it('rechnet das Erzeugungsnetz auf die volle Rückspeisung', () => {
    const v = schwellenVarianten(befund()).find(x => x.id === 'erzeugungsnetz');
    expect(v.kostenEUR).toBe(800 * SCHWELLEN_KOSTEN.erzeugungsnetzEurProKW);
  });

  it('rechnet Hybrid nur auf den Überschuss über die Bestandskapazität', () => {
    const v = schwellenVarianten(befund()).find(x => x.id === 'hybrid');
    expect(v.kostenEUR).toBe(300 * SCHWELLEN_KOSTEN.erzeugungsnetzEurProKW);
  });

  it('bietet Hybrid nicht an, wenn der Bestand gar keine Reserve hat', () => {
    const b = { ...befund(), kapazitaetKW: 0 };
    expect(schwellenVarianten(b).map(v => v.id)).not.toContain('hybrid');
  });

  it('findet bei diesem Befund den Bestandsausbau am günstigsten', () => {
    // NAP +300 kW × 200 = 60.000 gegen Erzeugungsnetz 800 × 400 = 320.000
    const g = schwellenVarianten(befund()).find(v => v.guenstigste);
    expect(g.id).toBe('bestand');
  });
});

describe('schwellenAnalyse', () => {
  it('liefert je Komponente Befund und Wege', () => {
    const { assets, edges } = ringNetz();
    const r = schwellenAnalyse({ assets, edges, rueckJeKnoten: { nap: 800 }, napLimitKw: 500 });
    expect(r).toHaveLength(1);
    expect(r[0].befund.stufe).toBe('nap');
    expect(r[0].varianten.length).toBeGreaterThan(0);
  });

  it('lässt die Wege leer, solange keine Schwelle gerissen ist', () => {
    const { assets, edges } = ringNetz();
    const r = schwellenAnalyse({ assets, edges, rueckJeKnoten: { nap: 100 }, napLimitKw: 500 });
    expect(r[0].befund.stufe).toBe('frei');
    expect(r[0].varianten).toEqual([]);
  });

  it('sortiert die am stärksten ausgeschöpfte Komponente nach oben', () => {
    const { assets, edges } = ringNetz();
    assets.push({ id: 'nap2', type: 'NAP' }, { id: 't9', type: 'Trafo', props: { leistungKVA: 1000 } });
    edges.push({ id: 'x', u: 'nap2', v: 't9', msLevel: true });
    const r = schwellenAnalyse({ assets, edges, rueckJeKnoten: { nap: 450, nap2: 10 } });
    expect(r[0].komponente.napIds).toEqual(['nap']);
  });

  it('übergeht Inseln ohne NAP und ohne Trafo', () => {
    const assets = [{ id: 'pv', type: 'PV' }, { id: 'pv2', type: 'PV' }];
    const edges  = [{ id: 'e', u: 'pv', v: 'pv2' }];
    expect(schwellenAnalyse({ assets, edges, rueckJeKnoten: {} })).toEqual([]);
  });

  it('verträgt leere Eingaben', () => {
    expect(schwellenAnalyse({})).toEqual([]);
  });
});

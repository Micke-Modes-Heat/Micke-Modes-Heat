import { describe,expect,it } from 'vitest';
import { mergeOsmElements,splitOsmBbox,subdivideOsmBbox } from '../src/lib/osm-bbox-tiles.js';

describe('OSM-Straßenabfragen für große Gebiete',()=>{
  it('lässt kleine Gebiete als eine Abfrage bestehen',()=>{
    expect(splitOsmBbox([52.08,8,52.085,8.005])).toHaveLength(1);
  });

  it('zerlegt große Gebiete lückenlos und begrenzt die Kachelzahl',()=>{
    const bbox=[52.0,8,52.08,8.12];
    const tiles=splitOsmBbox(bbox);
    expect(tiles).toHaveLength(16);
    expect(tiles[0].slice(0,2)).toEqual(bbox.slice(0,2));
    expect(tiles.at(-1).slice(2)).toEqual(bbox.slice(2));
  });

  it('führt überlappende OSM-Antworten ohne doppelte Ways zusammen',()=>{
    const merged=mergeOsmElements([
      {elements:[{type:'way',id:1},{type:'way',id:2}]},
      {elements:[{type:'way',id:2,geometry:[1]},{type:'way',id:3}]},
    ]);
    expect(merged.elements.map(element=>element.id)).toEqual([1,2,3]);
    expect(merged.elements[1].geometry).toEqual([1]);
  });

  it('kann einen fehlgeschlagenen Teilbereich lückenlos weiter unterteilen',()=>{
    const bbox=[52,8,52.02,8.04];
    const parts=subdivideOsmBbox(bbox);
    expect(parts).toHaveLength(4);
    expect(parts[0][0]).toBe(52);
    expect(parts[0][1]).toBe(8);
    expect(parts[0][2]).toBeCloseTo(52.01);
    expect(parts[0][3]).toBeCloseTo(8.02);
    expect(parts.at(-1)[0]).toBeCloseTo(52.01);
    expect(parts.at(-1)[1]).toBeCloseTo(8.02);
    expect(parts.at(-1).slice(2)).toEqual([52.02,8.04]);
  });
});

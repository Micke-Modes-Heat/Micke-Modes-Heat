import {describe,it,expect} from 'vitest';
import {buildProjectReportModel} from '../src/lib/project-report.js';

describe('automatisches Berichtsmodell',()=>{
  it('bilanziert Gebäude, Netz und Erzeuger ohne Netzknoten als Gebäude zu zählen',()=>{
    const model=buildProjectReportModel({
      year:2030,
      buildings:[
        {id:1,nutzung:'schule',areaM2:1000,heatMwh:120,peakKw:90,year:1970},
        {id:2,nutzung:'buero',areaM2:500,heatMwh:80,peakKw:50,year:1990},
      ],
      networkEdges:[
        {u:'zentrale',v:1,lengthM:100,lossMwh:4,utilizationPct:70},
        {u:1,v:2,lengthM:50,lossMwh:2,utilizationPct:105},
      ],
      generation:[{key:'lwwp',label:'Wärmepumpe',heatMwh:206,electricityMwh:60}],
      variants:[{id:'base',label:'Basis',heatMwh:206,investmentEur:500000,heatCostCtKwh:12.5}],
    });
    expect(model.buildings.connected).toBe(2);
    expect(model.network.foreignNodeCount).toBe(1);
    expect(model.network.lengthM).toBe(150);
    expect(model.network.lossMwh).toBe(6);
    expect(model.network.overloadedCount).toBe(1);
    expect(model.generation.balanceDeltaMwh).toBe(6);
    expect(model.variants[0]).toMatchObject({label:'Basis',investmentEur:500000,heatCostCtKwh:12.5});
    expect(model.quality.status).toBe('kritisch');
  });

  it('weist fehlende Datengrundlagen nachvollziehbar aus',()=>{
    const model=buildProjectReportModel({buildings:[{id:1,nutzung:'unbekannt'}]});
    expect(model.quality.warningCount).toBeGreaterThanOrEqual(4);
    expect(model.quality.issues.map(issue=>issue.code)).toEqual(expect.arrayContaining(['missing-area','missing-year','missing-usage','missing-heat','no-dispatch']));
  });
});

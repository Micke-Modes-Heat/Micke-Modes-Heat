import {describe,expect,it} from 'vitest';
import {
  buildBuildingHeatProfile,
  buildBuildingHeatProfiles,
  getBuildingHeatProfileMeta,
} from '../src/lib/building-heat-profiles.js';

function temperatures() {
  return Float32Array.from({length:8760},(_,hour)=>{
    const day=Math.floor(hour/24);
    return 9+10*Math.sin(2*Math.PI*(day-105)/365);
  });
}

describe('gebäudespezifische Wärmelastgänge',()=>{
  it('bewahrt Jahresenergie und die hinterlegte Heizlastgrenze',()=>{
    const profile=buildBuildingHeatProfile(
      {id:1,nutzung:'schule'},temperatures(),300,220,2026);
    expect(profile.values).toHaveLength(8760);
    expect(profile.meta.annualMwh).toBeCloseTo(300,3);
    expect(profile.meta.peakKw).toBeLessThanOrEqual(220.01);
    expect(Math.min(...profile.values)).toBeGreaterThanOrEqual(0);
  });

  it('erzeugt für Schule und Wohnen unterschiedliche Wochenverläufe',()=>{
    const temp=temperatures();
    const school=buildBuildingHeatProfile({nutzung:'schule'},temp,300,500,2026).values;
    const home=buildBuildingHeatProfile({nutzung:'mfh'},temp,300,500,2026).values;
    // 2026 beginnt an einem Donnerstag: Tag 2 ist Samstag.
    const saturday=2*24;
    const monday=4*24;
    const ratio=(values,offset)=>values.slice(offset,offset+24).reduce((sum,value)=>sum+value,0);
    expect(ratio(school,saturday)/ratio(school,monday))
      .toBeLessThan(ratio(home,saturday)/ratio(home,monday));
    expect(Array.from(school).some((value,index)=>Math.abs(value-home[index])>0.01)).toBe(true);
  });

  it('summiert nur im Betrachtungsjahr aktive Gebäude bilanziell',()=>{
    const buildings=[
      {id:1,nutzung:'efh',waerme:100,heizlast:80},
      {id:2,nutzung:'schule',waerme:200,heizlast:160},
      {id:3,nutzung:'buero',waerme:400,heizlast:300},
    ];
    const result=buildBuildingHeatProfiles(
      buildings,temperatures(),2026,
      building=>building.id===3
        ? {waerme:0,heizlast:0,status:'geplant'}
        : {waerme:building.waerme,heizlast:building.heizlast,status:'bestand'});
    expect(result.profiles.size).toBe(2);
    expect(result.aggregate.reduce((sum,value)=>sum+value,0)/1000).toBeCloseTo(300,3);
  });

  it('ordnet unbekannte eigene Nutzungen transparent dem GHD-Fallback zu',()=>{
    expect(getBuildingHeatProfileMeta({nutzung:'sonderlabor'})).toMatchObject({
      type:'ghd',sigLinDe:'GHD34',
    });
  });
});

import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('Planungsmutationen verwenden die zentrale Transaktion',()=>{
  it.each(['src/14d-selektion.js','src/14e-ausbauplaner-ui.js','src/14g-cluster-map.js'])('%s',file=>{
    const source=readFileSync(file,'utf8');
    expect(source).toMatch(/runPlanningTransaction/);
  });
});

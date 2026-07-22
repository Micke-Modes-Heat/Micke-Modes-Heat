import { beforeEach,describe,expect,it } from 'vitest';
import { clearDiagnostics,getDiagnostics,reportDiagnostic } from '../src/lib/diagnostics.js';
describe('Diagnosezentrum',()=>{
  beforeEach(clearDiagnostics);
  it('speichert Meldung und konkrete Handlung ohne Projektdaten',()=>{
    reportDiagnostic({severity:'warning',area:'Import',message:'Datei unvollständig',action:'Quelldatei prüfen'});
    expect(getDiagnostics()).toEqual([expect.objectContaining({severity:'warning',area:'Import',message:'Datei unvollständig',action:'Quelldatei prüfen'})]);
  });
});

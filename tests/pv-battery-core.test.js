import { describe, expect, it } from 'vitest';
import { pvBatteryStep } from '../src/lib/pv-battery-core.js';

describe('kanonischer PV-/Batterie-Stundenschritt', () => {
  it('lädt Überschuss und entlädt später mit einheitlichem Wirkungsgrad', () => {
    const charged = pvBatteryStep({demand:0,pvGen:10,bhkwGen:0,socKwh:0,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:.9});
    expect(charged.socKwh).toBe(10);
    const discharged = pvBatteryStep({demand:10,pvGen:0,bhkwGen:0,socKwh:charged.socKwh,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:.9});
    expect(discharged.residualDemand).toBe(1);
    expect(discharged.lossesKwh).toBeCloseTo(1, 10);
  });

  it('teilt lokale Erzeugung reproduzierbar nach PV und BHKW auf', () => {
    const r = pvBatteryStep({demand:6,pvGen:3,bhkwGen:1,socKwh:0,capacityKwh:0,powerKw:0});
    expect(r.direct).toBe(4);
    expect(r.pvFraction).toBe(.75);
    expect(r.residualDemand).toBe(2);
  });

  it('merkt sich die Quelle über Laden am Tag und Entladen in der Nacht',()=>{
    const charged=pvBatteryStep({demand:0,pvGen:10,bhkwGen:0,socKwh:0,socPvKwh:0,socBhkwKwh:0,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:.9});
    const discharged=pvBatteryStep({demand:9,pvGen:0,bhkwGen:0,socKwh:charged.socKwh,socPvKwh:charged.socPvKwh,socBhkwKwh:charged.socBhkwKwh,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:.9});
    expect(discharged.pvDischargedKwh).toBeCloseTo(9,10);
    expect(discharged.bhkwDischargedKwh).toBeCloseTo(0,10);
    expect(discharged.socPvKwh).toBeCloseTo(0,10);
  });

  it('führt gemischte PV- und BHKW-Ladung quellenscharf fort',()=>{
    const charged=pvBatteryStep({demand:0,pvGen:6,bhkwGen:4,socKwh:0,socPvKwh:0,socBhkwKwh:0,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:1});
    const discharged=pvBatteryStep({demand:5,pvGen:0,bhkwGen:0,socKwh:charged.socKwh,socPvKwh:charged.socPvKwh,socBhkwKwh:charged.socBhkwKwh,capacityKwh:10,powerKw:10,etaCharge:1,etaDischarge:1});
    expect(discharged.pvDischargedKwh).toBeCloseTo(3,10);
    expect(discharged.bhkwDischargedKwh).toBeCloseTo(2,10);
  });
});

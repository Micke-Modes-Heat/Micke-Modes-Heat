import { describe, expect, it } from 'vitest';
import { estimateBatteryAging } from '../src/lib/battery-aging.js';

describe('Batteriealterung', () => {
  it('kombiniert Kalender- und Zyklusalterung nachvollziehbar', () => {
    const r = estimateBatteryAging({capacityKwh:100,annualDischargeKwh:30000,calendarFadePctPerYear:1,cycleLife:6000,eolCapacityPct:80,studyYears:20});
    expect(r.cyclesPerYear).toBe(300);
    expect(r.annualFadePct).toBeCloseTo(2, 10);
    expect(r.expectedLifeYears).toBeCloseTo(10, 10);
    expect(r.replacements).toBe(1);
  });

  it('bleibt ohne Batterie numerisch stabil', () => {
    const r = estimateBatteryAging({capacityKwh:0,annualDischargeKwh:0,calendarFadePctPerYear:0,cycleLife:6000,eolCapacityPct:80});
    expect(r.cyclesPerYear).toBe(0);
    expect(r.expectedLifeYears).toBe(Infinity);
  });
});

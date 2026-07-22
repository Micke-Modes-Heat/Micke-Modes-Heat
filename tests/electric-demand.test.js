import { describe, expect, it } from 'vitest';
import { addHourlyElectricLoad, hourlyEnergyMwh } from '../src/lib/electric-demand.js';

describe('gemeinsame elektrische Nachfrage einschließlich Kälte', () => {
  it('addiert die Kältelast stundenscharf', () => {
    const demand = new Float32Array([10, 20, 30]);
    expect(Array.from(addHourlyElectricLoad(demand, new Float32Array([1, 2, 3])))).toEqual([11, 22, 33]);
  });

  it('bilanziert Energie in MWh und bewahrt Nullstunden', () => {
    expect(hourlyEnergyMwh(new Float32Array([0, 250, 750]))).toBe(1);
    expect(hourlyEnergyMwh(null)).toBe(0);
  });

  it('lehnt unvollständige oder verschobene Reihen ab', () => {
    expect(() => addHourlyElectricLoad(new Float32Array(8760), new Float32Array(8759))).toThrow(RangeError);
  });
});

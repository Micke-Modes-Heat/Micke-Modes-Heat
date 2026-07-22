import { describe, expect, it } from 'vitest';
import { copyWorkerSeries } from '../src/lib/worker-series.js';

describe('Worker-Zeitreihentransport', () => {
  it('erzeugt unabhängige Float32-Fallbackkopien', () => {
    const source = new Float32Array([1,2,3]);
    const copy = copyWorkerSeries(source,false);
    copy[0]=9;
    expect(source[0]).toBe(1);
  });

  it('nutzt SharedArrayBuffer ohne semantische Abweichung, falls verfügbar', () => {
    if (typeof SharedArrayBuffer === 'undefined') return;
    const shared = copyWorkerSeries(new Float32Array([1,2,3]),true);
    expect(shared.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(Array.from(shared)).toEqual([1,2,3]);
  });
});

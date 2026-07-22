import { describe, expect, it } from 'vitest';
import { createId } from '../src/lib/util.js';

describe('createId', () => {
  it('erzeugt eindeutige IDs mit sicherem Präfix', () => {
    const ids = new Set(Array.from({length: 1000}, () => createId('asset test')));
    expect(ids.size).toBe(1000);
    expect([...ids].every(id => id.startsWith('asset_test_'))).toBe(true);
  });
});

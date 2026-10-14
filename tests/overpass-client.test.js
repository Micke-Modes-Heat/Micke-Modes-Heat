import { describe, it, expect } from 'vitest';
import { overpassAbfrage, serverTimeoutS, abfrageSchluessel, pauseNachAntwort, OVERPASS_SERVER, overpassPausen } from '../src/lib/overpass-client.js';

const antwort = (status, daten = { elements: [{ id: 1 }] }, kopf = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: k => kopf[k] ?? null }, json: async () => daten,
});

describe('Overpass-Zugriff', () => {
  it('Hilfsfunktionen: Server-Timeout, Schlüssel, Pausen', () => {
    expect(serverTimeoutS('[out:json][timeout:30];way(1,2,3,4);out;')).toBe(30);
    expect(serverTimeoutS('way;out;')).toBe(25);
    expect(abfrageSchluessel('a  b')).toBe(abfrageSchluessel('a b'));
    expect(abfrageSchluessel('a')).not.toBe(abfrageSchluessel('b'));
    expect(pauseNachAntwort(429)).toBe(60000);
    expect(pauseNachAntwort(429, '120')).toBe(120000);
    expect(pauseNachAntwort(504)).toBe(20000);
    expect(pauseNachAntwort('timeout')).toBe(20000);
    expect(pauseNachAntwort(400)).toBe(0);
  });

  it('Server nacheinander: nach 429 der nächste, der gesperrte pausiert; Antwort wird zwischengespeichert', async () => {
    const aufrufe = [];
    const abrufen = async url => { aufrufe.push(url); return url === OVERPASS_SERVER[0].url ? antwort(429) : antwort(200); };
    const q = '[out:json][timeout:5];way["highway"](1,2,3,4);out;';
    const d = await overpassAbfrage(q, { abrufen, warten: async () => {} });
    expect(d.elements).toHaveLength(1);
    expect(aufrufe).toEqual([OVERPASS_SERVER[0].url, OVERPASS_SERVER[1].url]);
    expect(overpassPausen()[0].restS).toBeGreaterThan(50);
    // gleiche Abfrage: aus dem Zwischenspeicher, kein weiterer Aufruf
    const d2 = await overpassAbfrage(q, { abrufen, warten: async () => {} });
    expect(d2).toEqual(d);
    expect(aufrufe).toHaveLength(2);
    // frisch: der pausierte erste Server wird übersprungen
    await overpassAbfrage(q, { abrufen, frisch: true, warten: async () => {} });
    expect(aufrufe.slice(2)).toEqual([OVERPASS_SERVER[1].url]);
  });

  it('eine Anfrage zur Zeit (Warteschlange)', async () => {
    let gleichzeitig = 0, maxGleich = 0;
    const abrufen = async () => { gleichzeitig++; maxGleich = Math.max(maxGleich, gleichzeitig); await new Promise(r => setTimeout(r, 5)); gleichzeitig--; return antwort(200); };
    await Promise.all([1, 2, 3].map(i => overpassAbfrage(`[timeout:5];node(${i});out;`, { abrufen, warten: async () => {} })));
    expect(maxGleich).toBe(1);
  });

  it('Laufzeitfehler des Servers zählt als Fehlschlag; alle gescheitert → null', async () => {
    const abrufen = async () => antwort(200, { elements: [], remark: 'runtime error: Query timed out' });
    const d = await overpassAbfrage('[timeout:5];node(99);out;', { abrufen, runden: 1, warten: async () => {} });
    expect(d).toBeNull();
  });
});

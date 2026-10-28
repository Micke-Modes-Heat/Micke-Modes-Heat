// Prinzip-Energiesystem-Ist / -Zielbild: Export der Tool-Figur „Energiesystem der Liegenschaft im Überblick“
// (src/17-gutachten-grafik.js, ggRenderEnergiesystem) mit einer erfundenen Beispiel-Liegenschaft. Werte und
// Netzbetreiber bleiben leer, damit die Skizze allgemein gilt — im Gutachten rechnet das Tool mit den Projektdaten.
import { schreibe } from './_basis.mjs';

// 17 baut das SVG über document.createElementNS; hier genügt ein Gerüst, das Attribute und Inhalt sammelt
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ attrs: {}, html: '', setAttribute(k, v) { this.attrs[k] = v; }, set innerHTML(v) { this.html = v; } }),
  getElementById: () => null,
};
const { ggRenderEnergiesystem } = await import('../../../src/17-gutachten-grafik.js');
const { esModell } = await import('../../../src/lib/energiesystem.js');

const pv = geplant => ({ typ: 'PV', props: {}, geplant });

/** Zahlen herausnehmen: nur die Struktur, keine Leistungen oder Anteile. */
function allgemein(m) {
  for (const e of [...m.strom, ...m.kopplung, ...m.waerme]) {
    e.zeile = e.speicher ? (m.strom.includes(e) ? 'Laden / Entladen' : 'Lastverschiebung') : '';
    if (e.zeilePlan) e.zeilePlan = '+ Ausbau geplant';
  }
  if (m.lade) m.lade.zeile = 'Ladepunkte';
  m.quellen.find(q => q.key === 'strom').zeile = 'Netzbetreiber';
  m.netzSpannung = 'Mittelspannung';
  m.nap = { ...m.nap, anschluss: 'laut Vertrag', einspeisung: '' };
  m.stromSchiene = 'Trafostationen · NS-Verteilung';
  m.verbraucher = { strom: 'Jahresverbrauch', stromMax: 'Höchstlast', waerme: 'Jahresbedarf', heizlast: 'Heizlast' };
  return m;
}

const faelle = [
  ['Prinzip-Energiesystem-Ist.svg', 'Energiesystem · Ist-Zustand (Beispiel)', esModell({
    stand: 'ist',
    strom: [pv(false), { typ: 'Nsa', props: {} }],
    waermeIst: { erzeuger: [{ id: 'k', typ: 'bw_gaskessel' }, { id: 'b', typ: 'bhkw_gas' }], pufferM3: '10' },
    heizzentrale: 'Heizzentrale',
    netz: { spannung: 'Mittelspannung' },
    verbrauch: { stromMwh: 1, waermeMwh: 1 },
  })],
  ['Prinzip-Energiesystem-Zielbild.svg', 'Energiesystem · Zielbild (Beispiel)', esModell({
    stand: 'ziel',
    strom: [pv(false), pv(true), { typ: 'Batterie', props: {}, geplant: true }, { typ: 'Nsa', props: {} },
            { typ: 'Lade', props: {}, geplant: true }],
    waermeZiel: [{ key: 'bhkw', waermeMwh: 1 }, { key: 'lwwp', waermeMwh: 1 }, { key: 'gaskessel', waermeMwh: 1, spitze: true },
                 { key: 'solarthermie', waermeMwh: 1 }, { key: 'speicher', waermeMwh: 1 }],
    heizzentrale: 'Heizzentrale',
    netz: { spannung: 'Mittelspannung' },
    verbrauch: { stromMwh: 1, waermeMwh: 1 },
  })],
];

for (const [datei, eyebrow, modell] of faelle) {
  const m = allgemein(modell);
  if (m.stand === 'ziel') m.waerme.find(e => e.key === 'gaskessel').zeile = '';
  const svg = ggRenderEnergiesystem({ eyebrow, titel: 'Energiesystem der Liegenschaft im Überblick', modell: m,
    fussnote: 'Prinzipskizze ohne Auslegung und ohne Lagebezug; im Gutachten erzeugt das Tool die Abbildung aus den Projektdaten.' });
  const a = svg.attrs;
  schreibe(datei, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a.viewBox}" width="${a.width}" height="${a.height}">${svg.html}</svg>`);
}

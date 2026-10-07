// ── 37-lod2-import.js — Dachflächen aus amtlichen LoD2-Gebäudemodellen ───────
//
// Knopf „🏠 Dachflächen aus LoD2 laden …" (Reiter Gebiet → Gebäude laden).
// Liest eine oder mehrere CityGML-Dateien (.gml/.xml, auch als .zip, wie sie die
// Geoportale der Länder kachelweise anbieten), ordnet die LoD2-Gebäude über den
// Grundriss den Projektgebäuden zu und schreibt je Gebäude:
//   g.dachFlaechen  [{ id, punkte:[[lat,lng,h]], neigung, azimut, flaecheM2, grundM2 }]
//   g.dachLod2      { gmlId, traufeM, firstM, bodenGeschaetzt, waende:[[[lat,lng,h]]] }
//   dachform/dachNeigung/dachAzimut als abgeleitete Hauptwerte, dachQuelle = 'lod2'
// Das sind Dachdaten — sie gelten für alle Varianten. Belegungen bleiben, auf
// Wunsch werden belegte Dächer auf die LoD2-Flächen umgestellt (aktive Variante).
//
// Lesen und Geometrie: lib/lod2-citygml.js (rein, getestet). Belegen je Fläche:
// 25 pvmStapelBelegen, Modulraster und Ertrag je Fläche: 03c.

import { lod2Dachdaten, lod2Dachform, lod2Parsen, lod2Zone, lod2Zuordnen, wgs84NachUtm } from './lib/lod2-citygml.js';
import { dachAusGrundriss } from './lib/dach-grundriss.js';
import { richteRechtwinklig } from './lib/gebaeude-geometrie.js';
import { d3dRahmen } from './lib/dach-3d.js';
import { _hasBelegung, getDachDefaultNeigung, redrawGebPvModules } from './03c-gebaeude-io.js';
import { pvmStapelBelegen } from './25-pv-modus.js';

const _warte = () => new Promise(r => setTimeout(r, 30));

/** Dateiauswahl öffnen. */
export function lod2DateiWaehlen() {
  const gebs = (window.gebaeude || []).filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3);
  if (!gebs.length) {
    alert('Erst Gebäude laden (OSM- bzw. Kataster-Import) — die LoD2-Dachflächen werden den vorhandenen Grundrissen zugeordnet.');
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = '.gml,.xml,.zip,.citygml';
  inp.addEventListener('change', () => { if (inp.files?.length) lod2Importieren([...inp.files]); });
  inp.click();
}

/* ── ZIP (Geoportale liefern Kacheln gezippt) ─────────────────────────────── */

/**
 * Alle .gml/.xml-Einträge eines ZIP-Archivs als Text. Liest das zentrale
 * Verzeichnis selbst und entpackt per DecompressionStream('deflate-raw') —
 * keine Bibliothek nötig, läuft offline im Single-File.
 */
async function _zipTexte(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP-Verzeichnis nicht gefunden');
  const anzahl = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = [];
  for (let k = 0; k < anzahl; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const methode = dv.getUint16(p + 10, true);
    const groesse = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), komLen = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + komLen;
    if (!/\.(gml|xml)$/i.test(name)) continue;
    const lNameLen = dv.getUint16(lokal + 26, true), lExtraLen = dv.getUint16(lokal + 28, true);
    const daten = new Uint8Array(buf, lokal + 30 + lNameLen + lExtraLen, groesse);
    let bytes;
    if (methode === 0) bytes = daten;
    else if (methode === 8) {
      const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(strom).arrayBuffer());
    } else continue;
    out.push({ name, text: dec.decode(bytes) });
  }
  return out;
}

async function _texte(files) {
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) out.push(...await _zipTexte(await f.arrayBuffer()));
    else out.push({ name: f.name, text: await f.text() });
  }
  return out;
}

/* ── Import ───────────────────────────────────────────────────────────────── */

/** Bereich der Projektgebäude in UTM (± Rand) — Vorfilter beim Lesen. */
function _projektBereich(gebs, zone, randM = 150) {
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const g of gebs) for (const p of g.polygon) {
    const u = wgs84NachUtm(p.lat, p.lng, zone);
    if (u.E < e0) e0 = u.E; if (u.E > e1) e1 = u.E; if (u.N < n0) n0 = u.N; if (u.N > n1) n1 = u.N;
  }
  return (E, N) => E >= e0 - randM && E <= e1 + randM && N >= n0 - randM && N <= n1 + randM;
}

/** Mehrere LoD2-Gebäude (z. B. Haus + Anbau) zu einem Projektgebäude zusammenlegen. */
function _zusammen(liste) {
  if (liste.length === 1) return liste[0];
  let id = 0;
  const dachFlaechen = liste.flatMap(d => d.dachFlaechen.map(f => ({ ...f, id: ++id })));
  return {
    dachFlaechen,
    lod2: {
      gmlId: liste.map(d => d.lod2.gmlId).join(','),
      traufeM: Math.min(...liste.map(d => d.lod2.traufeM)),
      firstM: Math.max(...liste.map(d => d.lod2.firstM)),
      bodenGeschaetzt: liste.some(d => d.lod2.bodenGeschaetzt),
      waende: liste.flatMap(d => d.lod2.waende),
    },
    dachform: lod2Dachform(null, dachFlaechen),
    dachNeigung: liste[0].dachNeigung,
    dachAzimut: [...liste].sort((a, b) => b.dachFlaechen.reduce((s, f) => s + f.grundM2, 0)
      - a.dachFlaechen.reduce((s, f) => s + f.grundM2, 0))[0].dachAzimut,
  };
}

/**
 * Nach neuen Dachdaten: Belegungen der Gebäude in `umstellen` auf die Dach-
 * flächen umstellen (alte Belegungen und automatische Nordseiten weg, eigene
 * Sperrflächen bleiben — direkt statt removeGebPvFlaeche, das je Fläche das
 * Stromnetz nachrechnet), übrige belegte Dächer neu platzieren, alles neu zeichnen.
 * @returns {{anzahl:number, summe:number}}
 */
function _nachlauf(gebs, umstellen) {
  let neu = { anzahl: 0, summe: 0 };
  if (umstellen.length) {
    for (const g of umstellen) {
      const weg = (g.pvFlaechen || []).filter(fl => fl.typ === 'belegung' || fl.auto === 'nord');
      for (const fl of weg) {
        if (fl.layer) window.map?.removeLayer(fl.layer);
        if (fl.svgLayer) window.map?.removeLayer(fl.svgLayer);
      }
      g.pvFlaechen = (g.pvFlaechen || []).filter(fl => !weg.includes(fl));
    }
    neu = pvmStapelBelegen(umstellen);
  }
  for (const g of gebs) {
    if (!umstellen.includes(g) && _hasBelegung(g)) redrawGebPvModules(g);
    window._rerenderCard?.(g.id);
    window._updateGebLabelPv?.(g.id);
  }
  window.updateViz?.();
  window.calcStromPanel?.();
  window.pvModusRender?.();
  window.d3dNachViz?.();
  return neu;
}

/**
 * Dateien lesen, zuordnen, nach Rückfrage übernehmen.
 * @param {File[]} files
 */
export async function lod2Importieren(files) {
  const gebs = (window.gebaeude || []).filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3);
  window.showHint?.('⏳ LoD2-Datei wird gelesen …', 0);
  await _warte();
  let daten = [], gesamt = 0, ohneZone = 0;
  try {
    const bereiche = {};
    for (const { text } of await _texte(files)) {
      const zone = lod2Zone(text);
      if (!zone) { ohneZone++; continue; }
      bereiche[zone] = bereiche[zone] || _projektBereich(gebs, zone);
      const r = lod2Parsen(text, { imBereich: bereiche[zone] });
      gesamt += r.gesamt;
      for (const geb of r.gebaeude) {
        const d = lod2Dachdaten(geb, zone);
        if (d.dachFlaechen.length) daten.push(d);
      }
      await _warte();
    }
  } catch (err) {
    console.error(err);
    window.hideHint?.();
    alert('LoD2-Datei konnte nicht gelesen werden:\n' + err.message);
    return;
  }
  window.hideHint?.();
  if (!daten.length) {
    alert(gesamt
      ? `Die Datei enthält ${gesamt} Gebäude, aber keins liegt im Projektgebiet.\n\nStimmt die Kachel? Die Kachelnummer im Geoportal muss das Gebiet der geladenen Gebäude abdecken.`
      : ohneZone
        ? 'Kein bekanntes Koordinatensystem gefunden. Unterstützt: ETRS89/UTM Zone 32 oder 33 (EPSG:25832/25833) — so liefern die Länder LoD2 aus.'
        : 'In der Datei wurden keine Gebäude mit Dachflächen (bldg:RoofSurface) gefunden.');
    return;
  }

  const { zuordnung, ohne } = lod2Zuordnen(daten, gebs);
  const nachId = new Map(gebs.map(g => [g.id, g]));
  const ziele = [...zuordnung.entries()].map(([gid, idx]) => ({ g: nachId.get(gid), d: _zusammen(idx.map(i => daten[i])) }));
  const flaechen = ziele.reduce((s, z) => s + z.d.dachFlaechen.length, 0);
  const schonLod2 = ziele.filter(z => z.g.dachQuelle === 'lod2').length;
  const belegt = ziele.filter(z => _hasBelegung(z.g));
  if (!confirm(`LoD2: ${daten.length} Gebäude im Projektgebiet gefunden.\n\n`
      + `• ${ziele.length} Projektgebäude erhalten ${flaechen} Dachflächen mit Neigung und Ausrichtung`
      + (schonLod2 ? ` (${schonLod2} davon hatten schon LoD2-Daten — werden ersetzt)` : '') + '\n'
      + (ohne.length ? `• ${ohne.length} LoD2-Gebäude ohne passenden Grundriss im Projekt (bleiben unberücksichtigt)\n` : '')
      + `• ${gebs.length - ziele.length} Projektgebäude ohne LoD2-Daten\n\n`
      + 'Dachform, Neigung und Ausrichtung dieser Gebäude werden aus LoD2 übernommen. Übernehmen?')) return;

  let umstellen = false;
  if (belegt.length) {
    umstellen = confirm(`${belegt.length} dieser Gebäude haben schon eine PV-Belegung.\n\n`
      + 'OK = Belegung auf die LoD2-Dachflächen umstellen (je Dachfläche eine Belegungsfläche, Nordflächen nach den Vorgaben des PV-Modus ausgelassen; gilt für die aktive Variante, eigene Sperrflächen bleiben; die alte Belegung lässt sich danach nicht per Strg+Z zurückholen).\n'
      + 'Abbrechen = vorhandene Belegungen unverändert lassen.');
  }

  window.showHint?.('⏳ Dachflächen werden übernommen …', 0);
  await _warte();
  for (const { g, d } of ziele) {
    g.dachFlaechen = d.dachFlaechen;
    g.dachLod2 = { ...d.lod2, quelle: 'lod2' };
    g.dachform = d.dachform;
    if (d.dachNeigung != null) g.dachNeigung = d.dachNeigung;
    if (d.dachAzimut != null) { g.dachAzimut = d.dachAzimut; g.dachAutoAzimut = false; }
    g.dachQuelle = 'lod2';
    delete g.pvRidgeOverride;
    g._pvModSig = null;
  }
  const neu = _nachlauf(ziele.map(z => z.g), umstellen ? belegt.map(z => z.g) : []);
  window.hideHint?.();
  window.showHint?.(`✓ LoD2: ${ziele.length} Gebäude mit ${flaechen} Dachflächen`
    + (umstellen ? ` · ${neu.anzahl} Dächer neu belegt (Σ ${Math.round(neu.summe)} kWp)` : ''), 8000);
}

/* ── Dachflächen aus dem Grundriss (ohne LoD2) ────────────────────────────── */
// Für Gebäude ohne LoD2-Modell: lib/dach-grundriss.js zerlegt den rechtwinklig
// ausgerichteten Grundriss in Flügel und berechnet daraus Dachflächen und
// Giebel — gleiche Datenform wie LoD2 (g.dachLod2.quelle = 'grundriss').
// Eingaben sind die Dachangaben des Gebäudes (Form, Neigung, bei Pultdach bzw.
// manuell gesetzt auch der Azimut); ändern sie sich oder der Grundriss, rechnet
// dachGrundrissNeu die Flächen neu (Haken in 03c updateGebDach/_finishGrundrissChange).

/**
 * Dachdaten aus dem Grundriss eines Gebäudes, null wenn der Grundriss nicht
 * rechtwinklig genug ist (schräge Kanten, Rundungen) — dann bleibt das bisherige
 * Ein-Dach-Modell.
 */
export function dachAusGrundrissFuer(g) {
  if (!Array.isArray(g?.polygon) || g.polygon.length < 3) return null;
  const r = richteRechtwinklig(g.polygon.map(p => ({ lat: p.lat, lng: p.lng })));
  if (!r || r.diagonaleKanten > 0 || r.abweichungProzent > 5) return null;
  let la = 0, ln = 0;
  for (const p of r.coords) { la += p.lat; ln += p.lng; }
  const rahmen = d3dRahmen(ln / r.coords.length, la / r.coords.length);
  const form = ['sattel', 'walm', 'pult', 'flach'].includes(g.dachform) ? g.dachform : 'sattel';
  const traufe = Math.max(1, Math.min(60, parseInt(g.stockwerke, 10) || 1)) * 3;
  const azimut = form === 'pult' ? (g.dachAzimut ?? null)
    : (g.dachAzimut != null && !g.dachAutoAzimut ? g.dachAzimut : null);
  const d = dachAusGrundriss(r.coords.map(p => rahmen.nachXY(p.lng, p.lat)), {
    form, neigung: form === 'flach' ? 0 : (g.dachNeigung ?? getDachDefaultNeigung(form)), traufe, azimut,
  });
  if (!d || !d.flaechen.length) return null;
  const ll = q => { const [lng, lat] = rahmen.nachLL(q[0], q[1]); return [lat, lng, Math.round(q[2] * 100) / 100]; };
  return {
    dachFlaechen: d.flaechen.map((f, i) => ({ id: i + 1, punkte: f.ring.map(ll), neigung: f.neigung, azimut: f.azimut,
      grundM2: f.grundM2, flaecheM2: Math.round(f.grundM2 / Math.cos(f.neigung * Math.PI / 180) * 10) / 10 })),
    lod2: { quelle: 'grundriss', gmlId: null, traufeM: traufe, firstM: Math.round(d.firstH * 100) / 100,
      bodenGeschaetzt: false, waende: d.waende.map(w => w.map(ll)) },
    fluegel: d.fluegel,
  };
}

/** Knopf „📐 Dachflächen aus Grundriss berechnen". */
export async function dachGrundrissBerechnen() {
  const alle = (window.gebaeude || []).filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3);
  const auswahl = alle.filter(g => g.selected);
  const basis = (auswahl.length ? auswahl : alle).filter(g => g.dachQuelle !== 'lod2');
  if (!basis.length) {
    alert(alle.length ? 'Alle Gebäude haben schon LoD2-Dachflächen.' : 'Erst Gebäude laden oder zeichnen.');
    return;
  }
  window.showHint?.('⏳ Dachflächen werden berechnet …', 0);
  await _warte();
  const ziele = [], schief = [];
  for (const g of basis) {
    const d = dachAusGrundrissFuer(g);
    if (d) ziele.push({ g, d }); else schief.push(g);
  }
  window.hideHint?.();
  if (!ziele.length) {
    alert(`Keiner der ${basis.length} Grundrisse ist rechtwinklig genug (schräge Kanten oder Rundungen) — dort bleibt das bisherige Dachmodell.`);
    return;
  }
  const formen = {};
  for (const { g } of ziele) formen[g.dachform || 'sattel'] = (formen[g.dachform || 'sattel'] || 0) + 1;
  const mehrflueglig = ziele.filter(z => z.d.fluegel > 1).length;
  const belegt = ziele.filter(z => _hasBelegung(z.g));
  if (!confirm(`Dachflächen aus dem Grundriss für ${ziele.length} Gebäude${auswahl.length ? ' (Auswahl)' : ''} berechnen?\n\n`
      + `• Dachform je Gebäude wie eingestellt: ${Object.entries(formen).map(([f, n]) => `${n}× ${f}`).join(', ')}\n`
      + `• ${mehrflueglig} davon mit mehreren Flügeln (L/T/U-Form → Kehlen und Giebel)\n`
      + (schief.length ? `• ${schief.length} Grundrisse nicht rechtwinklig genug — bleiben beim bisherigen Modell\n` : '')
      + '• Gebäude mit LoD2-Daten bleiben unberührt.\n\n'
      + 'Die Flächen folgen später automatisch, wenn Dachform, Neigung oder Grundriss geändert werden.')) return;
  let umstellen = false;
  if (belegt.length) {
    umstellen = confirm(`${belegt.length} dieser Gebäude haben schon eine PV-Belegung.\n\n`
      + 'OK = Belegung auf die berechneten Dachflächen umstellen (je Dachfläche eine Belegungsfläche; aktive Variante; eigene Sperrflächen bleiben; nicht per Strg+Z rückgängig).\n'
      + 'Abbrechen = vorhandene Belegungen unverändert lassen.');
  }
  for (const { g, d } of ziele) { g.dachFlaechen = d.dachFlaechen; g.dachLod2 = d.lod2; g._pvModSig = null; }
  const neu = _nachlauf(ziele.map(z => z.g), umstellen ? belegt.map(z => z.g) : []);
  window.showHint?.(`✓ Dachflächen für ${ziele.length} Gebäude berechnet`
    + (umstellen ? ` · ${neu.anzahl} Dächer neu belegt (Σ ${Math.round(neu.summe)} kWp)` : ''), 8000);
}

/**
 * Berechnete Dachflächen nach einer Änderung (Dachform, Neigung, Azimut,
 * Grundriss) neu ableiten. Belegungen, die aus Dachflächen entstanden sind,
 * werden auf die neuen Flächen übertragen. Klappt die Berechnung nicht mehr
 * (Grundriss jetzt schräg), fällt das Gebäude aufs bisherige Modell zurück.
 */
export function dachGrundrissNeu(g) {
  if (g?.dachLod2?.quelle !== 'grundriss') return;
  const d = dachAusGrundrissFuer(g);
  if (d) { g.dachFlaechen = d.dachFlaechen; g.dachLod2 = d.lod2; }
  else { delete g.dachFlaechen; delete g.dachLod2; }
  g._pvModSig = null;
  window.pvmDachflaechenNeuBelegen?.(g);
  if (_hasBelegung(g)) redrawGebPvModules(g);
  window.d3dNachViz?.();
}

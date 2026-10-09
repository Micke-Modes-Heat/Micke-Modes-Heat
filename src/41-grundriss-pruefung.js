// ── 41-grundriss-pruefung.js — überlappende Gebäudegrundrisse prüfen ─────────
//
// Überlappende Grundrisse (Gebäudeteile als eigene Gebäude, OSM und ALKIS
// doppelt, Neubau über Bestand) verfälschen Wärme- und Strombedarf, das
// Dachpotenzial und die Verschattung. Das Panel listet die Paare
// (lib/grundriss-ueberlappung.js) mit einer Empfehlung und den Aktionen:
//   👁 zeigen · ⇥ aufnehmen (das eine geht im anderen auf, dessen Umriss bleibt;
//   PV-Flächen werden übernommen — für Gebäudeteile und Doppelerfassungen) ·
//   ⧉ zusammenfügen (Umrisse vereinigen — nur, wenn eine exakte Kontur gelingt;
//   sonst käme die konvexe Hülle heraus und schlösse Nachbargebäude ein) ·
//   🗑 löschen · ✓ so lassen.
// „So lassen" wird im Projekt gespeichert (project.grundrissPruefung.ok).
// Zusammenfügen und Löschen sind — wie im Gebäude-Panel — nicht per Strg+Z
// umkehrbar; beides fragt vorher nach.

import { map } from './02b-gebaeude.js';
import { _hasBelegung, escHtml, showHint } from './03c-gebaeude-io.js';
import { getAssetsForBuilding } from './13a-assets-core.js';
import { guRing, guUeberlappungen, guSchluessel, GU_DECKUNG } from './lib/grundriss-ueberlappung.js';
import { vereinigePolygone } from './lib/gebaeude-geometrie.js';

const PANEL_ID = 'grundriss-panel';
const PANE = 'grundrissPruefPane';
const ORANGE = '#ffb74d';
const ROT = '#e53935';
const CYAN = '#4dd0e1';
const ART = {
  doppelt:   { text: 'Doppelerfassung', farbe: ROT },
  enthalten: { text: 'Gebäudeteil im Gebäude', farbe: ORANGE },
  teil:      { text: 'Teilüberlappung', farbe: '#fdd835' },
};

const _ok = new Set();
let _offen = false;
let _zeigeOk = false;
let _layer = null;
let _markiert = null;      // Schlüssel des gezeigten Paars

const _fmt = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const _geb = id => (window.gebaeude || []).find(g => g.id === id) || null;
const _name = g => g?.name || ('Gebäude ' + g?.id);
const _jahr = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 1000 ? n : null; };

/* ── Daten ────────────────────────────────────────────────────────────────── */

export function grundrissCapture() { return { ok: [..._ok] }; }

export function grundrissRestore(s) {
  _ok.clear();
  for (const k of s?.ok || []) if (typeof k === 'string') _ok.add(k);
  _markierungWeg();
  grundrissPanelRender();
}

/** Alle überlappenden Paare im Projekt. */
export function grundrissUeberlappungen() {
  const gebs = (window.gebaeude || []).map(g => ({ id: g.id, ring: guRing(g.polygon), baujahr: _jahr(g.baujahr), abrissjahr: _jahr(g.abrissjahr) }));
  return guUeberlappungen(gebs, { ok: _ok });
}

/** Wie viele Angaben hängen an einem Gebäude? (Vorschlag: das mit weniger löschen) */
function _gewicht(g) {
  if (!g) return 0;
  return (_hasBelegung(g) ? 4 : 0) + getAssetsForBuilding(g.id).length * 2
    + (g.waermeManual || g.heizlastManual ? 3 : 0) + (g.massnahmen?.length ? 2 : 0)
    + (g.dachQuelle ? 1 : 0) + (g.fromOsm ? 0 : 1) + (/^Gebäude \d+$/.test(g.name || '') ? 0 : 1);
}

/** Empfehlung zu einem Paar: Text und welches Gebäude betroffen ist. */
function _empfehlung(u, A, B) {
  if (u.art === 'doppelt') {
    const weg = _gewicht(A) < _gewicht(B) ? A : _gewicht(B) < _gewicht(A) ? B
      : ((+A.flaeche || 0) <= (+B.flaeche || 0) ? A : B);
    const bleibt = weg === A ? B : A;
    return { text: `Dasselbe Gebäude zweimal erfasst — „${_name(weg)}" (weniger Angaben) in „${_name(bleibt)}" aufnehmen; seine PV-Flächen gehen mit.`, ziel: bleibt.id, loeschen: weg.id };
  }
  if (u.art === 'enthalten') {
    const klein = u.anteilA >= u.anteilB ? A : B, gross = klein === A ? B : A;
    return { text: `„${_name(klein)}" liegt zu ${_fmt(Math.max(u.anteilA, u.anteilB) * 100)} % in „${_name(gross)}" — in „${_name(gross)}" aufnehmen (PV-Flächen gehen mit) oder, wenn es ein eigener Bauteil mit anderer Höhe ist (z. B. ein Turm auf einem Sockelbau), so lassen.`, ziel: gross.id };
  }
  const anteil = Math.max(u.anteilA, u.anteilB);
  return anteil >= 0.2
    ? { text: `Die Grundrisse überdecken sich zu ${_fmt(anteil * 100)} % — prüfen, ob es ein Gebäude ist (zusammenfügen) oder der Umriss nachzuzeichnen ist.` }
    : { text: `Geringe Überdeckung (${_fmt(u.m2)} m²) — meist Zeichenungenauigkeit an der gemeinsamen Wand; so lassen genügt.` };
}

/* ── Karte ────────────────────────────────────────────────────────────────── */

function _markierungWeg() {
  if (_layer) { map.removeLayer(_layer); _layer = null; }
  _markiert = null;
}

export function grundrissZeigen(a, b) {
  const A = _geb(a), B = _geb(b);
  if (!A?.polygon || !B?.polygon) return;
  _markierungWeg();
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '420';
  map.getPane(PANE).style.pointerEvents = 'none';
  const stil = farbe => ({ pane: PANE, color: farbe, weight: 3, dashArray: '6 4', fillColor: farbe, fillOpacity: 0.18, interactive: false });
  _layer = L.layerGroup([L.polygon(A.polygon, stil(ORANGE)), L.polygon(B.polygon, stil(CYAN))]).addTo(map);
  _markiert = guSchluessel(a, b);
  map.fitBounds(L.latLngBounds([...A.polygon, ...B.polygon]).pad(0.6), { maxZoom: 20 });
  grundrissPanelRender();
}

/* ── Aktionen ─────────────────────────────────────────────────────────────── */

async function _frage(titel, text, okText) {
  return typeof window.epConfirm === 'function'
    ? window.epConfirm(titel, text, { okText, cancelText: 'Abbrechen' })
    : window.confirm(text.replace(/<[^>]+>/g, ''));
}

export async function grundrissZusammenfuegen(zielId, quelleId) {
  if (typeof window.gebaeudeZusammenfuegen !== 'function') return;
  const ok = await window.gebaeudeZusammenfuegen(zielId, quelleId, { ohneHinweis: true });
  if (!ok) return;
  // übernommene PV-Flächen brauchen ein PV-Asset mit passender Leistung (das des aufgenommenen Gebäudes entfällt)
  if (_hasBelegung(_geb(zielId))) window.pvuFixOne?.(zielId);
  _markierungWeg();
  showHint(`⧉ Zusammengefügt zu „${_name(_geb(zielId))}".`, 4000);
  grundrissPanelRender();
}

export async function grundrissAufnehmen(zielId, quelleId) {
  if (typeof window.gebaeudeZusammenfuegen !== 'function') return;
  const ok = await window.gebaeudeZusammenfuegen(zielId, quelleId, { ohneHinweis: true, umrissBehalten: true });
  if (!ok) return;
  // übernommene PV-Flächen brauchen ein PV-Asset mit passender Leistung (das des aufgenommenen Gebäudes entfällt)
  if (_hasBelegung(_geb(zielId))) window.pvuFixOne?.(zielId);
  _markierungWeg();
  showHint(`⇥ Aufgenommen in „${_name(_geb(zielId))}" — Umriss unverändert.`, 4000);
  grundrissPanelRender();
}

export async function grundrissLoeschen(id) {
  const g = _geb(id);
  if (!g) return;
  const assets = getAssetsForBuilding(id).length;
  const teile = [_hasBelegung(g) && 'PV-Flächen', assets && `${assets} Anlage${assets > 1 ? 'n' : ''}`,
    (g.waermeManual || g.heizlastManual) && 'eingetragene Wärmewerte', g.massnahmen?.length && `${g.massnahmen.length} Maßnahmen`].filter(Boolean);
  const ok = await _frage('Gebäude löschen', `„${escHtml(_name(g))}" löschen?`
    + (teile.length ? `<br><br>Daran hängen: ${teile.join(', ')} — sie entfallen mit dem Gebäude.` : '<br><br>Am Gebäude hängen keine weiteren Angaben.')
    + '<br>Das lässt sich nicht rückgängig machen.', 'Löschen');
  if (!ok) return;
  _markierungWeg();
  const r = await window.removeGebaeude?.(id);
  if (r === false) return;
  showHint(`🗑 „${_name(g)}" gelöscht.`, 4000);
  grundrissPanelRender();
}

export function grundrissOk(a, b) {
  const k = guSchluessel(a, b);
  if (_ok.has(k)) _ok.delete(k); else _ok.add(k);
  if (_markiert === k) _markierungWeg();
  grundrissPanelRender();
}

export function grundrissOkZeigen(an) { _zeigeOk = !!an; grundrissPanelRender(); }

/* ── Panel ────────────────────────────────────────────────────────────────── */

export function grundrissPanelToggle() {
  _offen = !_offen;
  if (!_offen) { _markierungWeg(); document.getElementById(PANEL_ID)?.remove(); return; }
  grundrissPanelRender();
}

export function grundrissPanelRender() {
  if (!_offen) return;
  let el = document.getElementById(PANEL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Grundrisse prüfen');
    document.body.appendChild(el);
  }
  el.innerHTML = _html();
}

function _knopf(handler, text, titel, farbe = '') {
  return `<button class="btn-xs" style="${farbe ? `border-color:${farbe};color:${farbe};` : ''}" data-click="${handler}" title="${escHtml(titel)}">${text}</button>`;
}

function _zeile(u) {
  const A = _geb(u.a), B = _geb(u.b);
  if (!A || !B) return '';
  const art = ART[u.art], e = _empfehlung(u, A, B);
  const k = guSchluessel(u.a, u.b);
  const groesser = (+A.flaeche || 0) >= (+B.flaeche || 0) ? A : B, kleiner = groesser === A ? B : A;
  const ziel = e.ziel ?? groesser.id, quelle = ziel === A.id ? B.id : A.id;
  void kleiner;
  // Gelingt eine exakte gemeinsame Kontur? Sonst käme beim Zusammenfügen die konvexe Hülle heraus.
  let exakt = false;
  try { exakt = vereinigePolygone(A.polygon, B.polygon).methode === 'vereinigung'; } catch (err) { void err; }
  const kurz = g => escHtml(_name(g).slice(0, 16));
  return `
    <div style="padding:5px 0 6px;border-bottom:1px solid rgba(255,255,255,.07);${_markiert === k ? `background:${ORANGE}12;` : ''}${u.ok ? 'opacity:.6;' : ''}">
      <div style="display:flex;align-items:center;gap:5px;font-size:10.5px;cursor:pointer;" data-click="grundrissZeigen(${u.a},${u.b})" title="Auf der Karte zeigen">
        <span style="font-size:8.5px;padding:1px 5px;border-radius:3px;border:1px solid ${art.farbe};color:${art.farbe};white-space:nowrap;">${art.text}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="color:${ORANGE};">${escHtml(_name(A))}</span> ↔ <span style="color:${CYAN};">${escHtml(_name(B))}</span></span>
      </div>
      <div style="font-size:9.5px;color:var(--muted);margin-top:2px;">${_fmt(u.m2)} m² überdeckt · ${_fmt(u.anteilA * 100)} % von ${escHtml(_name(A).slice(0, 22))}, ${_fmt(u.anteilB * 100)} % von ${escHtml(_name(B).slice(0, 22))}</div>
      <div style="font-size:9.5px;line-height:1.4;margin-top:2px;">${escHtml(e.text)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">
        ${_knopf(`grundrissZeigen(${u.a},${u.b})`, '👁', 'Auf der Karte zeigen')}
        ${u.art !== 'teil' ? _knopf(`grundrissAufnehmen(${ziel},${quelle})`, `⇥ in ${kurz(_geb(ziel))}`,
          `„${_name(_geb(quelle))}" geht in „${_name(_geb(ziel))}" auf — Umriss von „${_name(_geb(ziel))}" bleibt, PV-Flächen werden übernommen (empfohlen)`, ORANGE) : ''}
        ${u.art === 'doppelt' ? _knopf(`grundrissAufnehmen(${quelle},${ziel})`, `⇥ in ${kurz(_geb(quelle))}`,
          `Umgekehrt: „${_name(_geb(ziel))}" geht in „${_name(_geb(quelle))}" auf`) : ''}
        ${exakt
          ? _knopf(`grundrissZusammenfuegen(${ziel},${quelle})`, '⧉ zusammenfügen', `Umrisse vereinigen: „${_name(_geb(quelle))}" in „${_name(_geb(ziel))}" (PV-Flächen werden übernommen)`, u.art === 'teil' ? ORANGE : '')
          : `<span class="btn-xs" style="opacity:.45;cursor:help;" title="Für diese Grundrisse lässt sich keine exakte gemeinsame Kontur bilden — Zusammenfügen ergäbe die konvexe Hülle und schlösse Zwischenräume oder Nachbargebäude ein.">⧉ zusammenfügen nicht möglich</span>`}
        ${_knopf(`grundrissOk(${u.a},${u.b})`, u.ok ? '↺ wieder prüfen' : '✓ so lassen', u.ok ? 'Wieder in die Liste aufnehmen' : 'Bewusst so belassen — verschwindet aus der Liste (im Projekt gespeichert)')}
      </div>
    </div>`;
}

function _html() {
  const alle = grundrissUeberlappungen();
  const offen = alle.filter(u => !u.ok), belassen = alle.filter(u => u.ok);
  const n = { doppelt: 0, enthalten: 0, teil: 0 };
  for (const u of offen) n[u.art]++;
  const liste = (_zeigeOk ? alle : offen).map(_zeile).join('');
  return `
    <div class="pvm-head">
      <span class="pvm-head-title">⧉ Grundrisse prüfen</span>
      <button class="btn-xs" data-click="grundrissPanelToggle()" title="Schließen">✕</button>
    </div>
    <div class="pvm-body">
      <div style="font-size:10px;line-height:1.5;">
        ${offen.length
          ? `<b>${offen.length}</b> überlappende Grundrisse: ${[n.doppelt && `${n.doppelt} Doppelerfassung${n.doppelt > 1 ? 'en' : ''}`,
              n.enthalten && `${n.enthalten} Gebäudeteil${n.enthalten > 1 ? 'e' : ''} im Gebäude`, n.teil && `${n.teil} Teilüberlappung${n.teil > 1 ? 'en' : ''}`].filter(Boolean).join(', ')}`
          : '<span style="color:#4caf50;">✓ Keine offenen Überlappungen.</span>'}
      </div>
      <div style="font-size:9px;color:var(--muted);line-height:1.45;margin-top:3px;">
        Überlappende Grundrisse verfälschen Wärme- und Strombedarf, Dachpotenzial und Verschattung. Doppelerfassung: beide decken sich
        zu ≥ ${_fmt(GU_DECKUNG * 100)} %. Neubau über einem Gebäude, das vorher abgerissen wird, gilt nicht als Überlappung.
        Zusammenfügen und Löschen fragen nach und sind nicht per Strg+Z umkehrbar.
      </div>
      ${belassen.length ? `<label style="display:flex;align-items:center;gap:4px;font-size:9.5px;color:var(--muted);margin-top:4px;cursor:pointer;">
        <input type="checkbox" ${_zeigeOk ? 'checked' : ''} data-change="grundrissOkZeigen(this.checked)"/>${belassen.length} bewusst belassene einblenden</label>` : ''}
      ${liste ? `<div style="margin-top:5px;">${liste}</div>` : ''}
    </div>`;
}

window.grundrissCapture = grundrissCapture;
window.grundrissRestore = grundrissRestore;

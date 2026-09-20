// ── 27-resilienz-abfrage.js — Abfragedatei für Resilienzanforderungen ───────
//
// Oberfläche zu lib/resilienz-abfrage.js. Zwei Bausteine in einem Panel:
//
//   1. Abfragedatei erzeugen  — .xlsx mit Ausfüllanleitung, Auswahllisten und
//      Blattschutz, vorbelegt mit den Gebäuden des Projekts. Sie geht an die
//      zuständige Stelle bzw. an Bedarfsträger und Nutzer.
//   2. Ausgefüllte Datei einlesen — Vollständigkeit prüfen, Klassen vorschlagen,
//      Anforderungstexte und Rückfrageliste erzeugen, als JSON exportieren.
//
// Hier wird nichts gerechnet und nichts simuliert: die Abfrage erhebt die
// Eingangsgrößen, auf denen Autarkie-Nachweis und n-1-Check später aufsetzen.
//
// Die Klassen A–D dieser Abfrage sind NICHT die Notstromklassen A/B/C am
// Gebäude (26-blackout-modus.js). Die Übernahme ist ein eigener, sichtbarer
// Schritt mit angezeigter Zuordnung — das Werkzeug schlägt vor, es legt
// nichts fest.

import { xlsxDateien } from './lib/xlsx-schreiber.js';
import { xlsxAusBlob } from './lib/xlsx-leser.js';
import {
  RA_VERSION, RA_KENNUNG, RA_KLASSEN, RA_KLASSEN_KEYS, RA_SZENARIO_IDS,
  raMappe, raVorbelegung, raDateiname, raLesen, raPruefung, raAnforderungen,
  raExportJson, raRueckfragenText, raRueckfragenMappe, raDauerText, raText,
} from './lib/resilienz-abfrage.js';
import { escHtml, showHint } from './03c-gebaeude-io.js';

const PANEL_ID = 'resilienz-abfrage-panel';
const GRUEN = '#3f9c3f';

/** Projektzustand des Moduls. */
export function raZustand() {
  if (!window.resilienzAbfrage || typeof window.resilienzAbfrage !== 'object') {
    window.resilienzAbfrage = { meta: {}, daten: null, quelle: '' };
  }
  const z = window.resilienzAbfrage;
  if (!z.meta || typeof z.meta !== 'object') z.meta = {};
  return z;
}

/** Wird mit dem Projekt gespeichert (03c-gebaeude-io.js). */
export function raCaptureState() {
  const z = raZustand();
  return { version: RA_VERSION, meta: { ...z.meta }, daten: z.daten || null, quelle: z.quelle || '' };
}

export function raRestoreState(s) {
  window.resilienzAbfrage = (s && typeof s === 'object')
    ? { meta: { ...(s.meta || {}) }, daten: s.daten || null, quelle: s.quelle || '' }
    : { meta: {}, daten: null, quelle: '' };
  if (document.getElementById(PANEL_ID)) raPanelRender();
}

// ── Panel ───────────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel';
  panel.style.cssText = `top:70px;min-width:620px;max-width:940px;max-height:86vh;padding:0 0 14px;`
    + `overflow:auto;border-color:${GRUEN};`;
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:${GRUEN};font-size:12px;font-weight:600;">📋 Resilienz-Abfrage</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="raPanelToggle()">✕</span>
    </div>
    <div id="resilienz-abfrage-body" style="padding:0 16px;"></div>`;
  document.body.appendChild(panel);
  return panel;
}

export function raPanelToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar) raPanelRender();
}

const _btn = (farbe, gefuellt) => `padding:5px 12px;border-radius:5px;border:1px solid ${farbe};`
  + `background:${gefuellt ? farbe : 'transparent'};color:${gefuellt ? '#fff' : farbe};`
  + 'font-family:inherit;font-size:10.5px;cursor:pointer;';

const _feld = (feld, label, wert, platzhalter = '') => `
  <label style="display:block;font-size:9px;color:var(--muted);margin-bottom:2px;">${escHtml(label)}</label>
  <input type="text" value="${escHtml(wert || '')}" placeholder="${escHtml(platzhalter)}"
    data-input="raSetMeta('${feld}', this.value)"
    style="width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid var(--border);border-radius:4px;
           background:var(--surface2);color:var(--text);font-family:inherit;font-size:10.5px;">`;

export function raSetMeta(feld, wert) {
  raZustand().meta[feld] = raText(wert);
}

// ── Baustein 1: Abfragedatei erzeugen ───────────────────────────────────────

function _heutigesDatum() { return new Date().toISOString().slice(0, 10); }

/** Gebäudeliste des Projekts, sofern vorhanden. */
function _gebaeude() {
  return Array.isArray(window.gebaeude) ? window.gebaeude.filter(g => g && !g.abrissjahr) : [];
}

async function _herunterladen(mappe, dateiname) {
  if (typeof window.JSZip !== 'function') {
    showHint('⚠ JSZip ist nicht geladen — bitte die Seite neu laden.', 6000);
    return false;
  }
  const zip = new window.JSZip();
  for (const [pfad, inhalt] of Object.entries(xlsxDateien(mappe))) zip.file(pfad, inhalt);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function raDateiErzeugen() {
  const z = raZustand();
  const meta = { ...z.meta };
  if (!meta.stand) meta.stand = _heutigesDatum();
  const mitGebaeuden = z.meta.ohneVorbelegung !== 'ja';
  const funktionen = raVorbelegung(mitGebaeuden ? _gebaeude() : []);
  try {
    const ok = await _herunterladen(raMappe({ meta, funktionen, leerzeilen: 40 }), raDateiname(meta));
    if (!ok) return;
    z.meta.stand = meta.stand;
    showHint(`✓ Abfragedatei erzeugt — ${funktionen.length} Funktionszeilen vorbelegt, 40 Zeilen frei.`, 7000);
    raPanelRender();
  } catch (e) {
    console.error('Resilienz-Abfrage: Erzeugen fehlgeschlagen', e);
    showHint('⚠ Abfragedatei konnte nicht erzeugt werden: ' + e.message, 8000);
  }
}

export function raVorbelegungUmschalten(an) {
  raZustand().meta.ohneVorbelegung = an ? '' : 'ja';
  raPanelRender();
}

// ── Baustein 2: ausgefüllte Datei einlesen ──────────────────────────────────

export function raDateiEinlesen() {
  let inp = document.getElementById('_raImportInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = '_raImportInput';
    inp.accept = '.xlsx';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', _importHandler);
  }
  inp.value = '';
  inp.click();
}

async function _importHandler(event) {
  const datei = event.target.files?.[0];
  if (!datei) return;
  if (typeof window.JSZip !== 'function') {
    showHint('⚠ JSZip ist nicht geladen — bitte die Seite neu laden.', 6000);
    return;
  }
  try {
    const { blaetter } = await xlsxAusBlob(await datei.arrayBuffer(), window.JSZip);
    const daten = raLesen(blaetter);
    const z = raZustand();
    z.daten = daten;
    z.quelle = datei.name;
    // Was die Datei über die Liegenschaft sagt, gilt — sie kommt vom Bedarfsträger.
    for (const f of ['lieg', 'bearb', 'stand']) if (raText(daten.allgemein?.[f])) z.meta[f] = daten.allgemein[f];
    const p = raPruefung(daten);
    showHint(daten.fehler.length
      ? `⚠ Datei gelesen, aber ${daten.fehler.length} Strukturhinweis(e) — siehe Panel.`
      : `✓ ${daten.funktionen.length} Funktionen gelesen, ${p.offene_punkte.length} offene Punkte.`, 7000);
    raPanelRender();
  } catch (e) {
    console.error('Resilienz-Abfrage: Import fehlgeschlagen', e);
    showHint('⚠ Datei konnte nicht gelesen werden: ' + e.message, 8000);
  }
}

/** Klassenvorschlag einer Funktion ändern — bleibt als „geändert" erkennbar. */
export function raKlasseSetzen(id, klasse) {
  const z = raZustand();
  const f = z.daten?.funktionen?.find(x => x.id === id);
  if (!f || !RA_KLASSEN[klasse]) return;
  f.klasse = klasse;
  raPanelRender();
}

export function raErgebnisVerwerfen() {
  const z = raZustand();
  if (!z.daten) return;
  if (!window.confirm('Eingelesene Abfrage verwerfen? Die Datei selbst bleibt unberührt.')) return;
  z.daten = null; z.quelle = '';
  raPanelRender();
}

// ── Ausgaben ────────────────────────────────────────────────────────────────

export function raExportierenJson() {
  const z = raZustand();
  if (!z.daten) return;
  const json = raExportJson(z.daten, { quelle: z.quelle || RA_KENNUNG });
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = raDateiname(z.meta).replace(/\.xlsx$/, '').replace(/^Resilienzabfrage_/, 'Resilienzanforderungen_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showHint('✓ Anforderungen als JSON exportiert (Schema Version ' + RA_VERSION + ').', 5000);
}

export async function raExportierenRueckfragen() {
  const z = raZustand();
  if (!z.daten) return;
  const p = raPruefung(z.daten);
  if (!p.offene_punkte.length) { showHint('Keine offenen Punkte — nichts zurückzufragen.', 5000); return; }
  try {
    const name = raDateiname(z.meta).replace(/^Resilienzabfrage_/, 'Rueckfragen_');
    if (await _herunterladen(raRueckfragenMappe(z.daten, p), name)) {
      showHint(`✓ Rückfrageliste mit ${p.offene_punkte.length} Punkten erzeugt.`, 6000);
    }
  } catch (e) {
    console.error('Resilienz-Abfrage: Rückfragen-Export fehlgeschlagen', e);
    showHint('⚠ Rückfrageliste konnte nicht erzeugt werden: ' + e.message, 8000);
  }
}

export async function raRueckfragenKopieren() {
  const z = raZustand();
  if (!z.daten) return;
  const text = raRueckfragenText(z.daten);
  try {
    await navigator.clipboard.writeText(text);
    showHint('✓ Rückfrageliste in die Zwischenablage kopiert.', 5000);
  } catch {
    // Ohne Zwischenablage-Rechte: Text zum Markieren anbieten
    const el = document.getElementById('ra-rueckfragen-text');
    if (el) { el.style.display = 'block'; el.value = text; el.select(); }
    showHint('Zwischenablage nicht verfügbar — Text im Panel markieren und kopieren.', 6000);
  }
}

// ── Übernahme in die Notstromklassen am Gebäude (26-blackout-modus.js) ──────
//
// Zwei verschiedene Klassenschemata: hier A–D aus der Auswirkungsabfrage, dort
// A/B/C am Gebäude. Die Zuordnung wird angezeigt, bevor sie ausgeführt wird —
// das Werkzeug legt nichts still fest.
export const RA_UEBERNAHME = Object.freeze({ A: 'A', B: 'B', C: 'C', D: null });

/** Welche Gebäude würde die Übernahme treffen? */
export function raUebernahmeVorschau() {
  const z = raZustand();
  const geb = _gebaeude();
  const nachName = new Map(geb.map(g => [String(g.name || '').trim().toLowerCase(), g]));
  const ord = { A: 0, B: 1, C: 2 };
  const treffer = new Map();
  const ohne = [];
  for (const f of z.daten?.funktionen || []) {
    const klasse = RA_UEBERNAHME[f.klasse || f.klasse_vorschlag];
    const g = nachName.get(String(f.geb || '').trim().toLowerCase());
    if (!g) { if (klasse) ohne.push(f); continue; }
    if (!klasse) continue;
    // Mehrere Funktionen je Gebäude: die schärfste Klasse gewinnt.
    const bisher = treffer.get(g.id);
    if (!bisher || ord[klasse] < ord[bisher.klasse]) treffer.set(g.id, { geb: g, klasse, funktion: f });
  }
  return { treffer: [...treffer.values()], ohneGebaeude: ohne, gebaeudeGesamt: geb.length };
}

export function raUebernehmen() {
  const v = raUebernahmeVorschau();
  if (!v.treffer.length) { showHint('Keine Funktion lässt sich einem Gebäude des Projekts zuordnen.', 6000); return; }
  const text = `${v.treffer.length} Gebäude werden im Blackout-Modus eingestuft `
    + `(A → A, B → B, C → C, D → keine Einstufung).\n\n`
    + v.treffer.slice(0, 12).map(t => `${t.geb.name} → ${t.klasse}  (${t.funktion.name})`).join('\n')
    + (v.treffer.length > 12 ? `\n… und ${v.treffer.length - 12} weitere` : '')
    + '\n\nVorhandene Einstufungen werden überschrieben. Übernehmen?';
  if (!window.confirm(text)) return;
  for (const t of v.treffer) {
    t.geb.notstrom = { klasse: t.klasse, lastPct: null, eigeneNea: false };
  }
  window.blackoutPlatz = null;
  window.blackoutInsel = null;
  if (typeof window.updateViz === 'function') window.updateViz();
  if (window.blackoutModusAktiv) {
    window.blackoutModusMarkiereKarte?.();
    window.blackoutModusRender?.();
  }
  showHint(`✓ ${v.treffer.length} Gebäude eingestuft. Die Einstufung ist ein Vorschlag aus der Abfrage `
    + '— bitte mit der zuständigen Stelle abstimmen.', 8000);
  raPanelRender();
}

// ── Darstellung ─────────────────────────────────────────────────────────────

const _kachel = (label, wert, farbe, titel = '') =>
  `<div title="${escHtml(titel)}" style="flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);
        border-radius:5px;padding:5px 7px;">
     <div style="font-size:8.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(label)}</div>
     <div style="font-size:13px;font-weight:700;color:${farbe};">${wert}</div></div>`;

function _abschnitt(titel, inhalt) {
  return `<div style="margin-top:12px;">
      <div style="font-size:10.5px;font-weight:600;color:${GRUEN};border-bottom:1px solid var(--border);
                  padding-bottom:3px;margin-bottom:7px;">${escHtml(titel)}</div>${inhalt}</div>`;
}

function _erzeugenAnsicht(z) {
  const geb = _gebaeude();
  const mit = z.meta.ohneVorbelegung !== 'ja';
  const anzahl = raVorbelegung(mit ? geb : []).length;
  return _abschnitt('1 · Abfragedatei erzeugen', `
    <div style="font-size:9.5px;color:var(--muted);line-height:1.6;margin-bottom:9px;">
      Erzeugt eine Excel-Datei mit Ausfüllanleitung, Auswahllisten und Blattschutz für die zuständige
      Stelle bzw. für Bedarfsträger und Nutzer. Gefragt wird nach den Auswirkungen eines Ausfalls,
      nicht nach Resilienzklassen — die Einordnung macht dieses Werkzeug beim Einlesen.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;">
      <div>${_feld('lieg', 'Liegenschaft', z.meta.lieg, 'Bezeichnung, Ort')}</div>
      <div>${_feld('stand', 'Stand', z.meta.stand, _heutigesDatum())}</div>
      <div>${_feld('stelle', 'Ausfüllende Stelle (Vorbelegung)', z.meta.stelle)}</div>
      <div>${_feld('bearb', 'Bearbeiter', z.meta.bearb)}</div>
      <div>${_feld('empfaenger', 'Empfänger der Abfrage', z.meta.empfaenger, 'Dienststelle')}</div>
      <div>${_feld('ansprechpartner', 'Ansprechpartner für Rückfragen', z.meta.ansprechpartner, 'Name, Tel., E-Mail')}</div>
    </div>
    <label style="display:flex;align-items:center;gap:6px;margin-top:9px;font-size:9.5px;color:var(--muted);cursor:pointer;">
      <input type="checkbox" ${mit ? 'checked' : ''} data-change="raVorbelegungUmschalten(this.checked)">
      Gebäude des Projekts als Vorbelegung übernehmen
      <span style="color:var(--text);">(${geb.length} Gebäude → ${anzahl} Funktionszeilen)</span>
    </label>
    <div style="margin-top:10px;display:flex;gap:7px;align-items:center;">
      <button data-click="raDateiErzeugen()" style="${_btn(GRUEN, true)}">📋 Abfragedatei erzeugen (.xlsx)</button>
      <span style="font-size:8.5px;color:var(--muted);">${escHtml(RA_KENNUNG)}</span>
    </div>`);
}

function _uebersicht(daten, p) {
  const k = p.kennzahlen;
  const zeile = (key) => {
    const kl = RA_KLASSEN[key], d = k.jeKlasse[key];
    return `<tr>
      <td style="padding:2px 4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;
        background:${kl.farbe};margin-right:5px;"></span><b>${key}</b> ${escHtml(kl.label)}</td>
      <td style="padding:2px 4px;text-align:right;">${d.anzahl}</td>
      <td style="padding:2px 4px;text-align:right;">${d.pkKw ? Math.round(d.pkKw).toLocaleString('de-DE') + ' kW' : '—'}</td>
      <td style="padding:2px 4px;text-align:right;color:${d.pkFehlt ? '#ffa726' : 'var(--muted)'};">${d.pkFehlt || '—'}</td>
      <td style="padding:2px 4px;text-align:right;color:var(--muted);">${kl.defaultH == null ? '—' : raDauerText(kl.defaultH)}</td>
    </tr>`;
  };
  const h = k.herkunft;
  return `
    <div style="display:flex;gap:5px;margin-bottom:8px;">
      ${_kachel('Funktionen', k.funktionen, GRUEN)}
      ${_kachel('Offene Punkte', k.offeneAnzahl, k.offeneAnzahl ? '#ffa726' : GRUEN, 'Punkte für die Rückfrage an den Empfänger')}
      ${_kachel('Szenarien offen', k.szenarienOffen || '—', k.szenarienOffen ? '#ffa726' : GRUEN, 'Szenarien ohne Angabe zur Relevanz')}
      ${_kachel('Anteil vorgegeben', k.anteilVorgegebenPct == null ? '—' : k.anteilVorgegebenPct + ' %', '#42a5f5',
    `${h.vorgegeben}× vorgegeben, ${h['Einschätzung Nutzer']}× Einschätzung Nutzer, ${h.unbekannt}× unbekannt, ${h.offen}× ohne Angabe`)}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead><tr style="color:var(--muted);font-size:8.5px;">
        <th style="text-align:left;padding:2px 4px;font-weight:400;">Klasse (Vorschlag)</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;">Funktionen</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Summe der bekannten Krisenlasten">Krisenlast bekannt</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Funktionen ohne Angabe zur Krisenlast">davon offen</th>
        <th style="text-align:right;padding:2px 4px;font-weight:400;" title="Richtwert der Klasse — die Angabe aus der Abfrage gilt">Richtwert</th>
      </tr></thead>
      <tbody>${RA_KLASSEN_KEYS.map(zeile).join('')}</tbody></table>
    <div style="font-size:8.5px;color:var(--muted);margin-top:5px;line-height:1.5;">
      Regel: Auswirkung nach Sekunden „Auftrag gefährdet" → A · sonst nach 4 h „gefährdet" → B ·
      sonst nach 3 Tagen „gefährdet" oder „eingeschränkt" → C · sonst D.
      Die angegebene Autarkiedauer wird übernommen und nicht aus der Klasse überschrieben.
    </div>`;
}

function _funktionsTabelle(daten) {
  const zeilen = daten.funktionen.map(f => {
    const kl = RA_KLASSEN[f.klasse] || RA_KLASSEN.D;
    const geaendert = f.klasse !== f.klasse_vorschlag;
    const kreuze = RA_SZENARIO_IDS.filter(id => f.sz?.[id]);
    const wahl = RA_KLASSEN_KEYS.map(k =>
      `<option value="${k}"${k === f.klasse ? ' selected' : ''}>${k}</option>`).join('');
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:3px 4px;color:var(--muted);white-space:nowrap;">${escHtml(f.id)}</td>
      <td style="padding:3px 4px;">${escHtml(f.name || '—')}
        ${f.geb ? `<span style="color:var(--muted);"> · ${escHtml(f.geb)}</span>` : ''}</td>
      <td style="padding:3px 4px;white-space:nowrap;">
        <select data-change="raKlasseSetzen('${escHtml(f.id)}', this.value)"
          title="${escHtml(f.klasse_grund || '')}"
          style="background:var(--surface2);color:${kl.farbe};border:1px solid ${kl.farbe};border-radius:4px;
                 font-family:inherit;font-size:10px;font-weight:700;padding:1px 3px;">${wahl}</select>
        <span style="font-size:8px;color:var(--muted);">${geaendert ? 'geändert' : 'Vorschlag'}</span></td>
      <td style="padding:3px 4px;text-align:right;white-space:nowrap;">${raDauerText(f.autarkie_h)}</td>
      <td style="padding:3px 4px;text-align:right;white-space:nowrap;">${f.pk == null ? '<span style="color:#ffa726;">[offen]</span>'
    : f.pk.toLocaleString('de-DE') + ' kW'}</td>
      <td style="padding:3px 4px;color:var(--muted);white-space:nowrap;">${kreuze.length ? escHtml(kreuze.join(' ')) : '<span style="color:#ffa726;">[offen]</span>'}</td>
      <td style="padding:3px 4px;color:var(--muted);">${escHtml(f.herkunft || '—')}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:10px;">
    <thead><tr style="color:var(--muted);font-size:8.5px;">
      <th style="text-align:left;padding:2px 4px;font-weight:400;">ID</th>
      <th style="text-align:left;padding:2px 4px;font-weight:400;">Funktion</th>
      <th style="text-align:left;padding:2px 4px;font-weight:400;">Klasse</th>
      <th style="text-align:right;padding:2px 4px;font-weight:400;">Autarkie</th>
      <th style="text-align:right;padding:2px 4px;font-weight:400;">Krisenlast</th>
      <th style="text-align:left;padding:2px 4px;font-weight:400;">Szenarien</th>
      <th style="text-align:left;padding:2px 4px;font-weight:400;">Herkunft</th>
    </tr></thead><tbody>${zeilen}</tbody></table>`;
}

function _liste(eintraege, farbe, leer) {
  if (!eintraege.length) return `<div style="font-size:9.5px;color:var(--muted);">${escHtml(leer)}</div>`;
  return `<ul style="margin:0;padding-left:16px;font-size:9.5px;line-height:1.7;">`
    + eintraege.map(e => `<li><span style="color:${farbe};font-weight:600;">[${escHtml(e.ref)}]</span> ${escHtml(e.text)}</li>`).join('')
    + '</ul>';
}

function _ergebnisAnsicht(z) {
  const daten = z.daten;
  const p = raPruefung(daten);
  const anf = raAnforderungen(daten);
  const uv = raUebernahmeVorschau();
  const szOffen = daten.szenarien.filter(s => s.relevant === 'ja');

  const struktur = daten.fehler.length ? `
    <div style="background:#4a2c1a;border:1px solid #ffa726;border-radius:5px;padding:7px 9px;margin-bottom:9px;
                font-size:9.5px;line-height:1.6;color:#ffcc80;">
      <b>Hinweise zur Dateistruktur</b>
      <ul style="margin:4px 0 0;padding-left:16px;">${daten.fehler.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>
    </div>` : '';

  return _abschnitt('2 · Ergebnis der Auswertung', `
    ${struktur}
    <div style="font-size:9px;color:var(--muted);margin-bottom:8px;">
      Quelle: ${escHtml(z.quelle || '—')} · Version ${daten.version ?? '?'} ·
      zuständige Stelle: ${daten.allgemein?.zustaendig
    ? escHtml(daten.allgemein.zustaendig)
    : '<span style="color:#ffa726;">nicht benannt</span>'} ·
      relevante Szenarien: ${szOffen.length ? escHtml(szOffen.map(s => s.id).join(', ')) : '<span style="color:#ffa726;">keine benannt</span>'}
      <button data-click="raErgebnisVerwerfen()" style="${_btn('#90a4ae')}margin-left:8px;padding:1px 7px;font-size:9px;">verwerfen</button>
    </div>
    ${_uebersicht(daten, p)}
    <details style="margin-top:10px;" open>
      <summary style="cursor:pointer;font-size:10px;color:${GRUEN};">Funktionen (${daten.funktionen.length}) — Klassenvorschlag änderbar</summary>
      <div style="margin-top:6px;">${_funktionsTabelle(daten)}</div>
    </details>
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-size:10px;color:${GRUEN};">Anforderungstexte (${anf.length})</summary>
      <ul style="margin:6px 0 0;padding-left:16px;font-size:9.5px;line-height:1.75;">
        ${anf.map(a => `<li><b style="color:${RA_KLASSEN[a.klasse]?.farbe || '#90a4ae'};">${a.klasse}</b> ${escHtml(a.text)}</li>`).join('')}
      </ul>
      <div style="font-size:8.5px;color:var(--muted);margin-top:5px;">
        „[offen]" steht für Angaben, die die Abfrage nicht hergibt — sie werden nicht geschätzt.
      </div>
    </details>
    <details style="margin-top:8px;"${p.offene_punkte.length ? ' open' : ''}>
      <summary style="cursor:pointer;font-size:10px;color:#ffa726;">Offene Punkte (${p.offene_punkte.length})</summary>
      <div style="margin-top:6px;">${_liste(p.offene_punkte, '#ffa726', 'Keine offenen Punkte — die Abfrage ist vollständig.')}</div>
    </details>
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-size:10px;color:#42a5f5;">Hinweise (${p.hinweise.length})</summary>
      <div style="margin-top:6px;">${_liste(p.hinweise, '#42a5f5', 'Keine Hinweise.')}</div>
    </details>
    <div style="margin-top:11px;display:flex;gap:7px;flex-wrap:wrap;">
      <button data-click="raExportierenJson()" style="${_btn(GRUEN, true)}">⬇ Anforderungen als JSON</button>
      <button data-click="raExportierenRueckfragen()" style="${_btn('#ffa726')}">⬇ Rückfrageliste (.xlsx)</button>
      <button data-click="raRueckfragenKopieren()" style="${_btn('#ffa726')}">📄 Rückfragen kopieren</button>
    </div>
    <textarea id="ra-rueckfragen-text" readonly style="display:none;width:100%;box-sizing:border-box;height:140px;
      margin-top:7px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:4px;
      font-family:monospace;font-size:9.5px;padding:6px;"></textarea>
    <div style="margin-top:12px;padding:8px 9px;background:var(--surface);border:1px solid var(--border);border-radius:5px;">
      <div style="font-size:9.5px;line-height:1.6;color:var(--muted);">
        <b style="color:var(--text);">Übernahme in den Blackout-Modus.</b> Die Klassen A–D dieser Abfrage sind
        nicht die Notstromklassen A/B/C am Gebäude. Die Übernahme ordnet A → A, B → B, C → C zu; D bleibt
        ohne Einstufung. Zuordnung über den Gebäudenamen:
        <b style="color:var(--text);">${uv.treffer.length} von ${daten.funktionen.length} Funktionen</b>
        treffen ein Gebäude des Projekts${uv.ohneGebaeude.length ? `, ${uv.ohneGebaeude.length} eingestufte Funktion(en) ohne Zuordnung` : ''}.
      </div>
      <button data-click="raUebernehmen()" ${uv.treffer.length ? '' : 'disabled'}
        style="${_btn('#ef5350')}margin-top:7px;${uv.treffer.length ? '' : 'opacity:.45;cursor:default;'}">
        🛡 ${uv.treffer.length} Gebäude im Blackout-Modus einstufen</button>
    </div>`);
}

export function raPanelRender() {
  const el = document.getElementById('resilienz-abfrage-body');
  if (!el) return;
  const z = raZustand();
  el.innerHTML = `
    <div style="font-size:9px;color:var(--muted);line-height:1.6;background:var(--surface);border:1px solid var(--border);
                border-radius:5px;padding:7px 9px;margin-top:10px;">
      Ableitungskette: Auftrag → kritische Funktionen → Referenzszenarien → messbare Anforderungen → Maßnahmen.
      Anforderungen werden an <b style="color:var(--text);">Funktionen</b> gestellt, nicht an Anlagen.
      Die Zuständigkeit für die Resilienz liegt nicht bei dieser Stelle: Die Abfrage erhebt die
      Eingangsgrößen für das Energiekonzept — sie legt nichts fest. Hier wird nichts gerechnet.
    </div>
    ${_erzeugenAnsicht(z)}
    ${z.daten ? _ergebnisAnsicht(z) : _abschnitt('2 · Ausgefüllte Datei einlesen', `
      <div style="font-size:9.5px;color:var(--muted);line-height:1.6;margin-bottom:9px;">
        Die zurückgesendete .xlsx wird auf Blatt- und Spaltenstruktur geprüft, auf Vollständigkeit
        durchgesehen und in Anforderungen übersetzt. Unvollständige Angaben sind kein Fehler —
        sie werden als offene Punkte aufgelistet.
      </div>
      <button data-click="raDateiEinlesen()" style="${_btn(GRUEN, true)}">⬆ Ausgefüllte Abfragedatei einlesen</button>`)}
    <div style="font-size:8.5px;color:var(--muted);margin-top:12px;line-height:1.5;">
      Klassen sind Vorschläge des Werkzeugs und werden mit der zuständigen Stelle abgestimmt.
      Keine Dimensionierung, keine Simulation, keine Maßnahmenplanung.
    </div>`;
}

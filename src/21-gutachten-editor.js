// ── 21-gutachten-editor.js — Gutachten-Editor: Gliederung, Blöcke, Seitenansicht ──
// Reiter „📝 Gutachten“ im Analyse-Bereich mit zwei Ansichten:
//   • 📄 Dokument       — Gliederung (links), fortlaufende Seite (Mitte), Eigenschaften (rechts)
//   • 🖼 Einzelgrafiken — die bisherige Figur-für-Figur-Ansicht aus 17-gutachten-grafik.js
// Das Dokumentmodell (Kapitel, Blöcke, Nummern) liegt DOM-frei in
// lib/gutachten-dokument.js und wird mit der Projektdatei gespeichert —
// 03c-gebaeude-io.js ruft gutCaptureGutachten/gutRestoreGutachten über window.
//
// Bewusst ohne Imports aus dem App-Kern: wie 17 und 18 ein Blatt im Importgraph
// (tests/import-architecture.test.js). Importiert wird nur aus 17 und der lib.

import {
  ggFigurenKatalog, ggFigurTeilArten, ggRenderFigurFuerDokument, ggCopyDokumentTeil, ggCopyForWord, ggFitLabels,
  ggMountEinzelansicht, ggShowSection, ggSelectFigur, ggFigurEinstellungenCapture, ggFigurEinstellungenRestore,
  ggFigurWordDaten, ggSvgToPngBlob, ggTrafostationenIstListe, ggFigurSichtbar, ggFigurAusblendGrund, ggFrageKontext, ggPlausiPruefung,
} from './17-gutachten-grafik.js';
import { GF_FRAGEN, gfFragenZuKapitel, gfOptionen, gfStandard } from './lib/gutachten-fragen.js';
import {
  GUTACHTEN_DOK_VERSION, GUTACHTEN_MAX_EBENE, GUTACHTEN_STANDARD_GLIEDERUNG, gdNormalisieren, gdKapitelNummern, gdStandardDokument, gdMitStandardAbgleichen, gdLeeresDokument,
  gdGliederungVersion, gdGliederungUmstellen, gdVerweisNummern,
  gdKapitelEinfuegen, gdKapitelLoeschen, gdKapitelVerschieben, gdKapitelEbene,
  gdNeuerTextBlock, gdNeuerFigurBlock, gdNeuerBildBlock, gdBlockEinfuegen, gdBlockLoeschen, gdBlockVerschieben,
  gdFindeBlock, gdBeschriftungen, gdFigurIds, gdNormDeckblatt, GUTACHTEN_DECKBLATT_VORGABEN,
  gdAnlagenNummern, gdStationsAnlagenErgaenzen, gdAnlageLoeschen, gdAnlageVerschieben,
} from './lib/gutachten-dokument.js';
import { ssStationModell, ssBestandsStationen, ssSteckbriefBlatt, ssSteckbriefTitel, ssSteckbriefHtml, ssStationsLabel } from './lib/stations-steckbrief.js';
import { ssdxAnlagenVerzeichnis, ssdxSteckbriefAnlage } from './lib/steckbrief-docx.js';
import {
  gdxKontext, gdxDeckblatt, gdxInhaltsverzeichnis, gdxVerzeichnis, gdxUeberschrift, gdxFreitext,
  gdxBausteinAbsaetze, gdxTabelle, gdxAbbildung, gdxBeschriftung, gdxErzeugePaket,
} from './lib/gutachten-docx.js';
import { gpxErzeugePaket, gpxStichpunkte } from './lib/gutachten-pptx.js';
import { GV_LOGO_PNG, GV_WAPPEN_PNG, GV_NETZGRAFIK_PNG } from './config/gutachten-vorlage-assets.js';

const _gut = {
  dok: null,            // Gutachten-Dokument oder null, solange keins angelegt ist
  modus: 'dokument',    // 'dokument' | 'praes' | 'einzel'
  auswahl: null,        // { art: 'kapitel' | 'block', id }
  cache: new Map(),     // blockId → { schluessel, ergebnis } — gezeichnete Figuren, damit Auswahl/Verschieben nicht alles neu rechnet
  lpZiel: null,          // blockId eines 'bild'-Blocks, der gerade in 🗺️ Liegenschaftsbilder eingerichtet wird, oder null
  figurMenuOffen: null,  // Kapitel-Id, deren „Abbildung oder Textbaustein …“-Menü gerade aufgeklappt ist, oder null
};

const GUT_AKZENT = '#26a69a';
const GUT_AKZENT_RGB = '38,166,154';
const GUT_WARN = '#e0a126';
const GUT_TEXT_FARBE = '#8ab4f8';    // Freitext-Bausteine im Auswahlmenü
const GUT_TEXT_RGB = '138,180,248';
const GUT_TABELLE_FARBE = '#c58af9'; // Tabellen-Bausteine im Auswahlmenü
const GUT_TABELLE_RGB = '197,138,249';
// Seitenvorschau im Stil der Word-Vorlage: Tahoma 10,5 pt, fast schwarzer Text
const PAPIER_STIL = 'background:#fff;color:#1B1F1C;max-width:794px;margin:0 auto;padding:56px 72px 72px;box-sizing:border-box;'
  + 'font-family:Tahoma,Verdana,sans-serif;font-size:14px;line-height:1.5;box-shadow:0 2px 14px rgba(0,0,0,.45);';
const PLATZHALTER_STIL = `background:#fff3cd;border-bottom:1.5px solid ${GUT_WARN};padding:0 3px;color:#7a5b00;font-weight:normal;`;
const EINGABE_STIL = 'font-family:inherit;font-size:11px;padding:5px 7px;border-radius:4px;border:1px solid rgba(255,255,255,.12);'
  + 'background:rgba(255,255,255,.04);color:var(--text,#e8eaed);width:100%;box-sizing:border-box;';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ══════════════════════════════════════════════════════════════════════════
 * Bedienelemente (dunkles Seitenpanel, gleicher Stil wie die Einzelansicht)
 * ═══════════════════════════════════════════════════════════════════════ */
function knopf(label, click, { primaer = false, gefahr = false, titel = '', klein = false } = {}) {
  const rand = primaer ? 'rgba(38,166,154,.6)' : gefahr ? 'rgba(239,83,80,.4)' : 'rgba(255,255,255,.12)';
  const farbe = primaer ? GUT_AKZENT : gefahr ? '#ef5350' : 'var(--muted)';
  return `<button data-click="${click}"${titel ? ` title="${esc(titel)}"` : ''} style="font-family:inherit;font-size:${klein ? 10 : 11}px;
    padding:${klein ? '3px 8px' : '5px 10px'};border-radius:5px;cursor:pointer;text-align:left;border:1px solid ${rand};
    background:${primaer ? 'rgba(38,166,154,.18)' : 'rgba(255,255,255,.04)'};color:${farbe};">${label}</button>`;
}
const ueberschrift = text => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:14px 0 6px;">${text}</div>`;
const feldLabel = text => `<div style="font-size:10px;color:var(--muted);margin:10px 0 3px;">${text}</div>`;
const hinweis = html => `<div style="margin-top:8px;font-size:10px;color:var(--muted);line-height:1.5;">${html}</div>`;
const panelKopf = titel => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
    <div style="font-size:12px;font-weight:600;color:var(--text,#e8eaed);">${titel}</div>
    <button data-click="gutWaehle(null,null)" title="Auswahl aufheben" style="font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer;
      border:1px solid rgba(255,255,255,.12);background:transparent;color:var(--muted);">✕</button></div>`;

function gutSay(msg, err) {
  const el = document.getElementById('gut-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = err ? '#ef5350' : GUT_AKZENT;
}

const findeKapitel = id => _gut.dok?.kapitel.find(k => k.id === id) || null;
function findeBlock(id) {
  const pos = _gut.dok ? gdFindeBlock(_gut.dok, id) : null;
  return pos ? _gut.dok.kapitel[pos.kapIdx].bloecke[pos.blockIdx] : null;
}
// Über den Fragebogen ausgeblendete Bausteine bekommen keine Abbildungs-/Tabellennummer
const teilArten = b => (ggFigurSichtbar(b.figurId) ? ggFigurTeilArten(b.figurId, { layout: b.layout, kennzahlen: b.kennzahlen }) : []);

/* ── Anlagen: Stations-Steckbriefe (lib/stations-steckbrief.js) ──
 * Der Inhalt wird nie im Dokument gespeichert, sondern bei jedem Zeichnen/Export aus dem
 * Netzmodell gelesen — Bestand zum heutigen Jahr, wie die Trafo-Tabelle in 5.1.2. */
function netzDaten() {
  let assets = [];
  try { assets = window.listAssets?.() || []; } catch (e) { void e; }
  return { assets, edges: window.stromEdges || [], gebaeude: window.gebaeude || [], heute: new Date().getFullYear() };
}
/** Anlage → { blatt, titel } oder { fehler } (Gebäude gelöscht, keine Station mehr) */
function anlageInhalt(a) {
  const d = netzDaten();
  const geb = d.gebaeude.find(g => String(g.id) === String(a.gebaeudeId));
  if (!geb) return { fehler: 'Das Stationsgebäude gibt es im Projekt nicht mehr.', titel: 'Steckbrief Trafostation' };
  const m = ssStationModell({ gebaeudeId: geb.id, ...d, messort: String(window.naMessort || ''), nurBestand: true });
  if (!m.trafos.length && !m.naps.length && !m.schaltanlagen.length) {
    return { fehler: `${ssStationsLabel(geb)}: keine bestehende Station (mehr) — Komponenten fehlen oder sind nur geplant.`, titel: 'Steckbrief ' + ssStationsLabel(geb) };
  }
  const blatt = ssSteckbriefBlatt(m, {
    liegenschaft: String(window.pdKaserneName || ''), adresse: String(window.pdLiegenschaftAdresse || ''), weNummer: String(window.pdWeNummer || ''),
  });
  return { blatt, titel: ssSteckbriefTitel(blatt), hinweise: m.hinweise };
}
const findeAnlage = id => (_gut.dok?.anlagen || []).find(a => a.id === id) || null;
/** Bestehende Stationen, für die noch keine Anlage existiert */
function fehlendeStationen() {
  const d = netzDaten();
  const da = new Set((_gut.dok?.anlagen || []).map(a => String(a.gebaeudeId)));
  return ssBestandsStationen(d.assets, d.gebaeude, d.heute).filter(g => !da.has(String(g.id)));
}
const seitenElement = (art, id) => document.querySelector(`#gut-seite [data-gut-el="${art}:${id}"]`);
const scrollZu = (art, id) => seitenElement(art, id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

/* ══════════════════════════════════════════════════════════════════════════
 * Reiter und Ansichten
 * ═══════════════════════════════════════════════════════════════════════ */
export function gutBuildAnalyseSection() {
  const tabBar = document.getElementById('analyse-view-tabs');
  if (tabBar && !tabBar.querySelector('[data-section="ggrafik"]')) {
    const btn = document.createElement('button');
    btn.className = 'analyse-section-tab';
    // Schlüssel noch aus der Zeit als „Gutachten-Grafiken“ — bleibt, damit 04a-ui-panels.js unverändert umschaltet
    btn.dataset.section = 'ggrafik';
    btn.dataset.click = "setAnalyseSection('ggrafik')";
    btn.textContent = '📝 Gutachten';
    btn.title = 'Gutachten-Editor: Gliederung mit Texten und Abbildungen — plus die Einzelgrafiken für Word.';
    tabBar.appendChild(btn);
  }
  if (document.getElementById('analyse-ggrafik-wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'analyse-ggrafik-wrap';
  wrap.style.display = 'none';
  wrap.innerHTML = `
<div style="display:flex;flex-direction:column;height:calc(100vh - 160px);min-height:420px;background:#0f0f1a;border-radius:8px;overflow:hidden;">
  <div id="gut-modusleiste" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(38,166,154,.15);flex-shrink:0;"></div>
  <div id="gut-dokument" style="flex:1;min-height:0;display:flex;">
    <div id="gut-gliederung" style="width:270px;flex-shrink:0;overflow-y:auto;border-right:1px solid rgba(38,166,154,.15);padding:10px;"></div>
    <div id="gut-seite-scroll" style="flex:1;min-width:0;overflow-y:auto;padding:20px;background:#161622;"><div id="gut-seite"></div></div>
    <div id="gut-eigenschaften" style="width:300px;flex-shrink:0;overflow-y:auto;border-left:1px solid rgba(38,166,154,.15);padding:10px;"></div>
  </div>
  <div id="gut-einzel" style="flex:1;min-height:0;display:none;"></div>
  <div id="gut-praes" style="flex:1;min-height:0;display:none;"></div>
</div>`;
  document.getElementById('center-analyse-view')?.appendChild(wrap);
  ggMountEinzelansicht(document.getElementById('gut-einzel'));
}

export function gutShowSection(visible) {
  const wrap = document.getElementById('analyse-ggrafik-wrap');
  if (!wrap) return;
  wrap.style.display = visible ? '' : 'none';
  if (!visible) return;
  _gut.cache.clear();   // Projektdaten können sich geändert haben, seit der Reiter zuletzt offen war
  gutRender();
}

/** Umschalter und sichtbaren Bereich an _gut.modus anpassen; true = Dokumentansicht. */
function zeigeModus() {
  const dokEl = document.getElementById('gut-dokument');
  const einzelEl = document.getElementById('gut-einzel');
  const praesEl = document.getElementById('gut-praes');
  const leiste = document.getElementById('gut-modusleiste');
  if (!dokEl || !einzelEl) return false;
  const einzel = _gut.modus === 'einzel', praes = _gut.modus === 'praes';
  dokEl.style.display = einzel || praes ? 'none' : 'flex';
  einzelEl.style.display = einzel ? '' : 'none';
  if (praesEl) praesEl.style.display = praes ? 'flex' : 'none';
  if (leiste) {
    const tab = (modus, label) => {
      const aktiv = _gut.modus === modus;
      return `<button data-click="gutSetModus('${modus}')" style="font-family:inherit;font-size:11px;padding:5px 12px;border-radius:5px;cursor:pointer;
        border:1px solid ${aktiv ? 'rgba(38,166,154,.6)' : 'rgba(255,255,255,.1)'};background:${aktiv ? 'rgba(38,166,154,.18)' : 'transparent'};
        color:${aktiv ? GUT_AKZENT : 'var(--muted)'};">${label}</button>`;
    };
    leiste.innerHTML = tab('dokument', '📄 Dokument') + tab('praes', '🖥 Präsentation') + tab('einzel', '🖼 Einzelgrafiken')
      + `<span id="gut-status" style="margin-left:12px;font-size:11px;color:${GUT_AKZENT};"></span>`
      + (!einzel && _gut.dok
          ? `<span style="margin-left:auto;display:flex;gap:6px;align-items:center;">${plausiKnopf()}${knopf('⟳ Daten aktualisieren', 'gutAktualisieren()', { titel: 'Alle Abbildungen neu aus dem Projektstand zeichnen.' })}`
            + (praes
              ? `${knopf('⤓ PowerPoint (.pptx)', 'gutPptxExport()', { primaer: true, titel: 'Präsentation im Gutachtendesign mit den angehakten Folien.' })}</span>`
              : `${knopf('⤓ Word-Datei (.docx)', 'gutWordExport()', { primaer: true, titel: 'Komplettes Gutachten im LKEBw-Layout: Deckblatt, Verzeichnisse, Kapitel, Abbildungen und Tabellen.' })}</span>`)
            + (_gut.plausiOffen ? plausiListe() : '')
          : '');
  }
  return !einzel;
}

/* ── Plausibilitätsprüfung (C3): nur eine kleine Zahl am Export, die Liste erst auf Klick ── */
function plausiPunkte() {
  const p = [...ggPlausiPruefung()];
  if (gdGliederungVersion(_gut.dok) < 2) p.unshift({ stufe: 'warn', text: 'Dokument folgt der alten Gliederung – rechts „Auf neue Gliederung umstellen“.' });
  const offen = [...offeneProKapitel().values()].reduce((a, n) => a + n, 0);
  if (offen) p.push({ stufe: 'info', text: `${offen} offene Platzhalter im Text (gelb) – anklicken zum Ausfüllen.` });
  return p;
}
function plausiKnopf() {
  let p = [];
  try { p = plausiPunkte(); } catch (e) { void e; }
  if (!p.length) return `<span title="Plausibilitätsprüfung: keine Auffälligkeiten" style="font-size:11px;color:${GUT_AKZENT};">✓</span>`;
  const warn = p.some(x => x.stufe === 'warn');
  return `<button data-click="gutPlausiUmschalten()" title="Plausibilitätsprüfung — Hinweise anzeigen" style="font-family:inherit;font-size:11px;padding:4px 9px;border-radius:5px;cursor:pointer;
    border:1px solid ${warn ? 'rgba(224,161,38,.6)' : 'rgba(255,255,255,.15)'};background:transparent;color:${warn ? GUT_WARN : 'var(--muted)'};">${warn ? '⚠' : 'ℹ'} ${p.length}</button>`;
}
function plausiListe() {
  const p = plausiPunkte();
  return `<div style="flex-basis:100%;margin-top:6px;padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:6px;font-size:11px;line-height:1.5;">
    ${p.length ? p.map(x => `<div style="color:${x.stufe === 'warn' ? GUT_WARN : 'var(--muted)'};">${x.stufe === 'warn' ? '⚠' : 'ℹ'} ${esc(x.text)}</div>`).join('') : '✓ Keine Auffälligkeiten.'}
    <div style="margin-top:4px;opacity:.6;">Nur Hinweise — der Export funktioniert trotzdem. <a href="#" data-click="event.preventDefault();gutPlausiUmschalten()" style="color:inherit;">schließen</a></div></div>`;
}
export function gutPlausiUmschalten() { _gut.plausiOffen = !_gut.plausiOffen; zeigeModus(); }

export function gutRender() {
  if (!zeigeModus()) { ggShowSection(true); return; }
  if (_gut.modus === 'praes') { renderPraes(); return; }
  renderSeite();
  renderGliederung();   // nach der Seite: zählt die offenen Platzhalter im gezeichneten Dokument
  renderEigenschaften();
}

export function gutSetModus(modus) {
  _gut.modus = modus === 'einzel' ? 'einzel' : modus === 'praes' ? 'praes' : 'dokument';
  // In der Einzelansicht geänderte Haken und Kopfzeilen sollen im Dokument und in der Präsentation ankommen
  if (_gut.modus !== 'einzel') _gut.cache.clear();
  gutRender();
}

/** Aus einem Block direkt in die Einzelansicht der Figur springen (Kopfzeile, Haken, Platzhalter). */
export function gutInEinzelansicht(figurId) {
  _gut.modus = 'einzel';
  zeigeModus();
  ggSelectFigur(figurId);
}

export function gutAktualisieren() {
  _gut.cache.clear();
  gutRender();
  gutSay('✓ Abbildungen neu aus dem Projektstand gezeichnet.');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Seite (Mitte)
 * ═══════════════════════════════════════════════════════════════════════ */
function leerzustandHtml() {
  return `<div style="${PAPIER_STIL}text-align:center;padding:70px 60px;">
    <div style="font-size:20px;font-weight:bold;margin-bottom:10px;">Noch kein Gutachten angelegt</div>
    <div style="color:#555;max-width:480px;margin:0 auto 22px;">Die Standardgliederung übernimmt die Kapitel des bestehenden
      Gutachtens und setzt alle vorhandenen Abbildungen und Textbausteine gleich in ihr Kapitel. Danach lässt sich
      alles verschieben, umbenennen und ergänzen.</div>
    <button data-click="gutStandardAnlegen()" style="font-family:inherit;font-size:13px;padding:8px 18px;border-radius:5px;cursor:pointer;
      border:1px solid ${GUT_AKZENT};background:${GUT_AKZENT};color:#fff;">Standardgliederung anlegen</button>
    <button data-click="gutLeeresAnlegen()" style="font-family:inherit;font-size:13px;padding:8px 18px;border-radius:5px;cursor:pointer;
      border:1px solid #bbb;background:#fff;color:#333;margin-left:8px;">Leeres Dokument</button>
  </div>`;
}

function textBlockHtml(text) {
  const absaetze = String(text || '').split(/\n\s*\n/).map(a => a.trim()).filter(Boolean);
  if (!absaetze.length) return '<p style="margin:0;color:#999;font-style:italic;">Leerer Textblock — Text rechts unter „Freitext“ eingeben.</p>';
  return absaetze.map(a => `<p style="margin:0 0 10px;text-align:justify;">${esc(a).replace(/\n/g, '<br>')}</p>`).join('');
}

function figurErgebnis(b) {
  const schluessel = `${b.figurId}|${b.layout}|${b.kennzahlen}`;
  const alt = _gut.cache.get(b.id);
  if (alt && alt.schluessel === schluessel) return alt.ergebnis;
  let ergebnis;
  try {
    ergebnis = ggRenderFigurFuerDokument(b.figurId, { layout: b.layout, kennzahlen: b.kennzahlen })
      || { fehler: 'Diese Abbildung gibt es in dieser Programmversion nicht.' };
  } catch (e) {
    console.error('Gutachten-Editor: Abbildung konnte nicht gezeichnet werden', b.figurId, e);
    ergebnis = { fehler: 'Abbildung konnte nicht gezeichnet werden: ' + e.message };
  }
  _gut.cache.set(b.id, { schluessel, ergebnis });
  return ergebnis;
}

/** 'bild'-Block → frisches <svg>-Element aus dem gespeicherten Quelltext (oder null bei Parsefehler). */
function bildSvgElement(b) {
  try {
    const el = new DOMParser().parseFromString(b.svg, 'image/svg+xml').documentElement;
    return el?.tagName?.toLowerCase() === 'svg' ? el : null;
  } catch (e) { void e; return null; }
}

function beschriftungEl(nr, text) {
  const d = document.createElement('div');
  d.style.cssText = 'font-size:11.5px;color:#5A5F5A;margin:5px 0 0;';
  d.textContent = `${nr.art} ${nr.nr}: ${text}`;
  return d;
}

function figurBlockInhalt(box, b, nummern, zuEinpassen) {
  if (!ggFigurSichtbar(b.figurId)) {
    const titel = ggFigurenKatalog().find(f => f.id === b.figurId)?.titel || b.figurId;
    box.innerHTML = `<div style="font-size:11px;color:#9a9f9a;padding:2px 0;" title="Erscheint nicht im Export und nicht in der Präsentation. Ändern über den Fragebogen des Kapitels (rechts) bzw. die Projektdaten.">⊘ ${esc(titel)} — ${esc(ggFigurAusblendGrund(b.figurId))}</div>`;
    return;
  }
  const erg = figurErgebnis(b);
  if (erg.fehler) {
    box.innerHTML = `<div style="padding:14px;border:1px dashed ${GUT_WARN};color:#7a5b00;background:#fff8e1;font-size:12px;">
      ⚠ ${esc(erg.fehler)} <span style="color:#999;">(${esc(b.figurId)})</span></div>`;
    return;
  }
  const titel = b.unterschrift.trim() || erg.titel;
  erg.teile.forEach((teil, i) => {
    const nr = nummern[i];
    const beschriftung = nr ? beschriftungEl(nr, i === 0 ? titel : `${erg.tabelleTitel}: ${titel}`) : null;
    const el = teil.el;
    if (teil.art === null) {
      // Textbaustein: im Dokument ohne eigenen Blattrahmen, in der Schrift der Seite
      Object.assign(el.style, { background: 'transparent', border: 'none', padding: '0', maxWidth: 'none',
                                fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' });
      // Platzhalter direkt ausfüllen: Klick auf das gelbe (oder selbst ausgefüllte) Feld
      el.querySelectorAll('[data-gg-name]').forEach(sp => {
        sp.dataset.click = 'event.stopPropagation();gutPlatzhalterKlick(this.dataset.ggName)';
        sp.style.cursor = 'text';
        sp.title = 'Klicken zum Ausfüllen — gilt für alle gleichnamigen Platzhalter und wird in der Projektdatei gespeichert';
      });
    } else {
      Object.assign(el.style, { width: '100%', height: 'auto', display: 'block' });
      if (el.tagName?.toLowerCase() === 'svg') zuEinpassen.push(el);
    }
    const halter = document.createElement('div');
    halter.dataset.gutTeil = String(i);
    if (i > 0) halter.style.marginTop = '14px';
    halter.appendChild(el);
    box.appendChild(halter);
    if (beschriftung) box.appendChild(beschriftung);   // wie in der Word-Vorlage unter Abbildung und Tabelle
  });
}

function bildBlockInhalt(box, b, nr) {
  if (!b.svg) {
    box.innerHTML = `<div style="padding:14px;border:1px dashed ${GUT_WARN};color:#7a5b00;background:#fff8e1;font-size:12px;">
      ⚠ Noch nicht eingerichtet — rechts „✎ In Liegenschaftsbilder einrichten“ anklicken.</div>`;
    return;
  }
  const svg = bildSvgElement(b);
  if (!svg) {
    box.innerHTML = `<div style="padding:14px;border:1px dashed ${GUT_WARN};color:#7a5b00;background:#fff8e1;font-size:12px;">
      ⚠ Grafik konnte nicht angezeigt werden — noch einmal übernehmen.</div>`;
    return;
  }
  Object.assign(svg.style, { width: '100%', height: 'auto', display: 'block' });
  const titel = b.unterschrift.trim() || 'Lageplan der Liegenschaft';
  const halter = document.createElement('div');
  halter.appendChild(svg);
  box.appendChild(halter);
  if (nr) box.appendChild(beschriftungEl(nr, titel));
}

function renderSeite() {
  const host = document.getElementById('gut-seite');
  if (!host) return;
  const scroll = document.getElementById('gut-seite-scroll');
  const scrollTop = scroll?.scrollTop || 0;
  host.replaceChildren();
  if (!_gut.dok) { host.innerHTML = leerzustandHtml(); return; }

  const papier = document.createElement('div');
  papier.style.cssText = PAPIER_STIL;
  const nummern = gdKapitelNummern(_gut.dok.kapitel);
  const beschriftungen = gdBeschriftungen(_gut.dok, teilArten);
  const zuEinpassen = [];

  _gut.dok.kapitel.forEach((k, ki) => {
    const h = document.createElement('div');
    h.dataset.gutEl = 'kapitel:' + k.id;
    h.dataset.click = `gutWaehle('kapitel','${k.id}')`;
    const abstand = ki === 0 ? 0 : k.ebene === 1 ? 28 : 18;
    h.style.cssText = `font-size:${[0, 21, 17, 15][k.ebene]}px;font-weight:bold;margin:${abstand}px 0 8px;padding:2px 4px;border-radius:3px;cursor:pointer;`;
    h.innerHTML = `<span style="display:inline-block;min-width:${k.ebene * 16 + 14}px;color:#266426;">${nummern[ki]}</span>`
      + (k.titel.trim() ? esc(k.titel) : `<span data-gg-feld="offen" style="${PLATZHALTER_STIL}">[Kapiteltitel ergänzen]</span>`);
    papier.appendChild(h);

    for (const b of k.bloecke) {
      const box = document.createElement('div');
      box.dataset.gutEl = 'block:' + b.id;
      box.dataset.click = `gutWaehle('block','${b.id}')`;
      box.style.cssText = 'margin:8px 0;padding:4px 6px;border-radius:3px;cursor:pointer;';
      if (b.typ === 'text') box.innerHTML = textBlockHtml(b.text);
      else if (b.typ === 'bild') bildBlockInhalt(box, b, (beschriftungen.get(b.id) || [])[0]);
      else figurBlockInhalt(box, b, beschriftungen.get(b.id) || [], zuEinpassen);
      papier.appendChild(box);
    }
  });

  const anlagen = _gut.dok.anlagen || [];
  if (anlagen.length) {
    const anr = gdAnlagenNummern(anlagen);
    const verz = document.createElement('div');
    verz.style.cssText = 'margin:40px 0 0;padding-top:18px;border-top:2px dashed #c5ccc4;';
    verz.innerHTML = `<div style="font-size:21px;font-weight:bold;margin-bottom:8px;">Anlagen</div>`
      + `<table style="width:100%;border-collapse:collapse;font-size:13px;">${anlagen.map((a, i) =>
          `<tr><td style="width:110px;border-top:1px solid #E2E4DF;border-bottom:1px solid #E2E4DF;padding:4px 6px;color:#266426;">Anlage ${anr[i]}</td>`
          + `<td style="border-top:1px solid #E2E4DF;border-bottom:1px solid #E2E4DF;padding:4px 6px;">${esc(anlageInhalt(a).titel)}</td></tr>`).join('')}</table>`;
    papier.appendChild(verz);
    anlagen.forEach((a, i) => {
      const inhalt = anlageInhalt(a);
      const box = document.createElement('div');
      box.dataset.gutEl = 'anlage:' + a.id;
      box.dataset.click = `gutWaehle('anlage','${a.id}')`;
      box.style.cssText = 'margin:34px 0 0;padding:14px 6px 4px;border-top:2px dashed #c5ccc4;border-radius:3px;cursor:pointer;';
      box.innerHTML = `<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#3F9C3F;">Anlage ${anr[i]}</div>`
        + `<div style="font-size:21px;font-weight:bold;margin:2px 0 10px;">${esc(inhalt.titel)}</div>`
        + (inhalt.fehler
          ? `<div style="padding:14px;border:1px dashed ${GUT_WARN};color:#7a5b00;background:#fff8e1;font-size:12px;">⚠ ${esc(inhalt.fehler)}</div>`
          : `<div style="font-size:11.5px;">${ssSteckbriefHtml(inhalt.blatt)}</div>`);
      papier.appendChild(box);
    });
  }

  host.appendChild(papier);
  zuEinpassen.forEach(svg => ggFitLabels(svg));   // Textbreite lässt sich erst im Dokument messen
  markiereAuswahl();
  if (scroll) scroll.scrollTop = scrollTop;
}

function markiereAuswahl() {
  const schluessel = _gut.auswahl ? `${_gut.auswahl.art}:${_gut.auswahl.id}` : '';
  document.querySelectorAll('#gut-seite [data-gut-el]').forEach(el => {
    const an = el.dataset.gutEl === schluessel;
    el.style.outline = an ? `2px solid ${GUT_AKZENT}` : '';
    el.style.outlineOffset = an ? '2px' : '';
    el.style.background = an ? 'rgba(38,166,154,.06)' : '';
  });
}

/** Offene Platzhalter je Kapitel — gezählt im gezeichneten Dokument, fehlender Kapiteltitel zählt mit. */
function offeneProKapitel() {
  const m = new Map();
  for (const k of _gut.dok?.kapitel || []) {
    let n = k.titel.trim() ? 0 : 1;
    for (const b of k.bloecke) n += seitenElement('block', b.id)?.querySelectorAll('[data-gg-feld="offen"]').length || 0;
    m.set(k.id, n);
  }
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gliederung (links)
 * ═══════════════════════════════════════════════════════════════════════ */
function blockLabel(b, katalog) {
  const zeile = (icon, text) => `<span style="flex-shrink:0;opacity:.8;">${icon}</span>`
    + `<span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${text}</span>`;
  if (b.typ === 'text') {
    const t = b.text.trim().replace(/\s+/g, ' ');
    return zeile('¶', t ? esc(t.slice(0, 70)) : '<i>Leerer Freitext</i>');
  }
  if (b.typ === 'bild') {
    return zeile(b.svg ? '🗺' : '⚠', esc(b.unterschrift.trim() || (b.svg ? 'Lageplan der Liegenschaft' : 'Lageplan — noch nicht eingerichtet')));
  }
  const f = katalog.get(b.figurId);
  const icon = !f ? '⚠' : f.istText ? '¶' : f.istTabelle ? '▤' : '▨';
  return zeile(icon, esc(b.unterschrift.trim() || f?.titel || b.figurId));
}

function renderGliederung() {
  const el = document.getElementById('gut-gliederung');
  if (!el) return;
  const kopf = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">Gliederung</div>
      ${_gut.dok ? `<div style="display:flex;gap:4px;">
          ${knopf('📄 Dokument', 'gutWaehle(null,null)', { klein: true, titel: 'Eigenschaften des gesamten Dokuments rechts anzeigen (Zähler, Standardabgleich, Deckblatt)' })}
          ${knopf('+ Kapitel', 'gutAddKapitel()', { klein: true, titel: 'Neues Hauptkapitel am Ende' })}</div>` : ''}</div>`;
  if (!_gut.dok) {
    el.innerHTML = kopf + hinweis('Noch kein Dokument — in der Mitte die Standardgliederung anlegen.');
    return;
  }
  const nummern = gdKapitelNummern(_gut.dok.kapitel);
  const katalog = new Map(ggFigurenKatalog().map(f => [f.id, f]));
  const offen = offeneProKapitel();
  const zeile = (art, id, einrueckung, grundfarbe, inhalt) => {
    const aktiv = _gut.auswahl?.art === art && _gut.auswahl?.id === id;
    return `<div data-click="gutWaehle('${art}','${id}',true)" style="display:flex;align-items:center;gap:6px;padding:4px 6px 4px ${6 + einrueckung}px;
      margin-bottom:1px;border-radius:4px;cursor:pointer;font-size:11px;line-height:1.35;
      background:${aktiv ? 'rgba(38,166,154,.16)' : 'transparent'};color:${aktiv ? GUT_AKZENT : grundfarbe};">${inhalt}</div>`;
  };

  let html = kopf;
  _gut.dok.kapitel.forEach((k, ki) => {
    const einr = (k.ebene - 1) * 12;
    const titel = k.titel.trim() ? esc(k.titel) : `<i style="color:${GUT_WARN};">Titel ergänzen</i>`;
    const n = offen.get(k.id) || 0;
    const zaehler = n
      ? `<span title="${n} offene Platzhalter" style="margin-left:auto;flex-shrink:0;font-size:9px;padding:0 5px;border-radius:8px;background:rgba(224,161,38,.2);color:${GUT_WARN};">${n}</span>`
      : '';
    html += zeile('kapitel', k.id, einr, 'var(--text,#e8eaed)',
      `<span style="flex-shrink:0;opacity:.6;">${nummern[ki]}</span>`
      + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${k.ebene === 1 ? 'font-weight:600;' : ''}">${titel}</span>${zaehler}`);
    for (const b of k.bloecke) html += zeile('block', b.id, einr + 18, 'var(--muted)', blockLabel(b, katalog));
  });
  const anlagen = _gut.dok.anlagen || [];
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 4px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">Anlagen</div>
      ${knopf('+ Steckbriefe', 'gutAnlagenSteckbriefe()', { klein: true, titel: 'Für jede bestehende Trafo-/Übergabestation einen Stations-Steckbrief als Anlage anlegen (vorhandene bleiben)' })}</div>`;
  if (!anlagen.length) html += hinweis('Noch keine Anlagen.');
  const anr = gdAnlagenNummern(anlagen);
  anlagen.forEach((a, i) => {
    const inhalt = anlageInhalt(a);
    html += zeile('anlage', a.id, 0, inhalt.fehler ? GUT_WARN : 'var(--text,#e8eaed)',
      `<span style="flex-shrink:0;opacity:.6;min-width:26px;">${anr[i]}</span>`
      + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${inhalt.fehler ? '⚠ ' : '📋 '}${esc(inhalt.titel.replace(/^Steckbrief\s+/, ''))}</span>`);
  });
  el.innerHTML = html;
}

export function gutWaehle(art, id, scrollen = false) {
  _gut.auswahl = art && id ? { art, id } : null;
  markiereAuswahl();
  renderGliederung();
  renderEigenschaften();
  if (scrollen && _gut.auswahl) seitenElement(art, id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Eigenschaften (rechts)
 * ═══════════════════════════════════════════════════════════════════════ */
function dokumentPanel() {
  const dok = _gut.dok;
  let nAbb = 0, nTab = 0, nText = 0;
  for (const liste of gdBeschriftungen(dok, teilArten).values()) {
    for (const x of liste) { if (x?.art === 'Abbildung') nAbb++; else if (x?.art === 'Tabelle') nTab++; }
  }
  dok.kapitel.forEach(k => k.bloecke.forEach(b => { if (b.typ === 'text') nText++; }));
  const offen = [...offeneProKapitel().values()].reduce((s, n) => s + n, 0);
  const imDok = gdFigurIds(dok);
  const fehlend = ggFigurenKatalog().filter(f => !imDok.has(f.id));
  // Vorschau des Abgleichs — ändert nichts; alte Kapitel mit ihrer heutigen Nummer nennen
  const abgleich = gdMitStandardAbgleichen(dok, ggFigurenKatalog());
  const nummernJetzt = gdKapitelNummern(dok.kapitel);
  const nrJetzt = new Map(dok.kapitel.map((k, i) => [k.id, nummernJetzt[i]]));
  const nFehlendK = abgleich.neueKapitel.length, nFehlendB = abgleich.neueBloecke.length, nUmbenannt = abgleich.umbenannt.length;
  const kachel = (wert, label) => `<div style="background:rgba(255,255,255,.04);border-radius:5px;padding:7px 9px;">
      <div style="font-size:15px;color:var(--text,#e8eaed);">${wert}</div><div style="font-size:10px;color:var(--muted);">${label}</div></div>`;
  return `<div style="font-size:12px;font-weight:600;color:var(--text,#e8eaed);margin-bottom:8px;">Dokument</div>`
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${kachel(dok.kapitel.length, 'Kapitel')}${kachel(nAbb, 'Abbildungen')}${kachel(nTab, 'Tabellen')}${kachel(nText, 'Freitexte')}</div>`
    + (offen
        ? `<div style="margin-top:10px;font-size:11px;color:${GUT_WARN};line-height:1.45;">⚠ ${offen} offene Platzhalter bzw. fehlende Kapiteltitel — in der Gliederung gelb gezählt.</div>`
        : `<div style="margin-top:10px;font-size:11px;color:${GUT_AKZENT};">✓ Keine offenen Platzhalter.</div>`)
    + hinweis('Kapitel oder Block links in der Gliederung oder direkt auf der Seite anklicken, um ihn zu bearbeiten.')
    + (fehlend.length
        ? ueberschrift('Noch nicht im Dokument') + fehlend.map(f => `<div style="font-size:11px;color:var(--muted);margin-bottom:3px;line-height:1.4;">• ${esc(f.titel)}
            <span style="opacity:.65;">(${esc(f.kapitel || 'ohne Kapitel')})</span></div>`).join('')
          + hinweis('Einfügen über das jeweilige Kapitel → „Inhalt einfügen“ oder alles auf einmal über „Mit Standardgliederung abgleichen“.')
        : '')
    + ueberschrift('Standardgliederung')
    + (gdGliederungVersion(dok) < 2
      ? `<div style="font-size:11px;color:${GUT_WARN};line-height:1.45;margin-bottom:6px;">Dieses Dokument folgt noch der alten Gliederung `
        + '(Wärme komplett in Kapitel 2, Elektrotechnik 3). Neu: 2 Ist-Zustand Wärme (Hochbau), 3 Wärmeversorgung, 4 Potenzialanalyse, '
        + '5 Elektrotechnik, 6 GA, 7 Variantenvergleich Wärme, 8 Resilienz, 9 Fazit.'
        + (fehlend.length ? ` Außerdem fehlen ${fehlend.length} neuere Texte und Abbildungen; sie werden nach der Umstellung angeboten.` : '') + '</div>'
        + knopf('⇄ Auf neue Gliederung umstellen', 'gutGliederungUmstellen()', { primaer: true,
            titel: 'Verschiebt Kapitel samt Freitexten, Lageplänen und Einstellungen an ihren neuen Platz. Eigene Kapitel bleiben hinter dem Kapitel, dem sie folgten.' })
      : '')
    + (gdGliederungVersion(dok) < 2 ? '' : nFehlendK || nFehlendB || nUmbenannt
        ? `<div style="font-size:11px;color:${GUT_WARN};line-height:1.45;margin-bottom:6px;">`
          + (nFehlendK || nFehlendB ? 'Gegenüber der aktuellen Vorlage fehlen '
            + [nFehlendK && `${nFehlendK} Kapitel`, nFehlendB && `${nFehlendB} Abbildungen/Textbausteine`].filter(Boolean).join(' und ') + '. ' : '')
          + (nUmbenannt ? `${nUmbenannt} Szenario-Kapitel ${nUmbenannt === 1 ? 'bekommt' : 'bekommen'} eine neue Nummer.` : '')
          + '</div>'
          + knopf('⇄ Mit Standardgliederung abgleichen', 'gutMitStandardAbgleichen()', { primaer: true,
              titel: 'Ergänzt fehlende Kapitel und Bausteine an der passenden Stelle. Vorhandene Kapitel, Texte und Einstellungen bleiben unverändert.' })
        : `<div style="font-size:11px;color:${GUT_AKZENT};">✓ Alle Kapitel und Bausteine der Standardgliederung sind vorhanden.</div>`)
    + (gdGliederungVersion(dok) >= 2 && abgleich.fremdeKapitel.length
        ? hinweis(`${abgleich.fremdeKapitel.length} Kapitel ohne Gegenstück in der Standardgliederung, z. B. aus einer älteren Vorlage: `
            + abgleich.fremdeKapitel.slice(0, 6).map(k => esc(`${nrJetzt.get(k.id) || k.nr} ${k.titel.trim() || '[ohne Titel]'}`)).join(' · ')
            + (abgleich.fremdeKapitel.length > 6 ? ' · …' : '')
            + '. Inhalte bei Bedarf in die passenden Kapitel verschieben, leere Kapitel löschen.')
        : '')
    + ueberschrift('Platzhalter') + platzhalterHtml()
    + fragenHtml(GF_FRAGEN, 'Fragebogen (optional, alle Kapitel)')
    + standardtextPanel()
    + anlagenAbschnitt()
    + deckblattPanel()
    + ueberschrift('Zurücksetzen')
    + knopf('↺ Standardgliederung neu anlegen', 'gutStandardAnlegen(true)', { gefahr: true, titel: 'Ersetzt das aktuelle Dokument samt aller Freitexte.' });
}

/**
 * Katalog-Bausteine als Baum entlang der Standardgliederung (für das Auswahlmenü „Abbildung oder
 * Textbaustein …“): Kapitelüberschriften mit ihrer echten Ebene 1–3, damit sich das Menü wie das
 * Inhaltsverzeichnis links einrücken lässt. Nur Kapitel mit eigenen oder untergeordneten Bausteinen
 * bleiben stehen; Bausteine ohne erkennbare Kapitelnummer landen unter „Sonstige“. Statisch (Katalog
 * und Standardgliederung ändern sich nie zur Laufzeit) → einmal berechnet, dauerhaft gecacht.
 */
let _ggMenuBaumCache = null;
function ggMenuBaum() {
  if (_ggMenuBaumCache) return _ggMenuBaumCache;
  const nummern = gdKapitelNummern(GUTACHTEN_STANDARD_GLIEDERUNG);
  const knoten = GUTACHTEN_STANDARD_GLIEDERUNG.map((k, i) => ({ nr: nummern[i], ebene: k.ebene, titel: k.titel, figuren: [], kinder: [] }));
  const byNr = new Map(knoten.map(n => [n.nr, n]));
  const sonstige = { nr: 'sonstige', ebene: 1, titel: 'Sonstige', figuren: [], kinder: [] };
  for (const f of ggFigurenKatalog()) {
    const nr = (String(f.kapitel).match(/^\d+(\.\d+)*/) || [''])[0];
    (byNr.get(nr) || sonstige).figuren.push(f);
  }
  const stapel = [];
  knoten.forEach(n => {
    n.eltern = n.ebene > 1 ? stapel[n.ebene - 2] : null;
    if (n.eltern) n.eltern.kinder.push(n);
    stapel[n.ebene - 1] = n;
    stapel.length = n.ebene;
  });
  for (let i = knoten.length - 1; i >= 0; i--) {
    const n = knoten[i];
    n.sichtbar = n.figuren.length > 0 || n.kinder.some(c => c.sichtbar);
  }
  // Reihenfolge je Kapitel wie im Musterkapitel (gleiche Regel wie gdStandardDokument: reihe, sonst Text vor Abbildung).
  for (const n of knoten) n.figuren.sort((a, b) => ggBausteinRang(a) - ggBausteinRang(b));
  const liste = knoten.filter(n => n.sichtbar);
  if (sonstige.figuren.length) {
    sonstige.figuren.sort((a, b) => ggBausteinRang(a) - ggBausteinRang(b));
    sonstige.sichtbar = true; liste.push(sonstige); byNr.set('sonstige', sonstige);
  }
  _ggMenuBaumCache = { liste, byNr };
  return _ggMenuBaumCache;
}
/** Position eines Katalogeintrags im Kapitel — wie `katalogRang` in lib/gutachten-dokument.js: `reihe`, sonst Text vor Abbildung/Tabelle. */
const ggBausteinRang = f => (Number.isFinite(f.reihe) ? f.reihe : f.istText ? 0 : 1000);
const ggBausteinFarbe = f => (f.istText ? GUT_TEXT_FARBE : f.istTabelle ? GUT_TABELLE_FARBE : GUT_AKZENT);
const ggBausteinRgb = f => (f.istText ? GUT_TEXT_RGB : f.istTabelle ? GUT_TABELLE_RGB : GUT_AKZENT_RGB);
const ggBausteinIcon = f => (f.istText ? '¶' : f.istTabelle ? '▤' : '▨');

/** Inhalt des aufgeklappten Auswahlmenüs für Kapitel `kapId` (Standardgliederung `nr`). */
function figurMenuHtml(kapId, nr) {
  const katalog = ggFigurenKatalog();
  const imDok = gdFigurIds(_gut.dok);
  const passend = katalog.filter(f => (f.kapitel.match(/^\d+(\.\d+)*/) || [''])[0] === nr).sort((a, b) => ggBausteinRang(a) - ggBausteinRang(b));
  // Farbige Hinterlegung bleibt auch für bereits eingefügte (✓) Bausteine sichtbar — sonst wird ein
  // fast vollständiges Kapitel (Normalfall nach „Standardgliederung anlegen") wieder komplett grau
  // und die Typ-Unterscheidung verschwindet genau dort, wo am meisten Zeilen stehen.
  const itemZeile = (f, einr) => {
    const drin = imDok.has(f.id);
    return `<div data-click="gutAddFigur('${kapId}','${esc(f.id)}')" title="${esc(f.titel)}"
        style="display:flex;align-items:center;gap:6px;padding:3px 6px 3px ${einr}px;border-radius:4px;cursor:pointer;margin:1px 0;
        font-size:11px;line-height:1.35;color:var(--text,#e8eaed);opacity:${drin ? '.55' : '1'};
        background:rgba(${ggBausteinRgb(f)},${drin ? '.06' : '.16'});">
        <span style="flex-shrink:0;width:11px;text-align:center;color:${ggBausteinFarbe(f)};">${drin ? '✓' : ggBausteinIcon(f)}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.titel)}</span></div>`;
  };
  const headerZeile = knoten => {
    const einr = (knoten.ebene - 1) * 10;
    const fehlend = knoten.figuren.filter(f => !imDok.has(f.id)).length;
    const titel = `${knoten.nr !== 'sonstige' ? esc(knoten.nr) + ' ' : ''}${esc(knoten.titel)}`;
    const ganzesKapitel = knoten.figuren.length
      ? `<button data-click="gutAddKapitelInhalt('${kapId}','${esc(knoten.nr)}')"
          title="Alle Bausteine dieses Kapitels ans Ende von Kapitel ${esc(nr)} einfügen"
          style="flex-shrink:0;font-size:9px;padding:1px 6px;border-radius:8px;cursor:pointer;border:1px solid rgba(38,166,154,.4);
          background:rgba(38,166,154,.12);color:${GUT_AKZENT};">${fehlend ? `⇩ alle (${fehlend})` : '✓ alle'}</button>`
      : '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 4px 3px ${einr}px;">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;
          font-weight:${knoten.ebene === 1 ? 700 : 600};color:var(--text,#e8eaed);">${titel}</span>${ganzesKapitel}</div>`;
  };
  let html = '';
  if (passend.length) {
    html += `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:${GUT_AKZENT};padding:4px 4px 2px;">Passend zu Kapitel ${esc(nr)}</div>`
      + passend.map(f => itemZeile(f, 4)).join('')
      + `<div style="height:1px;background:rgba(255,255,255,.08);margin:6px 0;"></div>`;
  }
  const { liste } = ggMenuBaum();
  for (const knoten of liste) {
    html += headerZeile(knoten);
    html += knoten.figuren.map(f => itemZeile(f, (knoten.ebene - 1) * 10 + 14)).join('');
  }
  return `<div style="margin-top:6px;max-height:320px;overflow-y:auto;border:1px solid rgba(255,255,255,.12);
      border-radius:5px;background:rgba(0,0,0,.25);padding:4px 6px;">${html}</div>`;
}

function kapitelPanel(k, idx) {
  const nr = gdKapitelNummern(_gut.dok.kapitel)[idx];
  const id = k.id;
  const figurAuswahl = knopf(
    _gut.figurMenuOffen === id ? '▴ Abbildung oder Textbaustein schließen' : '▾ Abbildung oder Textbaustein …',
    `gutToggleFigurMenu('${id}')`)
    + (_gut.figurMenuOffen === id ? figurMenuHtml(id, nr) : '');
  const reihe = inhalt => `<div style="display:flex;flex-wrap:wrap;gap:4px;">${inhalt}</div>`;

  return panelKopf(`Kapitel ${esc(nr)}`)
    + feldLabel('Titel')
    + `<input type="text" value="${esc(k.titel)}" placeholder="Kapiteltitel" data-change="gutSetKapitelTitel('${id}',this.value)"
         data-keydown="if(event.key==='Enter')this.blur()" style="${EINGABE_STIL}">`
    + ueberschrift('Anordnung')
    + reihe(knopf('↑', `gutKapitelVerschieben('${id}',-1)`, { titel: 'Mit dem vorigen Kapitel gleicher Ebene tauschen (samt Unterkapiteln)' })
          + knopf('↓', `gutKapitelVerschieben('${id}',1)`, { titel: 'Mit dem nächsten Kapitel gleicher Ebene tauschen (samt Unterkapiteln)' })
          + knopf('← Ebene höher', `gutKapitelEbene('${id}',-1)`, { titel: 'z. B. 3.2.1 → 3.3' })
          + knopf('Ebene tiefer →', `gutKapitelEbene('${id}',1)`, { titel: 'Wird Unterkapitel des vorigen Kapitels' }))
    + ueberschrift('Neues Kapitel')
    + reihe(knopf('+ Kapitel danach', `gutAddKapitel('${id}',false)`)
          + (k.ebene < GUTACHTEN_MAX_EBENE ? knopf('+ Unterkapitel', `gutAddKapitel('${id}',true)`) : ''))
    + ueberschrift('Inhalt einfügen')
    + `<div style="display:flex;flex-direction:column;gap:6px;">${knopf('¶ Freitext', `gutAddText('${id}')`)}`
    + `${knopf('🗺 Lageplan einrichten', `gutAddLageplan('${id}')`, { titel: 'Legt einen leeren Lageplan-Block an und öffnet den Reiter 🗺️ Liegenschaftsbilder, um ihn einzurichten (Ausschnitt, Ebenen, MS-Ring, Beschriftungen).' })}`
    + `${knopf('+ Platzhalter je Trafostation', `gutAddTrafoDummies('${id}')`, { titel: 'Legt für jede bestehende Trafostation (aus dem Elektro-Tab, eine je Gebäude/Station, nicht je Trafo) einen eigenen Freitext-Platzhalter an — zum Eintragen der Begehungsergebnisse.' })}`
    + `${figurAuswahl}</div>`
    + hinweis('Neuer Inhalt kommt ans Ende des Kapitels. ✓ = steht schon im Dokument.')
    + fragenHtml(gfFragenZuKapitel(nr), 'Fragen zu diesem Kapitel (optional)', true)
    + ueberschrift('Entfernen')
    + knopf('🗑 Kapitel löschen', `gutKapitelLoeschen('${id}')`, { gefahr: true, titel: 'Unterkapitel rücken eine Ebene hoch' });
}

function blockPanel(b, kapIdx) {
  const id = b.id;
  const kap = _gut.dok.kapitel[kapIdx];
  const nr = gdKapitelNummern(_gut.dok.kapitel)[kapIdx];
  const ort = hinweis(`in Kapitel ${esc(nr)} ${esc(kap.titel)}`);
  const anordnung = ueberschrift('Anordnung')
    + `<div style="display:flex;gap:4px;">${knopf('↑ nach oben', `gutBlockVerschieben('${id}',-1)`)}${knopf('↓ nach unten', `gutBlockVerschieben('${id}',1)`)}</div>`
    + hinweis('Am Kapitelanfang bzw. -ende wandert der Block ins vorige bzw. nächste Kapitel.');
  const entfernen = ueberschrift('Entfernen') + knopf('🗑 Block entfernen', `gutBlockLoeschen('${id}')`, { gefahr: true });

  if (b.typ === 'text') {
    return panelKopf('Freitext') + ort
      + feldLabel('Text — eine Leerzeile beginnt einen neuen Absatz')
      + `<textarea rows="14" data-input="gutSetText('${id}',this.value)" data-change="gutTextFertig()"
           style="${EINGABE_STIL}resize:vertical;line-height:1.5;">${esc(b.text)}</textarea>`
      + anordnung + entfernen;
  }

  if (b.typ === 'bild') {
    return panelKopf('Lageplan') + ort
      + feldLabel('Beschriftung')
      + `<input type="text" value="${esc(b.unterschrift)}" placeholder="Lageplan der Liegenschaft"
           data-change="gutSetFigurOpt('${id}','unterschrift',this.value)" data-keydown="if(event.key==='Enter')this.blur()" style="${EINGABE_STIL}">`
      + hinweis('Leer = „Lageplan der Liegenschaft". Die Nummer vergibt das Dokument automatisch.')
      + ueberschrift('Einrichten')
      + knopf(b.svg ? '✎ In Liegenschaftsbilder einrichten' : '✎ Jetzt einrichten', `gutEditLageplan('${id}')`,
              { primaer: !b.svg, titel: 'Öffnet den Reiter 🗺️ Liegenschaftsbilder mit genau den Einstellungen, mit denen dieser Plan zuletzt gebaut wurde (bzw. leer, wenn noch keine gespeichert sind).' })
      + (b.svg ? ueberschrift('Bearbeiten und kopieren')
          + knopf('⧉ Für Word kopieren', `gutCopyTeil('${id}',0)`,
                  { primaer: true, titel: 'Nur das Bild in die Zwischenablage — ohne Beschriftung oder Nummer, die tragen Sie in Word selbst ein (z. B. über „Beschriftung einfügen").' })
        : '')
      + anordnung + entfernen;
  }

  const f = ggFigurenKatalog().find(x => x.id === b.figurId);
  if (!f) {
    return panelKopf('Abbildung fehlt') + ort
      + hinweis(`Die Abbildung „${esc(b.figurId)}“ gibt es in dieser Programmversion nicht.`) + anordnung + entfernen;
  }
  const erg = _gut.cache.get(id)?.ergebnis;
  const meldung = erg?.meldung || '';
  let html = panelKopf(f.istText ? 'Textbaustein' : f.istTabelle ? 'Tabelle' : 'Abbildung')
    + `<div style="font-size:12px;color:var(--text,#e8eaed);margin-top:6px;">${esc(f.titel)}</div>` + ort;
  if (meldung) {
    html += `<div style="margin-top:8px;font-size:11px;line-height:1.45;color:${meldung.startsWith('⚠') ? GUT_WARN : GUT_AKZENT};">${esc(meldung)}</div>`;
  }
  if (!f.istText) {
    html += feldLabel('Beschriftung')
      + `<input type="text" value="${esc(b.unterschrift)}" placeholder="${esc(erg?.titel || f.titel)}"
           data-change="gutSetFigurOpt('${id}','unterschrift',this.value)" data-keydown="if(event.key==='Enter')this.blur()" style="${EINGABE_STIL}">`
      + hinweis('Leer = Titel der Grafik. Die Nummer vergibt das Dokument automatisch.');
  }
  if (f.istBlatt) {
    const variante = `${b.layout === 'voll' ? 'voll' : 'reduziert'}|${b.kennzahlen ? '1' : '0'}`;
    const varOption = (v, label) => `<option value="${v}"${variante === v ? ' selected' : ''}>${label}</option>`;
    html += feldLabel('Blatt')
      + `<select data-change="gutSetFigurOpt('${id}','blattvariante',this.value)" style="${EINGABE_STIL}">
           ${varOption('reduziert|0', 'reduziert — ohne Kopfdaten')}
           ${varOption('reduziert|1', 'reduziert — ohne Kopfdaten, mit Kennzahlentabelle')}
           ${varOption('voll|0', 'vollständig — mit Kopfdaten, ohne Kennzahlen')}
           ${varOption('voll|1', 'vollständig — mit Kopfdaten und Kennzahlen')}
         </select>`;
  }
  html += ueberschrift('Bearbeiten und kopieren')
    + `<div style="display:flex;flex-direction:column;gap:4px;">`
    + knopf(f.istText ? '✎ Platzhalter ausfüllen' : '✎ In Einzelansicht bearbeiten', `gutInEinzelansicht('${f.id}')`,
            { titel: f.istText ? 'Platzhalter und ihre Datenquelle ansehen' : 'Kopfzeile, Haken und Datenübernahme wie bisher' })
    + knopf(f.istTabelle ? '⊞ Als Word-Tabelle kopieren' : '⧉ Für Word kopieren', `gutCopyTeil('${id}',0)`, { primaer: true })
    + ((erg?.teile?.length || 0) > 1 ? knopf('⊞ Kennzahlen als Word-Tabelle kopieren', `gutCopyTeil('${id}',1)`) : '')
    + `</div>`
    + (f.hinweis ? hinweis(esc(f.hinweis)) : '')
    + anordnung + entfernen;
  return html;
}

function anlagePanel(a) {
  const idx = _gut.dok.anlagen.indexOf(a);
  const nr = gdAnlagenNummern(_gut.dok.anlagen)[idx];
  const inhalt = anlageInhalt(a);
  const hw = inhalt.hinweise || [];
  return panelKopf(`Anlage ${esc(nr)}`)
    + `<div style="font-size:12px;color:var(--text,#e8eaed);margin-top:6px;">${esc(inhalt.titel)}</div>`
    + (inhalt.fehler ? `<div style="margin-top:8px;font-size:11px;line-height:1.45;color:${GUT_WARN};">⚠ ${esc(inhalt.fehler)}</div>` : '')
    + hinweis('Der Inhalt kommt live aus dem Stations-Steckbrief — Bestand zum heutigen Jahr. Angaben dort ändern, '
      + 'hier erscheinen sie beim nächsten Zeichnen bzw. im Word-Export.')
    + (hw.length ? `<div style="margin-top:8px;font-size:10.5px;line-height:1.5;color:${GUT_WARN};">${hw.map(h => '⚠ ' + esc(h)).join('<br>')}</div>` : '')
    + ueberschrift('Bearbeiten')
    + knopf('📋 Steckbrief öffnen', `gutAnlageOeffnen('${a.id}')`, { primaer: true, titel: 'Stations-Steckbrief im Elektro-Bereich öffnen (Stationsart, Schaltanlage, Trafos, NSHV, Mängel)' })
    + ueberschrift('Anordnung')
    + `<div style="display:flex;gap:4px;">${knopf('↑ nach oben', `gutAnlageVerschieben('${a.id}',-1)`)}${knopf('↓ nach unten', `gutAnlageVerschieben('${a.id}',1)`)}</div>`
    + hinweis('Die Nummern (Anlage I, II, …) folgen der Reihenfolge.')
    + ueberschrift('Entfernen')
    + knopf('🗑 Anlage entfernen', `gutAnlageLoeschen('${a.id}')`, { gefahr: true, titel: 'Nimmt nur die Anlage aus dem Gutachten — der Steckbrief im Projekt bleibt.' });
}

function renderEigenschaften() {
  const el = document.getElementById('gut-eigenschaften');
  if (!el) return;
  if (!_gut.dok) {
    el.innerHTML = ueberschrift('Eigenschaften') + hinweis('Hier erscheinen die Einstellungen des ausgewählten Kapitels oder Blocks.');
    return;
  }
  const a = _gut.auswahl;
  if (a?.art === 'kapitel') {
    const idx = _gut.dok.kapitel.findIndex(k => k.id === a.id);
    if (idx >= 0) { el.innerHTML = kapitelPanel(_gut.dok.kapitel[idx], idx); return; }
  }
  if (a?.art === 'block') {
    const pos = gdFindeBlock(_gut.dok, a.id);
    if (pos) { el.innerHTML = blockPanel(_gut.dok.kapitel[pos.kapIdx].bloecke[pos.blockIdx], pos.kapIdx); return; }
  }
  if (a?.art === 'anlage') {
    const an = findeAnlage(a.id);
    if (an) { el.innerHTML = anlagePanel(an); return; }
  }
  _gut.auswahl = null;
  el.innerHTML = dokumentPanel();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Aktionen (data-click/-change)
 * ═══════════════════════════════════════════════════════════════════════ */
function neuZeichnen() {
  renderSeite();
  renderGliederung();
  renderEigenschaften();
}

export function gutStandardAnlegen(ersetzen = false) {
  if (_gut.dok && !ersetzen) return;
  if (_gut.dok && !window.confirm('Das aktuelle Gutachten-Dokument samt aller Freitexte, Lagepläne und der Anordnung durch die '
      + 'Standardgliederung ersetzen? Deckblatt und Anlagen bleiben erhalten.')) return;
  const { dok, nichtZugeordnet } = gdStandardDokument(ggFigurenKatalog());
  dok.deckblatt = _gut.dok?.deckblatt || dok.deckblatt;   // Projektangaben haben nichts mit der Gliederung zu tun
  dok.anlagen = _gut.dok?.anlagen || [];                  // Anlagen ebenso
  _gut.dok = dok;
  const neueAnlagen = gdStationsAnlagenErgaenzen(dok, fehlendeStationen().map(g => g.id));
  _gut.auswahl = null;
  _gut.cache.clear();
  gutRender();
  const n = dok.kapitel.reduce((s, k) => s + k.bloecke.length, 0);
  gutSay(`✓ Standardgliederung angelegt — ${n} Abbildungen und Textbausteine eingesetzt.`
    + (neueAnlagen.length ? ` ${neueAnlagen.length} Stations-Steckbrief(e) als Anlage.` : '')
    + (nichtZugeordnet.length ? ` ${nichtZugeordnet.length} ohne passendes Kapitel.` : ''));
}

/**
 * Älteres Dokument auf den Stand der Standardgliederung bringen: fehlende Kapitel und Bausteine
 * ergänzen, alles Vorhandene (Kapitel, Freitexte, Lagepläne, Block-Einstellungen) unverändert lassen.
 */
export function gutMitStandardAbgleichen() {
  if (!_gut.dok) return;
  if (gdGliederungVersion(_gut.dok) < 2) { gutSay('⚠ Das Dokument folgt noch der alten Gliederung — zuerst rechts „Auf neue Gliederung umstellen“.', true); return; }
  const erg = gdMitStandardAbgleichen(_gut.dok, ggFigurenKatalog());
  const nK = erg.neueKapitel.length, nB = erg.neueBloecke.length, nU = erg.umbenannt.length;
  if (!nK && !nB && !nU) {
    gutSay('✓ Das Dokument enthält bereits alle Kapitel und Bausteine der Standardgliederung.');
    return;
  }
  const liste = erg.neueKapitel.slice(0, 10).map(k => `  • ${k.nr} ${k.titel}`).join('\n')
    + (nK > 10 ? `\n  • … und ${nK - 10} weitere` : '');
  if (!window.confirm('Mit der Standardgliederung abgleichen?\n\n'
      + (nK ? `Neue Kapitel (${nK}):\n${liste}\n\n` : '')
      + (nB ? `${nB} Abbildungen und Textbausteine kommen in ihre Kapitel — auch solche, die früher bewusst entfernt wurden.\n\n` : '')
      + (nU ? `Neue Szenario-Nummer:\n${erg.umbenannt.map(u => `  • ${u.von} → ${u.nach}`).join('\n')}\n\n` : '')
      + 'Vorhandene Kapitel, Texte und Einstellungen bleiben sonst unverändert.')) return;
  _gut.dok = erg.dok;
  _gut.cache.clear();
  gutRender();
  gutSay(`✓ Abgeglichen — ${nK} Kapitel und ${nB} Abbildungen/Textbausteine ergänzt.`
    + (nU ? ` ${nU} Szenario-Kapitel neu nummeriert.` : '')
    + (erg.nichtZugeordnet.length ? ` ${erg.nichtZugeordnet.length} ohne passendes Kapitel.` : '')
    + (erg.fremdeKapitel.length ? ` ${erg.fremdeKapitel.length} ältere Kapitel ohne Gegenstück — rechts unter „Standardgliederung“ aufgeführt.` : ''));
}

/**
 * Dokument der alten Gliederung (Wärme komplett in 2, Elektro 3) auf Variante B umstellen: Kapitel samt
 * Freitexten, Lageplänen und Einstellungen wandern an ihren neuen Platz; nichts wird gelöscht.
 */
export function gutGliederungUmstellen() {
  if (!_gut.dok || gdGliederungVersion(_gut.dok) >= 2) return;
  if (!window.confirm('Gutachten auf die neue Gliederung umstellen?\n\n'
      + '1 Einleitung · 2 Ist-Zustand Wärme (Hochbau) · 3 Wärmeversorgung · 4 Potenzialanalyse · 5 Elektrotechnik · '
      + '6 GA · 7 Variantenvergleich Wärme · 8 Resilienz · 9 Fazit\n\n'
      + 'Alle Kapitel wandern samt Freitexten, Lageplänen und Einstellungen an ihren neuen Platz; Elektrotechnik, GA, Resilienz und Fazit '
      + 'ändern nur ihre Nummer. Eigene Kapitel bleiben hinter dem Kapitel, dem sie bisher folgten.')) return;
  const erg = gdGliederungUmstellen(_gut.dok, ggFigurenKatalog());
  if (!erg) return;
  _gut.dok = erg.dok;
  _gut.auswahl = null;
  let ergaenzt = 0;
  // Bausteine, die nach dem Anlegen des Dokuments dazugekommen sind (z. B. die Texte der Potenzialanalyse), gleich mit anbieten
  const abgl = gdMitStandardAbgleichen(_gut.dok, ggFigurenKatalog());
  if (abgl.neueBloecke.length && window.confirm(`Umgestellt. Seit dem Anlegen dieses Dokuments sind ${abgl.neueBloecke.length} Texte und Abbildungen `
      + 'dazugekommen (z. B. Potenzialanalyse, Variantenvergleich). Jetzt in ihre Kapitel einfügen?\n\nVorhandene Inhalte bleiben unverändert.')) {
    _gut.dok = abgl.dok;
    ergaenzt = abgl.neueBloecke.length;
  }
  _gut.cache.clear();
  gutRender();
  gutSay(`✓ Auf die neue Gliederung umgestellt — ${erg.verschoben.length} Kapitel mit neuer Nummer`
    + (erg.bausteine ? `, ${erg.bausteine} Bausteine in neue Unterkapitel` : '')
    + (erg.eigene.length ? `, ${erg.eigene.length} eigene Kapitel beibehalten` : '')
    + (ergaenzt ? `, ${ergaenzt} neue Texte und Abbildungen ergänzt.` : '. Neue Bausteine bei Bedarf über „Mit Standardgliederung abgleichen“ ergänzen.'));
}

/** Je bestehender Station einen Steckbrief als Anlage anlegen (vorhandene bleiben, Reihenfolge = Gebäudeliste). */
export function gutAnlagenSteckbriefe() {
  if (!_gut.dok) return;
  const fehlend = fehlendeStationen();
  if (!fehlend.length) {
    gutSay(ssBestandsStationen(netzDaten().assets, netzDaten().gebaeude).length
      ? '✓ Für jede bestehende Station gibt es schon einen Steckbrief.'
      : '⚠ Keine bestehenden Trafo- oder Übergabestationen im Modell — im Elektro-Tab zuerst welche anlegen.', !ssBestandsStationen(netzDaten().assets, netzDaten().gebaeude).length);
    return;
  }
  const neu = gdStationsAnlagenErgaenzen(_gut.dok, fehlend.map(g => g.id));
  _gut.auswahl = neu.length ? { art: 'anlage', id: neu[0].id } : _gut.auswahl;
  neuZeichnen();
  if (neu[0]) scrollZu('anlage', neu[0].id);
  gutSay(`✓ ${neu.length} Stations-Steckbrief${neu.length === 1 ? '' : 'e'} als Anlage angelegt.`);
}

export function gutAnlageVerschieben(id, richtung) {
  if (!_gut.dok || !gdAnlageVerschieben(_gut.dok, id, richtung)) return;
  neuZeichnen();
  scrollZu('anlage', id);
}

export function gutAnlageLoeschen(id) {
  if (!_gut.dok || !gdAnlageLoeschen(_gut.dok, id)) return;
  _gut.auswahl = null;
  neuZeichnen();
}

export function gutAnlageOeffnen(id) {
  const a = findeAnlage(id);
  if (!a) return;
  if (typeof window.openStationsSteckbrief === 'function') window.openStationsSteckbrief(a.gebaeudeId);
  else gutSay('⚠ Der Stations-Steckbrief ist in dieser Ansicht nicht verfügbar.', true);
}

export function gutLeeresAnlegen() {
  if (_gut.dok) return;
  _gut.dok = gdLeeresDokument();
  _gut.auswahl = { art: 'kapitel', id: _gut.dok.kapitel[0].id };
  gutRender();
}

export function gutAddKapitel(nachId = null, unter = false) {
  if (!_gut.dok) return;
  const neu = gdKapitelEinfuegen(_gut.dok, nachId, { unter });
  _gut.auswahl = { art: 'kapitel', id: neu.id };
  neuZeichnen();
  scrollZu('kapitel', neu.id);
  document.querySelector('#gut-eigenschaften input[type="text"]')?.focus();
}

export function gutKapitelVerschieben(id, richtung) {
  if (!_gut.dok) return;
  if (!gdKapitelVerschieben(_gut.dok, id, richtung)) {
    gutSay(`Kein Kapitel gleicher Ebene ${richtung < 0 ? 'davor' : 'dahinter'} — dafür erst die Ebene ändern.`, true);
    return;
  }
  neuZeichnen();
  scrollZu('kapitel', id);
  gutSay('');
}

export function gutKapitelEbene(id, delta) {
  if (!_gut.dok) return;
  if (!gdKapitelEbene(_gut.dok, id, delta)) {
    gutSay(delta > 0
      ? 'Tiefer geht es nur direkt unter ein Kapitel gleicher Ebene — und höchstens bis zur dritten Ebene.'
      : 'Das Kapitel ist schon ein Hauptkapitel.', true);
    return;
  }
  neuZeichnen();
  gutSay('');
}

export function gutKapitelLoeschen(id) {
  const k = findeKapitel(id);
  if (!k) return;
  if (k.bloecke.length && !window.confirm(`Kapitel „${k.titel || 'ohne Titel'}“ mit ${k.bloecke.length} Block/Blöcken löschen?`)) return;
  k.bloecke.forEach(b => _gut.cache.delete(b.id));
  gdKapitelLoeschen(_gut.dok, id);
  _gut.auswahl = null;
  neuZeichnen();
}

export function gutSetKapitelTitel(id, wert) {
  const k = findeKapitel(id);
  if (!k) return;
  k.titel = String(wert ?? '').trim();
  // Eigenschaften bewusst nicht neu aufbauen: change feuert beim Wegklicken, ein
  // Neuaufbau in diesem Moment würde den angeklickten Knopf unter der Maus austauschen.
  renderSeite();
  renderGliederung();
}

export function gutAddText(kapId) {
  if (!findeKapitel(kapId)) return;
  const b = gdNeuerTextBlock();
  gdBlockEinfuegen(_gut.dok, kapId, b);
  _gut.auswahl = { art: 'block', id: b.id };
  neuZeichnen();
  scrollZu('block', b.id);
  document.querySelector('#gut-eigenschaften textarea')?.focus();
}

export function gutAddFigur(kapId, figurId) {
  _gut.figurMenuOffen = null;
  if (!figurId || !findeKapitel(kapId)) return;
  const b = gdNeuerFigurBlock(figurId);
  gdBlockEinfuegen(_gut.dok, kapId, b);
  _gut.auswahl = { art: 'block', id: b.id };
  neuZeichnen();
  scrollZu('block', b.id);
}

/** Öffnet/schließt das Auswahlmenü „Abbildung oder Textbaustein …“ für Kapitel `kapId`. */
export function gutToggleFigurMenu(kapId) {
  _gut.figurMenuOffen = _gut.figurMenuOffen === kapId ? null : kapId;
  renderEigenschaften();
}

/** Alle noch fehlenden Katalog-Bausteine eines Standardgliederungs-Kapitels (`nr`) ans Ende von Kapitel `kapId` einfügen. */
export function gutAddKapitelInhalt(kapId, nr) {
  _gut.figurMenuOffen = null;
  if (!findeKapitel(kapId)) return;
  const knoten = ggMenuBaum().byNr.get(nr);
  if (!knoten) return;
  const imDok = gdFigurIds(_gut.dok);
  const neue = knoten.figuren.filter(f => !imDok.has(f.id)); // knoten.figuren ist bereits in Musterkapitel-Reihenfolge sortiert
  if (!neue.length) { gutSay('Alle Bausteine dieses Kapitels stehen schon im Dokument.'); neuZeichnen(); return; }
  let letzter = null;
  for (const f of neue) {
    letzter = gdNeuerFigurBlock(f.id);
    gdBlockEinfuegen(_gut.dok, kapId, letzter);
  }
  _gut.auswahl = { art: 'block', id: letzter.id };
  neuZeichnen();
  scrollZu('block', letzter.id);
  gutSay(`${neue.length} Bausteine aus Kapitel ${nr} eingefügt.`);
}

/** Je bestehende Trafostation (aus dem Elektro-Tab, eine je Gebäude/Station) einen Freitext-Platzhalter anlegen. */
export function gutAddTrafoDummies(kapId) {
  if (!findeKapitel(kapId)) return;
  const stationen = ggTrafostationenIstListe();
  if (!stationen.length) {
    gutSay('⚠ Keine Trafostationen im Modell — im Elektro-Tab zuerst welche platzieren.', true);
    return;
  }
  let letzte = null;
  for (const s of stationen) {
    const text = `${s.label} – Gebäude ${s.gebLabel}\n`
      + `Zustand: [Zustand bei der Begehung ergänzen]\n`
      + `Bedarf: [Bedarf ergänzen]\n`
      + `Empfehlung: [Empfehlung ergänzen]`;
    letzte = gdNeuerTextBlock(text);
    gdBlockEinfuegen(_gut.dok, kapId, letzte);
  }
  neuZeichnen();
  if (letzte) scrollZu('block', letzte.id);
  gutSay(`✓ ${stationen.length} Trafostation(en) als Platzhalter eingefügt.`);
}

/** Neuen, leeren Lageplan-Block anlegen und gleich zum Einrichten nach 🗺️ Liegenschaftsbilder springen. */
export function gutAddLageplan(kapId) {
  if (!findeKapitel(kapId)) return;
  const b = gdNeuerBildBlock(null);
  gdBlockEinfuegen(_gut.dok, kapId, b);
  gutEditLageplan(b.id);
}

/** Kapitelbezeichnung ("3.1.2 Stromnetz intern") — Label für den Übernehmen-Knopf drüben in 18. */
function lpZielLabel(blockId) {
  const pos = gdFindeBlock(_gut.dok, blockId);
  if (!pos) return 'Gutachten';
  return `${gdKapitelNummern(_gut.dok.kapitel)[pos.kapIdx]} ${_gut.dok.kapitel[pos.kapIdx].titel}`.trim();
}

/**
 * Reiter 🗺️ Liegenschaftsbilder öffnen, dort die zu diesem Block gespeicherten Einstellungen
 * laden (oder — bei einem frischen Block — einfach den dort gerade aktuellen Stand stehen
 * lassen) und den Block als Ziel für „Für … übernehmen" markieren. lpEinstellungenRestore()/
 * lpSetGutachtenZiel() liegen auf window statt als Import (s. Modulkopf: 21 importiert bewusst
 * nur aus 17 und der lib) — main.js legt jeden Modul-Export dort ab.
 */
export function gutEditLageplan(blockId) {
  const b = findeBlock(blockId);
  if (!b || b.typ !== 'bild') return;
  _gut.lpZiel = blockId;
  if (typeof window.lpEinstellungenRestore === 'function') window.lpEinstellungenRestore(b.einstellungen || null);
  if (typeof window.lpSetGutachtenZiel === 'function') window.lpSetGutachtenZiel(true, lpZielLabel(blockId));
  if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('liegenschaftsbilder');
}

/**
 * Rückruf aus 18 (per window aufgerufen, s. o.): schreibt SVG + Einstellungen in den zuletzt per
 * gutEditLageplan() markierten Block und springt zurück in den Gutachten-Editor.
 * @returns {boolean} false, wenn kein Ziel (mehr) aktiv ist — 18 zeigt dann eine Fehlermeldung.
 */
export function gutUebernehmeLageplanZiel(bild) {
  const blockId = _gut.lpZiel;
  const b = blockId ? findeBlock(blockId) : null;
  if (!b || b.typ !== 'bild') { _gut.lpZiel = null; return false; }
  b.svg = bild.svg; b.breite = bild.breite; b.hoehe = bild.hoehe; b.einstellungen = bild.einstellungen || null;
  _gut.lpZiel = null;
  if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('ggrafik');
  else neuZeichnen();
  gutWaehle('block', blockId, true);
  gutSay('✓ Lageplan übernommen.');
  return true;
}

/** Tippen im Freitext: nur den Block auf der Seite auffrischen, damit das Textfeld den Fokus behält. */
export function gutSetText(id, wert) {
  const b = findeBlock(id);
  if (!b || b.typ !== 'text') return;
  b.text = String(wert ?? '');
  const box = seitenElement('block', id);
  if (box) box.innerHTML = textBlockHtml(b.text);
}

export function gutTextFertig() {
  renderGliederung();
}

export function gutBlockVerschieben(id, richtung) {
  if (!_gut.dok) return;
  if (!gdBlockVerschieben(_gut.dok, id, richtung)) {
    gutSay(`Der Block steht schon ganz am ${richtung < 0 ? 'Anfang' : 'Ende'} des Dokuments.`, true);
    return;
  }
  neuZeichnen();
  scrollZu('block', id);
  gutSay('');
}

export function gutBlockLoeschen(id) {
  if (!_gut.dok || !gdBlockLoeschen(_gut.dok, id)) return;
  _gut.cache.delete(id);
  _gut.auswahl = null;
  neuZeichnen();
}

export function gutSetFigurOpt(id, feld, wert) {
  const b = findeBlock(id);
  if (!b || (b.typ !== 'figur' && b.typ !== 'bild')) return;
  if (feld === 'unterschrift') {
    b.unterschrift = String(wert ?? '').trim();
    renderSeite();       // Eigenschaften nicht neu aufbauen — siehe gutSetKapitelTitel
    renderGliederung();
    return;
  }
  if (feld === 'blattvariante') {
    const [layout, kennzahlen] = String(wert ?? '').split('|');
    b.layout = layout === 'voll' ? 'voll' : 'reduziert';
    b.kennzahlen = kennzahlen === '1';
  }
  else return;
  neuZeichnen();
}

/**
 * Kopiert Bild oder Tabelle eines Blocks in die Zwischenablage — ohne Bildunterschrift
 * oder Nummer, damit beim Einfügen in ein anderes Word-Dokument nichts mit dessen eigener
 * Beschriftung/Nummerierung kollidiert. Die Nummer steht nur in der Seitenansicht hier im
 * Tool (s. gdBeschriftungen) und im vollständigen Word-Export (gutachten-docx.js).
 */
export async function gutCopyTeil(id, teilIdx) {
  const b = findeBlock(id);
  if (!b || (b.typ !== 'figur' && b.typ !== 'bild')) return;
  gutSay('Wird vorbereitet …');
  try {
    let wohin;
    if (b.typ === 'bild') {
      const svg = bildSvgElement(b);
      if (!svg) throw new Error('Grafik konnte nicht vorbereitet werden — noch einmal übernehmen.');
      wohin = await ggCopyForWord(svg, 3);
    } else {
      const el = seitenElement('block', id)?.querySelector(`[data-gut-teil="${teilIdx}"]`)?.firstElementChild || null;
      wohin = await ggCopyDokumentTeil(b.figurId, teilIdx, el);
    }
    gutSay(`✓ In die ${wohin} kopiert — in Word mit Strg+V einfügen.`);
  } catch (e) {
    gutSay('⚠ ' + e.message, true);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deckblatt und Word-Export (lib/gutachten-docx.js, Layout der Word-Vorlage)
 * ═══════════════════════════════════════════════════════════════════════ */
/** Ortsname aus der Liegenschaftsadresse ("Musterstr. 1, 12345 Musterstadt" → "Musterstadt"). */
function pdOrtKurz(adresse) {
  return String(adresse || '').split(',').pop().trim().replace(/^\d{4,5}\s+/, '');
}

/** Vorschläge aus den Projekt-Stammdaten — greifen im Export, solange ein Feld leer ist. */
function deckblattVorgaben() {
  const adresse = String(window.pdLiegenschaftAdresse || '').trim();
  const liegenschaft = String(window.pdKaserneName || '').trim();
  const personen = [window.pdBearbeiterStrom, window.pdBearbeiterWaerme]
    .map(n => String(n || '').trim()).filter((n, i, alle) => n && alle.indexOf(n) === i);
  return {
    ...GUTACHTEN_DECKBLATT_VORGABEN, liegenschaft, ort: pdOrtKurz(adresse), projekt: liegenschaft,
    standort: adresse, stand: new Date().toLocaleDateString('de-DE'), personen,
  };
}

function deckblattFuerExport() {
  const d = _gut.dok.deckblatt || gdNormDeckblatt();
  const v = deckblattVorgaben();
  const out = {};
  for (const [k, wert] of Object.entries(d)) if (k !== 'ansprechpersonen') out[k] = wert.trim() || v[k] || '';
  out.ansprechpersonen = d.ansprechpersonen.map((p, i) => ({ name: p.name.trim() || v.personen[i] || '', telefon: p.telefon.trim() }));
  return out;
}

/* ── Standardtexte: Formulierungsvariante und Vorgaben des Auftraggebers (lib/gutachten-einleitung.js) ── */
const GUT_VORGABEN_KEY = 'mmh-gutachten-vorgaben';   // nur lokal im Browser: Erlasstexte gehören nicht in Code oder Projektdatei
function gutVorgabenLesen() {
  try { return localStorage.getItem(GUT_VORGABEN_KEY) || ''; } catch (e) { void e; return ''; }
}
const GUT_VORGABE_ZSB_KEY = 'mmh-gutachten-vorgabe-zsb';
function gutVorgabeZsbLesen() {
  try { return localStorage.getItem(GUT_VORGABE_ZSB_KEY) || ''; } catch (e) { void e; return ''; }
}
export function gutSetVorgabeZsb(text) {
  try { localStorage.setItem(GUT_VORGABE_ZSB_KEY, String(text ?? '').trim()); } catch (e) { void e; }
  _gut.cache.clear();
  renderSeite();
}
export function gutSetVorgaben(text) {
  try { localStorage.setItem(GUT_VORGABEN_KEY, String(text ?? '').trim()); } catch (e) { void e; gutSay('⚠ Vorgaben konnten im Browser nicht gespeichert werden.'); }
  _gut.cache.clear();
  renderSeite();
}
export function gutAndereFormulierung() {
  if (!_gut.dok) return;
  _gut.dok.textVariante = ((_gut.dok.textVariante || 0) + 1) % 3;
  _gut.cache.clear();
  neuZeichnen();
  gutSay('✓ Standardtexte in einer anderen Formulierung.');
}
/** Eingaben der Standardtexte — Deckblattfelder vor Projekt-Stammdaten. Wird von 17-gutachten-grafik.js gelesen. */
export function gutStandardtextDaten() {
  const d = _gut.dok?.deckblatt || {};
  const v = deckblattVorgaben();
  return {
    liegenschaft: String(d.liegenschaft || '').trim() || v.liegenschaft,
    ort: String(d.ort || '').trim() || v.ort,
    variante: _gut.dok?.textVariante || 0,
    vorgaben: gutVorgabenLesen(),
    vorgabeZsb: gutVorgabeZsbLesen(),
  };
}

/* ── Fragebogen (C1) und ausgefüllte Platzhalter (C2) ─────────────────────── */
/** Antworten des Fragebogens — 17 liest sie über window.gutFragenLesen für Texte und Sichtbarkeit. */
export function gutFragenLesen() { return _gut.dok?.fragen || {}; }
/** Verweistabelle Standardnummer → Nummer im Dokument (C5); zwischengespeichert, solange sich die Gliederung nicht ändert. */
let _verweisCache = { schluessel: '', map: new Map() };
export function gutVerweisNummern() {
  const k = _gut.dok?.kapitel || [];
  const schluessel = k.map(x => `${x.ebene}:${x.titel}`).join('|') + '#' + (_gut.dok?.gliederung || '');
  if (schluessel !== _verweisCache.schluessel) _verweisCache = { schluessel, map: gdVerweisNummern(_gut.dok) };
  return _verweisCache.map;
}
/** Im Editor eingetragener Wert eines Platzhalters (Feldname wie im Text, ohne Klammern). */
export function gutPlatzhalterWert(name) { return _gut.dok?.platzhalter?.[name] || ''; }

function gutNachAenderung() { _gut.cache.clear(); gutRender(); }

export function gutSetFrage(id, wert) {
  if (!_gut.dok) return;
  const f = GF_FRAGEN.find(x => x.id === id);
  if (!f) return;
  const fragen = { ...(_gut.dok.fragen || {}) };
  if (wert === '' || wert == null) delete fragen[id]; else fragen[id] = String(wert);
  _gut.dok.fragen = fragen;
  gutNachAenderung();
}
export function gutSetFrageMehrfach(id, wert, an) {
  if (!_gut.dok) return;
  const f = GF_FRAGEN.find(x => x.id === id);
  if (!f) return;
  const jetzt = new Set(_gut.dok.fragen?.[id] ?? gfStandard(f, ggFrageKontext()));
  if (an) jetzt.add(wert); else jetzt.delete(wert);
  _gut.dok.fragen = { ...(_gut.dok.fragen || {}), [id]: f.optionen.map(o => o[0]).filter(k => jetzt.has(k)) };
  gutNachAenderung();
}
export function gutSetPlatzhalter(name, wert) {
  if (!_gut.dok || !name) return;
  const p = { ...(_gut.dok.platzhalter || {}) };
  const w = String(wert ?? '').trim();
  if (w) p[name] = w.slice(0, 2000); else delete p[name];
  _gut.dok.platzhalter = p;
  gutNachAenderung();
}
export function gutPlatzhalterKlick(name) {
  if (!_gut.dok || !name) return;
  const w = window.prompt(`Platzhalter ausfüllen:\n${name}\n\nGilt für alle gleichnamigen Stellen; leer lassen = wieder offen.`, gutPlatzhalterWert(name));
  if (w === null) return;
  gutSetPlatzhalter(name, w);
}

/** Eine Frage als kompakte Zeile; „Vorgabe“ zeigt, was ohne Antwort gilt. */
function frageHtml(f, ctx) {
  const antworten = _gut.dok?.fragen || {};
  const std = gfStandard(f, ctx);
  const lbl = `<div style="font-size:11px;color:var(--text,#e8eaed);margin:8px 0 3px;">${esc(f.frage)}</div>`;
  const hw = f.hinweis ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;line-height:1.35;">${esc(f.hinweis)}</div>` : '';
  if (f.art === 'mehrfach') {
    const an = new Set(antworten[f.id] ?? std);
    return lbl + f.optionen.map(([w, l]) => `<label style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted);margin:2px 0;">
      <input type="checkbox" ${an.has(w) ? 'checked' : ''} data-change="gutSetFrageMehrfach('${f.id}','${w}',this.checked)"> ${esc(l)}</label>`).join('') + hw;
  }
  if (f.art === 'text') {
    return lbl + `<input type="text" value="${esc(antworten[f.id] ?? '')}" placeholder="${esc(std)}" data-change="gutSetFrage('${f.id}',this.value)" style="${EINGABE_STIL}width:100%;box-sizing:border-box;">` + hw;
  }
  const opt = gfOptionen(f, ctx);
  const stdLabel = opt.find(o => o[0] === std)?.[1] || std;
  const wert = antworten[f.id] ?? '';
  return lbl + `<select data-change="gutSetFrage('${f.id}',this.value)" style="${EINGABE_STIL}width:100%;box-sizing:border-box;">
      <option value=""${wert === '' ? ' selected' : ''}>Vorgabe: ${esc(stdLabel)}</option>
      ${opt.map(([w, l]) => `<option value="${esc(w)}"${wert === w ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` + hw;
}

/** Zugeklappter Fragebogen-Abschnitt — ohne Antwort gelten die Vorgaben, es gibt keine Warnungen. */
function fragenHtml(fragen, titel, offen = false) {
  if (!fragen.length) return '';
  const ctx = ggFrageKontext();
  const n = fragen.filter(f => (_gut.dok?.fragen || {})[f.id] !== undefined).length;
  return `<details${offen ? ' open' : ''} style="margin-top:12px;"><summary style="cursor:pointer;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">${esc(titel)}${n ? ` · ${n} beantwortet` : ''}</summary>
    ${fragen.map(f => frageHtml(f, ctx)).join('')}
    <div style="font-size:10px;color:var(--muted);margin-top:6px;">Optional — ohne Antwort gilt die Vorgabe.</div></details>`;
}

/** Ausgefüllte Platzhalter zum Nachbearbeiten (Klick auf ein gelbes Feld im Text legt sie an). */
function platzhalterHtml() {
  const p = Object.entries(_gut.dok?.platzhalter || {});
  if (!p.length) return hinweis('Gelbe Platzhalter im Text anklicken, um sie direkt auszufüllen — der Wert wird in der Projektdatei gespeichert.');
  return `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:11px;color:var(--muted);">${p.length} ausgefüllte Platzhalter</summary>
    ${p.map(([k, v]) => `<div style="font-size:10px;color:var(--muted);margin:6px 0 2px;">${esc(k)}</div>
      <input type="text" value="${esc(v)}" data-change="gutSetPlatzhalter(this.dataset.name,this.value)" data-name="${esc(k)}" style="${EINGABE_STIL}width:100%;box-sizing:border-box;">`).join('')}
    <div style="font-size:10px;color:var(--muted);margin-top:6px;">Leeren = Platzhalter wieder offen.</div></details>`;
}

function standardtextPanel() {
  return ueberschrift('Standardtexte')
    + hinweis('Einleitungstexte gibt es in mehreren gleichwertigen Formulierungen; die Wahl bleibt fest, bis Sie umschalten.')
    + knopf('↻ Andere Formulierung', 'gutAndereFormulierung()', { titel: 'Wechselt die Formulierung der Standardtexte (z. B. 1.1 Ziele und Grundsätze).' })
    + feldLabel('Vorgaben des Auftraggebers (Erlasse)')
    + `<textarea rows="5" data-change="gutSetVorgaben(this.value)" placeholder="Kurzfassung der maßgeblichen Erlasse/Vorgaben; Absätze durch Leerzeile trennen" style="${EINGABE_STIL}width:100%;box-sizing:border-box;resize:vertical;">${esc(gutVorgabenLesen())}</textarea>`
    + hinweis('Wird nur in diesem Browser gespeichert (nicht in der Projektdatei) und gilt für alle Gutachten. Erscheint in Kapitel 1.1.')
    + feldLabel('Vorgabe Zweistoffbrenner (Erlass/Schreiben, Kurzbezeichnung)')
    + `<input type="text" value="${esc(gutVorgabeZsbLesen())}" placeholder="z. B. Schreiben … vom …" data-change="gutSetVorgabeZsb(this.value)" style="${EINGABE_STIL}">`
    + hinweis('Wird in „Nicht berücksichtigt – Gas-Grundlast“ und im Abschnitt Zweistoffbrenner des Variantenvergleichs eingesetzt; ebenfalls nur lokal gespeichert.');
}

function anlagenAbschnitt() {
  const n = (_gut.dok.anlagen || []).length;
  const fehlend = fehlendeStationen();
  return ueberschrift('Anlagen')
    + `<div style="font-size:11px;color:var(--muted);line-height:1.45;margin-bottom:6px;">${n ? `${n} Anlage${n === 1 ? '' : 'n'} im Dokument.` : 'Noch keine Anlagen.'}`
    + (fehlend.length ? ` <span style="color:${GUT_WARN};">${fehlend.length} bestehende Station${fehlend.length === 1 ? '' : 'en'} ohne Steckbrief.</span>` : '') + '</div>'
    + (fehlend.length
      ? knopf(`📋 Steckbriefe der Stationen anlegen (${fehlend.length})`, 'gutAnlagenSteckbriefe()', { primaer: true,
          titel: 'Je bestehender Trafo-/Übergabestation eine Anlage „Steckbrief Trafostation“ — wie die Vorlage „Liegenschaft_Steckbrief Trafostation“.' })
      : `<div style="font-size:11px;color:${GUT_AKZENT};">✓ Für jede bestehende Station gibt es einen Steckbrief.</div>`);
}

function deckblattPanel() {
  const d = _gut.dok.deckblatt || gdNormDeckblatt();
  const v = deckblattVorgaben();
  const feld = (key, label) => feldLabel(label)
    + `<input type="text" value="${esc(d[key])}" placeholder="${esc(v[key] || '')}" data-change="gutSetDeckblatt('${key}',this.value)" style="${EINGABE_STIL}">`;
  const person = i => `<div style="display:flex;gap:4px;margin-top:4px;">`
    + `<input type="text" value="${esc(d.ansprechpersonen[i].name)}" placeholder="${esc(v.personen[i] || 'Name')}" data-change="gutSetDeckblattPerson(${i},'name',this.value)" style="${EINGABE_STIL}">`
    + `<input type="text" value="${esc(d.ansprechpersonen[i].telefon)}" placeholder="Telefon" data-change="gutSetDeckblattPerson(${i},'telefon',this.value)" style="${EINGABE_STIL}"></div>`;
  return ueberschrift('Deckblatt')
    + hinweis('Grau vorgeschlagene Werte kommen aus den Projekt-Stammdaten und gelten, solange das Feld leer bleibt. Was dann noch fehlt, steht im Word-Dokument als [Platzhalter].')
    + feld('liegenschaft', 'Titelzeile „der …“') + feld('ort', 'Titelzeile „in …“') + feld('projekt', 'Projekt')
    + feld('auftraggeber', 'Auftraggeber') + feld('auftrag', 'Auftrag (z. B. „Auftrag vom … von …“)')
    + feld('aufgestelltDurch', 'Aufgestellt durch') + feld('aufgestellt', 'Zusatz (z. B. „am … · Fachbereich …“)')
    + feld('standort', 'Liegenschaft (Standort, PLZ Ort)') + feld('stand', 'Stand')
    + feldLabel('Ansprechpersonen (Name · Telefon)') + [0, 1, 2].map(person).join('');
}

/** Deckblattfeld setzen — ohne Neuaufbau des Panels (siehe gutSetKapitelTitel). */
export function gutSetDeckblatt(feld, wert) {
  if (!_gut.dok) return;
  if (!_gut.dok.deckblatt) _gut.dok.deckblatt = gdNormDeckblatt();
  if (feld !== 'ansprechpersonen' && feld in _gut.dok.deckblatt) _gut.dok.deckblatt[feld] = String(wert ?? '');
}

export function gutSetDeckblattPerson(i, feld, wert) {
  if (!_gut.dok) return;
  if (!_gut.dok.deckblatt) _gut.dok.deckblatt = gdNormDeckblatt();
  const p = _gut.dok.deckblatt.ansprechpersonen[i];
  if (p && (feld === 'name' || feld === 'telefon')) p[feld] = String(wert ?? '');
}

const pngDaten = async svg => new Uint8Array(await (await ggSvgToPngBlob(svg, 3)).arrayBuffer());

/**
 * Gutachten als Word-Paket zusammenstellen — [{pfad, inhalt, base64}], noch ungezippt.
 * Abbildungen werden aus den gezeichneten (eingepassten) SVGs der Seitenansicht gerastert,
 * Tabellen und Textbausteine gehen als echter Word-Inhalt hinein.
 */
export async function gutWordPaket() {
  if (!_gut.dok) throw new Error('Noch kein Gutachten angelegt.');
  renderSeite();
  const dok = _gut.dok;
  const ctx = gdxKontext();
  const deckblatt = deckblattFuerExport();
  let koerper = gdxDeckblatt(ctx, deckblatt, { logo: ctx.bild(GV_LOGO_PNG), wappen: ctx.bild(GV_WAPPEN_PNG), netz: ctx.bild(GV_NETZGRAFIK_PNG) });

  const nummern = gdKapitelNummern(dok.kapitel);
  const beschriftungen = gdBeschriftungen(dok, teilArten);
  const alle = [...beschriftungen.values()].flat().filter(Boolean);
  koerper += gdxInhaltsverzeichnis();
  let neueSeite = true;
  if (alle.some(x => x.art === 'Abbildung')) { koerper += gdxVerzeichnis('Abbildungsverzeichnis', 'Abbildung', { neueSeite }); neueSeite = false; }
  if (alle.some(x => x.art === 'Tabelle')) koerper += gdxVerzeichnis('Tabellenverzeichnis', 'Tabelle', { neueSeite });

  const warnungen = [];
  // Anlagen wie in der Vorlage: Liste hinter den Verzeichnissen, Inhalte hinter dem letzten Kapitel
  const anlagen = (dok.anlagen || []).map((a, i) => ({ a, nr: gdAnlagenNummern(dok.anlagen)[i], ...anlageInhalt(a) }));
  koerper += ssdxAnlagenVerzeichnis(anlagen.map(x => ({ nr: x.nr, titel: x.titel })));
  for (let ki = 0; ki < dok.kapitel.length; ki++) {
    const k = dok.kapitel[ki];
    koerper += gdxUeberschrift(k.ebene, nummern[ki], k.titel);
    for (const b of k.bloecke) {
      if (b.typ === 'text') { koerper += gdxFreitext(b.text); continue; }
      if (b.typ === 'bild') {
        const titel = b.unterschrift.trim() || 'Lageplan der Liegenschaft';
        if (!b.svg) { warnungen.push(`${titel}: noch nicht eingerichtet — übersprungen.`); continue; }
        const svg = bildSvgElement(b);
        if (!svg) { warnungen.push(`${titel}: Grafik konnte nicht eingefügt werden.`); continue; }
        const rId = ctx.bild(await pngDaten(svg), titel);
        koerper += gdxAbbildung(ctx, rId, +svg.getAttribute('width') || b.breite || 1, +svg.getAttribute('height') || b.hoehe || 1, titel);
        const nr = (beschriftungen.get(b.id) || [])[0];
        if (nr) koerper += gdxBeschriftung(nr.art, nr.nr, titel);
        continue;
      }
      if (!ggFigurSichtbar(b.figurId)) continue;   // über den Fragebogen ausgeblendet
      const erg = figurErgebnis(b);
      if (erg.fehler) { warnungen.push(`${b.figurId}: ${erg.fehler}`); continue; }
      const titel = b.unterschrift.trim() || erg.titel;
      const nrListe = beschriftungen.get(b.id) || [];
      for (let ti = 0; ti < erg.teile.length; ti++) {
        const text = ti === 0 ? titel : `${erg.tabelleTitel}: ${titel}`;
        const daten = ggFigurWordDaten(b.figurId, ti);
        if (daten?.art === 'text') {
          koerper += gdxBausteinAbsaetze(daten.absaetze);
        } else if (daten?.art === 'tabelle') {
          koerper += gdxTabelle(daten);
        } else {
          const svg = erg.teile[ti].el;
          const rId = ctx.bild(await pngDaten(svg), b.figurId);
          koerper += gdxAbbildung(ctx, rId, +svg.getAttribute('width'), +svg.getAttribute('height'), text);
        }
        if (nrListe[ti]) koerper += gdxBeschriftung(nrListe[ti].art, nrListe[ti].nr, text);
      }
    }
  }
  for (const x of anlagen) {
    if (x.fehler) { warnungen.push(`Anlage ${x.nr}: ${x.fehler}`); continue; }
    koerper += ssdxSteckbriefAnlage(x.nr, x.titel, x.blatt);
  }
  const titel = 'Gutachten zur zukünftigen Energieversorgung' + (deckblatt.liegenschaft ? ` der ${deckblatt.liegenschaft}` : '');
  return { paket: gdxErzeugePaket(ctx, koerper, { titel }), warnungen };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PowerPoint (lib/gutachten-pptx.js): gleicher Inhalt wie das Dokument, Abbildungen mit Stichpunkten
 * ═══════════════════════════════════════════════════════════════════════ */
/** Kurzfassung: die Kernabbildungen je Kapitel (Entscheiderrunde); ausführlich: alle sichtbaren Abbildungen und Tabellen. */
const PPTX_KURZ = new Set([
  'gebaeude-uebersicht', 'gebaeude-bedarf-wasserfall', 'ist-erzeuger-leistung', 'verbrauch-bezug-grafik', 'lastgang-waerme-jdl', 'lastgang-korrelation',
  'traeger-quellen', 'potenzial-lwwp-sweep', 'bedarf-resultierend-wasserfall', 'pv-variantenvergleich', 'res-sz-vergleich', 'kosten-gruppen',
  'va-gegenueberstellung', 'va-emissionen', 'va-kostenstruktur', 'va-sensitivitaet-grafik', 'va-bewertungsmatrix', 'fazit-nt-grafik', 'fazit-fahrplan-gantt',
]);

/** Fassung der Präsentation und Folien-Einstellungen im Dokument (dok.praesentation, normalisiert in lib/gutachten-dokument.js). */
const praesDaten = () => _gut.dok?.praesentation || {};
function praesSetzen(aenderung) {
  if (!_gut.dok) return;
  _gut.dok.praesentation = { ...praesDaten(), ...aenderung };
  renderPraes();
}

/**
 * Folienmodell aus dem Dokument — gleiche Quelle für Vorschau und Export:
 * [{ key, art: 'titel'|'kapitel'|'inhalt'|'punkte', nr, titel, unter, punkte, autoPunkte, svg, an, vorgabeAn }]
 * Kandidaten sind alle sichtbaren Abbildungen und Tabellen; ob eine Folie dabei ist, folgt der Fassung (kurz: Kernabbildungen)
 * oder dem Haken des Nutzers. Titel und Stichpunkte lassen sich je Folie überschreiben.
 */
function praesFolien() {
  const dok = _gut.dok;
  if (!dok) return [];
  const pd = praesDaten();
  const kurz = (pd.fassung || 'kurz') === 'kurz';
  const an = pd.an || {}, titelX = pd.titel || {}, punkteX = pd.punkte || {};
  const nummern = gdKapitelNummern(dok.kapitel);
  const d = deckblattFuerExport();
  const katalog = new Map(ggFigurenKatalog().map(f => [f.id, f]));
  const mitWahl = (f, vorgabe) => {
    const key = f.key;
    const autoPunkte = f.punkte || [];
    const eigene = typeof punkteX[key] === 'string' ? punkteX[key].split('\n').map(x => x.trim()).filter(Boolean) : null;
    return { ...f, vorgabeAn: vorgabe, an: an[key] ?? vorgabe, autoPunkte, punkte: eigene ?? autoPunkte, eigenePunkte: !!eigene, titel: titelX[key] || f.titel, autoTitel: f.titel };
  };
  const folien = [mitWahl({ key: 'titel', art: 'titel', titel: 'Zukünftige Energieversorgung', unter: d.liegenschaft || '',
    zeilen: [d.ort, d.auftraggeber, d.stand || new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })] }, true)];
  let kapitelFolie = null;
  for (let ki = 0; ki < dok.kapitel.length; ki++) {
    const k = dok.kapitel[ki];
    const nr = nummern[ki];
    if (k.ebene === 1) { kapitelFolie = mitWahl({ key: `kap:${k.id}`, art: 'kapitel', nr, titel: k.titel }, true); kapitelFolie.offen = true; }
    const absaetze = [];
    const bilder = [];
    for (const b of k.bloecke) {
      if (b.typ === 'text') { absaetze.push(...String(b.text || '').split(/\n\s*\n/).map(t => [{ text: t, offen: false }])); continue; }
      if (b.typ === 'bild') { if (b.svg) bilder.push({ b, titel: b.unterschrift.trim() || 'Lageplan der Liegenschaft', svg: bildSvgElement(b), kern: true }); continue; }
      if (!ggFigurSichtbar(b.figurId)) continue;
      const f = katalog.get(b.figurId);
      if (f?.istText) { try { absaetze.push(...(ggFigurWordDaten(b.figurId)?.absaetze || [])); } catch (e) { void e; } continue; }
      bilder.push({ b, kern: PPTX_KURZ.has(b.figurId), titel: b.unterschrift.trim() || f?.titel || b.figurId });
    }
    if (!bilder.length && !absaetze.length) continue;
    let punkte = gpxStichpunkte(absaetze, 9);
    const kandidaten = [];
    for (const x of bilder) {
      const p = punkte.slice(0, 3);
      punkte = punkte.slice(3);
      kandidaten.push(mitWahl({ key: `fig:${x.b.id}`, art: 'inhalt', nr, titel: k.titel, unter: x.titel || null, punkte: p, block: x.b }, kurz ? x.kern : true));
    }
    if (!bilder.length && punkte.length >= 2) kandidaten.push(mitWahl({ key: `pkt:${k.id}`, art: 'punkte', nr, titel: k.titel, punkte: punkte.slice(0, 5) }, !kurz));
    if (!kandidaten.length) continue;
    if (kapitelFolie?.offen) { kapitelFolie.offen = false; folien.push(kapitelFolie); }
    folien.push(...kandidaten);
  }
  // Kapitelfolien ohne aufgenommene Inhaltsfolie folgen ihrem Kapitel (an, solange der Nutzer nichts anderes gewählt hat)
  for (let i = 0; i < folien.length; i++) {
    const f = folien[i];
    if (f.art !== 'kapitel' || an[f.key] !== undefined) continue;
    let j = i + 1, inhalt = false;
    while (j < folien.length && folien[j].art !== 'kapitel') { if (folien[j].an) inhalt = true; j++; }
    f.an = inhalt;
  }
  return folien;
}

/** Bild und Untertitel einer Inhaltsfolie erst bei Bedarf zeichnen (Vorschau, Export). */
function praesBild(f) {
  if (f.art !== 'inhalt' || !f.block) return null;
  if (f.block.typ === 'bild') return bildSvgElement(f.block);
  const erg = figurErgebnis(f.block);
  if (erg.fehler || !erg.teile?.[0]?.el) return null;
  if (!f.block.unterschrift?.trim()) f.unter = erg.titel;   // Titel der gezeichneten Abbildung statt des Katalognamens
  return erg.teile[0].el;
}

/* ── Reiter „Präsentation“: Folienliste, Vorschau im Gutachtendesign, Einstellungen der Folie ── */
const PRAES_GRUEN = '#266426', PRAES_GRUEN_HELL = '#3F9C3F';
function praesVorschau(f, nr) {
  const box = document.createElement('div');
  box.dataset.click = `gutPraesWaehle('${f.key}')`;
  const gewaehlt = _gut.praesAuswahl === f.key;
  box.style.cssText = `position:relative;width:100%;max-width:880px;aspect-ratio:16/9;margin:0 auto 18px;background:#fff;color:#1B1F1C;font-family:Tahoma,Arial,sans-serif;
    box-shadow:0 2px 10px rgba(0,0,0,.35);overflow:hidden;cursor:pointer;opacity:${f.an ? 1 : 0.35};outline:${gewaehlt ? `3px solid ${GUT_AKZENT}` : 'none'};outline-offset:3px;`;
  const logo = `<img src="data:image/png;base64,${GV_LOGO_PNG}" style="position:absolute;right:4%;top:3.4%;width:13%;">`;
  const fuss = `<div style="position:absolute;left:4%;right:4%;bottom:7%;border-top:1px solid #E2E4DF;"></div>
    <div style="position:absolute;left:4%;bottom:2.4%;font-size:1.1cqw;color:#5A5F5A;">${esc(`LKEBw · ${deckblattFuerExport().liegenschaft || 'Gutachten zur zukünftigen Energieversorgung'}`)}</div>
    <div style="position:absolute;right:4%;bottom:2.4%;font-size:1.1cqw;color:#5A5F5A;">${nr}</div>`;
  box.style.containerType = 'inline-size';
  if (f.art === 'titel') {
    box.innerHTML = `<div style="position:absolute;inset:0 0 38% 0;background:${PRAES_GRUEN};"></div><div style="position:absolute;left:0;right:0;top:62%;height:0.7%;background:${PRAES_GRUEN_HELL};"></div>
      <div style="position:absolute;left:7.5%;right:7.5%;bottom:44%;color:#fff;"><div style="font-size:4.2cqw;font-weight:bold;">${esc(f.titel)}</div><div style="font-size:2.4cqw;margin-top:1%;">${esc(f.unter || '')}</div></div>
      <div style="position:absolute;left:7.5%;top:68%;font-size:1.6cqw;color:#5A5F5A;line-height:1.5;">${(f.zeilen || []).filter(Boolean).map(esc).join('<br>')}</div>
      <img src="data:image/png;base64,${GV_LOGO_PNG}" style="position:absolute;right:7.5%;top:70%;width:20%;">`;
  } else if (f.art === 'kapitel') {
    box.innerHTML = `<div style="position:absolute;inset:0 0 auto 0;height:1.3%;background:${PRAES_GRUEN};"></div>${logo}
      <div style="position:absolute;left:0;top:38%;width:1.5%;height:24%;background:${PRAES_GRUEN_HELL};"></div>
      <div style="position:absolute;left:7.5%;top:36%;"><div style="font-size:6.3cqw;font-weight:bold;color:${PRAES_GRUEN};line-height:1.1;">${esc(f.nr)}</div><div style="font-size:3.7cqw;font-weight:bold;">${esc(f.titel)}</div></div>
      <div style="position:absolute;right:4%;bottom:2.4%;font-size:1.1cqw;color:#5A5F5A;">${nr}</div>`;
  } else {
    const punkte = (f.punkte || []).map(p => `<li style="margin:0 0 0.8em;">${esc(p)}</li>`).join('');
    box.innerHTML = `<div style="position:absolute;inset:0 0 auto 0;height:1.3%;background:${PRAES_GRUEN};"></div>${logo}
      <div style="position:absolute;left:4%;top:4.4%;right:20%;font-size:2.8cqw;font-weight:bold;"><span style="color:${PRAES_GRUEN};">${esc(f.nr)}</span>&nbsp; ${esc(f.titel)}</div>
      <div data-praes-unter style="position:absolute;left:4%;top:12.4%;right:4%;font-size:1.6cqw;color:#5A5F5A;">${esc(f.unter || '')}</div>
      <div data-praes-bild style="position:absolute;left:4%;top:18%;bottom:9%;width:${f.art === 'inhalt' && punkte ? '59%' : '92%'};display:flex;align-items:center;justify-content:center;"></div>
      ${punkte ? `<div style="position:absolute;top:18%;bottom:12%;${f.art === 'inhalt' ? 'left:66%' : 'left:4%'};right:4%;border-left:${f.art === 'inhalt' ? `2px solid ${PRAES_GRUEN_HELL}` : 'none'};padding-left:2%;
        font-size:1.75cqw;line-height:1.35;overflow:hidden;"><ul style="margin:0;padding-left:1.2em;">${punkte}</ul></div>` : ''}${fuss}`;
    const el = praesBild(f);
    const halter = box.querySelector('[data-praes-bild]');
    if (el && halter) {
      const c = el.cloneNode(true);
      Object.assign(c.style, { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', display: 'block' });
      if (c.tagName?.toLowerCase() !== 'svg') { c.style.width = '100%'; c.style.overflow = 'hidden'; c.style.fontSize = '0.9cqw'; }
      halter.appendChild(c);
      box.querySelector('[data-praes-unter]').textContent = f.unter || '';
    }
  }
  return box;
}

function renderPraes() {
  const host = document.getElementById('gut-praes');
  if (!host) return;
  if (!_gut.dok) { host.innerHTML = '<div style="padding:30px;color:var(--muted);font-size:12px;">Zuerst unter „📄 Dokument“ ein Gutachten anlegen — die Präsentation entsteht daraus.</div>'; return; }
  const folien = praesFolien();
  if (!folien.some(f => f.key === _gut.praesAuswahl)) _gut.praesAuswahl = folien[0]?.key || null;
  const aktive = folien.filter(f => f.an);
  const nrVon = new Map(aktive.map((f, i) => [f.key, i + 1]));
  const pd = praesDaten();
  const scrollAlt = document.getElementById('gut-praes-scroll')?.scrollTop || 0;
  const liste = folien.map(f => `<div data-click="gutPraesWaehle('${f.key}')" style="display:flex;gap:6px;align-items:flex-start;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;line-height:1.35;
      margin-left:${f.art === 'kapitel' || f.art === 'titel' ? 0 : 12}px;color:${f.an ? 'var(--text,#e8eaed)' : 'var(--muted)'};background:${_gut.praesAuswahl === f.key ? 'rgba(38,166,154,.15)' : 'transparent'};">
      <input type="checkbox" ${f.an ? 'checked' : ''} data-click="event.stopPropagation()" data-change="gutPraesFolieAn('${f.key}',this.checked)" style="margin-top:2px;">
      <span><span style="color:${GUT_AKZENT};">${nrVon.get(f.key) || '–'}</span> ${f.art === 'kapitel' ? `<b>${esc(f.nr)} ${esc(f.titel)}</b>` : f.art === 'titel' ? '<b>Titelfolie</b>' : (f.art === 'punkte' ? `Stichpunkte: ${esc(f.titel)}` : esc(f.unter || f.titel))}</span></div>`).join('');
  host.innerHTML = `<div style="width:290px;flex-shrink:0;overflow-y:auto;border-right:1px solid rgba(38,166,154,.15);padding:10px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">Fassung</div>
      <select data-change="gutPraesFassung(this.value)" style="${EINGABE_STIL}width:100%;box-sizing:border-box;">
        <option value="kurz"${(pd.fassung || 'kurz') === 'kurz' ? ' selected' : ''}>Kurzfassung (Kernabbildungen)</option>
        <option value="lang"${pd.fassung === 'lang' ? ' selected' : ''}>Ausführlich (alle Abbildungen)</option></select>
      <div style="font-size:10px;color:var(--muted);margin:8px 0 10px;">${aktive.length} von ${folien.length} Folien · Haken = Folie ist dabei${Object.keys(pd.an || {}).length ? ` · <a href="#" data-click="event.preventDefault();gutPraesZuruecksetzen()" style="color:inherit;">Auswahl zurücksetzen</a>` : ''}</div>
      ${liste}</div>
    <div id="gut-praes-scroll" style="flex:1;min-width:0;overflow-y:auto;padding:20px;background:#161622;"></div>
    <div style="width:300px;flex-shrink:0;overflow-y:auto;border-left:1px solid rgba(38,166,154,.15);padding:10px;">${praesPanel(folien.find(f => f.key === _gut.praesAuswahl))}</div>`;
  const scroll = document.getElementById('gut-praes-scroll');
  folien.forEach(f => scroll.appendChild(praesVorschau(f, nrVon.get(f.key) || '–')));
  scroll.scrollTop = scrollAlt;
}

function praesPanel(f) {
  if (!f) return '';
  const titelFeld = f.art === 'titel' || f.art === 'kapitel' ? '' : feldLabel('Folientitel')
    + `<input type="text" value="${esc(f.titel)}" placeholder="${esc(f.autoTitel)}" data-change="gutPraesTitel('${f.key}',this.value)" style="${EINGABE_STIL}width:100%;box-sizing:border-box;">`;
  const punkte = f.art === 'titel' || f.art === 'kapitel' ? '' : feldLabel('Stichpunkte (eine Zeile je Punkt)')
    + `<textarea rows="8" data-change="gutPraesPunkte('${f.key}',this.value)" style="${EINGABE_STIL}width:100%;box-sizing:border-box;resize:vertical;">${esc((f.punkte || []).join('\n'))}</textarea>`
    + (f.eigenePunkte ? `<div style="margin-top:4px;">${knopf('↺ Stichpunkte aus dem Gutachtentext', `gutPraesPunkte('${f.key}',null)`, { klein: true })}</div>` : hinweis('Automatisch aus den Texten des Kapitels (Sätze mit Zahlen bevorzugt). Änderungen gelten nur für die Präsentation.'));
  return `<div style="font-size:12px;font-weight:600;color:var(--text,#e8eaed);margin-bottom:8px;">${f.art === 'titel' ? 'Titelfolie' : f.art === 'kapitel' ? `Kapitelfolie ${esc(f.nr)}` : `Folie zu ${esc(f.nr)}`}</div>`
    + `<label style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--muted);"><input type="checkbox" ${f.an ? 'checked' : ''} data-change="gutPraesFolieAn('${f.key}',this.checked)"> Folie in die Präsentation aufnehmen</label>`
    + titelFeld + punkte
    + (f.block?.typ === 'figur' ? hinweis('Die Abbildung ist dieselbe wie im Gutachten — Kopfzeile, Haken und Werte in „🖼 Einzelgrafiken“ ändern.') : '')
    + hinweis('Titel und Liegenschaft der Titelfolie kommen aus dem Deckblatt des Gutachtens.');
}

export function gutPraesWaehle(key) { _gut.praesAuswahl = key; renderPraes(); }
export function gutPraesFolieAn(key, an) { praesSetzen({ an: { ...(praesDaten().an || {}), [key]: !!an } }); }
export function gutPraesFassung(f) { praesSetzen({ fassung: f === 'lang' ? 'lang' : 'kurz' }); }
export function gutPraesZuruecksetzen() { praesSetzen({ an: {} }); }
export function gutPraesTitel(key, t) {
  const titel = { ...(praesDaten().titel || {}) };
  if (String(t || '').trim()) titel[key] = String(t).trim().slice(0, 200); else delete titel[key];
  praesSetzen({ titel });
}
export function gutPraesPunkte(key, text) {
  const punkte = { ...(praesDaten().punkte || {}) };
  if (text === null || text === undefined) delete punkte[key]; else punkte[key] = String(text).slice(0, 3000);
  praesSetzen({ punkte });
}

async function gutPptxPaket() {
  if (!_gut.dok) throw new Error('Noch kein Gutachten angelegt.');
  renderSeite();
  const d = deckblattFuerExport();
  const folien = [];
  for (const f of praesFolien().filter(x => x.an)) {
    const x = { art: f.art, nr: f.nr, titel: f.titel, unter: f.unter, punkte: f.punkte, zeilen: f.zeilen, untertitel: f.art === 'titel' ? f.unter : undefined };
    if (f.art === 'inhalt') {
      const svg = praesBild(f);
      x.unter = f.unter;
      if (svg && svg.tagName?.toLowerCase() === 'svg') x.bild = { daten: await pngDaten(svg), breite: +svg.getAttribute('width') || 1200, hoehe: +svg.getAttribute('height') || 800 };
      else if (!x.punkte?.length) continue;
      else x.art = 'punkte';
    }
    folien.push(x);
  }
  const titel = `Energieversorgung${d.liegenschaft ? ` ${d.liegenschaft}` : ''}`;
  return { paket: gpxErzeugePaket(folien, { titel, fusszeile: `LKEBw · ${d.liegenschaft || 'Gutachten zur zukünftigen Energieversorgung'}`, logo: GV_LOGO_PNG }), anzahl: folien.length };
}

export async function gutPptxExport() {
  if (_gutExportLaeuft) return;
  if (typeof window.JSZip !== 'function') { gutSay('⚠ JSZip ist nicht geladen — Seite neu laden.', true); return; }
  _gutExportLaeuft = true;
  gutSay('PowerPoint-Datei wird erstellt …');
  try {
    const { paket, anzahl } = await gutPptxPaket();
    const zip = new window.JSZip();
    for (const t of paket) zip.file(t.pfad, t.inhalt, t.base64 ? { base64: true } : undefined);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const name = typeof window.projektExportFilename === 'function' ? window.projektExportFilename('praesentation', 'pptx') : 'praesentation.pptx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    gutSay(`✓ ${name} erstellt — ${anzahl} Folien (${Math.round(blob.size / 1024)} KB).`);
  } catch (e) {
    console.error('Gutachten-Editor: PowerPoint-Export fehlgeschlagen', e);
    gutSay('⚠ PowerPoint-Export fehlgeschlagen: ' + e.message, true);
  } finally {
    _gutExportLaeuft = false;
  }
}

let _gutExportLaeuft = false;

export async function gutWordExport() {
  if (_gutExportLaeuft) return;
  // Das Gutachten gehört zur ★-Variante. Abbildungen und Zahlen kommen aber aus
  // dem Live-Zustand — ist gerade eine andere Variante aktiv, vorher fragen.
  const konflikt = window.gutachtenVarianteKonflikt?.();
  if (konflikt) {
    if (confirm(`Gutachtenvariante ist „${konflikt.gutachten}“, aktiv ist „${konflikt.aktiv}“.

Zur Gutachtenvariante wechseln? Die Abbildungen werden danach neu gezeichnet; den Export bitte erneut starten.`)) {
      window.activateVariant?.(konflikt.id);
      gutAktualisieren();
      gutSay(`Zu „${konflikt.gutachten}“ gewechselt. Abbildungen neu gezeichnet — Export bitte erneut starten.`);
      return;
    }
    if (!confirm(`Trotzdem mit der aktiven Variante „${konflikt.aktiv}“ exportieren?`)) return;
  }
  if (typeof window.JSZip !== 'function') { gutSay('⚠ JSZip ist nicht geladen — Seite neu laden.', true); return; }
  _gutExportLaeuft = true;
  gutSay('Word-Datei wird erstellt …');
  try {
    const { paket, warnungen } = await gutWordPaket();
    const zip = new window.JSZip();
    for (const t of paket) zip.file(t.pfad, t.inhalt, t.base64 ? { base64: true } : undefined);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const name = typeof window.projektExportFilename === 'function' ? window.projektExportFilename('gutachten', 'docx') : 'gutachten.docx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    gutSay(`✓ ${name} erstellt (${Math.round(blob.size / 1024)} KB). Beim Öffnen fragt Word, ob Felder aktualisiert werden sollen — „Ja“ füllt die Verzeichnisse.`
      + (warnungen.length ? ` ⚠ ${warnungen.length} Abbildung(en)/Anlage(n) übersprungen.` : ''));
  } catch (e) {
    console.error('Gutachten-Editor: Word-Export fehlgeschlagen', e);
    gutSay('⚠ Word-Export fehlgeschlagen: ' + e.message, true);
  } finally {
    _gutExportLaeuft = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Projektdatei
 * ═══════════════════════════════════════════════════════════════════════ */
/** Für _buildProjectData: Dokument plus von Hand geänderte Figur-Einstellungen; null, solange es nichts zu speichern gibt. */
export function gutCaptureGutachten() {
  const figurEinstellungen = ggFigurEinstellungenCapture();
  if (!_gut.dok && !Object.keys(figurEinstellungen).length) return null;
  return {
    version: GUTACHTEN_DOK_VERSION,
    kapitel: _gut.dok ? structuredClone(_gut.dok.kapitel) : null,
    deckblatt: _gut.dok ? structuredClone(_gut.dok.deckblatt || gdNormDeckblatt()) : null,
    ...(_gut.dok?.gliederung ? { gliederung: _gut.dok.gliederung } : {}),
    ...(_gut.dok?.textVariante ? { textVariante: _gut.dok.textVariante } : {}),
    ...(_gut.dok?.fragen && Object.keys(_gut.dok.fragen).length ? { fragen: structuredClone(_gut.dok.fragen) } : {}),
    ...(_gut.dok?.platzhalter && Object.keys(_gut.dok.platzhalter).length ? { platzhalter: structuredClone(_gut.dok.platzhalter) } : {}),
    ...(_gut.dok?.praesentation ? { praesentation: structuredClone(_gut.dok.praesentation) } : {}),
    anlagen: _gut.dok ? structuredClone(_gut.dok.anlagen || []) : null,
    figurEinstellungen,
  };
}

/** Für _applyProjectData: null setzt alles zurück, damit nichts vom vorher geöffneten Projekt stehen bleibt. */
export function gutRestoreGutachten(daten) {
  _gut.dok = gdNormalisieren(daten);
  ggFigurEinstellungenRestore(daten?.figurEinstellungen || null);
  _gut.auswahl = null;
  _gut.cache.clear();
  const wrap = document.getElementById('analyse-ggrafik-wrap');
  if (wrap && wrap.style.display !== 'none') gutRender();
}

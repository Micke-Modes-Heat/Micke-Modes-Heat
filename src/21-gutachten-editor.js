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
  ggFigurWordDaten, ggSvgToPngBlob, ggTrafostationenIstListe,
} from './17-gutachten-grafik.js';
import {
  GUTACHTEN_DOK_VERSION, GUTACHTEN_MAX_EBENE, gdNormalisieren, gdKapitelNummern, gdStandardDokument, gdLeeresDokument,
  gdKapitelEinfuegen, gdKapitelLoeschen, gdKapitelVerschieben, gdKapitelEbene,
  gdNeuerTextBlock, gdNeuerFigurBlock, gdNeuerBildBlock, gdBlockEinfuegen, gdBlockLoeschen, gdBlockVerschieben,
  gdFindeBlock, gdBeschriftungen, gdFigurIds, gdNormDeckblatt, GUTACHTEN_DECKBLATT_VORGABEN,
} from './lib/gutachten-dokument.js';
import {
  gdxKontext, gdxDeckblatt, gdxInhaltsverzeichnis, gdxVerzeichnis, gdxUeberschrift, gdxFreitext,
  gdxBausteinAbsaetze, gdxTabelle, gdxAbbildung, gdxBeschriftung, gdxErzeugePaket,
} from './lib/gutachten-docx.js';
import { GV_LOGO_PNG, GV_WAPPEN_PNG, GV_NETZGRAFIK_PNG } from './config/gutachten-vorlage-assets.js';

const _gut = {
  dok: null,            // Gutachten-Dokument oder null, solange keins angelegt ist
  modus: 'dokument',    // 'dokument' | 'einzel'
  auswahl: null,        // { art: 'kapitel' | 'block', id }
  cache: new Map(),     // blockId → { schluessel, ergebnis } — gezeichnete Figuren, damit Auswahl/Verschieben nicht alles neu rechnet
  lpZiel: null,          // blockId eines 'bild'-Blocks, der gerade in 🗺️ Liegenschaftsbilder eingerichtet wird, oder null
};

const GUT_AKZENT = '#26a69a';
const GUT_WARN = '#e0a126';
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
const teilArten = b => ggFigurTeilArten(b.figurId, { layout: b.layout, kennzahlen: b.kennzahlen });
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
  <div id="gut-modusleiste" style="display:flex;gap:6px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(38,166,154,.15);flex-shrink:0;"></div>
  <div id="gut-dokument" style="flex:1;min-height:0;display:flex;">
    <div id="gut-gliederung" style="width:270px;flex-shrink:0;overflow-y:auto;border-right:1px solid rgba(38,166,154,.15);padding:10px;"></div>
    <div id="gut-seite-scroll" style="flex:1;min-width:0;overflow-y:auto;padding:20px;background:#161622;"><div id="gut-seite"></div></div>
    <div id="gut-eigenschaften" style="width:300px;flex-shrink:0;overflow-y:auto;border-left:1px solid rgba(38,166,154,.15);padding:10px;"></div>
  </div>
  <div id="gut-einzel" style="flex:1;min-height:0;display:none;"></div>
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
  const leiste = document.getElementById('gut-modusleiste');
  if (!dokEl || !einzelEl) return false;
  const einzel = _gut.modus === 'einzel';
  dokEl.style.display = einzel ? 'none' : 'flex';
  einzelEl.style.display = einzel ? '' : 'none';
  if (leiste) {
    const tab = (modus, label) => {
      const aktiv = _gut.modus === modus;
      return `<button data-click="gutSetModus('${modus}')" style="font-family:inherit;font-size:11px;padding:5px 12px;border-radius:5px;cursor:pointer;
        border:1px solid ${aktiv ? 'rgba(38,166,154,.6)' : 'rgba(255,255,255,.1)'};background:${aktiv ? 'rgba(38,166,154,.18)' : 'transparent'};
        color:${aktiv ? GUT_AKZENT : 'var(--muted)'};">${label}</button>`;
    };
    leiste.innerHTML = tab('dokument', '📄 Dokument') + tab('einzel', '🖼 Einzelgrafiken')
      + `<span id="gut-status" style="margin-left:12px;font-size:11px;color:${GUT_AKZENT};"></span>`
      + (!einzel && _gut.dok
          ? `<span style="margin-left:auto;display:flex;gap:6px;">${knopf('⟳ Daten aktualisieren', 'gutAktualisieren()', { titel: 'Alle Abbildungen neu aus dem Projektstand zeichnen.' })}`
            + `${knopf('⤓ Word-Datei (.docx)', 'gutWordExport()', { primaer: true, titel: 'Komplettes Gutachten im LKEBw-Layout: Deckblatt, Verzeichnisse, Kapitel, Abbildungen und Tabellen.' })}</span>`
          : '');
  }
  return !einzel;
}

export function gutRender() {
  if (!zeigeModus()) { ggShowSection(true); return; }
  renderSeite();
  renderGliederung();   // nach der Seite: zählt die offenen Platzhalter im gezeichneten Dokument
  renderEigenschaften();
}

export function gutSetModus(modus) {
  _gut.modus = modus === 'einzel' ? 'einzel' : 'dokument';
  // In der Einzelansicht geänderte Haken und Kopfzeilen sollen im Dokument ankommen
  if (_gut.modus === 'dokument') _gut.cache.clear();
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
      ${_gut.dok ? knopf('+ Kapitel', 'gutAddKapitel()', { klein: true, titel: 'Neues Hauptkapitel am Ende' }) : ''}</div>`;
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
          + hinweis('Einfügen über das jeweilige Kapitel → „Inhalt einfügen“.')
        : '')
    + deckblattPanel()
    + ueberschrift('Zurücksetzen')
    + knopf('↺ Standardgliederung neu anlegen', 'gutStandardAnlegen(true)', { gefahr: true, titel: 'Ersetzt das aktuelle Dokument samt aller Freitexte.' });
}

function kapitelPanel(k, idx) {
  const nr = gdKapitelNummern(_gut.dok.kapitel)[idx];
  const id = k.id;
  const katalog = ggFigurenKatalog();
  const imDok = gdFigurIds(_gut.dok);
  const option = f => `<option value="${esc(f.id)}">${imDok.has(f.id) ? '✓ ' : ''}${esc(f.titel)}</option>`;
  const passend = katalog.filter(f => (f.kapitel.match(/^\d+(\.\d+)*/) || [''])[0] === nr);
  const gruppen = new Map();
  for (const f of katalog) {
    const g = f.kapitel || 'Sonstige';
    if (!gruppen.has(g)) gruppen.set(g, []);
    gruppen.get(g).push(f);
  }
  const figurAuswahl = `<select data-change="gutAddFigur('${id}',this.value)" style="${EINGABE_STIL}">
      <option value="">Abbildung oder Textbaustein …</option>
      ${passend.length ? `<optgroup label="Passend zu Kapitel ${esc(nr)}">${passend.map(option).join('')}</optgroup>` : ''}
      ${[...gruppen].map(([g, fs]) => `<optgroup label="${esc(g)}">${fs.map(option).join('')}</optgroup>`).join('')}
    </select>`;
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
      + 'Standardgliederung ersetzen? Das Deckblatt bleibt erhalten.')) return;
  const { dok, nichtZugeordnet } = gdStandardDokument(ggFigurenKatalog());
  dok.deckblatt = _gut.dok?.deckblatt || dok.deckblatt;   // Projektangaben haben nichts mit der Gliederung zu tun
  _gut.dok = dok;
  _gut.auswahl = null;
  _gut.cache.clear();
  gutRender();
  const n = dok.kapitel.reduce((s, k) => s + k.bloecke.length, 0);
  gutSay(`✓ Standardgliederung angelegt — ${n} Abbildungen und Textbausteine eingesetzt.`
    + (nichtZugeordnet.length ? ` ${nichtZugeordnet.length} ohne passendes Kapitel.` : ''));
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
  if (!figurId || !findeKapitel(kapId)) return;
  const b = gdNeuerFigurBlock(figurId);
  gdBlockEinfuegen(_gut.dok, kapId, b);
  _gut.auswahl = { art: 'block', id: b.id };
  neuZeichnen();
  scrollZu('block', b.id);
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
  const titel = 'Gutachten zur zukünftigen Energieversorgung' + (deckblatt.liegenschaft ? ` der ${deckblatt.liegenschaft}` : '');
  return { paket: gdxErzeugePaket(ctx, koerper, { titel }), warnungen };
}

let _gutExportLaeuft = false;

export async function gutWordExport() {
  if (_gutExportLaeuft) return;
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
      + (warnungen.length ? ` ⚠ ${warnungen.length} Abbildung(en) übersprungen.` : ''));
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

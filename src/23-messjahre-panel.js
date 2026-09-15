// ── 23-messjahre-panel.js — Strom-Messjahre unter ⚡ Strom-Grundlagen ──
// Einzige Eingabestelle für gemessene Strom-Lastgänge: je Messjahr der Bezug vom Netzbetreiber
// und optional die Erzeugung eines BHKW. Ausgewertet wird die Summe (Stromverbrauch der
// Liegenschaft) — im Gutachten Kapitel 3.2 für alle Jahre (17), in PV-Analyse, NAP-Analyse und
// Bedarfsprognose nur für das Referenzjahr. Das Referenzjahr wählt der Nutzer von Hand; es wird
// nach window.elQuartierH/H15/… geschrieben, woraus die übrigen Module wie bisher lesen.
// Ausnahmen ohne eigene Auswahl: Upload aus der PV-Analyse (Datei ist dort bewusst gewählt) und
// Altprojekte mit genau einem Lastgang (alle Rechnungen bauten schon darauf auf).
//
// Importiert nur lib/ → Blatt im Importgraph.

import {
  sdParseLastgang, sdJahrAusDateiname, sdJahresauswertung, sdReferenzReihen,
  sdCapture, sdNormalisieren, sdAusQuartierProfil, sdId,
} from './lib/stromdaten.js';

const WRAP_ID = 'strom-messjahre-wrap';
const INPUT_ID = 'sgmj-datei';
const STIL_KNOPF = 'font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;';
const GELB = '#e0a126';

let _daten = { jahre: [], referenzId: null };
let _ziel = { art: 'bezug', id: '' };
let _angewandt;   // Messjahr-Objekt, das zuletzt nach window.elQuartier* geschrieben wurde (undefined = noch nie)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const zahl = (v, dez = 0) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: dez, maximumFractionDigits: dez }) : '—');
const reihe = r => ({ werte: r.werte, istViertel: r.istViertel, startDate: r.startDate, dateiname: r.dateiname });

/** Messjahre samt Referenz — nur lesen. Jede Änderung legt neue Objekte an (Kennzahlen-Cache in lib/stromdaten). */
export function sgMjDaten() { return _daten; }

export function sgMjReferenzHatBhkw() {
  return !!_daten.jahre.find(j => j.id === _daten.referenzId)?.bhkw;
}

/* ── Referenzjahr → window.elQuartier* ───────────────────────────────────── */
function anwenden(benachrichtigen) {
  const r = sdReferenzReihen(_daten);
  const mj = r ? r.mj : null;
  if (mj === _angewandt) return;
  _angewandt = mj;
  window.elQuartierH15        = r ? r.h15 : null;
  window.elQuartierH          = r ? r.h : null;
  window.elQuartierResolution = r ? r.aufloesung : null;
  window.elQuartierStartDate  = r ? r.startDate : null;
  window.elQuartierFilename   = r ? r.dateiname : null;
  if (!benachrichtigen) return;
  const mwh = $('strom-quartier-mwh');
  if (r && mwh) mwh.value = '';   // ein Lastgang ersetzt die Jahressumme, wie beim bisherigen Upload
  if (typeof window.calcStromPanel === 'function') window.calcStromPanel();
  if (typeof window.napOnStromGrundlagenChanged === 'function') window.napOnStromGrundlagenChanged();
  if (typeof window.sgNaRender === 'function') window.sgNaRender();   // Vorschlag Messverfahren hängt an der Auflösung
}

function setzen(jahre, referenzId = _daten.referenzId) {
  _daten = { jahre, referenzId: jahre.some(j => j.id === referenzId) ? referenzId : null };
  anwenden(true);
  sgMjRender();
}

/* ── Oberfläche ──────────────────────────────────────────────────────────── */
function dateiZeile(r, ersatz) {
  return `<div style="color:var(--muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.dateiname)}">`
    + `${esc(r.dateiname || ersatz)} · ${r.istViertel ? '15-min' : 'stündlich'}</div>`;
}

function zeileHtml(mj) {
  const a = sdJahresauswertung(mj);
  const ref = mj.id === _daten.referenzId;
  const toleranz = a.reihe.istViertel ? 96 : 24;   // ein Tag
  const bhkw = mj.bhkw
    ? `<div>BHKW · ${zahl(a.bhkw.arbeitKwh / 1000)} MWh
         <button data-click="sgMjBhkwEntfernen('${mj.id}')" title="BHKW-Lastgang entfernen" style="${STIL_KNOPF}color:var(--muted);padding:0 4px;">✕</button></div>
       ${dateiZeile(mj.bhkw, 'BHKW')}
       <div style="font-size:9px;">Gesamt ${zahl(a.gesamt.arbeitKwh / 1000)} MWh · max ${zahl(a.gesamt.spitzeKw)} kW</div>`
    : `<button data-click="sgMjDateiWaehlen('bhkw','${mj.id}')" title="Erzeugungslastgang des BHKW für dieses Jahr laden — wird zum Bezug addiert" style="${STIL_KNOPF}">+ BHKW-Lastgang</button>`;
  return `<div style="display:grid;grid-template-columns:18px 60px minmax(0,1fr) minmax(0,1fr) 20px;gap:6px;align-items:center;padding:5px 2px;border-top:1px solid var(--border);font-size:10px;${ref ? 'background:rgba(66,165,245,.08);' : ''}">
      <input type="radio" name="sgmj-referenz"${ref ? ' checked' : ''} data-change="sgMjSetReferenz('${mj.id}')" title="Als Referenzjahr verwenden" style="margin:0;cursor:pointer;">
      <input class="inp-field" type="number" min="1990" max="2100" step="1" value="${mj.jahr}" data-change="sgMjSetJahr('${mj.id}',this.value)" title="Messjahr" style="width:100%;box-sizing:border-box;font-size:10px;text-align:left;">
      <div style="min-width:0;"><div>Bezug · ${zahl(a.bezug.arbeitKwh / 1000)} MWh · max ${zahl(a.bezug.spitzeKw)} kW</div>${dateiZeile(mj.bezug, 'Bezug')}</div>
      <div style="min-width:0;">${bhkw}</div>
      <button data-click="sgMjEntfernen('${mj.id}')" title="Messjahr entfernen" style="${STIL_KNOPF}color:var(--muted);padding:1px 4px;">✕</button>
      ${a.reihe.abweichungWerte > toleranz
        ? `<div style="grid-column:1/-1;font-size:9px;color:${GELB};">⚠ Bezugs- und BHKW-Lastgang sind unterschiedlich lang (${zahl(a.reihe.abweichungWerte)} Werte) — Zeiträume prüfen.</div>`
        : ''}
    </div>`;
}

function panelHtml() {
  const jahre = [..._daten.jahre].sort((a, b) => a.jahr - b.jahr);
  const doppelt = [...new Set(jahre.filter((j, i) => i > 0 && j.jahr === jahre[i - 1].jahr).map(j => j.jahr))];
  const ref = jahre.find(j => j.id === _daten.referenzId);
  let status = '';
  if (jahre.length && !ref) {
    status = `<span style="color:${GELB};">⚠ Kein Referenzjahr gewählt (●) — PV-Analyse, NAP-Analyse und Bedarfsprognose rechnen erst danach mit Messdaten.</span>`;
  } else if (ref) {
    status = `✓ Referenzjahr ${ref.jahr}${ref.bhkw ? ' (Bezug + BHKW)' : ''} speist PV-Analyse, NAP-Analyse und Bedarfsprognose.`;
  }
  if (doppelt.length) {
    status += `<br><span style="color:${GELB};">⚠ Messjahr ${doppelt.join(', ')} mehrfach vorhanden — Jahr korrigieren oder Eintrag entfernen.</span>`;
  }

  return `<div class="sa-section-title">Stromlastgänge · Messjahre <span style="font-weight:normal;text-transform:none;letter-spacing:0;color:var(--muted);font-size:9px;">(ohne Wärmepumpen) · Bezug EVU + BHKW · Gutachten 3.2 · ● = Referenzjahr</span></div>
    ${jahre.length ? `<div style="margin-bottom:6px;border-bottom:1px solid var(--border);">${jahre.map(zeileHtml).join('')}</div>` : ''}
    <div data-click="sgMjDateiWaehlen('bezug','')" style="border:1px dashed var(--border);border-radius:6px;padding:8px 12px;cursor:pointer;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
      <span style="font-size:15px;">📂</span>
      <div style="flex:1;font-size:10px;color:var(--muted);">${jahre.length ? '+ Weiteres Messjahr laden' : 'Bezugs-Lastgänge laden'} — je Datei ein Jahr, mehrere Dateien auf einmal möglich · CSV 15-min (35.040 Werte) oder Stunden (8.760) · kW</div>
    </div>
    <input type="file" id="${INPUT_ID}" accept=".csv,.txt" style="display:none;" data-change="sgMjDateienGewaehlt(this.files)"/>
    ${status ? `<div style="font-size:9px;color:var(--muted);margin-bottom:10px;line-height:1.5;">${status}</div>` : ''}`;
}

/** Abschnitt „Messjahre" in ⚡ Strom-Grundlagen neu zeichnen. */
export function sgMjRender() {
  const wrap = $(WRAP_ID);
  if (wrap) wrap.innerHTML = panelHtml();
}

/** ⚡ Strom-Grundlagen öffnen und zu den Messjahren springen (Absprung aus NAP-Analyse und Gutachten). */
export function sgMjOeffnen() {
  const p = $('strom-panel');
  if (p && !p.classList.contains('visible') && typeof window.toggleStromPanel === 'function') window.toggleStromPanel();
  $(WRAP_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ── Dateien ─────────────────────────────────────────────────────────────── */
export function sgMjDateiWaehlen(art, id) {
  _ziel = { art: art === 'bhkw' ? 'bhkw' : 'bezug', id: String(id || '') };
  const input = $(INPUT_ID);
  if (!input) return;
  input.multiple = _ziel.art === 'bezug';
  input.value = '';
  input.click();
}

async function lesen(file) {
  const r = sdParseLastgang(await file.text());
  return r.fehler ? { fehler: `${file.name}: ${r.fehler}` } : { ...r, dateiname: file.name };
}

/** Messjahr einer Bezugsdatei: Zeitstempel, sonst Dateiname, sonst Nachfrage. null = abgebrochen. */
function jahrFuer(r, file) {
  const jahr = r.jahr ?? sdJahrAusDateiname(file.name);
  if (jahr) return jahr;
  const eingabe = Math.round(Number(prompt(`Für „${file.name}“ ließ sich kein Jahr erkennen (keine Zeitstempel). Messjahr eingeben:`,
                                           String(new Date().getFullYear() - 1))));
  return eingabe >= 1990 && eingabe <= 2100 ? eingabe : null;
}

export async function sgMjDateienGewaehlt(files) {
  const liste = [...(files || [])];
  if (!liste.length) return;
  const ziel = _ziel;
  const fehler = [];
  let jahre = [..._daten.jahre];

  if (ziel.art === 'bhkw') {
    const mj = jahre.find(j => j.id === ziel.id);
    if (!mj) return;
    const r = await lesen(liste[0]);
    if (r.fehler) {
      alert(r.fehler);
      return;
    }
    if (r.jahr && r.jahr !== mj.jahr
        && !confirm(`Die BHKW-Datei enthält Werte aus ${r.jahr}, das Messjahr ist ${mj.jahr}. Trotzdem zuordnen?`)) return;
    jahre = jahre.map(j => (j === mj ? { ...j, bhkw: reihe(r) } : j));
  } else {
    for (const file of liste) {
      const r = await lesen(file);
      if (r.fehler) { fehler.push(r.fehler); continue; }
      const jahr = jahrFuer(r, file);
      if (!jahr) { fehler.push(`${file.name}: kein gültiges Messjahr angegeben.`); continue; }
      const vorhanden = jahre.find(j => j.jahr === jahr);
      if (vorhanden && !confirm(`Messjahr ${jahr} ist schon vorhanden (${vorhanden.bezug.dateiname || 'Bezug'}). `
                                + 'Bezugs-Lastgang ersetzen? Ein BHKW-Lastgang bleibt erhalten.')) continue;
      jahre = vorhanden
        ? jahre.map(j => (j === vorhanden ? { ...j, bezug: reihe(r) } : j))
        : [...jahre, { id: sdId(), jahr, bezug: reihe(r), bhkw: null }];
    }
  }
  setzen(jahre);
  if (fehler.length) alert(`Nicht übernommen:\n\n${fehler.join('\n')}`);
}

/** Upload aus der PV-Analyse (09a stromFileSelected): Messjahr anlegen bzw. ersetzen und gleich als Referenz setzen. */
export async function sgMjDateiAlsReferenz(file) {
  if (!file) return;
  const r = await lesen(file);
  if (r.fehler) { alert(r.fehler); return; }
  const jahr = jahrFuer(r, file);
  if (!jahr) return;
  const vorhanden = _daten.jahre.find(j => j.jahr === jahr);
  if (vorhanden && !confirm(`Messjahr ${jahr} ist schon vorhanden. Bezugs-Lastgang ersetzen und als Referenzjahr verwenden?`)) return;
  const mj = vorhanden ? { ...vorhanden, bezug: reihe(r) } : { id: sdId(), jahr, bezug: reihe(r), bhkw: null };
  setzen(vorhanden ? _daten.jahre.map(j => (j === vorhanden ? mj : j)) : [..._daten.jahre, mj], mj.id);
}

/* ── Eingaben ────────────────────────────────────────────────────────────── */
export function sgMjSetReferenz(id) {
  setzen(_daten.jahre, String(id));
}

/** Jahr korrigieren. Kein Neuaufbau: change feuert beim Wegklicken, ein Neuaufbau würde den angeklickten Knopf austauschen. */
export function sgMjSetJahr(id, wert) {
  const jahr = Math.round(Number(wert));
  if (!(jahr >= 1990 && jahr <= 2100)) { sgMjRender(); return; }
  _daten = { ..._daten, jahre: _daten.jahre.map(j => (j.id === id ? { ...j, jahr } : j)) };
  anwenden(true);
}

export function sgMjEntfernen(id) {
  const mj = _daten.jahre.find(j => j.id === id);
  if (!mj || !confirm(`Messjahr ${mj.jahr} (${mj.bhkw ? 'Bezugs- und BHKW-Lastgang' : 'Bezugs-Lastgang'}) entfernen?`)) return;
  setzen(_daten.jahre.filter(j => j !== mj));
}

export function sgMjBhkwEntfernen(id) {
  setzen(_daten.jahre.map(j => (j.id === id ? { ...j, bhkw: null } : j)));
}

/* ── Projektdatei (03c) ──────────────────────────────────────────────────── */
/** Für _buildProjectData; null ohne Messjahre. */
export function sgMjCapture() {
  return _daten.jahre.length ? sdCapture(_daten) : null;
}

/**
 * Für _applyProjectData: gespeicherte Messjahre, sonst ein Altprojekt-Lastgang als einziges Messjahr
 * (bleibt Referenz). Setzt window.elQuartier* auf das Referenzjahr, stößt aber keine Rechnung an —
 * das übernimmt der Ladevorgang selbst.
 */
export function sgMjRestore(gespeichert, altProfil) {
  _daten = gespeichert ? sdNormalisieren(gespeichert) : sdAusQuartierProfil(altProfil);
  _angewandt = undefined;
  anwenden(false);
  sgMjRender();
}

// ── 22-netzanschluss-panel.js — Netzanschluss-Stammdaten unter ⚡ Strom-Grundlagen ──
// Einzige Eingabestelle für Netzbetreiber, Spannungsebene, Übergabepunkt, Messverfahren
// und Einspeisepunkte (Gutachtentext Kapitel 3.1.1).
//
// Die vereinbarte Anschlussleistung und die Bezugsgrenze am NAP sind ein und derselbe
// Wert (kVA, aus dem Netzanschlussvertrag) — er wird direkt im Feld „Max. Bezug" unter
// NAP-Grenzen gepflegt (window.elNapMaxBezugKw) und speist von dort PV-Analyse,
// NAP-Lastgang und die Gutachten-Grafik „Entwicklung der Anschlussleistung".
//
// Liest und schreibt die na*-Globals über window (Live-Accessoren aus main.js) und
// importiert nur lib/ → Blatt im Importgraph.

import { NA_MESSVERFAHREN, naMessverfahrenVorschlag } from './lib/netzanschluss.js';

const WRAP_ID = 'strom-netzanschluss-wrap';
const TEXTFELDER = ['naNetzbetreiberName', 'naNetzbetreiberAdresse', 'naSpannungsebene', 'naUebergabepunkt'];
const STIL_EINGABE = 'width:100%;box-sizing:border-box;text-align:left;font-size:10px;';
const STIL_KNOPF = 'font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function vorschlag() {
  // elQuartierH gibt es nur aus dem Referenz-Messjahr (23-messjahre-panel.js)
  const aufloesung = window.elQuartierH ? (window.elQuartierResolution === 15 ? 15 : 60) : null;
  const eingabe = parseFloat($('strom-quartier-mwh')?.value);
  return naMessverfahrenVorschlag({ lastgangAufloesung: aufloesung, jahresMwh: eingabe > 0 ? eingabe : null });
}

/* ── Oberfläche ──────────────────────────────────────────────────────────── */
function textfeld(label, feld, { einheit = '', platzhalter = '' } = {}) {
  return `<label style="display:flex;flex-direction:column;gap:2px;min-width:0;">
      <span style="font-size:9px;color:var(--muted);">${label}</span>
      <span style="display:flex;align-items:center;gap:4px;">
        <input class="inp-field" type="text" value="${esc(window[feld])}" placeholder="${esc(platzhalter)}"
          data-change="sgNaSetFeld('${feld}',this.value)" style="${STIL_EINGABE}"/>
        ${einheit ? `<span style="font-size:9px;color:var(--muted);">${einheit}</span>` : ''}
      </span>
    </label>`;
}

function messverfahrenFeld() {
  const aktuell = String(window.naMessverfahren || '');
  const optionen = [['', '— bitte wählen —'], ...NA_MESSVERFAHREN.map(o => [o.wert, o.wert])];
  if (aktuell && !NA_MESSVERFAHREN.some(o => o.wert === aktuell)) optionen.push([aktuell, `${aktuell} (bisheriger Freitext)`]);
  return `<label style="display:flex;flex-direction:column;gap:2px;min-width:0;">
      <span style="font-size:9px;color:var(--muted);">Messverfahren</span>
      <select class="inp-field" data-change="sgNaSetMessverfahren(this.value)" style="${STIL_EINGABE}">
        ${optionen.map(([v, l]) => `<option value="${esc(v)}"${v === aktuell ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
    </label>`;
}

function vorschlagHtml() {
  const v = vorschlag();
  if (!v) return 'Vorschlag Messverfahren: dafür Stromlastgang hochladen oder Jahressumme eintragen.';
  if (window.naMessverfahren === v.wert) return `✓ Messverfahren passt zum Vorschlag (${esc(v.grund)}).`;
  return `Vorschlag: <b style="color:var(--text);">${v.kurz}</b> – ${esc(v.grund)} `
    + `<button data-click="sgNaVorschlagUebernehmen()" style="${STIL_KNOPF}">übernehmen</button>`;
}

function einspeiseFeld(i, feld, label, wert) {
  return `<label style="display:flex;flex-direction:column;gap:2px;min-width:0;">
      <span style="font-size:9px;color:var(--muted);">${label}</span>
      <input class="inp-field" type="text" value="${esc(wert)}" data-change="sgNaSetEinspeisung(${i},'${feld}',this.value)" style="${STIL_EINGABE}"/>
    </label>`;
}

function einspeisungenHtml() {
  const liste = window.naEinspeisungen?.length ? window.naEinspeisungen : [{ station: '', kabeltyp: '' }];
  const mehrere = liste.length > 1;
  return liste.map((e, i) => `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;margin-top:4px;">
      ${einspeiseFeld(i, 'station', mehrere ? `Station ${i + 1}` : 'Station', e.station)}
      ${einspeiseFeld(i, 'kabeltyp', mehrere ? `Kabeltyp ${i + 1}` : 'Kabeltyp', e.kabeltyp)}
      ${mehrere ? `<button data-click="sgNaEinspeisungEntfernen(${i})" title="Einspeisepunkt entfernen" style="${STIL_KNOPF}color:var(--muted);">✕</button>` : '<span></span>'}
    </div>`).join('');
}

function panelHtml() {
  return `<div class="sa-section-title" style="margin-top:4px;">Netzanschluss <span style="font-weight:normal;text-transform:none;letter-spacing:0;color:var(--muted);font-size:9px;">laut Netzanschlussvertrag · Gutachten 3.1.1 · vereinbarte Anschlussleistung = Max. Bezug unter NAP-Grenzen (kVA)</span>
      <a href="https://www.vnbdigital.de/" target="_blank" rel="noopener"
        style="font-weight:normal;text-transform:none;letter-spacing:0;color:var(--accent);font-size:9px;margin-left:6px;text-decoration:none;" title="Netzbetreiber anhand der Adresse ermitteln">→ Netzbetreiber finden (VNB Digital)</a>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;margin-bottom:6px;">
      ${textfeld('Netzbetreiber', 'naNetzbetreiberName')}
      ${textfeld('Adresse Netzbetreiber', 'naNetzbetreiberAdresse')}
      ${textfeld('Spannungsebene', 'naSpannungsebene', { platzhalter: 'z. B. Mittelspannung (20 kV)' })}
      ${textfeld('Übergabepunkt (Gebäude/Lage)', 'naUebergabepunkt')}
      ${messverfahrenFeld()}
    </div>
    <div id="strom-na-vorschlag" style="font-size:9px;color:var(--muted);margin-bottom:6px;line-height:1.5;">${vorschlagHtml()}</div>
    <div style="font-size:9px;color:var(--muted);margin-top:6px;">Einspeisepunkte (Station des Netzbetreibers · Kabel bis zur Übergabe)</div>
    ${einspeisungenHtml()}
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;">
      <button data-click="sgNaEinspeisungNeu()" style="${STIL_KNOPF}">+ Einspeisepunkt</button>
      <button data-click="sgNaAusNapAssetKnopf()" title="Spannungsebene und Übergabepunkt-Gebäude aus dem NAP-Asset des Elektro-Tabs lesen (nur leere Felder)" style="${STIL_KNOPF}">⟳ Aus NAP-Asset übernehmen</button>
      <span id="strom-na-status" style="font-size:9px;color:var(--muted);"></span>
    </div>`;
}

/** Abschnitt „Netzanschluss" in ⚡ Strom-Grundlagen neu zeichnen. */
export function sgNaRender() {
  const wrap = $(WRAP_ID);
  if (wrap) wrap.innerHTML = panelHtml();
}

/** ⚡ Strom-Grundlagen öffnen und zum Abschnitt „Netzanschluss" springen (Absprung aus dem Gutachten-Reiter). */
export function sgNaOeffnen() {
  const p = $('strom-panel');
  if (p && !p.classList.contains('visible') && typeof window.toggleStromPanel === 'function') window.toggleStromPanel();
  $(WRAP_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ── Eingaben ────────────────────────────────────────────────────────────────
 * Textfelder zeichnen den Abschnitt NICHT neu: change feuert beim Wegklicken, ein
 * Neuaufbau würde den gerade angeklickten Knopf austauschen und der Klick ginge verloren. */
export function sgNaSetFeld(feld, wert) {
  if (!TEXTFELDER.includes(feld)) return;
  window[feld] = String(wert ?? '').trim();
}

export function sgNaSetMessverfahren(wert) {
  window.naMessverfahren = String(wert ?? '');
  const el = $('strom-na-vorschlag');
  if (el) el.innerHTML = vorschlagHtml();
}

export function sgNaVorschlagUebernehmen() {
  const v = vorschlag();
  if (!v) return;
  window.naMessverfahren = v.wert;
  sgNaRender();
}

export function sgNaSetEinspeisung(i, feld, wert) {
  if (feld !== 'station' && feld !== 'kabeltyp') return;
  const liste = (window.naEinspeisungen || []).map(e => ({ ...e }));
  if (!liste[i]) liste[i] = { station: '', kabeltyp: '' };
  liste[i][feld] = String(wert ?? '').trim();
  window.naEinspeisungen = liste;
}

export function sgNaEinspeisungNeu() {
  const liste = (window.naEinspeisungen?.length ? window.naEinspeisungen : [{ station: '', kabeltyp: '' }]).map(e => ({ ...e }));
  liste.push({ station: '', kabeltyp: '' });
  window.naEinspeisungen = liste;
  sgNaRender();
}

export function sgNaEinspeisungEntfernen(i) {
  const liste = (window.naEinspeisungen || []).map(e => ({ ...e }));
  liste.splice(i, 1);
  window.naEinspeisungen = liste;
  sgNaRender();
}

/** Spannungsebene und Übergabepunkt aus dem NAP-Asset übernehmen (nur leere Felder). Liefert eine Statusmeldung. */
export function sgNaAusNapAsset() {
  let naps = [];
  try { naps = window.listAssets?.({ type: 'NAP' }) || []; } catch (e) { void e; }
  if (!naps.length) return '⚠ Kein NAP-Asset im Modell — Spannungsebene und Übergabepunkt bitte von Hand eintragen.';
  const nap = naps[0];
  let n = 0;
  if (!window.naSpannungsebene && nap.props?.spannungKV) {
    const kv = Number(nap.props.spannungKV);
    window.naSpannungsebene = kv > 1 ? `Mittelspannung (${kv} kV)` : `Niederspannung (${kv * 1000} V)`;
    n++;
  }
  if (!window.naUebergabepunkt && nap.buildingId) {
    const g = (window.gebaeude || []).find(b => b.id === nap.buildingId);
    const bez = String(g?.gebaeudenummer || g?.name || '').trim();
    if (bez) { window.naUebergabepunkt = bez; n++; }
  }
  if (naps.length > 1) {
    const vorhandene = window.naEinspeisungen || [];
    if (vorhandene.length < naps.length) {
      window.naEinspeisungen = naps.map((_, i) => vorhandene[i] || { station: '', kabeltyp: '' });
      n++;
    }
  }
  if (n) sgNaRender();
  return n ? `✓ ${n} Angabe(n) aus dem NAP-Asset übernommen — bitte prüfen.`
           : '✓ Keine leeren Felder gefunden, die sich aus dem NAP-Asset ableiten ließen.';
}

export function sgNaAusNapAssetKnopf() {
  const meldung = sgNaAusNapAsset();
  const el = $('strom-na-status');
  if (el) el.textContent = meldung;
}

// ── 58-verbrauch-reiter.js — Reiter Planung › Strom › Verbrauch ──────────────
//
// Zentrale Lastschätzung aller Gebäude statt „Leistungsschätzung“ je Gebäudekarte
// und Verbrauchs-Teil von Auto-Befüllen. Gerechnet wird in lib/stromlast-schaetzung;
// geschrieben wird nur props.leistungKW (+ leistungQuelle) der Verbraucher-Assets,
// gesammelt als eine Planungstransaktion (rückgängig machbar).
//
// Zugriff auf den App-Kern über window (alle Modul-Exporte liegen dort, main.js),
// damit dieses Modul keinen Importzyklus mit 02b/03c/13a aufmacht.

import {
  lastSchaetzen, lastZustand, lastWirdUebernommen,
  LAST_METHODEN, LAST_METHODE_STANDARD, LAST_QUELLEN,
} from './lib/stromlast-schaetzung.js';

const HOST_ID = 'el-verbrauch-host';
const UNDO_LABEL = 'Stromlast übernehmen';

/** @type {Record<number, boolean>} */
const _stufen = { 2: true };
let _filter = 'alle';           // alle | offen | abweichend
let _umfang = 'leer';           // leer | schaetzung | alle
let _aktiv = null;              // zuletzt angeklickte Gebäude-ID
let _undoAt = null;             // Zeitstempel der eigenen letzten Transaktion

const _w = /** @type {any} */ (window);
const _esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _ic = id => `<svg class="ui-i"><use href="#ui-i-${id}"/></svg>`;
const _z0 = x => Math.round(x).toLocaleString('de-DE');
const _z1 = x => x == null ? '—' : x.toLocaleString('de-DE', { maximumFractionDigits: 1 });

// ── Methode (im Projekt gespeichert, 03c _buildProjectData) ──────────────────
export function verbrauchMethode() {
  const m = _w.stromLastMethode;
  return LAST_METHODEN[m] ? m : LAST_METHODE_STANDARD;
}
export function verbrauchMethodeSetzen(m) {
  if (!LAST_METHODEN[m]) return;
  _w.stromLastMethode = m;
  _w.markiereVarianteGeaendert?.();
  verbrauchRender();
}

// ── Daten je Gebäude ──────────────────────────────────────────────────────────
function _verbraucher(g) {
  return (_w.getAssetsForBuilding?.(g.id) || []).find(a => a.type === 'Verbraucher') || null;
}

/** Schätzung + Zustand eines Gebäudes (auch für die Verweiszeile der Gebäudekarte). */
export function verbrauchGebaeude(g) {
  const typ = _w.getNutzungstypById?.(g.nutzung || '');
  const profil = _w.getGebStromProfilInfo?.(g) || { id: _w.getGebStromProfil?.(g) || 'G0', quelle: 'nutzung' };
  const zaehler = parseFloat(g.strom) > 0;
  const s = lastSchaetzen({
    energieMwh: _w.getGebStromMwh?.(g) || 0,
    zaehler,
    grundflaecheM2: parseFloat(g.flaeche) || 0,
    vbh: _w.getGebVbh?.(g) || 0,
    wpm2: _w.getElSlpWpm2?.(profil.id) || 0,
    methode: verbrauchMethode(),
  });
  const v = _verbraucher(g);
  const assetKw = v ? (Number(v.props?.leistungKW) > 0 ? Number(v.props.leistungKW) : null) : null;
  const quelle = v?.props?.leistungQuelle || null;
  return {
    g, typ, profil, v, assetKw, quelle, ...s,
    vbh: _w.getGebVbh?.(g) || null,
    // Skalierung im Stundenlastgang (NAP, Knotenpunkt): 'energie' | 'spitze' | null
    lastgang: v ? (_w.getVerbraucherSkalierung?.(v)?.modus ?? null) : null,
    zustand: lastZustand({ hatAsset: !!v, assetKw, quelle, schaetzKw: s.kw }),
  };
}

function _gebaeudeListe() {
  const jahr = _w.globalYear ?? new Date().getFullYear();
  return (_w.gebaeude || []).filter(g => !(g.abrissjahr && Number(g.abrissjahr) <= jahr));
}

const ZUSTAND = {
  'kein-asset': { text: 'kein Verbraucher', cls: 'leer' },
  leer:         { text: 'ohne kW',          cls: 'offen' },
  gleich:       { text: 'übernommen',       cls: 'ok' },
  abweichend:   { text: 'abweichend',       cls: 'offen' },
  geschuetzt:   { text: 'eigener Wert',     cls: 'geschuetzt' },
};

// ── Rendern ───────────────────────────────────────────────────────────────────
function _stufeHtml(n, titel, kurz, zustand, inhalt) {
  const offen = !!_stufen[n];
  return `
    <div class="pvr-stufe${offen ? ' offen' : ''}">
      <button type="button" class="pvr-kopf" data-click="verbrauchStufe(${n})" aria-expanded="${offen}">
        <span class="pvr-nr" data-z="${zustand}">${zustand === 'ok' ? _ic('check') : n}</span>
        <span class="pvr-txt"><b>${titel}</b><small>${kurz}</small></span>
        <svg class="ui-i ui-i-sm pvr-chev"><use href="#ui-i-chev"/></svg>
      </button>
      ${offen ? `<div class="pvr-in">${inhalt}</div>` : ''}
    </div>`;
}

export function verbrauchStufe(n) {
  _stufen[n] = !_stufen[n];
  verbrauchRender();
}

const _aufg = (titel, text, click, icon = 'chev') =>
  `<button class="ui-aufgabe" data-click="${click}">${_ic(icon)}<span><b>${titel}</b><small>${text}</small></span><svg class="ui-i ui-i-sm"><use href="#ui-i-chev"/></svg></button>`;

function _grundlagenHtml(rows) {
  const m = verbrauchMethode();
  const nZ = rows.filter(r => r.energieQuelle === 'zaehler').length;
  const nTyp = rows.filter(r => r.typ).length;
  const nOhne = rows.filter(r => r.kw == null).length;
  const nErsatz = rows.filter(r => r.ersatz).length;
  return `
    <div class="vbr-methoden">
      ${Object.entries(LAST_METHODEN).map(([id, x]) => `
        <label class="vbr-methode">
          <input type="radio" name="vbr-methode" value="${id}"${m === id ? ' checked' : ''}
            data-change="verbrauchMethodeSetzen('${id}')"/>
          <span><b>${x.label}</b><small>${x.text}</small></span>
        </label>`).join('')}
    </div>
    <dl class="pvr-kv">
      <dt>Gebäude mit Zählerwert</dt><dd>${_z0(nZ)}</dd>
      <dt>mit Nutzungstyp</dt><dd>${_z0(nTyp)} von ${_z0(rows.length)}</dd>
      ${nErsatz ? `<dt title="Gewählter Weg nicht möglich (z. B. keine Fläche) — der andere Weg springt ein">mit Ersatzweg</dt><dd>${_z0(nErsatz)}</dd>` : ''}
      ${nOhne ? `<dt>ohne Schätzung (keine Fläche)</dt><dd>${_z0(nOhne)}</dd>` : ''}
    </dl>
    <div class="pvr-knoepfe">
      <button class="btn-secondary" data-click="showNutzungstypenModal()" title="Kennwert kWh/m²a, Lastprofil und Vollbenutzungsstunden je Nutzungstyp">Nutzungstypen</button>
      <button class="btn-secondary" data-click="openElSlpManager()" title="Leistungskennwerte W/m² je Lastprofil">W/m²-Kennwerte</button>
    </div>`;
}

function _zeileHtml(r) {
  const z = ZUSTAND[r.zustand];
  const name = r.g.name || ('#' + r.g.id);
  const energie = r.energieMwh == null ? '—'
    : `${_z1(r.energieMwh)}${r.energieQuelle === 'zaehler' ? ' <span class="vbr-z" title="Eingetragener Jahresverbrauch">Z</span>' : ''}`;
  const titelSchaetzung = [
    r.kwEnergie != null ? `Energie ÷ Vbh: ${_z1(r.energieMwh)} MWh × 1000 ÷ ${_z0(r.vbh || 0)} h = ${_z1(r.kwEnergie)} kW` : 'Energie ÷ Vbh: —',
    r.kwFlaeche != null ? `Fläche × W/m²: ${_z0(parseFloat(r.g.flaeche) || 0)} m² × ${_w.getElSlpWpm2?.(r.profil.id)} W/m² = ${_z1(r.kwFlaeche)} kW` : 'Fläche × W/m²: —',
    r.ersatz ? 'Gewählter Weg nicht möglich — Ersatzweg' : '',
  ].filter(Boolean).join('\n');
  const uebernehmbar = r.kw != null && (r.zustand === 'abweichend' || r.zustand === 'geschuetzt' || r.zustand === 'leer');
  const assetZelle = r.v
    ? `<span class="vbr-asset"><input class="inp-field vbr-kw ${z.cls}" type="number" min="0" step="0.1" value="${r.assetKw ?? ''}" placeholder="—"
         title="${z.text} · Leistung des Verbraucher-Assets${r.quelle ? ' (' + (LAST_QUELLEN[r.quelle] || r.quelle) + ')' : ''} — Eingabe gilt als „von Hand“${r.lastgang ? ' · im Lastgang (NAP): ' + (r.lastgang === 'energie' ? 'nach Jahresenergie' : 'Spitze = diese Leistung') : ''}"
         data-change="verbrauchKwSetzen(${r.g.id},this.value)"/>${uebernehmbar
        ? `<button class="btn-xs" data-click="verbrauchEinzelnUebernehmen(${r.g.id})" title="Schätzung ${_z1(r.kw)} kW übernehmen">←</button>` : ''}</span>`
    : '<span class="vbr-muted" title="Kein Verbraucher-Asset">—</span>';
  return `
    <tr class="${_aktiv === r.g.id ? 'aktiv' : ''}" data-geb="${r.g.id}">
      <td class="vbr-name"><a data-click="verbrauchZeigeGeb(${r.g.id})" title="${_esc(name)} · ${_esc(r.typ?.label || 'ohne Nutzungstyp')} · Profil ${_esc(r.profil.id)}">${_esc(name)}</a>
        <small>${_esc(r.typ?.label || 'ohne Nutzungstyp')} · ${_esc(r.profil.id)}</small></td>
      <td class="r">${energie}</td>
      <td class="r" title="${_esc(titelSchaetzung)}">${r.kw == null ? '—' : _z1(r.kw)}${r.ersatz ? '*' : ''}</td>
      <td class="r">${assetZelle}</td>
    </tr>`;
}

function _gebaeudeHtml(rows) {
  const f = { alle: rows,
    offen: rows.filter(r => r.zustand === 'leer' || r.zustand === 'kein-asset'),
    abweichend: rows.filter(r => r.zustand === 'abweichend' || r.zustand === 'geschuetzt') };
  const liste = f[_filter] || rows;
  const chips = [['alle', 'Alle'], ['offen', 'Ohne Wert'], ['abweichend', 'Abweichend']].map(([id, l]) =>
    `<button class="vbr-filter${_filter === id ? ' an' : ''}" data-click="verbrauchFilter('${id}')">${l} <span>${f[id].length}</span></button>`).join('');
  return `
    <div class="vbr-filterleiste">${chips}</div>
    <div class="vbr-tabelle-wrap">
      <table class="vbr-tabelle">
        <thead><tr><th>Gebäude</th><th class="r" title="Jahresverbrauch MWh/a — Z = eingetragener Zählerwert">MWh</th>
          <th class="r" title="Schätzung in kW nach der gewählten Methode (* = Ersatzweg)">Schätz.</th><th class="r" title="Leistung im Verbraucher-Asset — Rand: grün übernommen, gelb ohne Wert/abweichend, blau eigener Wert">Asset kW</th></tr></thead>
        <tbody>${liste.length ? liste.map(_zeileHtml).join('') : '<tr><td colspan="4" class="vbr-muted" style="text-align:center;padding:10px;">Keine Gebäude in dieser Auswahl.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="el-hinweis">Gebäudename anklicken zeigt es auf der Karte. Schätzung im Tooltip mit Rechenweg. „←“ übernimmt die Schätzung für ein Gebäude.</p>`;
}

function _uebernehmenHtml(rows) {
  const zahl = u => rows.filter(r => lastWirdUebernommen(r, u)).length;
  const n = zahl(_umfang);
  const ohneAsset = rows.filter(r => r.zustand === 'kein-asset').length;
  const undoMoeglich = _undoAt && _w._lastPlanningTransaction?.at === _undoAt;
  return `
    <div class="vbr-methoden">
      ${[['leer', 'Nur Verbraucher ohne Leistung'],
         ['schaetzung', 'Auch abweichende Schätzungen', 'Werte ohne Quellangabe aus älteren Projekten zählen als Schätzung'],
         ['alle', 'Alle — auch von Hand gesetzte und kalibrierte Werte']].map(([id, l, t]) => `
        <label class="vbr-methode"${t ? ` title="${t}"` : ''}>
          <input type="radio" name="vbr-umfang" value="${id}"${_umfang === id ? ' checked' : ''} data-change="verbrauchUmfang('${id}')"/>
          <span><b>${l}</b><small>${zahl(id)} ${zahl(id) === 1 ? 'Gebäude' : 'Gebäude'}</small></span>
        </label>`).join('')}
    </div>
    <div class="pvr-knoepfe">
      <button class="btn-confirm" data-click="verbrauchUebernehmen()"${n ? '' : ' disabled'}>Schätzung übernehmen (${n})</button>
      ${undoMoeglich ? '<button class="btn-secondary" data-click="verbrauchRueckgaengig()">↶ Rückgängig</button>' : ''}
    </div>
    ${ohneAsset ? `<p class="pvr-warn">${ohneAsset} ${ohneAsset === 1 ? 'Gebäude hat' : 'Gebäude haben'} kein Verbraucher-Asset.</p>
      <button class="btn-secondary" data-click="verbrauchFehlendeAnlegen()" title="Je Gebäude einen Verbraucher anlegen (ohne Elektro-Assets zusätzlich eine UV), an die Verteilung im Gebäude anschließen und die Schätzung eintragen">Verbraucher anlegen (${ohneAsset})</button>` : ''}`;
}

function _pruefenHtml(rows) {
  const sumE = rows.reduce((s, r) => s + (r.energieMwh || 0), 0);
  const sumS = rows.reduce((s, r) => s + (r.kw || 0), 0);
  const sumA = rows.reduce((s, r) => s + (r.assetKw || 0), 0);
  const q = _w.elQuartierH;
  let mess = '';
  if (q && q.length >= 8760) {
    let e = 0, p = 0;
    for (let i = 0; i < q.length; i++) { const v = Number(q[i]) || 0; e += v; if (v > p) p = v; }
    mess = `<dt>Gemessen (Referenzjahr)</dt><dd>${_z0(e / 1000)} MWh/a · Spitze ${_z0(p)} kW</dd>`;
  }
  const nEnergie = rows.filter(r => r.lastgang === 'energie').length;
  const nSpitze = rows.filter(r => r.lastgang === 'spitze').length;
  return `
    <dl class="pvr-kv">
      <dt>Jahresverbrauch Gebäude</dt><dd>${_z0(sumE)} MWh/a</dd>
      <dt>Σ Schätzung</dt><dd>${_z0(sumS)} kW</dd>
      <dt>Σ Verbraucher-Assets</dt><dd>${_z0(sumA)} kW</dd>
      ${mess}
      <dt title="Wie die Verbraucher im Stundenlastgang der NAP- und Knotenpunkt-Analyse skaliert werden">Lastgang nach Jahresenergie</dt><dd>${_z0(nEnergie)}</dd>
      <dt title="Von Hand gesetzte oder an der NAP-Messung kalibrierte Leistung bleibt die Spitze des Profils">Lastgang mit Spitze = kW</dt><dd>${_z0(nSpitze)}</dd>
    </dl>
    <p class="el-hinweis">Im Lastgang trägt jeder Verbraucher den Jahresverbrauch seines Gebäudes. Nur von Hand gesetzte oder kalibrierte Leistungen geben stattdessen die Spitze vor.</p>
    <p class="el-hinweis">Die Summe der Einzelleistungen liegt über der Spitze am Netzanschluss — gleichzeitig treten die Spitzen nicht auf (Gleichzeitigkeit).</p>
    ${_aufg('Strom-Grundlagen', 'Messjahre und Referenzlastgang', "toggleStromPanel()", 'chart')}
    ${_aufg('Netzanschluss-Analyse', 'Kalibrierung der Verbraucher an der gemessenen NAP-Spitze', "elTab('pruefen')", 'arrow')}`;
}

function _naechsterHtml(rows) {
  const karte = (stufe, titel, text, knoepfe) => `<div class="el-naechster-in" data-stufe="${stufe}">
      <div><b>${titel}</b><small>${text}</small></div>
      <div class="el-naechster-knoepfe">${knoepfe.map(([l, c, p]) =>
        `<button class="${p ? 'btn-confirm' : 'btn-secondary'}" data-click="${c}">${l}</button>`).join('')}</div>
    </div>`;
  if (!rows.length) return karte('leer', 'Noch keine Gebäude', 'Verbrauch gibt es erst, wenn im Schritt Bestand Gebäude geladen sind.',
    [['Zum Bestand', "uiSchritt('bestand')", true]]);
  const leer = rows.filter(r => r.zustand === 'leer').length;
  if (leer) return karte('offen', `${leer} Verbraucher ohne Leistung`, 'Die Schätzung in einem Schritt übernehmen, danach einzelne Werte nacharbeiten.',
    [['Leere übernehmen', "verbrauchUmfang('leer'); verbrauchUebernehmen()", true]]);
  const abw = rows.filter(r => r.zustand === 'abweichend').length;
  if (abw) return karte('offen', `${abw} ${abw === 1 ? 'Wert weicht' : 'Werte weichen'} von der Schätzung ab`,
    'Prüfen, ob die Werte bewusst gesetzt sind, sonst die Schätzung übernehmen.',
    [['Abweichende zeigen', "verbrauchFilter('abweichend')", true]]);
  return karte('ok', 'Alle Verbraucher haben eine Leistung', 'Gegen den gemessenen Lastgang prüfen.',
    [['Prüfen', 'verbrauchStufe(4)', true]]);
}

export function verbrauchRender() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const rows = _gebaeudeListe().map(verbrauchGebaeude);
  const m = LAST_METHODEN[verbrauchMethode()];
  const nLeer = rows.filter(r => r.zustand === 'leer').length;
  const nAbw = rows.filter(r => r.zustand === 'abweichend').length;
  const nUeb = rows.filter(r => lastWirdUebernommen(r, _umfang)).length;
  const sumA = rows.reduce((s, r) => s + (r.assetKw || 0), 0);
  host.innerHTML = `
    <div class="pvr vbr">
      ${_naechsterHtml(rows)}
      ${_stufeHtml(1, 'Grundlagen', `${m.kurz} · ${_z0(rows.filter(r => r.typ).length)} von ${_z0(rows.length)} mit Nutzungstyp`,
        rows.length ? 'ok' : 'leer', _grundlagenHtml(rows))}
      ${_stufeHtml(2, 'Gebäude', `${_z0(rows.length)} Gebäude · ${nLeer ? `${nLeer} ohne kW · ` : ''}${nAbw ? `${nAbw} abweichend` : 'keine Abweichung'}`,
        !rows.length ? 'leer' : (nLeer || nAbw) ? 'offen' : 'ok', _gebaeudeHtml(rows))}
      ${_stufeHtml(3, 'Übernehmen', nUeb ? `${nUeb} Verbraucher würden geändert` : 'nichts zu übernehmen',
        nUeb ? 'offen' : 'leer', _uebernehmenHtml(rows))}
      ${_stufeHtml(4, 'Prüfen', `Σ ${_z0(sumA)} kW in den Verbrauchern`, 'leer', _pruefenHtml(rows))}
    </div>`;
}

// ── Aktionen ──────────────────────────────────────────────────────────────────
export function verbrauchFilter(f) { _filter = f; _stufen[2] = true; verbrauchRender(); }
export function verbrauchUmfang(u) { _umfang = u; verbrauchRender(); }

function _schreiben(rows) {
  for (const r of rows) {
    if (!r.v || r.kw == null) continue;
    if (!r.v.props) r.v.props = {};
    r.v.props.leistungKW = r.kw;
    r.v.props.leistungQuelle = 'schaetzung';
  }
}

function _nachlauf(gIds) {
  _w.markiereVarianteGeaendert?.();
  for (const id of gIds) { try { _w._rerenderCard?.(id); } catch { /* Karte zu */ } }
  _w.renderSidebarAssetList?.();
  _w.elPanelRefreshStatus?.();
  verbrauchRender();
  verbrauchMarkiereKarte();
}

function _transaktion(rows) {
  const run = _w.runPlanningTransaction;
  if (typeof run === 'function') run(UNDO_LABEL, () => _schreiben(rows));
  else _schreiben(rows);
  _undoAt = _w._lastPlanningTransaction?.label === UNDO_LABEL ? _w._lastPlanningTransaction.at : null;
  _nachlauf(rows.map(r => r.g.id));
}

export function verbrauchUebernehmen() {
  const rows = _gebaeudeListe().map(verbrauchGebaeude).filter(r => lastWirdUebernommen(r, _umfang) && r.kw != null);
  if (!rows.length) return;
  _stufen[3] = true;   // dort steht „Rückgängig“
  _transaktion(rows);
  _w.showHint?.(`✓ Schätzung in ${rows.length} Verbraucher übernommen`);
}

export function verbrauchEinzelnUebernehmen(gId) {
  const g = (_w.gebaeude || []).find(x => x.id === gId);
  const r = g && verbrauchGebaeude(g);
  if (!r?.v || r.kw == null) return;
  _aktiv = gId;
  _transaktion([r]);
}

export function verbrauchKwSetzen(gId, wert) {
  const g = (_w.gebaeude || []).find(x => x.id === gId);
  const v = g && _verbraucher(g);
  if (!v) return;
  if (!v.props) v.props = {};
  const kw = parseFloat(String(wert).replace(',', '.'));
  v.props.leistungKW = Number.isFinite(kw) && kw > 0 ? kw : null;
  v.props.leistungQuelle = 'hand';
  _aktiv = gId;
  _undoAt = null;      // Rückgängig würde sonst auch diese Eingabe zurückdrehen
  _nachlauf([gId]);
}

export function verbrauchRueckgaengig() {
  if (!_undoAt || _w._lastPlanningTransaction?.at !== _undoAt) return;
  try { _w.undoLastPlanningTransaction?.(); } catch (e) { console.warn('Rückgängig:', e); }
  _undoAt = null;
  _w.redrawAllAssets?.();
  _nachlauf([]);
}

export function verbrauchZeigeGeb(gId) {
  _aktiv = gId;
  _w.flyTo?.(gId);
  verbrauchRender();
  verbrauchMarkiereKarte();
}

/** Einstieg von der Gebäudekarte: Reiter öffnen, Gebäude markieren. */
export function verbrauchOeffnenFuer(gId) {
  _aktiv = gId ?? _aktiv;
  _stufen[2] = true;
  if (gId != null) _filter = 'alle';
  _w.elTab?.('verbrauch');
  _w.uiSchritt?.('planung', { sparte: 'strom' });
  verbrauchRender();
  if (gId != null) {
    _w.flyTo?.(gId);
    document.querySelector(`#${HOST_ID} tr[data-geb="${gId}"]`)?.scrollIntoView({ block: 'center' });
  }
}

// ── Fehlende Verbraucher anlegen ─────────────────────────────────────────────
// Gebäude ganz ohne Elektro-Assets bekommen die Grundausstattung (13d: UV + Verbraucher),
// sonst nur einen Verbraucher im Gebäude. Kabel zur Verteilung im Gebäude wie bei Dach-PV
// (39 pvAnschlussZiel: UV vor NSHV). Ein Planungsschritt, rückgängig machbar.
export function verbrauchFehlendeAnlegen() {
  const ziele = _gebaeudeListe().filter(g => g.polygon?.length >= 3 && !_verbraucher(g));
  if (!ziele.length) return;
  let n = 0;
  const lauf = () => {
    for (const g of ziele) {
      const hatAssets = (_w.getAssetsForBuilding?.(g.id) || []).length > 0;
      let v = null;
      if (!hatAssets) {
        v = (_w.autoCreateBuildingAssets?.(g) || []).find(a => a.type === 'Verbraucher') || null;
      } else {
        const c = _w.polygonCenter?.(g.polygon);
        if (c) v = _w.createAsset?.('Verbraucher', c.lat, c.lng, { buildingId: g.id, abrissjahr: g.abrissjahr || null, schichtWieGebaeude: true });
      }
      if (!v) continue;
      const z = _w.pvAnschlussZiel?.(v);
      if (z) { try { _w.addStromEdge?.(z.id, v.id); } catch (e) { console.warn('[Verbrauch] Kabel nicht angelegt:', e); } }
      const r = verbrauchGebaeude(g);
      if (r.kw != null) {
        if (!v.props) v.props = {};
        v.props.leistungKW = r.kw;
        v.props.leistungQuelle = 'schaetzung';
      }
      n++;
    }
  };
  if (typeof _w.runPlanningTransaction === 'function') _w.runPlanningTransaction('Verbraucher anlegen', lauf);
  else lauf();
  _undoAt = _w._lastPlanningTransaction?.label === 'Verbraucher anlegen' ? _w._lastPlanningTransaction.at : null;
  _stufen[3] = true;
  _w.redrawAllAssets?.();
  _nachlauf(ziele.map(g => g.id));
  _w.showHint?.(`✓ ${n} Verbraucher angelegt und mit der Schätzung belegt`);
}

// ── Kartenfärbung nach Stand (solange der Reiter offen ist) ──────────────────
const KARTE_FARBE = { ok: '#4caf50', offen: '#f9a825', geschuetzt: '#4fc3f7', leer: '#9e9e9e' };

/** Reiter auf/zu: Färbung an bzw. Karte über updateViz zurücksetzen. */
export function verbrauchKarte(an) {
  const war = !!_w.verbrauchKarteAn;
  _w.verbrauchKarteAn = !!an;
  if (an) { verbrauchRender(); verbrauchMarkiereKarte(); }
  else if (war) _w.updateViz?.();
}

export function verbrauchMarkiereKarte() {
  if (!_w.verbrauchKarteAn) return;
  for (const g of (_w.gebaeude || [])) {
    if (!g.polygonLayer) continue;
    const z = ZUSTAND[verbrauchGebaeude(g).zustand];
    const farbe = KARTE_FARBE[z.cls] || KARTE_FARBE.leer;
    const ist = g.id === _aktiv;
    g.polygonLayer.setStyle({
      color: farbe, weight: ist ? 3 : 1.6, dashArray: z.cls === 'leer' ? '4 4' : '',
      fillColor: farbe, fillOpacity: ist ? 0.28 : 0.14,
    });
    if (ist) g.polygonLayer.bringToFront();
  }
}

/** Kurzzeile für die Gebäudekarte (03c). */
export function verbrauchVerweisHtml(g) {
  const r = verbrauchGebaeude(g);
  const z = ZUSTAND[r.zustand];
  const kw = r.assetKw != null ? `${_z1(r.assetKw)} kW` : r.kw != null ? `~${_z1(r.kw)} kW geschätzt` : 'keine Schätzung';
  const e = r.energieMwh != null ? ` · ${_z1(r.energieMwh)} MWh/a` : '';
  return `
    <div class="geb-pv-verweis">
      <span class="geb-pv-verweis-icon" style="color:var(--c-blue);">⚡</span>
      <span class="geb-pv-verweis-text" title="${_esc(z.text)}">Last: ${kw}${e}</span>
      <button class="btn-xs" data-click="verbrauchOeffnenFuer(${g.id})"
        title="Lastschätzung und Leistung des Verbrauchers im Reiter Planung › Strom › Verbrauch">Verbrauch →</button>
    </div>`;
}

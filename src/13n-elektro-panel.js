// ── 13n-elektro-panel.js — Elektro-Panel dynamisch aufbauen ─────────────────
// Generiert den gesamten HTML-Inhalt des Elektro-Tabs und injiziert ihn in
// #lp-elektro. Einmalig beim ersten Öffnen des Tabs aufgerufen.
//
// Aufbau (Oberfläche LKEBw):
//   • Karte „Nächster Schritt“ (#el-fuehrung) — Status Netz · Rechnung · Zustand und
//     genau die Aktion, die jetzt dran ist. Wird von elPanelRefreshStatus() befüllt.
//   • vier Reiter in Arbeitsreihenfolge: Netz · Erzeugung · Berechnen · Prüfen.
//     Die Reiter selbst stehen im Kopf des Arbeitsbereichs (src/49-oberflaeche.js),
//     hier liegen die Bereiche (data-el-tab) mit den alten Abschnitts-IDs
//     (el-sec-netz, el-sec-anlagen, el-sec-calc, el-sec-auswerten), auf die der
//     Geführte Modus und andere Module zugreifen.
//   • zerstörende Aktionen nur unter „Aufräumen“ (eingeklappt), Fachparameter unter
//     „Berechnungsannahmen“ und „Kostenkennwerte“ (eingeklappt).

import { isErzeugerAktiv } from './06c-dispatch-core.js';
import { lwWp, bhkw, gebaeude } from './01-globals-varianten.js';
import { getBatParams } from './09a-pv-profile.js';
import { kabelTypOptionen } from './config/netz-kosten.js';

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function _inp(id, label, value, { min = 0, max, step = 1, change = '', title = '' } = {}) {
  const maxA  = max != null ? `max="${max}"` : '';
  const chgA  = change ? `data-change="${change}"` : '';
  const tipA  = title  ? `title="${title}"` : '';
  return `<div class="inp-group">
    <label class="inp-label" for="${id}">${label}</label>
    <input class="inp-field" id="${id}" type="number" value="${value}" min="${min}" ${maxA} step="${step}" ${chgA} ${tipA}/>
  </div>`;
}

function _stat(label, id, tip = '') {
  const tipH = tip ? ` <span class="htip" data-tip="${tip}">?</span>` : '';
  return `<div class="lp-netz-row"><span class="lbl">${label}${tipH}</span><span class="val" id="${id}">—</span></div>`;
}

// Zeile einer Aufgabenliste: Symbol, Titel, Kurzbeschreibung, Pfeil
const _ic = (id) => `<svg class="ui-i"><use href="#ui-i-${id}"/></svg>`;
const _aufgabe = (titel, text, click, { id = '', icon = 'chev', title = '', klasse = '' } = {}) =>
  `<button class="ui-aufgabe${klasse ? ' ' + klasse : ''}"${id ? ` id="${id}"` : ''} data-click="${click}"${title ? ` title="${title}"` : ''}>
    ${_ic(icon)}<span><b>${titel}</b><small>${text}</small></span><svg class="ui-i ui-i-sm"><use href="#ui-i-chev"/></svg></button>`;

// Werkzeug-Knopf (zeichnet auf der Karte) mit Farbtupfer = Linienfarbe auf der Karte
const _sw = (color) => `<span class="lp-btn-swatch" style="--sw:${color}"></span>`;
const _werkzeug = (label, click, { id = '', title = '', swatch = '', klasse = '' } = {}) =>
  `<button class="btn-secondary el-werkzeug${klasse ? ' ' + klasse : ''}"${id ? ` id="${id}"` : ''} data-click="${click}"${title ? ` title="${title}"` : ''}>${swatch ? _sw(swatch) : ''}${label}</button>`;

const _gruppe = (titel, inhalt, hinweis = '') =>
  `<div class="ui-gruppe"><div class="ui-gruppe-titel">${titel}</div>${hinweis ? `<p class="el-hinweis">${hinweis}</p>` : ''}${inhalt}</div>`;

const _mehr = (titel, inhalt, { id = '', offen = false } = {}) =>
  `<details class="el-mehr"${offen ? ' open' : ''}><summary>${_ic('chev')}${titel}</summary><div class="el-mehr-in"${id ? ` id="${id}"` : ''}>${inhalt}</div></details>`;

// ── Panel-HTML ────────────────────────────────────────────────────────────────

function _html() { return `

  <!-- Nächster Schritt: Status + passende Aktion — von elPanelRefreshStatus() befüllt -->
  <div id="el-fuehrung" class="el-fuehrung">
    <div id="el-status-strip" class="el-status-strip"></div>
    <div id="el-naechster" class="el-naechster"></div>
  </div>

  <!-- ═══ Reiter 1 · Netz ═══════════════════════════════════════════════════ -->
  <section id="el-sec-netz" class="el-pane" data-el-tab="netz">
    ${_gruppe('Schnellstart', `
      ${_aufgabe('Netz automatisch erzeugen', 'Stationen und Kabel aus Gebäuden und Trassen vorschlagen lassen', 'showAutoNetzDialog()', { icon: 'play', title: 'Stromnetz automatisch erzeugen' })}
      ${_aufgabe('Standardgebäude platzieren', 'Trafostation, Übergabestation, Speicher, Ladepark mit fertiger Ausstattung', 'showKompaktstationDialog()', { icon: 'plus',
        title: 'Standardgebäude (Trafostation, Übergabestation, Batteriespeicher, NEA, Energiezentrale, Ladepark) mit fertiger Elektro-Ausstattung per Klick platzieren' })}
      ${_aufgabe('Bestandsplan digitalisieren', 'Einlinienplan als Bild oder PDF laden und nachzeichnen', 'pdTogglePanel()', { id: 'btn-pd-toggle', icon: 'doc',
        title: 'Bestands-Einlinienplan (Bild/PDF) laden und darauf klickend digitalisieren: Knoten mit Gebäuden verknüpfen, Kabel nachziehen — Geometrie und Länge kommen aus dem Trassenrouting' })}`)}

    ${_gruppe('1 · Trassen', `
      <div class="el-werkzeuge">
        ${_werkzeug('Trasse zeichnen', "toggleDrawTrasse('strom')", { id: 'btn-draw-trasse', swatch: '#ff9800', title: 'Trassenverlauf auf der Karte zeichnen' })}
        ${_werkzeug('Straßen aus OSM', 'loadAndAdoptOsmStrassen()', { id: 'btn-schnellstart-osm', title: 'Straßen aus OpenStreetMap laden und direkt als Trassen übernehmen' })}
        ${_werkzeug('OSM-Straßen ein/aus', 'toggleOsmStrassenVisible()', { id: 'btn-osm-strassen-toggle', klasse: 'el-werkzeug-klein' })}
      </div>`, 'Kabel folgen den Trassen. Ohne Trassen werden sie gerade gezogen.')}

    ${_gruppe('2 · Komponenten', `<div id="asset-palette" class="asset-palette-inline"></div>`,
      'Typ wählen, dann auf die Karte klicken. Erzeugung und Speicher stehen im Reiter Erzeugung.')}

    ${_gruppe('3 · Kabel', `
      <div class="el-werkzeuge">
        ${_werkzeug('Kabel ziehen', 'startDrawStromEdge()', { id: 'btn-draw-strom-edge', swatch: '#fdd835', title: 'Kabel zwischen zwei Komponenten ziehen' })}
        ${_werkzeug('Kabel neu ausrichten', 'realignAllStromKabel()',
          { title: 'Verlauf und Länge aller bestehenden Kabel neu entlang der aktuellen Trassen berechnen (Elektro- und gezeichnete Wärmetrassen) — z. B. nach nachträglich gezeichneten oder korrigierten Trassen' })}
      </div>`, 'Zwei Komponenten nacheinander anklicken.')}

    ${_mehr('Aufräumen', `
      <div class="el-werkzeuge">
        ${_werkzeug('OSM-Straßen löschen', 'clearOsmStrassen()', { klasse: 'btn-danger' })}
        ${_werkzeug('Alle Elektro-Trassen löschen', 'clearAllStromTrassen()', { klasse: 'btn-danger',
          title: 'Alle gezeichneten und aus OSM übernommenen Elektro-Trassenabschnitte auf einmal entfernen — Wärmetrassen bleiben erhalten' })}
      </div>`)}
  </section>

  <!-- ═══ Reiter 2 · Erzeugung ══════════════════════════════════════════════ -->
  <section id="el-sec-anlagen" class="el-pane" data-el-tab="erzeugung" hidden>
    ${_gruppe('Anlagen setzen', `<div id="asset-palette-erz" class="asset-palette-inline"></div>`,
      'PV, Wind, Batterie, Notstrom: Typ wählen, dann auf die Karte klicken.')}

    ${_gruppe('PV-Freiflächen', `
      <div class="el-werkzeuge">
        ${_werkzeug('Freifläche zeichnen', 'startDrawFF()', { id: 'el-btn-ff-draw', swatch: '#ffd54f',
          title: 'PV-Freifläche auf der Karte einzeichnen (Klick auf Eckpunkte, Doppelklick zum Abschluss)' })}
        ${_werkzeug('Abbrechen', 'cancelDrawFF()', { id: 'el-btn-ff-cancel', klasse: 'btn-danger' }).replace('<button', '<button style="display:none;"')}
      </div>
      <div id="el-ff-list" class="el-ff-list"></div>
      <div id="el-ff-total" class="el-ff-total" style="display:none;">
        <span>Gesamt</span><b id="el-ff-total-kwp">—</b>
        <span>Ertrag</span><b id="el-ff-total-mwh">—</b>
      </div>`)}

    ${_gruppe('Aus der Wärmeplanung', `
      <p class="el-hinweis">Wärmepumpen, BHKW, PV und Batterie aus der Wärmeplanung wirken automatisch in der Strombilanz. Sie werden dort bearbeitet.</p>
      <div id="el-gekoppelt-status" class="el-chips"></div>
      ${_aufgabe('In der Wärmeplanung bearbeiten', 'Erzeuger und Speicher der Heizzentrale', "uiSchritt('planung',{sparte:'waerme'}); uiWaermeTab('erzeuger')", { icon: 'arrow' })}
      ${_aufgabe('Verbrauch und PV automatisch ermitteln', 'Strombedarf der Gebäude und PV-Potenzial vorschlagen', 'showAutofillWizard()', { icon: 'calc',
        title: 'Verbrauchs- und PV-Werte automatisch ermitteln' })}`)}

    ${_gruppe('Prüfen', `
      ${_aufgabe('PV-Übersicht', 'Gezeichnete PV-Flächen gegen die kWp der Anlagen abgleichen', 'pvuTogglePanel()', { id: 'btn-pv-uebersicht-toggle', icon: 'list' })}
      ${_aufgabe('Windanalyse', 'Ertrag, Abstände, Eignungsfläche und Szenarien der Windkraftanlagen', 'windaTogglePanel()', { id: 'btn-windanalyse-toggle', icon: 'chart' })}`)}
  </section>

  <!-- ═══ Reiter 3 · Berechnen ══════════════════════════════════════════════ -->
  <section id="el-sec-calc" class="el-pane" data-el-tab="berechnen" hidden>
    <button class="btn-confirm el-rechnen" data-click="elCalcAssets()"
      title="Elektrische Auslastungsberechnung für alle Stromnetz-Komponenten">
      ${_ic('play')}Elektroberechnung starten
    </button>
    <div id="el-kpi-tiles" class="el-kpi-tiles"></div>
    <div id="lp-el-calc-result" class="el-calc-result" style="display:none;"></div>

    ${_gruppe('Karte einfärben nach', `
      <div id="lp-strom-viz">
        <div class="lp-tool-grid el-farben">
          <button class="lp-tool-btn lp-btn-tile" data-colormode="auslastung" data-click="setStromColorMode('auslastung')" title="Kabel nach Auslastung in % einfärben (grün = gering, rot = überlastet)">Auslastung</button>
          <button class="lp-tool-btn lp-btn-tile" data-colormode="spannungsfall" data-click="setStromColorMode('spannungsfall')" title="Kabel nach Spannungsfall ΔU in % einfärben">Spannungsfall</button>
          <button class="lp-tool-btn lp-btn-tile" data-colormode="leistung" data-click="setStromColorMode('leistung')" title="Kabel nach übertragener Leistung (kW) einfärben">Leistung</button>
          <button class="lp-tool-btn lp-btn-tile" data-colormode="richtung" data-click="setStromColorMode('richtung')" title="Kabel nach Leistungsflussrichtung einfärben (Bezug vs. Einspeisung)">Flussrichtung</button>
          <button class="lp-tool-btn lp-btn-tile el-farben-breit" id="btn-engpass-analyse" data-colormode="engpassjahr" data-click="engpassAnalyseStarten()"
            title="Rechnet das Netz über die kommenden Jahre durch und färbt die Kabel danach ein, WANN sie zum Engpass werden (Strombelastbarkeit oder kumulierter Spannungsfall).">
            Jahr des Engpasses (rechnet alle Jahre)
          </button>
        </div>
        <div id="lp-engpass-legende" style="display:none;margin-top:6px;"></div>
        <label class="el-check"><input type="checkbox" id="strom-dynamic-viz" data-change="setStromDynamicViz(this.checked)"/> Leistungsfluss animieren</label>
        <label class="el-check"><input type="checkbox" id="strom-netz-visible" checked data-change="setStromNetzVisible(this.checked)"/> Stromnetz auf der Karte zeigen</label>
      </div>`)}

    ${_mehr('Kennwerte der Rechnung', `
      <div id="lp-strom-info" class="lp-netz-summary">
        ${_stat('Szenario-Stunde',  'lp-strom-sz-hour')}
        ${_stat('Gesamtlast',       'lp-strom-last')}
        ${_stat('Einspeisung',      'lp-strom-einsp')}
        ${_stat('Trafo-Auslastung', 'lp-strom-trafo-ausl')}
        ${_stat('Krit. Spannungsfall', 'lp-strom-delta-u')}
        ${_stat('Min. Ik\'\'', 'lp-strom-ik-min',
          'Minimaler Anfangs-Kurzschlusswechselstrom (IEC 60909, c=0.95). Maßgeblich für Schutzselektivität.')}
        ${_stat('Iz-Korrekturfaktor', 'lp-strom-kiz',
          'Kombinierter Faktor aus Temperatur, Häufung und Verlegeart (IEC 60364-5-52).')}
        ${_stat('Kabellänge',   'lp-strom-kabel-len')}
        ${_stat('Komponenten',  'lp-strom-komp')}
      </div>`)}

    ${_mehr('Berechnungsannahmen', `
      <div id="lp-strom-param" class="el-raster">
        <div class="inp-group el-voll">
          <label class="inp-label" for="strom-kabel-typ">Kabeltyp</label>
          <select class="inp-field" id="strom-kabel-typ">${kabelTypOptionen('NYY', ['ns'])}</select>
        </div>
        ${_inp('strom-ns-cosphi', 'cos φ Niederspannung', '0.95',
          { min:0.70, max:1.00, step:0.01, change:'recalcStromNetz()', title:'Leistungsfaktor NS-Netz (typ. 0,95)' })}
        ${_inp('strom-ms-cosphi', 'cos φ Mittelspannung', '0.90',
          { min:0.70, max:1.00, step:0.01, change:'recalcStromNetz()', title:'Leistungsfaktor MS-Ring (typ. 0,90)' })}
        ${_inp('strom-leiter-temp', 'Leitertemperatur (°C)', '70',
          { min:20, max:90, step:5, change:'recalcStromNetz()', title:'Betriebstemperatur — NAYY/NYY max. 70 °C' })}
        <div class="inp-group">
          <label class="inp-label" for="strom-gzf-methode">Gleichzeitigkeit</label>
          <select class="inp-field" id="strom-gzf-methode"
            data-change="document.getElementById('strom-gzf-manuell-wrap').style.display=this.value==='manuell'?'':'none'; recalcStromNetz()">
            <option value="din18015">DIN 18015-1 (Tabelle)</option>
            <option value="vde">VDE (1/n^0.4)</option>
            <option value="manuell">Manuell</option>
            <option value="keine">Keine (Σ-Last)</option>
          </select>
        </div>
        <div id="strom-gzf-manuell-wrap" class="el-voll" style="display:none;">
          ${_inp('strom-gzf-manuell', 'Gleichzeitigkeitsfaktor manuell', '0.6',
            { min:0.1, max:1.0, step:0.05, change:'recalcStromNetz()' })}
        </div>
        <div class="ui-gruppe-unter el-voll">Strombelastbarkeit (IEC 60364-5-52)</div>
        ${_inp('strom-iz-tboden', 'Bodentemperatur (°C)', '20',
          { min:-5, max:50, step:5, change:'recalcStromNetz()', title:'Für Iz-Temperaturkorrektur (kT). Referenz: 20 °C' })}
        ${_inp('strom-iz-nkabel', 'Häufung (Kabel)', '1',
          { min:1, max:20, step:1, change:'recalcStromNetz()', title:'Parallel verlegte Kabel (kG, IEC 60364-5-52 Tab. B.52.17)' })}
        <div class="inp-group el-voll">
          <label class="inp-label" for="strom-iz-verlegeart">Verlegeart</label>
          <select class="inp-field" id="strom-iz-verlegeart" data-change="recalcStromNetz()">
            <option value="erde">Erdverlegung direkt (D1) — Standard</option>
            <option value="luft">Freiluft, freie Luft (E/F) ×1.20</option>
            <option value="kanal">Kabelkanal in Erde (D2) ×0.87</option>
            <option value="rohr">Rohr in Wand/Beton (B1) ×0.77</option>
          </select>
        </div>
      </div>`)}

    ${_mehr('Kostenkennwerte', `
      <div id="lp-strom-kosten">
        <div class="ui-gruppe-unter">Netzinfrastruktur</div>
        <div class="el-raster">
          ${_inp('strom-k-tiefbau', 'Tiefbau (€/m)',       '100',  { min:0, step:10,  change:'recalcStromNetz()' })}
          ${_inp('strom-k-nap',     'NAP-Pauschale (€)',    '3000', { min:0, step:500, change:'recalcStromNetz()' })}
          ${_inp('strom-k-trafo',   'Trafo (€/kVA)',        '60',   { min:0, step:10,  change:'recalcStromNetz()' })}
          ${_inp('strom-k-nd',      'Nutzungsdauer (a)',    '40',   { min:1, max:60, step:5, change:'recalcStromNetz()' })}
        </div>
        <div class="ui-gruppe-unter">Anlagen</div>
        <div class="el-raster">
          ${_inp('ak-pv-kwp',    'PV (€/kWp)',          '1200', { min:0, step:100 })}
          ${_inp('ak-trafo-kva', 'Trafo (€/kVA)',        '80',   { min:0, step:10  })}
          ${_inp('ak-bat-kwh',   'Batterie (€/kWh)',     '600',  { min:0, step:50  })}
          ${_inp('ak-wp-kw',     'WP (€/kW)',            '700',  { min:0, step:50  })}
          ${_inp('ak-lade-pkt',  'Ladestation (€/Pkt.)', '1500', { min:0, step:100 })}
          ${_inp('ak-kwk-kwel',  'KWK (€/kWel)',         '3500', { min:0, step:100 })}
          ${_inp('ak-wind-kw',   'Wind (€/kW)',           '1500', { min:0, step:100 })}
          ${_inp('ak-nap',       'NAP (€ pauschal)',      '8000', { min:0, step:500 })}
          ${_inp('ak-nshv-abg',  'NSHV (€/Abgang)',       '500',  { min:0, step:50  })}
          ${_inp('ak-uv-abg',    'UV (€/Abgang)',          '200',  { min:0, step:50  })}
          ${_inp('ak-kvs-abg',   'KVS (€/Abgang)',         '150',  { min:0, step:25  })}
        </div>
        <div class="el-kosten">
          <div><span>Investition</span><b id="strom-kpi-invest">—</b></div>
          <div><span>Annuität pro Jahr</span><b id="strom-kpi-annuitaet">—</b></div>
          <small id="strom-kpi-detail"></small>
        </div>
      </div>`)}
  </section>

  <!-- ═══ Reiter 4 · Prüfen ═════════════════════════════════════════════════ -->
  <section id="el-sec-auswerten" class="el-pane" data-el-tab="pruefen" hidden>
    ${_gruppe('Ergebnis ansehen', `
      ${_aufgabe('Ergebnisblatt', 'Alle Rechenergebnisse mit Nachweisen, Tabellen, Kosten und Annahmen', 'ergebnisblattToggle()', { id: 'btn-ergebnisblatt-toggle', icon: 'doc',
        title: 'Vollständige Rechenergebnisse: Kennzahlen, Grenzwertnachweis, Kabel- und Knotentabellen, Mengengerüst, Kosten und alle Annahmen — druckbar und als CSV' })}
      ${_aufgabe('Einlinienschema', 'Das Stromnetz als Schaltbild', 'sldToggle()', { id: 'btn-sld-toggle', icon: 'pulse' })}
      ${_aufgabe('Netzanalyse', 'Auslastung, Spannungsfall und Schwachstellen', 'naTogglePanel()', { id: 'btn-netzanalyse-toggle', icon: 'chart' })}
      ${_aufgabe('Knotenanalyse', 'Last und Spannung an einzelnen Knoten über das Jahr', 'openKnotenanalyse()', { icon: 'circle' })}`)}

    ${_gruppe('Zukunft und Netzanschluss', `
      ${_aufgabe('Engpass-Fahrplan', 'Wann wird was zum Engpass, mit Ertüchtigungs-Maßnahmen', 'engpassPanelToggle()', { id: 'btn-engpass-panel-toggle', icon: 'chart',
        title: 'Zeitstrahl der Engpässe, Reserve-Kurve und automatisch abgeleitete Ertüchtigungs-Maßnahmen' })}
      ${_aufgabe('Netzanschluss', 'Reicht die vereinbarte Leistung? Ebenen und Wege zum Umspannwerk', 'naModulToggle()', { id: 'btn-na-modul-toggle', icon: 'pulse',
        title: 'Reicht der heutige Netzanschluss? Bedarf je Jahr gegen die vereinbarte Leistung, typische Anschlussebene, Wege bis zum Direktanschluss an ein Umspannwerk, Textbaustein und Leistungstabelle' })}
      ${_aufgabe('Schwellentreppe', 'Trägt das Bestandsnetz die geplante Erzeugung je Variante?', 'schwellenPanelToggle()', { id: 'btn-schwellen-panel-toggle', icon: 'list',
        title: 'Screening je Variante: trägt das Bestandsnetz die geplante Erzeugung, oder lohnt ein eigenes Erzeugungsnetz?' })}`)}

    ${_gruppe('Resilienz', `
      ${_aufgabe('Blackout-Modus', 'Notstromberechtigte Gebäude festlegen und Notstromlast bilanzieren', 'blackoutModusToggle()', { id: 'btn-blackout-modus-toggle', icon: 'alert' })}
      ${_aufgabe('Resilienz-Abfrage', 'Fragebogen für die zuständige Stelle erzeugen und einlesen', 'raPanelToggle()', { id: 'btn-resilienz-abfrage-toggle', icon: 'table',
        title: 'Abfragedatei (.xlsx) für die zuständige Stelle erzeugen, ausgefüllt wieder einlesen und in Resilienzanforderungen übersetzen' })}`)}

    ${_gruppe('Prüfen und vergleichen', `
      ${_aufgabe('Bestand prüfen', 'Kabellängen, Querschnitte, Topologie und Lebenszyklus', 'bestandPanelToggle()', { id: 'btn-bestand-panel-toggle', icon: 'check',
        title: 'Plausibilität des Bestands prüfen: Kabellängen, Querschnitte, Topologie, Lebenszyklus — und welche Analyse der aktuelle Datenstand trägt' })}
      ${_aufgabe('Varianten vergleichen', 'Planungsentscheidungen aller Varianten nebeneinander', 'variantenVergleichToggle()', { id: 'btn-varianten-vergleich-toggle', icon: 'table' })}`)}

    ${_gruppe('Exportieren', `
      ${_aufgabe('Maßnahmenbericht (PDF)', 'Alle Elektro-Maßnahmen als Bericht', 'exportMassnahmenPDF()', { icon: 'export' })}
      ${_aufgabe('Investitionsplan', 'Investitionen nach Jahren', 'showInvestitionsplan()', { icon: 'list' })}`)}
  </section>
`; }

// ── Status-Chip der gekoppelten Anlagen ─────────────────────────────────────────
// Spiegelt den Aktiv-Status der stromrelevanten Erzeuger aus der Wärmeplanung.
// Jede Abfrage defensiv gekapselt — fehlende Quelle ⇒ „—" statt Fehler.
export function renderGekoppelteStatus() {
  const box = document.getElementById('el-gekoppelt-status');
  if (!box) return;
  const safe = (fn, d = false) => { try { return fn(); } catch (e) { return d; } };
  const kw = (v) => (v != null && isFinite(v)) ? Math.round(v) : null;
  const chip = (label, info) => `<span class="el-chip">${label}${info ? ` <b>${info}</b>` : ''}</span>`;

  const chips = [];
  if (safe(() => isErzeugerAktiv('lwwp'))) chips.push(chip('Luft-WP', kw(lwWp?.leistung) != null ? `${kw(lwWp.leistung)} kW` : ''));
  if (safe(() => isErzeugerAktiv('geo')))         chips.push(chip('Geothermie', ''));
  if (safe(() => isErzeugerAktiv('fg')))          chips.push(chip('Fließgewässer-WP', ''));
  if (safe(() => isErzeugerAktiv('bhkw')))        chips.push(chip('BHKW', kw(bhkw?.leistung) != null ? `${kw(bhkw.leistung)} kW` : ''));
  if (safe(() => isErzeugerAktiv('stromkessel'))) chips.push(chip('Stromkessel', ''));
  const pvKwp = safe(() => parseFloat(document.getElementById('pv-kwp')?.value) || 0, 0);
  if (pvKwp > 0) chips.push(chip('PV', `${kw(pvKwp)} kWp`));
  if (safe(() => Array.isArray(gebaeude) && gebaeude.some(g => g.pvAktiv))) chips.push(chip('Gebäude-PV', ''));
  const bat = safe(() => (typeof getBatParams === 'function') ? getBatParams() : null, null);
  if (bat) chips.push(chip('Batterie', kw(bat.kapKwh) != null ? `${kw(bat.kapKwh)} kWh` : ''));

  box.innerHTML = chips.length
    ? chips.join('')
    : '<span class="el-hinweis">Keine Anlagen aus der Wärmeplanung aktiv.</span>';
}

// ── Reiter ────────────────────────────────────────────────────────────────────
// Reiter-Leiste steht im Kopf des Arbeitsbereichs (49-oberflaeche); hier werden
// nur die Bereiche umgeschaltet. Zustand bleibt im Browser gespeichert.
export const EL_TABS = [
  { id: 'netz',      titel: 'Netz' },
  { id: 'erzeugung', titel: 'Erzeugung' },
  { id: 'berechnen', titel: 'Berechnen' },
  { id: 'pruefen',   titel: 'Prüfen' },
];
const _TAB_KEY = 'micke.el.tab';
let _tab = null;

function _hatStromAssets() {
  return (window.ASSETS?.items || []).some(a => a.domain === 'strom' || a.domain === 'hybrid');
}

export function elTabAktiv() {
  if (_tab) return _tab;
  try { _tab = localStorage.getItem(_TAB_KEY); } catch (e) { /* ohne Speicher */ }
  if (!EL_TABS.some(t => t.id === _tab)) _tab = _hatStromAssets() ? 'berechnen' : 'netz';
  return _tab;
}

export function elTab(id) {
  if (!EL_TABS.some(t => t.id === id)) return;
  _tab = id;
  try { localStorage.setItem(_TAB_KEY, id); } catch (e) { /* optional */ }
  document.querySelectorAll('#lp-elektro .el-pane').forEach(p => { p.hidden = p.dataset.elTab !== id; });
  window.uiLpKopfAktualisieren?.();
}

// ── Statusleiste & Ergebnis-Kacheln ───────────────────────────────────────────
// Ob das Ergebnis auf der Karte noch zum Netz passt, wird über eine Signatur des
// Rechen-Inputs beantwortet statt über Hooks an jeder Mutationsstelle. Das
// erfasst auch Änderungen, die an keinem Handler hängen: Variantenwechsel,
// Jahresschieber, Projekt-Import.

let _calcStamp = null; // { sig, t } der letzten sichtbaren Elektroberechnung

const _PARAM_IDS = [
  'strom-kabel-typ', 'strom-ns-cosphi', 'strom-ms-cosphi', 'strom-leiter-temp',
  'strom-gzf-methode', 'strom-gzf-manuell',
  'strom-iz-tboden', 'strom-iz-nkabel', 'strom-iz-verlegeart',
];

function _hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Auf grossen Projekten (Tausende Gebaeude) kostet die Signatur ~20 ms. Weil
// recalcStromNetz in Schueben feuert, wird sie kurz gepuffert — force=true
// erzwingt einen frischen Wert, wenn eine Rechnung gestempelt wird.
let _sigCache = { t: 0, v: '' };

function _netzSignatur(force = false) {
  if (!force && Date.now() - _sigCache.t < 400) return _sigCache.v;
  const p = [`v=${window.activeVariantId ?? '-'}`, `j=${window.globalYear ?? '-'}`];
  for (const a of (window.ASSETS?.items || [])) {
    if (a.domain !== 'strom' && a.domain !== 'hybrid') continue;
    p.push(`${a.id}:${a.type}:${a.baujahr ?? ''}:${a.abrissjahr ?? ''}:${a.schicht ?? ''}:${JSON.stringify(a.props ?? {})}:${(a.massnahmen || []).map(m => m.status).join(',')}`);
  }
  for (const e of (window.stromEdges || [])) {
    p.push(`${e.id}:${e.u}>${e.v}:${Math.round(e.lengthM || 0)}:${e.cableType ?? ''}:${e.crossSection ?? ''}:${e.nParallel ?? ''}:${e.baujahr ?? ''}:${e.abrissjahr ?? ''}`);
  }
  // Der Strombedarf der Gebäude geht direkt in die Last ein
  for (const g of (window.gebaeude || [])) {
    p.push(`${g.id}:${g.strom ?? ''}:${g.pvAktiv ? 1 : 0}:${g.pvKwp ?? ''}`);
  }
  for (const id of _PARAM_IDS) p.push(`${id}=${document.getElementById(id)?.value ?? ''}`);
  _sigCache = { t: Date.now(), v: _hash(p.join('|')) };
  return _sigCache.v;
}

function _seit(t) {
  const sek = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sek < 60) return 'gerade eben';
  const min = Math.round(sek / 60);
  return min < 60 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`;
}

const _chip = (label, value, state, title) =>
  `<div class="el-status-chip ${state}"${title ? ` title="${title}"` : ''}>
     <span class="el-chip-label">${label}</span><span class="el-chip-value">${value}</span>
   </div>`;

const _kpi = (label, value, stufe) =>
  `<div class="el-kpi${stufe ? ' is-' + stufe : ''}"><span class="el-kpi-label">${label}</span><span class="el-kpi-value">${value}</span></div>`;

// Karte „Nächster Schritt“: ein Satz, was jetzt dran ist, und höchstens zwei Knöpfe
const _naechster = (stufe, titel, text, knoepfe = []) =>
  `<div class="el-naechster-in" data-stufe="${stufe}">
     <div><b>${titel}</b><small>${text}</small></div>
     <div class="el-naechster-knoepfe">${knoepfe.map(([label, click, primaer]) =>
       `<button class="${primaer ? 'btn-confirm' : 'btn-secondary'}" data-click="${click}">${label}</button>`).join('')}</div>
   </div>`;

// Markiert die letzte Rechnung als aktuell — aufgerufen am Ende von elCalcAssets().
export function elMarkCalcDone() {
  _calcStamp = { sig: _netzSignatur(true), t: Date.now() };
  elPanelRefreshStatus();
}

/**
 * Stand der letzten sichtbaren Elektroberechnung — für Panels, die ein
 * Ergebnis anzeigen und dazusagen müssen, ob es noch zum Netz passt.
 * @returns {{t:number, frisch:boolean}|null} null = in dieser Sitzung nie gerechnet
 */
export function elCalcStand() {
  if (!_calcStamp) return null;
  return { t: _calcStamp.t, frisch: _calcStamp.sig === _netzSignatur() };
}

export function elPanelRefreshStatus() {
  // Der Refresh haengt an jedem recalcStromNetz. Ist das Panel nicht gebaut
  // oder der Tab nicht offen, kostet die Signatur unnoetig Zeit — beim
  // Zurueckwechseln ruft setLeftTab() ohnehin neu auf.
  if (!document.getElementById('lp-elektro')?.classList.contains('active')) return;
  const strip = document.getElementById('el-status-strip');
  const tiles = document.getElementById('el-kpi-tiles');
  const naechster = document.getElementById('el-naechster');
  if (!strip && !tiles && !naechster) return;

  const assets = (window.ASSETS?.items || []).filter(a => a.domain === 'strom' || a.domain === 'hybrid');
  const edges  = window.stromEdges || [];
  const frisch = !!_calcStamp && _calcStamp.sig === _netzSignatur();
  const nAsset = _calcStamp ? assets.filter(a => (a._calcPeakLoadPct || 0) > 100).length : 0;
  const nKabel = _calcStamp ? edges.filter(e => (e.auslastungPct || 0) > 100).length : 0;
  const nUeber = nAsset + nKabel;

  if (strip) {
    // 1 · Netz
    const nStat = assets.filter(a => ['NAP', 'Trafo', 'NSHV', 'Schaltanlage'].includes(a.type)).length;
    let netzState = 'is-ok';
    let netzVal   = `${nStat} Stat. · ${edges.length} Kabel`;
    if (!nStat)             { netzState = 'is-idle'; netzVal = 'leer'; }
    else if (!edges.length) { netzState = 'is-warn'; netzVal = `${nStat} Stat. · 0 Kabel`; }

    // 2 · Rechnung
    let calcState = 'is-idle';
    let calcVal   = 'offen';
    let calcTip   = 'Noch keine Elektroberechnung in dieser Sitzung.';
    if (_calcStamp && frisch) {
      calcState = 'is-ok';
      calcVal   = 'aktuell';
      calcTip   = `Zuletzt gerechnet ${_seit(_calcStamp.t)}.`;
    } else if (_calcStamp) {
      calcState = 'is-warn';
      calcVal   = 'veraltet';
      calcTip   = `Netz oder Parameter haben sich seit der Rechnung (${_seit(_calcStamp.t)}) geändert.`;
    }

    // 3 · Zustand — Überlastungen aus der letzten Rechnung
    let zuState = 'is-idle';
    let zuVal   = '—';
    let zuTip   = 'Erst rechnen, dann steht hier die Zahl der Überlastungen.';
    if (_calcStamp) {
      zuState = nUeber ? 'is-bad' : 'is-ok';
      zuVal   = nUeber ? `${nUeber} überlastet` : 'keine Überlast';
      zuTip   = nUeber
        ? `${nAsset} Komponente(n) und ${nKabel} Kabel über 100 % Auslastung.`
        : 'Keine Komponente und kein Kabel über 100 % Auslastung.';
      if (!frisch) zuTip += ' Stand der letzten Rechnung.';
    }

    const html =
      _chip('Netz', netzVal, netzState,
        `${nStat} einspeisende Stationen (NAP, Trafo, NSHV, Schaltanlage), ${assets.length} Komponenten insgesamt und ${edges.length} Kabel im aktuellen Jahres- und Variantenstand.`) +
      _chip('Rechnung', calcVal, calcState, calcTip) +
      _chip('Zustand', zuVal, zuState, zuTip);
    if (strip.innerHTML !== html) strip.innerHTML = html;
  }

  if (naechster) {
    // Gebäude bringen automatisch Unterverteilung + Verbraucher mit (13d) — ein Netz
    // entsteht erst mit der Kette Netzanschlusspunkt → Schaltanlage → Trafo. Dieselbe
    // Prüfung nutzt das Auto-Netz (13l); so bietet die Karte nie einen Knopf an, der scheitert.
    const vor = window.autoNetzVoraussetzungen?.() || { ok: true, fehlt: [], fehltKurz: [] };
    const KURZ = { NAP: 'Netzanschlusspunkt', Schaltanlage: 'Schaltanlage', Trafo: 'Trafo' };
    let html;
    if (!assets.length) {
      html = _naechster('leer', 'Noch keine Gebäude',
        'Das Stromnetz verbindet die Gebäude. Zuerst Gebäude im Schritt Bestand laden.',
        [['Zum Bestand', "uiSchritt('bestand')", true]]);
    } else if (!edges.length && !vor.ok) {
      const erst = vor.fehltKurz[0];
      html = _naechster(vor.fehltKurz.length === 3 ? 'leer' : 'offen',
        vor.fehltKurz.length === 3 ? 'Noch kein Stromnetz' : `${KURZ[erst] || erst} fehlt`,
        `Das Netz braucht die Kette Netzanschlusspunkt → Schaltanlage → Trafo. Es fehlt noch: ${vor.fehlt.join(', ')}. Danach lässt sich alles automatisch verbinden.`,
        [[`${KURZ[erst] || erst} setzen`, `elTab('netz'); setPendingType('${erst}')`, true],
         ['Standardgebäude platzieren', 'showKompaktstationDialog()']]);
    } else if (!edges.length) {
      html = _naechster('offen', 'Netz noch nicht verbunden',
        'Stationen und Gebäude automatisch verkabeln lassen oder Kabel selbst ziehen.',
        [['Automatisch verbinden', 'showAutoNetzDialog()', true], ['Kabel ziehen', "elTab('netz'); startDrawStromEdge()"]]);
    } else if (!_calcStamp || !frisch) {
      html = _naechster('offen', _calcStamp ? 'Netz geändert seit der letzten Rechnung' : 'Netz noch nicht berechnet',
        'Die Berechnung ermittelt Auslastung, Spannungsfall und Kurzschlussströme.',
        [['Elektroberechnung starten', "elTab('berechnen'); elCalcAssets()", true]]);
    } else if (nUeber) {
      html = _naechster('kritisch', `${nUeber} Überlastung${nUeber === 1 ? '' : 'en'} im Netz`,
        'Ursachen in der Netzanalyse ansehen, Ertüchtigung im Engpass-Fahrplan ableiten.',
        [['Netzanalyse', "elTab('pruefen'); naTogglePanel()", true], ['Engpass-Fahrplan', "elTab('pruefen'); engpassPanelToggle()"]]);
    } else {
      html = _naechster('ok', 'Netz berechnet, keine Überlast',
        'Als Nächstes die kommenden Jahre prüfen oder das Ergebnis dokumentieren.',
        [['Engpass-Fahrplan', "elTab('pruefen'); engpassPanelToggle()", true], ['Ergebnisblatt', "elTab('pruefen'); ergebnisblattToggle()"]]);
    }
    if (naechster.innerHTML !== html) naechster.innerHTML = html;
  }

  if (tiles) {
    if (!_calcStamp && !edges.length) { if (tiles.innerHTML) tiles.innerHTML = ''; return; }
    // Ergebnis-Stempel von elCalcAssets (_calcPeakLoadPct, nur Trafos der letzten
    // Rechnung) — derselbe Wert wie Karten-Hover, Ergebnisblatt und SLD.
    // sn._auslastungPct taugt nicht: die Schnellberechnung (recalcStromNetz)
    // überschreibt ihn mit einer anderen Formel (ohne cos φ).
    const trafos   = assets.filter(a => a.type === 'Trafo' && a._calcVerbrauchKw !== undefined);
    const maxTrafo = trafos.reduce((m, t) => Math.max(m, t._calcPeakLoadPct || 0), 0);
    const du       = window._stromNetzKpis?.maxDeltaU || 0;
    const lenM     = edges.reduce((sum, e) => sum + (e.lengthM || 0), 0);

    const trafoTxt = trafos.length ? `${maxTrafo.toFixed(0)} %` : '—';
    const trafoSt  = !trafos.length ? '' : maxTrafo < 80 ? 'ok' : maxTrafo < 100 ? 'warn' : 'crit';
    const duTxt    = du > 0 ? `${du.toFixed(2).replace('.', ',')} %` : '—';
    const duSt     = du <= 0 ? '' : du < 2 ? 'ok' : du < 3 ? 'warn' : 'crit';
    const lenTxt   = lenM > 0 ? (lenM >= 1000 ? `${(lenM / 1000).toFixed(2).replace('.', ',')} km` : `${lenM.toFixed(0)} m`) : '—';

    const html =
      _kpi('Trafo max.', trafoTxt, trafoSt) +
      _kpi('Spannungsfall max.', duTxt, duSt) +
      _kpi('Kabellänge', lenTxt, '');
    if (tiles.innerHTML !== html) tiles.innerHTML = html;
  }
}

let _statusTimer = null;

function _startStatusWatch() {
  if (_statusTimer) return;
  _statusTimer = setInterval(() => {
    if (!document.getElementById('lp-elektro')?.classList.contains('active')) return;
    elPanelRefreshStatus();
  }, 2000);
}

// ── Öffentliche API ───────────────────────────────────────────────────────────
export function buildElektroPanel() {
  const el = document.getElementById('lp-elektro');
  if (!el || el.dataset.built === '1') return;
  el.innerHTML = _html();
  el.dataset.built = '1';
  // Palette-Guard zurücksetzen, damit buildPalette() das neue #asset-palette befüllt
  const palette = document.getElementById('asset-palette');
  if (palette) delete palette.dataset.built;
  // Freiflächen-Liste sofort befüllen, falls bereits Flächen existieren
  window.renderFFPanel?.();
  // Gekoppelte-Anlagen-Status initial füllen
  renderGekoppelteStatus();
  elTab(elTabAktiv());
  elPanelRefreshStatus();
  _startStatusWatch();
}

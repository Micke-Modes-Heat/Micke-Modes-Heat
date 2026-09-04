// ── 13n-elektro-panel.js — Elektro-Panel dynamisch aufbauen ─────────────────
// Generiert den gesamten HTML-Inhalt des Elektro-Tabs und injiziert ihn in
// #lp-elektro. Einmalig beim ersten Öffnen des Tabs aufgerufen.
//
// Button-Hierarchie (siehe .lp-btn-* in styles/app.css):
//   • genau EINE Primäraktion pro Panel  → .lp-btn-primary (Elektroberechnung)
//   • zerstörende Aktionen               → .lp-btn-danger
//   • Zeichenwerkzeuge                   → neutraler Button + .lp-btn-swatch
//     in der Farbe, in der das Werkzeug auf der Karte zeichnet
//   • alles andere                       → neutral (.lp-tool-btn)
// Keine dekorativen Randfarben mehr — Farbe trägt hier ausschließlich Bedeutung.

import { isErzeugerAktiv } from './06c-dispatch-core.js';
import { lwWp, bhkw, gebaeude } from './01-globals-varianten.js';
import { getBatParams } from './09a-pv-profile.js';

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function _inp(id, label, value, { min = 0, max, step = 1, change = '', title = '' } = {}) {
  const maxA  = max != null ? `max="${max}"` : '';
  const chgA  = change ? `data-change="${change}"` : '';
  const tipA  = title  ? `title="${title}"` : '';
  return `<div>
    <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">${label}</div>
    <input id="${id}" type="number" value="${value}" min="${min}" ${maxA} step="${step}"
      style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
      ${chgA} ${tipA}/>
  </div>`;
}

function _stat(label, id, tip = '') {
  const tipH = tip ? ` <span class="htip" data-tip="${tip}">?</span>` : '';
  return `<div class="lp-netz-row"><span class="lbl">${label}${tipH}</span><span class="val" id="${id}">—</span></div>`;
}

const _sep = '<div style="border-top:1px solid var(--border);margin:5px 0 4px;"></div>';

// Gruppenüberschrift innerhalb eines Abschnitts
const _sub = (label) => `<div class="lp-group-label">${label}</div>`;

// Kachel-Button für die gruppierten Auswerte-Raster: zentriert, darf umbrechen
const _tile = (label, click, { id = '', title = '' } = {}) =>
  `<button class="lp-tool-btn lp-btn-tile"${id ? ` id="${id}"` : ''} data-click="${click}"${title ? ` title="${title}"` : ''}>${label}</button>`;

// Farbtupfer für Zeichenwerkzeuge — Farbe = Farbe der Linie auf der Karte
const _sw = (color) => `<span class="lp-btn-swatch" style="--sw:${color}"></span>`;

// ── Panel-HTML ────────────────────────────────────────────────────────────────

function _html() { return `

  <!-- Kopf -->
  <div class="lp-step" style="margin-bottom:10px;">
    <div class="lp-step-num" data-num="4">⚡</div>
    <div class="lp-step-text">Stromnetz planen<span>vier Stufen, oben nach unten</span></div>
  </div>

  <!-- Statusleiste — von elPanelRefreshStatus() befuellt -->
  <div id="el-status-strip" class="el-status-strip"></div>

  <!-- ── Angeschlossene Anlagen ─────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible"
       data-click="toggleSection('el-sec-anlagen')">
    <span>Angeschlossene Anlagen <span class="htip" data-tip="Dieselben Anlagen wie im Erzeuger-Tab (Wärme) — hier nur gespiegelt. Strombetriebene Wärmeerzeuger (WP, Stromkessel), BHKW, PV und Batterie wirken automatisch in der Strombilanz.">?</span></span>
    <span id="el-sec-anlagen-arrow">▼</span>
  </div>
  <div id="el-sec-anlagen">
    <div style="font-size:9px;color:var(--muted);margin-bottom:5px;">Status aus dem Erzeuger-Tab (Wärme) — eine Anlage, hier nur gespiegelt:</div>
    <div id="el-gekoppelt-status" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;"></div>
    <div style="display:flex;flex-direction:column;gap:3px;">
      <button class="lp-tool-btn" data-click="setLeftTab('erzeuger')"
        title="Zum Erzeuger-Tab (Wärme) wechseln">
        → Im Erzeuger-Tab bearbeiten
      </button>
      <button class="lp-tool-btn" data-click="showAutofillWizard()"
        title="Verbrauchs- und PV-Werte automatisch ermitteln">
        ✦ Auto-Befüllen (Verbrauch &amp; PV)
      </button>
      <button class="lp-tool-btn" id="el-btn-ff-draw" data-click="startDrawFF()"
        title="PV-Freifläche auf der Karte einzeichnen (Klick auf Eckpunkte, Doppelklick zum Abschluss)">
        ${_sw('#ffd54f')} Freiflächen-PV zeichnen
      </button>
      <button class="lp-tool-btn lp-btn-danger" id="el-btn-ff-cancel" data-click="cancelDrawFF()"
        style="display:none;">
        ✕ Abbrechen
      </button>
    </div>
    <div id="el-ff-list" style="display:flex;flex-direction:column;gap:4px;margin-top:4px;"></div>
    <div id="el-ff-total" style="display:none;margin-top:5px;padding:5px 8px;
      background:var(--surface);border-radius:5px;border:1px solid rgba(255,213,79,0.2);">
      <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:10px;font-family:'DM Mono',monospace;">
        <span style="color:var(--muted);">Gesamt</span>
        <span id="el-ff-total-kwp" style="color:#ffd54f;font-weight:600;text-align:right;">—</span>
        <span style="color:var(--muted);">Ertrag</span>
        <span id="el-ff-total-mwh" style="color:#a5d6a7;font-weight:600;text-align:right;">—</span>
      </div>
    </div>
  </div>

  <!-- ── 1 · Netz aufbauen ────────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('el-sec-netz')">
    <span>1 · Netz aufbauen</span><span id="el-sec-netz-arrow">▼</span>
  </div>
  <div id="el-sec-netz">
    ${_sub('Komponenten')}
    <div id="asset-palette" class="asset-palette-inline"></div>
    <div style="margin-top:3px;">
      <button class="lp-tool-btn lp-btn-tile" style="width:100%;"
        data-click="showKompaktstationDialog()"
        title="Standardgebäude (Trafostation, Übergabestation, Batteriespeicher, NEA, Energiezentrale, Ladepark) mit fertiger Elektro-Ausstattung per Klick platzieren">
        Standardgebäude
      </button>
    </div>
    <div style="margin-top:3px;">
      <button class="lp-tool-btn lp-btn-tile" style="width:100%;"
        id="btn-pd-toggle" data-click="pdTogglePanel()"
        title="Bestands-Einlinienplan (Bild/PDF) laden und darauf klickend digitalisieren: Knoten mit Gebäuden verknüpfen, Kabel nachziehen — Geometrie und Länge kommen aus dem Trassenrouting">
        📐 Bestandsplan digitalisieren
      </button>
    </div>

    ${_sep}
    ${_sub('Trassen &amp; Kabel')}
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:2px;">
      <button class="lp-tool-btn lp-btn-tile" id="btn-draw-trasse" data-click="toggleDrawTrasse('strom')"
        title="Trassenverlauf auf der Karte zeichnen">${_sw('#ff9800')} Trasse</button>
      <button class="lp-tool-btn lp-btn-tile" id="btn-schnellstart-osm" data-click="loadAndAdoptOsmStrassen()"
        title="Straßen aus OpenStreetMap laden und direkt als Trassen übernehmen">↓ OSM laden</button>
      <button class="lp-tool-btn lp-btn-tile" id="btn-draw-strom-edge" data-click="startDrawStromEdge()"
        title="Kabel zwischen zwei Komponenten ziehen">${_sw('#fdd835')} Kabel</button>
    </div>
    <div class="lp-tool-grid" style="margin-bottom:2px;">
      <button class="lp-tool-btn lp-btn-tile" id="btn-osm-strassen-toggle" data-click="toggleOsmStrassenVisible()">OSM ein-/aus</button>
      <button class="lp-tool-btn lp-btn-tile lp-btn-danger" data-click="clearOsmStrassen()">✕ OSM löschen</button>
    </div>
    <button class="lp-tool-btn lp-btn-tile lp-btn-danger" style="width:100%;margin-bottom:2px;"
      data-click="clearAllStromTrassen()"
      title="Alle gezeichneten und aus OSM übernommenen Elektro-Trassenabschnitte auf einmal entfernen — Wärmetrassen bleiben erhalten">✕ Alle Elektro-Trassen löschen</button>
    <button class="lp-tool-btn lp-btn-tile" style="width:100%;margin-bottom:2px;"
      data-click="realignAllStromKabel()"
      title="Verlauf und Länge aller bestehenden Kabel neu entlang der aktuellen Trassen berechnen — z.B. nach nachträglich gezeichneten oder korrigierten Trassen">↻ Kabel neu ausrichten</button>
    <button class="lp-tool-btn lp-btn-tile" style="width:100%;"
      data-click="showAutoNetzDialog()"
      title="Stromnetz automatisch erzeugen">Netz automatisch erzeugen</button>
  </div>

  <!-- ── 2 · Berechnen ────────────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('el-sec-calc')">
    <span>2 · Berechnen</span><span id="el-sec-calc-arrow">▼</span>
  </div>
  <div id="el-sec-calc">
    <button class="lp-tool-btn lp-btn-primary" data-click="elCalcAssets()"
      style="margin:4px 0 6px;"
      title="Elektrische Auslastungsberechnung für alle Stromnetz-Komponenten">
      ⚡ Elektroberechnung starten
    </button>
    <div id="el-kpi-tiles" class="el-kpi-tiles"></div>
    <div id="lp-el-calc-result"
      style="display:none;margin-bottom:6px;font-size:9px;color:var(--text);
             background:var(--surface);border-radius:4px;padding:4px 6px;border:1px solid var(--border);">
    </div>
    <div style="display:flex;gap:6px;">
      <div class="lp-section-title lp-section-collapsible"
           style="margin:0;flex:1;border:none;padding-bottom:0;"
           data-click="toggleSection('lp-strom-info')">
        ▸ Kennwerte <span id="lp-strom-info-arrow"></span>
      </div>
      <div class="lp-section-title lp-section-collapsible"
           style="margin:0;flex:1;border:none;padding-bottom:0;"
           data-click="toggleSection('lp-strom-param')">
        ▸ Parameter <span id="lp-strom-param-arrow"></span>
      </div>
    </div>
    <div id="lp-strom-info" class="lp-netz-summary" style="display:none;margin-top:4px;">
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
    </div>
    <div id="lp-strom-param" style="display:none;margin-top:4px;">
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Kabeltyp</div>
      <select id="strom-kabel-typ"
        style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;margin-bottom:6px;">
        <option value="NAYY">NAYY (Aluminium)</option>
        <option value="NYY" selected>NYY (Kupfer) — Standard</option>
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px;">
        ${_inp('strom-ns-cosphi', 'NS cos φ', '0.95',
          { min:0.70, max:1.00, step:0.01, change:'recalcStromNetz()', title:'Leistungsfaktor NS-Netz (typ. 0,95)' })}
        ${_inp('strom-ms-cosphi', 'MS cos φ', '0.90',
          { min:0.70, max:1.00, step:0.01, change:'recalcStromNetz()', title:'Leistungsfaktor MS-Ring (typ. 0,90)' })}
        ${_inp('strom-leiter-temp', 'Leitertemp. (°C)', '70',
          { min:20, max:90, step:5, change:'recalcStromNetz()', title:'Betriebstemperatur — NAYY/NYY max. 70 °C' })}
        <div>
          <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">GZF-Methode</div>
          <select id="strom-gzf-methode"
            style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
            data-change="document.getElementById('strom-gzf-manuell-wrap').style.display=this.value==='manuell'?'':'none'; recalcStromNetz()">
            <option value="din18015">DIN 18015-1 (Tabelle)</option>
            <option value="vde">VDE (1/n^0.4)</option>
            <option value="manuell">Manuell</option>
            <option value="keine">Keine (Σ-Last)</option>
          </select>
        </div>
        <div id="strom-gzf-manuell-wrap" style="display:none;grid-column:1/-1;">
          ${_inp('strom-gzf-manuell', 'GZF manuell', '0.6',
            { min:0.1, max:1.0, step:0.05, change:'recalcStromNetz()' })}
        </div>
        <div style="grid-column:1/-1;border-top:1px solid var(--border);margin:4px 0 2px;"></div>
        <div style="grid-column:1/-1;">${_sub('Iz-Korrekturfaktoren (IEC 60364-5-52)')}</div>
        ${_inp('strom-iz-tboden', 'Bodentemp. (°C)', '20',
          { min:-5, max:50, step:5, change:'recalcStromNetz()', title:'Für Iz-Temperaturkorrektur (kT). Referenz: 20 °C' })}
        ${_inp('strom-iz-nkabel', 'Häufung (Kabel)', '1',
          { min:1, max:20, step:1, change:'recalcStromNetz()', title:'Parallel verlegte Kabel (kG, IEC 60364-5-52 Tab. B.52.17)' })}
        <div style="grid-column:1/-1;">
          <div style="font-size:9px;color:var(--muted);margin-bottom:2px;">Verlegeart</div>
          <select id="strom-iz-verlegeart"
            style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
            data-change="recalcStromNetz()">
            <option value="erde">Erdverlegung direkt (D1) — Standard</option>
            <option value="luft">Freiluft, freie Luft (E/F) ×1.20</option>
            <option value="kanal">Kabelkanal in Erde (D2) ×0.87</option>
            <option value="rohr">Rohr in Wand/Beton (B1) ×0.77</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 3 · Auswerten ─────────────────────────────────────────────────────── -->
  <!-- Vier benannte Gruppen statt einer wachsenden Knopfliste. Neue Analysen
       kommen in die passende Gruppe, nicht als weitere Volle-Breite-Zeile. -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('el-sec-auswerten')">
    <span>3 · Auswerten</span><span id="el-sec-auswerten-arrow">▼</span>
  </div>
  <div id="el-sec-auswerten">

    ${_sub('Ergebnis im Detail')}
    <div class="lp-tool-grid">
      ${_tile('📄 Ergebnisblatt', 'ergebnisblattToggle()', { id:'btn-ergebnisblatt-toggle',
        title:'Vollständige Rechenergebnisse: Kennzahlen, Grenzwertnachweis, Kabel- und Knotentabellen, Mengengerüst, Kosten und alle Annahmen — druckbar und als CSV' })}
    </div>

    ${_sub('Netz ansehen')}
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;">
      ${_tile('Einlinien&shy;schema', 'sldToggle()', { id:'btn-sld-toggle',
        title:'Einlinienschema des Stromnetzes anzeigen' })}
      ${_tile('Netzanalyse', 'naTogglePanel()', { id:'btn-netzanalyse-toggle',
        title:'Auslastungen, Spannungsfall und Schwachstellen des berechneten Netzes' })}
      ${_tile('Knoten&shy;analyse', 'openKnotenanalyse()', {
        title:'Detailanalyse einzelner Netzknoten' })}
    </div>

    ${_sub('Zukunft &amp; Risiko')}
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;">
      ${_tile('Schwellen&shy;treppe', 'schwellenPanelToggle()', { id:'btn-schwellen-panel-toggle',
        title:'Screening je Variante: trägt das Bestandsnetz die geplante Erzeugung, oder lohnt ein eigenes Erzeugungsnetz?' })}
      ${_tile('Engpass-Fahrplan', 'engpassPanelToggle()', { id:'btn-engpass-panel-toggle',
        title:'Zeitstrahl der Engpässe, Reserve-Kurve und automatisch abgeleitete Ertüchtigungs-Maßnahmen' })}
      ${_tile('Windanalyse', 'windaTogglePanel()', { id:'btn-windanalyse-toggle',
        title:'Ertrag, Abstände, Eignungsfläche und Szenarien-Vergleich aller Windkraftanlagen' })}
    </div>

    ${_sub('Prüfen &amp; vergleichen')}
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;">
      ${_tile('Bestand prüfen', 'bestandPanelToggle()', { id:'btn-bestand-panel-toggle',
        title:'Plausibilität des Bestands prüfen: Kabellängen, Querschnitte, Topologie, Lebenszyklus — und welche Analyse der aktuelle Datenstand trägt' })}
      ${_tile('Varianten vergleichen', 'variantenVergleichToggle()', { id:'btn-varianten-vergleich-toggle',
        title:'Zeigt die Planungsentscheidungen aller Varianten nebeneinander — ohne die Variante zu wechseln' })}
      ${_tile('PV-Übersicht', 'pvuTogglePanel()', { id:'btn-pv-uebersicht-toggle',
        title:'Abgleich gezeichnete PV-Fläche gegen kWp der PV-Anlage' })}
    </div>

    ${_sub('Export')}
    <div class="lp-tool-grid">
      ${_tile('Bericht PDF', 'exportMassnahmenPDF()', {
        title:'Maßnahmenbericht als PDF exportieren' })}
      ${_tile('Investitionsplan', 'showInvestitionsplan()', {
        title:'Investitionen nach Jahren aufgeschlüsselt' })}
    </div>
  </div>

  <!-- ── Darstellung ──────────────────────────────────────────────────────── -->
  <!-- Die Engpass-Analyse steht hier und nicht unter „Auswerten": sie färbt
       die Kabel ein, ist also ein fünfter Einfärbe-Modus — nur einer, der
       vorher rechnen muss. -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('lp-strom-viz')">
    Darstellung <span id="lp-strom-viz-arrow">▼</span>
  </div>
  <div id="lp-strom-viz">
    <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">Kabel einfärben nach</div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;">
      <button class="lp-tool-btn lp-btn-tile" data-colormode="auslastung" data-click="setStromColorMode('auslastung')" title="Kabel nach Auslastung in % einfärben (grün = gering, rot = überlastet)">Auslastung</button>
      <button class="lp-tool-btn lp-btn-tile" data-colormode="spannungsfall" data-click="setStromColorMode('spannungsfall')" title="Kabel nach Spannungsfall ΔU in % einfärben">ΔU%</button>
      <button class="lp-tool-btn lp-btn-tile" data-colormode="leistung" data-click="setStromColorMode('leistung')" title="Kabel nach übertragener Leistung (kW) einfärben">Leistung</button>
      <button class="lp-tool-btn lp-btn-tile" data-colormode="richtung" data-click="setStromColorMode('richtung')" title="Kabel nach Leistungsflussrichtung einfärben (Bezug vs. Einspeisung)">Richtung</button>
      <button class="lp-tool-btn lp-btn-tile" id="btn-engpass-analyse" data-colormode="engpassjahr"
        style="grid-column:span 2;" data-click="engpassAnalyseStarten()"
        title="Rechnet das Netz über die kommenden Jahre durch und färbt die Kabel danach ein, WANN sie zum Engpass werden (Strombelastbarkeit oder kumulierter Spannungsfall).">
        ⏱ Engpassjahr (Zeitverlauf)
      </button>
    </div>
    <div id="lp-engpass-legende" style="display:none;margin-top:4px;"></div>
    <label style="font-size:10px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:8px;">
      <input type="checkbox" id="strom-dynamic-viz" data-change="setStromDynamicViz(this.checked)"/>
      Dynamische Darstellung (Flussanimation + Richtungspfeile)
    </label>
    <label style="font-size:10px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:8px;">
      <input type="checkbox" id="strom-netz-visible" checked data-change="setStromNetzVisible(this.checked)"/>
      Stromnetz sichtbar
    </label>
  </div>

  <!-- ── Kosten (eingeklappt) ────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('lp-strom-kosten')">
    Kostenkennwerte <span id="lp-strom-kosten-arrow">▶</span>
  </div>
  <div id="lp-strom-kosten" style="display:none;">
    ${_sub('Netzinfrastruktur')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
      ${_inp('strom-k-tiefbau', 'Tiefbau (€/m)',       '100',  { min:0, step:10,  change:'recalcStromNetz()' })}
      ${_inp('strom-k-nap',     'NAP-Pauschale (€)',    '3000', { min:0, step:500, change:'recalcStromNetz()' })}
      ${_inp('strom-k-trafo',   'Trafo (€/kVA)',        '60',   { min:0, step:10,  change:'recalcStromNetz()' })}
      ${_inp('strom-k-nd',      'Nutzungsdauer (a)',    '40',   { min:1, max:60, step:5, change:'recalcStromNetz()' })}
    </div>
    ${_sep}
    ${_sub('Anlagen-Kostenfaktoren')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
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
    ${_sep}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:5px 7px;">
        <div style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace;" id="strom-kpi-invest">—</div>
        <div style="font-size:8px;color:var(--muted);text-transform:uppercase;">Investition</div>
      </div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:5px 7px;">
        <div style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace;" id="strom-kpi-annuitaet">—</div>
        <div style="font-size:8px;color:var(--muted);text-transform:uppercase;">Annuität/a</div>
      </div>
      <div style="grid-column:1/-1;font-size:9px;color:var(--muted);padding:2px 0;" id="strom-kpi-detail"></div>
    </div>
  </div>

`; }

// ── Status-Chip der gekoppelten Anlagen ─────────────────────────────────────────
// Spiegelt den Aktiv-Status der stromrelevanten Erzeuger aus dem Erzeuger-Tab.
// Jede Abfrage defensiv gekapselt — fehlende Quelle ⇒ „—" statt Fehler.
// Die Chip-Farben bleiben bewusst bunt: sie kodieren den Anlagentyp und
// entsprechen den Farben auf der Karte — anders als bei den Buttons trägt
// die Farbe hier Bedeutung.
export function renderGekoppelteStatus() {
  const box = document.getElementById('el-gekoppelt-status');
  if (!box) return;
  const safe = (fn, d = false) => { try { return fn(); } catch (e) { return d; } };
  const kw = (v) => (v != null && isFinite(v)) ? Math.round(v) : null;
  const chip = (label, color, info) => {
    const suffix = info ? ` · ${info}` : '';
    return `<span style="font-size:10px;color:${color};border:1px solid ${color}66;border-radius:10px;padding:2px 8px;white-space:nowrap;">${label}${suffix}</span>`;
  };

  const chips = [];
  const lwAktiv = safe(() => isErzeugerAktiv('lwwp'));
  if (lwAktiv) chips.push(chip('Luft-WP', '#66bb6a', kw(lwWp?.leistung) != null ? `${kw(lwWp.leistung)} kW` : ''));
  if (safe(() => isErzeugerAktiv('geo')))        chips.push(chip('Geothermie',   '#bcaaa4', ''));
  if (safe(() => isErzeugerAktiv('fg')))         chips.push(chip('Fließgew.-WP', '#4fc3f7', ''));
  const bhAktiv = safe(() => isErzeugerAktiv('bhkw'));
  if (bhAktiv) chips.push(chip('BHKW', '#ffb74d', kw(bhkw?.leistung) != null ? `${kw(bhkw.leistung)} kW` : ''));
  if (safe(() => isErzeugerAktiv('stromkessel'))) chips.push(chip('Stromkessel', '#ff69b4', ''));
  const pvKwp = safe(() => parseFloat(document.getElementById('pv-kwp')?.value) || 0, 0);
  if (pvKwp > 0) chips.push(chip('PV', '#ffd54f', `${kw(pvKwp)} kWp`));
  if (safe(() => Array.isArray(gebaeude) && gebaeude.some(g => g.pvAktiv))) chips.push(chip('Gebäude-PV', '#ffd54f', ''));
  const bat = safe(() => (typeof getBatParams === 'function') ? getBatParams() : null, null);
  if (bat) chips.push(chip('Batterie', '#ce93d8', kw(bat.kapKwh) != null ? `${kw(bat.kapKwh)} kWh` : ''));

  box.innerHTML = chips.length
    ? chips.join('')
    : '<span style="font-size:9px;color:var(--muted);">Keine aktiven Anlagen</span>';
}

// ── Abschnitts-Zustand ────────────────────────────────────────────────────────
// Vorher standen sechs Abschnitte gleichzeitig offen — das Panel war dreimal so
// hoch wie das Fenster. Jetzt gilt: gespeicherter Zustand schlägt Default, und
// der Default richtet sich danach, ob überhaupt schon ein Netz existiert.
const _EL_SECTIONS = [
  'el-sec-anlagen', 'el-sec-netz', 'el-sec-calc',
  'el-sec-auswerten', 'lp-strom-viz', 'lp-strom-kosten',
];

function _hatStromAssets() {
  return (window.ASSETS?.items || []).some(a => a.domain === 'strom' || a.domain === 'hybrid');
}

function _defaultSectionOpen(id, hatNetz) {
  switch (id) {
    case 'el-sec-calc':      return true;      // der Zustand, in dem man meistens ist
    case 'el-sec-netz':      return !hatNetz;  // leeres Projekt: Werkzeuge zuerst
    case 'el-sec-auswerten': return hatNetz;   // Netz vorhanden: Auswertungen zuerst
    default:                 return false;
  }
}

function _applySectionStates() {
  const hatNetz = _hatStromAssets();
  for (const id of _EL_SECTIONS) {
    const saved = window.getSectionState?.(id);
    const open  = saved === undefined ? _defaultSectionOpen(id, hatNetz) : saved;
    if (typeof window.setSectionOpen === 'function') { window.setSectionOpen(id, open); continue; }
    const el = document.getElementById(id);
    if (el) el.style.display = open ? '' : 'none';
  }
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

const _kpi = (label, value, color) =>
  `<div class="el-kpi"><span class="el-kpi-label">${label}</span><span class="el-kpi-value"${color ? ` style="color:${color}"` : ''}>${value}</span></div>`;

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
  if (!strip && !tiles) return;

  const assets = (window.ASSETS?.items || []).filter(a => a.domain === 'strom' || a.domain === 'hybrid');
  const edges  = window.stromEdges || [];
  const frisch = !!_calcStamp && _calcStamp.sig === _netzSignatur();

  if (strip) {
    // 1 · Netz
    let netzState = 'is-ok';
    let netzVal   = `${assets.length} Komp. · ${edges.length} Kabel`;
    if (!assets.length)     { netzState = 'is-idle'; netzVal = 'leer'; }
    else if (!edges.length) { netzState = 'is-warn'; netzVal = `${assets.length} Komp. · 0 Kabel`; }

    // 2 · Rechnung
    let calcState = 'is-idle';
    let calcVal   = 'nicht gerechnet';
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
      const nAsset = assets.filter(a => (a._calcPeakLoadPct || 0) > 100).length;
      const nKabel = edges.filter(e => (e.auslastungPct || 0) > 100).length;
      const n = nAsset + nKabel;
      zuState = n ? 'is-bad' : 'is-ok';
      zuVal   = n ? `${n} überlastet` : 'keine Überlast';
      zuTip   = n
        ? `${nAsset} Komponente(n) und ${nKabel} Kabel über 100 % Auslastung.`
        : 'Keine Komponente und kein Kabel über 100 % Auslastung.';
      if (!frisch) zuTip += ' Stand der letzten Rechnung.';
    }

    const html =
      _chip('Netz', netzVal, netzState,
        `${assets.length} Strom-Komponenten und ${edges.length} Kabel im aktuellen Jahres- und Variantenstand.`) +
      _chip('Rechnung', calcVal, calcState, calcTip) +
      _chip('Zustand', zuVal, zuState, zuTip);
    if (strip.innerHTML !== html) strip.innerHTML = html;
  }

  if (tiles) {
    if (!_calcStamp && !edges.length) { if (tiles.innerHTML) tiles.innerHTML = ''; return; }
    const trafos   = (window.stromNodes || []).filter(n => n.type === 'trafo');
    const maxTrafo = trafos.reduce((m, t) => Math.max(m, t._auslastungPct || 0), 0);
    const du       = window._stromNetzKpis?.maxDeltaU || 0;
    const lenM     = edges.reduce((sum, e) => sum + (e.lengthM || 0), 0);

    const trafoTxt = trafos.length ? `${maxTrafo.toFixed(0)} %` : '—';
    const trafoCol = !trafos.length ? '' : maxTrafo < 80 ? '#4caf50' : maxTrafo < 100 ? '#f9a825' : '#e53935';
    const duTxt    = du > 0 ? `${du.toFixed(2)} %` : '—';
    const duCol    = du <= 0 ? '' : du < 2 ? '#4caf50' : du < 3 ? '#f9a825' : '#e53935';
    const lenTxt   = lenM > 0 ? (lenM >= 1000 ? `${(lenM / 1000).toFixed(2)} km` : `${lenM.toFixed(0)} m`) : '—';

    const html =
      _kpi('Trafo max', trafoTxt, trafoCol) +
      _kpi('ΔU max', duTxt, duCol) +
      _kpi('Kabel', lenTxt, '');
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
  _applySectionStates();
  elPanelRefreshStatus();
  _startStatusWatch();
}

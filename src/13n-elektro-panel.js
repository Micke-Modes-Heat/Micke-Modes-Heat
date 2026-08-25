// ── 13n-elektro-panel.js — Elektro-Panel dynamisch aufbauen ─────────────────
// Generiert den gesamten HTML-Inhalt des Elektro-Tabs und injiziert ihn in
// #lp-elektro. Einmalig beim ersten Öffnen des Tabs aufgerufen.

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

const _sub = (label) =>
  `<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:5px 0 3px;">${label}</div>`;

// ── Panel-HTML ────────────────────────────────────────────────────────────────

function _html() { return `

  <!-- Kopf -->
  <div class="lp-step" style="margin-bottom:10px;">
    <div class="lp-step-num" data-num="4">⚡</div>
    <div class="lp-step-text">Stromnetz planen<span>vier Stufen, oben nach unten</span></div>
  </div>

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
        style="border-color:#546e7a;color:#90a4ae;"
        title="Zum Erzeuger-Tab (Wärme) wechseln">
        → Im Erzeuger-Tab bearbeiten
      </button>
      <button class="lp-tool-btn" data-click="showAutofillWizard()"
        style="border-color:#4fc3f7;color:#4fc3f7;"
        title="Verbrauchs- und PV-Werte automatisch ermitteln">
        ✦ Auto-Befüllen (Verbrauch &amp; PV)
      </button>
      <button class="lp-tool-btn" id="el-btn-ff-draw" data-click="startDrawFF()"
        style="border-color:#ffd54f;color:#ffd54f;"
        title="PV-Freifläche auf der Karte einzeichnen (Klick auf Eckpunkte, Doppelklick zum Abschluss)">
        ☀ Freiflächen-PV zeichnen
      </button>
      <button class="lp-tool-btn" id="el-btn-ff-cancel" data-click="cancelDrawFF()"
        style="display:none;border-color:#ef9a9a;color:#ef9a9a;">
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
      <button class="lp-tool-btn" data-click="showKompaktstationDialog()"
        style="width:100%;border-color:#cf6679;color:#cf6679;"
        title="Standardgebäude (Trafostation, Übergabestation, Batteriespeicher, NEA, Energiezentrale, Ladepark) mit fertiger Elektro-Ausstattung per Klick platzieren">
        Standardgebäude
      </button>
    </div>

    ${_sep}
    ${_sub('Trassen &amp; Kabel')}
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:2px;">
      <button class="lp-tool-btn" id="btn-draw-trasse" data-click="toggleDrawTrasse()"
        style="border-color:#ff9800;color:#ff9800;justify-content:center;">— Trasse</button>
      <button class="lp-tool-btn" id="btn-schnellstart-osm" data-click="loadAndAdoptOsmStrassen()"
        style="border-color:#90a4ae;color:#90a4ae;justify-content:center;"
        title="Straßen aus OpenStreetMap laden und direkt als Trassen übernehmen">↓ OSM laden</button>
      <button class="lp-tool-btn" id="btn-draw-strom-edge" data-click="startDrawStromEdge()"
        style="border-color:#fdd835;color:#fdd835;justify-content:center;">— Kabel</button>
    </div>
    <div class="lp-tool-grid" style="margin-bottom:2px;">
      <button class="lp-tool-btn" id="btn-osm-strassen-toggle" data-click="toggleOsmStrassenVisible()">OSM ein-/aus</button>
      <button class="lp-tool-btn" data-click="clearOsmStrassen()"
        style="border-color:#e57373;color:#e57373;">✕ OSM löschen</button>
    </div>
    <button class="lp-tool-btn" data-click="showAutoNetzDialog()"
      style="border-color:#66bb6a;color:#66bb6a;"
      title="Stromnetz automatisch erzeugen">Netz automatisch erzeugen</button>
  </div>

  <!-- ── 2 · Berechnen ────────────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('el-sec-calc')">
    <span>2 · Berechnen</span><span id="el-sec-calc-arrow">▼</span>
  </div>
  <div id="el-sec-calc">
    <button class="lp-tool-btn" data-click="elCalcAssets()"
      style="width:100%;justify-content:center;padding:7px 8px;font-size:11px;font-weight:600;
             background:rgba(79,195,247,0.10);border:1.5px solid #4fc3f7;color:#4fc3f7;
             border-radius:5px;margin:4px 0 6px;letter-spacing:.02em;"
      title="Elektrische Auslastungsberechnung für alle Stromnetz-Komponenten">
      ⚡ Elektroberechnung starten
    </button>
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
        <div style="grid-column:1/-1;font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">
          Iz-Korrekturfaktoren (IEC 60364-5-52)
        </div>
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

  <!-- ── 3 · Auswerten & Export ────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('el-sec-auswerten')">
    <span>3 · Auswerten &amp; Export</span><span id="el-sec-auswerten-arrow">▼</span>
  </div>
  <div id="el-sec-auswerten">
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:4px;margin-bottom:2px;">
      <button class="lp-tool-btn" id="btn-sld-toggle" data-click="sldToggle()"
        style="border-color:#80cbc4;color:#80cbc4;justify-content:center;">Einlinien&shy;schema</button>
      <button class="lp-tool-btn" id="btn-netzanalyse-toggle" data-click="naTogglePanel()"
        style="border-color:#b39ddb;color:#ce93d8;justify-content:center;">Netzanalyse</button>
      <button class="lp-tool-btn" data-click="openKnotenanalyse()"
        style="border-color:#4fc3f7;color:#4fc3f7;justify-content:center;"
        title="Detailanalyse einzelner Netzknoten">Knotenanalyse</button>
    </div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr 1fr;">
      <button class="lp-tool-btn" data-click="showInvestitionsplan()"
        style="border-color:#ce93d8;color:#ce93d8;justify-content:center;">Investitionsplan</button>
      <button class="lp-tool-btn" data-click="exportMassnahmenPDF()"
        style="border-color:#ef9a9a;color:#ef9a9a;justify-content:center;">Bericht PDF</button>
      <button class="lp-tool-btn" id="btn-pv-uebersicht-toggle" data-click="pvuTogglePanel()"
        style="border-color:#ffd54f;color:#ffd54f;justify-content:center;"
        title="Abgleich gezeichnete PV-Fläche ↔ kWp der PV-Anlage">PV-Übersicht</button>
    </div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr;margin-top:4px;">
      <button class="lp-tool-btn" id="btn-windanalyse-toggle" data-click="windaTogglePanel()"
        style="border-color:#4dd0e1;color:#4dd0e1;justify-content:center;"
        title="Ertrag, Abstände, Eignungsfläche &amp; Szenarien-Vergleich aller Windkraftanlagen">🌀 Windanalyse</button>
    </div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr;margin-top:4px;">
      <button class="lp-tool-btn" id="btn-bestand-panel-toggle" data-click="bestandPanelToggle()"
        style="border-color:#4fc3f7;color:#4fc3f7;justify-content:center;"
        title="Plausibilität des Bestands prüfen: Kabellängen, Querschnitte, Topologie, Lebenszyklus — und welche Analyse der aktuelle Datenstand trägt">🏛 Bestand prüfen</button>
    </div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr;margin-top:4px;">
      <button class="lp-tool-btn" id="btn-engpass-panel-toggle" data-click="engpassPanelToggle()"
        style="border-color:#f9a825;color:#f9a825;justify-content:center;"
        title="Zeitstrahl der Engpässe, Reserve-Kurve und automatisch abgeleitete Ertüchtigungs-Maßnahmen">⏱ Engpass-Fahrplan</button>
    </div>
  </div>

  <!-- ── Darstellung ──────────────────────────────────────────────────────── -->
  <div class="lp-section-title lp-section-collapsible" style="margin-top:10px;"
       data-click="toggleSection('lp-strom-viz')">
    Darstellung <span id="lp-strom-viz-arrow">▼</span>
  </div>
  <div id="lp-strom-viz">
    <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">Kabel einfärben nach</div>
    <div class="lp-tool-grid" style="grid-template-columns:1fr 1fr;">
      <button class="lp-tool-btn" data-click="setStromColorMode('auslastung')"  style="justify-content:center;font-size:9px;" title="Kabel nach Auslastung in % einfärben (grün = gering, rot = überlastet)">Auslastung</button>
      <button class="lp-tool-btn" data-click="setStromColorMode('spannungsfall')" style="justify-content:center;font-size:9px;" title="Kabel nach Spannungsfall ΔU in % einfärben">ΔU%</button>
      <button class="lp-tool-btn" data-click="setStromColorMode('leistung')"    style="justify-content:center;font-size:9px;" title="Kabel nach übertragener Leistung (kW) einfärben">Leistung</button>
      <button class="lp-tool-btn" data-click="setStromColorMode('richtung')"    style="justify-content:center;font-size:9px;" title="Kabel nach Leistungsflussrichtung einfärben (Bezug vs. Einspeisung)">Richtung</button>
    </div>
    <button class="lp-tool-btn" id="btn-engpass-analyse" data-click="engpassAnalyseStarten()"
      style="width:100%;justify-content:center;margin-top:4px;font-size:9px;
             border-color:#ff7043;color:#ff7043;"
      title="Rechnet das Netz über die kommenden Jahre durch und färbt die Kabel danach ein, WANN sie zum Engpass werden (Strombelastbarkeit oder kumulierter Spannungsfall).">
      ⏱ Engpass-Analyse (Zeitverlauf)
    </button>
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
    <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Netzinfrastruktur</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
      ${_inp('strom-k-tiefbau', 'Tiefbau (€/m)',       '100',  { min:0, step:10,  change:'recalcStromNetz()' })}
      ${_inp('strom-k-nap',     'NAP-Pauschale (€)',    '3000', { min:0, step:500, change:'recalcStromNetz()' })}
      ${_inp('strom-k-trafo',   'Trafo (€/kVA)',        '60',   { min:0, step:10,  change:'recalcStromNetz()' })}
      ${_inp('strom-k-nd',      'Nutzungsdauer (a)',    '40',   { min:1, max:60, step:5, change:'recalcStromNetz()' })}
    </div>
    ${_sep}
    <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Anlagen-Kostenfaktoren</div>
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
function _statusChip(label, color, aktiv, info) {
  if (aktiv) {
    const suffix = info ? ` · ${info}` : '';
    return `<span style="font-size:10px;color:${color};border:1px solid ${color}66;border-radius:10px;padding:2px 8px;white-space:nowrap;">${label}${suffix}</span>`;
  }
  return `<span style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:10px;padding:2px 8px;white-space:nowrap;opacity:.55;">${label} · —</span>`;
}

// Spiegelt den Aktiv-Status der stromrelevanten Erzeuger aus dem Erzeuger-Tab.
// Jede Abfrage defensiv gekapselt — fehlende Quelle ⇒ „—" statt Fehler.
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
}

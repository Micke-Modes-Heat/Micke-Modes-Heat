// ── HILFE-MODUS + LEITFADEN ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// HILFE_TEXTE wurde nach config/hilfe-texte.js extrahiert (wird vorher geladen)


let _hilfeModus = false;
let _hilfeOverlay = null;
let _hilfeTooltip = null;

function toggleHilfeModus() {
  _hilfeModus = !_hilfeModus;
  const btn = document.getElementById('btn-hilfe-toggle');

  if (_hilfeModus) {
    btn.style.borderColor = '#4caf50';
    btn.style.color = '#4caf50';
    btn.style.background = 'rgba(76,175,80,0.15)';
    btn.textContent = '❓ Hilfe (aktiv)';
    _showHilfeOverlay();
  } else {
    btn.style.borderColor = '#607d8b';
    btn.style.color = '#90a4ae';
    btn.style.background = '';
    btn.textContent = '❓';
    _hideHilfeOverlay();
  }
}

function _showHilfeOverlay() {
  if (_hilfeOverlay) return;

  // Overlay fängt Klicks ab
  _hilfeOverlay = document.createElement('div');
  _hilfeOverlay.id = 'hilfe-overlay';
  _hilfeOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;cursor:help;';
  _hilfeOverlay.addEventListener('click', function(e) {
    // Nur den Hilfe-Button selbst durchlassen
    const hilfeBtn = document.getElementById('btn-hilfe-toggle');
    const rect = hilfeBtn.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      toggleHilfeModus();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  // Tooltip-Element
  _hilfeTooltip = document.createElement('div');
  _hilfeTooltip.id = 'hilfe-tooltip';
  _hilfeTooltip.style.cssText = 'position:fixed;z-index:9999;background:#1a1a2e;color:#e8eaf0;border:1px solid #4caf50;border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.5;max-width:320px;pointer-events:none;display:none;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

  document.body.appendChild(_hilfeOverlay);
  document.body.appendChild(_hilfeTooltip);

  // Mousemove auf dem Overlay → Element darunter finden
  _hilfeOverlay.addEventListener('mousemove', function(e) {
    _hilfeOverlay.style.pointerEvents = 'none';
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    _hilfeOverlay.style.pointerEvents = '';

    if (!elUnder) { _hilfeTooltip.style.display = 'none'; return; }

    // Suche das nächste Element mit Hilfe-Text (aufwärts)
    let target = elUnder;
    let text = null;
    for (let i = 0; i < 8 && target && target !== document.body; i++) {
      if (target.id && HILFE_TEXTE[target.id]) { text = HILFE_TEXTE[target.id]; break; }
      // data-tip (bestehende Tooltips) als Fallback
      if (target.dataset && target.dataset.tip) { text = target.dataset.tip; break; }
      // title-Attribut
      if (target.title && target.title.length > 5) { text = target.title; break; }
      target = target.parentElement;
    }

    // Für Buttons ohne spezifische Hilfe: Text aus innerHTML ableiten
    if (!text && elUnder.closest('button, .lp-tool-btn, .tool-btn, .view-tab, .mode-btn, .lp-tab')) {
      const btn = elUnder.closest('button, .lp-tool-btn, .tool-btn, .view-tab, .mode-btn, .lp-tab');
      if (btn.id && HILFE_TEXTE[btn.id]) {
        text = HILFE_TEXTE[btn.id];
      } else {
        const label = btn.textContent.trim().substring(0, 40);
        if (label) text = '„' + label + '" — Keine detaillierte Hilfe verfügbar.';
      }
    }

    if (!text) { _hilfeTooltip.style.display = 'none'; return; }

    _hilfeTooltip.innerHTML = '<div style="font-weight:600;color:#4caf50;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;">ℹ Hilfe</div>' + text;
    _hilfeTooltip.style.display = '';

    // Position: neben dem Cursor, im Viewport halten
    let x = e.clientX + 16, y = e.clientY + 16;
    const tw = _hilfeTooltip.offsetWidth, th = _hilfeTooltip.offsetHeight;
    if (x + tw > window.innerWidth - 10) x = e.clientX - tw - 10;
    if (y + th > window.innerHeight - 10) y = e.clientY - th - 10;
    _hilfeTooltip.style.left = x + 'px';
    _hilfeTooltip.style.top = y + 'px';
  });
}

function _hideHilfeOverlay() {
  if (_hilfeOverlay) { _hilfeOverlay.remove(); _hilfeOverlay = null; }
  if (_hilfeTooltip) { _hilfeTooltip.remove(); _hilfeTooltip = null; }
}

// ── LEITFADEN-PANEL ──────────────────────────────────────────────────────────
let _leitfadenOpen = false;

const LEITFADEN_STEPS = [
  { id: 'lf-s1', title: '📍 Plangebiet & Gebäude',
    text: '<strong>1. Zum Quartier navigieren:</strong><br>' +
      'Gib oben rechts eine Adresse in die Suche ein, oder verschiebe die Karte manuell zum gewünschten Bereich.<br><br>' +
      '<strong>2. Plangebiet zeichnen:</strong><br>' +
      'Klicke links im Tab „Gebiet" auf den lila Button <strong>„⬡ Plangebiet / Bereich zeichnen"</strong>. Setze Eckpunkte per Klick auf die Karte. Klicke den <strong>roten Startpunkt</strong> erneut an, um das Polygon zu schließen. Die Eckpunkte können nachträglich verschoben werden.<br><br>' +
      '<strong>3. Gebäude importieren:</strong><br>' +
      'Nach dem Zeichnen öffnet sich automatisch das Bereichs-Panel. Klicke dort auf <strong>„Gebäude laden"</strong> — die Gebäude innerhalb des Polygons werden aus OpenStreetMap importiert (Grundrisse, Stockwerke, ggf. Baujahr).<br><br>' +
      'Alternativ: Klicke auf <strong>„↓ OSM-Import (OpenStreetMap)"</strong> im Tab „Gebiet", um das Import-Panel manuell zu öffnen.<br><br>' +
      '💡 <em>Die Gebäude erscheinen auf der Karte und in der Sidebar rechts als Liste. Der Wärme- und Strombedarf wird automatisch aus Grundfläche und Baujahr geschätzt.</em>',
    doneText: () => {
      const n = (typeof gebaeude !== 'undefined') ? gebaeude.length : 0;
      if (n > 0) {
        const totalMwh = gebaeude.reduce((s,g) => s + (parseFloat(g.waerme)||0), 0);
        return 'Plangebiet + ' + n + ' Gebäude geladen' + (totalMwh > 0 ? ' — ' + totalMwh.toFixed(0) + ' MWh' : '');
      }
      return typeof areaPolygon !== 'undefined' && areaPolygon ? 'Plangebiet definiert — noch keine Gebäude' : '';
    },
    check: () => typeof gebaeude !== 'undefined' && gebaeude.length > 0,
    tab: 'gebiet' },
  { id: 'lf-s2', title: '🔍 Gebäudedaten prüfen',
    text: 'Der Energiebedarf wurde <strong>automatisch geschätzt</strong> (Fläche × Baujahr-Kennwert nach IWU/TABULA). Für eine erste Planung reicht das aus.<br><br>' +
      '<strong>Gebäude bearbeiten:</strong><br>' +
      'Klicke in der <strong>Sidebar rechts</strong> auf ein Gebäude. Du kannst dort ändern:<br>' +
      '• Nutzungsart, Stockwerke, Baujahr<br>' +
      '• Wärmebedarf (MWh/a) und Heizlast (kW) manuell überschreiben<br>' +
      '• Strombedarf manuell eingeben<br><br>' +
      '<strong>Projektweite Einstellungen:</strong><br>' +
      '• <strong>„🔥 Wärme-Grundlagen"</strong> — Klimastandort, Lastprofil (SigLinDe), Heizkurve, Netzverluste<br>' +
      '• <strong>„⚡ Strom-Grundlagen"</strong> — Stromlastgang, Strompreise, BHKW-Vergütung<br>' +
      '• <strong>„⚙ Kennwerte"</strong> — CO₂-Emissionsfaktoren (GEG Anlage 9)<br><br>' +
      '💡 <em>Dieser Schritt ist optional — du kannst direkt weiterarbeiten und die Daten später verfeinern. Für höchste Genauigkeit: Lade einen Stundenlastgang (CSV mit 8760 kW-Werten) über „Wärme-Grundlagen" hoch.</em>',
    doneText: () => {
      if (typeof gebaeude === 'undefined' || gebaeude.length === 0) return 'Daten vorhanden';
      const mitLastgang = gebaeude.filter(g => g.lastgangKw).length;
      const mitManuel = gebaeude.filter(g => g.waerme && parseFloat(g.waerme) > 0 && !g.lastgangKw).length;
      if (mitLastgang > 0) return mitLastgang + ' Gebäude mit Stundenlastgang';
      if (mitManuel > 0) return mitManuel + ' Gebäude mit manuellen Verbrauchsdaten';
      return 'Verbrauch automatisch berechnet (Fläche/Baujahr)';
    },
    check: () => {
      if (typeof gebaeude === 'undefined' || gebaeude.length === 0) return false;
      return gebaeude.some(g => (g.waerme && parseFloat(g.waerme) > 0) || (g.strom && parseFloat(g.strom) > 0) || g.lastgangKw);
    },
    tab: 'gebiet' },
  { id: 'lf-s3', title: '🔗 Wärmenetz erstellen',
    text: 'Wechsle links zum Tab <strong>„Netz"</strong> (Untertab „Wärme"). Klicke auf <strong>„🔗 Wärmenetz konfigurieren"</strong> — es öffnet sich ein Planungspanel.<br><br>' +
      '<strong>1. Heizzentrale wählen:</strong><br>' +
      'Wähle im Dropdown <strong>„Heizzentrale auswählen"</strong> das Gebäude, in dem die Erzeuger stehen sollen.<br><br>' +
      '<strong>2. Netz generieren:</strong><br>' +
      'Klicke auf <strong>„Auto-Netz (MST)"</strong> — das Programm verbindet alle Gebäude automatisch über kürzeste Wege mit der Zentrale. Alternativ: <strong>„Haupttrasse zeichnen"</strong> für einen manuellen Trassenverlauf, oder <strong>„Leitung zeichnen"</strong> für einzelne Stichleitungen.<br><br>' +
      '<strong>3. Parameter prüfen (optional):</strong><br>' +
      'Im selben Panel findest du Netzparameter: Vorlauf-/Rücklauftemperatur, Ziel-Fließgeschwindigkeit, U-Wert der Rohrdämmung und das Kostenszenario (Niedrig/Mittel/Hoch). Diese Werte beeinflussen Netzverluste, Rohrdimensionierung und Investitionskosten.<br><br>' +
      '💡 <em>Im Tab „Netz" siehst du die automatisch berechneten Kennwerte: Trassenlänge, Netzverluste, Wärmeverlustdichte (WLD), Anschlussdichte, Druckverlust und Pumpenleistung. Klick auf eine Leitung zeigt DN und Kosten.</em>',
    doneText: () => {
      const n = (typeof netzEdges !== 'undefined') ? netzEdges.length : 0;
      const tl = document.getElementById('lp-netz-laenge');
      const len = tl ? tl.textContent : '';
      return 'Wärmenetz erstellt' + (len && len !== '—' ? ' — Trasse: ' + len : ' — ' + n + ' Abschnitte');
    },
    check: () => typeof netzEdges !== 'undefined' && netzEdges.length > 0,
    tab: 'netz' },
  { id: 'lf-s4', title: '🔥 Erzeuger hinzufügen',
    text: 'Wechsle links zum Tab <strong>„Erzeuger"</strong>. Oben findest du Buttons für jeden Erzeugertyp.<br><br>' +
      '<strong>Vorgehen pro Erzeuger:</strong><br>' +
      '1. Klicke auf einen Button (z.B. <strong>„🌊 Luft-WP"</strong> oder <strong>„🔥 Gaskessel"</strong>) — ein Konfigurationspanel öffnet sich<br>' +
      '2. Stelle die Leistung (kW) und Parameter ein<br>' +
      '3. Klicke <strong>„Auf Karte platzieren"</strong> und setze den Erzeuger per Klick auf das Zentralen-Gebäude<br><br>' +
      '<strong>Typische Kombination:</strong><br>' +
      '• <strong>Grundlast</strong> (Luft-WP, Sole-WP, Pellets) — läuft ganzjährig, deckt den Großteil des Bedarfs<br>' +
      '• <strong>Spitzenlast</strong> (Gaskessel, Ölkessel) — springt nur an den kältesten Tagen ein<br>' +
      '• Optional: <strong>Solarthermie</strong> für sommerliche Grundlast, <strong>Pufferspeicher</strong> zur Lastverschiebung<br><br>' +
      '💡 <em>Unten im Tab „Erzeuger" siehst du die Merit-Order — die Einsatzreihenfolge aller aktiven Erzeuger, sortiert nach Grenzkosten. Per Drag & Drop anpassbar.</em>',
    doneText: () => {
      const names = [];
      if (typeof lwWp !== 'undefined' && lwWp && lwWp.leistungKw > 0) names.push('Luft-WP');
      if (typeof fg !== 'undefined' && fg && fg.leistungKw > 0) names.push('Flusswasser-WP');
      if (typeof geoThermie !== 'undefined' && geoThermie && geoThermie.leistKw > 0) names.push('Sole-WP');
      if (typeof gasKessel !== 'undefined' && gasKessel && gasKessel.leistungKw > 0) names.push('Gaskessel');
      if (typeof heizoelKessel !== 'undefined' && heizoelKessel && heizoelKessel.leistungKw > 0) names.push('Ölkessel');
      if (typeof pelletsKessel !== 'undefined' && pelletsKessel && pelletsKessel.leistungKw > 0) names.push('Pellets');
      if (typeof heizhackschnitzel !== 'undefined' && heizhackschnitzel && heizhackschnitzel.leistungKw > 0) names.push('HHS');
      if (typeof fernwaerme !== 'undefined' && fernwaerme && fernwaerme.leistungKw > 0) names.push('Fernwärme');
      return names.length ? names.join(' + ') + ' konfiguriert' : 'Erzeuger vorhanden';
    },
    check: () => {
      const keys = ['lwwp','fg','geo','gaskessel','heizoel','pellets','hhs','fernwaerme','stromkessel','bhkw'];
      return keys.some(k => { const v = window[k === 'gaskessel' ? 'gasKessel' : k === 'heizoel' ? 'heizoelKessel' : k === 'pellets' ? 'pelletsKessel' : k === 'hhs' ? 'heizhackschnitzel' : k]; return v && (v.leistungKw > 0 || v.leistKw > 0); });
    },
    tab: 'erzeuger' },
  { id: 'lf-s5', title: '⚡ Ergebnis prüfen',
    text: 'Sobald Netz und mindestens ein Erzeuger vorhanden sind, läuft die <strong>stundenscharfe Jahressimulation (8760h) automatisch</strong>.<br><br>' +
      'Wechsle links zum Tab <strong>„Ergebnis"</strong>. Dort siehst du:<br><br>' +
      '• <strong>WGK</strong> — Wärmegestehungskosten (ct/kWh), annuitätisch nach VDI 2067<br>' +
      '• <strong>EE-Anteil</strong> — Erneuerbare-Energien-Anteil in %<br>' +
      '• <strong>CO₂</strong> — Jahresemissionen in Tonnen<br>' +
      '• <strong>Wärme / Heizlast</strong> — Gesamtbedarf und Spitzenlast<br><br>' +
      '<strong>Detailauswertungen:</strong><br>' +
      '• <strong>„€ Wirtschaftlichkeit"</strong> — Investitions- und Betriebskosten, Amortisation<br>' +
      '• <strong>„📊 Status"</strong> — Deckungsanteile aller Erzeuger<br>' +
      '• <strong>„🔀 Sankey-Diagramm"</strong> — Energiefluss von Quelle zu Senke<br>' +
      '• <strong>„📈 Systemanalyse"</strong> — Wechselt zur ausführlichen Analyse-Ansicht<br><br>' +
      '💡 <em>Unten in der Statusleiste siehst du die wichtigsten Kennzahlen jederzeit im Blick.</em>',
    doneText: () => {
      const wgk = document.getElementById('lp-kpi-wgk');
      return wgk && wgk.textContent && wgk.textContent !== '—' ? 'WGK: ' + wgk.textContent : 'Berechnung abgeschlossen';
    },
    check: () => { const el = document.getElementById('lp-kpi-wgk'); return el && el.textContent !== '—' && el.textContent !== ''; },
    tab: 'ergebnis' },
  { id: 'lf-s6', title: '📊 Dispatch & Live-Ansicht',
    text: 'Klicke oben in der Ansichtsleiste auf <strong>„Live"</strong>. Du siehst den stundenscharfen Dispatch über das gesamte Jahr:<br><br>' +
      '• <strong>Lastgang</strong> — Der Wärmebedarf aller Gebäude als Kurve<br>' +
      '• <strong>Erzeugung</strong> — Farbige Flächen zeigen, welcher Erzeuger wann liefert<br>' +
      '• <strong>Speicher</strong> — Lade-/Entladezyklen des Pufferspeichers (falls vorhanden)<br><br>' +
      'Mit dem <strong>Zeitstrahl am unteren Rand</strong> kannst du in einzelne Wochen oder Tage hineinzoomen.<br><br>' +
      'Für noch tiefere Analyse: Klicke im Tab „Ergebnis" auf <strong>„📈 Systemanalyse"</strong> — dort findest du Dauerlinie, Wochenvergleich, Energiesplit und Sensitivitätsanalyse.',
    doneText: () => 'Live-Ansicht geöffnet',
    check: () => { const tab = document.getElementById('view-tab-live'); return tab && tab.style.display !== 'none'; },
    tab: null },
  { id: 'lf-s7', title: '☀ PV + Batterie (optional)',
    text: 'Wechsle zum Tab <strong>„Erzeuger"</strong> und klicke auf <strong>„☀ PV-Anlage"</strong>. Es öffnet sich ein Panel mit:<br><br>' +
      '• <strong>Leistung (kWp)</strong> — Nennleistung der PV-Anlage<br>' +
      '• <strong>Ausrichtung & Neigung</strong> — Beeinflusst den standortabhängigen Jahresertrag<br>' +
      '• <strong>Vergütungsmodell</strong> — Überschuss- oder Volleinspeisung nach EEG<br><br>' +
      'Für einen Batteriespeicher klicke zusätzlich auf <strong>„🔋 Batteriespeicher"</strong> und gib die Kapazität (kWh) ein.<br><br>' +
      'Zusätzlich gibt es <strong>„☀ Dach-PV"</strong> (PV auf Gebäudedächer verteilen) und <strong>„☀ Freifläche"</strong> (Freiflächenanlage als Polygon auf der Karte einzeichnen).<br><br>' +
      '💡 <em>Eigenverbrauch und Autarkie werden stundenscharf gegen den Stromlastgang berechnet. Die Strom-Bilanz findest du im Tab „Ergebnis" unter „⚡ Strom-Bilanz".</em>',
    doneText: () => {
      const kwp = document.getElementById('pv-kwp');
      return 'PV-Anlage konfiguriert' + (kwp && kwp.value ? ' — ' + kwp.value + ' kWp' : '');
    },
    check: () => { const el = document.getElementById('pv-kwp'); return el && parseFloat(el.value) > 0; },
    tab: 'erzeuger' },
  { id: 'lf-s8', title: '🔄 Optimierung (optional)',
    text: 'Klicke oben auf <strong>„Optimierung"</strong> in der Ansichtsleiste. Der Optimierer durchsucht systematisch verschiedene Erzeuger-Leistungskombinationen und bewertet jeweils die Wärmegestehungskosten.<br><br>' +
      'PV-Leistung und Batteriegröße können optional mitoptimiert werden.<br><br>' +
      'Die Ergebnisse lassen sich über <strong>„Vergleich"</strong> in der Ansichtsleiste als Varianten nebeneinander vergleichen.',
    doneText: () => 'Optimierung durchgeführt',
    check: () => false,
    tab: null },
  { id: 'lf-s9', title: '💾 Speichern & Exportieren',
    text: 'Vergiss nicht, dein Projekt zu sichern!<br><br>' +
      '<strong>Projekt speichern:</strong><br>' +
      'Klicke unten in der Leiste auf <strong>„💾 Speichern"</strong> — es wird eine JSON-Datei heruntergeladen, die alle Gebäude, Netze, Erzeuger und Einstellungen enthält. Über <strong>„📂 Öffnen"</strong> kannst du sie jederzeit wieder laden.<br><br>' +
      '<strong>Ergebnisse exportieren (Tab „Ergebnis"):</strong><br>' +
      '• <strong>„📄 PDF-Bericht erstellen"</strong> — Vollständiger Bericht mit Karten, Kennzahlen und Diagrammen<br>' +
      '• <strong>„📋 Dispatch CSV"</strong> — Stundenscharfe Erzeugungsdaten aller Erzeuger<br>' +
      '• <strong>„📋 Gebäude CSV"</strong> — Gebäudeliste mit Bedarfswerten<br>' +
      '• <strong>„🖨 PDF"</strong> (unten in der Leiste) — Druckt die aktuelle Kartenansicht',
    doneText: () => 'Projekt gesichert',
    check: () => false,
    tab: 'ergebnis' },
];

function toggleLeitfaden() {
  _leitfadenOpen = !_leitfadenOpen;
  let panel = document.getElementById('leitfaden-panel');
  if (_leitfadenOpen) {
    if (!panel) _createLeitfadenPanel();
    panel = document.getElementById('leitfaden-panel');
    panel.style.display = '';
    _updateLeitfadenStatus();
  } else {
    if (panel) panel.style.display = 'none';
  }
}

function _createLeitfadenPanel() {
  const panel = document.createElement('div');
  panel.id = 'leitfaden-panel';
  panel.style.cssText = 'position:fixed;top:90px;right:16px;width:320px;max-height:calc(100vh - 110px);z-index:1500;background:var(--surface,#23262f);border:1px solid var(--border,#333844);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column;font-family:inherit;';

  // Header — verschiebbar (Drag-Handle)
  let html = '<div id="lf-drag-handle" style="padding:12px 16px;border-bottom:1px solid var(--border,#333);display:flex;align-items:center;justify-content:space-between;cursor:grab;user-select:none;">';
  html += '<span style="font-size:13px;font-weight:600;color:var(--text,#e8eaf0);">📋 Leitfaden <span style="font-size:9px;color:var(--muted,#78909c);font-weight:400;">— verschiebbar</span></span>';
  html += '<div style="display:flex;gap:6px;align-items:center;"><span id="lf-progress" style="font-size:10px;color:var(--muted,#78909c);font-family:\'DM Mono\',monospace;"></span>';
  html += '<button onclick="toggleLeitfaden()" style="background:none;border:none;color:var(--muted,#78909c);cursor:pointer;font-size:15px;padding:0;line-height:1;">✕</button></div></div>';

  html += '<div id="lf-steps" style="overflow-y:auto;padding:8px 12px;flex:1;min-height:0;">';
  LEITFADEN_STEPS.forEach((step, i) => {
    html += '<div id="' + step.id + '" class="lf-step-item" style="padding:10px 12px;margin-bottom:6px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#181a20);transition:.3s;">';
    html += '<div style="display:flex;align-items:center;gap:8px;">';
    html += '<span class="lf-check" data-step="' + i + '" style="font-size:14px;flex-shrink:0;cursor:pointer;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:.15s;" title="Klicken zum Abhaken">○</span>';
    html += '<span class="lf-step-title" style="font-size:12px;font-weight:500;color:var(--text,#e8eaf0);cursor:pointer;flex:1;">' + step.title + '</span>';
    html += '<span class="lf-step-num" style="font-size:9px;color:var(--muted,#555);font-family:\'DM Mono\',monospace;">' + (i+1) + '/' + LEITFADEN_STEPS.length + '</span></div>';
    // Bestätigungstext (wird bei erledigt eingeblendet)
    html += '<div class="lf-done-text" style="display:none;margin-top:4px;padding:4px 0 0 30px;font-size:10px;color:#81c784;line-height:1.4;"></div>';
    // Detailtext (wird beim aktiven/nächsten Schritt gezeigt)
    html += '<div class="lf-detail" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#333);font-size:11px;color:var(--muted,#78909c);line-height:1.6;">' + step.text + '</div>';
    html += '</div>';
  });
  html += '</div>';

  panel.innerHTML = html;
  document.body.appendChild(panel);

  // Drag & Drop
  const handle = document.getElementById('lf-drag-handle');
  let isDragging = false, dragOffX = 0, dragOffY = 0;
  handle.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    handle.style.cursor = 'grabbing';
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    let x = e.clientX - dragOffX, y = e.clientY - dragOffY;
    x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - 60));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', function() {
    if (isDragging) { isDragging = false; handle.style.cursor = 'grab'; }
  });

  // Klick auf Checkbox → manuell abhaken
  panel.querySelectorAll('.lf-check').forEach(chk => {
    chk.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.step);
      if (!_leitfadenManualChecks) window._leitfadenManualChecks = {};
      _leitfadenManualChecks[idx] = !_leitfadenManualChecks[idx];
      _updateLeitfadenStatus();
    });
  });

  // Klick auf Titel → Detail auf-/zuklappen + zum Tab springen
  panel.querySelectorAll('.lf-step-item').forEach((item, i) => {
    item.querySelector('.lf-step-title').addEventListener('click', function(e) {
      const detail = item.querySelector('.lf-detail');
      const wasOpen = detail.style.display !== 'none';
      _leitfadenUserToggled = true;
      // Alle anderen zuklappen
      panel.querySelectorAll('.lf-detail').forEach((d, j) => {
        if (j !== i) d.style.display = 'none';
      });
      detail.style.display = wasOpen ? 'none' : '';
      if (!wasOpen) {
        setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      }
      _leitfadenGoTo(i);
    });
  });
}
window._leitfadenManualChecks = {};
let _leitfadenUserToggled = false;

function _leitfadenGoTo(idx) {
  const step = LEITFADEN_STEPS[idx];
  if (step.tab && typeof setLeftTab === 'function') {
    setLeftTab(step.tab);
  }
}

function _updateLeitfadenStatus() {
  const panel = document.getElementById('leitfaden-panel');
  if (!panel) return;

  // Sequenzielles Gating: Schritt gilt nur als erledigt wenn alle vorherigen auch erledigt sind
  let sequentialDone = 0;
  let firstOpen = -1;
  const stepStates = LEITFADEN_STEPS.map((step, i) => {
    const rawDone = step.check() || (window._leitfadenManualChecks && window._leitfadenManualChecks[i]);
    return rawDone;
  });

  // Sequenziell durchgehen — Schritt ist nur "done" wenn alle vorherigen auch done
  const effectiveDone = [];
  for (let i = 0; i < stepStates.length; i++) {
    if (stepStates[i] && (i === 0 || effectiveDone[i-1])) {
      effectiveDone[i] = true;
      sequentialDone++;
    } else {
      effectiveDone[i] = false;
      if (firstOpen < 0) firstOpen = i;
    }
  }
  if (firstOpen < 0) firstOpen = stepStates.length; // alle erledigt

  // Wenn ein neuer Schritt aktiv wird, UserToggle zurücksetzen
  if (window._leitfadenLastFirstOpen !== undefined && window._leitfadenLastFirstOpen !== firstOpen) {
    _leitfadenUserToggled = false;
  }
  window._leitfadenLastFirstOpen = firstOpen;

  LEITFADEN_STEPS.forEach((step, i) => {
    const el = document.getElementById(step.id);
    if (!el) return;
    const check = el.querySelector('.lf-check');
    const detail = el.querySelector('.lf-detail');
    const doneTextEl = el.querySelector('.lf-done-text');
    const isDone = effectiveDone[i];
    const isNext = (i === firstOpen);
    const isFuture = (i > firstOpen);

    // Manuell aufgeklappten Detail-State merken
    const isManuallyOpen = detail.style.display !== 'none' && !isNext;

    if (isDone) {
      // Erledigt — grünes Häkchen, Bestätigungstext, anklickbar zum Aufklappen
      check.textContent = '✓';
      check.style.background = 'rgba(76,175,80,0.15)';
      check.style.color = '#81c784';
      el.style.opacity = '0.75';
      el.style.borderColor = 'rgba(76,175,80,0.2)';
      el.style.background = 'rgba(76,175,80,0.04)';
      el.style.cursor = 'pointer';
      if (!isManuallyOpen) detail.style.display = 'none';
      if (doneTextEl && step.doneText) {
        try { doneTextEl.textContent = step.doneText(); } catch(e) { doneTextEl.textContent = ''; }
        doneTextEl.style.display = doneTextEl.textContent ? '' : 'none';
      }
    } else if (isNext) {
      // Nächster Schritt — hervorgehoben, Detail automatisch offen
      check.textContent = '▸';
      check.style.background = 'rgba(255,152,0,0.15)';
      check.style.color = '#ffb74d';
      el.style.opacity = '1';
      el.style.borderColor = 'var(--accent,#ff9800)';
      el.style.background = 'rgba(255,152,0,0.06)';
      el.style.cursor = 'pointer';
      if (!_leitfadenUserToggled) detail.style.display = '';
      if (doneTextEl) doneTextEl.style.display = 'none';
      // Auto-scroll zum nächsten Schritt (nur beim ersten Mal)
      if (!_leitfadenUserToggled) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } else {
      // Zukünftig — sichtbar aber dezent, geschlossen, anklickbar
      check.textContent = '○';
      check.style.background = '';
      check.style.color = 'var(--muted,#555)';
      el.style.opacity = '0.55';
      el.style.borderColor = 'var(--border,#333)';
      el.style.background = 'var(--bg,#181a20)';
      el.style.cursor = 'pointer';
      if (!isManuallyOpen) detail.style.display = 'none';
      if (doneTextEl) doneTextEl.style.display = 'none';
    }
  });

  const prog = document.getElementById('lf-progress');
  if (prog) prog.textContent = sequentialDone + '/' + LEITFADEN_STEPS.length;
}

// Status periodisch aktualisieren wenn Leitfaden offen
setInterval(() => { if (_leitfadenOpen) _updateLeitfadenStatus(); }, 3000);


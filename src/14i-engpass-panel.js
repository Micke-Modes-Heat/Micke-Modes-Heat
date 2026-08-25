// ── 14i-engpass-panel.js — Engpass-Zeitstrahl, Reserve-Kurve, Maßnahmen-Board ──
//
// Visualisiert das Ergebnis von 14h-engpass-sweep:
//   • Reserve-Kurve  — Anzahl überlasteter Betriebsmittel je Jahr, ohne/mit Ausbau
//   • Zeitstrahl     — eine Zeile je kritischem Betriebsmittel, Zellen je Jahr
//   • Maßnahmen      — automatisch abgeleiteter Ausbau mit Kosten und Jahr
//
// Das Panel wird beim ersten Öffnen dynamisch erzeugt (kein toter Markup-Block
// in index.html, vgl. Elektro-Panel) und nutzt die vorhandenen float-panel-Stile.

import {
  engpassLetztesErgebnis, engpassGeneriereMassnahmen,
  engpassMassnahmenVerwerfen, engpassVergleich,
  engpassAusloeserFuer, engpassZusammenhaengende, engpassAufloesung,
  engpassBestandsmaengel, engpassKorrekturenUebernehmen, engpassKorrekturenVerwerfen,
} from './14h-engpass-sweep.js';
import { setStromColorMode, openCableInspector } from './05b-stromnetz.js';
import { showHint } from './03c-gebaeude-io.js';
import { ASSETS, ASSET_CFG } from './13a-assets-core.js';
import { openAssetInspector } from './13e-assets-inspector.js';
import { map } from './02b-gebaeude.js';

const PANEL_ID = 'engpass-panel';
let _vergleich = null;   // Ergebnis von engpassVergleich (für die Reserve-Kurve)
let _massnahmen = null;  // Ergebnis von engpassGeneriereMassnahmen
let _horizont = null;    // { von, bis } aus der Toolbar; null = Standard (ab heute)
// Bestandsmängel (von Anfang an zu klein, ohne Auslöser) aus Zeitstrahl und
// Ausbau-Ableitung heraushalten — sie stehen in ihrer eigenen Sektion und
// verzerren sonst sowohl den Fahrplan als auch die Ursache-Wirkungs-Kette.
let _ohneBestand = true;

// Ampelfarbe nach BEIDEN Kriterien — Strombelastbarkeit UND kumuliertem
// Spannungsfall. Nur die Auslastung zu färben wäre irreführend: ein Kabel kann
// bei 45 % Auslastung längst über dem ΔU-Limit liegen und ist dann ein Engpass.
function _zellCol(w) {
  const a = w.auslastungPct || 0, d = w.deltaUKumPct || 0;
  if (a > 100 || d > 3) return '#e53935';
  if (a > 80  || d > 2) return '#fdd835';
  return '#4caf50';
}

const _eur = v => v >= 1e6 ? (v / 1e6).toFixed(2) + ' M€'
               : v >= 1000 ? (v / 1000).toFixed(0) + ' T€'
               : Math.round(v) + ' €';

// Wert einer Stützjahr-Reihe an einem beliebigen Jahr (Treppenfunktion):
// gilt bis zum nächsten Stützjahr weiter.
function _wertBei(reihe, jahr) {
  let treffer = null;
  for (const r of reihe) { if (r.jahr <= jahr) treffer = r; else break; }
  return treffer;
}

// Zeile im Zeitstrahl angeklickt: zum Betriebsmittel auf der Karte springen
// und rechts den Inspector öffnen (Trafo → Asset-Inspector, Kabel → Kabel-Inspector).
export function engpassSpringeZu(id, art) {
  if (art === 'trafo') {
    const asset = (ASSETS.items || []).find(a => a.id === id);
    if (!asset) { showHint('⚠ Betriebsmittel nicht mehr vorhanden.'); return; }
    if (asset.lat != null && asset.lng != null) {
      map.flyTo([asset.lat, asset.lng], Math.max(map.getZoom(), 18), { duration: 1 });
    }
    openAssetInspector(asset);
  } else {
    const edge = (window.stromEdges || []).find(e => e.id === id);
    if (!edge) { showHint('⚠ Kabel nicht mehr vorhanden.'); return; }
    if (edge.layer) map.flyToBounds(edge.layer.getBounds(), { padding: [60, 60], maxZoom: 19, duration: 1 });
    openCableInspector(edge);
  }
}

// ── Panel-Gerüst ─────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel amber-border';
  panel.style.cssText = 'top:70px;min-width:660px;max-width:900px;max-height:84vh;padding:0 18px 14px;overflow:auto;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#f9a825;font-size:12px;font-weight:600;">⏱ Engpass-Fahrplan</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="engpassPanelToggle()">✕</span>
    </div>
    <div id="engpass-panel-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

export function engpassPanelToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar && !engpassLetztesErgebnis()) engpassPanelAktualisieren();
  else if (!sichtbar) _render();
}

// Schieberegler: Von-Jahr + Länge in Jahren → { von, bis }
function _horizontAusReglern() {
  const vonEl = document.getElementById('engpass-von');
  const spanEl = document.getElementById('engpass-bis');
  if (!vonEl || !spanEl) return null;
  const von = parseInt(vonEl.value), spanne = parseInt(spanEl.value);
  if (!Number.isFinite(von) || !Number.isFinite(spanne)) return null;
  return { von, bis: von + spanne };
}

/** Live-Beschriftung beim Ziehen der Regler (rechnet noch nicht neu). */
export function engpassHorizontVorschau() {
  const h = _horizontAusReglern();
  const lbl = document.getElementById('engpass-horizont-label');
  if (h && lbl) lbl.textContent = `${h.von}–${h.bis}`;
}

/** Sweep + Vergleich neu rechnen und Panel zeichnen. */
export function engpassPanelAktualisieren() {
  _ensurePanel().style.display = 'block';
  // Horizont aus den Reglern übernehmen, falls das Panel schon gerendert war
  const h = _horizontAusReglern();
  if (h) _horizont = h;
  _body().innerHTML = '<div style="padding:22px;color:var(--muted);font-size:11px;">⏳ Netz wird über die Stützjahre gerechnet …</div>';
  setTimeout(() => {
    try {
      _vergleich = engpassVergleich(_horizont || {});
      setStromColorMode('engpassjahr');
      _render();
    } catch (err) {
      console.error('Engpass-Panel:', err);
      _body().innerHTML = '<div style="padding:18px;color:#e53935;font-size:11px;">Analyse fehlgeschlagen — Details in der Konsole.</div>';
    }
  }, 50);
}

/** Maßnahmen automatisch ableiten und Panel neu zeichnen. */
export function engpassMassnahmenVorschlagen() {
  _massnahmen = engpassGeneriereMassnahmen({ ohneBestandsmaengel: _ohneBestand });
  if (!_massnahmen) { showHint('⚠ Erst die Engpass-Analyse ausführen.'); return; }
  _vergleich = engpassVergleich(_horizont || {});   // Wirksamkeit nachrechnen
  _render();
  const offen = _massnahmen.ungeloest?.length || 0;
  showHint(`✓ ${_massnahmen.items.length} Maßnahmen vorgeschlagen · ${_eur(_massnahmen.investGesamt)}`
    + (offen ? ` — ⚠ ${offen} Engpass/Engpässe nicht durch Kabeltausch lösbar.` : ' — im Ausbauplaner sichtbar.'));
  setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 5000);
}

/** Bestandsmängel aus Zeitstrahl und Ausbau-Ableitung ein-/ausblenden. */
export function engpassBestandFilter(aus) {
  _ohneBestand = !!aus;
  _render();
}

/**
 * Korrekturvorschläge für die Bestandsmängel in die Bestandsdaten übernehmen
 * (Querschnitt/Stränge bzw. Trafo-kVA direkt, nicht als geplante Maßnahme)
 * und anschließend neu rechnen — die Sektion sollte danach leer sein.
 */
export function engpassKorrekturenAnwenden() {
  const n = engpassKorrekturenUebernehmen();
  if (!n) { showHint('⚠ Keine übernehmbaren Korrekturen — die verbleibenden Fälle brauchen eine Strukturänderung.'); return; }
  showHint(`✓ ${n} Bestandsdimensionierung(en) korrigiert — Netz wird neu gerechnet …`);
  engpassPanelAktualisieren();
  setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 5000);
}

/** Übernommene Bestandskorrekturen wieder zurücknehmen. */
export function engpassKorrekturenZuruecknehmen() {
  const n = engpassKorrekturenVerwerfen();
  showHint(`${n} Bestandskorrektur(en) zurückgenommen.`);
  engpassPanelAktualisieren();
  setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 4000);
}

/** Automatisch erzeugte Maßnahmen wieder entfernen. */
export function engpassMassnahmenZuruecksetzen() {
  const n = engpassMassnahmenVerwerfen();
  _massnahmen = null;
  _vergleich = engpassVergleich(_horizont || {});
  _render();
  showHint(`${n} automatisch erzeugte Maßnahmen entfernt.`);
  setTimeout(() => { if (typeof window.hideHint === 'function') window.hideHint(); }, 4000);
}

function _body() { return document.getElementById('engpass-panel-body'); }

// ── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  const res = engpassLetztesErgebnis();
  const el  = _body();
  if (!el) return;
  if (!res) {
    el.innerHTML = '<div style="padding:18px;color:var(--muted);font-size:11px;">Keine Analyse vorhanden.</div>';
    return;
  }

  const alle      = [...res.kabel, ...res.trafos];
  const kritisch  = alle.filter(x => x.engpassJahr != null);
  const okAnzahl  = alle.length - kritisch.length;

  const bestand   = engpassBestandsmaengel(res);
  const bestandIds = new Set(bestand.map(b => b.item.id));
  const gezeigt   = _ohneBestand ? kritisch.filter(x => !bestandIds.has(x.id)) : kritisch;

  el.innerHTML = `
    ${_toolbar(res, kritisch.length, okAnzahl, bestand.length)}
    ${_reserveKurve()}
    ${_zeitstrahl(res, gezeigt)}
    ${_bestandsmaengel(bestand)}
    ${_massnahmenListe()}
    ${_aufloesung(res)}`;
}

function _toolbar(res, nKrit, nOk, nBestand = 0) {
  const btn = 'padding:5px 10px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:10px;cursor:pointer;';
  return `
  <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:2px 0 10px;">
    <button style="${btn}border-color:#f9a825;color:#f9a825;" data-click="engpassPanelAktualisieren()">↻ Neu rechnen</button>
    <button style="${btn}border-color:#66bb6a;color:#66bb6a;" data-click="engpassMassnahmenVorschlagen()"
      title="Leitet für jedes kritische Betriebsmittel die günstigste ausreichende Ertüchtigung ab und legt sie als geplante Maßnahme an (erscheint im Ausbauplaner).">
      ⚙ Maßnahmen vorschlagen</button>
    <button style="${btn}border-color:#e57373;color:#e57373;" data-click="engpassMassnahmenZuruecksetzen()"
      title="Entfernt alle automatisch erzeugten Maßnahmen wieder.">✕ Auto-Maßnahmen</button>
    <span style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);">
      Horizont
      <input type="range" id="engpass-von" min="2020" max="2060" step="1" value="${res.von}"
        title="Startjahr der Betrachtung"
        style="width:78px;accent-color:#f9a825;cursor:pointer;"
        data-input="engpassHorizontVorschau()" data-change="engpassPanelAktualisieren()">
      <b id="engpass-horizont-label" style="color:#f9a825;font-family:'DM Mono',monospace;min-width:74px;">${res.von}–${res.bis}</b>
      <input type="range" id="engpass-bis" min="5" max="40" step="1" value="${res.bis - res.von}"
        title="Länge des Betrachtungszeitraums in Jahren"
        style="width:78px;accent-color:#f9a825;cursor:pointer;"
        data-input="engpassHorizontVorschau()" data-change="engpassPanelAktualisieren()">
    </span>
    ${nBestand ? `
    <label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);cursor:pointer;"
      title="Betriebsmittel, die schon im Startjahr überlastet sind, ohne dass ein Zubau die Ursache wäre — Bestandsdaten, kein Ausbaubedarf. Ausgeblendet erscheinen sie nur in der eigenen Sektion und werden auch nicht als Maßnahme eingeplant.">
      <input type="checkbox" id="engpass-ohne-bestand" ${_ohneBestand ? 'checked' : ''}
        style="accent-color:#f9a825;cursor:pointer;" data-change="engpassBestandFilter(this.checked)">
      Bestandsmängel ausblenden
    </label>` : ''}
    <span style="margin-left:auto;font-size:10px;color:var(--muted);">
      ${res.jahre.length} Stützjahre ·
      <b style="color:#e53935;">${nKrit}</b> kritisch · <b style="color:#4caf50;">${nOk}</b> ohne Engpass
    </span>
  </div>`;
}

// Reserve-Kurve: überlastete Betriebsmittel je Jahr, ohne vs. mit Ausbau
function _reserveKurve() {
  if (!_vergleich || !_vergleich.jahre.length) return '';
  const { jahre, ohne, mit } = _vergleich;
  const W = 600, H = 96, PL = 34, PB = 16;
  const maxY = Math.max(1, ...ohne, ...mit);
  const x = i => PL + (jahre.length < 2 ? 0 : i * (W - PL - 8) / (jahre.length - 1));
  const y = v => (H - PB) - (v / maxY) * (H - PB - 10);
  const pfad = arr => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [0, Math.round(maxY / 2), maxY].filter((v, i, a) => a.indexOf(v) === i);

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Überlastete Betriebsmittel im Zeitverlauf
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:6px 8px;margin-bottom:12px;overflow-x:auto;">
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;">
      ${ticks.map(t => `
        <line x1="${PL}" y1="${y(t)}" x2="${W - 8}" y2="${y(t)}" stroke="#2a3050" stroke-width="1"/>
        <text x="${PL - 5}" y="${y(t) + 3}" text-anchor="end" font-size="8" fill="#78909c">${t}</text>`).join('')}
      <polyline points="${pfad(ohne)}" fill="none" stroke="#e53935" stroke-width="2"/>
      <polyline points="${pfad(mit)}"  fill="none" stroke="#4caf50" stroke-width="2" stroke-dasharray="5,3"/>
      ${jahre.map((j, i) => i === 0 || i === jahre.length - 1 || jahre.length <= 8
        ? `<text x="${x(i)}" y="${H - 3}" text-anchor="middle" font-size="8" fill="#78909c">${j}</text>` : '').join('')}
    </svg>
    <div style="font-size:9px;color:var(--muted);display:flex;gap:12px;margin-top:2px;">
      <span><span style="display:inline-block;width:14px;height:2px;background:#e53935;vertical-align:middle;"></span> ohne Ausbau</span>
      <span><span style="display:inline-block;width:14px;height:2px;background:#4caf50;vertical-align:middle;"></span> mit geplanten Maßnahmen</span>
      ${_vergleich.restEngpaesse === 0
        ? '<span style="color:#4caf50;">✓ alle Engpässe aufgelöst</span>'
        : `<span style="color:#f9a825;">${_vergleich.restEngpaesse} verbleiben</span>`}
    </div>
  </div>`;
}

// Zeitstrahl: Zeile je kritischem Betriebsmittel, Spalte je Jahr
function _zeitstrahl(res, kritisch) {
  if (!kritisch.length) {
    return `<div style="padding:14px;background:var(--surface2);border-radius:6px;font-size:11px;color:#4caf50;">
      ✓ Im Horizont ${res.von}–${res.bis} wird kein Betriebsmittel zum Engpass.</div>`;
  }
  const jahre = [];
  for (let j = res.von; j <= res.bis; j++) jahre.push(j);
  const zellW = 15;

  const kopf = jahre.map(j => `<div style="flex:0 0 ${zellW}px;font-size:7px;color:#78909c;text-align:center;">
      ${j % 5 === 0 ? String(j).slice(2) : ''}</div>`).join('');

  // WICHTIG: alle festen Spalten mit flex:0 0 — sonst schrumpfen sie als Flex-Items,
  // sobald die Jahresspalten breiter als das Panel werden, und die Bezeichnung
  // verschwindet. Die Namensspalte bleibt beim Querscrollen zusätzlich stehen.
  const nameSpalte = (inhalt, extra = '', titel = '') =>
    `<div class="engpass-name" ${titel ? `title="${titel}"` : ''}
          style="flex:0 0 210px;position:sticky;left:0;background:var(--surface2);z-index:2;
                 padding-right:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${extra}">${inhalt}</div>`;

  const zeilen = kritisch.map(it => {
    const zellen = jahre.map(j => {
      const w = _wertBei(it.reihe, j);
      if (!w) return `<div style="flex:0 0 ${zellW}px;height:12px;background:#161b2e;"
        title="${j}: existiert noch nicht"></div>`;
      const krit = j === it.engpassJahr;
      return `<div title="${it.label} · ${j}: ${w.auslastungPct.toFixed(0)} % Auslastung · ΔU ${(w.deltaUKumPct || 0).toFixed(2)} %"
        style="flex:0 0 ${zellW}px;height:12px;background:${_zellCol(w)};
               ${krit ? 'outline:2px solid #fff;outline-offset:-2px;z-index:1;' : ''}"></div>`;
    }).join('');
    const icon = it.art === 'trafo' ? '⏚' : '⚡';
    // Maßgebender Wert: bei Spannungs-Engpässen ist die Auslastung irrelevant
    const spannung = (it.ursache || '').includes('spannung');
    const massgeb  = spannung ? `ΔU ${it.maxDuPct.toFixed(1)} %` : `${it.maxAuslPct.toFixed(0)} %`;
    // Auslöser (welcher Verbraucher/Erzeuger hat den Engpass verursacht) +
    // welche anderen Engpässe an derselben Ursache hängen — siehe „🔗 Ursache
    // → Maßnahme" weiter unten für die ausführliche Ansicht; hier nur der Hover.
    const ausl = engpassAusloeserFuer(it);
    const zush = engpassZusammenhaengende(it, kritisch);
    const auslTxt = ausl.length
      ? `\nAuslöser: ${ausl.map(a => a.name).join(', ')} (${it.engpassJahr})`
      : '\nAuslöser: nicht eindeutig (mehrere gleichzeitige Änderungen oder bereits ab Horizontbeginn kritisch)';
    const zushTxt = zush.length ? `\nBetrifft auch: ${zush.map(z => z.label).join(', ')}` : '';
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;cursor:pointer;"
      data-click="engpassSpringeZu('${it.id}','${it.art}')"
      title="Auf der Karte anzeigen und Eigenschaften öffnen">
      ${nameSpalte(`${icon} ${it.label}`, 'font-size:9.5px;color:var(--text);',
                   `${it.label} — Engpass ab ${it.engpassJahr}, Ursache: ${it.ursache}${auslTxt}${zushTxt}`)}
      <div style="flex:0 0 34px;font-size:9px;font-weight:700;color:#e53935;text-align:right;">${it.engpassJahr}</div>
      <div style="flex:0 0 26px;font-size:8px;color:${spannung ? '#ce93d8' : '#ffab91'};text-align:center;"
           title="${spannung ? 'Spannungsfall' : 'Strombelastbarkeit'}">${spannung ? 'ΔU' : 'I'}</div>
      <div style="display:flex;">${zellen}</div>
      <div style="flex:0 0 52px;font-size:8.5px;color:var(--muted);text-align:right;">${massgeb}</div>
    </div>`;
  }).join('');

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Engpass-Zeitstrahl · ${kritisch.length} Betriebsmittel · nach Eintrittsjahr sortiert
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:7px 8px;margin-bottom:12px;overflow-x:auto;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
      ${nameSpalte('Betriebsmittel', 'font-size:8px;color:#78909c;')}
      <div style="flex:0 0 34px;font-size:8px;color:#78909c;text-align:right;">ab</div>
      <div style="flex:0 0 26px;font-size:8px;color:#78909c;text-align:center;" title="Ursache: I = Strom, ΔU = Spannungsfall">Urs.</div>
      <div style="display:flex;">${kopf}</div>
      <div style="flex:0 0 52px;font-size:8px;color:#78909c;text-align:right;">maßgeb.</div>
    </div>
    ${zeilen}
  </div>`;
}

// Abgeleitete Maßnahmen mit Jahr und Kosten
function _massnahmenListe() {
  if (!_massnahmen || (!_massnahmen.items.length && !_massnahmen.ungeloest?.length)) {
    return `<div style="font-size:10px;color:var(--muted);padding:8px;background:var(--surface2);border-radius:6px;">
      Noch keine Maßnahmen abgeleitet — „⚙ Maßnahmen vorschlagen" wählt je Engpass die
      günstigste ausreichende Ertüchtigung und legt sie als geplante Maßnahme an.</div>`;
  }
  const zeilen = _massnahmen.items.map(m => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:4px;">
      <span style="flex:0 0 34px;font-size:9.5px;font-weight:700;color:#66bb6a;">${m.jahr}</span>
      <span style="flex:0 0 190px;font-size:9px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${m.label}">${m.art === 'trafo' ? '⏚' : '⚡'} ${m.label}</span>
      <span style="flex:1;font-size:9.5px;color:var(--text);">${m.titel}</span>
      <span style="font-size:9.5px;color:#fdd835;text-align:right;white-space:nowrap;">${_eur(m.kosten)}</span>
    </div>`).join('');
  const ungeloest = (_massnahmen.ungeloest || []).map(u => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:3px 6px;">
      <span style="flex:0 0 34px;font-size:9.5px;font-weight:700;color:#e53935;">${u.engpassJahr}</span>
      <span style="flex:0 0 190px;font-size:9px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${u.label}">⚡ ${u.label}</span>
      <span style="flex:1;font-size:9px;color:#ef9a9a;line-height:1.5;">${u.grund}
        <span style="color:var(--muted);">(${u.maxStromA.toFixed(0)} A nötig, ${u.maxAuslPct.toFixed(0)} % Auslastung)</span></span>
    </div>`).join('');

  const ungeloestBlock = ungeloest ? `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#e53935;margin:10px 0 3px;">
    ⚠ Nicht durch Kabeltausch lösbar · ${_massnahmen.ungeloest.length}
  </div>
  <div style="background:rgba(229,57,53,0.08);border:1px solid rgba(229,57,53,0.35);border-radius:6px;padding:6px 4px;">
    ${ungeloest}
  </div>` : '';

  const ausbauBlock = _massnahmen.items.length ? `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Abgeleiteter Ausbau · ${_massnahmen.items.length} Maßnahmen · Σ ${_eur(_massnahmen.investGesamt)}
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:6px 4px;">
    ${zeilen}
    <div style="font-size:8.5px;color:var(--muted);padding:4px 6px 0;">
      Umsetzung jeweils mit Vorlauf vor dem Engpassjahr · dimensioniert auf das Maximum
      des gesamten Horizonts (kein zweiter Ausbau) · als „geplant" im Ausbauplaner sichtbar.
    </div>
  </div>` : '';

  return ausbauBlock + ungeloestBlock;
}

// Bestandsmängel: schon im Startjahr überlastet, ohne dass ein Zubau die
// Ursache wäre. Kein Ausbaubedarf, sondern eine zu korrigierende Erfassung —
// deshalb Korrektur der Basisdaten statt Maßnahme mit Jahr und Investition.
function _bestandsmaengel(bestand) {
  if (!bestand.length) return '';

  const btn = 'padding:4px 9px;border-radius:5px;border:1px solid var(--border);background:transparent;font-family:inherit;font-size:10px;cursor:pointer;';
  const loesbar = bestand.filter(b => b.vorschlag);

  const zeilen = bestand.map(({ item, vorschlag }) => {
    const icon = item.art === 'trafo' ? '⏚' : '⚡';
    const spannung = (item.ursache || '').includes('spannung');
    const massgeb  = spannung ? `ΔU ${item.maxDuPct.toFixed(1)} %` : `${item.maxAuslPct.toFixed(0)} %`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 6px;cursor:pointer;"
      data-click="engpassSpringeZu('${item.id}','${item.art}')"
      title="Auf der Karte anzeigen und Eigenschaften öffnen">
      <span style="flex:0 0 190px;font-size:9px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${item.label}">${icon} ${item.label}</span>
      <span style="flex:0 0 52px;font-size:8.5px;color:#ef9a9a;text-align:right;">${massgeb}</span>
      <span style="flex:1;font-size:9.5px;color:${vorschlag ? '#66bb6a' : '#ef9a9a'};">
        ${vorschlag ? '→ ' + vorschlag.label : '→ kein Standardquerschnitt reicht — Netzstruktur ändern'}</span>
    </div>`;
  }).join('');

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#f9a825;margin:10px 0 3px;">
    🔧 Bestandsmängel · ${bestand.length} von Anfang an unterdimensioniert
  </div>
  <div style="background:rgba(249,168,37,0.07);border:1px solid rgba(249,168,37,0.3);border-radius:6px;padding:6px 4px;margin-bottom:12px;">
    <div style="font-size:8.5px;color:var(--muted);padding:0 6px 5px;line-height:1.6;">
      Schon im Startjahr ${_horizontVon()} überlastet, ohne dass ein Zubau die Ursache wäre —
      also keine Folge der Entwicklung, sondern eine zu klein erfasste Bestandsdimensionierung.
      Die Korrektur ändert Querschnitt/Stränge bzw. Trafo-Leistung direkt in den Stammdaten,
      <b>nicht</b> als geplante Maßnahme mit Investition.
    </div>
    ${zeilen}
    <div style="display:flex;gap:6px;padding:7px 6px 1px;">
      <button style="${btn}border-color:#66bb6a;color:#66bb6a;" data-click="engpassKorrekturenAnwenden()"
        title="Schreibt die Vorschläge in die Bestandsdaten und rechnet neu.">
        ✓ ${loesbar.length} Korrektur(en) übernehmen</button>
      <button style="${btn}border-color:#e57373;color:#e57373;" data-click="engpassKorrekturenZuruecknehmen()"
        title="Stellt die ursprünglichen Bestandswerte wieder her.">↩ Zurücknehmen</button>
    </div>
  </div>`;
}

function _horizontVon() {
  return engpassLetztesErgebnis()?.von ?? '';
}

// Icon für den Auslöser: Gebäude-Symbol für einen reinen Gebäude-Anschluss,
// sonst das Asset-Icon aus dem Katalog (☀ PV, 🏠 Verbraucher, …).
function _ausloeserIcon(t) {
  return t.kind === 'gebaeude' ? '🏠' : (ASSET_CFG[t.typ]?.icon || '⚡');
}
function _ausloeserGrund(t) {
  if (t.grund === 'ausbau') return 'Kapazitätserweiterung';
  return t.kind === 'gebaeude' ? 'Neubau' : 'Zubau';
}

// Ursache → Wirkung: je Auslöser (neuer/erweiterter Verbraucher oder Erzeuger)
// alle davon betroffenen Engpässe mit der jeweils daraus abgeleiteten
// Ausbau-Maßnahme — beantwortet "welcher Zubau führt zu welcher Infra-Maßnahme".
function _aufloesung(res) {
  // Bestandsmängel bleiben hier außen vor — sie haben per Definition keinen
  // Auslöser und stehen mit ihrer Korrektur in der eigenen Sektion.
  const { gruppen, ohneAusloeser } = engpassAufloesung(res, _massnahmen?.items);
  if (!gruppen.length && !ohneAusloeser.length) return '';

  const zeilen = gruppen.map(g => {
    const betroffen = g.betroffene.map(b => {
      const it = b.item, m = b.massnahme;
      const mIcon = it.art === 'trafo' ? '⏚' : '⚡';
      const mTxt  = m ? `${m.titel} · ${_eur(m.kosten)}` : 'noch keine Maßnahme abgeleitet';
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0 2px 20px;font-size:9px;">
        <span style="color:var(--muted);">↳</span>
        <span style="flex:0 0 190px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              title="${it.label}">${mIcon} ${it.label} <span style="color:var(--muted);">(${it.engpassJahr})</span></span>
        <span style="flex:1;text-align:right;color:${m ? '#66bb6a' : '#f9a825'};white-space:nowrap;">${mTxt}</span>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text);">
        <span>${_ausloeserIcon(g.trigger)}</span>
        <b>${g.trigger.name}</b>
        <span style="font-size:8.5px;color:var(--muted);">${_ausloeserGrund(g.trigger)} · ${g.jahr}</span>
      </div>
      ${betroffen}
    </div>`;
  }).join('');

  const ohneBlock = ohneAusloeser.length ? `
    <div style="font-size:9px;color:var(--muted);padding:4px 6px 0;">
      ${ohneAusloeser.length} Engpass/Engpässe ohne eindeutig identifizierbaren Auslöser
      (mehrere gleichzeitige Änderungen, oder bereits ab Horizontbeginn kritisch).
    </div>` : '';

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:10px 0 3px;">
    🔗 Ursache → Maßnahme · ${gruppen.length} Auslöser
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:8px 6px;">
    ${zeilen}${ohneBlock}
  </div>`;
}

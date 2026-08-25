// ── 13z-schwellen-panel.js — Schwellentreppe je Variante ─────────────────────
//
// App-seitige Schicht zu lib/netz-schwellen.js. Setzt die beiden Vorarbeiten
// zusammen:
//   • Struktur (Komponenten/Ring, Trafo-Zuordnung, Kapazität)  → netz-schwellen
//   • Zahlen (Rückspeisung je Knoten, je Variante eingefroren) → 13y/D
//
// Das ist das Screening der zweistufigen Bewertung: billig, über alle Varianten,
// und es beantwortet die Portfoliofrage "Bestand ertüchtigen oder eigenes
// Erzeugungsnetz". Die Vertiefung (zeitlicher Verlauf, konkrete Kabel) macht
// danach der Engpass-Sweep in 14h — aber nur noch für die Varianten, die hier
// überleben.

import { schwellenAnalyse, schwellenFazit, SCHWELLEN_KOSTEN } from './lib/netz-schwellen.js';
import { ASSETS } from './13a-assets-core.js';
import { lastgangSchnappschuesse, lastgangSchnappschuesseAlleVarianten } from './13y-lastgang-schnappschuss.js';
import { showHint } from './03c-gebaeude-io.js';
import { activateVariant, activeVariantId } from './01-globals-varianten.js';
import { engpassPanelAktualisieren } from './14i-engpass-panel.js';

const PANEL_ID = 'schwellen-panel';

/**
 * Zugesagte Einspeiseleistung am Netzanknüpfungspunkt.
 *
 * Kommt aus der PV-/Strom-Analyse, NICHT aus einer Asset-Eigenschaft — dort ist
 * das Feld gepflegt (09d). Ohne diesen Wert fällt die Kapazität auf die Summe
 * der Trafoleistungen zurück, was regelmäßig ZU GROSSZÜGIG ist: das NAP-Limit
 * liegt fast immer darunter.
 */
function _napLimitKw() {
  const ausDom = id => {
    const v = parseFloat(document.getElementById(id)?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  return ausDom('strom-nap-einsp-kw')
      ?? ausDom('pva-nap-einsp')
      ?? (Number.isFinite(window.elNapMaxEinspKw) ? window.elNapMaxEinspKw : null);
}

/** Rückspeisung je Knoten aus einem Schnappschuss: Betrag des negativen Minimums. */
function _rueckJeKnoten(schnappschuss) {
  const out = {};
  for (const k of (schnappschuss?.knoten || [])) {
    out[k.id] = Math.abs(Math.min(0, k.minV || 0));
  }
  return out;
}

// ── Panel ────────────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel amber-border';
  panel.style.cssText = 'top:70px;min-width:600px;max-width:860px;max-height:84vh;padding:0 18px 14px;overflow:auto;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#4dd0e1;font-size:12px;font-weight:600;">🪜 Schwellentreppe</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="schwellenPanelToggle()">✕</span>
    </div>
    <div id="schwellen-panel-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

export function schwellenPanelToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar) schwellenPanelRender();
}

/** Schnappschüsse aller Varianten holen und danach neu zeichnen. */
export function schwellenAnalyseStarten() {
  showHint('🪜 Schwellenanalyse: Varianten werden durchgerechnet …');
  setTimeout(() => {
    try {
      lastgangSchnappschuesseAlleVarianten();
    } catch (err) {
      console.error('Schwellenanalyse:', err);
      showHint('⚠ Schwellenanalyse fehlgeschlagen — Details in der Konsole.');
      return;
    }
    schwellenPanelRender();
    if (typeof window.hideHint === 'function') window.hideHint();
  }, 50);
}

/**
 * Vertiefung: von der Screening-Stufe in die Tiefenanalyse wechseln.
 *
 * Der Engpass-Sweep rechnet auf dem globalen Zustand, die Variante muss also
 * aktiv sein. Deshalb wird hier umgeschaltet — anders als beim Screening, das
 * bewusst ohne Wechsel auskommt.
 *
 * varianteId: '' bzw. null = Basisdaten
 */
export function schwellenVertiefen(varianteId) {
  const id = (varianteId === '' || varianteId === 'null') ? null : varianteId;
  if ((activeVariantId ?? null) !== id) activateVariant(id);
  showHint('🔬 Vertiefung: zeitlicher Engpass-Verlauf wird gerechnet …');
  setTimeout(() => {
    try {
      engpassPanelAktualisieren();
    } catch (err) {
      console.error('Vertiefung:', err);
      showHint('⚠ Engpass-Analyse fehlgeschlagen — Details in der Konsole.');
      return;
    }
    schwellenPanelRender();   // aktive Variante hat gewechselt
  }, 50);
}

export function schwellenPanelRender() {
  const el = document.getElementById('schwellen-panel-body');
  if (!el) return;

  const schnapp = lastgangSchnappschuesse();
  const napLimit = _napLimitKw();

  if (!schnapp.size) {
    el.innerHTML = `${_kopf(napLimit)}
      <div style="background:var(--surface2);border-radius:6px;padding:10px;font-size:9.5px;color:var(--muted);line-height:1.7;">
        Noch keine Lastgänge eingefroren. Jede Variante muss dafür kurz aktiviert
        werden — das baut das Stromnetz jedes Mal neu auf.
        <div style="margin-top:7px;">
          <button data-click="schwellenAnalyseStarten()"
            style="padding:4px 10px;border-radius:5px;border:1px solid #4dd0e1;background:transparent;
                   color:#4dd0e1;font-family:inherit;font-size:10px;cursor:pointer;">
            🪜 Analyse starten</button>
        </div>
      </div>`;
    return;
  }

  const bloecke = [...schnapp.values()].map(s => {
    const analyse = schwellenAnalyse({
      assets: ASSETS.items || [],
      edges: window.stromEdges || [],
      rueckJeKnoten: _rueckJeKnoten(s),
      napLimitKw: napLimit,
    });
    return _variantenBlock(s, analyse);
  }).join('');

  el.innerHTML = `${_kopf(napLimit)}${bloecke}${_fussnote()}`;
}

function _kopf(napLimit) {
  return `
  <div style="display:flex;align-items:center;gap:8px;margin:2px 0 10px;">
    <button data-click="schwellenAnalyseStarten()"
      style="padding:5px 10px;border-radius:5px;border:1px solid #4dd0e1;background:transparent;
             color:#4dd0e1;font-family:inherit;font-size:10px;cursor:pointer;">↻ Neu rechnen</button>
    <span style="margin-left:auto;font-size:10px;color:${napLimit ? 'var(--muted)' : '#f9a825'};">
      ${napLimit
        ? `NAP-Limit ${Math.round(napLimit)} kW`
        : '⚠ kein NAP-Limit gepflegt — Kapazität aus Trafosumme (zu großzügig)'}
    </span>
  </div>`;
}

function _variantenBlock(schnappschuss, analyse) {
  const STUFE = {
    frei:  { col: '#4caf50', txt: 'im Rahmen' },
    trafo: { col: '#f9a825', txt: 'Trafo-Grenze gerissen' },
    nap:   { col: '#e53935', txt: 'NAP-Limit gerissen' },
  };

  const komponenten = analyse.map(({ komponente, befund, varianten }) => {
    const st = STUFE[befund.stufe];
    const kopfZeile = `
      <div style="display:flex;align-items:center;gap:8px;font-size:9.5px;padding:2px 0;">
        <span style="flex:0 0 110px;color:var(--text);">
          ${komponente.napIds.length ? 'NAP-Cluster' : 'Cluster'} · ${komponente.trafoIds.length} Trafo${komponente.trafoIds.length === 1 ? '' : 's'}
        </span>
        <span style="flex:0 0 128px;font-family:'DM Mono',monospace;color:var(--muted);">
          ${Math.round(befund.rueckKW)} / ${Math.round(befund.kapazitaetKW)} kW
          ${befund.quelle === 'trafos' ? '<span title="aus Trafosumme geschätzt">*</span>' : ''}
        </span>
        <span style="flex:0 0 46px;text-align:right;font-family:'DM Mono',monospace;color:${st.col};">
          ${befund.ausgeschoepftPct == null ? '—' : Math.round(befund.ausgeschoepftPct) + ' %'}
        </span>
        <span style="flex:1;color:${st.col};font-size:9px;">${st.txt}</span>
      </div>`;

    if (!varianten.length) return kopfZeile;

    const wege = varianten.filter(w => w.moeglich).map(w => `
      <div style="display:flex;align-items:center;gap:8px;font-size:9px;padding:1px 0 1px 18px;
                  color:${w.guenstigste ? '#66bb6a' : 'var(--muted)'};">
        <span style="flex:0 0 240px;">${w.guenstigste ? '✓ ' : '· '}${w.label}</span>
        <span style="font-family:'DM Mono',monospace;">${_eur(w.kostenEUR)}</span>
      </div>`).join('');

    return kopfZeile + wege;
  }).join('');

  const fazit = schwellenFazit(analyse);
  const fCol = STUFE[fazit.stufe].col;
  const aktiv = (activeVariantId ?? null) === (schnappschuss.varianteId ?? null);

  return `
  <div style="margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;">
      <span style="font-size:10px;color:var(--text);font-weight:600;">${schnappschuss.varianteName}</span>
      <span style="font-weight:400;color:var(--muted);font-size:9px;">· Jahr ${schnappschuss.jahr}</span>
      <span style="color:${fCol};font-size:9px;">${fazit.text}</span>
      ${fazit.guenstigsteSummeEUR > 0
        ? `<span style="color:var(--muted);font-size:9px;font-family:'DM Mono',monospace;">ab ${_eur(fazit.guenstigsteSummeEUR)}</span>`
        : ''}
      <button data-click="schwellenVertiefen('${schnappschuss.varianteId ?? ''}')"
        title="Wechselt zu dieser Variante und rechnet den zeitlichen Engpass-Verlauf — inklusive Kabel, die das Screening nicht prüft."
        style="margin-left:auto;padding:2px 8px;border-radius:4px;font-family:inherit;font-size:9px;cursor:pointer;
               border:1px solid ${aktiv ? '#f9a825' : 'var(--border)'};background:transparent;
               color:${aktiv ? '#f9a825' : 'var(--muted)'};white-space:nowrap;">
        🔬 vertiefen${aktiv ? '' : ' →'}</button>
    </div>
    <div style="background:var(--surface2);border-radius:6px;padding:6px 9px;">
      ${komponenten || '<span style="font-size:9px;color:var(--muted);">keine auswertbare Netzkomponente</span>'}
    </div>
  </div>`;
}

function _fussnote() {
  return `
  <div style="font-size:8.5px;color:var(--muted);padding:2px 6px;line-height:1.7;">
    Rückspeisung gegen die Kapazität am Einspeisepunkt. Ein Erzeugungsnetz ist ein
    Sprungkostenblock — es lohnt erst, wenn genug Erzeugung dahintersteht; die
    Alternative ist, unter der Schwelle zu bleiben und zu stückeln.
    <br>„Günstigste" heißt allein Investition — Betrieb, Redundanz und
    Genehmigungsaufwand stehen hier nicht drin.
    <br><b style="color:#f9a825;">„Im Rahmen" heißt nicht „nichts zu tun":</b>
    geprüft sind hier nur Trafos und Einspeisepunkt. Strombelastbarkeit und
    Spannungsfall der einzelnen Kabel findet erst die Vertiefung (🔬) über den
    zeitlichen Engpass-Verlauf.
    <br>Kostenannahmen: Trafo ${SCHWELLEN_KOSTEN.trafoEurProKVA} €/kVA ·
    NAP ${SCHWELLEN_KOSTEN.napEurProKW} €/kW ·
    Erzeugungsnetz ${SCHWELLEN_KOSTEN.erzeugungsnetzEurProKW} €/kW — grobe Richtwerte.
  </div>`;
}

const _eur = v => v >= 1e6 ? (v / 1e6).toFixed(2) + ' M€'
               : v >= 1000 ? (v / 1000).toFixed(0) + ' T€'
               : Math.round(v) + ' €';

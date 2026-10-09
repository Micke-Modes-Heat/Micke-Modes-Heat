// ── 40-massnahmen-ui.js — Maßnahmen am Objekt (Inspektor für Assets und Kabel) ──
// Schritt 2b des Konzepts Maßnahmenregister: Der Inspektor zeigt die Maßnahmen,
// die das Objekt betreffen, mit Nummer und Stand aus der Maßnahmenliste
// (lib/massnahmen-register.js). Titel, Jahr, Stand und Geltung gelten für die
// ganze Maßnahme; Ziel-Parameter nur für dieses Objekt. „An Maßnahme hängen“
// ergänzt eine bestehende Maßnahme um dieses Objekt.
//
// Eine Oberfläche für Asset- und Kabel-Inspektor. Die Aufrufer geben mit:
//   ctx = { ziel: 'asset'|'kante', schema: [{ key, label, optionen? }], typen: [typKey],
//           standardTyp, objektSchicht, nachAenderung: () => void }

// App-Zustand über window (Live-Accessoren aus main.js) statt Import aus 01 — sonst gerät dieses Modul über
// 05b/13e in den Importzyklus des Altkerns (tests/import-architecture.test.js).
const register = () => window.massnahmenRegister || [];
const abgleichen = () => { try { window.massnahmenAbgleichen?.(); } catch (e) { console.warn('Maßnahmenliste:', e); } };
const massnahmeJahr = m => (typeof window.massnahmeJahr === 'function' ? window.massnahmeJahr(m) : (parseInt(m?.jahr, 10) || null));
import { MR_DRINGLICHKEIT, MR_GEWERKE, mrDringlichkeit, mrDringlichkeitAuto, mrNummer, mrStatusAusStand } from './lib/massnahmen-register.js';
import { ENGPASS_AUTO_TAG } from './lib/engpass-core.js';
import { createId } from './lib/util.js';

export const MASSN_STAND = Object.freeze({
  vorschlag:   { label: 'Vorschlag',   color: '#90a4ae', titel: 'Aus einer Analyse, noch nicht übernommen' },
  empfohlen:   { label: 'Empfohlen',   color: '#4fc3f7', titel: 'Empfehlung im Gutachten' },
  beschlossen: { label: 'Beschlossen', color: '#9575cd', titel: 'Mit Nutzer bzw. Bauherr abgestimmt' },
  umgesetzt:   { label: 'Umgesetzt',   color: '#4caf50', titel: 'Gebaut; wirkt ab ihrem Jahr als Bestand' },
  verworfen:   { label: 'Verworfen',   color: '#9e9e9e', titel: 'Bewusst nicht umgesetzt; wirkt nie' },
});

export const MASSN_TYPEN = Object.freeze({
  Ertuechtigung: { label: 'Ertüchtigung', icon: '⚡', zielParameter: true },
  Austausch:     { label: 'Austausch',    icon: '🔧', zielParameter: true },
  Verlegung:     { label: 'Neuverlegung', icon: '🧵', zielParameter: true },
  Sanierung:     { label: 'Sanierung',    icon: '🔧', zielParameter: true },
  Bau:           { label: 'Neubau/Bau',   icon: '🏗', zielParameter: false },
  Abriss:        { label: 'Abriss',       icon: '🏚', zielParameter: false },
  Rueckbau:      { label: 'Rückbau',      icon: '🏚', zielParameter: false },
  Sonstiges:     { label: 'Sonstiges',    icon: '•',  zielParameter: false },
});
// Ältere Kabel-Maßnahmen trugen 'Ertuecht'
const TYP_ALIAS = { Ertuecht: 'Ertuechtigung' };
export const MASSN_TYPEN_ASSET = ['Ertuechtigung', 'Austausch', 'Sanierung', 'Bau', 'Abriss', 'Sonstiges'];
export const MASSN_TYPEN_KABEL = ['Ertuechtigung', 'Austausch', 'Verlegung', 'Rueckbau', 'Sonstiges'];
const typKey = typ => TYP_ALIAS[typ] || (MASSN_TYPEN[typ] ? typ : 'Sonstiges');
export const massnTyp = typ => MASSN_TYPEN[typKey(typ)];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const euro = n => (Number(n) > 0 ? `${Math.round(Number(n)).toLocaleString('de-DE')} €` : '—');

/** Eintrag der Maßnahmenliste zu einer Objekt-Maßnahme (null, solange noch nicht abgeglichen). */
export function massnahmeEintrag(m) {
  return m?.massnahmeRef != null ? (register().find(e => e.id === m.massnahmeRef) || null) : null;
}
const objektAnzahl = e => Math.max(1, e?._wirkung?.length || 1);
const standVon = (m, e) => e?.stand || (m.status === 'umgesetzt' ? 'umgesetzt' : m.status === 'abgelehnt' ? 'verworfen' : 'empfohlen');

function zeileHtml(m) {
  const e = massnahmeEintrag(m);
  const stand = MASSN_STAND[standVon(m, e)];
  const t = massnTyp(m.typ);
  const n = objektAnzahl(e);
  const kosten = e ? (n > 1 ? e.kosten?.investEur : m.kosten) : m.kosten;
  const jahr = massnahmeJahr(m);
  return `<div class="ins-massn-row" data-m-id="${esc(m.id)}">
    <span class="ins-massn-dot" style="background:${stand.color};" title="${esc(stand.label)}"></span>
    <div class="ins-massn-info">
      <div class="ins-massn-titel">${e ? `<span class="ins-massn-nr">${mrNummer(e.nr)}</span> ` : ''}${t.icon} ${esc(m.titel || '—')}</div>
      <div class="ins-massn-meta">${jahr ?? '—'} · ${euro(kosten)} · <span class="ins-massn-typ-tag">${esc(t.label)}</span> · `
        + `<span style="color:${stand.color};">${esc(stand.label)}</span>`
        + `${n > 1 ? ` · ${n} Objekte` : ''}${window.massnahmeGeltungText?.(m) ? ` · ${window.massnahmeGeltungText(m)}` : ''}</div>
    </div>
    <button class="ins-massn-edit" data-m-id="${esc(m.id)}" title="Bearbeiten">✎</button>
    <button class="ins-massn-del"  data-m-id="${esc(m.id)}" title="${n > 1 ? 'Dieses Objekt aus der Maßnahme nehmen' : 'Löschen'}">×</button>
  </div>`;
}

function listeHtml(obj) {
  const list = obj.massnahmen || [];
  return list.length ? list.map(zeileHtml).join('') : '<div class="ins-massn-empty">Keine Maßnahmen</div>';
}

const opts = (eintraege, gewaehlt) => eintraege.map(([v, l, titel]) =>
  `<option value="${esc(v)}"${v === gewaehlt ? ' selected' : ''}${titel ? ` title="${esc(titel)}"` : ''}>${esc(l)}</option>`).join('');

/** HTML des Abschnitts (Liste, Knöpfe, Formular). Verdrahtung über massnahmenSektionVerdrahten. */
export function massnahmenSektionHtml(obj, ctx) {
  const typen = (ctx.typen || MASSN_TYPEN_ASSET).map(k => [k, `${MASSN_TYPEN[k].icon} ${MASSN_TYPEN[k].label}`]);
  const staende = Object.entries(MASSN_STAND).filter(([k]) => k !== 'vorschlag').map(([k, s]) => [k, s.label, s.titel]);
  const dringl = [['', 'automatisch (aus dem Jahr)'], ...Object.entries(MR_DRINGLICHKEIT)];
  return `<div class="massn-sektion" data-massn-root>
    <div class="ins-massn-list" data-massn-liste>${listeHtml(obj)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="ins-massn-add-btn" data-massn-neu>+ Neue Maßnahme</button>
      <button class="ins-massn-add-btn" data-massn-haengen title="Dieses Objekt einer bestehenden Maßnahme hinzufügen, z. B. einem weiteren Trafo derselben Ertüchtigung">⤷ An Maßnahme hängen</button>
    </div>
    <div class="ins-massn-form" data-massn-haengen-form style="display:none;">
      <select class="ins-field-input" data-f="haengen" aria-label="Bestehende Maßnahme"></select>
      <div class="ins-massn-form-btns">
        <button class="ins-massn-form-cancel" data-massn-haengen-abbrechen>Abbrechen</button>
        <button class="ins-massn-form-save" data-massn-haengen-ok>Hinzufügen</button>
      </div>
    </div>
    <div class="ins-massn-form" data-massn-form style="display:none;">
      <div class="ins-massn-hinweis" data-f="hinweis" style="display:none;"></div>
      <input class="ins-field-input" type="text" data-f="titel" placeholder="Titel der Maßnahme" aria-label="Titel">
      <div class="ins-row-2" style="margin-top:4px;">
        <input class="ins-field-input" type="number" data-f="jahr" placeholder="Jahr" aria-label="Jahr">
        <input class="ins-field-input" type="number" data-f="kosten" placeholder="Kosten €" min="0" aria-label="Kosten in Euro">
      </div>
      <div class="ins-row-2" style="margin-top:4px;">
        <select class="ins-field-input" data-f="typ" aria-label="Art">${opts(typen)}</select>
        <select class="ins-field-input" data-f="stand" aria-label="Stand">${opts(staende)}</select>
      </div>
      <div class="ins-row-2" style="margin-top:4px;">
        <select class="ins-field-input" data-f="dringlichkeit" aria-label="Dringlichkeit" title="Dringlichkeit">${opts(dringl)}</select>
        <select class="ins-field-input" data-f="herkunft" aria-label="Herkunft der Kosten" title="Herkunft der Kosten">${opts([['', 'Kosten: —'], ['kennwert', 'Kosten: Kennwert'], ['schaetzung', 'Kosten: Schätzung']])}</select>
      </div>
      <div class="ins-field-group" style="margin-top:4px;">
        <label class="ins-field-label" title="In welchen Varianten wirkt diese Maßnahme? Ertüchtigungen unterscheiden Varianten typischerweise.">Gilt für</label>
        <select class="ins-field-input" data-f="gilt">${window.massnahmeGeltungOptionen?.() || '<option value="">alle Varianten</option>'}</select>
      </div>
      <input class="ins-field-input" type="text" data-f="begruendung" placeholder="Begründung (warum verworfen?)" aria-label="Begründung" style="display:none;margin-top:4px;">
      <div data-f="zielparameter" style="display:none;"></div>
      <div class="ins-massn-fehler" data-f="fehler" style="display:none;"></div>
      <div class="ins-massn-form-btns">
        <button class="ins-massn-form-cancel" data-massn-abbrechen>Abbrechen</button>
        <button class="ins-massn-form-save" data-massn-speichern>Speichern</button>
      </div>
    </div>
  </div>`;
}

/** Änderung mit Rückgängig; scheitert die Prüfung des Planungszustands, wird wie früher direkt geändert. */
function aendern(label, mutate) {
  const run = window.runPlanningTransaction;
  if (typeof run === 'function') {
    try { run(label, mutate); return; } catch (e) { console.warn(`${label}:`, e); }
  }
  mutate();
  abgleichen();
}

/** Abschnitt verdrahten. `wurzel` ist ein Element, das den Abschnitt enthält. */
export function massnahmenSektionVerdrahten(wurzel, obj, ctx) {
  const root = wurzel?.querySelector?.('[data-massn-root]');
  if (!root) return;
  const $ = sel => root.querySelector(sel);
  const f = name => root.querySelector(`[data-massn-form] [data-f="${name}"]`);
  let editingId = null;

  abgleichen();

  function neuZeichnen() {
    $('[data-massn-liste]').innerHTML = listeHtml(obj);
    zeilenVerdrahten();
    ctx.nachAenderung?.();
  }

  function zielParameter(typ, m) {
    const box = f('zielparameter');
    const schema = ctx.schema || [];
    if (!massnTyp(typ).zielParameter) { box.innerHTML = ''; box.style.display = 'none'; return; }
    if (!schema.length) {
      box.innerHTML = '<div class="ins-newprops-label">Keine einstellbaren Parameter für diesen Typ.</div>';
      box.style.display = '';
      return;
    }
    const wert = k => m?.newProps?.[k] ?? '';
    box.innerHTML = '<div class="ins-newprops-label">Ziel-Parameter dieses Objekts (optional):</div>' + schema.map(s => `
      <div class="ins-field-group">
        <label class="ins-field-label">${esc(s.label)}</label>
        ${s.optionen
          ? `<select class="ins-field-input mf-newprop" data-prop="${esc(s.key)}"><option value="">— unverändert —</option>${s.optionen(wert(s.key))}</select>`
          : `<input class="ins-field-input mf-newprop" type="text" data-prop="${esc(s.key)}" placeholder="${esc(s.label)}" value="${esc(wert(s.key))}">`}
      </div>`).join('');
    box.style.display = '';
  }

  function standGeaendert() {
    const verworfen = f('stand').value === 'verworfen';
    f('begruendung').style.display = verworfen ? '' : 'none';
  }

  function dringlichkeitHinweis() {
    const auto = mrDringlichkeitAuto(f('jahr').value);
    f('dringlichkeit').options[0].textContent = `automatisch${auto ? ` (${MR_DRINGLICHKEIT[auto]})` : ' (aus dem Jahr)'}`;
  }

  function fehler(text) {
    const el = f('fehler');
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
  }

  function formOeffnen(m) {
    editingId = m ? m.id : null;
    const e = massnahmeEintrag(m);
    const n = objektAnzahl(e);
    const hinweis = f('hinweis');
    if (e && n > 1) {
      hinweis.textContent = `${mrNummer(e.nr)} betrifft ${n} Objekte. Titel, Jahr, Kosten und Stand gelten für die ganze Maßnahme, die Ziel-Parameter nur für dieses Objekt.`;
      hinweis.style.display = '';
    } else hinweis.style.display = 'none';
    f('titel').value = m?.titel || '';
    f('jahr').value = m?.jahr || '';
    f('kosten').value = (n > 1 ? e?.kosten?.investEur : m?.kosten) || '';
    const typ = typKey(m?.typ || ctx.standardTyp || (ctx.typen || MASSN_TYPEN_ASSET)[0]);
    if (![...f('typ').options].some(o => o.value === typ)) f('typ').insertAdjacentHTML('beforeend', `<option value="${typ}">${MASSN_TYPEN[typ].icon} ${MASSN_TYPEN[typ].label}</option>`);
    f('typ').value = typ;
    const stand = m ? standVon(m, e) : 'empfohlen';
    // Ein Vorschlag lässt sich nur übernehmen oder verwerfen; er bleibt wählbar, solange er einer ist
    const vorschlagOpt = f('stand').querySelector('option[value="vorschlag"]');
    if (stand === 'vorschlag' && !vorschlagOpt) f('stand').insertAdjacentHTML('afterbegin', `<option value="vorschlag">${MASSN_STAND.vorschlag.label}</option>`);
    if (stand !== 'vorschlag' && vorschlagOpt) vorschlagOpt.remove();
    f('stand').value = stand;
    f('dringlichkeit').value = e?.dringlichkeit || '';
    f('herkunft').value = e?.kosten?.herkunft || '';
    f('begruendung').value = e?.begruendung || '';
    const gilt = f('gilt');
    if (gilt) gilt.value = window.massnahmeGeltungWert?.(m, { schicht: ctx.objektSchicht }) ?? '';
    zielParameter(typ, m);
    standGeaendert();
    dringlichkeitHinweis();
    fehler('');
    $('[data-massn-haengen-form]').style.display = 'none';
    $('[data-massn-form]').style.display = '';
    f('titel').focus();
  }

  function formSchliessen() {
    editingId = null;
    $('[data-massn-form]').style.display = 'none';
  }

  function speichern() {
    const titel = f('titel').value.trim();
    if (!titel) { fehler('Bitte einen Titel eingeben.'); return; }
    const stand = f('stand').value;
    const begruendung = f('begruendung').value.trim();
    if (stand === 'verworfen' && !begruendung) { fehler('Bitte kurz begründen, warum die Maßnahme verworfen wird.'); return; }
    const jahr = parseInt(f('jahr').value, 10) || null;
    const kosten = parseFloat(f('kosten').value) || 0;
    const typ = f('typ').value;
    const giltEl = f('gilt');
    const variante = giltEl ? (giltEl.value || null) : undefined;
    const newProps = {};
    if (massnTyp(typ).zielParameter) {
      f('zielparameter').querySelectorAll('.mf-newprop').forEach(inp => {
        const v = String(inp.value).trim();
        if (v === '') return;
        const n = parseFloat(v.replace(',', '.'));
        newProps[inp.dataset.prop] = Number.isFinite(n) && /^-?[\d.,]+$/.test(v) ? n : v;
      });
    }
    const id = editingId;
    aendern(id ? 'Maßnahme bearbeiten' : 'Maßnahme anlegen', () => {
      if (!obj.massnahmen) obj.massnahmen = [];
      let m = id ? obj.massnahmen.find(x => x.id === id) : null;
      const mehrfach = objektAnzahl(massnahmeEintrag(m)) > 1;
      const felder = { titel, jahr, typ, status: mrStatusAusStand(stand), newProps };
      if (m) {
        Object.assign(m, felder, variante !== undefined ? { variante } : {});
        if (!mehrfach) m.kosten = kosten;
        // Bearbeitet = eigene Maßnahme: „Maßnahmen vorschlagen“ (14h) ersetzt sie nicht mehr
        delete m[ENGPASS_AUTO_TAG];
      } else {
        m = { id: createId('m'), ...felder, kosten, dependsOn: [], phaseId: null, ...(variante !== undefined ? { variante } : {}) };
        obj.massnahmen.push(m);
      }
      abgleichen();
      // Felder, die nur die Maßnahme kennt
      const e = massnahmeEintrag(m);
      if (e) {
        e.stand = stand === 'vorschlag' && !m[ENGPASS_AUTO_TAG] ? 'empfohlen' : stand;
        e.dringlichkeit = f('dringlichkeit').value || null;
        e.kosten = { ...(e.kosten || {}), herkunft: f('herkunft').value || null, ...(mehrfach ? { investEur: kosten } : {}) };
        e.begruendung = stand === 'verworfen' ? begruendung : (e.begruendung || '');
      }
    });
    window.markiereVarianteGeaendert?.();
    formSchliessen();
    neuZeichnen();
  }

  function haengenOeffnen() {
    formSchliessen();
    const eigene = new Set((obj.massnahmen || []).map(m => m.massnahmeRef).filter(Boolean));
    const kandidaten = register()
      .filter(e => !eigene.has(e.id) && e.stand !== 'verworfen')
      .sort((a, b) => (a.nr ?? 0) - (b.nr ?? 0));
    const sel = $('[data-massn-haengen-form] [data-f="haengen"]');
    sel.innerHTML = kandidaten.length
      ? kandidaten.map(e => `<option value="${esc(e.id)}">${mrNummer(e.nr)} · ${esc(e.titel || '—')} (${esc(MR_GEWERKE[e.gewerk] || '')}${e.jahr ? `, ${e.jahr}` : ''}${objektAnzahl(e) > 1 ? `, ${objektAnzahl(e)} Objekte` : ''})</option>`).join('')
      : '<option value="">Keine andere Maßnahme vorhanden</option>';
    $('[data-massn-haengen-ok]').disabled = !kandidaten.length;
    $('[data-massn-haengen-form]').style.display = '';
  }

  function haengen() {
    const e = register().find(x => x.id === $('[data-massn-haengen-form] [data-f="haengen"]').value);
    if (!e) return;
    let neu = null;
    aendern('An Maßnahme hängen', () => {
      if (!obj.massnahmen) obj.massnahmen = [];
      e.mehrfach = true;
      neu = {
        id: createId('m'), titel: e.titel, typ: e.art || 'Sonstiges', jahr: e.jahr ?? null, phaseId: e.phaseId ?? null,
        kosten: 0, status: mrStatusAusStand(e.stand), newProps: {}, dependsOn: [], massnahmeRef: e.id,
        ...('variante' in e ? { variante: e.variante } : {}),
      };
      obj.massnahmen.push(neu);
      abgleichen();
    });
    $('[data-massn-haengen-form]').style.display = 'none';
    neuZeichnen();
    // Gleich die Ziel-Parameter für dieses Objekt anbieten
    const m = (obj.massnahmen || []).find(x => x.id === neu?.id);
    if (m && massnTyp(m.typ).zielParameter && (ctx.schema || []).length) formOeffnen(m);
  }

  function loeschen(id) {
    aendern('Maßnahme entfernen', () => {
      obj.massnahmen = (obj.massnahmen || []).filter(x => x.id !== id);
      abgleichen();
    });
    if (editingId === id) formSchliessen();
    neuZeichnen();
  }

  function zeilenVerdrahten() {
    root.querySelectorAll('[data-massn-liste] .ins-massn-edit').forEach(btn => {
      btn.onclick = () => { const m = (obj.massnahmen || []).find(x => x.id === btn.dataset.mId); if (m) formOeffnen(m); };
    });
    root.querySelectorAll('[data-massn-liste] .ins-massn-del').forEach(btn => {
      btn.onclick = () => loeschen(btn.dataset.mId);
    });
  }

  $('[data-massn-neu]').addEventListener('click', () => formOeffnen(null));
  $('[data-massn-haengen]').addEventListener('click', haengenOeffnen);
  $('[data-massn-haengen-abbrechen]').addEventListener('click', () => { $('[data-massn-haengen-form]').style.display = 'none'; });
  $('[data-massn-haengen-ok]').addEventListener('click', haengen);
  $('[data-massn-abbrechen]').addEventListener('click', formSchliessen);
  $('[data-massn-speichern]').addEventListener('click', speichern);
  f('typ').addEventListener('change', ev => {
    const m = (obj.massnahmen || []).find(x => x.id === editingId);
    zielParameter(ev.target.value, m);
  });
  f('stand').addEventListener('change', standGeaendert);
  f('jahr').addEventListener('input', dringlichkeitHinweis);
  $('[data-massn-form]').addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') speichern();
    if (ev.key === 'Escape') formSchliessen();
  });
  zeilenVerdrahten();
}

/** Für spätere Ansichten: wirksame Dringlichkeit eines Eintrags als Text. */
export function massnahmeDringlichkeitText(e) {
  const d = mrDringlichkeit(e);
  return d ? MR_DRINGLICHKEIT[d] : '';
}

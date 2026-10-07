// ── 33-varianten-ui.js — Varianten sichtbar und bedienbar machen ─────────────
//
// Leitbild (lib/varianten-regeln.js): Eine Variante = gemeinsamer Stamm
// (Bestand + was ohnehin kommt) + ihr Paket eigener Entscheidungen.
// Dieses Modul zeigt an jeder Stelle, wo eine Änderung wirkt:
//
//   Kopfleiste    Variantenauswahl als Menü (Herkunft, Zweck, Stand, ★ Gutachten)
//   Banner        immer sichtbar, auch im Hauptplan
//   Dialog        „Neue Variante“ mit Ausgangspunkt, Zweck und — beim ersten
//                 Abzweigen — Sortierung der Zukunftsobjekte
//   Rückmeldung   nach dem Anlegen: wo ist das Objekt gelandet? (umhängbar)
//   Kennzeichen   „nur Hauptplan“ / „alle Varianten“ in Inspektor und Panels
//   Vergleich     Übersicht „Was die Varianten unterscheidet“
//   Zeitstrahl    Stamm und je Variante eine Spur
//   Stempel       Ergebnisse, die für eine andere Variante gerechnet wurden
//
// Den Zustand hält 01-globals-varianten.js; hier wird nur gelesen und über
// dessen Funktionen geändert.

import {
  varianten, activeVariantId, gutachtenVariante, hauptplanZweck, massnahmenAblage,
  baseStromNetzSnapshot, aktiverVariantenName, aktiverVariantKey, variantenName,
  aktiveVarianteNetzEigen, variantenKennzahlStatus, setVarianteNetzEigen,
  massnahmeJahr, basisJahr, gebaeude, activateVariant, addVariante,
  markiereGutachtenVariante, renameVariante, deleteVariante, setVariantenZweck,
  baseErzeugerSnapshot, baseGebaeudePv,
} from './01-globals-varianten.js';
import { currentViewMode } from './04a-ui-panels.js';
import { SCHICHT, SCHICHT_META, normSchicht } from './lib/schichten.js';
import {
  HAUPTPLAN_NAME, variantKey, ergebnisStempel, stempelAbweichung, datumKurz,
  massnahmeStandardVariante, zeitstrahlEintraege,
} from './lib/varianten-regeln.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsArg = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const idArg = id => (id == null ? 'null' : `'${jsArg(id)}'`);

// Live-Werte: window.* sind für die Globals Live-Accessoren (main.js).
const _aktivId = () => (typeof window !== 'undefined' && 'activeVariantId' in window) ? window.activeVariantId : activeVariantId;
const _gutachten = () => (typeof window !== 'undefined' && 'gutachtenVariante' in window) ? window.gutachtenVariante : gutachtenVariante;
const _varianten = () => (typeof window !== 'undefined' && Array.isArray(window.varianten)) ? window.varianten : varianten;
const _jahr = () => (typeof window !== 'undefined' && window.globalYear) || new Date().getFullYear();
const _assets = () => window.ASSETS?.items || [];

/** Alle Varianten einschließlich Hauptplan, in Anzeigereihenfolge. */
function _alle() {
  return [
    { id: null, key: 'base', name: variantenName(null), zweck: _hauptplanZweck(), herkunft: null, rec: null },
    ..._varianten().map(v => ({ id: v.id, key: v.id, name: v.name, zweck: v.zweck || '', herkunft: v.herkunft || null, rec: v })),
  ];
}
function _hauptplanZweck() { return hauptplanZweck; }

// ── Wirkungs-Kennzeichen ─────────────────────────────────────────────────────

/** art: 'variante' | 'alle' | 'bestand' */
export function wirkungChipHtml(art, text) {
  const t = text || (art === 'variante' ? `🎯 nur ${esc(aktiverVariantenName())}`
    : art === 'bestand' ? '🏛 Bestand · alle Varianten' : '📈 alle Varianten');
  const titel = art === 'variante'
    ? 'Gilt nur in der aktiven Variante. Andere Varianten sehen diese Änderung nicht.'
    : 'Gehört zum gemeinsamen Stamm: Änderungen wirken in allen Varianten.';
  return `<span class="wirkung-chip ${art}" title="${titel}">${t}</span>`;
}

export function wirkungChipFuerSchicht(schicht) {
  const s = normSchicht(schicht);
  return wirkungChipHtml(s === SCHICHT.ENTSCHEIDUNG ? 'variante' : s === SCHICHT.BESTAND ? 'bestand' : 'alle');
}

/** Zeile über Dach-PV-Panels: Dachdaten gemeinsam, Belegung je Variante. */
export function pvBelegungWirkungHtml(ort) {
  const kompakt = ort === 'pvm';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:10.5px;color:var(--muted);
      ${kompakt ? 'padding:6px 10px;border-bottom:1px solid var(--border);background:var(--surface);' : 'margin:2px 0 8px;'}">
    <span>PV-Belegung</span>${wirkungChipHtml('variante')}
    <span>· Dachform und Neigung</span>${wirkungChipHtml('alle')}
  </div>`;
}

// Kennzeichen in den Wärme-Panels (Platzhalter data-wirkung in index.html)
function _waermeKennzeichenRendern() {
  const id = _aktivId();
  document.querySelectorAll('[data-wirkung="erzeuger"]').forEach(el => {
    el.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--muted);">
      <span>Erzeuger</span>${wirkungChipHtml('variante')}</div>`;
  });
  document.querySelectorAll('[data-wirkung="waermenetz"]').forEach(el => {
    let inhalt;
    if (id == null) {
      inhalt = `<span>Trasse</span>${wirkungChipHtml('alle', '📈 alle Varianten ohne eigenes Netz')}
        <span>· Temperaturen</span>${wirkungChipHtml('variante')}`;
    } else if (aktiveVarianteNetzEigen()) {
      inhalt = `<span>Trasse</span>${wirkungChipHtml('variante', `🎯 eigenes Netz · nur ${esc(aktiverVariantenName())}`)}
        <button data-click="variantenNetzEigen(false)" style="font:inherit;font-size:10px;padding:1px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;"
          title="Die eigene Trasse dieser Variante verwerfen und wieder das gemeinsame Netz verwenden">gemeinsames Netz übernehmen</button>`;
    } else {
      inhalt = `<span>Trasse</span>${wirkungChipHtml('alle', '📈 gemeinsam mit allen Varianten')}
        <button data-click="variantenNetzEigen(true)" style="font:inherit;font-size:10px;padding:1px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;"
          title="Ab jetzt eine eigene Trasse nur für diese Variante zeichnen — z. B. ein anderes Versorgungsgebiet">eigenes Netz für diese Variante</button>
        <span>· Temperaturen</span>${wirkungChipHtml('variante')}`;
    }
    el.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--muted);">${inhalt}</div>`;
  });
}

export function variantenNetzEigen(an) {
  if (!an && !confirm(`Die eigene Trasse von „${aktiverVariantenName()}“ verwerfen und das gemeinsame Netz übernehmen?`)) return;
  setVarianteNetzEigen(an);
  _waermeKennzeichenRendern();
}

// ── Maßnahmen: Geltungsbereich ───────────────────────────────────────────────

/** Optionen für „gilt für“ im Maßnahmen-Formular ('' = alle Varianten). */
export function massnahmeGeltungOptionen() {
  return [`<option value="">alle Varianten</option>`,
    ..._alle().map(v => `<option value="${esc(v.key)}">nur ${esc(v.name)}${v.key === aktiverVariantKey() ? ' (aktiv)' : ''}</option>`)].join('');
}

/** Vorbelegung des Formulars: gespeicherter Wert, sonst die Regel. */
export function massnahmeGeltungWert(m, asset) {
  if (m && 'variante' in m) return m.variante ?? '';
  return massnahmeStandardVariante({ objektSchicht: asset?.schicht, typ: m?.typ, aktivKey: aktiverVariantKey() }) ?? '';
}

export function massnahmeGeltungText(m) {
  const v = (m && 'variante' in m) ? m.variante : undefined;
  if (v == null) return v === undefined ? '' : '<span style="color:#f9a825;">alle Varianten</span>';
  return `<span style="color:#66bb6a;">nur ${esc(variantenName(v))}</span>`;
}

// ── Kopfleiste ───────────────────────────────────────────────────────────────

export function variantenLeisteHtml() {
  const alle = _alle();
  const key = aktiverVariantKey();
  const pos = alle.findIndex(v => v.key === key) + 1;
  const stern = _gutachten() === key ? ' ★' : '';
  return `<button class="var-wahl" data-click="variantenMenuToggle()" title="Variante wechseln, anlegen, vergleichen — ★ = geht ins Gutachten">
    <span class="var-wahl-name">${esc(aktiverVariantenName())}${stern}</span>
    ${alle.length > 1 ? `<small>${pos} von ${alle.length}</small>` : ''} ▾</button>`;
}

let _menuOffen = false;

function _eigeneEntscheidungen(v) {
  const aktiv = v.key === aktiverVariantKey();
  const items = aktiv
    ? _assets().filter(a => normSchicht(a.schicht) === SCHICHT.ENTSCHEIDUNG)
    : ((v.rec ? v.rec.stromnetz : baseStromNetzSnapshot)?.items || []);
  const massn = aktiv
    ? _assets().reduce((n, a) => n + (a.massnahmen || []).filter(m => m?.variante === v.key).length, 0)
      + (window.stromEdges || []).reduce((n, e) => n + (e.massnahmen || []).filter(m => m?.variante === v.key).length, 0)
    : (massnahmenAblage[v.key] || []).length;
  return { anlagen: items.length, massnahmen: massn };
}

function _herkunftText(v) {
  if (v.id == null) return 'Grundlage des Projekts';
  const h = v.herkunft;
  if (!h) return 'angelegt vor der Umstellung';
  const am = h.datum ? ` am ${datumKurz(h.datum)}` : '';
  if (h.art === 'optimierer') return `aus der Optimierung${am}`;
  if (h.leer) return `leer angelegt (nur Stamm)${am}`;
  return `abgezweigt von ${esc(variantenName(h.von))}${am}`;
}

const STATUS_TEXT = { aktuell: 'Kennzahlen aktuell', veraltet: 'Kennzahlen veraltet', nie: 'nicht gerechnet' };

function _menuHtml() {
  const aktivKey = aktiverVariantKey();
  const rows = _alle().map(v => {
    const aktiv = v.key === aktivKey;
    const e = _eigeneEntscheidungen(v);
    const st = variantenKennzahlStatus(v.key);
    const netz = v.rec?.netzEigen ? ' · eigenes Wärmenetz' : '';
    const stern = _gutachten() === v.key;
    return `<div class="var-menu-row${aktiv ? ' aktiv' : ''}" data-click="variantenMenuWaehle(${idArg(v.id)})" title="${aktiv ? 'aktive Variante' : 'zu dieser Variante wechseln'}">
      <span style="color:${aktiv ? 'var(--accent)' : 'var(--muted)'};">${aktiv ? '●' : '○'}</span>
      <div style="min-width:0;">
        <b>${esc(v.name)}</b>${stern ? ' <span style="color:var(--accent);" title="geht ins Gutachten">★</span>' : ''}
        <div class="sub">${_herkunftText(v)} · ${e.anlagen} eigene Anlage${e.anlagen === 1 ? '' : 'n'}${e.massnahmen ? ` · ${e.massnahmen} Maßnahme${e.massnahmen === 1 ? '' : 'n'}` : ''}${netz}</div>
        ${v.zweck ? `<div class="sub" style="color:var(--text);font-style:italic;">${esc(v.zweck)}</div>` : ''}
        <div class="akt">
          <button data-click="event.stopPropagation();variantenSternSetzen('${v.key}')" title="Diese Variante geht ins Gutachten">${stern ? '★ Gutachten' : '☆ fürs Gutachten'}</button>
          <button data-click="event.stopPropagation();variantenZweckBearbeiten(${idArg(v.id)})">Zweck …</button>
          <button data-click="event.stopPropagation();variantenUmbenennen(${idArg(v.id)})">Umbenennen …</button>
          ${v.id != null ? `<button data-click="event.stopPropagation();variantenLoeschen(${idArg(v.id)})" style="color:#ef9a9a;">Löschen …</button>` : ''}
        </div>
      </div>
      <span class="var-status ${st}" title="Stand der Wärme-Kennzahlen im Vergleich">${STATUS_TEXT[st]}</span>
    </div>`;
  }).join('');
  return `${rows}
    <div class="var-menu-foot">
      <button data-click="variantenMenuSchliessen();addVariante()">＋ Neue Variante …</button>
      <button data-click="variantenMenuSchliessen();setViewMode('vergleich')">⇄ Vergleichen</button>
      <button data-click="variantenMenuSchliessen();variantenZeitstrahlToggle()">⏱ Zeitstrahl</button>
    </div>
    <div style="padding:0 12px 10px;font-size:10px;color:var(--muted);line-height:1.45;">
      Jede Variante = gemeinsamer Stamm (Gebäude, Bestand, was ohnehin kommt) + ihre eigenen Entscheidungen
      (geplante Anlagen, Erzeuger, Dach-PV, zugeordnete Maßnahmen).
    </div>`;
}

export function variantenMenuToggle() {
  _menuOffen = !_menuOffen;
  _menuRender();
}
export function variantenMenuSchliessen() { _menuOffen = false; _menuRender(); }

function _menuRender() {
  let el = document.getElementById('var-menu');
  if (!_menuOffen) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'var-menu';
    el.className = 'var-menu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Varianten');
    document.body.appendChild(el);
  }
  el.innerHTML = _menuHtml();
  const anker = document.getElementById('varianten-bar')?.getBoundingClientRect();
  const left = anker ? Math.min(Math.max(8, anker.left), window.innerWidth - el.offsetWidth - 8) : 80;
  el.style.left = `${left}px`;
  el.style.top = `${anker ? anker.bottom + 6 : 50}px`;
}

export function variantenMenuWaehle(id) {
  _menuOffen = false;
  _menuRender();
  if ((id ?? null) !== (_aktivId() ?? null)) activateVariant(id ?? null);
}

export function variantenSternSetzen(key) { markiereGutachtenVariante(key); _menuRender(); }
export function variantenUmbenennen(id) { renameVariante(id); _menuRender(); }
export function variantenLoeschen(id) { deleteVariante(id); _menuRender(); }
export function variantenZweckBearbeiten(id) {
  const v = _alle().find(x => (x.id ?? null) === (id ?? null));
  const z = prompt(`Zweck von „${v?.name}“ in einem Satz (erscheint im Vergleich):`, v?.zweck || '');
  if (z == null) return;
  setVariantenZweck(id ?? null, z);
  _menuRender();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (!_menuOffen) return;
    if (e.target.closest?.('#var-menu, #varianten-bar, #variant-banner')) return;
    _menuOffen = false;
    _menuRender();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (_menuOffen) { _menuOffen = false; _menuRender(); }
    document.querySelector('.var-dialog-bg')?.remove();
  });
}

// ── Banner auf der Karte ─────────────────────────────────────────────────────

export function variantenBannerAktualisieren() {
  const banner = document.getElementById('variant-banner');
  if (!banner) return;
  const key = aktiverVariantKey();
  const nameEl = document.getElementById('variant-banner-name');
  if (nameEl) nameEl.textContent = aktiverVariantenName() + (_gutachten() === key ? ' ★' : '');
  const zusatz = document.getElementById('variant-banner-zusatz');
  if (zusatz) {
    const j = _jahr();
    zusatz.textContent = ` · ${j}${j <= basisJahr() ? ' (Bestand)' : ''}${_varianten().length ? ` · ${_varianten().length + 1} Varianten` : ''}`;
  }
  const farbe = key === 'base' ? 'var(--accent)' : '#66bb6a';
  banner.style.borderColor = farbe;
  banner.style.color = farbe;
}

// ── Dialog „Neue Variante“ ───────────────────────────────────────────────────

/** Zukunftsobjekte, die beim ersten Abzweigen einsortiert werden. */
function _zukunftsObjekte() {
  const b = basisJahr();
  return _assets()
    .filter(a => {
      const s = normSchicht(a.schicht);
      if (s === SCHICHT.BESTAND) return false;
      const bj = parseInt(a.baujahr);
      return s === SCHICHT.ENTSCHEIDUNG || (Number.isFinite(bj) && bj > b);
    })
    .sort((x, y) => (parseInt(x.baujahr) || 0) - (parseInt(y.baujahr) || 0));
}

export function variantenDialogNeu() {
  document.querySelector('.var-dialog-bg')?.remove();
  const alle = _alle();
  const erstes = _varianten().length === 0;
  const zukunft = erstes ? _zukunftsObjekte() : [];
  const vorschlag = `Variante ${alle.length + 1}`;
  const optionen = alle.map(v =>
    `<option value="${esc(v.key)}"${v.key === aktiverVariantKey() ? ' selected' : ''}>Kopie von ${esc(v.name)}${v.key === aktiverVariantKey() ? ' (aktiv)' : ''}</option>`).join('')
    + `<option value="__leer">leer — nur gemeinsamer Stamm, ohne eigene Anlagen und Erzeuger</option>`;
  const liste = zukunft.map(a => {
    const gemeinsam = normSchicht(a.schicht) === SCHICHT.ENTWICKLUNG;
    return `<label class="obj">
      <input type="checkbox" data-asset="${esc(a.id)}" ${gemeinsam ? 'checked' : ''} style="accent-color:#f9a825;">
      <span>${esc(a.name)} <span style="color:var(--muted);font-family:'DM Mono',monospace;font-size:10.5px;">${esc(a.baujahr ?? '')}</span></span>
      <span class="vd-wo" style="font-size:10.5px;color:${gemeinsam ? '#f9a825' : '#66bb6a'};">${gemeinsam ? '📈 alle Varianten' : `🎯 nur ${esc(variantenName(null))}`}</span>
    </label>`;
  }).join('');

  const bg = document.createElement('div');
  bg.className = 'var-dialog-bg';
  bg.innerHTML = `<div class="var-dialog" role="dialog" aria-modal="true" aria-labelledby="vd-titel">
    <header><b id="vd-titel">Neue Variante</b>
      <div class="hinweis" style="margin-top:4px;">Die neue Variante teilt den gemeinsamen Stamm (Gebäude, Bestand, was ohnehin kommt)
        und übernimmt die Entscheidungen ihres Ausgangspunkts. Danach entwickeln sich beide getrennt.</div></header>
    <div class="body">
      <label class="feld"><span>Name</span><input type="text" id="vd-name" value="${esc(vorschlag)}"></label>
      <label class="feld"><span>Ausgehend von</span><select id="vd-von">${optionen}</select></label>
      <label class="feld"><span>Zweck in einem Satz</span>
        <textarea id="vd-zweck" rows="2" placeholder="z. B. Freifläche über neuen MS-Abgang statt Dach-PV"></textarea></label>
      ${zukunft.length ? `
      <div class="hinweis"><b style="color:var(--text);">Einmalig: Was kommt ohnehin?</b> Bisher gab es nur den Hauptplan, deshalb war
        diese Grenze egal. Angehakt = gilt in allen Varianten. Ohne Haken = Entscheidung des Hauptplans, die neue Variante bekommt eine Kopie.</div>
      <div class="objliste" id="vd-liste">${liste}</div>` : ''}
    </div>
    <footer>
      <span class="hinweis" id="vd-summe" style="margin-right:auto;align-self:center;"></span>
      <button class="btn-secondary" data-click="this.closest('.var-dialog-bg').remove()">Abbrechen</button>
      <button class="btn-confirm" id="vd-ok" data-click="variantenDialogAnlegen()">Variante anlegen</button>
    </footer>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  const summe = () => {
    const boxes = [...bg.querySelectorAll('#vd-liste input[type=checkbox]')];
    boxes.forEach(cb => {
      const wo = cb.closest('.obj')?.querySelector('.vd-wo');
      if (wo) { wo.textContent = cb.checked ? '📈 alle Varianten' : `🎯 nur ${variantenName(null)}`; wo.style.color = cb.checked ? '#f9a825' : '#66bb6a'; }
    });
    const n = boxes.filter(b => b.checked).length;
    const s = bg.querySelector('#vd-summe');
    if (s) s.textContent = boxes.length ? `${n} gemeinsam · ${boxes.length - n} nur ${variantenName(null)}` : '';
  };
  bg.addEventListener('change', summe);
  summe();
  const name = bg.querySelector('#vd-name');
  name?.focus(); name?.select();
  name?.addEventListener('keydown', e => { if (e.key === 'Enter') variantenDialogAnlegen(); });
}

export function variantenDialogAnlegen() {
  const bg = document.querySelector('.var-dialog-bg');
  if (!bg) return;
  const name = bg.querySelector('#vd-name')?.value.trim();
  if (!name) { bg.querySelector('#vd-name')?.focus(); return; }
  const vonWert = bg.querySelector('#vd-von')?.value;
  const leer = vonWert === '__leer';
  const von = leer ? undefined : (vonWert === 'base' ? null : vonWert);
  const zweck = bg.querySelector('#vd-zweck')?.value.trim() || '';
  let schichtKorrektur = null;
  const boxes = [...bg.querySelectorAll('#vd-liste input[type=checkbox]')];
  if (boxes.length) {
    schichtKorrektur = {};
    for (const cb of boxes) schichtKorrektur[cb.dataset.asset] = cb.checked ? SCHICHT.ENTWICKLUNG : SCHICHT.ENTSCHEIDUNG;
  }
  bg.remove();
  try {
    addVariante({ name, zweck, von, leer, schichtKorrektur });
    _toast(`✓ Variante „${esc(name)}“ angelegt und aktiv. „${esc(variantenName(null))}“ bleibt unverändert.`);
  } catch (err) {
    console.error('Variante anlegen:', err);
    _toast(`⚠ Variante konnte nicht angelegt werden: ${esc(err.message)}`, 7000, '#ef5350');
  }
}

// ── Rückmeldung nach dem Anlegen ─────────────────────────────────────────────

let _neuPuffer = [];
let _neuTimer = null;

/** Von createAsset (13a) für jedes frisch angelegte Objekt aufgerufen. */
export function variantenNeuMeldung(asset) {
  if (window._batchImporting) return;
  _neuPuffer.push(asset);
  clearTimeout(_neuTimer);
  _neuTimer = setTimeout(_neuMelden, 350);
}

function _neuMelden() {
  const liste = _neuPuffer.filter(a => _assets().includes(a));
  _neuPuffer = [];
  if (!liste.length) return;
  const schichten = new Set(liste.map(a => normSchicht(a.schicht)));
  if (schichten.size > 1) {
    // Gemischt (z. B. Auto-Befüllen): nur zusammenfassen, Umhängen geht im Inspektor
    const n = k => liste.filter(a => normSchicht(a.schicht) === k).length;
    const teile = [
      n(SCHICHT.ENTSCHEIDUNG) && `${n(SCHICHT.ENTSCHEIDUNG)} nur in <b>${esc(aktiverVariantenName())}</b>`,
      n(SCHICHT.ENTWICKLUNG) && `${n(SCHICHT.ENTWICKLUNG)} in <b>allen Varianten</b> (kommt ohnehin)`,
      n(SCHICHT.BESTAND) && `${n(SCHICHT.BESTAND)} als <b>Bestand</b>`,
    ].filter(Boolean);
    _toast(`✓ ${liste.length} Anlagen angelegt · ${teile.join(' · ')}`, 6000, '#d4a855');
    return;
  }
  const s = normSchicht(liste[liste.length - 1].schicht);
  const was = liste.length === 1 ? `„${esc(liste[0].name)}“` : `${liste.length} Anlagen`;
  const wo = s === SCHICHT.ENTSCHEIDUNG ? `nur in <b>${esc(aktiverVariantenName())}</b>`
    : s === SCHICHT.ENTWICKLUNG ? '<b>alle Varianten</b> (kommt ohnehin)' : '<b>Bestand</b> · alle Varianten';
  const ab = liste[0].baujahr ? ` · ab ${esc(liste[0].baujahr)}` : '';
  window._varNeuListe = liste;
  const aktion = s === SCHICHT.ENTSCHEIDUNG
    ? `<button data-click="variantenNeuUmhaengen('${SCHICHT.ENTWICKLUNG}')">stattdessen in allen Varianten</button>`
    : `<button data-click="variantenNeuUmhaengen('${SCHICHT.ENTSCHEIDUNG}')">stattdessen nur in ${esc(aktiverVariantenName())}</button>`;
  _toast(`✓ ${was} angelegt · ${wo}${ab}`, 6000, SCHICHT_META[s].farbe, aktion);
}

export function variantenNeuUmhaengen(schicht) {
  const liste = window._varNeuListe || [];
  for (const a of liste) a.schicht = schicht;
  window._varNeuListe = [];
  window.redrawAllAssets?.();
  document.querySelector('.var-toast')?.remove();
  _toast(`↪ ${liste.length === 1 ? 'Gilt' : 'Gelten'} jetzt ${schicht === SCHICHT.ENTSCHEIDUNG ? `nur in ${esc(aktiverVariantenName())}` : 'in allen Varianten'}.`, 3000, SCHICHT_META[schicht].farbe);
}

let _toastTimer = null;
function _toast(html, ms = 4000, farbe = '#66bb6a', aktion = '') {
  document.querySelector('.var-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'var-toast';
  el.setAttribute('role', 'status');
  el.style.borderColor = farbe;
  el.innerHTML = `<span>${html}</span>${aktion}<button data-click="this.closest('.var-toast').remove()" aria-label="Schließen" style="text-decoration:none;color:var(--muted);">✕</button>`;
  document.body.appendChild(el);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.remove(), ms);
}

// ── Dach-PV beim Variantenwechsel neu zeichnen ───────────────────────────────

export function variantenPvNeuZeichnen(geaendert, vorher) {
  const map = window.map;
  for (const g of (geaendert || [])) {
    const alt = vorher?.get(g.id);
    for (const fl of (alt?.pvFlaechen || [])) {
      try { if (fl?.layer && map) map.removeLayer(fl.layer); } catch { /* bereits entfernt */ }
      try { if (fl?.svgLayer && map) map.removeLayer(fl.svgLayer); } catch { /* bereits entfernt */ }
    }
    if (!g.pvAktiv && g._pvModuleLayer && map) { try { map.removeLayer(g._pvModuleLayer); } catch { /* */ } g._pvModuleLayer = null; }
    g._pvModuleDrawnSig = null;
    try { window.redrawGebPvFlaechen?.(g); } catch (e) { console.warn('PV neu zeichnen:', e); }
    window._updateGebLabelPv?.(g.id);
  }
  window.updateSperrVisibility?.();
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.pvModusRender?.();
}

// ── Ergebnis-Stempel ─────────────────────────────────────────────────────────

export function ergebnisStempelAktiv() {
  return ergebnisStempel(_aktivId(), aktiverVariantenName());
}

/**
 * Hinweis, wenn ein Ergebnis für eine andere Variante gerechnet wurde.
 * neuClick: data-click-Code für „neu rechnen“ (oder null).
 */
export function stempelHinweisHtml(stempel, neuClick) {
  const ab = stempelAbweichung(stempel, _aktivId());
  if (!ab) return '';
  const zielId = stempel.variantKey === 'base' ? null : stempel.variantKey;
  const gibtEs = zielId == null || _varianten().some(v => v.id === zielId);
  return `<div class="var-stempel" role="status">
    <span>⚠ Gerechnet für <b>${esc(ab.name)}</b>${ab.zeit ? ` am ${datumKurz(ab.zeit)}` : ''} — aktiv ist <b>${esc(aktiverVariantenName())}</b>.</span>
    ${gibtEs ? `<button data-click="activateVariant(${idArg(zielId)})">zu ${esc(ab.name)} wechseln</button>` : ''}
    ${neuClick ? `<button data-click="${neuClick}">für ${esc(aktiverVariantenName())} neu rechnen</button>` : ''}
  </div>`;
}

/** Gutachten: null, wenn passend; sonst { id, gutachten, aktiv }. */
export function gutachtenVarianteKonflikt() {
  const g = _gutachten();
  if (g == null || g === aktiverVariantKey()) return null;
  const id = g === 'base' ? null : g;
  if (id != null && !_varianten().some(v => v.id === id)) return null;
  return { id, gutachten: variantenName(g), aktiv: aktiverVariantenName() };
}

// ── Vergleich: „Was die Varianten unterscheidet“ ─────────────────────────────

function _paketListe(v) {
  const aktiv = v.key === aktiverVariantKey();
  const items = aktiv
    ? _assets().filter(a => normSchicht(a.schicht) === SCHICHT.ENTSCHEIDUNG)
    : ((v.rec ? v.rec.stromnetz : baseStromNetzSnapshot)?.items || []);
  return items;
}

function _massnahmenListe(v) {
  if (v.key === aktiverVariantKey()) {
    const out = [];
    for (const a of _assets()) for (const m of (a.massnahmen || [])) if (m?.variante === v.key) out.push({ name: a.name, m });
    return out;
  }
  const namen = new Map(_assets().map(a => [a.id, a.name]));
  return (massnahmenAblage[v.key] || []).map(e => ({ name: namen.get(e.id) || e.id, m: e.m }));
}

function _erzeugerListe(v) {
  const aktiv = v.key === aktiverVariantKey();
  const st = aktiv ? window.captureErzeugerState?.() : (v.rec ? v.rec.erzeuger : baseErzeugerSnapshot);
  if (!st) return [];
  const NAMEN = { lwWp: 'Luft-WP', geoThermie: 'Geothermie', fliessgewaesser: 'Fließgewässer-WP', gasKessel: 'Gaskessel',
    heizoelKessel: 'Heizölkessel', pelletsKessel: 'Pelletkessel', heizhackschnitzel: 'Hackschnitzel', bhkw: 'BHKW',
    stromkessel: 'Stromkessel', fernwaerme: 'Fernwärme', solarthermie: 'Solarthermie', waermespeicher: 'Wärmespeicher' };
  const out = [];
  for (const [k, n] of Object.entries(NAMEN)) {
    const e = st[k];
    if (!e) continue;
    if (k === 'solarthermie' && !(parseFloat(e.flaeche) > 0)) continue;
    if (k === 'waermespeicher' && !(parseFloat(e.volumen) > 0)) continue;
    const kw = e.leistungKw ?? e.leistungThKw ?? (k === 'geoThermie' ? e.heizlast : null);
    out.push(`${n}${kw ? ` ${Math.round(kw).toLocaleString('de-DE')} kW` : ''}`);
  }
  return out;
}

function _pvBelegt(v) {
  const aktiv = v.key === aktiverVariantKey();
  if (aktiv) return gebaeude.filter(g => g.pvAktiv).length;
  const bel = v.rec ? v.rec.gebaeudePv : baseGebaeudePv;
  if (!bel) return null;
  return Object.values(bel).filter(e => e?.pvAktiv).length;
}

export function variantenVergleichAnsichtRender() {
  const el = document.getElementById('vergleich-uebersicht');
  if (!el) return;
  const alle = _alle();
  const aktivKey = aktiverVariantKey();
  const kopf = alle.map(v => `<th class="${v.key === aktivKey ? 'aktiv' : ''}" data-click="activateVariant(${idArg(v.id)});variantenVergleichAnsichtRender();renderVergleich()"
      title="${v.key === aktivKey ? 'aktive Variante' : 'Klicken zum Aktivieren'}">${esc(v.name)}${_gutachten() === v.key ? ' <span style="color:var(--accent);">★</span>' : ''}
      <div style="font-weight:400;color:var(--muted);font-size:10px;">${v.key === aktivKey ? 'aktiv · ' : ''}${_herkunftText(v)}</div></th>`).join('');
  const zeile = (titel, fn) => `<tr><td class="rk">${titel}</td>${alle.map(v => `<td>${fn(v)}</td>`).join('')}</tr>`;
  const ul = arr => arr.length ? `<ul>${arr.join('')}</ul>` : '<span style="color:var(--muted);">—</span>';
  const html = `<table class="var-uebersicht"><thead><tr><th style="cursor:default;"></th>${kopf}</tr></thead><tbody>
    ${zeile('Zweck', v => v.zweck ? esc(v.zweck) : `<span style="color:var(--muted);cursor:pointer;" data-click="variantenZweckBearbeiten(${idArg(v.id)});variantenVergleichAnsichtRender()">＋ Zweck eintragen</span>`)}
    ${zeile('Strom · eigene Anlagen', v => ul(_paketListe(v).slice(0, 12).map(a => `<li>${esc(a.name)}${a.baujahr ? ` <span class="jahr">${esc(a.baujahr)}</span>` : ''}</li>`))
      + (_paketListe(v).length > 12 ? `<div style="color:var(--muted);">… und ${_paketListe(v).length - 12} weitere</div>` : ''))}
    ${zeile('Maßnahmen nur hier', v => ul(_massnahmenListe(v).slice(0, 10).map(x => `<li>${esc(x.name)}: ${esc(x.m.titel || 'Maßnahme')}${x.m.jahr ? ` <span class="jahr">${esc(x.m.jahr)}</span>` : ''}</li>`)))}
    ${zeile('Wärme · Erzeuger', v => ul(_erzeugerListe(v).map(t => `<li>${esc(t)}</li>`)))}
    ${zeile('Wärmenetz', v => v.rec?.netzEigen ? '<span style="color:#66bb6a;">eigene Trasse</span>' : '<span style="color:var(--muted);">gemeinsame Trasse</span>')}
    ${zeile('Dach-PV belegt', v => { const n = _pvBelegt(v); return n == null ? '<span style="color:var(--muted);">wie Hauptplan (noch nicht getrennt)</span>' : `${n} Gebäude`; })}
    ${zeile('Wärme-Kennzahlen', v => { const st = variantenKennzahlStatus(v.key); return `<span class="var-status ${st}">${STATUS_TEXT[st]}</span>`; })}
  </tbody></table>
  <div style="font-size:10px;color:var(--muted);margin-top:5px;">Gemeinsam in allen Varianten: Gebäude, Bestand und Entwicklung des Stromnetzes, Maßnahmen „für alle“ und — ohne eigenes Netz — die Wärmetrasse.</div>`;
  el.innerHTML = html;
  window.variantenVergleichRender?.();
}

// ── Zeitstrahl ───────────────────────────────────────────────────────────────

let _zsOffen = false;

export function variantenZeitstrahlToggle() {
  _zsOffen = !_zsOffen;
  _zeitstrahlRender();
}

function _zeitstrahlRender() {
  let el = document.getElementById('var-zeitstrahl');
  if (!_zsOffen) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'var-zeitstrahl';
    el.className = 'var-zeitstrahl';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Zeitstrahl der Varianten');
    document.body.appendChild(el);
  }
  const alle = _alle();
  const aktivKey = aktiverVariantKey();
  const b = basisJahr();
  const ev = zeitstrahlEintraege({
    basisjahr: b, gebaeude, assets: _assets(),
    pakete: alle.map(v => ({ key: v.key, name: v.name, items: (v.rec ? v.rec.stromnetz : baseStromNetzSnapshot)?.items || [] })),
    massnahmenAblage, aktivKey, jahrVon: massnahmeJahr,
  });
  const maxSlider = parseInt(document.getElementById('year-slider')?.max) || b + 24;
  const y1 = Math.max(maxSlider, ...ev.map(e => e.jahr), b + 5);
  const pct = y => ((y - b) / (y1 - b)) * 94 + 1;
  const jahr = _jahr();

  const spuren = [{ key: 'stamm', name: 'Alle Varianten', sub: 'Stamm: was ohnehin kommt' },
    ...alle.map(v => ({ key: v.key, name: v.name, sub: v.key === aktivKey ? 'aktiv · eigene Entscheidungen' : 'eigene Entscheidungen' }))];

  const spurHtml = s => {
    const eintraege = ev.filter(e => e.spur === s.key);
    // Einfache Zeilenvergabe, damit Einträge nicht übereinander liegen
    const zeilenEnde = [];
    const plaziert = eintraege.map(e => {
      const x = pct(e.jahr);
      let z = zeilenEnde.findIndex(endeX => endeX < x);
      if (z < 0) { z = zeilenEnde.length; zeilenEnde.push(0); }
      zeilenEnde[z] = x + 13;
      return { e, x, z };
    });
    const hoehe = Math.max(1, zeilenEnde.length) * 22 + 8;
    const items = plaziert.map(({ e, x, z }) => `<span class="var-zs-ev ${e.art}${e.jahr > jahr ? ' zukunft' : ''}" style="left:${x}%;top:${4 + z * 22}px;"
        title="${esc(e.titel)} · ${e.jahr}" data-click="variantenZeitstrahlZeige('${e.ziel}', '${jsArg(e.id)}', '${jsArg(s.key)}')">
        <span class="j">${e.jahr}</span>${esc(e.titel)}</span>`).join('');
    return `<div class="var-zs-name"><b>${esc(s.name)}${_gutachten() === s.key ? ' ★' : ''}</b>${esc(s.sub)}</div>
      <div class="var-zs-spur" style="height:${hoehe}px;">${items || '<span style="position:absolute;left:1%;top:8px;color:var(--muted);">—</span>'}</div>`;
  };
  const ticks = [];
  for (let y = b; y <= y1; y += (y1 - b > 20 ? 5 : 2)) ticks.push(`<span style="position:absolute;left:${pct(y)}%;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);">${y}</span>`);

  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);gap:8px;flex-wrap:wrap;">
      <b style="font-size:12px;">⏱ Zeitstrahl</b>
      <span style="color:var(--muted);font-size:10.5px;">blass = nach dem Betrachtungsjahr ${jahr} · Klick zeigt das Objekt</span>
      <span style="display:flex;gap:10px;font-size:10px;color:var(--muted);">
        <span><span class="var-zs-ev entwicklung" style="position:static;display:inline-block;padding:0 6px;">&nbsp;</span> kommt ohnehin</span>
        <span><span class="var-zs-ev entscheidung" style="position:static;display:inline-block;padding:0 6px;">&nbsp;</span> Entscheidung</span>
        <span><span class="var-zs-ev massnahme" style="position:static;display:inline-block;padding:0 6px;">&nbsp;</span> Maßnahme</span>
        <span><span class="var-zs-ev abriss" style="position:static;display:inline-block;padding:0 6px;">&nbsp;</span> Abriss</span>
      </span>
      <button data-click="variantenZeitstrahlToggle()" style="font:inherit;background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;" aria-label="Schließen">✕</button>
    </div>
    <div class="var-zs-grid">
      <div></div><div style="position:relative;height:16px;">${ticks.join('')}</div>
      ${spuren.map(spurHtml).join('')}
      <div style="position:absolute;top:22px;bottom:8px;left:calc(162px + (100% - 174px) * ${pct(Math.min(Math.max(jahr, b), y1)) / 100});width:2px;background:var(--accent);opacity:.7;pointer-events:none;"></div>
    </div>`;
}

/** Objekt aus dem Zeitstrahl auf der Karte zeigen (wechselt bei Bedarf die Variante). */
export function variantenZeitstrahlZeige(ziel, id, spur) {
  if (spur !== 'stamm' && spur !== aktiverVariantKey()) activateVariant(spur === 'base' ? null : spur);
  if (ziel === 'gebaeude') {
    const g = gebaeude.find(x => String(x.id) === String(id));
    if (g) window.selectFromMap?.(g.id);
    return;
  }
  const a = _assets().find(x => String(x.id) === String(id));
  if (!a) return;
  try { window.map?.setView([a.lat, a.lng], Math.max(window.map.getZoom?.() || 17, 17)); } catch { /* */ }
  window.openAssetInspector?.(a);
}

// ── Gesamtauffrischung ───────────────────────────────────────────────────────

/** Nach jedem Variantenwechsel / jeder Planungstransaktion (01, planning-transaction). */
export function variantenUiAktualisieren() {
  window.renderVariantenBar?.();
  variantenBannerAktualisieren();
  _waermeKennzeichenRendern();
  if (_menuOffen) _menuRender();
  if (_zsOffen) _zeitstrahlRender();
  if (currentViewMode === 'vergleich') variantenVergleichAnsichtRender();
  window.pvaStempelAktualisieren?.();
  window.schichtBarRender?.();
  if (document.getElementById('geb-pv-panel')?.classList.contains('visible')) window.renderGebPvPanel?.();
}

if (typeof document !== 'undefined') {
  const start = () => { try { variantenUiAktualisieren(); window.updateVariantBanner?.(); } catch (e) { console.warn('Varianten-UI:', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);
}

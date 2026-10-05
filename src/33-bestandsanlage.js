// ── 33-bestandsanlage.js — Eingabe „Bestandsanlage (Ist)“ in den Wärme-Grundlagen ──
// Erzeugerpark, Pufferspeicher, Heizzentrale, Stand des Hydraulikschemas und Datenlage zum Netz. Gespeichert wird der
// Stand mit den Wärme-Grundlagen (captureWaermeGrundlagen/restoreWaermeGrundlagen in 06a-gbi-lastgang.js).
// Auswertung und Texte: lib/bestandsanlage.js, lib/gutachten-anlagentechnik.js.
import { BA_TYPEN, BA_AUFLOESUNG, baLeer, baNormalisiere } from './lib/bestandsanlage.js';

let _ba = baLeer();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function getBestandsanlage() { return baNormalisiere(_ba); }
export function setBestandsanlage(daten) { _ba = baNormalisiere(daten); baRender(); }

export function baErzeugerHinzufuegen() {
  const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  _ba.erzeuger.push({ id, typ: 'nt_gaskessel', aufloesung: 'jahr', bezeichnung: '', thermKw: '', feuerungKw: '', elKw: '', baujahr: '' });
  baRender();
}
export function baErzeugerEntfernen(i) {
  const [weg] = _ba.erzeuger.splice(Number(i), 1);
  if (weg) for (const v of _ba.verbrauch) delete v.werte[weg.id];
  baRender();
}
export function baErzeugerFeld(i, feld, wert) {
  const e = _ba.erzeuger[Number(i)];
  if (!e || !['typ', 'bezeichnung', 'thermKw', 'feuerungKw', 'elKw', 'baujahr', 'aufloesung'].includes(feld)) return;
  e[feld] = String(wert ?? '');
  if (feld === 'typ') baRender();
  else baSumme();
}
export function baFeld(feld, wert) {
  if (!['pufferM3', 'heizzentrale', 'schemaJahr', 'netzDaten'].includes(feld)) return;
  _ba[feld] = String(wert ?? '');
}

export function baJahrHinzufuegen() {
  const jahre = _ba.verbrauch.map(v => v.jahr);
  const jahr = jahre.length ? Math.max(...jahre) + 1 : new Date().getFullYear() - 1;
  _ba.verbrauch.push({ jahr, werte: {} });
  _ba.verbrauch.sort((a, b) => a.jahr - b.jahr);
  baRender();
}
export function baJahrEntfernen(jahr) {
  _ba.verbrauch = _ba.verbrauch.filter(v => v.jahr !== Number(jahr));
  baRender();
}
export function baJahrAendern(alt, neu) {
  const j = parseInt(neu, 10);
  const v = _ba.verbrauch.find(x => x.jahr === Number(alt));
  if (!v || !(j > 1990 && j < 2100) || _ba.verbrauch.some(x => x.jahr === j)) { baRender(); return; }
  v.jahr = j;
  _ba.verbrauch.sort((a, b) => a.jahr - b.jahr);
  baRender();
}
export function baVerbrauchFeld(jahr, id, wert) {
  const v = _ba.verbrauch.find(x => x.jahr === Number(jahr));
  if (v) v.werte[id] = String(wert ?? '');
}

function baVerbrauchHtml() {
  if (!_ba.erzeuger.length) return '';
  const kurz = e => (e.bezeichnung || BA_TYPEN[e.typ]?.name || '').replace('Brennwertkessel', 'BW-Kessel');
  const kopf = `<tr><th style="text-align:left;font-weight:400;">Jahr</th>${_ba.erzeuger.map(e => `<th style="font-weight:400;padding:0 2px;" title="${esc(BA_TYPEN[e.typ]?.name)}">${esc(kurz(e))}<br>
      <select class="inp-field" style="width:62px;padding:1px;font-size:9px;" title="Zeitliche Auflösung der Daten" data-change="baErzeugerFeld(${_ba.erzeuger.indexOf(e)},'aufloesung',this.value)">
        ${Object.entries(BA_AUFLOESUNG).map(([k, l]) => `<option value="${k}"${e.aufloesung === k ? ' selected' : ''}>${l.replace('werte', '')}</option>`).join('')}</select></th>`).join('')}<th></th></tr>`;
  const zeilen = _ba.verbrauch.map(v => `<tr>
      <td><input class="inp-field" style="width:46px;padding:2px;font-size:10px;" value="${v.jahr}" data-change="baJahrAendern(${v.jahr},this.value)"></td>
      ${_ba.erzeuger.map(e => `<td style="padding:0 2px;"><input class="inp-field" style="width:62px;padding:2px;font-size:10px;text-align:right;" placeholder="MWh" value="${esc(v.werte[e.id] ?? '')}" data-change="baVerbrauchFeld(${v.jahr},'${e.id}',this.value)"></td>`).join('')}
      <td><button class="btn-secondary" style="padding:0 5px;font-size:10px;" title="Jahr entfernen" data-click="baJahrEntfernen(${v.jahr})">✕</button></td></tr>`).join('');
  return `<div style="font-size:10px;color:var(--muted);margin:10px 0 3px;" title="Endenergie (Brennstoff bzw. Strom) je Bestandserzeuger und Jahr — Grundlage für Energiebezug, CO₂ und Referenzjahr im Gutachten">Verbrauchsdaten (MWh Endenergie/a)</div>
    <div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:9px;color:var(--muted);">${kopf}${zeilen}</table></div>
    <button class="btn-secondary" style="padding:2px 8px;font-size:10px;margin-top:4px;" data-click="baJahrHinzufuegen()">＋ Jahr</button>`;
}

function baSumme() {
  const el = document.getElementById('ba-summe');
  if (!el) return;
  const s = f => _ba.erzeuger.reduce((x, e) => x + (parseFloat(String(e[f]).replace(',', '.')) || 0), 0);
  const th = s('thermKw'), fe = s('feuerungKw');
  el.textContent = _ba.erzeuger.length ? `Σ ${Math.round(th).toLocaleString('de-DE')} kW thermisch${fe ? ` · ${Math.round(fe).toLocaleString('de-DE')} kW Feuerung` : ''}` : '';
}

export function baRender() {
  const box = document.getElementById('ba-editor');
  if (!box) return;
  const inp = (i, f, ph, w) => `<input class="inp-field" style="width:${w}px;padding:3px 4px;font-size:10px;text-align:right;" placeholder="${ph}" value="${esc(_ba.erzeuger[i][f])}" data-change="baErzeugerFeld(${i},'${f}',this.value)">`;
  const mitKwk = _ba.erzeuger.some(e => BA_TYPEN[e.typ]?.kwk);
  const zeilen = _ba.erzeuger.map((e, i) => `<div style="display:flex;gap:3px;align-items:center;margin-bottom:3px;flex-wrap:wrap;">
      <select class="inp-field" style="width:118px;padding:3px;font-size:10px;" data-change="baErzeugerFeld(${i},'typ',this.value)">
        ${Object.entries(BA_TYPEN).map(([k, t]) => `<option value="${k}"${e.typ === k ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
      ${inp(i, 'thermKw', 'kW th', 52)}${inp(i, 'feuerungKw', 'kW Feu.', 52)}${BA_TYPEN[e.typ]?.kwk ? inp(i, 'elKw', 'kW el', 46) : mitKwk ? '<span style="width:46px;"></span>' : ''}${inp(i, 'baujahr', 'Bj.', 44)}
      <button class="btn-secondary" style="padding:1px 6px;font-size:10px;" title="Erzeuger entfernen" data-click="baErzeugerEntfernen(${i})">✕</button>
    </div>`).join('');
  const feld = (f, label, ph, typ = 'text') => `<label style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-top:4px;">${label}
      <input class="inp-field" type="${typ}" style="width:110px;padding:3px 4px;font-size:10px;" placeholder="${ph}" value="${esc(_ba[f])}" data-change="baFeld('${f}',this.value)"></label>`;
  const kopf = _ba.erzeuger.length ? `<div style="display:flex;gap:3px;font-size:9px;color:var(--muted);margin-bottom:2px;">
      <span style="width:118px;">Erzeuger</span><span style="width:52px;text-align:right;">kW therm.</span><span style="width:52px;text-align:right;">kW Feuer.</span>
      ${_ba.erzeuger.some(e => BA_TYPEN[e.typ]?.kwk) ? '<span style="width:46px;text-align:right;">kW el.</span>' : ''}<span style="width:44px;text-align:right;">Baujahr</span></div>` : '';
  box.innerHTML = `${kopf}${zeilen || '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Noch keine Bestandserzeuger erfasst.</div>'}
    <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 6px;">
      <button class="btn-secondary" style="padding:2px 8px;font-size:10px;" data-click="baErzeugerHinzufuegen()">＋ Erzeuger</button>
      <span id="ba-summe" style="font-size:10px;color:var(--muted);"></span>
    </div>
    ${feld('pufferM3', 'Pufferspeicher (m³)', 'z. B. 40', 'number')}
    ${feld('heizzentrale', 'Heizzentrale', 'z. B. Gebäude 12')}
    ${feld('schemaJahr', 'Hydraulikschema, Stand', 'Jahr', 'number')}
    <label style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-top:4px;">Netzdaten
      <select class="inp-field" style="width:110px;padding:3px;font-size:10px;" data-change="baFeld('netzDaten',this.value)">
        ${[['keine', 'keine Unterlagen'], ['plan', 'nur Lageplan'], ['vollstaendig', 'vollständig']].map(([k, l]) => `<option value="${k}"${_ba.netzDaten === k ? ' selected' : ''}>${l}</option>`).join('')}
      </select></label>
    ${baVerbrauchHtml()}`;
  baSumme();
}

setTimeout(() => baRender(), 0);

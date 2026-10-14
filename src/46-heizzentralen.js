// ── 46-heizzentralen.js — mehrere Heizzentralen an einem Wärmenetz ──
// Die Auswahl „Heizzentrale“ ist die Hauptzentrale; weitere Zentralen speisen in dasselbe Netz ein. Das Netz teilt
// sich in Versorgungszonen (jedes Gebäude an der über das Netz nächstgelegenen Zentrale, optional fest zugeordnet);
// zwischen den Zonen liegen Verbindungsleitungen mit Trennstelle (03b). Die Erzeugung bleibt ein gemeinsamer
// Einsatz für das ganze Netz — jeder Erzeuger hat einen Standort (Zentrale). Daraus folgt stündlich, was jede
// Zentrale einspeist und was über die Verbindungsleitungen fließt.

import { getVFlowForDN } from './02a-netz-physik.js';
import { rohrLeistungKw, wasserStoffwerte } from './lib/netz-hydraulik.js';

const ERZ_OBJ = { lwwp: 'lwWp', geo: 'geoThermie', fg: 'fliessgewaesser', gaskessel: 'gasKessel', heizoel: 'heizoelKessel',
  pellets: 'pelletsKessel', hhs: 'heizhackschnitzel', bhkw: 'bhkw', stromkessel: 'stromkessel', fernwaerme: 'fernwaerme' };
const ERZ_NAME = { lwwp: 'Luft-WP', geo: 'Geo-WP', fg: 'Flusswasser-WP', gaskessel: 'Gaskessel', heizoel: 'Heizölkessel',
  pellets: 'Pelletkessel', hhs: 'Hackschnitzel', bhkw: 'BHKW', stromkessel: 'Stromkessel', fernwaerme: 'Fernwärme',
  solarthermie: 'Solarthermie', _thermSpeicher: 'Wärmespeicher', _autoGk: 'Spitzenlast-Kessel' };

const nf = (v, d = 0) => (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hauptId = () => parseInt(document.getElementById('netz-zentrale')?.value, 10);
const liste = () => (Array.isArray(window.weitereZentralen) ? window.weitereZentralen : (window.weitereZentralen = []));

/** Alle Zentralen mit Namen: [{ id, name, haupt }]. */
export function heizzentralenListe() {
  const out = [];
  const h = hauptId();
  if (Number.isFinite(h)) out.push({ id: h, name: window.hauptzentraleName || 'HZ 1', haupt: true });
  liste().forEach((z, i) => { if (Number.isFinite(Number(z.id)) && z.id !== null && Number(z.id) !== h) out.push({ id: Number(z.id), name: z.name || `HZ ${i + 2}`, haupt: false }); });
  return out;
}

/** Für Projekt und Varianten: Stand der weiteren Zentralen und ihrer Einstellungen. */
export function heizzentralenStand() {
  return {
    weitereZentralen: liste().map(z => ({ id: z.id ?? null, name: z.name || '' })),
    hauptzentraleName: window.hauptzentraleName || '',
    zentralenVerbinden: window._hzVerbinden !== false,
    kuppelKw: window._hzKuppelKw || '',
    erzeugerStandort: { ...(window._erzeugerStandortFest || {}) },
  };
}

export function heizzentralenLaden(state) {
  if (!state || typeof state !== 'object') return;
  window.weitereZentralen = Array.isArray(state.weitereZentralen) ? state.weitereZentralen.map(z => ({ id: z.id ?? null, name: z.name || '' })) : [];
  window.hauptzentraleName = state.hauptzentraleName || '';
  window._erzeugerStandortFest = { ...(state.erzeugerStandort || {}) };
  window._hzVerbinden = state.zentralenVerbinden !== false;
  window._hzKuppelKw = state.kuppelKw || '';
  hzRender();
}

function _geaendert(neuBerechnen = true) {
  if (neuBerechnen) window.recalcNetz?.();
  window.updateViz?.();
  window.redrawVerbindungslinien?.();
  hzRender();
}

export function hzHinzufuegen() {
  liste().push({ id: null, name: `HZ ${liste().length + 2}` });
  if (!window.hauptzentraleName) window.hauptzentraleName = 'HZ 1';
  hzRender();
}
export function hzSetzen(index, id) {
  const z = liste()[index];
  if (!z) return;
  const n = parseInt(id, 10);
  z.id = Number.isFinite(n) && n !== hauptId() ? n : null;
  _geaendert();
  if (z.id != null) window.showHint?.(`✓ ${z.name} festgelegt — „Netz berechnen“ teilt das Netz in Versorgungszonen und verbindet sie.`, 5000);
}
export function hzEntfernen(index) {
  liste().splice(index, 1);
  _geaendert();
}
export function hzUmbenennen(index, name) {
  const t = String(name || '').trim();
  if (index === -1) window.hauptzentraleName = t || 'HZ 1';
  else if (liste()[index]) liste()[index].name = t || liste()[index].name;
  _geaendert(false);
}
/** In der Gebäudetabelle angehakte Gebäude fest dieser Zentrale zuordnen (null = Zuordnung lösen). */
export function hzZuordnen(zentraleId) {
  const gebs = (window.gebaeude || []).filter(g => g.selected);
  if (!gebs.length) { window.showHint?.('Erst in der Gebäudetabelle Gebäude anhaken, dann zuordnen.', 4000); return 0; }
  gebs.forEach(g => { if (zentraleId == null) delete g.heizzentrale; else g.heizzentrale = Number(zentraleId); });
  window.showHint?.(`✓ ${gebs.length} Gebäude ${zentraleId == null ? 'wieder automatisch zugeordnet' : 'fest zugeordnet'} — wirkt beim nächsten „Netz berechnen“.`, 4500);
  hzRender();
  return gebs.length;
}
export function hzVerbindenSetzen(an) { window._hzVerbinden = !!an; window.recalcNetz?.(); hzRender(); }
export function hzKuppelSetzen(kw) { window._hzKuppelKw = kw; window.recalcNetz?.(); }

/** Standort (Zentrale) eines Erzeugers: Eingabe, sonst die nächstgelegene Zentrale, ohne Lage die Hauptzentrale. */
export function erzeugerStandort(key) {
  const zentralen = heizzentralenListe();
  if (!zentralen.length) return null;
  const fest = (window._erzeugerStandortFest || {})[key];
  if (fest != null && zentralen.some(z => z.id === Number(fest))) return Number(fest);
  const obj = window[ERZ_OBJ[key]];
  const lat = obj?.lat ?? obj?.latlng?.lat ?? obj?.center?.lat ?? obj?.latlngs?.[0]?.lat;
  const lng = obj?.lng ?? obj?.latlng?.lng ?? obj?.center?.lng ?? obj?.latlngs?.[0]?.lng;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best = zentralen[0].id, d = Infinity;
    for (const z of zentralen) {
      const g = (window.gebaeude || []).find(x => x.id === z.id);
      if (!g?.polygon?.length) continue;
      const c = g.polygon.reduce((a, p) => ({ lat: a.lat + p.lat / g.polygon.length, lng: a.lng + p.lng / g.polygon.length }), { lat: 0, lng: 0 });
      const dd = Math.hypot((c.lat - lat) * 111000, (c.lng - lng) * 68000);
      if (dd < d) { d = dd; best = z.id; }
    }
    return best;
  }
  return zentralen[0].id;
}
export function hzStandortSetzen(key, id) {
  window._erzeugerStandortFest = { ...(window._erzeugerStandortFest || {}), [key]: id === '' ? undefined : Number(id) };
  if (id === '') delete window._erzeugerStandortFest[key];
  window.redrawVerbindungslinien?.();
  hzAnalyseRender();
}

/**
 * Stündliche Last je Zone (aus den Gebäudeprofilen der Wärme-Grundlagen, Netzverluste je Zone gleichmäßig) —
 * auf den Gesamtlastgang abgestimmt. Ohne Gebäudeprofile: feste Anteile nach Jahreswärme der Zonen.
 */
export function zonenLast() {
  const lg = window.systemState?.lastgangKw;
  const zonen = window._netzJeZentrale || {};
  const ids = Object.keys(zonen).map(Number);
  if (!lg || ids.length < 2) return null;
  const n = lg.length;
  const roh = new Map(ids.map(z => [z, new Float32Array(n)]));
  const profile = window._buildingHeatProfiles;
  let mitProfil = false;
  if (profile?.size) {
    for (const z of ids) {
      const a = roh.get(z);
      for (const id of zonen[z].gebIds || []) {
        const p = profile.get(id);
        if (!p?.values) continue;
        mitProfil = true;
        for (let t = 0; t < n; t++) a[t] += p.values[t];
      }
      const v = (zonen[z].verlustMWh || 0) * 1000 / n;
      for (let t = 0; t < n; t++) a[t] += v;
    }
  }
  if (!mitProfil) {
    const ges = ids.reduce((s, z) => s + (zonen[z].waermeMwh || 0) + (zonen[z].verlustMWh || 0), 0) || 1;
    for (const z of ids) { const f = ((zonen[z].waermeMwh || 0) + (zonen[z].verlustMWh || 0)) / ges; const a = roh.get(z); for (let t = 0; t < n; t++) a[t] = lg[t] * f; }
    return roh;
  }
  for (let t = 0; t < n; t++) {
    let s = 0; for (const z of ids) s += roh.get(z)[t];
    const f = s > 0 ? lg[t] / s : 0;
    for (const z of ids) roh.get(z)[t] *= f;
  }
  return roh;
}

/** Einspeisung, Bedarf und Übergabe je Zentrale (auch für Tests). */
export function heizzentralenAuswertung() {
  const zentralen = heizzentralenListe();
  const h = window._dispatchHourly, lg = window.systemState?.lastgangKw;
  if (zentralen.length < 2 || !h || !lg) return null;
  const last = zonenLast();
  if (!last) return null;
  const n = lg.length;
  const einspeisung = new Map(zentralen.map(z => [z.id, new Float32Array(n)]));
  const erzeuger = [];
  for (const [key, arr] of Object.entries(h)) {
    if (!arr?.length) continue;
    const sKey = key === '_autoGk' ? '_autoGk' : key;
    const z = erzeugerStandort(sKey) ?? zentralen[0].id;
    const e = einspeisung.get(z) || einspeisung.get(zentralen[0].id);
    let mwh = 0, max = 0;
    for (let t = 0; t < n; t++) { e[t] += arr[t] || 0; mwh += (arr[t] || 0) / 1000; if (arr[t] > max) max = arr[t]; }
    if (mwh > 0.05) erzeuger.push({ key, name: ERZ_NAME[key] || key, zentrale: z, mwh, maxKw: max, fest: (window._erzeugerStandortFest || {})[sKey] != null });
  }
  // Last, die die Erzeuger nicht decken (sollte 0 sein), bleibt unberücksichtigt
  const summeLast = new Map([...last].map(([z, a]) => [z, a.reduce((s, v) => s + v, 0) / 1000]));
  const anteil = new Map();
  const gesLast = [...summeLast.values()].reduce((s, v) => s + v, 0) || 1;
  for (const [z, s] of summeLast) anteil.set(z, s / gesLast);
  const ueber = new Map();
  for (const z of zentralen) {
    const e = einspeisung.get(z.id), l = last.get(z.id);
    if (!l) continue;
    const u = new Float32Array(n);
    let maxAb = 0, maxAuf = 0, ab = 0, auf = 0, eMwh = 0, eMax = 0;
    for (let t = 0; t < n; t++) {
      u[t] = e[t] - l[t];
      eMwh += e[t] / 1000; if (e[t] > eMax) eMax = e[t];
      if (u[t] > maxAb) maxAb = u[t]; if (-u[t] > maxAuf) maxAuf = -u[t];
      if (u[t] > 0) ab += u[t] / 1000; else auf -= u[t] / 1000;
    }
    ueber.set(z.id, { uebergabeKw: u, maxAbgabeKw: maxAb, maxAufnahmeKw: maxAuf, abgabeMwh: ab, aufnahmeMwh: auf, einspeisungMwh: eMwh, einspeisungMaxKw: eMax, lastMwh: summeLast.get(z.id) || 0 });
  }
  // Übertragbare Leistung der Verbindungsleitungen (DN, zulässige Geschwindigkeit)
  const kuppel = (window.netzEdges || []).filter(e => e.kuppel && !e.pruned);
  // Innendurchmesser, zulässige Geschwindigkeit der Nennweite, Netztemperaturen des betrachteten Jahres
  const t = window.netzTemperaturen?.() || { vl: 90, rl: 60, dt: 30 };
  const v = parseFloat(document.getElementById('netz-v')?.value) || 1;
  const stoff = wasserStoffwerte((t.vl + t.rl) / 2);
  const kapazitaet = kuppel.map(e => (e.dn > 0 ? rohrLeistungKw(e.dn, getVFlowForDN(e.dn, v), t.dt, stoff) : 0));
  return { zentralen, erzeuger, ueber, kuppel: kuppel.length, kuppelKapazitaetKw: kapazitaet.length ? Math.min(...kapazitaet) : 0, kuppelAuslegungKw: kuppel[0]?.load || 0 };
}

/** Block im Netz-Schritt ①: Liste der Zentralen, Zonen-Kennwerte, Einstellungen der Verbindungsleitung. */
export function hzRender() {
  const wrap = document.getElementById('hz-liste');
  if (!wrap) return;
  const zentralen = heizzentralenListe();
  const optionen = sel => '<option value="">— Gebäude wählen —</option>' + (window.gebaeude || []).filter(g => g.polygon && g.id !== hauptId())
    .map(g => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.name || 'Gebäude ' + g.id)}</option>`).join('');
  const kenn = id => {
    const k = (window._netzJeZentrale || {})[id];
    return k && zentralen.length > 1 ? `<div class="hz-kenn">${k.gebIds.length} Gebäude · ${nf(k.heizlastKw)} kW · ${nf(k.waermeMwh)} MWh/a · ${nf(k.laengeM)} m Trasse · Verluste ${nf(k.verlustMWh)} MWh/a</div>` : '';
  };
  const fest = id => (window.gebaeude || []).filter(g => Number(g.heizzentrale) === id).length;
  if (!liste().length) {
    wrap.innerHTML = '<button type="button" class="btn-secondary hz-plus" data-click="hzHinzufuegen()" title="Eine weitere Heizzentrale speist in dasselbe Netz ein; das Netz teilt sich in Versorgungszonen">＋ Weitere Heizzentrale am selben Netz</button>';
    return;
  }
  const haupt = zentralen.find(z => z.haupt);
  wrap.innerHTML = `
    <div class="hz-zeile">
      <input class="inp-field hz-name" value="${esc(haupt?.name || 'HZ 1')}" data-change="hzUmbenennen(-1,this.value)" title="Name der Hauptzentrale"/>
      <span class="hz-geb">Hauptzentrale (Auswahl oben)</span>
      <button type="button" class="hz-zu" data-click="hzZuordnen(${haupt?.id ?? 'null'})" title="Angehakte Gebäude fest dieser Zentrale zuordnen">☑→</button>
    </div>${haupt ? kenn(haupt.id) : ''}${haupt && fest(haupt.id) ? `<div class="hz-kenn">${fest(haupt.id)} fest zugeordnet</div>` : ''}
    ${liste().map((z, i) => `
    <div class="hz-zeile">
      <input class="inp-field hz-name" value="${esc(z.name || `HZ ${i + 2}`)}" data-change="hzUmbenennen(${i},this.value)"/>
      <select class="inp-field hz-geb" data-change="hzSetzen(${i},this.value)">${optionen(z.id)}</select>
      <button type="button" class="hz-zu" data-click="hzZuordnen(${z.id ?? 'null'})" title="Angehakte Gebäude fest dieser Zentrale zuordnen"${z.id == null ? ' disabled' : ''}>☑→</button>
      <button type="button" class="hz-weg" data-click="hzEntfernen(${i})" title="Zentrale entfernen">✕</button>
    </div>${z.id != null ? kenn(Number(z.id)) : ''}${z.id != null && fest(Number(z.id)) ? `<div class="hz-kenn">${fest(Number(z.id))} fest zugeordnet</div>` : ''}`).join('')}
    <button type="button" class="btn-secondary hz-plus" data-click="hzHinzufuegen()">＋ Weitere Heizzentrale</button>
    <label class="hz-opt"><input type="checkbox" id="netz-zentralen-verbinden"${window._hzVerbinden === false ? '' : ' checked'} data-change="hzVerbindenSetzen(this.checked)"/> Zonen über Verbindungsleitung koppeln</label>
    <label class="hz-opt">Übergabeleistung <input class="inp-field" id="netz-kuppel-kw" type="number" min="0" step="50" placeholder="${nf(window.kuppelUebergabeKw?.() || 0)}" value="${esc(window._hzKuppelKw || '')}" data-change="hzKuppelSetzen(this.value)"/> kW <small>leer = Sommerspitze des Netzes</small></label>
    <div class="hz-hinweis">Jedes Gebäude hängt an der über das Netz nächstgelegenen Zentrale (oder fest zugeordnet: Gebäude anhaken, ☑→). „Netz berechnen“ plant je Zone und verbindet sie. Erzeuger-Standorte und Übergabe: Einsatzanalyse → „Zentralen“.</div>`;
}

/** Reiter „Zentralen“ der Einsatzanalyse: Standorte, Einspeisung, Übergabe über die Verbindungsleitung. */
export function hzAnalyseRender() {
  const wrap = document.getElementById('hz-analyse');
  if (!wrap) return;
  const d = heizzentralenAuswertung();
  if (!d) {
    wrap.innerHTML = '<div class="sp-leer">Mehrere Heizzentralen: im Netz-Schritt ① „＋ Weitere Heizzentrale am selben Netz“ festlegen, Netz und Wärme-Grundlagen berechnen — dann zeigt dieser Reiter Einspeisung und Übergabe je Zentrale.</div>';
    return;
  }
  const opt = (key, z) => `<select class="inp-field" data-change="hzStandortSetzen('${key}',this.value)"><option value="">automatisch</option>${d.zentralen.map(x => `<option value="${x.id}"${(window._erzeugerStandortFest || {})[key] === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const zName = id => d.zentralen.find(z => z.id === id)?.name || id;
  const zeilen = d.zentralen.map(z => {
    const u = d.ueber.get(z.id) || {};
    return `<tr><td><b>${esc(z.name)}</b></td><td>${nf(u.lastMwh)} MWh/a</td><td>${nf(u.einspeisungMwh)} MWh/a</td><td>${nf(u.einspeisungMaxKw)} kW</td><td>${nf(u.abgabeMwh)} / ${nf(u.aufnahmeMwh)} MWh/a</td><td>${nf(u.maxAbgabeKw)} / ${nf(u.maxAufnahmeKw)} kW</td></tr>`;
  }).join('');
  const maxUeber = Math.max(0, ...[...d.ueber.values()].map(u => Math.max(u.maxAbgabeKw, u.maxAufnahmeKw)));
  const knapp = d.kuppel && d.kuppelKapazitaetKw > 0 && maxUeber > d.kuppelKapazitaetKw;
  wrap.innerHTML = `
    <table class="hz-tab"><thead><tr><th>Zentrale</th><th>Bedarf Zone</th><th>Einspeisung</th><th>max. Einspeisung</th><th>Abgabe / Aufnahme</th><th>max. Abgabe / Aufnahme</th></tr></thead><tbody>${zeilen}</tbody></table>
    <div class="sp-fazit ${knapp ? 'sp-schlecht' : 'sp-gut'}">${d.kuppel ? `Verbindungsleitung ausgelegt auf ${nf(d.kuppelAuslegungKw)} kW (übertragbar ca. ${nf(d.kuppelKapazitaetKw)} kW bei DN ${(window.netzEdges || []).find(e => e.kuppel)?.dn || '?'}) — größte stündliche Übergabe im Einsatzplan: ${nf(maxUeber)} kW.${knapp ? ' Die Verbindungsleitung reicht dafür nicht: Übergabeleistung im Netz-Schritt ① erhöhen oder Erzeuger anders auf die Zentralen verteilen.' : ''}` : 'Keine Verbindungsleitung zwischen den Zonen — die Zentralen müssten ihre Zonen jeweils allein versorgen.'}</div>
    <div class="sa-svg-title" style="margin-top:8px;">Erzeuger und Standort</div>
    <table class="hz-tab"><thead><tr><th>Erzeuger</th><th>Wärme</th><th>max. Leistung</th><th>Standort</th></tr></thead><tbody>
      ${d.erzeuger.map(e => `<tr><td>${esc(e.name)}</td><td>${nf(e.mwh)} MWh/a</td><td>${nf(e.maxKw)} kW</td><td>${opt(e.key === '_autoGk' ? '_autoGk' : e.key)} <small>${e.fest ? '' : '→ ' + esc(zName(e.zentrale))}</small></td></tr>`).join('')}
    </tbody></table>
    <div class="sa-svg-title" style="margin-top:10px;">Übergabe über die Verbindungsleitung (stündlich) — ${esc(d.zentralen[0].name)} gibt ab (+) bzw. nimmt auf (−)</div>
    <canvas id="hz-canvas" height="180"></canvas>`;
  requestAnimationFrame(() => _zeichneUebergabe(d));
}

function _zeichneUebergabe(d) {
  const c = document.getElementById('hz-canvas');
  if (!c) return;
  const W = c.parentElement?.clientWidth || 700, H = 180, dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '10px "DM Mono", monospace';
  const u = d.ueber.get(d.zentralen[0].id)?.uebergabeKw;
  if (!u) return;
  const L = 52, R = 8, T = 10, B = 18, pw = W - L - R, ph = H - T - B;
  let max = 1; for (let t = 0; t < u.length; t++) max = Math.max(max, Math.abs(u[t]));
  if (d.kuppelKapazitaetKw > 0) max = Math.max(max, d.kuppelKapazitaetKw * 1.05);
  const y0 = T + ph / 2, sk = (ph / 2) / max;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(L, y0); ctx.lineTo(W - R, y0); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('+' + nf(max) + ' kW', 2, T + 8); ctx.fillText('0', 2, y0 + 3); ctx.fillText('−' + nf(max), 2, T + ph);
  for (let x = 0; x < pw; x++) {
    const i0 = Math.floor(x / pw * u.length), i1 = Math.max(i0 + 1, Math.floor((x + 1) / pw * u.length));
    let mx = -Infinity, mn = Infinity;
    for (let i = i0; i < i1; i++) { if (u[i] > mx) mx = u[i]; if (u[i] < mn) mn = u[i]; }
    if (mx > 0) { ctx.fillStyle = '#4fc3f7'; ctx.fillRect(L + x, y0 - mx * sk, 1, mx * sk); }
    if (mn < 0) { ctx.fillStyle = '#ffb74d'; ctx.fillRect(L + x, y0, 1, -mn * sk); }
  }
  if (d.kuppelKapazitaetKw > 0) {
    ctx.strokeStyle = '#e57373'; ctx.setLineDash([4, 3]);
    for (const s of [1, -1]) { const y = y0 - s * d.kuppelKapazitaetKw * sk; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#e57373'; ctx.fillText('übertragbar', W - R - 70, y0 - d.kuppelKapazitaetKw * sk - 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].forEach((m, i) => ctx.fillText(m, L + i / 12 * pw + 2, H - 4));
}


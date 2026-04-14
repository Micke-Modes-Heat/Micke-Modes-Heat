// ── 05c-sankey.js — Sankey-Diagramm (Energie, CO2, je Gebäude) ──
// ══════════════════════════════════════════════════════════════════
// ── Sankey-Diagramm ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
function showSankey(perBuilding, mode) {
  let data;
  if (mode === 'co2') {
    data = _buildSankeyCO2Data();
  } else {
    data = _buildSankeyData(perBuilding);
  }
  if (!data || !data.flows.length) {
    epConfirm('Keine Daten', 'Bitte zuerst Gebäude laden und Dispatch berechnen.', {okText:'OK',cancelText:''});
    return;
  }
  _renderSankeyModal(data, perBuilding, mode || (perBuilding ? 'gebaeude' : 'liegenschaft'));
}

function _buildSankeyData(perBuilding) {
  const en = window._dispatchEnergy || {};
  const keys = window._dispatchActiveKeys || [];
  const flows = [];

  // ── Farben: Erzeuger aus ERZEUGER_CFG, Energieträger programmweit konsistent ──
  const LABEL = {
    lwwp: 'Luft-WP', fg: 'Fließgew.-WP', geo: 'Geothermie-WP',
    gaskessel: 'Gaskessel', heizoel: 'Heizölkessel', pellets: 'Pelletkessel',
    hhs: 'Hackschnitzelkessel', fernwaerme: 'Fernwärme-Übergabe', bhkw: 'BHKW',
    stromkessel: 'Stromkessel', _autoGk: 'Spitzenlast-Kessel',
    solarthermie: 'Solarthermie', _thermSpeicher: 'Wärmespeicher'
  };
  // Erzeuger-Farben aus ERZEUGER_CFG übernehmen
  const _cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG : {};
  const ECOLOR = {};
  Object.entries(_cfg).forEach(([k, c]) => { ECOLOR[k] = c.color; });
  ECOLOR._autoGk = _cfg.gaskessel?.color || '#78909c';
  ECOLOR.solarthermie = '#ffab40';
  ECOLOR._thermSpeicher = '#26a69a';

  // Feste Farben: Wärme=Rot, Strom=Gelb, Verluste=Grau/Schwarz
  const C_WAERME = '#e53935';   // Rot
  const C_STROM  = '#fdd835';   // Gelb
  const C_VERLUST = '#616161';  // Dunkelgrau
  // Energieträger-Farben (konsistent mit Programm)
  const C_ERDGAS      = _cfg.gaskessel?.color || '#78909c';
  const C_HEIZOEL     = _cfg.heizoel?.color   || '#455a64';
  const C_PELLETS     = _cfg.pellets?.color    || '#ff7043';
  const C_HHS         = _cfg.hhs?.color        || '#8d6e63';
  const C_FERNWAERME  = _cfg.fernwaerme?.color || '#e53935';
  const C_UMWELT      = '#66bb6a';
  const C_SOLAR       = '#ffab40';

  let totalWaerme = 0;
  keys.forEach(k => {
    const d = en[k];
    if (!d || !d.waermeMwh || d.waermeMwh <= 0) return;
    totalWaerme += d.waermeMwh;
  });

  // ── TWW / Raumwärme Aufteilung ──
  let twwMwh = 0, rwMwh = 0;
  const ss = window.systemState;
  if (ss && ss.lastgangKw && ss.lastgangKw.length >= 8760) {
    const vf = (parseFloat(document.getElementById('gl-netzverlust')?.value) || 10) / 100;
    const twwKw = _splitTwwFloor(ss.lastgangKw, vf);
    twwMwh = twwKw * 8760 / 1000;  // Konstante TWW-Last übers Jahr
    const nutzMwh = (ss.nutzwaermeMwh || ss.gesamtMwhMitNV || totalWaerme);
    rwMwh = Math.max(0, nutzMwh - twwMwh);
  } else {
    rwMwh = totalWaerme;
  }

  // Brennstoff → Erzeuger → Nutzwärme + Wirkungsgradverluste
  let totalVerluste = 0;
  keys.forEach(k => {
    const d = en[k];
    if (!d || !d.waermeMwh || d.waermeMwh <= 0) return;
    const label = LABEL[k] || k;
    const eCol = ECOLOR[k] || '#78909c';

    // Brennstoff-Input (Primärenergie)
    let brennstoffMwh = 0;
    if (['gaskessel', '_autoGk'].includes(k)) {
      const eta = parseFloat(document.getElementById('gk-eta')?.value) / 100 || 0.92;
      brennstoffMwh = d.waermeMwh / eta;
      flows.push({ from: 'Erdgas', to: label, value: brennstoffMwh, color: C_ERDGAS });
    } else if (k === 'heizoel') {
      brennstoffMwh = d.waermeMwh / (_getEtaMap().heizoel || 0.90);
      flows.push({ from: 'Heizöl', to: label, value: brennstoffMwh, color: C_HEIZOEL });
    } else if (k === 'pellets') {
      brennstoffMwh = d.waermeMwh / _getEtaMap().pellets;
      flows.push({ from: 'Pellets', to: label, value: brennstoffMwh, color: C_PELLETS });
    } else if (k === 'hhs') {
      brennstoffMwh = d.waermeMwh / _getEtaMap().hhs;
      flows.push({ from: 'Hackschnitzel', to: label, value: brennstoffMwh, color: C_HHS });
    } else if (k === 'bhkw') {
      const bhkwEtaGes = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
      const bhkwSigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      const eta_th = bhkwEtaGes / (1 + bhkwSigma);
      brennstoffMwh = d.waermeMwh / eta_th;
      flows.push({ from: 'Erdgas', to: label, value: brennstoffMwh, color: C_ERDGAS });
    } else if (k === 'fernwaerme') {
      flows.push({ from: 'Fernwärme-Netz', to: label, value: d.waermeMwh, color: C_FERNWAERME });
    } else if (['lwwp', 'fg', 'geo'].includes(k)) {
      const elMwh = d.elMwh || (d.waermeMwh / 3.0);
      const umwelt = d.waermeMwh - elMwh;
      // Strom-Quelle (Netz vs. PV) wird unten aufgeteilt
      flows.push({ from: '_strom_wp', to: label, value: elMwh, color: C_STROM, _isElPlaceholder: true });
      if (umwelt > 0) flows.push({ from: 'Umweltwärme', to: label, value: umwelt, color: C_UMWELT });
    } else if (k === 'stromkessel') {
      flows.push({ from: '_strom_sk', to: label, value: d.elMwh || d.waermeMwh, color: C_STROM, _isElPlaceholder: true });
    } else if (k === 'solarthermie') {
      flows.push({ from: 'Solarstrahlung', to: label, value: d.waermeMwh, color: C_SOLAR });
    } else if (k === '_thermSpeicher') {
      // Speicher-Entladung: keine Eingangsseite
    }

    // Erzeuger → Nutzwärme
    flows.push({ from: label, to: 'Erzeugte Wärme', value: d.waermeMwh, color: C_WAERME });

    // Wirkungsgradverluste (Brennstoff - Nutzwärme - Strom)
    // Bei BHKW: Verlust = Brennstoff - Wärme - Strom
    let verlust = 0;
    if (k === 'bhkw') {
      verlust = brennstoffMwh - d.waermeMwh - (d.elMwh || 0);
    } else if (brennstoffMwh > 0) {
      verlust = brennstoffMwh - d.waermeMwh;
    }
    if (verlust > 0.1) {
      flows.push({ from: label, to: 'Wirkungsgrad-\nverluste', value: verlust, color: C_VERLUST });
      totalVerluste += verlust;
    }
  });

  // ── Erzeugte Wärme → Raumwärme + TWW (parallel zu Netzverlusten) ──
  if (twwMwh > 0.1 && rwMwh > 0.1) {
    flows.push({ from: 'Erzeugte Wärme', to: 'Raumwärme', value: rwMwh, color: C_WAERME });
    flows.push({ from: 'Erzeugte Wärme', to: 'Trinkwarmwasser', value: twwMwh, color: '#ff8a65' });
  } else {
    flows.push({ from: 'Erzeugte Wärme', to: 'Wärmebedarf', value: totalWaerme, color: C_WAERME });
  }

  // ── Netzverluste (falls Wärmenetz vorhanden) ──
  const netzVerlMwh = (Array.isArray(netzEdges) ? netzEdges : []).reduce((s, e) => s + (e.lossKW_annual || 0), 0) * 8.76;
  if (netzVerlMwh > 0.1) {
    flows.push({ from: 'Erzeugte Wärme', to: 'Netzverluste', value: netzVerlMwh, color: C_VERLUST });
  }
  // ── Speicherverluste ──
  const tss = window._thermSpeicherState;
  if (tss && tss.verlustH) {
    let spVerlMwh = 0;
    for (let i = 0; i < tss.verlustH.length; i++) spVerlMwh += tss.verlustH[i];
    spVerlMwh /= 1000;
    if (spVerlMwh > 0.1) {
      flows.push({ from: 'Wärmespeicher', to: 'Speicherverluste', value: spVerlMwh, color: C_VERLUST });
    }
  }

  // ── Stromseite ──
  const pvKwp = (parseFloat(document.getElementById('pv-kwp')?.value) || 0)
    + gebaeude.reduce((s,g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0)
    + freiflaechen.reduce((s,ff) => s + calcFFKwp(ff), 0);
  const pvMwh = pvKwp * (parseFloat(document.getElementById('pv-spez')?.value) || 1000) / 1000;

  let quartierMwh = 0;
  if (window.elQuartierH) {
    for (let i = 0; i < window.elQuartierH.length; i++) quartierMwh += window.elQuartierH[i];
    quartierMwh /= 1000;
  } else {
    quartierMwh = gebaeude.reduce((s,g) => s + (typeof getGebStromMwh === 'function' ? getGebStromMwh(g) : 0), 0);
  }

  const wpElMwh = ['lwwp','fg','geo'].reduce((s,k) => s + ((en[k]||{}).elMwh||0), 0);
  const skElMwh = (en.stromkessel||{}).elMwh || 0;
  const bhkwElMwh = (en.bhkw||{}).elMwh || 0;
  const totalStromBedarf = quartierMwh + wpElMwh + skElMwh;

  const totalErz = pvMwh + bhkwElMwh;
  const eigenverbrauch = Math.min(totalErz, totalStromBedarf);
  const einspeisung = Math.max(0, totalErz - totalStromBedarf);
  const netzbezug = Math.max(0, totalStromBedarf - totalErz);

  // ── Strom-Verbrauch aufschlüsseln: stündlich berechnete Aufteilung aus calcStromPanel ──
  const sb = window._stromBilanz || {};

  // Platzhalter-Flows durch echte Quellen ersetzen (WP, Stromkessel)
  for (let fi = flows.length - 1; fi >= 0; fi--) {
    const f = flows[fi];
    if (!f._isElPlaceholder) continue;
    const target = f.to;
    const isWp = f.from === '_strom_wp';
    flows.splice(fi, 1);
    // Stündlich berechnete Anteile verwenden
    const nA = isWp ? (sb.netzToWp || 0) : (sb.netzToSk || 0);
    const pvA = isWp ? (sb.pvToWp || 0) : (sb.pvToSk || 0);
    const bhA = isWp ? (sb.bhkwToWp || 0) : (sb.bhkwToSk || 0);
    // Fallback: wenn keine stündlichen Daten, gesamten Strom als Netzbezug
    if (nA < 0.01 && pvA < 0.01 && bhA < 0.01 && f.value > 0.05) {
      flows.push({ from: 'Strom (Netz)', to: target, value: f.value, color: C_STROM });
    } else {
      if (nA > 0.05) flows.push({ from: 'Strom (Netz)', to: target, value: nA, color: C_STROM });
      if (pvA > 0.05) flows.push({ from: 'PV-Erzeugung', to: target, value: pvA, color: C_STROM });
      if (bhA > 0.05) flows.push({ from: 'BHKW-Strom', to: target, value: bhA, color: C_STROM });
    }
  }

  // Quartier-Strombedarf
  if (quartierMwh > 0.1) {
    const qN = sb.netzToQuartier || 0, qP = sb.pvToQuartier || 0, qB = sb.bhkwToQuartier || 0;
    if (qN < 0.01 && qP < 0.01 && qB < 0.01) {
      // Fallback: kein stündliches Ergebnis → alles Netz
      flows.push({ from: 'Strom (Netz)', to: 'Strombedarf Quartier', value: quartierMwh, color: C_STROM });
    } else {
      if (qN > 0.05) flows.push({ from: 'Strom (Netz)', to: 'Strombedarf Quartier', value: qN, color: C_STROM });
      if (qP > 0.05) flows.push({ from: 'PV-Erzeugung', to: 'Strombedarf Quartier', value: qP, color: C_STROM });
      if (qB > 0.05) flows.push({ from: 'BHKW-Strom', to: 'Strombedarf Quartier', value: qB, color: C_STROM });
    }
  }

  // Einspeisung (stündlich berechnet)
  if ((sb.pvEinspMwh || 0) > 0.1) flows.push({ from: 'PV-Erzeugung', to: 'Einspeisung', value: sb.pvEinspMwh, color: '#81c784' });
  if ((sb.bhkwEinspMwh || 0) > 0.1) flows.push({ from: 'BHKW-Strom', to: 'Einspeisung', value: sb.bhkwEinspMwh, color: '#81c784' });

  // Filter winzige Flüsse
  return { flows: flows.filter(f => f.value > 0.05), totalWaerme, totalStromBedarf, unit: 'MWh' };
}

function _buildSankeyCO2Data() {
  const en = window._dispatchEnergy || {};
  const keys = window._dispatchActiveKeys || [];
  const flows = [];

  // Emissionsfaktoren: globale Variablen (stromEmF, gasEmF, heizoelEmF, pelletsEmF, hhsEmF, fernwaermeEmF)
  const LABEL = {
    lwwp: 'Luft-WP', fg: 'Fließgew.-WP', geo: 'Geothermie-WP',
    gaskessel: 'Gaskessel', heizoel: 'Heizölkessel', pellets: 'Pelletkessel',
    hhs: 'Hackschnitzelkessel', fernwaerme: 'Fernwärme-Übergabe', bhkw: 'BHKW',
    stromkessel: 'Stromkessel', _autoGk: 'Spitzenlast-Kessel',
    solarthermie: 'Solarthermie'
  };
  const COLOR = {
    lwwp: '#66bb6a', fg: '#4fc3f7', geo: '#8d6e63',
    gaskessel: '#ff9800', heizoel: '#546e7a', pellets: '#d7ccc8',
    hhs: '#a1887f', fernwaerme: '#e53935', bhkw: '#ffb74d',
    stromkessel: '#fdd835', _autoGk: '#90a4ae', solarthermie: '#ffab40'
  };

  let totalCO2 = 0;

  keys.forEach(k => {
    const d = en[k];
    if (!d || !d.waermeMwh || d.waermeMwh <= 0) return;
    if (k === '_thermSpeicher') return; // Speicher hat keine eigenen Emissionen
    const label = LABEL[k] || k;
    const col = COLOR[k] || '#90a4ae';
    let co2_t = 0; // Tonnen CO2/a

    if (['gaskessel', '_autoGk'].includes(k)) {
      const eta = parseFloat(document.getElementById('gk-eta')?.value) / 100 || 0.92;
      const brennstoffMwh = d.waermeMwh / eta;
      co2_t = brennstoffMwh * 1000 * gasEmF / 1e6;
      flows.push({ from: 'Erdgas', to: label, value: co2_t, color: '#ff9800' });
    } else if (k === 'heizoel') {
      const brennstoffMwh = d.waermeMwh / (_getEtaMap().heizoel || 0.90);
      co2_t = brennstoffMwh * 1000 * heizoelEmF / 1e6;
      flows.push({ from: 'Heizöl', to: label, value: co2_t, color: '#546e7a' });
    } else if (k === 'pellets') {
      const brennstoffMwh = d.waermeMwh / _getEtaMap().pellets;
      co2_t = brennstoffMwh * 1000 * pelletsEmF / 1e6;
      flows.push({ from: 'Pellets', to: label, value: co2_t, color: '#d7ccc8' });
    } else if (k === 'hhs') {
      const brennstoffMwh = d.waermeMwh / _getEtaMap().hhs;
      co2_t = brennstoffMwh * 1000 * hhsEmF / 1e6;
      flows.push({ from: 'Hackschnitzel', to: label, value: co2_t, color: '#a1887f' });
    } else if (k === 'bhkw') {
      const bhkwEtaGes = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
      const bhkwSigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      const eta_th = bhkwEtaGes / (1 + bhkwSigma);
      const brennstoffMwh = d.waermeMwh / eta_th;
      co2_t = brennstoffMwh * 1000 * gasEmF / 1e6;
      flows.push({ from: 'Erdgas', to: label, value: co2_t, color: '#ff9800' });
      // KWK-Gutschrift
      if (d.elMwh > 0) {
        const gutschrift = d.elMwh * 1000 * stromEmF / 1e6;
        flows.push({ from: label, to: 'KWK-Gutschrift', value: gutschrift, color: '#81c784' });
        co2_t -= gutschrift; // Netto-Effekt
      }
    } else if (k === 'fernwaerme') {
      co2_t = d.waermeMwh * 1000 * fernwaermeEmF / 1e6;
      flows.push({ from: 'Fernwärme-Netz', to: label, value: co2_t, color: '#e53935' });
    } else if (['lwwp', 'fg', 'geo'].includes(k)) {
      const elMwh = d.elMwh || (d.waermeMwh / 3.0);
      co2_t = elMwh * 1000 * stromEmF / 1e6;
      flows.push({ from: 'Strom-Mix', to: label, value: co2_t, color: '#42a5f5' });
    } else if (k === 'stromkessel') {
      const elMwh = d.elMwh || d.waermeMwh;
      co2_t = elMwh * 1000 * stromEmF / 1e6;
      flows.push({ from: 'Strom-Mix', to: label, value: co2_t, color: '#42a5f5' });
    } else if (k === 'solarthermie') {
      co2_t = 0; // Keine Emissionen
    }

    if (co2_t > 0.01) {
      flows.push({ from: label, to: 'CO\u2082 gesamt', value: co2_t, color: col });
      totalCO2 += co2_t;
    }
  });

  return { flows: flows.filter(f => f.value > 0.005), totalCO2, unit: 't CO\u2082' };
}

function _renderSankeyModal(data, perBuilding, mode) {
  mode = mode || 'liegenschaft';
  let existing = document.getElementById('sankey-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'sankey-modal';
  overlay.className = 'ep-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const W = Math.min(window.innerWidth - 40, 1000);
  const H = Math.min(window.innerHeight - 80, 600);
  const isCO2 = (mode === 'co2');
  const title = isCO2 ? '\uD83C\uDF2B\uFE0F CO\u2082-Emissionen — Sankey' : '\uD83D\uDD00 Energiefluss — Sankey';
  const footer = isCO2 ? 'Werte in t CO\u2082/a — Breite proportional zu Emissionen' : 'Werte in MWh/a — Breite proportional zum Energiefluss';

  overlay.innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;width:${W}px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:600;color:var(--text);">${title}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="sankey-mode" style="padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;">
            <option value="liegenschaft">Energiefluss (gesamt)</option>
            <option value="gebaeude">Energiefluss (gebäudescharf)</option>
            <option value="co2">CO\u2082-Emissionen</option>
          </select>
          <button onclick="this.closest('.ep-modal-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1;">\u2715</button>
        </div>
      </div>
      <canvas id="sankey-canvas" width="${W - 32}" height="${H}" style="width:100%;border-radius:8px;background:var(--bg);"></canvas>
      <div id="sankey-footer" style="margin-top:8px;font-size:9px;color:var(--muted);text-align:center;">${footer}</div>
    </div>`;
  document.body.appendChild(overlay);

  const sel = document.getElementById('sankey-mode');
  sel.value = mode;
  sel.onchange = () => {
    const v = sel.value;
    overlay.remove();
    if (v === 'co2') showSankey(false, 'co2');
    else showSankey(v === 'gebaeude');
  };

  const canvas = document.getElementById('sankey-canvas');
  _drawSankey(canvas, data);
}

function _drawSankey(canvas, data) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const flows = data.flows;
  const unit = data.unit || 'MWh';
  if (!flows.length) return;

  // ── 1. Graph aufbauen ──
  const nodeSet = new Set();
  flows.forEach(f => { nodeSet.add(f.from); nodeSet.add(f.to); });

  const outMap = {}, inMap = {};
  nodeSet.forEach(n => { outMap[n] = []; inMap[n] = []; });
  flows.forEach(f => { outMap[f.from].push(f); inMap[f.to].push(f); });

  // Spalten zuweisen
  const DEMAND_NODES = new Set(['Wärmebedarf', 'Erzeugte Wärme', 'Strombedarf Quartier', 'CO\u2082 gesamt',
    'Wirkungsgrad-\nverluste', 'Einspeisung']);
  const LOSS_NODES = new Set(['Netzverluste', 'Speicherverluste', 'KWK-Gutschrift',
    'Raumwärme', 'Trinkwarmwasser']);
  const col = {};
  nodeSet.forEach(n => {
    if (DEMAND_NODES.has(n)) col[n] = 2;
    else if (LOSS_NODES.has(n)) col[n] = 3;
    else if (inMap[n].length === 0) col[n] = 0;
    else col[n] = 1;
  });

  // Knotenwerte
  const nodeVal = {};
  nodeSet.forEach(n => {
    const inV = inMap[n].reduce((s,f) => s + f.value, 0);
    const outV = outMap[n].reduce((s,f) => s + f.value, 0);
    nodeVal[n] = Math.max(inV, outV);
  });

  // ── 2. Layout ──
  const NUM_COLS = 4;
  const PAD = 100, NODE_W = 12, GAP = 10;
  const colSpacing = (W - 2 * PAD - NODE_W) / (NUM_COLS - 1);
  const COL_X = Array.from({length: NUM_COLS}, (_, i) => PAD + i * colSpacing);
  const colNodes = Array.from({length: NUM_COLS}, () => []);
  nodeSet.forEach(n => colNodes[col[n]].push(n));

  const nodeY = {}, nodeH = {};

  // Globale Skalierung: Die Spalte mit dem größten Gesamtwert bestimmt den Maßstab
  const colTotals = colNodes.map(arr => arr.reduce((s,n) => s + nodeVal[n], 0));
  const maxColTotal = Math.max(...colTotals, 1);
  const maxColGaps = Math.max(...colNodes.map(arr => Math.max(0, arr.length - 1) * GAP));
  const globalScale = (H - 40 - maxColGaps) / maxColTotal;

  function _layoutCol(arr) {
    const totalH = arr.reduce((s,n) => s + nodeVal[n] * globalScale, 0) + Math.max(0, arr.length - 1) * GAP;
    let y = 20 + (H - 40 - totalH) / 2; // vertikal zentrieren
    arr.forEach(n => {
      nodeH[n] = Math.max(4, nodeVal[n] * globalScale);
      nodeY[n] = y;
      y += nodeH[n] + GAP;
    });
  }

  // Startsortierung: Spalte 1 nach Wert (größte oben)
  colNodes[1].sort((a,b) => nodeVal[b] - nodeVal[a]);
  _layoutCol(colNodes[1]);

  // Spalte 0: Sortieren nach gewichtetem Schwerpunkt der Ziele in Spalte 1
  // Das ist der Schlüssel gegen Kreuzungen!
  function _targetCenter(n) {
    let sumW = 0, sumWY = 0;
    outMap[n].forEach(f => {
      const ty = nodeY[f.to] + nodeH[f.to] / 2;
      sumW += f.value; sumWY += f.value * ty;
    });
    return sumW > 0 ? sumWY / sumW : H / 2;
  }
  colNodes[0].sort((a,b) => _targetCenter(a) - _targetCenter(b));
  _layoutCol(colNodes[0]);

  // Spalte 2+3: nach Schwerpunkt der Quellen in Spalte 1
  function _sourceCenter(n) {
    let sumW = 0, sumWY = 0;
    inMap[n].forEach(f => {
      const sy = nodeY[f.from] + nodeH[f.from] / 2;
      sumW += f.value; sumWY += f.value * sy;
    });
    return sumW > 0 ? sumWY / sumW : H / 2;
  }
  colNodes[2].sort((a,b) => _sourceCenter(a) - _sourceCenter(b));
  _layoutCol(colNodes[2]);
  colNodes[3].sort((a,b) => _sourceCenter(a) - _sourceCenter(b));
  _layoutCol(colNodes[3]);

  // Iteratives Verfeinern (12 Iterationen, abwechselnd vorwärts/rückwärts)
  for (let iter = 0; iter < 12; iter++) {
    // Vorwärts: Spalte 0,1,2,3 nach Schwerpunkt der eingehenden Nachbarn
    for (let c = 0; c < NUM_COLS; c++) {
      if (c === 0) {
        colNodes[c].sort((a,b) => _targetCenter(a) - _targetCenter(b));
      } else {
        colNodes[c].sort((a,b) => _sourceCenter(a) - _sourceCenter(b));
      }
      _layoutCol(colNodes[c]);
    }
    // Rückwärts: Spalte 3,2,1,0 nach Schwerpunkt der ausgehenden Nachbarn
    for (let c = NUM_COLS - 1; c >= 0; c--) {
      if (outMap[colNodes[c][0]] && outMap[colNodes[c][0]].length > 0) {
        colNodes[c].sort((a,b) => _targetCenter(a) - _targetCenter(b));
      } else {
        colNodes[c].sort((a,b) => _sourceCenter(a) - _sourceCenter(b));
      }
      _layoutCol(colNodes[c]);
    }
  }

  // ── 3. Flow-Dicke berechnen ──
  const nodeOutScale = {}, nodeInScale = {};
  nodeSet.forEach(n => {
    const outSum = outMap[n].reduce((s,f) => s + f.value, 0);
    const inSum  = inMap[n].reduce((s,f) => s + f.value, 0);
    nodeOutScale[n] = outSum > 0 ? nodeH[n] / outSum : 1;
    nodeInScale[n]  = inSum > 0 ? nodeH[n] / inSum : 1;
  });

  // ── 4. Flows sortieren und zeichnen ──
  // Pro Quellknoten: Flows nach Ziel-Y sortieren (verhindert intra-node Kreuzungen)
  // Dann Quellknoten-Gruppen nach Quell-Y
  const sortedFlows = [...flows].sort((a, b) => {
    // Zuerst nach Quell-Knoten Y
    const ya = nodeY[a.from];
    const yb = nodeY[b.from];
    if (a.from !== b.from) return ya - yb;
    // Gleicher Quellknoten: nach Ziel-Y
    return nodeY[a.to] - nodeY[b.to];
  });

  // Auch die eingehenden Flows pro Zielknoten sortieren
  // damit an der Zielseite die Bänder in der richtigen Reihenfolge ankommen
  const inOrder = {};
  nodeSet.forEach(n => {
    inOrder[n] = inMap[n].slice().sort((a,b) => nodeY[a.from] - nodeY[b.from]);
  });

  // Ziel-Seite: Y-Positionen vorab zuweisen (in Reihenfolge der Quell-Y)
  const usedIn = {};
  nodeSet.forEach(n => usedIn[n] = nodeY[n]);
  const flowInY = new Map();
  nodeSet.forEach(n => {
    inOrder[n].forEach(f => {
      const thick = Math.max(1.5, f.value * nodeInScale[n]);
      flowInY.set(f, { y: usedIn[n], thick });
      usedIn[n] += thick;
    });
  });

  // Quell-Seite: Y-Positionen in Reihenfolge der sortierten Flows
  const usedOut = {};
  nodeSet.forEach(n => usedOut[n] = nodeY[n]);

  sortedFlows.forEach(f => {
    const fromCol = col[f.from], toCol = col[f.to];
    const fromX = COL_X[fromCol] + NODE_W;
    const toX = COL_X[toCol];

    const thickFrom = Math.max(1.5, f.value * nodeOutScale[f.from]);
    const inInfo = flowInY.get(f);
    const thickTo = inInfo ? inInfo.thick : thickFrom;

    const y0 = usedOut[f.from];
    const y1 = inInfo ? inInfo.y : usedOut[f.from]; // fallback
    usedOut[f.from] += thickFrom;

    // Bezier-Band
    const cpx = (fromX + toX) / 2;
    ctx.beginPath();
    ctx.moveTo(fromX, y0);
    ctx.bezierCurveTo(cpx, y0, cpx, y1, toX, y1);
    ctx.lineTo(toX, y1 + thickTo);
    ctx.bezierCurveTo(cpx, y1 + thickTo, cpx, y0 + thickFrom, fromX, y0 + thickFrom);
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = f.color || '#4fc3f7';
    ctx.fill();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();

    // Label auf breiten Flows
    const avgThick = (thickFrom + thickTo) / 2;
    if (avgThick > 14 && fromCol === 0) {
      const mx = (fromX + toX) / 2;
      const my = (y0 + y1) / 2 + avgThick / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '10px "DM Mono", monospace';
      ctx.textAlign = 'center';
      const valTxt = f.value >= 10 ? f.value.toFixed(0) : f.value.toFixed(1);
      ctx.fillText(valTxt + ' ' + unit, mx, my);
    }
  });

  // ── 5. Knoten zeichnen ──
  // Farben: Erzeuger aus ERZEUGER_CFG, Wärme=Rot, Strom=Gelb, Verluste=Grau
  const _cfg2 = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG : {};
  const NODE_COLORS = {
    // Energieträger (programmweit konsistent)
    'Erdgas': _cfg2.gaskessel?.color || '#78909c',
    'Heizöl': _cfg2.heizoel?.color || '#455a64',
    'Pellets': _cfg2.pellets?.color || '#ff7043',
    'Hackschnitzel': _cfg2.hhs?.color || '#8d6e63',
    'Fernwärme-Netz': _cfg2.fernwaerme?.color || '#e53935',
    'Strom (Netz)': '#fdd835',       // Strom = gelb
    'Umweltwärme': '#66bb6a',
    'PV-Erzeugung': '#fdd835',       // Strom = gelb
    // Strom (BHKW) entfernt — BHKW fließt direkt zu Strombedarf/Einspeisung
    'Solarstrahlung': '#ffab40',
    'Strom-Mix': '#fdd835',
    // Erzeuger (aus ERZEUGER_CFG)
    'Luft-WP': _cfg2.lwwp?.color || '#66bb6a',
    'Fließgew.-WP': _cfg2.fg?.color || '#29b6f6',
    'Geothermie-WP': _cfg2.geo?.color || '#a1887f',
    'Gaskessel': _cfg2.gaskessel?.color || '#78909c',
    'Heizölkessel': _cfg2.heizoel?.color || '#455a64',
    'Pelletkessel': _cfg2.pellets?.color || '#ff7043',
    'Hackschnitzelkessel': _cfg2.hhs?.color || '#8d6e63',
    'Fernwärme-Übergabe': _cfg2.fernwaerme?.color || '#e53935',
    'BHKW': _cfg2.bhkw?.color || '#ff8f00',
    'Stromkessel': _cfg2.stromkessel?.color || '#ff69b4',
    'Spitzenlast-Kessel': _cfg2.gaskessel?.color || '#78909c',
    'Solarthermie': '#ffab40',
    'Wärmespeicher': '#26a69a',
    // Wärme = Rot
    'Erzeugte Wärme': '#e53935',
    'Wärmebedarf': '#e53935',
    'Raumwärme': '#e53935',
    'Trinkwarmwasser': '#ff8a65',     // TWW = orange (wie im Split-Chart)
    'Strombedarf Quartier': '#fdd835', // Strom = gelb
    // Verluste = dunkelgrau
    'Netzverluste': '#616161',
    'Speicherverluste': '#616161',
    'Wirkungsgrad-\nverluste': '#616161',
    // CO2
    'CO\u2082 gesamt': '#ef5350',
    'KWK-Gutschrift': '#81c784',
    'Einspeisung': '#81c784',
    'Fernwärme': _cfg2.fernwaerme?.color || '#e53935',
  };

  nodeSet.forEach(n => {
    const x = COL_X[col[n]];
    const y = nodeY[n];
    const h = nodeH[n];
    ctx.fillStyle = NODE_COLORS[n] || '#78909c';
    ctx.fillRect(x, y, NODE_W, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, NODE_W, h);

    ctx.fillStyle = '#e8eaf0';
    ctx.font = '11px Inter, system-ui, sans-serif';
    const myCol = col[n];
    const isLeft = myCol === 0;
    const isRight = myCol >= 2;
    ctx.textAlign = isLeft ? 'right' : isRight ? 'left' : 'center';
    const lx = isLeft ? x - 6 : isRight ? x + NODE_W + 6 : x + NODE_W / 2;
    const ly = y + Math.min(h / 2, 20) + 4;
    // Mehrzeilige Labels (mit \n)
    const lines = n.split('\n');
    lines.forEach((ln, li) => {
      ctx.fillStyle = '#e8eaf0';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillText(ln, lx, ly + li * 13);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px "DM Mono", monospace';
    const valTxt = nodeVal[n] >= 10 ? nodeVal[n].toFixed(0) : nodeVal[n].toFixed(1);
    ctx.fillText(valTxt + ' ' + unit, lx, ly + lines.length * 13);
  });
}


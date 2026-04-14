// ── 09c-pv-charts-opt.js — Strom-Charts, Sankey, JDL, PV+Bat-Optimierung ──

// ── Monatschart ───────────────────────────────────────────────────────────
function _stromRenderMonatsChart(monthlyQuartier, monthlyWp, monthlyPv) {
  const canvas = document.getElementById('strom-monats-canvas');
  if (!canvas) return;
  const W = canvas.offsetWidth || 500;
  const H = 110;
  canvas.width  = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr, dpr);

  const PAD = { l: 38, r: 6, t: 6, b: 18 };
  const iW  = W - PAD.l - PAD.r;
  const iH  = H - PAD.t - PAD.b;

  ctx.clearRect(0, 0, W, H);

  const hasPv  = monthlyPv && monthlyPv.some(v => v > 0);
  const maxBar = Math.max(...monthlyQuartier.map((v, i) => v + monthlyWp[i]), 1);
  const maxPv  = hasPv ? Math.max(...monthlyPv) : 0;
  const maxVal = Math.max(maxBar, maxPv, 1);
  const barW   = iW / 12;
  const gap    = 2;
  const MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  // Gitternetz
  ctx.strokeStyle = '#2a3050';
  ctx.lineWidth   = 0.5;
  [0, 0.5, 1].forEach(f => {
    const y = PAD.t + iH - f * iH;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + iW, y); ctx.stroke();
    ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * f), PAD.l - 3, y + 3);
  });

  for (let m = 0; m < 12; m++) {
    const x  = PAD.l + m * barW + gap / 2;
    const bw = barW - gap;
    // Quartierlast (unten, grau)
    const hQ = (monthlyQuartier[m] / maxVal) * iH;
    if (hQ > 0.3) {
      ctx.fillStyle = '#78909c';
      ctx.fillRect(x, PAD.t + iH - hQ, bw, hQ);
    }
    // WP-Strom (oben auf Quartier, gelb)
    const hW = (monthlyWp[m] / maxVal) * iH;
    if (hW > 0.3) {
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(x, PAD.t + iH - hQ - hW, bw, hW);
    }
    // Monatsbezeichnung
    ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(MONTHS[m], x + bw / 2, H - 4);
  }

  // PV-Linie (grün, gestrichelt)
  if (hasPv) {
    ctx.beginPath();
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 2]);
    for (let m = 0; m < 12; m++) {
      const x  = PAD.l + m * barW + gap / 2 + (barW - gap) / 2;
      const y  = PAD.t + iH - (monthlyPv[m] / maxVal) * iH;
      if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Punkte
    ctx.fillStyle = '#66bb6a';
    for (let m = 0; m < 12; m++) {
      const x = PAD.l + m * barW + gap / 2 + (barW - gap) / 2;
      const y = PAD.t + iH - (monthlyPv[m] / maxVal) * iH;
      ctx.beginPath(); ctx.arc(x, y, 2, 0, 2 * Math.PI); ctx.fill();
    }
  }

  // Y-Achse Label
  ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('MWh', PAD.l - 3, PAD.t + 6);
}

// ── Strom-Tab-Steuerung ───────────────────────────────────────────────────
let _stromCurrentTab = 'monat';
function _stromSetTab(tab) {
  _stromCurrentTab = tab;
  ['monat','jdl','fluss','sankey','lastgang'].forEach(t => {
    const content = document.getElementById('strom-content-' + t);
    const btn     = document.getElementById('strom-tab-' + t);
    if (content) content.style.display = t === tab ? '' : 'none';
    if (btn) {
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--muted)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent)' : 'transparent';
    }
  });
  if (tab === 'jdl')      _stromRenderJdl();
  if (tab === 'fluss')    _stromRenderFlussChart(window._stromFlussWeek || 0);
  if (tab === 'sankey')   drawSankeyStrom();
  if (tab === 'lastgang') _stromRenderLastgang();
}

// ── Sankey-Diagramm: jährlicher Stromfluss ───────────────────────────────────
function drawSankeyStrom() {
  const svg = document.getElementById('strom-sankey-svg');
  if (!svg) return;

  // Daten aus globalen Strom-Variablen
  const d = window._sankeyData;
  if (!d) { svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#666" font-size="11">Keine Daten — Wärme-Grundlagen konfigurieren und Erzeuger platzieren.</text>'; return; }

  const { pvMwh, netzbezugMwh, einspeisungMwh, eigenverbrauchMwh,
          wpMwh, skMwh, quartierMwh, bhkwStromMwh } = d;

  const W = svg.parentElement.clientWidth || 380;
  const H = 270;
  const MT = 24, MB = 16, ML = 100, MR = 108;
  const nodeW = 13, gap = 10;

  // Quellen (links) und Senken (rechts) aufbauen
  const src = [], snk = [];
  if ((pvMwh       || 0) > 0.5) src.push({ id:'pv',    label:'PV',        val: pvMwh,        color:'#c6e03a' });
  if ((bhkwStromMwh|| 0) > 0.5) src.push({ id:'bhkw',  label:'BHKW',      val: bhkwStromMwh, color:'#ff8f00' });
  if ((netzbezugMwh|| 0) > 0.5) src.push({ id:'netz',  label:'Netzbezug', val: netzbezugMwh, color:'#ef5350' });

  if ((wpMwh          || 0) > 0.5) snk.push({ id:'wp',          label:'Wärmepumpen',  val: wpMwh,          color:'#42a5f5' });
  if ((skMwh          || 0) > 0.5) snk.push({ id:'sk',          label:'Stromkessel',  val: skMwh,          color:'#ab47bc' });
  if ((quartierMwh    || 0) > 0.5) snk.push({ id:'quartier',    label:'Quartier',     val: quartierMwh,    color:'#78909c' });
  if ((einspeisungMwh || 0) > 0.5) snk.push({ id:'einspeisung', label:'Einspeisung',  val: einspeisungMwh, color:'#66bb6a' });

  if (src.length === 0 || snk.length === 0) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#666" font-size="11">Keine Ströme berechnet.</text>';
    return;
  }

  const total    = src.reduce((s, n) => s + n.val, 0);
  const innerH   = H - MT - MB;
  const totalGap = gap * (Math.max(src.length, snk.length) - 1);
  const hPer     = (innerH - totalGap) / total;

  // Y-Positionen der Knoten berechnen
  const layoutNodes = (nodes) => {
    let y = MT;
    nodes.forEach(n => { n.h = Math.max(4, n.val * hPer); n.y = y; n.yOff = 0; y += n.h + gap; });
  };
  layoutNodes(src);
  layoutNodes(snk);

  const srcMap = Object.fromEntries(src.map(n => [n.id, n]));
  const snkMap = Object.fromEntries(snk.map(n => [n.id, n]));

  // Flüsse definieren: Eigenverbrauch + Einspeisung von PV/BHKW, Netzbezug zu Verbrauchern
  const totalDemand = (wpMwh || 0) + (skMwh || 0) + (quartierMwh || 0);
  const links = [];
  const addFlow = (srcId, snkId, val) => {
    if (val > 0.5 && srcMap[srcId] && snkMap[snkId]) links.push({ srcId, snkId, val, color: srcMap[srcId].color });
  };

  // Flüsse korrekt aufteilen: jede Quelle anteilig zu Eigenverbrauch + Einspeisung
  // Netzbezug geht vollständig zu Verbrauchern (ist per Definition das Fehlende)
  // Lokale Erzeugung (PV + BHKW) teilt sich auf: Eigenverbrauch + Einspeisung
  const totalGen   = (pvMwh || 0) + (bhkwStromMwh || 0);
  const ev         = Math.min(eigenverbrauchMwh || 0, totalDemand); // Eigenverbrauch gesamt
  const pvToEv     = totalGen > 0 ? Math.min(pvMwh || 0, ev * (pvMwh || 0) / totalGen) : 0;
  const bhkwToEv   = totalGen > 0 ? Math.min(bhkwStromMwh || 0, ev * (bhkwStromMwh || 0) / totalGen) : 0;
  const pvToEinsp   = Math.max(0, (pvMwh || 0) - pvToEv);
  const bhkwToEinsp = Math.max(0, (bhkwStromMwh || 0) - bhkwToEv);

  if (totalDemand > 0) {
    snk.filter(s => s.id !== 'einspeisung').forEach(s => {
      const frac = s.val / totalDemand;
      if (pvToEv     > 0.5) addFlow('pv',   s.id, pvToEv * frac);
      if (bhkwToEv   > 0.5) addFlow('bhkw', s.id, bhkwToEv * frac);
      if ((netzbezugMwh || 0) > 0.5) addFlow('netz', s.id, netzbezugMwh * frac);
    });
  }
  if (pvToEinsp   > 0.5) addFlow('pv',   'einspeisung', pvToEinsp);
  if (bhkwToEinsp > 0.5) addFlow('bhkw', 'einspeisung', bhkwToEinsp);

  const srcX = ML, snkX = W - MR - nodeW, cx = (srcX + nodeW + snkX) / 2;
  const fmt  = v => v >= 1000 ? (v / 1000).toFixed(1) + ' GWh' : Math.round(v) + ' MWh';

  // SVG-Attribute setzen
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // Inhalt aufbauen
  let out = '';

  // Flüsse (Bänder)
  links.forEach(lk => {
    const s = srcMap[lk.srcId], t = snkMap[lk.snkId];
    const lh = Math.max(1, lk.val * hPer);
    const sy0 = s.y + s.yOff, sy1 = sy0 + lh; s.yOff += lh;
    const ty0 = t.y + t.yOff, ty1 = ty0 + lh; t.yOff += lh;
    out += `<path d="M${srcX+nodeW},${sy0} C${cx},${sy0} ${cx},${ty0} ${snkX},${ty0}
                    L${snkX},${ty1} C${cx},${ty1} ${cx},${sy1} ${srcX+nodeW},${sy1} Z"
              fill="${lk.color}" opacity="0.30"/>`;
  });

  // Knoten-Rechtecke + Beschriftungen
  src.forEach(n => {
    out += `<rect x="${srcX}" y="${n.y}" width="${nodeW}" height="${n.h}" fill="${n.color}" rx="2" opacity="0.9"/>`;
    out += `<text x="${srcX-6}" y="${n.y + n.h/2 - 5}" text-anchor="end" font-size="10" fill="#ddd" font-family="DM Sans,sans-serif">${n.label}</text>`;
    out += `<text x="${srcX-6}" y="${n.y + n.h/2 + 7}" text-anchor="end" font-size="9"  fill="#888" font-family="DM Mono,monospace">${fmt(n.val)}</text>`;
  });
  snk.forEach(n => {
    out += `<rect x="${snkX}" y="${n.y}" width="${nodeW}" height="${n.h}" fill="${n.color}" rx="2" opacity="0.9"/>`;
    out += `<text x="${snkX+nodeW+6}" y="${n.y + n.h/2 - 5}" text-anchor="start" font-size="10" fill="#ddd" font-family="DM Sans,sans-serif">${n.label}</text>`;
    out += `<text x="${snkX+nodeW+6}" y="${n.y + n.h/2 + 7}" text-anchor="start" font-size="9"  fill="#888" font-family="DM Mono,monospace">${fmt(n.val)}</text>`;
  });

  svg.innerHTML = out;
}

// ── Jahreslastgang: gestapelte Verbraucher + Erzeuger ────────────────────────
function _stromRenderLastgang() {
  const canvas = document.getElementById('strom-lastgang-canvas');
  if (!canvas) return;
  const d = window._sankeyData;
  if (!d) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';

  const DAYS   = 365;
  const wpH    = window._wpElHourly;
  const skH    = window._skElHourly;
  const qH     = window.elQuartierH;
  const pvH    = window._stromPvH;
  const bhkwH  = window._bhkwElHourly;

  // Tages-Arrays aufbauen (kWh/Tag)
  const wpD  = new Float32Array(DAYS);
  const skD  = new Float32Array(DAYS);
  const qD   = new Float32Array(DAYS);
  const pvD  = new Float32Array(DAYS);
  const bhD  = new Float32Array(DAYS);

  const wpF   = d.wpMwh   * 1000 / 8760;
  const skF   = (d.skMwh  || 0) * 1000 / 8760;
  const qF    = d.quartierMwh * 1000 / 8760;
  const bhF   = (d.bhkwStromMwh || 0) * 1000 / 8760;

  for (let t = 0; t < 8760; t++) {
    const day = Math.min(DAYS - 1, Math.floor(t / 24));
    wpD[day] += wpH   ? wpH[t]   : wpF;
    skD[day] += skH   ? skH[t]   : skF;
    qD[day]  += qH    ? qH[t]    : qF;
    pvD[day] += pvH   ? pvH[t]   : 0;
    bhD[day] += bhkwH ? bhkwH[t] : bhF;
  }

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 460;
  const H   = 210;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD  = { l: 42, r: 8, t: 20, b: 18 };
  const iW   = W - PAD.l - PAD.r;
  const iH   = H - PAD.t - PAD.b;

  // Skalierung: gemeinsame Achse für Verbraucher und Erzeuger
  let maxVal = 1;
  for (let i = 0; i < DAYS; i++) {
    maxVal = Math.max(maxVal, wpD[i] + skD[i] + qD[i], pvD[i] + bhD[i]);
  }
  maxVal *= 1.05;

  const xAt = i => PAD.l + (i / (DAYS - 1)) * iW;
  const yAt = v => PAD.t + iH - (v / maxVal) * iH;

  // Hilfsfunktion: gefüllte gestapelte Fläche zwischen base[] und top[]
  const fillArea = (baseArr, topArr, color) => {
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(baseArr[0]));
    for (let i = 1; i < DAYS; i++) ctx.lineTo(xAt(i), yAt(baseArr[i]));
    // Rückweg oben → unten entlang top
    for (let i = DAYS - 1; i >= 0; i--) ctx.lineTo(xAt(i), yAt(topArr[i]));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Puffer für gestapelte Summen
  const zero  = new Float32Array(DAYS); // bleibt 0
  const s1    = new Float32Array(DAYS); // Quartier-Oberkante
  const s2    = new Float32Array(DAYS); // + SK
  const s3    = new Float32Array(DAYS); // + WP
  const g1    = new Float32Array(DAYS); // BHKW-Oberkante
  const g2    = new Float32Array(DAYS); // + PV
  for (let i = 0; i < DAYS; i++) {
    s1[i] = qD[i];
    s2[i] = s1[i] + skD[i];
    s3[i] = s2[i] + wpD[i];
    g1[i] = bhD[i];
    g2[i] = g1[i] + pvD[i];
  }

  // Gitternetz
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = PAD.t + iH * (1 - f);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    const v = maxVal * f;
    ctx.fillStyle = 'rgba(180,180,200,0.5)';
    ctx.font = '8px DM Mono,monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), PAD.l - 3, y + 3);
  });
  ctx.fillStyle = 'rgba(180,180,200,0.4)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('kWh/d', PAD.l - 3, PAD.t - 6);

  // ── Verbraucher-Stack (unten nach oben: Quartier → SK → WP) ──
  fillArea(zero, s1, 'rgba(120,144,156,0.80)');   // Licht & Kraft (grau)
  if (d.skMwh > 0.5) fillArea(s1, s2, 'rgba(171,71,188,0.80)');  // Stromkessel (lila)
  fillArea(s2, s3, 'rgba(66,165,245,0.80)');       // WP (blau)

  // ── Erzeuger-Stack (unten nach oben: BHKW → PV), transparenter ──
  if (d.bhkwStromMwh > 0.5) fillArea(zero, g1, 'rgba(255,143,0,0.40)');  // BHKW (orange)
  if (pvH || d.pvMwh > 0.5) fillArea(g1,   g2, 'rgba(198,224,58,0.40)'); // PV (gelbgrün)

  // Erzeuger-Oberkante als Linie
  if (d.pvMwh > 0.5 || d.bhkwStromMwh > 0.5) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(220,240,80,0.75)';
    ctx.lineWidth   = 1.2;
    for (let i = 0; i < DAYS; i++) {
      const y = yAt(g2[i]);
      if (i === 0) ctx.moveTo(xAt(i), y); else ctx.lineTo(xAt(i), y);
    }
    ctx.stroke();
  }

  // ── Monatsmarkierungen ──
  const MONTH_START = [0,31,59,90,120,151,181,212,243,273,304,334];
  const MONTH_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth   = 1;
  MONTH_START.forEach((md, mi) => {
    const x = xAt(md);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + iH); ctx.stroke();
    ctx.fillStyle   = 'rgba(160,165,190,0.7)';
    ctx.font        = '8px sans-serif';
    ctx.textAlign   = 'center';
    const nextMd    = MONTH_START[mi + 1] || DAYS;
    ctx.fillText(MONTH_NAMES[mi], xAt((md + nextMd) / 2), PAD.t + iH + 12);
  });
}

function _stromRenderJdl() {
  const canvas = document.getElementById('strom-jdl-canvas');
  const info   = document.getElementById('strom-jdl-info');
  if (!canvas) return;

  // Stündliche Nettobilanz berechnen (Netzbezug positiv, Einspeisung negativ)
  const pvH     = window._stromPvH;
  const wpH     = window._wpElHourly;
  const skH     = window._skElHourly;
  const bhkwH   = window._bhkwElHourly;
  const qH      = window.elQuartierH;
  const batSocH = window._stromBatSocH;
  const en      = window._dispatchEnergy || {};
  const WP_KEYS = ['lwwp','fg','geo'];
  const wpMwh   = WP_KEYS.reduce((s,k) => s + ((en[k]||{}).elMwh||0), 0);
  const skMwh   = (en['stromkessel']||{}).elMwh || 0;
  const bhkwMwh = (en['bhkw']||{}).elMwh || 0;
  const qMwh    = qH ? null : (parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0);

  const netto = new Float32Array(8760);
  for (let t = 0; t < 8760; t++) {
    const demand = (wpH ? wpH[t] : wpMwh*1000/8760)
                 + (skH ? skH[t] : skMwh*1000/8760)
                 + (qH  ? qH[t]  : (qMwh||0)*1000/8760);
    const gen    = (pvH ? pvH[t] : 0) + (bhkwH ? bhkwH[t] : bhkwMwh*1000/8760);
    netto[t] = demand - gen; // positiv = Bezug, negativ = Einspeisung
  }

  // Sortieren: Bezug absteigend, Einspeisung absteigend (als positiv)
  const bezug     = Array.from(netto).filter(v => v > 0).sort((a,b) => b-a);
  const einsp     = Array.from(netto).filter(v => v < 0).map(v => -v).sort((a,b) => b-a);
  const spitze    = bezug[0] || 0;
  const vollstd   = bezug.filter(v => v > 0.01).length;
  const einsStd   = einsp.filter(v => v > 0.01).length;

  if (info) info.textContent = `Spitzenlast: ${spitze.toFixed(0)} kW · Volllaststunden Bezug: ${vollstd} h/a · Einspeisung: ${einsStd} h/a`;

  // Zeichnen
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 460;
  const H   = 130;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD  = { l:38, r:8, t:10, b:18 };
  const iW   = W - PAD.l - PAD.r;
  const iH   = H - PAD.t - PAD.b;
  const maxV = spitze * 1.05 || 1;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i=1; i<=4; i++) {
    const y = PAD.t + iH - iH*i/4;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px DM Mono,monospace'; ctx.textAlign = 'right';
    ctx.fillText((maxV*i/4).toFixed(0), PAD.l-3, y+3);
  }
  // X-Achse Beschriftung
  ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('0 h', PAD.l, H-3);
  ctx.fillText('4380 h', PAD.l + iW/2, H-3);
  ctx.fillText('8760 h', W-PAD.r, H-3);
  // Y-Label
  ctx.save(); ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '7px sans-serif';
  ctx.translate(8, PAD.t+iH/2); ctx.rotate(-Math.PI/2); ctx.textAlign='center';
  ctx.fillText('kW', 0, 0); ctx.restore();

  // Bezug-Kurve (rot)
  if (bezug.length > 0) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(239,154,154,0.5)';
    ctx.strokeStyle = '#ef9a9a'; ctx.lineWidth = 1.5;
    ctx.moveTo(PAD.l, PAD.t + iH);
    bezug.forEach((v, i) => {
      const x = PAD.l + (i / (bezug.length-1||1)) * iW;
      const y = PAD.t + iH - (v/maxV)*iH;
      if (i===0) ctx.lineTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(PAD.l + (bezug.length/(bezug.length||1))*iW, PAD.t+iH);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    bezug.forEach((v, i) => {
      const x = PAD.l + (i/(bezug.length-1||1))*iW;
      const y = PAD.t + iH - (v/maxV)*iH;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  // Einspeisung-Kurve (grün) — eigene Achse rechts, skaliert auf bezug-Achse
  if (einsp.length > 0 && einsp[0] > 0) {
    const maxE = einsp[0] * 1.05;
    ctx.strokeStyle = '#a5d6a7'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
    ctx.beginPath();
    einsp.forEach((v, i) => {
      const x = PAD.l + (i/(einsp.length-1||1))*iW;
      const y = PAD.t + iH - (v/maxV)*iH;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke(); ctx.setLineDash([]);
  }
}

// ── Stündlicher Energiefluss-Chart ────────────────────────────────────────
let _stromFlussWeek = 0;

function _stromFlussWeekChange(val) {
  _stromFlussWeek = val;
  const kw = val + 1;
  const startH = val * 168;
  const d = new Date(2024, 0, 1 + Math.floor(startH / 24));
  const mo = d.toLocaleString('de-DE', { month: 'short' });
  const day = d.getDate();
  const el = document.getElementById('strom-woche-label');
  if (el) el.textContent = `KW ${kw} · ${day}. ${mo}`;
  _stromRenderFlussChart(val);
}

function _stromRenderFlussChart(weekIdx) {
  const canvas = document.getElementById('strom-fluss-canvas');
  if (!canvas) return;

  // ── Datenquellen ──────────────────────────────────────────────────────────
  const pvH    = window._stromPvH;          // Float32Array[8760] kWh/h
  const wpH    = window._wpElHourly;        // Float32Array[8760] kWh/h
  const skH    = window._skElHourly;        // Float32Array[8760] kWh/h | null
  const bhkwH  = window._bhkwElHourly;      // Float32Array[8760] kWh/h | null
  const socH   = window._stromBatSocH;      // Float32Array[8760] kWh   | null
  const qH     = window.elQuartierH;        // Float32Array[8760] kWh/h | null
  const skMwhTotal = (window._dispatchEnergy?.stromkessel?.elMwh) || 0;
  const qPauschal  = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;

  const HOURS = 168; // 7 days
  const t0    = weekIdx * HOURS;

  // Helper: get value at absolute hour t
  function pvAt(t)   { return pvH   ? (pvH[t]   || 0) : 0; }
  function wpAt(t)   { return wpH   ? (wpH[t]   || 0) : 0; }
  function skAt(t)   { return skH   ? (skH[t]   || 0) : (skMwhTotal * 1000 / 8760); }
  function bhAt(t)   { return bhkwH ? (bhkwH[t] || 0) : 0; }
  function socAt(t)  { return socH  ? (socH[t]  || 0) : 0; }
  function qAt(t)    {
    if (qH) return qH[t] || 0;
    return qPauschal * 1000 / 8760;
  }

  // Build week arrays
  const PV   = new Float32Array(HOURS);
  const WP   = new Float32Array(HOURS);
  const SK   = new Float32Array(HOURS);
  const BH   = new Float32Array(HOURS);
  const Q    = new Float32Array(HOURS);
  const SOC  = socH ? new Float32Array(HOURS) : null;
  let maxGen = 0, maxDem = 0, maxSoc = 0;

  for (let h = 0; h < HOURS; h++) {
    const t = Math.min(t0 + h, 8759);
    PV[h]  = pvAt(t);
    WP[h]  = wpAt(t);
    SK[h]  = skAt(t);
    BH[h]  = bhAt(t);
    Q[h]   = qAt(t);
    const gen = PV[h] + BH[h];
    const dem = WP[h] + SK[h] + Q[h];
    if (gen > maxGen) maxGen = gen;
    if (dem > maxDem) maxDem = dem;
    if (SOC) { SOC[h] = socAt(t); if (SOC[h] > maxSoc) maxSoc = SOC[h]; }
  }

  // ── Canvas-Setup ──────────────────────────────────────────────────────────
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 600;
  const HMain = SOC ? 160 : 180;
  const HSoc  = SOC ? 40  : 0;
  const H     = HMain + HSoc + (SOC ? 6 : 0);

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, W, H);

  const PAD = { l: 40, r: 8, t: 8, b: 18 };
  const iW  = W - PAD.l - PAD.r;
  const iHMain = HMain - PAD.t - PAD.b;         // drawable height within HMain
  const zero   = PAD.t + iHMain / 2;            // 0-Linie im Hauptchart
  const halfH  = iHMain / 2;                    // half height for gen / dem
  const maxVal = Math.max(maxGen, maxDem, 0.01);

  function xOf(h)        { return PAD.l + (h / HOURS) * iW; }
  function yOfGen(v)     { return zero - (v / maxVal) * halfH; }
  function yOfDem(v)     { return zero + (v / maxVal) * halfH; }

  // ── Gitternetz ────────────────────────────────────────────────────────────
  // horizontale Linien
  [0, 0.5, 1].forEach(f => {
    ctx.strokeStyle = f === 0 ? '#3a4060' : '#222840';
    ctx.lineWidth   = f === 0 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, yOfGen(f * maxVal));
    ctx.lineTo(PAD.l + iW, yOfGen(f * maxVal));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PAD.l, yOfDem(f * maxVal));
    ctx.lineTo(PAD.l + iW, yOfDem(f * maxVal));
    ctx.stroke();
    // Labels
    ctx.fillStyle   = '#7a8099';
    ctx.font        = '8px sans-serif';
    ctx.textAlign   = 'right';
    if (f > 0) {
      ctx.fillText(Math.round(maxVal * f), PAD.l - 3, yOfGen(f * maxVal) + 3);
      ctx.fillText(Math.round(maxVal * f), PAD.l - 3, yOfDem(f * maxVal) + 3);
    }
  });

  // 0-Linie prominent
  ctx.strokeStyle = '#4a5580';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(PAD.l, zero); ctx.lineTo(PAD.l + iW, zero); ctx.stroke();

  // Y-Achse Label
  ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('kWh', PAD.l - 3, PAD.t + 6);
  ctx.fillText('Erzeugung', PAD.l - 3, PAD.t + 14);
  ctx.textAlign = 'right';
  ctx.fillText('Bedarf', PAD.l - 3, zero + halfH - 4);

  // ── Tageslinien + X-Labels ─────────────────────────────────────────────────
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const lineBottom = HMain - PAD.b;   // where chart area ends (before label area)
  const labelY     = HMain - 4;       // y-position of day labels (within canvas)
  for (let d = 0; d < 7; d++) {
    const x = xOf(d * 24);
    ctx.strokeStyle = '#2a3050';
    ctx.lineWidth   = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, lineBottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(DAYS[d], x + 2, labelY);
  }

  // ── Pixel-Buffer: iteriere alle Stunden, zeichne Flächenbereiche ──────────
  // Statt Polygon: Linie für jede Stunde (performance-freundlich)

  // Erzeugung oben: PV (gelb-grün) + BHKW (amber), gestapelt
  function drawStackedArea(dataA, dataB, colA, colB) {
    // dataA unten, dataB oben (gestapelt) — beide positiv, im "Erzeugung"-Bereich
    const pts0 = [], ptsA = [], ptsFull = [];
    for (let h = 0; h <= HOURS; h++) {
      const hi = Math.min(h, HOURS - 1);
      pts0.push([xOf(h), zero]);
      ptsA.push([xOf(h), yOfGen(dataA[hi])]);
      ptsFull.push([xOf(h), yOfGen(dataA[hi] + dataB[hi])]);
    }
    // Fläche A (PV)
    ctx.beginPath();
    ctx.moveTo(pts0[0][0], pts0[0][1]);
    ptsA.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts0[HOURS][0], pts0[HOURS][1]);
    ctx.closePath();
    ctx.fillStyle = colA;
    ctx.fill();
    // Fläche B (BHKW) oben auf A
    if (dataB.some(v => v > 0)) {
      ctx.beginPath();
      ptsA.forEach(p => ctx.lineTo(p[0], p[1]));
      for (let h = HOURS; h >= 0; h--) ctx.lineTo(ptsFull[h][0], ptsFull[h][1]);
      ctx.closePath();
      ctx.fillStyle = colB;
      ctx.fill();
    }
  }

  function drawDemandArea(dataA, dataB, colA, colB) {
    // gestapelt unterhalb 0: dataA (WP blau) unterste, dataB (Quartier dunkelgrau) darüber
    const ptsA   = [], ptsFull = [];
    for (let h = 0; h <= HOURS; h++) {
      const hi = Math.min(h, HOURS - 1);
      ptsA.push([xOf(h), yOfDem(dataA[hi])]);
      ptsFull.push([xOf(h), yOfDem(dataA[hi] + dataB[hi])]);
    }
    // Fläche gesamt (Quartier, dunkelgrau)
    ctx.beginPath();
    ctx.moveTo(xOf(0), zero);
    ptsFull.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(xOf(HOURS), zero);
    ctx.closePath();
    ctx.fillStyle = colB;
    ctx.fill();
    // Fläche WP (blau), unten
    ctx.beginPath();
    ctx.moveTo(xOf(0), zero);
    ptsA.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(xOf(HOURS), zero);
    ctx.closePath();
    ctx.fillStyle = colA;
    ctx.fill();
  }

  const WP_SK = new Float32Array(HOURS);
  for (let h = 0; h < HOURS; h++) WP_SK[h] = WP[h] + SK[h];
  drawStackedArea(PV, BH, 'rgba(139,195,74,0.55)', 'rgba(255,152,0,0.55)');
  drawDemandArea(WP_SK, Q, 'rgba(66,165,245,0.50)', 'rgba(96,125,139,0.40)');

  // ── Netzbezug / Einspeisung-Overlay ───────────────────────────────────────
  for (let h = 0; h < HOURS; h++) {
    const gen = PV[h] + BH[h];
    const dem = WP_SK[h] + Q[h];
    const x0  = xOf(h);
    const x1  = xOf(h + 1);
    if (dem > gen) {
      // Netzbezug: rot über Generierungsbereich bis 0
      const yTop  = yOfGen(gen);
      const yBot  = zero;
      ctx.fillStyle = 'rgba(239,83,80,0.30)';
      ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
    } else if (gen > dem) {
      // Einspeisung: grün über nicht verbrauchten Teil
      const yTop  = yOfGen(gen);
      const yMid  = yOfGen(dem);
      ctx.fillStyle = 'rgba(102,187,106,0.35)';
      ctx.fillRect(x0, yTop, x1 - x0, yMid - yTop);
    }
  }

  // ── Batterie-SOC-Strip ────────────────────────────────────────────────────
  if (SOC && maxSoc > 0) {
    const sy  = HMain + 4;
    const sH  = HSoc - 6;
    ctx.fillStyle = '#1a2035';
    ctx.fillRect(PAD.l, sy, iW, sH);

    ctx.beginPath();
    ctx.moveTo(xOf(0), sy + sH);
    for (let h = 0; h <= HOURS; h++) {
      const hi  = Math.min(h, HOURS - 1);
      const y   = sy + sH - (SOC[hi] / maxSoc) * sH;
      if (h === 0) ctx.moveTo(xOf(h), y);
      else ctx.lineTo(xOf(h), y);
    }
    ctx.lineTo(xOf(HOURS), sy + sH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,213,79,0.25)';
    ctx.fill();
    ctx.beginPath();
    for (let h = 0; h <= HOURS; h++) {
      const hi = Math.min(h, HOURS - 1);
      const y  = sy + sH - (SOC[hi] / maxSoc) * sH;
      if (h === 0) ctx.moveTo(xOf(h), y); else ctx.lineTo(xOf(h), y);
    }
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    ctx.fillStyle   = '#7a8099'; ctx.font = '7px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Speicher-SOC', PAD.l + 2, sy + 8);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(maxSoc)} kWh`, PAD.l + iW - 2, sy + 8);
  }

  // ── Hover-Tooltip ─────────────────────────────────────────────────────────
  canvas._flussData = { PV, WP, SK, BH, Q, SOC, t0, maxVal, W, PAD, iW };

  if (!canvas._flussMouseBound) {
    canvas._flussMouseBound = true;
    canvas.addEventListener('mousemove', function(e) {
      const rect = canvas.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const d    = canvas._flussData;
      if (!d) return;
      const h    = Math.round(((mx - d.PAD.l) / d.iW) * HOURS);
      if (h < 0 || h >= HOURS) { document.getElementById('strom-fluss-tooltip').style.display = 'none'; return; }
      const tt = document.getElementById('strom-fluss-tooltip');
      if (!tt) return;
      const gen = d.PV[h] + d.BH[h];
      const dem = d.WP[h] + (d.SK ? d.SK[h] : 0) + d.Q[h];
      const net = dem - gen;
      const absH = d.t0 + h;
      const dayN = Math.floor(h / 24);
      const hourN = h % 24;
      const dayLabel = DAYS[dayN] + ' ' + hourN + ':00';
      let html = `<b style="color:#cdd">${dayLabel}</b><br>`;
      html += `<span style="color:#8bc34a">PV ${d.PV[h].toFixed(1)} kWh</span>`;
      if (d.BH[h] > 0) html += `<br><span style="color:#ff9800">BHKW ${d.BH[h].toFixed(1)} kWh</span>`;
      html += `<br><span style="color:#42a5f5">WP ${d.WP[h].toFixed(1)} kWh</span>`;
      if (d.SK && d.SK[h] > 0) html += `<br><span style="color:#90caf9">Stromkessel ${d.SK[h].toFixed(1)} kWh</span>`;
      html += `<br><span style="color:#78909c">Quartier ${d.Q[h].toFixed(1)} kWh</span>`;
      if (net > 0) html += `<br><span style="color:#ef5350">⬇ Bezug ${net.toFixed(1)} kWh</span>`;
      else if (net < 0) html += `<br><span style="color:#66bb6a">⬆ Einspeisung ${(-net).toFixed(1)} kWh</span>`;
      if (d.SOC) html += `<br><span style="color:#ffd54f">SOC ${d.SOC[h].toFixed(1)} kWh</span>`;
      tt.innerHTML = html;
      tt.style.display = 'block';
      const tx = Math.min(mx + 10, d.W - 130);
      tt.style.left = tx + 'px';
      tt.style.top  = '6px';
    });
    canvas.addEventListener('mouseleave', function() {
      const tt = document.getElementById('strom-fluss-tooltip');
      if (tt) tt.style.display = 'none';
    });
  }
}

// ── PV + Speicher Optimierung ─────────────────────────────────────────────
function calcPvBatOptimierung() {
  const div = document.getElementById('opt-result');
  if (div) div.innerHTML = '<div style="font-size:10px;color:var(--muted);text-align:center;padding:10px;">Berechne…</div>';
  setTimeout(() => _runPvBatOpt(div), 20);
}

function _runPvBatOpt(resultDiv) {
  // ── Nachfrage aufbauen ───────────────────────────────────────────────────
  const en = window._dispatchEnergy || {};
  const WP_KEYS = ['lwwp', 'fg', 'geo'];
  const wpMwh = WP_KEYS.reduce((s, k) => s + ((en[k] || {}).elMwh || 0), 0);
  let quartierMwh = 0;
  if (window.elQuartierH) {
    for (let i = 0; i < 8760; i++) quartierMwh += window.elQuartierH[i];
    quartierMwh /= 1000;
  } else {
    quartierMwh = parseFloat(document.getElementById('strom-quartier-mwh')?.value) || 0;
  }
  const gesamtMwh = wpMwh + quartierMwh;
  if (gesamtMwh < 0.1) {
    if (resultDiv) resultDiv.innerHTML =
      '<div style="font-size:10px;color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;">Kein Strombedarf definiert — Lastgang hochladen oder Jahressumme eingeben.</div>';
    return;
  }

  // Stündlicher Lastgang (kWh/h): WP + Quartier summiert
  const demand = new Float32Array(8760);
  for (let t = 0; t < 8760; t++) {
    demand[t] = (window._wpElHourly  ? window._wpElHourly[t]  : 0)
              + (window.elQuartierH  ? window.elQuartierH[t]  : quartierMwh * 1000 / 8760);
  }

  // ── Parameter ────────────────────────────────────────────────────────────
  const pvProfile = makePvProfile8760(); // normiert, Summe=1.0
  const spez      = parseFloat(document.getElementById('pv-spez')?.value) || 1000;
  const preisB    = (parseFloat(document.getElementById('strom-preis-bezug')?.value) || 30) / 100; // €/kWh
  const preisE    = (parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8)  / 100;
  const pvInvest  = parseFloat(document.getElementById('opt-pv-invest')?.value)  || 1200; // €/kWp
  const batInvest = parseFloat(document.getElementById('opt-bat-invest')?.value) || 400;  // €/kWh
  const omPct     = (parseFloat(document.getElementById('opt-om')?.value) || 1) / 100;
  const zinssatz  = (parseFloat(document.getElementById('opt-zinssatz')?.value) || 4) / 100;
  const pvLife    = parseFloat(document.getElementById('opt-pv-life')?.value)  || 20;
  const batLife   = parseFloat(document.getElementById('opt-bat-life')?.value) || 15;

  // Annuitätenfaktoren
  const annF = (z, n) => z > 0 ? z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) : 1/n;
  const pvAnnKwp  = pvInvest  * (annF(zinssatz, pvLife)  + omPct); // €/kWp·a Jahreskosten
  const batAnnKwh = batInvest * (annF(zinssatz, batLife) + omPct); // €/kWh·a Jahreskosten
  const ETA_BAT   = 0.90; // Entlade-Wirkungsgrad (Round-trip)

  // ── Stundensimulation ────────────────────────────────────────────────────
  function simulate(kwp, batKwh) {
    const annKwh = kwp * spez;
    let sv = 0, ins = 0, bez = 0, soc = 0;
    for (let t = 0; t < 8760; t++) {
      const gen = pvProfile[t] * annKwh;
      const dem = demand[t];
      // 1. Direkter Eigenverbrauch
      const dsc  = Math.min(gen, dem);
      let rDem   = dem - dsc;
      let rGen   = gen - dsc;
      // 2. Speicher laden mit Überschuss-PV
      if (batKwh > 0 && rGen > 0) {
        const c = Math.min(rGen, batKwh - soc);
        soc += c; rGen -= c;
      }
      // 3. Speicher entladen bei Restbedarf (Entladewirkungsgrad 90%)
      if (batKwh > 0 && rDem > 0) {
        const avail = Math.min(soc * ETA_BAT, rDem);
        soc -= avail / ETA_BAT; rDem -= avail;
      }
      sv  += dsc + (dem - dsc - rDem); // Eigenverbrauch (direkt + Speicher)
      ins += rGen;
      bez += rDem;
    }
    const saving     = sv * preisB + ins * preisE;                      // €/a Ersparnis
    const annualCost = kwp * pvAnnKwp + batKwh * batAnnKwh;             // €/a Kosten
    const invest     = kwp * pvInvest + batKwh * batInvest;             // € Investition
    const omYear     = invest * omPct;
    const payback    = (saving - omYear) > 0 ? invest / (saving - omYear) : Infinity;
    const autarkie   = gesamtMwh > 0 ? (1 - bez / 1000 / gesamtMwh) * 100 : 0;
    const netBenefit = saving - annualCost;
    const rendite    = invest > 0 ? (netBenefit / invest * 100) : 0; // % p.a.
    return { netBenefit, saving, annualCost, invest, payback, autarkie, rendite,
             eigenverbrauchMwh: sv/1000, einspeisungMwh: ins/1000, netzbezugMwh: bez/1000,
             kwp, batKwh };
  }

  // Bewertungsfunktion je nach gewähltem Kriterium
  const bewertung = document.getElementById('opt-bewertung')?.value || 'nettogewinn';
  function score(r) {
    if (bewertung === 'rendite')      return r.rendite;                                   // höher = besser
    if (bewertung === 'amortisation') return isFinite(r.payback) && r.payback > 0 ? -r.payback : -Infinity; // niedriger = besser → negiert
    return r.netBenefit;                                                                  // höher = besser
  }

  // ── Grobsuche kWp (ohne Speicher) ────────────────────────────────────────
  const maxKwp = Math.min(10000, Math.max(50, gesamtMwh * 2000 / spez));
  const N_KWP  = 60, N_BAT = 40;

  // Gitter speichern für Heatmap: grid[i][j] = score-Wert (i=kWp-Schritt, j=Bat-Schritt)
  // j=0 bedeutet kein Speicher (PV-only-Linie)
  const grid = [];

  let bestPvOnly = null, bestPvScore = -Infinity;
  const results = []; // results[i][j] = volles Simulations-Objekt
  for (let i = 1; i <= N_KWP; i++) {
    const r = simulate(i / N_KWP * maxKwp, 0);
    const sc = score(r);
    grid[i]    = [sc];
    results[i] = [r];
    if (sc > bestPvScore) { bestPvScore = sc; bestPvOnly = r; }
  }
  if (!bestPvOnly) bestPvOnly = { netBenefit: -Infinity, kwp: 0, batKwh: 0, rendite: 0, payback: Infinity, invest: 0 };
  // Verfeinerung PV-only
  { const lo = Math.max(0, bestPvOnly.kwp - maxKwp/N_KWP*2), hi = bestPvOnly.kwp + maxKwp/N_KWP*2;
    for (let i = 0; i <= 30; i++) {
      const r = simulate(lo + i/30*(hi-lo), 0);
      if (score(r) > bestPvScore) { bestPvScore = score(r); bestPvOnly = r; }
    }
  }

  // ── Gemeinsame Optimierung PV + Speicher ──────────────────────────────────
  const maxBat = Math.min(5000, Math.max(50, bestPvOnly.kwp * 2.5));
  let bestJoint = null, bestJointScore = -Infinity;
  for (let i = 1; i <= N_KWP; i++) {
    for (let j = 1; j <= N_BAT; j++) {
      const r = simulate(i/N_KWP * maxKwp, j/N_BAT * maxBat);
      const sc = score(r);
      grid[i][j]    = sc;
      results[i][j] = r;
      if (sc > bestJointScore) { bestJointScore = sc; bestJoint = r; }
    }
  }
  if (!bestJoint) bestJoint = { netBenefit: -Infinity, kwp: 0, batKwh: 0, rendite: 0, payback: Infinity, invest: 0 };
  // Verfeinerung gemeinsam
  { const lo1 = Math.max(0, bestJoint.kwp - maxKwp/N_KWP*2),   hi1 = bestJoint.kwp + maxKwp/N_KWP*2;
    const lo2 = Math.max(0, bestJoint.batKwh - maxBat/N_BAT*2), hi2 = bestJoint.batKwh + maxBat/N_BAT*2;
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const r = simulate(lo1 + i/20*(hi1-lo1), lo2 + j/20*(hi2-lo2));
        if (score(r) > bestJointScore) { bestJointScore = score(r); bestJoint = r; }
      }
    }
  }

  // ── Ergebnis-Darstellung ─────────────────────────────────────────────────
  const fmt  = v => Math.round(v).toLocaleString('de-DE');
  const fmtP = v => isFinite(v) ? v.toFixed(1).replace('.', ',') : '—';

  // Gültigkeitsprüfung je nach Bewertungsmodus
  const isViable = r => {
    if (bewertung === 'rendite')      return r && r.rendite > 0;
    if (bewertung === 'amortisation') return r && isFinite(r.payback) && r.payback > 0;
    return r && r.netBenefit > 0;
  };
  const r1 = isViable(bestPvOnly) ? bestPvOnly : null;
  const r2 = isViable(bestJoint)  ? bestJoint  : null;

  if (!r1 && !r2) {
    resultDiv.innerHTML = `<div style="font-size:10px;color:#ef9a9a;padding:8px;background:var(--surface2);border-radius:5px;text-align:center;">
      Bei den aktuellen Kosten und Preisen ist PV/Speicher nicht wirtschaftlich rentabel.</div>`;
    return;
  }

  const BEWERTUNG_LABEL = { nettogewinn: 'Nettogewinn', rendite: 'Rendite', amortisation: 'Amortisation' };
  const card = (label, r, accent) => {
    if (!r) return '';
    const addBat = r.batKwh > 0.5;
    const nbColor = r.netBenefit > 0 ? '#66bb6a' : '#ef9a9a';
    const rdColor = r.rendite > 0 ? '#4fc3f7' : '#ef9a9a';
    const amColor = isFinite(r.payback) && r.payback > 0 && r.payback < 30 ? '#ffd54f' : '#ef9a9a';
    // Aktives Kriterium hervorheben
    const nbBold = bewertung === 'nettogewinn';
    const rdBold = bewertung === 'rendite';
    const amBold = bewertung === 'amortisation';
    const rows = [
      ['PV-Anlage',      fmt(r.kwp) + ' kWp'],
      addBat ? ['Batteriespeicher', fmt(r.batKwh) + ' kWh'] : null,
      ['Investition',    fmt(r.invest) + ' €'],
      ['Jahreskosten',   fmt(r.annualCost) + ' €/a'],
      ['Ersparnis/Erlös',fmt(r.saving) + ' €/a', '#a5d6a7'],
      [nbBold ? '★ Nettogewinn' : 'Nettogewinn', fmt(r.netBenefit) + ' €/a', nbColor, nbBold],
      [rdBold ? '★ Rendite' : 'Rendite', r.rendite.toFixed(1) + ' %/a', rdColor, rdBold],
      [amBold ? '★ Amortisation' : 'Amortisation', fmtP(r.payback) + ' a', amColor, amBold],
      ['Strom-Autarkie', r.autarkie.toFixed(0) + ' %'],
      ['Eigenverbrauch', fmt(r.eigenverbrauchMwh) + ' MWh/a'],
      ['Einspeisung',    fmt(r.einspeisungMwh) + ' MWh/a'],
    ].filter(Boolean);
    return `<div style="background:var(--surface2);border-radius:6px;padding:8px 10px;flex:1;min-width:170px;">
      <div style="font-size:9px;font-weight:700;color:${accent};margin-bottom:7px;letter-spacing:.04em;">${label}</div>
      ${rows.map(([l,v,c,bold]) => `
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;${bold?'background:rgba(255,255,255,0.04);margin:0 -4px;padding:2px 4px;border-radius:3px;':''}">
          <span style="font-size:9px;color:${bold?'var(--text)':'var(--muted)'};">${l}</span>
          <span style="font-family:'DM Mono',monospace;font-size:10px;${c?'color:'+c+';':''}${bold||c?'font-weight:600;':''}white-space:nowrap;">${v}</span>
        </div>`).join('')}
    </div>`;
  };

  // Zusatzgewinn durch Speicher
  let addLine = '';
  if (r1 && r2) {
    if (bewertung === 'nettogewinn' && r2.netBenefit > r1.netBenefit) {
      addLine = `<div style="font-size:9px;color:#a5d6a7;text-align:center;margin-top:5px;">
        Speicher bringt +${fmt(r2.netBenefit - r1.netBenefit)} €/a zusätzlichen Nettogewinn</div>`;
    } else if (bewertung === 'rendite' && r2.rendite > r1.rendite) {
      addLine = `<div style="font-size:9px;color:#4fc3f7;text-align:center;margin-top:5px;">
        Speicher verbessert Rendite auf ${r2.rendite.toFixed(1)} %/a (statt ${r1.rendite.toFixed(1)} %/a)</div>`;
    } else if (bewertung === 'amortisation' && r2.payback < r1.payback) {
      addLine = `<div style="font-size:9px;color:#ffd54f;text-align:center;margin-top:5px;">
        Speicher verkürzt Amortisation auf ${fmtP(r2.payback)} a (statt ${fmtP(r1.payback)} a)</div>`;
    }
  }

  const hmLabel = { nettogewinn: 'Nettogewinn €/a', rendite: 'Rendite %/a', amortisation: 'Amortisation (neg. Jahre)' }[bewertung];

  resultDiv.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${card('Optimal: Nur PV', r1, '#ffd54f')}
      ${card('Optimal: PV + Speicher', r2, '#66bb6a')}
    </div>${addLine}
    <div style="margin-top:10px;">
      <div style="display:flex;align-items:center;margin-bottom:4px;">
        <span style="font-size:9px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;flex:1;">
          Optimierungslandschaft — ${hmLabel}
        </span>
        <span style="display:flex;gap:0;border:1px solid var(--border);border-radius:4px;overflow:hidden;">
          <button id="opt-view-2d" onclick="_setOptView('2d')"
            style="padding:2px 8px;border:none;font-size:9px;font-family:inherit;cursor:pointer;
                   background:${window._optView==='3d'?'transparent':'var(--accent)'};
                   color:${window._optView==='3d'?'var(--muted)':'#000'};">2D</button>
          <button id="opt-view-3d" onclick="_setOptView('3d')"
            style="padding:2px 8px;border:none;font-size:9px;font-family:inherit;cursor:pointer;
                   background:${window._optView==='3d'?'var(--accent)':'transparent'};
                   color:${window._optView==='3d'?'#000':'var(--muted)'};">3D</button>
        </span>
      </div>
      <div style="position:relative;">
        <canvas id="opt-heatmap" style="width:100%;display:block;border-radius:4px;cursor:crosshair;"></canvas>
        <div id="opt-tooltip" style="display:none;position:absolute;pointer-events:none;
          background:rgba(12,16,36,0.96);border:1px solid rgba(255,255,255,0.12);
          border-radius:6px;padding:7px 10px;font-size:9px;font-family:'DM Mono',monospace;
          min-width:170px;z-index:10;line-height:1.7;"></div>
      </div>
      <div id="opt-xaxis-label" style="display:flex;justify-content:space-between;margin-top:3px;font-size:8px;color:var(--muted);">
        <span>0 kWp</span><span style="text-align:center;flex:1;">← PV-Leistung →</span><span>${Math.round(maxKwp)} kWp</span>
      </div>
    </div>`;

  // Daten global speichern (für View-Toggle + Hover-Tooltip)
  window._optData = { grid, results, NX: N_KWP, NY: N_BAT, maxKwp, maxBat, bestPvOnly, bestJoint };
  window._optView = window._optView || '2d';

  // Heatmap rendern + Hover-Listener (nach DOM-Update)
  requestAnimationFrame(() => {
    if (window._optView === '3d') _renderOpt3D();
    else _renderOptHeatmap(grid, N_KWP, N_BAT, maxKwp, maxBat, bestPvOnly, bestJoint);
    _attachOptHover();
  });
}

// ── Heatmap-Renderer ──────────────────────────────────────────────────────
function _renderOptHeatmap(grid, NX, NY, maxKwp, maxBat, bestPvOnly, bestJoint) {
  const canvas = document.getElementById('opt-heatmap');
  if (!canvas) return;
  const W   = canvas.clientWidth || canvas.parentElement?.clientWidth || 420;
  const H   = Math.round(W * 0.45);
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { l: 42, r: 12, t: 8, b: 8 };
  const iW  = W - PAD.l - PAD.r;
  const iH  = H - PAD.t - PAD.b;

  ctx.clearRect(0, 0, W, H);

  // Wertebereich
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 1; i <= NX; i++)
    for (let j = 0; j <= NY; j++)
      if (grid[i]?.[j] !== undefined) {
        if (grid[i][j] < vMin) vMin = grid[i][j];
        if (grid[i][j] > vMax) vMax = grid[i][j];
      }
  if (!isFinite(vMin)) return;

  // Farbfunktion: negativ → dunkelrot, 0 → dunkelgrau, positiv → gelb→grün
  function valToColor(v) {
    if (v <= 0) {
      const t = Math.max(0, Math.min(1, v / Math.min(vMin, -1)));
      return lerpColor('#1a0000', '#2a2a3a', t); // dunkelrot → neutral
    }
    const t = Math.max(0, Math.min(1, v / Math.max(vMax, 1)));
    if (t < 0.5) return lerpColor('#2a2a3a', '#ffd54f', t * 2);
    return lerpColor('#ffd54f', '#00c853', (t - 0.5) * 2);
  }

  // Zellen zeichnen
  const cellW = iW / NX;
  const cellH = iH / NY;
  for (let i = 1; i <= NX; i++) {
    for (let j = 0; j <= NY; j++) {
      const v = grid[i]?.[j] ?? 0;
      ctx.fillStyle = valToColor(v);
      const x = PAD.l + (i - 1) * cellW;
      const y = PAD.t + (NY - j) * cellH; // j=0 unten, j=NY oben
      ctx.fillRect(x, y, Math.ceil(cellW) + 0.5, Math.ceil(cellH) + 0.5);
    }
  }

  // Null-Konturlinie (Wirtschaftlichkeitsschwelle)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  let firstZero = true;
  for (let i = 1; i <= NX; i++) {
    // Interpoliere j-Position wo v≈0
    for (let j = 0; j < NY; j++) {
      const v0 = grid[i]?.[j] ?? -1, v1 = grid[i]?.[j+1] ?? -1;
      if (v0 !== undefined && v1 !== undefined && ((v0 <= 0 && v1 >= 0) || (v0 >= 0 && v1 <= 0))) {
        const frac = v0 / (v0 - v1);
        const x = PAD.l + (i - 0.5) * cellW;
        const y = PAD.t + (NY - (j + frac)) * cellH;
        if (firstZero) { ctx.moveTo(x, y); firstZero = false; } else ctx.lineTo(x, y);
        break;
      }
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // PV-only Optimum (Dreieck auf unterer Achse)
  if (bestPvOnly.netBenefit > -Infinity) {
    const xi = bestPvOnly.kwp / maxKwp * NX;
    const x  = PAD.l + xi * cellW;
    const y  = PAD.t + NY * cellH;
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x - 4, y + 1); ctx.lineTo(x + 4, y + 1); ctx.closePath(); ctx.fill();
  }

  // Gemeinsames Optimum (Kreuz)
  if (bestJoint.netBenefit > -Infinity) {
    const xi = bestJoint.kwp    / maxKwp * NX;
    const yj = bestJoint.batKwh / maxBat * NY;
    const x  = PAD.l + xi * cellW;
    const y  = PAD.t + (NY - yj) * cellH;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    const s = 5;
    ctx.beginPath(); ctx.moveTo(x-s, y); ctx.lineTo(x+s, y); ctx.moveTo(x, y-s); ctx.lineTo(x, y+s); ctx.stroke();
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x - s - 1, y - s - 1, (s+1)*2, (s+1)*2);
  }

  // Y-Achse (Batteriegröße)
  ctx.fillStyle    = '#7a8099';
  ctx.font         = '8px sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  [0, 0.5, 1].forEach(f => {
    const y = PAD.t + (1 - f) * NY * cellH;
    ctx.fillText(Math.round(f * maxBat), PAD.l - 3, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + iW, y); ctx.stroke();
  });

  // Y-Achsen-Titel (rotiert)
  ctx.save();
  ctx.translate(8, PAD.t + iH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a8099'; ctx.font = '8px sans-serif';
  ctx.fillText('Speicher kWh', 0, 0);
  ctx.restore();

  // Legende (Farbskala rechts)
  const lx = PAD.l + iW + 3, lw = 6;
  for (let p = 0; p < iH; p++) {
    const t = 1 - p / iH;
    const v = vMin + t * (vMax - vMin);
    ctx.fillStyle = valToColor(v);
    ctx.fillRect(lx, PAD.t + p, lw, 1.5);
  }
  ctx.fillStyle = '#7a8099'; ctx.font = '7px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(vMax/1000)+'k', lx + lw + 1, PAD.t + 4);
  ctx.fillText('0', lx + lw + 1, PAD.t + iH * (vMax / (vMax - vMin)));
  ctx.fillText(Math.round(vMin/1000)+'k', lx + lw + 1, PAD.t + iH - 4);
}

// ── Hover-Tooltip für Optimierungslandschaft ─────────────────────────────
function _attachOptHover() {
  const canvas  = document.getElementById('opt-heatmap');
  const tooltip = document.getElementById('opt-tooltip');
  if (!canvas || !tooltip) return;

  // Alten Listener entfernen (bei Re-Render)
  canvas.onmousemove = null;
  canvas.onmouseleave = null;

  canvas.onmouseleave = () => { tooltip.style.display = 'none'; };

  canvas.onmousemove = (e) => {
    const d = window._optData;
    if (!d) return;
    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const cssW  = rect.width;
    const cssH  = rect.height;

    let r = null;

    if (window._optView === '3d') {
      // 3D: nächsten projizierten Gitterpunkt suchen (mit aktueller Rotation via _opt3dProj)
      const { grid, NX, NY } = d;
      const proj = window._opt3dProj;
      const vMax = window._opt3dVMax || 1;
      const vMin = window._opt3dVMin || 0;
      const vRange = Math.max(vMax - vMin, 1);

      if (!proj) { tooltip.style.display = 'none'; return; }

      let bestDist = Infinity, bestI = -1, bestJ = -1;
      for (let i = 1; i <= NX; i++) {
        for (let j = 0; j <= NY; j++) {
          if (grid[i]?.[j] === undefined) continue;
          const ny = Math.max(0, grid[i][j] - vMin) / vRange;
          const p  = proj(i / NX, ny, j / NY);
          const dist = (p.sx - mx)**2 + (p.sy - my)**2;
          if (dist < bestDist) { bestDist = dist; bestI = i; bestJ = j; }
        }
      }
      if (bestDist > 1600) { tooltip.style.display = 'none'; return; } // >40px entfernt
      r = d.results?.[bestI]?.[bestJ];
    } else {
      // 2D: direkte Koordinatenumrechnung
      const { NX, NY } = d;
      const PAD = { l: 42, r: 12, t: 8, b: 8 };
      const iW  = cssW - PAD.l - PAD.r;
      const iH  = cssH - PAD.t - PAD.b;
      const i = Math.max(1, Math.min(NX, Math.round((mx - PAD.l) / iW * NX)));
      const j = Math.max(0, Math.min(NY, Math.round((1 - (my - PAD.t) / iH) * NY)));
      r = d.results?.[i]?.[j];
    }

    if (!r) { tooltip.style.display = 'none'; return; }

    // Ist es ein Optimalpunkt?
    const pvOpt  = d.bestPvOnly;
    const jntOpt = d.bestJoint;
    const nearPvOnly  = Math.abs(r.kwp - pvOpt.kwp) < d.maxKwp/d.NX*1.5 && r.batKwh < d.maxBat/d.NY;
    const nearJoint   = Math.abs(r.kwp - jntOpt.kwp) < d.maxKwp/d.NX*1.5 && Math.abs(r.batKwh - jntOpt.batKwh) < d.maxBat/d.NY*1.5;

    const fmtN = v => Math.round(v).toLocaleString('de-DE');
    const fmtP = v => isFinite(v) && v < 99 ? v.toFixed(1) + ' a' : '> Nutzungsdauer';
    const col  = r.netBenefit >= 0 ? '#66bb6a' : '#ef9a9a';

    let header = '';
    if (nearJoint && r.batKwh > 0.5)
      header = `<div style="color:#00c853;font-weight:bold;margin-bottom:4px;">✦ Optimum PV + Speicher</div>`;
    else if (nearPvOnly && r.batKwh < 1)
      header = `<div style="color:#ffd54f;font-weight:bold;margin-bottom:4px;">▲ Optimum PV-only</div>`;

    const renditeVal = r.rendite !== undefined ? r.rendite.toFixed(1) : '—';
    tooltip.innerHTML = `${header}
      <div style="color:var(--muted);margin-bottom:3px;">PV&thinsp;<span style="color:#fff;">${fmtN(r.kwp)} kWp</span>
        ${r.batKwh > 0.5 ? `&nbsp;·&nbsp;Speicher&thinsp;<span style="color:#80deea;">${fmtN(r.batKwh)} kWh</span>` : ''}</div>
      <div>Nettogewinn&ensp;<span style="color:${col};font-weight:bold;">${fmtN(r.netBenefit)} €/a</span></div>
      <div>Rendite&ensp;<span style="color:#4fc3f7;font-weight:bold;">${renditeVal} %/a</span></div>
      <div>Amortisation&ensp;<span style="color:#ffd54f;">${fmtP(r.payback)}</span></div>
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin:3px 0;padding-top:3px;">
      Ersparnis/Erlös&ensp;<span style="color:#a5d6a7;">${fmtN(r.saving)} €/a</span></div>
      <div>Jahreskosten&ensp;<span style="color:#ef9a9a;">${fmtN(r.annualCost)} €/a</span></div>
      <div>Investition&ensp;<span style="color:#fff176;">${fmtN(r.invest)} €</span></div>
      <div>Strom-Autarkie&ensp;<span style="color:#4fc3f7;">${r.autarkie.toFixed(0)} %</span></div>`;

    // Tooltip positionieren
    tooltip.style.display = '';
    const ttW = 185, ttH = 160;
    let tx = mx + 12, ty = my - 10;
    if (tx + ttW > cssW - 5) tx = mx - ttW - 8;
    if (ty + ttH > cssH)     ty = cssH - ttH - 4;
    if (ty < 0)              ty = 4;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
  };

  _attachOpt3DInteraction();
}

// ── View-Toggle 2D / 3D ───────────────────────────────────────────────────
function _setOptView(v) {
  window._optView = v;
  ['2d','3d'].forEach(t => {
    const btn = document.getElementById('opt-view-' + t);
    if (!btn) return;
    btn.style.background = t === v ? 'var(--accent)' : 'transparent';
    btn.style.color      = t === v ? '#000' : 'var(--muted)';
  });
  const xLabel = document.getElementById('opt-xaxis-label');
  if (xLabel) xLabel.style.display = v === '2d' ? '' : 'none';
  if (v === '3d') _renderOpt3D();
  else {
    const d = window._optData;
    if (d) _renderOptHeatmap(d.grid, d.NX, d.NY, d.maxKwp, d.maxBat, d.bestPvOnly, d.bestJoint);
  }
  _attachOptHover();
}

// ── 3D-Oberfläche mit freier Rotation + Zoom ─────────────────────────────
function _renderOpt3D() {
  const canvas = document.getElementById('opt-heatmap');
  const d = window._optData;
  if (!canvas || !d) return;
  const { grid, NX, NY, maxKwp, maxBat, bestPvOnly, bestJoint } = d;

  if (!window._opt3dState)
    window._opt3dState = { az: 40 * Math.PI / 180, el: 28 * Math.PI / 180, zoom: 1 };
  const { az, el, zoom } = window._opt3dState;

  const W   = canvas.offsetWidth || 420;
  const H   = Math.round(W * 0.65);
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Wertebereich
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 1; i <= NX; i++)
    for (let j = 0; j <= NY; j++)
      if (grid[i]?.[j] !== undefined) {
        if (grid[i][j] < vMin) vMin = grid[i][j];
        if (grid[i][j] > vMax) vMax = grid[i][j];
      }
  if (!isFinite(vMin)) return;
  window._opt3dVMax = vMax; window._opt3dVMin = vMin;

  // Rotations-Projektion (orthografisch)
  // Welt: nx=[0..1] kWp, ny=[0..1] Wert, nz=[0..1] Batterie
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);

  // Skalierung: Grid soll bei beliebigem Winkel in Canvas passen
  const sW = W * 0.30 * zoom;   // Horizontal-Skalierung
  const sH = H * 0.46 * zoom;   // Vertikal-Skalierung (Höhe + Tiefenwirkung)
  // Ursprung: Mitte des Bodengitters auf einen fixen Punkt
  const cx = W * 0.50;
  const cy = H * 0.70;

  function proj(nx, ny, nz) {
    const wx = nx - 0.5, wz = nz - 0.5; // Gitter zentrieren
    return {
      sx: cx + (wx * cosA - wz * sinA) * sW,
      sy: cy - (wx * sinA * sinE + ny * cosE + wz * cosA * sinE) * sH
    };
  }

  // Projektion für Hover speichern
  window._opt3dProj = (nx, ny, nz) => proj(nx, ny, nz);

  // Farbe (identisch zur Heatmap)
  function valToColor(v, alpha) {
    let hex;
    if (v <= 0) {
      hex = lerpColor('#1a0000', '#2a2a3a', Math.max(0, Math.min(1, v / Math.min(vMin, -1))));
    } else {
      const t = Math.max(0, Math.min(1, v / Math.max(vMax, 1)));
      hex = t < 0.5 ? lerpColor('#2a2a3a', '#ffd54f', t * 2) : lerpColor('#ffd54f', '#00c853', (t - 0.5) * 2);
    }
    if (!alpha || alpha === 1) return hex;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Zeichenreihenfolge (Painter's Algorithm): nach Tiefe entlang Blickrichtung
  // Tiefe = nx*sinA*cosE + nz*cosA*cosE → sinA>0: high-i zuerst; cosA>0: high-j zuerst
  const iArr = Array.from({length: NX}, (_, k) => sinA >= 0 ? NX - k : k + 1);
  const jArr = Array.from({length: NY}, (_, k) => cosA >= 0 ? NY - 1 - k : k);

  // Bodengitter
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 0.5;
  for (let i = 0; i <= NX; i += Math.ceil(NX / 6)) {
    const p0 = proj(i/NX, 0, 0), p1 = proj(i/NX, 0, 1);
    ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
  }
  for (let j = 0; j <= NY; j += Math.ceil(NY / 5)) {
    const p0 = proj(0, 0, j/NY), p1 = proj(1, 0, j/NY);
    ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
  }

  // Oberflächen-Quads
  for (const j of jArr) {
    for (const i of iArr) {
      const v00 = grid[i-1]?.[j]   ?? 0, v10 = grid[i]?.[j]   ?? 0;
      const v11 = grid[i]  ?.[j+1] ?? 0, v01 = grid[i-1]?.[j+1] ?? 0;
      const vAvg = (v00 + v10 + v11 + v01) / 4;
      const p00 = proj((i-1)/NX, Math.max(0,v00)/Math.max(vMax,1), j/NY);
      const p10 = proj(i/NX,     Math.max(0,v10)/Math.max(vMax,1), j/NY);
      const p11 = proj(i/NX,     Math.max(0,v11)/Math.max(vMax,1), (j+1)/NY);
      const p01 = proj((i-1)/NX, Math.max(0,v01)/Math.max(vMax,1), (j+1)/NY);
      ctx.beginPath();
      ctx.moveTo(p00.sx, p00.sy); ctx.lineTo(p10.sx, p10.sy);
      ctx.lineTo(p11.sx, p11.sy); ctx.lineTo(p01.sx, p01.sy);
      ctx.closePath();
      ctx.fillStyle = valToColor(vAvg, 0.92);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }
  }

  // Achsen
  const aO = proj(0,0,0), aX = proj(1,0,0), aZ = proj(0,0,1), aY = proj(0,1,0);
  ctx.strokeStyle = 'rgba(200,210,230,0.5)';
  ctx.lineWidth = 1.2;
  [[aO,aX],[aO,aZ],[aO,aY]].forEach(([a,b]) => {
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  });

  // Beschriftungen (nur wenn nicht gerade gedreht wird)
  if (!window._opt3dDragging) {
    ctx.fillStyle = 'rgba(160,170,200,0.85)';
    ctx.font = '8px sans-serif';
    ctx.textBaseline = 'middle';
    // kWp-Achse
    const midX = proj(0.5, 0, 0);
    ctx.textAlign = 'center';
    ctx.fillText('← PV-Leistung →', midX.sx, midX.sy + (aX.sy > aO.sy ? 14 : -8));
    // Batterie-Achse
    const midZ = proj(0, 0, 0.5);
    ctx.fillText('Speicher kWh', midZ.sx + (sinA < 0 ? 28 : -28), midZ.sy - 4);
    // Wert-Achse (Y)
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(f => {
      const val = vMin + f * (vMax - vMin);
      const p   = proj(0, Math.max(0, val) / Math.max(vMax, 1), 0);
      ctx.fillText(Math.abs(val) >= 1000 ? (val/1000).toFixed(1)+'k' : Math.round(val), p.sx - 4, p.sy);
    });
    ctx.fillText('€/a', aY.sx - 4, aY.sy - 8);
    // Ecken-Werte
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(130,140,170,0.6)'; ctx.font = '7px sans-serif';
    ctx.fillText('0 kWp', aO.sx, aO.sy + 10);
    ctx.fillText(Math.round(maxKwp)+' kWp', aX.sx, aX.sy + 10);
    ctx.fillText(Math.round(maxBat)+' kWh', aZ.sx, aZ.sy + 10);

    // Dreh-Hinweis
    ctx.fillStyle = 'rgba(120,130,160,0.5)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Drag: drehen  ·  Scroll: zoom  ·  Doppelklick: Reset', W/2, H - 6);
  }

  // Optimum-Markierungen
  if (bestPvOnly?.netBenefit > -Infinity) {
    const p = proj(bestPvOnly.kwp/maxKwp, Math.max(0,bestPvOnly.netBenefit)/Math.max(vMax,1), 0);
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.moveTo(p.sx,p.sy-7); ctx.lineTo(p.sx-5,p.sy+1); ctx.lineTo(p.sx+5,p.sy+1); ctx.closePath(); ctx.fill();
  }
  if (bestJoint?.netBenefit > -Infinity) {
    const p = proj(bestJoint.kwp/maxKwp, Math.max(0,bestJoint.netBenefit)/Math.max(vMax,1), bestJoint.batKwh/maxBat);
    const s = 5;
    ctx.strokeStyle = '#00c853'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.sx-s,p.sy); ctx.lineTo(p.sx+s,p.sy); ctx.moveTo(p.sx,p.sy-s); ctx.lineTo(p.sx,p.sy+s); ctx.stroke();
  }
}

// ── 3D-Interaction: Drag = Rotation, Scroll = Zoom, Dblclick = Reset ─────
function _attachOpt3DInteraction() {
  const canvas = document.getElementById('opt-heatmap');
  if (!canvas || canvas._opt3dListenersAttached) return;
  canvas._opt3dListenersAttached = true;

  let dragStartX = 0, dragStartY = 0;

  canvas.addEventListener('mousedown', e => {
    if (window._optView !== '3d') return;
    window._opt3dDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!window._opt3dDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragStartX = e.clientX; dragStartY = e.clientY;
    const s = window._opt3dState;
    s.az -= dx * 0.009;
    s.el  = Math.max(6 * Math.PI/180, Math.min(78 * Math.PI/180, s.el + dy * 0.007));
    _renderOpt3D();
  });

  window.addEventListener('mouseup', () => {
    if (!window._opt3dDragging) return;
    window._opt3dDragging = false;
    canvas.style.cursor = 'grab';
    _renderOpt3D(); // Finale Render mit Beschriftungen
  });

  canvas.addEventListener('wheel', e => {
    if (window._optView !== '3d') return;
    e.preventDefault();
    window._opt3dState.zoom = Math.max(0.25, Math.min(5,
      window._opt3dState.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
    _renderOpt3D();
  }, { passive: false });

  canvas.addEventListener('dblclick', () => {
    if (window._optView !== '3d') return;
    window._opt3dState = { az: 40*Math.PI/180, el: 28*Math.PI/180, zoom: 1 };
    _renderOpt3D();
  });

  canvas.style.cursor = 'grab';
}

// ═══════════════════════════════════════════════════════════════════════════

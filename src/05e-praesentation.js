// ── 05e-praesentation.js — Interaktive Ergebnis-Präsentation (HTML-Export) ──
// Erzeugt aus den aktuellen Ergebnissen (Dispatch, Netz, Wirtschaftlichkeit,
// CO₂) eine eigenständige HTML-Datei im Präsentations-Format für den
// Auftraggeber: Folien mit Tastatur-/Wisch-Navigation und interaktiven
// SVG-Diagrammen (Hover-Tooltips, Ein-/Ausblenden von Erzeugern, Zähler-
// Animationen). Keine externen Abhängigkeiten — die Datei läuft offline
// per Doppelklick und kann direkt per E-Mail weitergegeben werden.
import { activeVariantId, gebaeude, globalYear, netzEdges, varianten } from './01-globals-varianten.js';
import { getComputedStats } from './02b-gebaeude.js';
import { GL_MONTH_START } from './06a-gbi-lastgang.js';
import { DA_LABELS, _daColor } from './07a-analysis-charts.js';
import { ERZEUGER_CFG } from './config/erzeuger-cfg.js';

const NUTZUNG_LABEL_P = {
  efh:'Einfamilienhaus', mfh:'Mehrfamilienhaus', ghd:'Gewerbe/Handel',
  schule:'Schule', buero:'Büro', industrie:'Industrie', oeffentlich:'Öffentlich',
};

// ── Daten aus dem laufenden Tool einsammeln ─────────────────────────────────
async function _praesCollectData() {
  const keys    = window._dispatchActiveKeys || [];
  const en      = window._dispatchEnergy || {};
  const hourly  = window._dispatchHourly || {};
  const lastgang = window._dispatchLastgangKw || null;

  const projektName = document.querySelector('.header-projekt-name')?.textContent?.trim()
    || document.title || 'Energieplanung';
  const varName = activeVariantId
    ? (varianten.find(v => v.id === activeVariantId)?.name || 'Variante') : 'Basisdaten';
  const datum = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });

  // Quartier
  const connectedIds = new Set((Array.isArray(netzEdges) ? netzEdges : [])
    .filter(e => !e.pruned).flatMap(e => [e.u, e.v]));
  const nGeb = gebaeude.length;
  const nAngeschlossen = gebaeude.filter(g => connectedIds.has(g.id)).length;
  const gesamtFlaeche = gebaeude.reduce((s, g) => s + (parseFloat(g.flaeche) || 0), 0);
  const gesamtHeizlast = gebaeude.reduce((s, g) => s + (parseFloat(
    typeof getComputedStats === 'function' ? getComputedStats(g, globalYear).heizlast : g.heizlast) || 0), 0);
  const totalMwh = keys.reduce((s, k) => s + ((en[k] || {}).waermeMwh || 0), 0);

  // Nutzungsverteilung
  const nutzMap = {};
  gebaeude.forEach(g => {
    const label = NUTZUNG_LABEL_P[g.nutzung] || g.nutzung || 'Unbekannt';
    if (!nutzMap[label]) nutzMap[label] = { label, count: 0, mwh: 0 };
    nutzMap[label].count++;
    const st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    nutzMap[label].mwh += st.waerme || parseFloat(g.waerme) || 0;
  });
  const nutzung = Object.values(nutzMap).sort((a, b) => b.mwh - a.mwh);

  // Erzeugermix
  const erzeuger = keys.map(k => {
    const e = en[k] || {};
    const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG[k] : null;
    const kw = cfg?.leistungId ? (parseFloat(document.getElementById(cfg.leistungId)?.value) || 0) : 0;
    return {
      key: k,
      label: DA_LABELS[k] || k,
      color: _daColor(k),
      kw: Math.round(kw),
      mwh: Math.round((e.waermeMwh || 0) * 10) / 10,
      elMwh: Math.round((e.elMwh || 0) * 10) / 10,
      anteil: totalMwh > 0 ? Math.round((e.waermeMwh || 0) / totalMwh * 1000) / 10 : 0,
      vbh: kw > 0 ? Math.round((e.waermeMwh || 0) * 1000 / kw) : null,
    };
  }).filter(e => e.mwh > 0.05);

  // Monatliche Erzeugung aus Stundenprofilen (MWh je Erzeuger und Monat)
  const monat = [];
  keys.forEach(k => {
    const h = hourly[k];
    if (!h || h.length < 8760) return;
    const vals = new Array(12).fill(0);
    let m = 0;
    for (let t = 0; t < 8760; t++) {
      if (m < 11 && t >= GL_MONTH_START[m + 1]) m++;
      vals[m] += Math.max(0, h[t]) / 1000;
    }
    if (vals.some(v => v > 0.05)) {
      monat.push({ label: DA_LABELS[k] || k, color: _daColor(k), vals: vals.map(v => Math.round(v * 10) / 10) });
    }
  });

  // Jahresdauerlinie (auf 730 Punkte reduziert) + Auslegungswoche
  let jdl = null, woche = null;
  if (lastgang && lastgang.length >= 8760) {
    const sorted = [...lastgang].sort((a, b) => b - a);
    const pts = [];
    for (let i = 0; i < 8760; i += 12) pts.push(Math.round(sorted[i] * 10) / 10);
    jdl = {
      pts,
      peakKw: Math.round(sorted[0]),
      meanKw: Math.round(lastgang.reduce((s, v) => s + v, 0) / 8760),
    };

    // Kälteste Woche = 168-h-Fenster mit maximaler Lastsumme (Tagesraster)
    let bestStart = 0, bestSum = -1;
    for (let start = 0; start + 168 <= 8760; start += 24) {
      let sum = 0;
      for (let t = start; t < start + 168; t++) sum += lastgang[t];
      if (sum > bestSum) { bestSum = sum; bestStart = start; }
    }
    const wSeries = [];
    keys.forEach(k => {
      const h = hourly[k];
      if (!h || h.length < 8760) return;
      const vals = [];
      for (let t = bestStart; t < bestStart + 168; t++) vals.push(Math.round(Math.max(0, h[t]) * 10) / 10);
      if (vals.some(v => v > 0.01)) wSeries.push({ label: DA_LABELS[k] || k, color: _daColor(k), vals });
    });
    if (wSeries.length) {
      const startTag = Math.floor(bestStart / 24) + 1;
      woche = { startTag, series: wSeries };
    }
  }

  // Wärmenetz
  const activeNetz = (Array.isArray(netzEdges) ? netzEdges : []).filter(e => !e.pruned);
  let netz = null;
  if (activeNetz.length > 0) {
    const trasseM = Math.round(activeNetz.reduce((s, e) => s + (e.length || 0), 0));
    const verlustMwh = activeNetz.reduce((s, e) => s + (e.lossKW_annual || 0), 0) * 8.76;
    const dnMap = {};
    activeNetz.forEach(e => { const dn = e.dn || '?'; dnMap[dn] = (dnMap[dn] || 0) + (e.length || 0); });
    netz = {
      trasseM,
      verlustMwh: Math.round(verlustMwh * 10) / 10,
      verlustPct: totalMwh > 0 ? Math.round(verlustMwh / totalMwh * 1000) / 10 : null,
      vl: parseFloat(document.getElementById('netz-vl')?.value) || 90,
      rl: parseFloat(document.getElementById('netz-rl')?.value) || 60,
      nAngeschlossen, nGeb,
      dn: Object.keys(dnMap).sort((a, b) => parseFloat(a) - parseFloat(b))
        .map(dn => ({ dn, laenge: Math.round(dnMap[dn]) })),
    };
  }

  // Wirtschaftlichkeit
  const wirtschaft = (window._lastWgk || window._lastInvestGes) ? {
    wgk: window._lastWgk ? Math.round(window._lastWgk * 10) / 10 : null,
    investGes: window._lastInvestGes ? Math.round(window._lastInvestGes) : null,
    jkGes: window._lastJkGes ? Math.round(window._lastJkGes) : null,
  } : null;

  // Ökologie
  const co2Text = document.getElementById('co2-bilanz-gesamt')?.textContent?.trim() || null;
  const eeAnteil = window._lastEeAnteil != null ? Math.round(window._lastEeAnteil * 10) / 10 : null;

  // Strombilanz (aus Sankey-Daten)
  const sd = window._sankeyData || {};
  const hatStromBilanz = (sd.pvMwh || 0) > 0 || (sd.bhkwStromMwh || 0) > 0 || (sd.netzbezugMwh || 0) > 0;
  const strom = hatStromBilanz ? {
    pvMwh: Math.round((sd.pvMwh || 0) * 10) / 10,
    bhkwMwh: Math.round((sd.bhkwStromMwh || 0) * 10) / 10,
    netzbezugMwh: Math.round((sd.netzbezugMwh || 0) * 10) / 10,
    einspeisungMwh: Math.round((sd.einspeisungMwh || 0) * 10) / 10,
    eigenverbrauchMwh: Math.round((sd.eigenverbrauchMwh || 0) * 10) / 10,
    quartierMwh: Math.round((sd.quartierMwh || 0) * 10) / 10,
  } : null;

  // Kartenausschnitt als Bild
  let mapImg = '';
  try {
    if (typeof html2canvas !== 'undefined') {
      const mapEl = document.getElementById('map');
      if (mapEl) {
        const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 1.5, logging: false, backgroundColor: '#1a1a2e' });
        mapImg = canvas.toDataURL('image/jpeg', 0.82);
      }
    }
  } catch (e) { console.warn('Kartenexport für Präsentation fehlgeschlagen:', e); }

  // Fazit-Kernaussagen aus den Zahlen ableiten
  const fmtP = v => Number(Math.round(v)).toLocaleString('de-DE');
  const fazit = [];
  if (nGeb > 0) fazit.push(`Das Quartier umfasst ${nGeb} Gebäude mit einem Wärmebedarf von ${fmtP(totalMwh)} MWh pro Jahr.`);
  if (netz) fazit.push(`${nAngeschlossen} von ${nGeb} Gebäuden werden über ein ${fmtP(netz.trasseM)} m langes Wärmenetz versorgt (${netz.vl.toFixed(0)}/${netz.rl.toFixed(0)} °C).`);
  if (erzeuger.length) {
    const top = [...erzeuger].sort((a, b) => b.mwh - a.mwh)[0];
    fazit.push(`Hauptwärmeerzeuger ist ${top.label} mit einem Deckungsanteil von ${top.anteil.toLocaleString('de-DE')} %.`);
  }
  if (eeAnteil != null) fazit.push(`Der Anteil erneuerbarer Energien an der Wärmeerzeugung beträgt ${eeAnteil.toLocaleString('de-DE')} %.`);
  if (wirtschaft?.wgk != null) fazit.push(`Die Wärmegestehungskosten liegen bei ${wirtschaft.wgk.toLocaleString('de-DE')} ct/kWh.`);
  if (co2Text) fazit.push(`Die CO₂-Bilanz des Konzepts beträgt ${co2Text}.`);

  return {
    projekt: projektName, variante: varName, datum, jahr: globalYear || null,
    map: mapImg,
    quartier: {
      nGeb, nAngeschlossen,
      flaeche: Math.round(gesamtFlaeche),
      bedarfMwh: Math.round(totalMwh),
      heizlastKw: Math.round(gesamtHeizlast),
    },
    nutzung, erzeuger, monat, jdl, woche, netz, wirtschaft,
    oeko: { eeAnteil, co2Text },
    strom, fazit,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Laufzeit-Code der Präsentation — wird per .toString() in die exportierte
// Datei serialisiert und dort mit den eingebetteten Daten aufgerufen.
// Achtung: darf keinerlei Bezüge auf Variablen außerhalb der Funktion haben.
// ═════════════════════════════════════════════════════════════════════════════
function _praesRuntime(D) {
  var fmt = function(v, d) {
    return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function div(cls, html) {
    var e = document.createElement('div');
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ── Tooltip ────────────────────────────────────────────────────────────
  var tip = document.getElementById('tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var px = Math.min(x + 16, window.innerWidth - w - 12);
    var py = y - h - 14 < 8 ? y + 18 : y - h - 14;
    tip.style.left = px + 'px';
    tip.style.top = py + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  // ── Zähler-Animation für KPI-Kacheln ───────────────────────────────────
  function countUp(el) {
    var target = parseFloat(el.dataset.val), dec = parseInt(el.dataset.dec || '0', 10);
    var suffix = el.dataset.suffix || '';
    var t0 = null, dur = 900;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.childNodes[0].textContent = fmt(target * eased, dec);
      if (p < 1) requestAnimationFrame(step);
    }
    el.innerHTML = '0<span class="kpi-unit">' + suffix + '</span>';
    requestAnimationFrame(step);
  }
  function kpi(val, dec, suffix, label, accent) {
    return '<div class="kpi' + (accent ? ' accent' : '') + '"><div class="kpi-val" data-val="' + val +
      '" data-dec="' + dec + '" data-suffix="' + (suffix || '') + '">' + fmt(val, dec) +
      '<span class="kpi-unit">' + (suffix || '') + '</span></div><div class="kpi-lbl">' + label + '</div></div>';
  }

  // ── Chart: Donut (Erzeugermix) ─────────────────────────────────────────
  function renderDonut(host, items, centerTop, centerSub) {
    var size = 340, cx = size / 2, cy = size / 2, r0 = 88, r1 = 140;
    var svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size, 'class': 'donut' });
    var total = items.reduce(function(s, it) { return s + it.mwh; }, 0);
    if (total <= 0) return;
    var a = -Math.PI / 2;
    var ctText = svgEl('text', { x: cx, y: cy - 8, 'text-anchor': 'middle', 'class': 'donut-center-top' });
    var csText = svgEl('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', 'class': 'donut-center-sub' });
    ctText.textContent = centerTop;
    csText.textContent = centerSub;
    items.forEach(function(it) {
      var frac = it.mwh / total;
      var a1 = a + frac * Math.PI * 2;
      var large = (a1 - a) > Math.PI ? 1 : 0;
      var gap = 0.008;
      var s = a + gap, e = Math.max(s, a1 - gap);
      var p = 'M' + (cx + r1 * Math.cos(s)) + ',' + (cy + r1 * Math.sin(s)) +
        ' A' + r1 + ',' + r1 + ' 0 ' + large + ' 1 ' + (cx + r1 * Math.cos(e)) + ',' + (cy + r1 * Math.sin(e)) +
        ' L' + (cx + r0 * Math.cos(e)) + ',' + (cy + r0 * Math.sin(e)) +
        ' A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + (cx + r0 * Math.cos(s)) + ',' + (cy + r0 * Math.sin(s)) + ' Z';
      var path = svgEl('path', { d: p, fill: it.color, 'class': 'donut-seg' });
      path.addEventListener('mousemove', function(ev) {
        ctText.textContent = fmt(it.anteil, 1) + ' %';
        csText.textContent = it.label;
        showTip('<b>' + it.label + '</b><br>' + fmt(it.mwh, 1) + ' MWh/a · ' + fmt(it.anteil, 1) + ' %' +
          (it.kw ? '<br>' + fmt(it.kw) + ' kW installiert' : ''), ev.clientX, ev.clientY);
      });
      path.addEventListener('mouseleave', function() {
        ctText.textContent = centerTop;
        csText.textContent = centerSub;
        hideTip();
      });
      svg.appendChild(path);
      a = a1;
    });
    svg.appendChild(ctText);
    svg.appendChild(csText);
    host.appendChild(svg);
  }

  // ── Chart: gestapelte Monatsbalken mit Legenden-Toggle ─────────────────
  function renderMonthly(host, series) {
    var MON = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    var state = series.map(function(s) { return { s: s, hidden: false }; });
    var chartHost = div('chart-host');
    var legend = div('legend');
    state.forEach(function(st) {
      var item = div('legend-item');
      item.innerHTML = '<span class="legend-dot" style="background:' + st.s.color + '"></span>' + st.s.label;
      item.addEventListener('click', function() {
        st.hidden = !st.hidden;
        item.classList.toggle('off', st.hidden);
        draw();
      });
      legend.appendChild(item);
    });
    function draw() {
      chartHost.innerHTML = '';
      var W = 860, H = 380, padL = 62, padB = 34, padT = 16, padR = 10;
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart' });
      var act = state.filter(function(st) { return !st.hidden; }).map(function(st) { return st.s; });
      var totals = MON.map(function(_, m) {
        return act.reduce(function(s, sr) { return s + sr.vals[m]; }, 0);
      });
      var maxV = Math.max.apply(null, totals.concat([1]));
      var x = function(m) { return padL + m * (W - padL - padR) / 12; };
      var bw = (W - padL - padR) / 12 * 0.62;
      var y = function(v) { return H - padB - v / maxV * (H - padT - padB); };
      for (var g = 0; g <= 4; g++) {
        var gv = maxV * g / 4;
        svg.appendChild(svgEl('line', { x1: padL, y1: y(gv), x2: W - padR, y2: y(gv), 'class': 'gridline' }));
        var lbl = svgEl('text', { x: padL - 8, y: y(gv) + 4, 'text-anchor': 'end', 'class': 'axis-lbl' });
        lbl.textContent = fmt(gv);
        svg.appendChild(lbl);
      }
      MON.forEach(function(mn, m) {
        var acc = 0;
        act.forEach(function(sr) {
          var v = sr.vals[m];
          if (v <= 0) return;
          var rect = svgEl('rect', {
            x: x(m) + ((W - padL - padR) / 12 - bw) / 2, y: y(acc + v),
            width: bw, height: Math.max(0, y(acc) - y(acc + v)),
            fill: sr.color, 'class': 'bar-seg',
          });
          (function(vv, tot) {
            rect.addEventListener('mousemove', function(ev) {
              showTip('<b>' + sr.label + '</b> · ' + mn + '<br>' + fmt(vv, 1) + ' MWh · Monat gesamt ' + fmt(tot, 1) + ' MWh', ev.clientX, ev.clientY);
            });
          })(v, totals[m]);
          rect.addEventListener('mouseleave', hideTip);
          svg.appendChild(rect);
          acc += v;
        });
        var t = svgEl('text', { x: x(m) + (W - padL - padR) / 24, y: H - padB + 18, 'text-anchor': 'middle', 'class': 'axis-lbl' });
        t.textContent = mn;
        svg.appendChild(t);
      });
      var yt = svgEl('text', { x: padL - 8, y: 8, 'text-anchor': 'end', 'class': 'axis-lbl' });
      yt.textContent = 'MWh';
      svg.appendChild(yt);
      chartHost.appendChild(svg);
    }
    draw();
    host.appendChild(chartHost);
    host.appendChild(legend);
  }

  // ── Chart: Jahresdauerlinie mit Fadenkreuz ─────────────────────────────
  function renderJdl(host, jdl) {
    var W = 860, H = 380, padL = 70, padB = 36, padT = 16, padR = 14;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart' });
    var pts = jdl.pts, n = pts.length;
    var maxV = Math.max.apply(null, pts.concat([1]));
    var x = function(i) { return padL + i / (n - 1) * (W - padL - padR); };
    var y = function(v) { return H - padB - v / maxV * (H - padT - padB); };
    for (var g = 0; g <= 4; g++) {
      var gv = maxV * g / 4;
      svg.appendChild(svgEl('line', { x1: padL, y1: y(gv), x2: W - padR, y2: y(gv), 'class': 'gridline' }));
      var lbl = svgEl('text', { x: padL - 8, y: y(gv) + 4, 'text-anchor': 'end', 'class': 'axis-lbl' });
      lbl.textContent = fmt(gv);
      svg.appendChild(lbl);
    }
    for (var hx = 0; hx <= 8760; hx += 2190) {
      var xi = padL + hx / 8760 * (W - padL - padR);
      var tl = svgEl('text', { x: xi, y: H - padB + 18, 'text-anchor': 'middle', 'class': 'axis-lbl' });
      tl.textContent = fmt(hx) + ' h';
      svg.appendChild(tl);
    }
    var dArea = 'M' + x(0) + ',' + y(pts[0]);
    for (var i = 1; i < n; i++) dArea += ' L' + x(i) + ',' + y(pts[i]);
    var dLine = dArea;
    dArea += ' L' + x(n - 1) + ',' + (H - padB) + ' L' + x(0) + ',' + (H - padB) + ' Z';
    svg.appendChild(svgEl('path', { d: dArea, 'class': 'jdl-area' }));
    svg.appendChild(svgEl('path', { d: dLine, 'class': 'jdl-line' }));
    var cross = svgEl('line', { x1: 0, y1: padT, x2: 0, y2: H - padB, 'class': 'crosshair', style: 'display:none' });
    var dot = svgEl('circle', { r: 4.5, 'class': 'cross-dot', style: 'display:none' });
    svg.appendChild(cross);
    svg.appendChild(dot);
    var overlay = svgEl('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
    overlay.addEventListener('mousemove', function(ev) {
      var box = svg.getBoundingClientRect();
      var mx = (ev.clientX - box.left) / box.width * W;
      var idx = Math.max(0, Math.min(n - 1, Math.round((mx - padL) / (W - padL - padR) * (n - 1))));
      var stunde = Math.round(idx / (n - 1) * 8760);
      cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx));
      cross.style.display = '';
      dot.setAttribute('cx', x(idx)); dot.setAttribute('cy', y(pts[idx]));
      dot.style.display = '';
      showTip('<b>' + fmt(pts[idx]) + ' kW</b><br>wird an ' + fmt(stunde) + ' h/a erreicht oder überschritten', ev.clientX, ev.clientY);
    });
    overlay.addEventListener('mouseleave', function() {
      cross.style.display = 'none'; dot.style.display = 'none'; hideTip();
    });
    svg.appendChild(overlay);
    var yt = svgEl('text', { x: padL - 8, y: 8, 'text-anchor': 'end', 'class': 'axis-lbl' });
    yt.textContent = 'kW';
    svg.appendChild(yt);
    host.appendChild(svg);
  }

  // ── Chart: Auslegungswoche als gestapelte Flächen ──────────────────────
  function renderWoche(host, woche) {
    var W = 860, H = 380, padL = 70, padB = 36, padT = 16, padR = 14;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart' });
    var n = 168;
    var totals = [];
    for (var t = 0; t < n; t++) {
      totals.push(woche.series.reduce(function(s, sr) { return s + sr.vals[t]; }, 0));
    }
    var maxV = Math.max.apply(null, totals.concat([1]));
    var x = function(i) { return padL + i / (n - 1) * (W - padL - padR); };
    var y = function(v) { return H - padB - v / maxV * (H - padT - padB); };
    for (var g = 0; g <= 4; g++) {
      var gv = maxV * g / 4;
      svg.appendChild(svgEl('line', { x1: padL, y1: y(gv), x2: W - padR, y2: y(gv), 'class': 'gridline' }));
      var lbl = svgEl('text', { x: padL - 8, y: y(gv) + 4, 'text-anchor': 'end', 'class': 'axis-lbl' });
      lbl.textContent = fmt(gv);
      svg.appendChild(lbl);
    }
    for (var d = 0; d < 7; d++) {
      var tl = svgEl('text', { x: x(d * 24 + 12), y: H - padB + 18, 'text-anchor': 'middle', 'class': 'axis-lbl' });
      tl.textContent = 'Tag ' + (woche.startTag + d);
      svg.appendChild(tl);
      if (d > 0) svg.appendChild(svgEl('line', { x1: x(d * 24), y1: padT, x2: x(d * 24), y2: H - padB, 'class': 'gridline' }));
    }
    var base = new Array(n).fill(0);
    woche.series.forEach(function(sr) {
      var top = base.map(function(b, i) { return b + sr.vals[i]; });
      var dPath = 'M' + x(0) + ',' + y(top[0]);
      for (var i = 1; i < n; i++) dPath += ' L' + x(i) + ',' + y(top[i]);
      for (var j = n - 1; j >= 0; j--) dPath += ' L' + x(j) + ',' + y(base[j]);
      dPath += ' Z';
      svg.appendChild(svgEl('path', { d: dPath, fill: sr.color, 'fill-opacity': 0.85 }));
      base = top;
    });
    var cross = svgEl('line', { x1: 0, y1: padT, x2: 0, y2: H - padB, 'class': 'crosshair', style: 'display:none' });
    svg.appendChild(cross);
    var overlay = svgEl('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
    overlay.addEventListener('mousemove', function(ev) {
      var box = svg.getBoundingClientRect();
      var mx = (ev.clientX - box.left) / box.width * W;
      var idx = Math.max(0, Math.min(n - 1, Math.round((mx - padL) / (W - padL - padR) * (n - 1))));
      cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx));
      cross.style.display = '';
      var rows = woche.series.filter(function(sr) { return sr.vals[idx] > 0.5; }).map(function(sr) {
        return '<span style="color:' + sr.color + '">●</span> ' + sr.label + ': ' + fmt(sr.vals[idx]) + ' kW';
      });
      showTip('<b>Stunde ' + (idx % 24) + ':00 · Tag ' + (woche.startTag + Math.floor(idx / 24)) + '</b><br>' +
        rows.join('<br>') + '<br>Gesamt: <b>' + fmt(totals[idx]) + ' kW</b>', ev.clientX, ev.clientY);
    });
    overlay.addEventListener('mouseleave', function() { cross.style.display = 'none'; hideTip(); });
    svg.appendChild(overlay);
    var yt = svgEl('text', { x: padL - 8, y: 8, 'text-anchor': 'end', 'class': 'axis-lbl' });
    yt.textContent = 'kW';
    svg.appendChild(yt);
    host.appendChild(svg);
    var legend = div('legend');
    woche.series.forEach(function(sr) {
      legend.appendChild(div('legend-item', '<span class="legend-dot" style="background:' + sr.color + '"></span>' + sr.label));
    });
    host.appendChild(legend);
  }

  // ── Chart: horizontale Balken (Nutzung, Nennweiten) ────────────────────
  function renderHBars(host, items, unit) {
    var maxV = Math.max.apply(null, items.map(function(it) { return it.val; }).concat([1]));
    items.forEach(function(it) {
      var row = div('hbar-row');
      row.innerHTML = '<div class="hbar-lbl">' + it.label + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:0%;background:' + (it.color || 'var(--accent)') + '"></div></div>' +
        '<div class="hbar-val">' + fmt(it.val, it.dec || 0) + ' ' + unit + '</div>';
      row.addEventListener('mousemove', function(ev) {
        if (it.tipHtml) showTip(it.tipHtml, ev.clientX, ev.clientY);
      });
      row.addEventListener('mouseleave', hideTip);
      host.appendChild(row);
      requestAnimationFrame(function() {
        setTimeout(function() { row.querySelector('.hbar-fill').style.width = (it.val / maxV * 100) + '%'; }, 60);
      });
    });
  }

  // ── Chart: EE-Ring ──────────────────────────────────────────────────────
  function renderRing(host, pct, label) {
    var size = 260, r = 104, c = size / 2;
    var svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size, 'class': 'ring' });
    var circumference = 2 * Math.PI * r;
    svg.appendChild(svgEl('circle', { cx: c, cy: c, r: r, 'class': 'ring-bg' }));
    var fg = svgEl('circle', {
      cx: c, cy: c, r: r, 'class': 'ring-fg',
      'stroke-dasharray': circumference,
      'stroke-dashoffset': circumference,
      transform: 'rotate(-90 ' + c + ' ' + c + ')',
    });
    svg.appendChild(fg);
    var t1 = svgEl('text', { x: c, y: c - 2, 'text-anchor': 'middle', 'class': 'ring-val' });
    t1.textContent = fmt(pct, 1) + ' %';
    var t2 = svgEl('text', { x: c, y: c + 26, 'text-anchor': 'middle', 'class': 'ring-lbl' });
    t2.textContent = label;
    svg.appendChild(t1);
    svg.appendChild(t2);
    host.appendChild(svg);
    setTimeout(function() {
      fg.style.transition = 'stroke-dashoffset 1.2s ease';
      fg.setAttribute('stroke-dashoffset', circumference * (1 - Math.min(100, pct) / 100));
    }, 120);
  }

  // ── Folien definieren (nur mit vorhandenen Daten) ──────────────────────
  var slides = [];

  slides.push({ kicker: '', title: '', build: function(el) {
    el.className += ' slide-title';
    el.innerHTML =
      '<div class="title-kicker">Energiekonzept · ' + D.variante + (D.jahr ? ' · Betrachtungsjahr ' + D.jahr : '') + '</div>' +
      '<h1>' + D.projekt + '</h1>' +
      '<div class="title-sub">Ergebnispräsentation</div>' +
      (D.map ? '<div class="title-map"><img src="' + D.map + '" alt="Lageplan"></div>' : '') +
      '<div class="title-date">' + D.datum + '</div>' +
      '<div class="title-hint">Navigation: Pfeiltasten, Klick oder Wischen · F für Vollbild</div>';
  }});

  if (D.quartier.nGeb > 0) {
    slides.push({ kicker: 'Ausgangslage', title: 'Das Quartier im Überblick', build: function(el) {
      var row = div('kpi-row');
      row.innerHTML =
        kpi(D.quartier.nGeb, 0, '', 'Gebäude') +
        kpi(D.quartier.flaeche, 0, ' m²', 'Beheizte Fläche') +
        kpi(D.quartier.bedarfMwh, 0, ' MWh/a', 'Wärmebedarf') +
        kpi(D.quartier.heizlastKw, 0, ' kW', 'Heizlast') +
        (D.netz ? kpi(Math.round(D.quartier.nAngeschlossen / D.quartier.nGeb * 100), 0, ' %', 'Anschlussgrad') : '');
      el.appendChild(row);
      if (D.nutzung.length > 1) {
        el.appendChild(div('sub-title', 'Wärmebedarf nach Nutzung'));
        var bars = div('hbars');
        renderHBars(bars, D.nutzung.map(function(nu) {
          return { label: nu.label, val: nu.mwh, dec: 0,
            tipHtml: '<b>' + nu.label + '</b><br>' + nu.count + ' Gebäude · ' + fmt(nu.mwh, 1) + ' MWh/a' };
        }), 'MWh/a');
        el.appendChild(bars);
      }
    }});
  }

  if (D.erzeuger.length) {
    slides.push({ kicker: 'Energiekonzept', title: 'Wärmeerzeugung im Jahresmix', build: function(el) {
      var wrap = div('two-col');
      var left = div('col');
      renderDonut(left, D.erzeuger, fmt(D.quartier.bedarfMwh) + ' MWh', 'Erzeugung pro Jahr');
      var right = div('col');
      var tbl = '<table class="ptable"><thead><tr><th>Erzeuger</th><th class="r">Leistung</th><th class="r">Wärme</th><th class="r">Anteil</th></tr></thead><tbody>';
      D.erzeuger.forEach(function(e) {
        tbl += '<tr><td><span class="legend-dot" style="background:' + e.color + '"></span>' + e.label + '</td>' +
          '<td class="r">' + (e.kw ? fmt(e.kw) + ' kW' : '–') + '</td>' +
          '<td class="r">' + fmt(e.mwh) + ' MWh</td>' +
          '<td class="r">' + fmt(e.anteil, 1) + ' %</td></tr>';
      });
      tbl += '</tbody></table>';
      right.innerHTML = tbl + '<div class="chart-hint">Mit der Maus über das Diagramm fahren für Details.</div>';
      wrap.appendChild(left);
      wrap.appendChild(right);
      el.appendChild(wrap);
    }});
  }

  if (D.monat.length) {
    slides.push({ kicker: 'Simulation', title: 'Wärmeerzeugung im Jahresverlauf', build: function(el) {
      el.appendChild(div('slide-intro', 'Monatliche Erzeugung je Anlage aus der stundenscharfen Einsatzsimulation (8.760 h). Erzeuger in der Legende anklicken, um sie ein- oder auszublenden.'));
      renderMonthly(el, D.monat);
    }});
  }

  if (D.jdl) {
    slides.push({ kicker: 'Simulation', title: 'Jahresdauerlinie der Wärmelast', build: function(el) {
      var row = div('kpi-row kpi-row-slim');
      row.innerHTML =
        kpi(D.jdl.peakKw, 0, ' kW', 'Spitzenlast') +
        kpi(D.jdl.meanKw, 0, ' kW', 'Mittlere Last') +
        kpi(D.jdl.peakKw > 0 ? Math.round(D.jdl.meanKw / D.jdl.peakKw * 100) : 0, 0, ' %', 'Auslastungsgrad');
      el.appendChild(row);
      renderJdl(el, D.jdl);
    }});
  }

  if (D.woche) {
    slides.push({ kicker: 'Simulation', title: 'Auslegungswoche — kälteste Woche des Jahres', build: function(el) {
      el.appendChild(div('slide-intro', 'Stundenscharfer Erzeugereinsatz in der lastintensivsten Woche. Die Stapelung zeigt, welche Anlage wann welchen Anteil der Last übernimmt.'));
      renderWoche(el, D.woche);
    }});
  }

  if (D.netz) {
    slides.push({ kicker: 'Infrastruktur', title: 'Das Wärmenetz', build: function(el) {
      var row = div('kpi-row');
      row.innerHTML =
        kpi(D.netz.trasseM, 0, ' m', 'Trassenlänge') +
        kpi(D.netz.nAngeschlossen, 0, ' / ' + D.netz.nGeb, 'Angeschlossene Gebäude') +
        kpi(D.netz.verlustMwh, 1, ' MWh/a', 'Netzverluste') +
        (D.netz.verlustPct != null ? kpi(D.netz.verlustPct, 1, ' %', 'Verlustanteil', D.netz.verlustPct > 15) : '') +
        kpi(D.netz.vl, 0, ' / ' + fmt(D.netz.rl, 0) + ' °C', 'Vorlauf / Rücklauf');
      el.appendChild(row);
      if (D.netz.dn.length) {
        el.appendChild(div('sub-title', 'Leitungslängen nach Nennweite'));
        var bars = div('hbars');
        renderHBars(bars, D.netz.dn.map(function(d) {
          return { label: 'DN ' + d.dn, val: d.laenge, dec: 0,
            tipHtml: '<b>DN ' + d.dn + '</b><br>' + fmt(d.laenge) + ' m · ' + fmt(d.laenge / D.netz.trasseM * 100, 1) + ' % der Trasse' };
        }), 'm');
        el.appendChild(bars);
      }
    }});
  }

  if (D.strom) {
    slides.push({ kicker: 'Strombilanz', title: 'Stromerzeugung und -verbrauch', build: function(el) {
      var row = div('kpi-row');
      row.innerHTML =
        (D.strom.pvMwh > 0 ? kpi(D.strom.pvMwh, 0, ' MWh/a', 'PV-Erzeugung') : '') +
        (D.strom.bhkwMwh > 0 ? kpi(D.strom.bhkwMwh, 0, ' MWh/a', 'BHKW-Strom') : '') +
        kpi(D.strom.quartierMwh, 0, ' MWh/a', 'Strombedarf Quartier') +
        kpi(D.strom.netzbezugMwh, 0, ' MWh/a', 'Netzbezug') +
        (D.strom.einspeisungMwh > 0 ? kpi(D.strom.einspeisungMwh, 0, ' MWh/a', 'Einspeisung') : '');
      el.appendChild(row);
      var eigenErz = D.strom.pvMwh + D.strom.bhkwMwh;
      if (eigenErz > 0 && D.strom.quartierMwh > 0) {
        var autarkie = Math.min(100, Math.round((1 - D.strom.netzbezugMwh / Math.max(0.001, D.strom.quartierMwh)) * 100));
        var ringWrap = div('ring-center');
        renderRing(ringWrap, Math.max(0, autarkie), 'bilanzielle Eigenversorgung');
        el.appendChild(ringWrap);
      }
    }});
  }

  if (D.wirtschaft && (D.wirtschaft.wgk != null || D.wirtschaft.investGes)) {
    slides.push({ kicker: 'Wirtschaftlichkeit', title: 'Kosten des Konzepts', build: function(el) {
      var row = div('kpi-row kpi-row-big');
      row.innerHTML =
        (D.wirtschaft.wgk != null ? kpi(D.wirtschaft.wgk, 1, ' ct/kWh', 'Wärmegestehungskosten') : '') +
        (D.wirtschaft.investGes ? kpi(D.wirtschaft.investGes / 1e6, 2, ' Mio. €', 'Investition gesamt') : '') +
        (D.wirtschaft.jkGes ? kpi(D.wirtschaft.jkGes / 1000, 0, ' T€/a', 'Jahreskosten') : '');
      el.appendChild(row);
      el.appendChild(div('slide-intro', 'Vollkostenrechnung in Anlehnung an VDI 2067: Kapital-, Bedarfs- und Betriebskosten der Erzeuger, des Wärmenetzes und der Nebenanlagen, umgelegt auf die nutzbare Wärmemenge.'));
    }});
  }

  if (D.oeko.eeAnteil != null || D.oeko.co2Text) {
    slides.push({ kicker: 'Ökologie', title: 'Erneuerbare Energien und CO₂', build: function(el) {
      var wrap = div('two-col');
      if (D.oeko.eeAnteil != null) {
        var left = div('col ring-center');
        renderRing(left, D.oeko.eeAnteil, 'Anteil erneuerbarer Wärme');
        wrap.appendChild(left);
      }
      var right = div('col');
      if (D.oeko.co2Text) {
        right.innerHTML = '<div class="co2-card"><div class="co2-lbl">CO₂-Bilanz des Konzepts</div><div class="co2-val">' + D.oeko.co2Text + '</div></div>';
      }
      if (D.oeko.eeAnteil != null) {
        right.innerHTML += '<div class="slide-intro" style="margin-top:18px;">' +
          (D.oeko.eeAnteil >= 65
            ? 'Das Konzept erfüllt die 65-%-EE-Anforderung des Gebäudeenergiegesetzes (GEG) für neue Wärmenetze.'
            : 'Die 65-%-EE-Anforderung des GEG wird noch nicht erreicht — Potenzial für weitere Dekarbonisierungsschritte.') + '</div>';
      }
      wrap.appendChild(right);
      el.appendChild(wrap);
    }});
  }

  if (D.fazit.length) {
    slides.push({ kicker: 'Zusammenfassung', title: 'Ergebnisse auf einen Blick', build: function(el) {
      var list = div('fazit-list');
      D.fazit.forEach(function(txt, i) {
        var item = div('fazit-item');
        item.style.transitionDelay = (i * 0.12) + 's';
        item.innerHTML = '<div class="fazit-nr">' + (i + 1) + '</div><div>' + txt + '</div>';
        list.appendChild(item);
      });
      el.appendChild(list);
      el.appendChild(div('fazit-footer', 'Erstellt am ' + D.datum + ' · Variante „' + D.variante + '" · Micke-Heat Energieplanung'));
    }});
  }

  // ── Folien-DOM aufbauen ────────────────────────────────────────────────
  var deck = document.getElementById('deck');
  slides.forEach(function(s, i) {
    var sec = div('slide');
    sec.dataset.idx = i;
    if (s.title) {
      sec.innerHTML = '<div class="kicker">' + s.kicker + '</div><h2>' + s.title + '</h2>';
    }
    deck.appendChild(sec);
    s.el = sec;
    s.rendered = false;
  });

  // ── Navigation ─────────────────────────────────────────────────────────
  var cur = 0;
  var dots = document.getElementById('dots');
  slides.forEach(function(_, i) {
    var d = document.createElement('button');
    d.className = 'dot';
    d.title = 'Folie ' + (i + 1);
    d.addEventListener('click', function() { goTo(i); });
    dots.appendChild(d);
  });
  var counter = document.getElementById('counter');
  var progress = document.getElementById('progress-fill');

  function goTo(i) {
    if (i < 0 || i >= slides.length) return;
    hideTip();
    cur = i;
    slides.forEach(function(s, j) {
      s.el.classList.toggle('active', j === i);
      s.el.classList.toggle('past', j < i);
    });
    if (!slides[i].rendered) {
      slides[i].build(slides[i].el);
      slides[i].rendered = true;
    }
    // KPI-Zähler bei jedem Betreten neu animieren
    slides[i].el.querySelectorAll('.kpi-val').forEach(countUp);
    slides[i].el.querySelectorAll('.fazit-item').forEach(function(f) {
      f.classList.remove('in');
      requestAnimationFrame(function() { requestAnimationFrame(function() { f.classList.add('in'); }); });
    });
    Array.prototype.forEach.call(dots.children, function(d, j) {
      d.classList.toggle('active', j === i);
    });
    counter.textContent = (i + 1) + ' / ' + slides.length;
    progress.style.width = ((i + 1) / slides.length * 100) + '%';
  }

  document.getElementById('nav-prev').addEventListener('click', function() { goTo(cur - 1); });
  document.getElementById('nav-next').addEventListener('click', function() { goTo(cur + 1); });
  document.getElementById('nav-fs').addEventListener('click', function() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  document.addEventListener('keydown', function(ev) {
    if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'PageDown') { ev.preventDefault(); goTo(cur + 1); }
    if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); goTo(cur - 1); }
    if (ev.key === 'Home') goTo(0);
    if (ev.key === 'End') goTo(slides.length - 1);
    if (ev.key === 'f' || ev.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
  });

  var touchX = null;
  document.addEventListener('touchstart', function(ev) { touchX = ev.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function(ev) {
    if (touchX == null) return;
    var dx = ev.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) goTo(cur + (dx < 0 ? 1 : -1));
    touchX = null;
  }, { passive: true });

  goTo(0);
}

// ── CSS der Präsentation ────────────────────────────────────────────────────
function _praesCss() {
  return `
  :root { --bg:#0b1524; --card:rgba(255,255,255,.045); --border:rgba(255,255,255,.1);
    --text:#e8eef6; --muted:#8fa3b8; --accent:#4fc3f7; --accent2:#ffb74d; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; }
  body { font-family:'Segoe UI',system-ui,'Helvetica Neue',Arial,sans-serif; color:var(--text);
    background:radial-gradient(1200px 800px at 75% -10%, #14304f 0%, var(--bg) 55%) fixed;
    overflow:hidden; }
  #progress { position:fixed; top:0; left:0; right:0; height:3px; background:rgba(255,255,255,.07); z-index:50; }
  #progress-fill { height:100%; width:0; background:linear-gradient(90deg,var(--accent),var(--accent2)); transition:width .45s ease; }
  #deck { position:fixed; inset:0; }
  .slide { position:absolute; inset:0; padding:7vh 8vw 12vh; display:flex; flex-direction:column;
    justify-content:center; opacity:0; transform:translateX(48px); transition:opacity .5s ease,transform .5s ease;
    pointer-events:none; overflow-y:auto; }
  .slide.past { transform:translateX(-48px); }
  .slide.active { opacity:1; transform:none; pointer-events:auto; }
  .kicker { font-size:13px; letter-spacing:.22em; text-transform:uppercase; color:var(--accent); font-weight:600; margin-bottom:10px; }
  h2 { font-size:clamp(24px,3.4vw,40px); font-weight:700; margin-bottom:26px; letter-spacing:-.01em; }
  .slide-intro { color:var(--muted); font-size:15px; max-width:820px; line-height:1.65; margin-bottom:18px; }
  .sub-title { font-size:15px; font-weight:600; color:var(--text); margin:26px 0 14px; }
  .chart-hint { color:var(--muted); font-size:12.5px; margin-top:14px; }

  .slide-title { text-align:center; align-items:center; }
  .title-kicker { font-size:14px; letter-spacing:.2em; text-transform:uppercase; color:var(--accent); margin-bottom:18px; }
  .slide-title h1 { font-size:clamp(32px,5vw,58px); font-weight:800; letter-spacing:-.015em; }
  .title-sub { font-size:clamp(16px,2vw,22px); color:var(--muted); margin:10px 0 26px; }
  .title-map { max-width:min(720px,80vw); border:1px solid var(--border); border-radius:14px; overflow:hidden;
    box-shadow:0 24px 60px rgba(0,0,0,.45); margin-bottom:24px; }
  .title-map img { display:block; width:100%; height:auto; max-height:44vh; object-fit:cover; }
  .title-date { color:var(--muted); font-size:14px; }
  .title-hint { color:var(--muted); font-size:12.5px; margin-top:16px; opacity:.75; }

  .kpi-row { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:8px; }
  .kpi-row-slim { margin-bottom:14px; }
  .kpi { flex:1; min-width:150px; background:var(--card); border:1px solid var(--border); border-radius:14px;
    padding:20px 18px; backdrop-filter:blur(4px); }
  .kpi-val { font-size:clamp(24px,2.6vw,36px); font-weight:800; color:var(--accent); line-height:1.15; white-space:nowrap; }
  .kpi-row-big .kpi-val { font-size:clamp(30px,3.4vw,48px); }
  .kpi.accent .kpi-val { color:var(--accent2); }
  .kpi-unit { font-size:.55em; font-weight:600; color:var(--muted); margin-left:2px; }
  .kpi-lbl { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-top:6px; }

  .two-col { display:flex; gap:5vw; align-items:center; flex-wrap:wrap; }
  .two-col .col { flex:1; min-width:300px; }
  .ptable { width:100%; border-collapse:collapse; font-size:14.5px; }
  .ptable th { text-align:left; color:var(--muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.08em;
    padding:8px 10px; border-bottom:1px solid var(--border); }
  .ptable td { padding:9px 10px; border-bottom:1px solid rgba(255,255,255,.05); }
  .ptable .r { text-align:right; font-variant-numeric:tabular-nums; }

  .donut { width:min(340px,72vw); height:auto; display:block; margin:0 auto; }
  .donut-seg { cursor:pointer; transition:opacity .15s; }
  .donut-seg:hover { opacity:.82; }
  .donut-center-top { fill:var(--text); font-size:26px; font-weight:800; }
  .donut-center-sub { fill:var(--muted); font-size:13px; }

  .chart { width:100%; max-width:980px; height:auto; }
  .chart-host { max-width:980px; }
  .gridline { stroke:rgba(255,255,255,.08); stroke-width:1; }
  .axis-lbl { fill:var(--muted); font-size:12px; }
  .bar-seg { cursor:pointer; }
  .bar-seg:hover { opacity:.82; }
  .jdl-area { fill:rgba(79,195,247,.16); }
  .jdl-line { fill:none; stroke:var(--accent); stroke-width:2.5; }
  .crosshair { stroke:rgba(255,255,255,.45); stroke-dasharray:4 4; }
  .cross-dot { fill:var(--accent2); stroke:#0b1524; stroke-width:2; }

  .legend { display:flex; flex-wrap:wrap; gap:8px 18px; margin-top:14px; max-width:980px; }
  .legend-item { display:inline-flex; align-items:center; gap:7px; color:var(--muted); font-size:13.5px;
    cursor:pointer; user-select:none; }
  .legend-item.off { opacity:.35; text-decoration:line-through; }
  .legend-dot { display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:2px; }

  .hbars { max-width:860px; }
  .hbar-row { display:flex; align-items:center; gap:14px; margin-bottom:11px; }
  .hbar-lbl { width:190px; font-size:14px; color:var(--text); text-align:right; flex-shrink:0; }
  .hbar-track { flex:1; height:22px; background:rgba(255,255,255,.05); border-radius:6px; overflow:hidden; }
  .hbar-fill { height:100%; border-radius:6px; background:var(--accent); transition:width .9s cubic-bezier(.2,.7,.3,1); }
  .hbar-val { width:120px; font-size:13.5px; color:var(--muted); font-variant-numeric:tabular-nums; flex-shrink:0; }

  .ring { width:min(260px,60vw); height:auto; }
  .ring-center { display:flex; justify-content:center; padding-top:8px; }
  .ring-bg { fill:none; stroke:rgba(255,255,255,.08); stroke-width:20; }
  .ring-fg { fill:none; stroke:#4fc3f7; stroke-width:20; stroke-linecap:round; }
  .ring-val { fill:var(--text); font-size:36px; font-weight:800; }
  .ring-lbl { fill:var(--muted); font-size:12.5px; }
  .co2-card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:26px 24px; }
  .co2-lbl { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }
  .co2-val { font-size:clamp(20px,2.4vw,30px); font-weight:800; color:var(--accent2); }

  .fazit-list { max-width:860px; }
  .fazit-item { display:flex; gap:16px; align-items:flex-start; background:var(--card); border:1px solid var(--border);
    border-radius:12px; padding:16px 18px; margin-bottom:12px; font-size:15.5px; line-height:1.55;
    opacity:0; transform:translateY(14px); transition:opacity .5s ease,transform .5s ease; }
  .fazit-item.in { opacity:1; transform:none; }
  .fazit-nr { width:28px; height:28px; border-radius:50%; background:var(--accent); color:#062033; font-weight:800;
    display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
  .fazit-footer { color:var(--muted); font-size:12.5px; margin-top:22px; }

  #hud { position:fixed; bottom:0; left:0; right:0; padding:14px 22px; display:flex; align-items:center;
    gap:16px; z-index:50; }
  #hud .spacer { flex:1; }
  #dots { display:flex; gap:8px; position:absolute; left:50%; transform:translateX(-50%); }
  .dot { width:9px; height:9px; border-radius:50%; border:none; background:rgba(255,255,255,.22); cursor:pointer;
    padding:0; transition:background .2s, transform .2s; }
  .dot:hover { background:rgba(255,255,255,.5); }
  .dot.active { background:var(--accent); transform:scale(1.35); }
  .nav-btn { background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:9px;
    width:38px; height:38px; font-size:16px; cursor:pointer; transition:background .2s; }
  .nav-btn:hover { background:rgba(255,255,255,.12); }
  #counter { color:var(--muted); font-size:13px; font-variant-numeric:tabular-nums; }
  #brand { color:var(--muted); font-size:12.5px; opacity:.7; }
  #tooltip { position:fixed; display:none; background:#101d30; border:1px solid rgba(255,255,255,.16);
    border-radius:9px; padding:9px 12px; font-size:13px; line-height:1.55; color:var(--text); pointer-events:none;
    z-index:100; box-shadow:0 10px 30px rgba(0,0,0,.5); max-width:320px; }

  @media (max-width: 720px) {
    .slide { padding:6vh 6vw 14vh; }
    .hbar-lbl { width:110px; font-size:12.5px; }
    .hbar-val { width:86px; font-size:12px; }
  }
  @media print {
    body { overflow:visible; background:#0b1524; }
    #hud, #progress, #tooltip { display:none !important; }
    #deck { position:static; }
    .slide { position:static; opacity:1 !important; transform:none !important; page-break-after:always;
      min-height:96vh; pointer-events:auto; }
  }`;
}

// ── Haupt-Export: Präsentation erzeugen, anzeigen und herunterladen ─────────
export async function exportPraesentation() {
  const keys = window._dispatchActiveKeys || [];
  if (!keys.length && !gebaeude.length) {
    alert('Keine Ergebnisse vorhanden.\nBitte zuerst Gebäude erfassen und den Dispatch berechnen (Erzeuger-Panel).');
    return;
  }

  const data = await _praesCollectData();

  // Daten-JSON gegen vorzeitiges Script-Ende im HTML absichern
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  const html = '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>Ergebnispräsentation — ' + data.projekt.replace(/[<>&]/g, '') + '</title>\n' +
    '<style>' + _praesCss() + '</style>\n</head>\n<body>\n' +
    '<div id="progress"><div id="progress-fill"></div></div>\n' +
    '<div id="deck"></div>\n' +
    '<div id="hud">\n' +
    '  <span id="brand">Micke-Heat Energieplanung</span>\n' +
    '  <span class="spacer"></span>\n' +
    '  <div id="dots"></div>\n' +
    '  <span id="counter"></span>\n' +
    '  <button class="nav-btn" id="nav-prev" title="Zurück (Pfeil links)">‹</button>\n' +
    '  <button class="nav-btn" id="nav-next" title="Weiter (Pfeil rechts)">›</button>\n' +
    '  <button class="nav-btn" id="nav-fs" title="Vollbild (F)">⛶</button>\n' +
    '</div>\n' +
    '<div id="tooltip"></div>\n' +
    // Das schließende Script-Tag wird zusammengesetzt, damit die Zeichenfolge nicht
    // wörtlich im Quelltext steht — sie würde den Script-Block des Single-File-Builds beenden.
    '<script>\nvar PDATA = ' + json + ';\n(' + _praesRuntime.toString() + ')(PDATA);\n<' + '/script>\n' +
    '</body>\n</html>';

  // 1) Als Datei herunterladen (Weitergabe an den Auftraggeber)
  const slug = data.projekt.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projekt';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'praesentation_' + slug + '_' + new Date().toISOString().slice(0, 10) + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);

  // 2) Direkt als Vorschau öffnen
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

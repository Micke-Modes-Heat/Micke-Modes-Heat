// ── 13r-knotenpunkt-analyse.js — Knotenpunkt-Analyse (Analyse-Tab, identisches Layout zur NAP-Analyse) ──
// Tabs: Jahreslastgang · Jahresdauerlinie · Monatsprofil
// Profil-Quellen je Typ:
//   PV          → makePvProfile8760(ausrichtung) × kWp × pvSpez
//   WP          → _wpElHourly  × Anteil (leistungThKW)
//   KWK/BHKW    → _bhkwElHourly × Anteil (leistungElKW)
//   Verbraucher → _elQuartierFromGeb × Gebäudeanteil
//   Trafo/UV/…  → Topologie-BFS: Σ(downstream Last) − Σ(downstream Erzeuger)

import { ASSETS, ASSET_CFG, TYPE_RANK, getAsset, getAssetStatus } from './13a-assets-core.js';
import { makePvProfile8760, _PV_SPEZ_DEFAULT } from './09a-pv-profile.js';
import { globalYear } from './01-globals-varianten.js';
import { buildSlpProfile8760 } from './13i-slp-editor.js';

// ── Modulzustand ──────────────────────────────────────────────────────────────
const _K = {
  selectedId:       null,
  chartMode:        'zeitreihe',
  filter:           '',
  typeFilter:       'alle',       // 'alle' | 'infra' | 'erzeuger' | 'verbraucher'
  disabledContribs: new Set(),
  showContribs:     false,
  zoomMonth:        null,         // null = ganzes Jahr, 0-11 = Monat
};

// ── Konstanten ────────────────────────────────────────────────────────────────
const MDAYS  = [31,28,31,30,31,30,31,31,30,31,30,31];
const MLBL   = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const MSTART = (() => { const s=[0]; for (let m=0;m<11;m++) s.push(s[m]+MDAYS[m]*24); return s; })();

const GENERATOR_TYPES = new Set(['PV','Wind','KWK','Nsa']);
const INFRA_TYPES     = new Set(['NAP','Schaltanlage','Trafo','NSHV','UV','KVS']);

// ── Profil-Cache ──────────────────────────────────────────────────────────────
const _cache = new Map();

export function invalidateKnotenProfileCache(id) {
  if (id) _cache.delete(id); else _cache.clear();
}

// ── Profil-Berechnungen ───────────────────────────────────────────────────────

function _flat(kw) { const p=new Float32Array(8760); p.fill(kw||0); return p; }

function _pvProfile(asset) {
  const p=asset.props||{};
  const kwp=parseFloat(p.leistungKWp)||0;
  if (kwp<=0) return new Float32Array(8760);
  const aus =p.ausrichtung||'sued';
  const spez=parseFloat(p.pvSpez)||(_PV_SPEZ_DEFAULT[aus]||1050);
  const norm=makePvProfile8760(aus);
  const prof=new Float32Array(8760);
  for (let t=0;t<8760;t++) prof[t]=norm[t]*kwp*spez;
  return prof;
}

function _wpProfile(asset) {
  const hourly=window._wpElHourly;
  if (!hourly) return _flat(parseFloat(asset.props?.leistungElKW)||0);
  const allWp  =ASSETS.items.filter(a=>a.type==='WP'&&a.linkedErzeuger);
  const totalTh=allWp.reduce((s,a)=>s+(parseFloat(a.props?.leistungThKW)||0),0);
  const thisTh =parseFloat(asset.props?.leistungThKW)||0;
  const frac   =totalTh>0?thisTh/totalTh:(allWp.length?1/allWp.length:1);
  const prof=new Float32Array(8760);
  for (let t=0;t<8760;t++) prof[t]=hourly[t]*frac;
  return prof;
}

function _kwkProfile(asset) {
  const hourly=window._bhkwElHourly;
  if (!hourly) return _flat(parseFloat(asset.props?.leistungElKW)||0);
  const allKwk =ASSETS.items.filter(a=>a.type==='KWK'&&a.linkedErzeuger);
  const totalEl=allKwk.reduce((s,a)=>s+(parseFloat(a.props?.leistungElKW)||0),0);
  const thisEl =parseFloat(asset.props?.leistungElKW)||0;
  const frac   =totalEl>0?thisEl/totalEl:1;
  const prof=new Float32Array(8760);
  for (let t=0;t<8760;t++) prof[t]=hourly[t]*frac;
  return prof;
}

function _verbraucherProfile(asset) {
  if (asset.buildingId && window._elQuartierFromGeb && window.gebaeude) {
    const geb=window.gebaeude.find(g=>g.id===asset.buildingId);
    const gebMwh=geb&&typeof window.getGebStromMwh==='function'?window.getGebStromMwh(geb):0;
    const totalKwh=Array.from(window._elQuartierFromGeb).reduce((s,v)=>s+v,0);
    if (gebMwh>0&&totalKwh>0) {
      const frac=(gebMwh*1000)/totalKwh;
      const prof=new Float32Array(8760);
      for (let t=0;t<8760;t++) prof[t]=window._elQuartierFromGeb[t]*frac;
      return prof;
    }
  }
  // SLP-Profil verwenden: norm[h] × kW × 8760 → gleiche Jahresenergie wie Flachprofil
  const kw  = parseFloat(asset.props?.leistungKW) || 0;
  const slp = asset.props?.slpTyp;
  if (slp && kw > 0) {
    const norm = buildSlpProfile8760(slp);
    const prof = new Float32Array(8760);
    const scale = kw * 8760;
    for (let t = 0; t < 8760; t++) prof[t] = norm[t] * scale;
    return prof;
  }
  return _flat(kw);
}

function _bfsDownstream(startId) {
  const edges  =window.stromEdges||[];
  const visited=new Set([startId]);
  const queue  =[startId];
  const leaves =[];
  const startA =getAsset(startId);
  const startRk=startA?(TYPE_RANK[startA.type]??0):0;
  const yr = globalYear ?? new Date().getFullYear();

  while (queue.length) {
    const currId = queue.shift();
    const uniqueNeighbors = [...new Set(
      edges.filter(e => e.u===currId || e.v===currId)
           .map(e => e.u===currId ? e.v : e.u)
    )].filter(id => !visited.has(id));

    for (const nextId of uniqueNeighbors) {
      visited.add(nextId);
      const nextA  = getAsset(nextId);
      const nextRk = nextA ? (TYPE_RANK[nextA.type] ?? 0) : -1;
      if (nextRk <= startRk && nextA) continue;
      // Nur aktive Assets des aktuellen Jahres berücksichtigen
      if (nextA && getAssetStatus(nextA, yr) !== 'active') continue;
      if (!nextA || INFRA_TYPES.has(nextA.type)) queue.push(nextId);
      else leaves.push({ asset: nextA, sign: GENERATOR_TYPES.has(nextA.type) ? -1 : 1 });
    }
  }
  return leaves;
}

function _topologyProfile(asset) {
  const leaves=_bfsDownstream(asset.id);
  const prof=new Float32Array(8760);
  for (const {asset:da,sign} of leaves) {
    const dp=getNodeProfile8760(da);
    for (let t=0;t<8760;t++) prof[t]+=sign*dp[t];
  }
  return prof;
}

export function getNodeProfile8760(asset) {
  if (_cache.has(asset.id)) return _cache.get(asset.id);
  let prof;
  switch (asset.type) {
    case 'PV':           prof=_pvProfile(asset);          break;
    case 'Wind':         prof=_flat((parseFloat(asset.props?.leistungKW)||0)*0.25); break;
    case 'WP':           prof=_wpProfile(asset);          break;
    case 'KWK':          prof=_kwkProfile(asset);         break;
    case 'Verbraucher':  prof=_verbraucherProfile(asset); break;
    case 'Lade':         prof=_flat(parseFloat(asset.props?.leistungKW)||0); break;
    case 'NAP': case 'Schaltanlage': case 'Trafo':
    case 'NSHV': case 'UV': case 'KVS':
                         prof=_topologyProfile(asset);    break;
    default:             prof=new Float32Array(8760);
  }
  _cache.set(asset.id,prof);
  return prof;
}

// ── Analyse-Hilfsfunktionen ───────────────────────────────────────────────────

function _analyze(prof) {
  let peak=0, minV=Infinity, sum=0;
  for (let t=0;t<prof.length;t++) {
    sum+=prof[t];
    if (prof[t]>peak) peak=prof[t];
    if (prof[t]<minV) minV=prof[t];
  }
  const annualMwh=sum/1000;
  const vbh=peak>0?annualMwh*1000/peak:0;
  const grundlast=Float32Array.from(prof).sort((a,b)=>b-a)[Math.floor(prof.length*0.9)]||0;
  return { peak, minV:minV===Infinity?0:minV, annualMwh, vbh, grundlast,
           lastfaktor: peak>0?(sum/prof.length)/peak:0 };
}

function _toDuration(prof) { return Float32Array.from(prof).sort((a,b)=>b-a); }

function _monthlyMwh(prof) {
  const m=new Array(12).fill(0); let ptr=0;
  for (let mi=0;mi<12;mi++) {
    const hrs=MDAYS[mi]*24;
    for (let i=0;i<hrs&&ptr<prof.length;i++,ptr++) m[mi]+=prof[ptr];
    m[mi]/=1000;
  }
  return m;
}

// ── Chart-Renderer ────────────────────────────────────────────────────────────
// Gleicher dark-Stil wie NAP-Analyse

const BG   = '#0f0f1a';
const SFX  = 'rgba(255,255,255,0.06)';
const GRID = 'rgba(255,255,255,0.10)';
const LBL  = 'rgba(255,255,255,0.40)';

function _profileColor(asset) {
  if (GENERATOR_TYPES.has(asset.type)) return '#a5d6a7';
  if (INFRA_TYPES.has(asset.type))     return '#4fc3f7';
  return '#ef9a9a';
}

function _hLine(ctx,y,W,col) {
  ctx.save(); ctx.strokeStyle=col||GRID; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(W,y+.5); ctx.stroke(); ctx.restore();
}
function _vLine(ctx,x,H,col) {
  ctx.save(); ctx.strokeStyle=col||GRID; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,H); ctx.stroke(); ctx.restore();
}
function _noData(ctx,W,H) {
  ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font='12px sans-serif'; ctx.textAlign='center';
  ctx.fillText('Keine Profildaten — bitte Berechnung starten',W/2,H/2);
}
function _axisY(ctx,vMax,vMin,H,hasNeg) {
  const fmt=v=>Math.abs(v)>=1000?(v/1000).toFixed(1)+' MW':Math.round(v)+' kW';
  ctx.fillStyle=LBL; ctx.font='9px sans-serif'; ctx.textAlign='left';
  ctx.fillText(fmt(vMax),2,10);
  if (hasNeg) ctx.fillText(fmt(vMin),2,H-4);
}

function _drawZeitReihe(cv, prof, color, zoomMonth=null) {
  const W=cv.clientWidth||700; const H=cv.clientHeight||200;
  cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);

  let vMax=0,vMin=0;
  for (let t=0;t<prof.length;t++) { if(prof[t]>vMax)vMax=prof[t]; if(prof[t]<vMin)vMin=prof[t]; }
  if (vMax===0&&vMin===0) { _noData(ctx,W,H); return; }
  const range=vMax-vMin||1;
  const hasNeg=vMin<-0.1;
  const zeroY=hasNeg?Math.round(vMax/range*H):H;
  if (hasNeg) _hLine(ctx,zeroY,W,'rgba(255,255,255,0.18)');

  const n=prof.length;
  for (let col=0;col<W;col++) {
    const s=Math.floor(col*n/W), e=Math.min(n,Math.floor((col+1)*n/W));
    let mx=-Infinity,mn=Infinity;
    for (let i=s;i<e;i++) { if(prof[i]>mx)mx=prof[i]; if(prof[i]<mn)mn=prof[i]; }
    if (mx>0) {
      const y=Math.round((1-mx/(vMax||1))*zeroY);
      ctx.fillStyle=color; ctx.fillRect(col,y,1,zeroY-y);
    }
    if (mn<0) {
      const h2=Math.round((-mn/(-vMin||1))*(H-zeroY));
      ctx.fillStyle='#4fc3f7'; ctx.fillRect(col,zeroY,1,h2);
    }
  }

  // x-Achse: Monatstage bei Zoom, sonst Monatskürzel
  ctx.fillStyle=LBL; ctx.font='9px sans-serif'; ctx.textAlign='center';
  if (zoomMonth!==null) {
    const nDays = MDAYS[zoomMonth];
    for (let d=0;d<nDays;d++) {
      if (d>0&&d%5===0) _vLine(ctx,Math.round(d/nDays*W),H);
      if (d%5===0||d===nDays-1) {
        ctx.fillStyle=LBL; ctx.fillText(d+1+'.',Math.round((d+0.5)/nDays*W),H-2);
      }
    }
  } else {
    for (let m=0;m<12;m++) {
      if (m>0) _vLine(ctx,Math.round(MSTART[m]/n*W),H);
      const cx=Math.round((MSTART[m]+MDAYS[m]*12)/n*W);
      ctx.fillStyle=LBL; ctx.fillText(MLBL[m].slice(0,1),cx,H-2);
    }
  }
  _axisY(ctx,vMax,vMin,H,hasNeg);
}

function _drawDauerlinie(cv,prof,color) {
  const W=cv.clientWidth||700; const H=cv.clientHeight||200;
  cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);

  const sorted=_toDuration(prof);
  const vMax=sorted[0]||0, vMin=sorted[sorted.length-1]||0;
  if (vMax===0&&vMin===0) { _noData(ctx,W,H); return; }
  const range=vMax-vMin||1;
  const hasNeg=vMin<-0.1;
  const zeroY=hasNeg?Math.round(vMax/range*H):H;
  if (hasNeg) _hLine(ctx,zeroY,W,'rgba(255,255,255,0.18)');

  // Fläche füllen
  ctx.fillStyle=color+'55';
  ctx.beginPath(); ctx.moveTo(0,zeroY);
  for (let col=0;col<W;col++) {
    const t=Math.floor(col*sorted.length/W);
    const v=sorted[t];
    const y=v>=0?Math.round((1-v/(vMax||1))*zeroY):zeroY;
    ctx.lineTo(col,y);
  }
  ctx.lineTo(W,zeroY); ctx.closePath(); ctx.fill();

  // Linie
  ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath();
  for (let col=0;col<W;col++) {
    const t=Math.floor(col*sorted.length/W);
    const v=sorted[t];
    const y=v>=0?Math.round((1-v/(vMax||1))*zeroY):zeroY;
    col===0?ctx.moveTo(col,y):ctx.lineTo(col,y);
  }
  ctx.stroke();

  // Quantil-Linien (10 % / 50 % / 90 %)
  ctx.setLineDash([4,4]);
  [[0.10,'#ef9a9a'],[0.50,'#ffd54f'],[0.90,'#80cbc4']].forEach(([q,c])=>{
    const qv=sorted[Math.floor(q*sorted.length)]||0;
    const y=hasNeg
      ?(qv>=0?Math.round((1-qv/(vMax||1))*zeroY):Math.round(zeroY+(-qv/(-vMin||1))*(H-zeroY)))
      :Math.round((1-qv/(vMax||1))*H);
    ctx.strokeStyle=c; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.fillStyle=c; ctx.font='8px sans-serif'; ctx.textAlign='right';
    ctx.fillText(`${Math.round(q*100)}% · ${Math.round(Math.abs(qv))} kW`,W-4,y-2);
  });
  ctx.setLineDash([]);

  // x-Achse: Stundenbeschriftung
  ctx.fillStyle=LBL; ctx.font='9px sans-serif'; ctx.textAlign='center';
  [2000,4000,6000,8000].forEach(h=>{
    const x=Math.round(h/8760*W);
    _vLine(ctx,x,H);
    ctx.fillText(h+'h',x,H-2);
  });
  _axisY(ctx,vMax,vMin,H,hasNeg);
}

function _drawMonat(cv,prof,color) {
  const W=cv.clientWidth||700; const H=cv.clientHeight||200;
  cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);

  const mwh=_monthlyMwh(prof);
  const mMax=Math.max(...mwh.map(Math.abs))||1;
  const hasNeg=mwh.some(v=>v<-0.01);
  const posMax=Math.max(...mwh.filter(v=>v>0),0)||mMax;
  const zeroY=hasNeg?Math.round(posMax/(posMax+Math.abs(Math.min(...mwh,0)))*(H-20)):H-20;
  if (hasNeg) _hLine(ctx,zeroY,W,'rgba(255,255,255,0.18)');

  const barW=Math.floor((W-24)/12);
  const gap =Math.max(1,Math.floor((W-24-barW*12)/11));
  ctx.font='9px sans-serif'; ctx.textAlign='center';

  for (let m=0;m<12;m++) {
    const x=12+m*(barW+gap);
    const v=mwh[m];
    const bH=Math.max(1,Math.abs(v)/mMax*(hasNeg?zeroY-4:H-24));
    ctx.fillStyle=v>=0?color:'#4fc3f7';
    ctx.fillRect(x,v>=0?zeroY-bH:zeroY,barW,bH);
    // Wert
    const fmt=Math.abs(v)>=100?Math.round(v).toLocaleString('de-DE'):v.toFixed(1);
    ctx.fillStyle='rgba(255,255,255,0.7)';
    if (bH>12) ctx.fillText(fmt,x+barW/2,v>=0?zeroY-bH-2:zeroY+bH+9);
    // Monatskürzel
    ctx.fillStyle=LBL;
    ctx.fillText(MLBL[m].slice(0,3),x+barW/2,H-1);
  }
  _axisY(ctx,mwh.reduce((a,b)=>Math.max(a,b),0),mwh.reduce((a,b)=>Math.min(a,b),0),H-20,hasNeg);
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

// Kumulierte Tagesgrenzen für Monatsbeschriftung in der Heatmap
const MDAY_CUM = [0,31,59,90,120,151,181,212,243,273,304,334,365];

function _heatColor(frac) {
  const t = Math.max(0, Math.min(1, frac));
  let r, g, b;
  if (t < 0.25)      { const x=t/0.25;       r=0;   g=0;               b=Math.round(80+x*175); }
  else if (t < 0.5)  { const x=(t-0.25)/0.25; r=0;   g=Math.round(x*210); b=255; }
  else if (t < 0.75) { const x=(t-0.5)/0.25;  r=Math.round(x*255); g=210; b=Math.round(255*(1-x)); }
  else               { const x=(t-0.75)/0.25;  r=255; g=Math.round(210*(1-x)); b=0; }
  return `rgb(${r},${g},${b})`;
}
function _heatColorNeg(frac) {
  const t=Math.max(0,Math.min(1,frac));
  return `rgb(0,${Math.round(80+t*120)},${Math.round(120+t*135)})`;
}

function _drawHeatmap(cv, prof, color, zoomMonth=null) {
  const W=cv.clientWidth||700; const H=cv.clientHeight||220;
  cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=BG; ctx.fillRect(0,0,W,H);

  let vMax=0, vMin=0;
  for (let t=0;t<prof.length;t++) {
    if (prof[t]>vMax) vMax=prof[t];
    if (prof[t]<vMin) vMin=prof[t];
  }
  if (vMax===0&&vMin===0) { _noData(ctx,W,H); return; }

  const hasNeg=vMin<-0.1;
  const OX=28, LBL_H=16;
  const chartW=W-OX-6, chartH=H-LBL_H;

  // Bei Zoom: nur Tage dieses Monats; sonst 365 Tage
  const nDays = zoomMonth!==null ? MDAYS[zoomMonth] : 365;
  const cellW=chartW/nDays, cellH=chartH/24;

  for (let t=0;t<prof.length;t++) {
    const day=Math.floor(t/24), hour=t%24;
    if (day>=nDays) break;
    const v=prof[t];
    ctx.fillStyle=hasNeg&&v<0 ? _heatColorNeg((-v)/(-vMin||1)) : _heatColor(v/(vMax||1));
    ctx.fillRect(OX+day*cellW, hour*cellH, Math.ceil(cellW+0.5), Math.ceil(cellH+0.5));
  }

  // x-Achse
  ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=1;
  ctx.fillStyle=LBL; ctx.font='8px sans-serif'; ctx.textAlign='center';
  if (zoomMonth!==null) {
    // Tages-Beschriftung (jeder 5. Tag)
    for (let d=0;d<nDays;d++) {
      if (d>0&&d%5===0) { ctx.beginPath(); ctx.moveTo(OX+d*cellW,0); ctx.lineTo(OX+d*cellW,chartH); ctx.stroke(); }
      if (d%5===0) ctx.fillText(d+1+'.', OX+(d+2.5)*cellW, H-2);
    }
  } else {
    for (let m=0;m<12;m++) {
      if (m>0) { const x=OX+MDAY_CUM[m]*cellW+0.5; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,chartH); ctx.stroke(); }
      const cx=OX+(MDAY_CUM[m]+(MDAY_CUM[m+1]-MDAY_CUM[m])/2)*cellW;
      ctx.fillText(MLBL[m].slice(0,1), cx, H-2);
    }
  }

  // y-Achse (Stundenbeschriftung)
  ctx.textAlign='right'; ctx.fillStyle=LBL;
  [0,6,12,18,23].forEach(h=>{
    ctx.fillText(String(h).padStart(2,'0'), OX-3, h*cellH+Math.max(cellH/2,5));
  });

  // Farbskala-Legende
  const LSX=W-5, LSW=4, LSH=chartH*0.6, LSY=chartH*0.2;
  for (let i=0;i<LSH;i++) { ctx.fillStyle=_heatColor(1-(i/LSH)); ctx.fillRect(LSX-LSW,LSY+i,LSW,1); }
  ctx.fillStyle=LBL; ctx.font='8px sans-serif'; ctx.textAlign='right';
  ctx.fillText(Math.round(vMax)+' kW', LSX-LSW-2, LSY+5);
  ctx.fillText('0', LSX-LSW-2, LSY+LSH);
}

// ── Tooltip-System ────────────────────────────────────────────────────────────

function _ensureTip() {
  if (document.getElementById('kna-tip')) return;
  const el=document.createElement('div');
  el.id='kna-tip';
  el.style.cssText='position:fixed;pointer-events:none;z-index:10000;display:none;'+
    'background:#12121e;border:1px solid rgba(255,255,255,.2);border-radius:6px;'+
    'padding:6px 10px;font-size:11px;color:#e0e0e0;font-family:"DM Mono",monospace;'+
    'white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.6);line-height:1.6;';
  document.body.appendChild(el);
}

function _showTip(cx,cy,html) {
  _ensureTip();
  const el=document.getElementById('kna-tip');
  el.innerHTML=html;
  el.style.display='block';
  const tw=el.offsetWidth+16, th=el.offsetHeight+10;
  el.style.left=(cx+14+tw>window.innerWidth?cx-tw:cx+14)+'px';
  el.style.top =(cy-10+th>window.innerHeight?cy-th:cy-10)+'px';
}

function _hideTip() {
  const el=document.getElementById('kna-tip');
  if (el) el.style.display='none';
}

function _hoydToDate(hoy) {
  return new Date(new Date(new Date().getFullYear(),0,1).getTime()+hoy*3600000);
}

function _fmtDate(d) {
  return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
}

function _attachHover(cv, prof, mode, zoomMonth=null) {
  _ensureTip();
  cv.style.cursor='crosshair';
  cv.addEventListener('mouseleave', _hideTip);

  if (mode==='zeitreihe') {
    cv.addEventListener('mousemove', e=>{
      const r=cv.getBoundingClientRect();
      const tLocal=Math.max(0,Math.min(prof.length-1,Math.round((e.clientX-r.left)/r.width*(prof.length-1))));
      const tGlobal=zoomMonth!==null ? MSTART[zoomMonth]+tLocal : tLocal;
      const v=prof[tLocal]||0, d=_hoydToDate(tGlobal);
      const c=v>=0?'#ef9a9a':'#4fc3f7';
      _showTip(e.clientX,e.clientY,
        `<span style="color:#888">${_fmtDate(d)} · ${String(d.getHours()).padStart(2,'0')}:00</span><br>`+
        `<span style="color:${c};font-weight:700;">${v>=0?'+':''}${v.toFixed(1)} kW</span>`);
    });

  } else if (mode==='dauerlinie') {
    const sorted=_toDuration(prof);
    cv.addEventListener('mousemove', e=>{
      const r=cv.getBoundingClientRect();
      const rank=Math.max(0,Math.min(8759,Math.round((e.clientX-r.left)/r.width*8759)));
      const v=sorted[rank]||0;
      const c=v>=0?'#ef9a9a':'#4fc3f7';
      _showTip(e.clientX,e.clientY,
        `<span style="color:#888">Rang ${(rank+1).toLocaleString('de-DE')} / 8.760 h</span><br>`+
        `<span style="color:${c};font-weight:700;">${v>=0?'+':''}${v.toFixed(1)} kW</span><br>`+
        `<span style="color:#555;font-size:10px;">überschritten ${(rank+1).toLocaleString('de-DE')} h/a</span>`);
    });

  } else if (mode==='monat') {
    const mwh=_monthlyMwh(prof);
    cv.addEventListener('mousemove', e=>{
      const r=cv.getBoundingClientRect();
      const m=Math.max(0,Math.min(11,Math.floor((e.clientX-r.left)/r.width*12)));
      const v=mwh[m];
      const c=v>=0?'#ef9a9a':'#4fc3f7';
      _showTip(e.clientX,e.clientY,
        `<span style="color:#888">${MLBL[m]}</span><br>`+
        `<span style="color:${c};font-weight:700;">${v>=0?'+':''}${v.toFixed(1)} MWh</span>`);
    });

  } else if (mode==='heatmap') {
    const OX=28, LBL_H=16;
    cv.addEventListener('mousemove', e=>{
      const r=cv.getBoundingClientRect();
      const chartW=r.width-OX-6, chartH=r.height-LBL_H;
      const xFrac=(e.clientX-r.left-OX)/chartW;
      const yFrac=(e.clientY-r.top)/chartH;
      const day =Math.max(0,Math.min(364,Math.floor(xFrac*365)));
      const hour=Math.max(0,Math.min(23, Math.floor(yFrac*24)));
      const t=day*24+hour;
      const v=t<prof.length?prof[t]:0;
      const d=_hoydToDate(t);
      const c=v>=0?'#ef9a9a':'#4fc3f7';
      _showTip(e.clientX,e.clientY,
        `<span style="color:#888">${_fmtDate(d)} · ${String(hour).padStart(2,'0')}:00</span><br>`+
        `<span style="color:${c};font-weight:700;">${v>=0?'+':''}${v.toFixed(1)} kW</span>`);
    });
  }
}

// ── Kapazitäts-Helfer ────────────────────────────────────────────────────────

function _getCapacityKW(asset) {
  const p = asset.props || {};
  switch (asset.type) {
    case 'Trafo': return (parseFloat(p.leistungKVA)||0) * 0.95;
    case 'NSHV':
    case 'UV':
    case 'KVS':  return (parseFloat(p.nennstromA)||0) * 0.4 * Math.sqrt(3) * 0.95;
    default:     return 0;
  }
}

/** Profil mit Berücksichtigung deaktivierter Beiträge */
function _getActiveProfile(asset) {
  if (!INFRA_TYPES.has(asset.type) || _K.disabledContribs.size === 0)
    return getNodeProfile8760(asset);
  const leaves = _bfsDownstream(asset.id);
  const prof   = new Float32Array(8760);
  for (const {asset:da, sign} of leaves) {
    if (_K.disabledContribs.has(da.id)) continue;
    const dp = getNodeProfile8760(da);
    for (let t = 0; t < 8760; t++) prof[t] += sign * dp[t];
  }
  return prof;
}

/** Kapazitätslinien auf Canvas überlagern (nach dem Chart-Render) */
function _overlayCapacityLines(cv, prof, capacityKW, mode) {
  if (!capacityKW || capacityKW <= 0) return;
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');

  if (mode === 'heatmap') {
    // Zellen über ±80 % / ±100 % einfärben (beide Richtungen)
    const nDays  = prof.length <= MDAYS[0]*24*2 ? Math.ceil(prof.length/24) : 365;
    const OX = 28, LBL_H = 16;
    const chartW = W - OX - 6, chartH = H - LBL_H;
    const cellW = chartW / nDays, cellH = chartH / 24;
    for (let t = 0; t < prof.length; t++) {
      const v = prof[t];
      let col = null, alpha = 0;
      if      (v >=  capacityKW)        { col = '#ef5350'; alpha = 0.45; }
      else if (v >=  capacityKW * 0.8)  { col = '#ff9800'; alpha = 0.35; }
      else if (v <= -capacityKW)        { col = '#ef5350'; alpha = 0.45; }  // Einspeisung 100%
      else if (v <= -capacityKW * 0.8)  { col = '#ff9800'; alpha = 0.35; } // Einspeisung 80%
      if (col) {
        ctx.globalAlpha = alpha; ctx.fillStyle = col;
        ctx.fillRect(OX + Math.floor(t/24)*cellW, (t%24)*cellH, Math.ceil(cellW+0.5), Math.ceil(cellH+0.5));
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (mode !== 'zeitreihe' && mode !== 'dauerlinie') return;

  // Wertebereich
  let vMax = 0, vMin = 0;
  for (let t = 0; t < prof.length; t++) {
    if (prof[t] > vMax) vMax = prof[t];
    if (prof[t] < vMin) vMin = prof[t];
  }
  const range  = vMax - vMin || 1;
  const hasNeg = vMin < -0.1;
  const zeroY  = hasNeg ? Math.round(vMax / range * H) : H;

  // Positive Seite (Bezug)
  const drawLinePos = (kw, color, label) => {
    if (kw <= 0 || vMax <= 0) return;
    const inRange = kw <= vMax * 1.05;
    const y = inRange ? Math.round((1 - kw / vMax) * zeroY) : 3;
    ctx.save();
    ctx.setLineDash(inRange ? [6,3] : [2,2]);
    ctx.strokeStyle = color; ctx.lineWidth = inRange ? 1.5 : 1; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(0, y+0.5); ctx.lineTo(W, y+0.5); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.font = (inRange?'bold ':'')+'9px sans-serif'; ctx.textAlign='left';
    ctx.fillText((inRange?'':' ▲ außerhalb · ')+label, 4, y+(inRange?-3:10));
    ctx.restore();
  };

  // Negative Seite (Einspeisung) — nur wenn Profil negative Werte hat
  const drawLineNeg = (kw, color, label) => {
    if (kw <= 0 || !hasNeg || vMin >= 0) return;
    const absMin = -vMin;
    const inRange = kw <= absMin * 1.05;
    const y = inRange
      ? Math.round(zeroY + (kw / absMin) * (H - zeroY))
      : H - 3;
    ctx.save();
    ctx.setLineDash(inRange ? [6,3] : [2,2]);
    ctx.strokeStyle = color; ctx.lineWidth = inRange ? 1.5 : 1; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(0, y+0.5); ctx.lineTo(W, y+0.5); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.font = (inRange?'bold ':'')+'9px sans-serif'; ctx.textAlign='left';
    ctx.fillText((inRange?'':' ▼ außerhalb · ')+label, 4, y+(inRange?10:-3));
    ctx.restore();
  };

  drawLinePos(capacityKW,       '#ef5350', `↑ 100% · ${Math.round(capacityKW)} kW`);
  drawLinePos(capacityKW * 0.8, '#ff9800', `↑ 80% · ${Math.round(capacityKW*0.8)} kW`);
  drawLineNeg(capacityKW,       '#ef5350', `↓ 100% · -${Math.round(capacityKW)} kW`);
  drawLineNeg(capacityKW * 0.8, '#ff9800', `↓ 80% · -${Math.round(capacityKW*0.8)} kW`);
}

/** Rechtes Drawer-Panel mit Beitrags-Liste rendern */
function _renderRightPanel() {
  const panel = document.getElementById('kna-right-panel');
  if (!panel || !_K.selectedId) return;
  const asset = getAsset(_K.selectedId);
  if (!asset || !INFRA_TYPES.has(asset.type)) {
    panel.innerHTML = '<div style="padding:16px;color:#444;font-size:10px;">Kein Netzobjekt ausgewählt</div>';
    return;
  }
  const leaves = _bfsDownstream(asset.id);
  if (!leaves.length) {
    panel.innerHTML = '<div style="padding:16px;color:#444;font-size:10px;">Keine nachgelagerten Assets gefunden.<br>Netz verkabeln um Superposition zu sehen.</div>';
    return;
  }

  const rows = leaves.map(({asset:da, sign}) => {
    const isOn = !_K.disabledContribs.has(da.id);
    const dcfg = ASSET_CFG[da.type] || {};
    const dp   = getNodeProfile8760(da);
    let dPeak  = 0;
    for (let t = 0; t < 8760 && t < dp.length; t++) if (dp[t] > dPeak) dPeak = dp[t];
    const dir    = sign > 0 ? '↑' : '↓';
    const dirCol = sign > 0 ? '#ef9a9a' : '#a5d6a7';
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;
      border-bottom:1px solid rgba(255,255,255,.04);font-size:10px;
      opacity:${isOn ? 1 : 0.35};">
      <button onclick="knaToggleContrib('${da.id}')" title="${isOn?'Ausblenden':'Einblenden'}"
        style="width:11px;height:11px;border-radius:50%;cursor:pointer;padding:0;flex-shrink:0;
        border:2px solid ${dcfg.color||'#888'};background:${isOn?dcfg.color||'#888':'transparent'};"></button>
      <span style="width:14px;text-align:center;flex-shrink:0;">${dcfg.icon||'?'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;">${da.name}</span>
      <span style="color:${dirCol};font-weight:700;">${dir}</span>
      <span style="color:#555;font-family:'DM Mono',monospace;min-width:48px;text-align:right;">
        ${dPeak>0.01?dPeak.toFixed(1)+' kW':'—'}
      </span>
    </div>`;
  }).join('');

  const nLoad = leaves.filter(l => l.sign > 0).length;
  const nGen  = leaves.filter(l => l.sign < 0).length;
  const yr2   = globalYear ?? new Date().getFullYear();

  const qBtn = (label, onclick, col) =>
    `<button onclick="${onclick}"
      style="padding:2px 5px;border:1px solid ${col}55;border-radius:3px;
      background:transparent;color:${col};font-size:9px;cursor:pointer;white-space:nowrap;">
      ${label}</button>`;

  panel.innerHTML = `
    <div style="padding:6px 10px;border-bottom:1px solid rgba(79,195,247,.12);background:#0d0d18;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;">
          Beiträge (${leaves.length}) · Jahr ${yr2}
        </span>
        <div style="display:flex;gap:3px;">
          ${qBtn('Alle ☑',  'knaToggleAllContribs(true)',  '#4fc3f7')}
          ${qBtn('Keine',   'knaToggleAllContribs(false)', '#555')}
        </div>
      </div>
      <div style="display:flex;gap:3px;">
        ${qBtn(`↑ Bezug (${nLoad})`,      "knaEnableOnlyType('load')", '#ef9a9a')}
        ${qBtn(`↓ Einspeisung (${nGen})`, "knaEnableOnlyType('gen')",  '#a5d6a7')}
      </div>
    </div>
    <div style="overflow-y:auto;height:calc(100% - 62px);">${rows}</div>`;
}

// ── Sidebar-Render ────────────────────────────────────────────────────────────

function _renderSidebar() {
  const sb=document.getElementById('kna-sidebar');
  if (!sb) return;
  const items=ASSETS.items.filter(a=>a.type!=='Reserve');
  const q=(_K.filter||'').toLowerCase();

  const tf = _K.typeFilter;  // muss VOR der ersten Verwendung stehen
  const tfBtn = (val, lbl) =>
    `<button onclick="knaSetTypeFilter('${val}')"
      style="flex:1;padding:3px 2px;border-radius:3px;cursor:pointer;font-size:9px;
      border:1px solid ${tf===val?'#4fc3f7':'#2a3a3a'};
      background:${tf===val?'rgba(79,195,247,.12)':'transparent'};
      color:${tf===val?'#4fc3f7':'#555'};">${lbl}</button>`;

  const showInfra = tf==='alle'||tf==='infra';
  const showErzg  = tf==='alle'||tf==='erzeuger';
  const showVerbr = tf==='alle'||tf==='verbraucher';
  const groups = [
    showInfra ? ['⚡ Infrastruktur', items.filter(a=>INFRA_TYPES.has(a.type))]                   : null,
    showVerbr ? ['🔌 Verbraucher',   items.filter(a=>['Verbraucher','Lade'].includes(a.type))]   : null,
    showErzg  ? ['☀ Erzeuger',       items.filter(a=>[...GENERATOR_TYPES,'WP'].includes(a.type))]: null,
    showVerbr ? ['🔋 Speicher',       items.filter(a=>a.type==='Batterie')]                       : null,
  ].filter(Boolean);

  let html=`
<div style="padding:8px 10px 4px;">
  <input id="kna-search" type="text" value="${q}" placeholder="Knoten suchen …"
    style="width:100%;box-sizing:border-box;padding:6px 8px;background:#1e1e30;
    border:1px solid #2a3a3a;border-radius:4px;color:#ccc;font-size:10px;margin-bottom:6px;"
    oninput="knaSetFilter(this.value)">
  <div style="display:flex;gap:3px;">
    ${tfBtn('alle','Alle')}
    ${tfBtn('infra','⚡ Infra')}
    ${tfBtn('erzeuger','☀ Erz.')}
    ${tfBtn('verbraucher','🔌 Verbr.')}
  </div>
</div>`;

  for (const [grp,grpItems] of groups) {
    const filtered=q?grpItems.filter(a=>a.name.toLowerCase().includes(q)||(ASSET_CFG[a.type]?.label||'').toLowerCase().includes(q)):grpItems;
    if (!filtered.length) continue;
    html+=`<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;
      padding:8px 10px 3px;">${grp} <span style="opacity:.5">(${filtered.length})</span></div>`;
    for (const a of filtered) {
      const cfg=ASSET_CFG[a.type]||{};
      const sel=a.id===_K.selectedId;
      html+=`<div onclick="knaSelectNode('${a.id}')" title="${a.name}"
        style="display:flex;align-items:center;gap:7px;padding:6px 10px;cursor:pointer;font-size:11px;
        border-left:2px solid ${sel?cfg.color||'#4fc3f7':'transparent'};
        background:${sel?'rgba(79,195,247,.08)':'transparent'};"
        onmouseover="this.style.background='rgba(255,255,255,.04)'"
        onmouseout="this.style.background='${sel?'rgba(79,195,247,.08)':'transparent'}'">
        <span style="width:8px;height:8px;border-radius:50%;background:${cfg.color||'#888'};flex-shrink:0;"></span>
        <span style="width:14px;text-align:center;flex-shrink:0;">${cfg.icon||'?'}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc;">${a.name}</span>
        <span style="font-size:9px;color:${cfg.color||'#666'};white-space:nowrap;">${cfg.label||a.type}</span>
      </div>`;
    }
  }

  if (items.length===0) html+='<div style="padding:16px 10px;color:#444;font-size:10px;">Keine Assets vorhanden</div>';
  sb.innerHTML=html;
}

// ── Haupt-Render ──────────────────────────────────────────────────────────────

function _renderMain() {
  const top=document.getElementById('kna-main-top');
  const bot=document.getElementById('kna-main-bot');
  if (!top||!bot) return;

  if (!_K.selectedId) {
    top.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#333;font-size:13px;">← Knoten aus der Liste auswählen</div>`;
    bot.innerHTML='';
    return;
  }

  const asset=getAsset(_K.selectedId);
  if (!asset) { top.innerHTML='<div style="color:#555;padding:20px;">Asset nicht gefunden</div>'; bot.innerHTML=''; return; }

  invalidateKnotenProfileCache(_K.selectedId);
  const prof       = _getActiveProfile(asset); // respektiert disabledContribs
  const capacityKW = _getCapacityKW(asset);
  const stats=_analyze(prof);
  const cfg  =ASSET_CFG[asset.type]||{};
  const col  =_profileColor(asset);
  const noData=stats.peak<0.01&&Math.abs(stats.minV)<0.01;

  const fmt   =v=>v.toLocaleString('de-DE',{maximumFractionDigits:1});
  const fmtKw =v=>Math.abs(v)>=1000?(v/1000).toFixed(2)+' MW':fmt(v)+' kW';
  const fmtMwh=v=>Math.abs(v)>=1000?(v/1000).toFixed(1)+' GWh/a':fmt(v)+' MWh/a';
  const isGen =GENERATOR_TYPES.has(asset.type);
  const isInf =INFRA_TYPES.has(asset.type);

  // Chart-Tabs
  const tabBtn=(id,label,mode)=>`<button onclick="knaSetChartMode('${mode}')"
    style="padding:5px 12px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;
    border:1px solid ${_K.chartMode===mode?col:' #2a3a3a'};
    background:${_K.chartMode===mode?col+'22':'transparent'};
    color:${_K.chartMode===mode?col:'#555'};">${label}</button>`;

  // Monats-Zoom: Profil slicen wenn aktiv (nur für zeitreihe + heatmap)
  const canZoom  = (_K.chartMode==='zeitreihe'||_K.chartMode==='heatmap');
  const zm       = canZoom ? _K.zoomMonth : null;
  const dispProf = (zm!==null)
    ? prof.slice(MSTART[zm], MSTART[zm] + MDAYS[zm]*24)
    : prof;

  // Monats-Zoom Buttons (nur bei zeitreihe/heatmap)
  const mShort = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const mZoomRow = canZoom ? `
    <div style="display:flex;gap:2px;margin-top:4px;flex-wrap:wrap;">
      <button onclick="knaSetZoomMonth(null)"
        style="padding:2px 6px;border-radius:3px;cursor:pointer;font-size:9px;
        border:1px solid ${zm===null?'#4fc3f7':'#2a3a3a'};
        background:${zm===null?'rgba(79,195,247,.12)':'transparent'};
        color:${zm===null?'#4fc3f7':'#555'};">Jahr</button>
      ${mShort.map((l,i)=>`<button onclick="knaSetZoomMonth(${i})"
        style="padding:2px 5px;border-radius:3px;cursor:pointer;font-size:9px;
        border:1px solid ${zm===i?col:'#2a3a3a'};
        background:${zm===i?col+'22':'transparent'};
        color:${zm===i?col:'#555'};">${l}</button>`).join('')}
    </div>` : '';

  top.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;
          border-left:3px solid ${cfg.color||'#888'};background:rgba(255,255,255,.03);border-radius:0 4px 4px 0;">
          <span style="font-size:18px;">${cfg.icon||'?'}</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:#e0e0e0;">${asset.name}</div>
            <div style="font-size:10px;color:#555;">${cfg.label||asset.type}
              ${asset.buildingId&&window.gebaeude?' · '+(window.gebaeude.find(g=>g.id===asset.buildingId)?.name||''):''}
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
        ${tabBtn('z','Jahreslastgang','zeitreihe')}
        ${tabBtn('d','Jahresdauerlinie','dauerlinie')}
        ${tabBtn('m','Monatsprofil','monat')}
        ${tabBtn('h','Heatmap','heatmap')}
        <button onclick="knaOpenFullscreen()" title="Vollbild"
          style="padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px;
          border:1px solid #2a3a3a;background:transparent;color:#555;margin-left:4px;"
          onmouseover="this.style.color='#ccc'" onmouseout="this.style.color='#555'">⛶</button>
      </div>
    </div>
    ${mZoomRow}
    ${noData?`<div style="display:flex;align-items:center;justify-content:center;flex:1;color:#444;font-size:11px;margin-top:8px;">
      ℹ Noch keine Profildaten — bitte Strom-Berechnung und Dispatch ausführen.</div>`
    :`<canvas id="kna-canvas" style="flex:1;width:100%;min-height:0;border-radius:4px;background:#111;margin-top:4px;"></canvas>`}`;

  // Kapazitäts-Auslastung — beide Richtungen
  let h100=0, h80=0, h100neg=0, h80neg=0;
  if (capacityKW>0) {
    for (let t=0;t<prof.length;t++) {
      const v=prof[t];
      if      (v>=capacityKW)       h100++;
      else if (v>=capacityKW*0.8)   h80++;
      if      (v<=-capacityKW)      h100neg++;
      else if (v<=-capacityKW*0.8)  h80neg++;
    }
  }
  const auslastPct    = capacityKW>0 && stats.peak>0      ? (stats.peak/capacityKW*100)       : null;
  const auslastNegPct = capacityKW>0 && stats.minV<-0.1   ? (-stats.minV/capacityKW*100)       : null;

  // KPI-Grid
  const kpis=[
    [col,  isGen?'Jahreserzeugung':isInf?'Jahresenergie':'Jahresverbrauch', fmtMwh(Math.abs(stats.annualMwh))],
    ['#ef5350', isGen?'Einspeise-Spitze':'Bezugs-Spitze', fmtKw(stats.peak)],
    ['#80cbc4', 'Grundlast (90%)',   fmtKw(stats.grundlast)],
    ['#ffa726', 'Vollbenutzungsstd', Math.round(stats.vbh).toLocaleString('de-DE')+' h/a'],
    ['#ce93d8', 'Lastfaktor',        (stats.lastfaktor*100).toFixed(1)+' %'],
  ];
  if (stats.minV<-0.1) kpis.push(['#4fc3f7','Einspeisung Spitze',fmtKw(-stats.minV)]);

  // Kapazitäts-KPIs für Netzobjekte (Trafo, UV, NSHV)
  if (isInf) {
    if (capacityKW>0) {
      const acPos = (auslastPct||0)>100?'#ef5350':(auslastPct||0)>80?'#ff9800':'#4caf50';
      const acNeg = (auslastNegPct||0)>100?'#ef5350':(auslastNegPct||0)>80?'#ff9800':'#4fc3f7';
      kpis.push(['#78909c', 'Nennleistung', fmtKw(capacityKW)]);
      kpis.push([acPos, '↑ Bezug-Auslas.',  (auslastPct||0).toFixed(1)+' %']);
      if (auslastNegPct!==null)
        kpis.push([acNeg, '↓ Einsp.-Auslas.',(auslastNegPct||0).toFixed(1)+' %']);
      if (h100>0)    kpis.push(['#ef5350','↑ > 100% Überl.',   h100.toLocaleString('de-DE')+' h/a']);
      if (h80>0)     kpis.push(['#ff9800','↑ > 80% Auslas.',   (h80+h100).toLocaleString('de-DE')+' h/a']);
      if (h100neg>0) kpis.push(['#ef5350','↓ > 100% Einsp.',   h100neg.toLocaleString('de-DE')+' h/a']);
      if (h80neg>0)  kpis.push(['#ff9800','↓ > 80% Einsp.',    (h80neg+h100neg).toLocaleString('de-DE')+' h/a']);
    } else {
      kpis.push(['#444','Nennleistung', 'nicht konfiguriert']);
    }
  }

  // Warnbanner (beide Richtungen)
  const warnParts = [];
  if (capacityKW>0) {
    if (h100>0)    warnParts.push(`⚠ Bezug > 100% (${Math.round(capacityKW)} kW): <b>${h100} h/a</b>`);
    else if(h80>0) warnParts.push(`⚠ Bezug > 80% (${Math.round(capacityKW*0.8)} kW): <b>${(h80+h100).toLocaleString('de-DE')} h/a</b>`);
    if (h100neg>0)    warnParts.push(`⚠ Einspeisung > 100% (-${Math.round(capacityKW)} kW): <b>${h100neg} h/a</b>`);
    else if(h80neg>0) warnParts.push(`⚠ Einspeisung > 80% (-${Math.round(capacityKW*0.8)} kW): <b>${(h80neg+h100neg).toLocaleString('de-DE')} h/a</b>`);
  }
  const hasOverload = h100>0||h100neg>0;
  const warn = warnParts.length>0
    ? `<div style="background:${hasOverload?'rgba(239,83,80,.1)':'rgba(255,152,0,.08)'};
        border:1px solid ${hasOverload?'rgba(239,83,80,.35)':'rgba(255,152,0,.3)'};
        border-radius:4px;padding:5px 10px;margin-top:8px;font-size:10px;
        color:${hasOverload?'#ef9a9a':'#ff9800'};">
        ${warnParts.join('<br>')}
       </div>`
    : '';

  bot.innerHTML=`
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:8px;">Kennzahlen</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;">
      ${kpis.map(([c,l,v])=>`
        <div style="background:#1e1e30;border-radius:5px;padding:8px 10px;">
          <div style="font-size:9px;color:#555;margin-bottom:2px;">${l}</div>
          <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:700;color:${c};">${v}</div>
        </div>`).join('')}
    </div>${warn}`;

  // Rechten Drawer aktualisieren falls geöffnet
  if (_K.showContribs) _renderRightPanel();

  // Chart zeichnen + Hover anhängen
  if (!noData) {
    requestAnimationFrame(()=>{
      const cv=document.getElementById('kna-canvas');
      if (!cv) return;
      switch (_K.chartMode) {
        case 'dauerlinie': _drawDauerlinie(cv, prof,     col); break;
        case 'monat':      _drawMonat(cv,     prof,     col); break;
        case 'heatmap':    _drawHeatmap(cv,   dispProf, col, zm); break;
        default:           _drawZeitReihe(cv, dispProf, col, zm); break;
      }
      if (capacityKW > 0) _overlayCapacityLines(cv, dispProf, capacityKW, _K.chartMode);
      _attachHover(cv, dispProf, _K.chartMode, zm);
    });
  }
}

// ── Öffentliche Setter ────────────────────────────────────────────────────────

export function knaSelectNode(id) {
  if (id !== _K.selectedId) _K.disabledContribs.clear(); // Reset beim Knotenwechsel
  _K.selectedId=id;
  _renderSidebar();
  _renderMain();
}

export function knaToggleRightPanel() {
  _K.showContribs = !_K.showContribs;
  const panel = document.getElementById('kna-right-panel');
  const btn   = document.getElementById('kna-right-btn');
  if (panel) panel.style.width = _K.showContribs ? '260px' : '0';
  if (btn)   btn.textContent   = _K.showContribs ? '▶ Beiträge' : '◀ Beiträge';
  if (_K.showContribs) _renderRightPanel();
}

export function knaToggleContrib(assetId) {
  if (_K.disabledContribs.has(assetId)) _K.disabledContribs.delete(assetId);
  else                                   _K.disabledContribs.add(assetId);
  _renderMain();
}

/** Aktiviert nur Bezugs-Assets (load) oder nur Einspeise-Assets (gen), deaktiviert den Rest */
export function knaEnableOnlyType(type) {
  const asset = getAsset(_K.selectedId);
  if (!asset) return;
  const leaves = _bfsDownstream(asset.id);
  _K.disabledContribs.clear();
  for (const { asset: da, sign } of leaves) {
    const isLoad = sign > 0;
    if (type === 'load' && !isLoad) _K.disabledContribs.add(da.id);
    if (type === 'gen'  &&  isLoad) _K.disabledContribs.add(da.id);
  }
  _renderMain();
}

export function knaToggleAllContribs(allEnabled) {
  if (allEnabled) {
    _K.disabledContribs.clear();
  } else {
    const asset = getAsset(_K.selectedId);
    if (asset) _bfsDownstream(asset.id).forEach(({asset:da}) => _K.disabledContribs.add(da.id));
  }
  _renderMain();
}

export function knaSetChartMode(mode) {
  _K.chartMode=mode;
  _renderMain();
}

export function knaSetTypeFilter(val) {
  _K.typeFilter = val;
  _renderSidebar();
}

export function knaSetZoomMonth(m) {
  _K.zoomMonth = (m === null || m === undefined) ? null : parseInt(m);
  _renderMain();
}

export function knaOpenFullscreen() {
  const srcCv = document.getElementById('kna-canvas');
  if (!srcCv) return;

  // Overlay erstellen
  const ov = document.createElement('div');
  ov.id = 'kna-fs-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a14;z-index:9900;display:flex;flex-direction:column;';
  ov.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:#0d0d18;">
      <span style="font-size:12px;color:#aaa;" id="kna-fs-title">Vollbild</span>
      <button onclick="document.getElementById('kna-fs-overlay').remove()"
        style="background:none;border:1px solid #333;border-radius:4px;color:#888;
        cursor:pointer;font-size:14px;padding:3px 10px;">✕ Schließen</button>
    </div>
    <canvas id="kna-fs-canvas" style="flex:1;width:100%;"></canvas>`;
  document.body.appendChild(ov);

  // Canvas zeichnen
  const asset = _K.selectedId ? getAsset(_K.selectedId) : null;
  const col   = asset ? _profileColor(asset) : '#4fc3f7';
  const zm    = (_K.chartMode==='zeitreihe'||_K.chartMode==='heatmap') ? _K.zoomMonth : null;

  const fsCv = document.getElementById('kna-fs-canvas');
  if (!fsCv) return;

  requestAnimationFrame(() => {
    const prof = _K.selectedId ? _getActiveProfile(getAsset(_K.selectedId)) : new Float32Array(8760);
    const dp   = zm!==null ? prof.slice(MSTART[zm], MSTART[zm]+MDAYS[zm]*24) : prof;

    switch (_K.chartMode) {
      case 'dauerlinie': _drawDauerlinie(fsCv, prof, col); break;
      case 'monat':      _drawMonat(fsCv,     prof, col); break;
      case 'heatmap':    _drawHeatmap(fsCv,   dp,   col, zm); break;
      default:           _drawZeitReihe(fsCv, dp,   col, zm); break;
    }
    const capKW = asset ? _getCapacityKW(asset) : 0;
    if (capKW>0) _overlayCapacityLines(fsCv, dp, capKW, _K.chartMode);
    _attachHover(fsCv, dp, _K.chartMode, zm);

    const titleEl = document.getElementById('kna-fs-title');
    if (titleEl && asset) titleEl.textContent = `${asset.name} · ${ASSET_CFG[asset.type]?.label||asset.type}`;
  });

  // ESC schließt
  ov.addEventListener('keydown', e => { if(e.key==='Escape') ov.remove(); });
  ov.tabIndex = 0; ov.focus();
}

export function knaSetFilter(val) {
  _K.filter=val;
  _renderSidebar();
}

// ── Panel-Injection (identisch zu napBuildAnalyseSection) ─────────────────────

export function knaBuildAnalyseSection() {
  // Tab-Button einfügen (idempotent)
  const tabBar=document.getElementById('analyse-view-tabs');
  if (tabBar&&!tabBar.querySelector('[data-section="kna"]')) {
    const btn=document.createElement('button');
    btn.className='analyse-section-tab';
    btn.dataset.section='kna';
    btn.textContent='Knotenpunkt-Analyse';
    btn.addEventListener('click',()=>{ if (typeof window.setAnalyseSection==='function') window.setAnalyseSection('kna'); });
    tabBar.appendChild(btn);
  }

  // Content-Div einfügen (idempotent)
  if (!document.getElementById('analyse-kna-wrap')) {
    const wrap=document.createElement('div');
    wrap.id='analyse-kna-wrap';
    wrap.style.display='none';
    wrap.innerHTML=`
<div style="display:flex;flex-direction:row;height:calc(100vh - 160px);min-height:400px;background:#0f0f1a;border-radius:8px;overflow:hidden;">
  <!-- Sidebar (Knotenliste) -->
  <div id="kna-sidebar" style="width:280px;overflow-y:auto;flex-shrink:0;border-right:1px solid rgba(79,195,247,.12);background:#0f0f1a;"></div>
  <!-- Hauptbereich (Chart + KPIs) -->
  <div style="flex:1;display:flex;flex-direction:column;min-width:0;background:#0f0f1a;">
    <div id="kna-main-top" style="flex:3;display:flex;flex-direction:column;padding:12px 16px 6px;min-height:0;overflow:hidden;"></div>
    <div id="kna-main-bot" style="flex:1;padding:6px 16px 12px;border-top:1px solid rgba(79,195,247,.08);overflow-y:auto;"></div>
  </div>
  <!-- Drawer-Toggle (immer sichtbar) -->
  <button id="kna-right-btn" onclick="knaToggleRightPanel()"
    style="width:22px;flex-shrink:0;background:#0d0d18;border:none;
    border-left:1px solid rgba(79,195,247,.15);cursor:pointer;color:#555;
    font-size:9px;writing-mode:vertical-rl;text-orientation:mixed;
    display:flex;align-items:center;justify-content:center;padding:10px 0;
    transition:color .15s;letter-spacing:.05em;"
    onmouseover="this.style.color='#4fc3f7'"
    onmouseout="this.style.color='#555'">◀ Beiträge</button>
  <!-- Rechter Drawer (Beitragsliste) -->
  <div id="kna-right-panel"
    style="width:0;overflow:hidden;flex-shrink:0;
    border-left:1px solid rgba(79,195,247,.12);background:#0d0d18;
    transition:width .18s ease;display:flex;flex-direction:column;"></div>
</div>`;
    const analyseView=document.getElementById('center-analyse-view');
    if (analyseView) analyseView.appendChild(wrap);
  }
}

export function knaShowSection(visible) {
  const wrap=document.getElementById('analyse-kna-wrap');
  if (!wrap) return;
  wrap.style.display=visible?'':'none';
  if (visible) {
    invalidateKnotenProfileCache();
    _renderSidebar();
    _renderMain();
  }
}

// ── Navigation aus Elektro-Panel ──────────────────────────────────────────────

export function openKnotenanalyse() {
  if (typeof window.setViewMode==='function') window.setViewMode('analyse');
  setTimeout(()=>{
    if (typeof window.setAnalyseSection==='function') window.setAnalyseSection('kna');
  }, 60);
}

/** Navigiert direkt zur Knotenanalyse und wählt das Asset vor. */
export function openKnotenanalyseFor(assetId) {
  _K.selectedId = assetId; // vor dem Render setzen → wird sofort angezeigt
  if (typeof window.setViewMode==='function') window.setViewMode('analyse');
  setTimeout(()=>{
    if (typeof window.setAnalyseSection==='function') window.setAnalyseSection('kna');
  }, 60);
}

// Für data-click Inline-Handler
if (typeof window!=='undefined') {
  window.openKnotenanalyse    = openKnotenanalyse;
  window.openKnotenanalyseFor = openKnotenanalyseFor;
  window.knaSelectNode        = knaSelectNode;
  window.knaSetChartMode      = knaSetChartMode;
  window.knaSetFilter         = knaSetFilter;
  window.knaToggleContrib     = knaToggleContrib;
  window.knaToggleAllContribs = knaToggleAllContribs;
  window.knaEnableOnlyType    = knaEnableOnlyType;
  window.knaToggleRightPanel  = knaToggleRightPanel;
  window.knaSetTypeFilter     = knaSetTypeFilter;
  window.knaSetZoomMonth      = knaSetZoomMonth;
  window.knaOpenFullscreen    = knaOpenFullscreen;
}

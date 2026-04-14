// NUTZUNG_DEFAULTS → src/config/erzeuger-cfg.js

function setNutzung(id, nutzung) {
  const g = gebaeude.find(x => x.id === id);
  if (!g) return;
  g.nutzung = nutzung;
  _invalidateStats();
  const def = NUTZUNG_DEFAULTS[nutzung];
  if (def && !g.spez && !g.waerme) {
    // Only prefill if fields are empty
    g.spez = def.spez;
    const elSpez = document.querySelector(`[data-spez="${id}"]`);
    if (elSpez) { elSpez.value = def.spez; elSpez.style.color = '#f9a825'; }
    if (g.flaeche) {
      const nf = g.flaeche * (g.stockwerke || 1) * 0.8;
      g.waerme = Math.round(def.spez * nf / 1000 * 10) / 10;
      const elW = document.querySelector(`[data-waerme="${id}"]`);
      if (elW) { elW.value = g.waerme; elW.style.color = '#f9a825'; }
    }
    if (!g.spezHeizlast) {
      g.spezHeizlast = def.spezHL;
      const elHL = document.querySelector(`[data-spezhl="${id}"]`);
      if (elHL) { elHL.value = def.spezHL; elHL.style.color = '#f9a825'; }
      if (g.flaeche) {
        const nf = g.flaeche * (g.stockwerke || 1) * 0.8;
        g.heizlast = Math.round(def.spezHL * nf / 1000 * 10) / 10;
        const elH = document.querySelector(`[data-heizlast="${id}"]`);
        if (elH) { elH.value = g.heizlast; elH.style.color = '#f9a825'; }
      }
    }
  }
  updateViz(); updateTotals();
}

// ── Gebäude-Auswahl & Massenbearbeitung ──────────────────────────────
function toggleSelect(id, checked) {
  const g = gebaeude.find(x => x.id === id);
  if (g) g.selected = checked;
  updateBulkBar();
}

function updateBulkBar() {
  const sel = gebaeude.filter(g => g.selected);
  const bar = document.getElementById('bulk-bar');
  const lbl = document.getElementById('bulk-lbl');
  if (sel.length > 0) {
    bar.classList.add('visible');
    lbl.textContent = sel.length + ' ausgewählt';
  } else {
    bar.classList.remove('visible');
  }
}

function applyBulk() {
  const spez   = document.getElementById('bulk-spez').value;
  const waerme = document.getElementById('bulk-waerme').value;
  const hl     = document.getElementById('bulk-hl').value;
  gebaeude.filter(g => g.selected).forEach(g => {
    if (spez) {
      g.spez = parseFloat(spez);
      if (g.flaeche) g.waerme = Math.round(g.flaeche * parseFloat(spez) / 1000 * 10) / 10;
    } else if (waerme) {
      g.waerme = parseFloat(waerme);
      if (g.flaeche) g.spez = Math.round(g.waerme * 1000 / g.flaeche * 10) / 10;
    }
    if (hl) {
      g.heizlast = parseFloat(hl);
      if (g.flaeche) g.spezHeizlast = Math.round(g.heizlast * 1000 / g.flaeche * 10) / 10;
    }
  });
  document.getElementById('bulk-spez').value = '';
  document.getElementById('bulk-waerme').value = '';
  document.getElementById('bulk-hl').value = '';
  renderList(); updateViz(); updateTotals(); recalcNetz();
}

function clearSelection() {
  gebaeude.forEach(g => g.selected = false);
  renderList();
  updateBulkBar();
}

// ── Gebäude-Filter ────────────────────────────────────────────────────
let filterText = '';
function filterList(val) {
  filterText = val.toLowerCase().trim();
  const cards = document.querySelectorAll('#geb-list .geb-card');
  cards.forEach(card => {
    const id = parseInt(card.id.replace('card-', ''));
    const g = gebaeude.find(x => x.id === id);
    if (!g) return;
    const match = !filterText
      || g.name.toLowerCase().includes(filterText)
      || (g.nutzung && NUTZUNG_DEFAULTS[g.nutzung]?.label.toLowerCase().includes(filterText));
    card.style.display = match ? '' : 'none';
  });
}

// ── Adresssuche (Nominatim) ───────────────────────────────────────────
let addrDebounce = null;
let addrSelected = -1;

function addrSearch(val) {
  clearTimeout(addrDebounce);
  const res = document.getElementById('addr-results');
  if (!val || val.length < 3) { res.classList.remove('open'); return; }
  addrDebounce = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(val)}`;
      const data = await fetch(url, {headers:{'Accept-Language':'de'}}).then(r => r.json());
      res.innerHTML = '';
      if (!data.length) {
        res.innerHTML = '<div class="addr-result-item" style="color:var(--muted)">Keine Ergebnisse</div>';
      } else {
        data.forEach((item, i) => {
          const div = document.createElement('div');
          div.className = 'addr-result-item';
          div.textContent = item.display_name;
          div.dataset.lat = item.lat;
          div.dataset.lon = item.lon;
          div.addEventListener('click', () => selectAddr(item));
          res.appendChild(div);
        });
      }
      addrSelected = -1;
      res.classList.add('open');
    } catch(e) { console.error(e); }
  }, 350);
}

function selectAddr(item) {
  map.flyTo([parseFloat(item.lat), parseFloat(item.lon)], 17, {duration: 1.2});
  // Show a brief pulse marker
  const m = L.circleMarker([parseFloat(item.lat), parseFloat(item.lon)], {
    radius: 10, color: 'var(--accent)', fillColor: '#4fc3f7', fillOpacity: 0.5, weight: 2
  }).addTo(map);
  setTimeout(() => map.removeLayer(m), 3000);
  document.getElementById('addr-input').value = item.display_name.split(',')[0];
  document.getElementById('addr-results').classList.remove('open');
}

function addrKeydown(e) {
  const res = document.getElementById('addr-results');
  const items = res.querySelectorAll('.addr-result-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    addrSelected = Math.min(addrSelected + 1, items.length - 1);
    items.forEach((el, i) => el.style.background = i === addrSelected ? 'var(--surface2)' : '');
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    addrSelected = Math.max(addrSelected - 1, 0);
    items.forEach((el, i) => el.style.background = i === addrSelected ? 'var(--surface2)' : '');
    e.preventDefault();
  } else if (e.key === 'Enter' && addrSelected >= 0) {
    items[addrSelected].click();
  } else if (e.key === 'Escape') {
    res.classList.remove('open');
  }
}

// Close addr dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.addr-search-wrap')) {
    document.getElementById('addr-results').classList.remove('open');
  }
});

// ── Autosave (LocalStorage) ───────────────────────────────────────────
function autosave() {
  try {
    localStorage.setItem('energiekarte_autosave', JSON.stringify(_buildProjectData()));
  } catch(e) {}
}
setInterval(autosave, 30000);

// Restore autosave on load if no manual project loaded
function tryRestoreAutosave() {
  try {
    const raw = localStorage.getItem('energiekarte_autosave');
    if (!raw) return;
    const project = JSON.parse(raw);
    if (!project.gebaeude || !project.gebaeude.length) return;
    const hint = document.getElementById('hint');
    hint.innerHTML = 'Autosave gefunden. <span style="color:var(--accent);cursor:pointer;text-decoration:underline" onclick="loadAutosave()">Wiederherstellen?</span> <span style="color:var(--muted);cursor:pointer;margin-left:8px;" onclick="document.getElementById(\'hint\').classList.add(\'hidden\');document.getElementById(\'hint\').style.pointerEvents=\'\';">✕</span>';
    hint.classList.remove('hidden');
    hint.style.pointerEvents = 'auto';
  } catch(e) {}
}

function loadAutosave() {
  const raw = localStorage.getItem('energiekarte_autosave');
  if (!raw) return;
  try {
    _loadProject(JSON.parse(raw));
    showHint('✓ Autosave wiederhergestellt.');
    setTimeout(hideHint, 3000);
  } catch(e) { showHint('Fehler beim Wiederherstellen.'); console.error(e); }
}



// ── OSM Straßentyp → Kostenklasse ────────────────────────────────────
const HIGHWAY_KOSTEN = {
  motorway:'hoch', trunk:'hoch', primary:'hoch', secondary:'hoch',
  tertiary:'mittel', residential:'mittel', living_street:'mittel',
  service:'niedrig', track:'niedrig', path:'niedrig', footway:'niedrig',
  cycleway:'niedrig', pedestrian:'niedrig', unclassified:'mittel',
};

async function queryOsmRoadType(latA, lngA, latB, lngB) {
  // Find the OSM way closest to the midpoint of the edge
  const midLat = (latA + latB) / 2;
  const midLng = (lngA + lngB) / 2;
  const delta = 0.0003;
  const bbox = `${midLat-delta},${midLng-delta},${midLat+delta},${midLng+delta}`;
  const q = `[out:json][timeout:5];way["highway"](${bbox});out tags 1;`;
  try {
    const d = await _overpassFetchWithRetry(q, null, 2);
    if (d && d.elements && d.elements.length > 0) {
      const hw = d.elements[0].tags?.highway || '';
      return HIGHWAY_KOSTEN[hw] || 'mittel';
    }
  } catch(e) {}
  return 'mittel';
}

async function autoAssignEdgeCosts() {
  // Called after autoGenerateNetz — queries road type for each edge in background
  for (const e of netzEdges) {
    if (e.kostOverride) continue; // don't overwrite manual settings
    const uPt = e.uNode?.pt;
    const vPt = e.vNode?.pt;
    if (!uPt || !vPt) continue;
    const klass = await queryOsmRoadType(uPt.lat, uPt.lng, vPt.lat, vPt.lng);
    e.kostKlasse = klass;
  }
  updateRohrListe();
}

// ── Edge popup ────────────────────────────────────────────────────────
let activeEdgePopup = null;

function showEdgePopup(e, mouseEvt) {
  const popup = document.getElementById('edge-popup');
  if (!popup) return;
  activeEdgePopup = e;

  const dnOptions = [0, 15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500,600,700,800]
    .map(dn => `<option value="${dn}" ${e.dn===dn?'selected':''}>${dn===0?'Auto':'DN '+dn}</option>`)
    .join('');

  const kostKlasse = e.kostKlasse || 'mittel';
  const kostAuto   = !e.kostOverride;

  popup.innerHTML = `
    <div class="edge-popup-title">
      <span style="color:var(--accent)">⛕ Leitungsabschnitt</span>
      <span class="edge-popup-close" onclick="closeEdgePopup()">✕</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <div>
        <div class="inp-label" style="margin-bottom:3px">Durchmesser</div>
        <select onchange="setEdgeDN(this.value)">${dnOptions}</select>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">${e.dn===0||!e.dn?'Auto: DN '+e.dn:'Manuell: DN '+e.dn}</div>
      </div>
      <div>
        <div class="inp-label" style="margin-bottom:3px">Kostenklasse</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;">
          <span class="cost-badge niedrig ${kostKlasse==='niedrig'?'':''}${kostAuto&&kostKlasse==='niedrig'?' auto':''}" 
            onclick="setEdgeKost('niedrig')" style="${kostKlasse==='niedrig'?'opacity:1':'opacity:.45'}">Niedrig</span>
          <span class="cost-badge mittel"
            onclick="setEdgeKost('mittel')" style="${kostKlasse==='mittel'?'opacity:1':'opacity:.45'}">Mittel</span>
          <span class="cost-badge hoch"
            onclick="setEdgeKost('hoch')" style="${kostKlasse==='hoch'?'opacity:1':'opacity:.45'}">Hoch</span>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:3px">${kostAuto?'🔄 Auto (OSM)':'✏️ Manuell'}</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--muted);border-top:1px solid var(--border);padding-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:3px;">
      <span>Last: <span style="color:var(--text)">${(e.load||0).toFixed(1)} kW</span>${e._gzf < 1 ? ` <span style="color:var(--muted);font-size:9px">(GZF ${e._gzf.toFixed(2)})</span>` : ''}</span>
      <span>Länge: <span style="color:var(--text)">${Math.round(e.length||0)} m</span></span>
      <span>WLD: <span style="color:${getWLDColor(getWLD(e))}">${getWLD(e).toFixed(2)} MWh/(m·a)</span></span>
      <span>Kosten: <span style="color:#4fc3f7">${Math.round((getKostenProMKlasse(e.dn, e.kostKlasse||'mittel'))*(e.length||0)).toLocaleString('de-DE')} €</span></span>
    </div>
    <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;">
      <button onclick="toggleEdgePruned()" style="width:100%;padding:5px 8px;background:${e.pruned?'#1b3a2a':'rgba(249,168,37,0.12)'};border:1px solid ${e.pruned?'#4caf50':'#f9a825'};border-radius:4px;color:${e.pruned?'#4caf50':'#f9a825'};cursor:pointer;font-size:10px;font-family:'DM Mono',monospace;">
        ${e.pruned?'✓ Wieder anschließen':'✂ Abschnitt deaktivieren'}
      </button>
    </div>`;

  // Position near mouse, clamped to viewport
  const rect = document.getElementById('map').getBoundingClientRect();
  let px = mouseEvt.clientX - rect.left + 12;
  let py = mouseEvt.clientY - rect.top + 12;
  popup.style.display = 'block';
  const pw = popup.offsetWidth || 240;
  const ph = popup.offsetHeight || 160;
  if (px + pw > rect.width  - 10) px = mouseEvt.clientX - rect.left - pw - 12;
  if (py + ph > rect.height - 10) py = mouseEvt.clientY - rect.top  - ph - 12;
  popup.style.left = px + 'px';
  popup.style.top  = py + 'px';
}

function closeEdgePopup() {
  const p = document.getElementById('edge-popup');
  if (p) p.style.display = 'none';
  activeEdgePopup = null;
}

function setEdgeDN(val) {
  if (!activeEdgePopup) return;
  const dn = parseInt(val);
  activeEdgePopup.dnOverride = dn > 0;
  activeEdgePopup.dn = dn > 0 ? dn : 0;
  networkLocked = activeEdgePopup.dnOverride; // auto-lock when DN set manually
  recalcNetz();
  if (activeEdgePopup) showEdgePopup(activeEdgePopup, {
    clientX: parseInt(document.getElementById('edge-popup').style.left) + document.getElementById('map').getBoundingClientRect().left,
    clientY: parseInt(document.getElementById('edge-popup').style.top)  + document.getElementById('map').getBoundingClientRect().top,
  });
}

function setEdgeKost(klass) {
  if (!activeEdgePopup) return;
  activeEdgePopup.kostKlasse = klass;
  activeEdgePopup.kostOverride = true;
  recalcNetz();
  // Re-render popup in place
  const p = document.getElementById('edge-popup');
  const px = p.style.left; const py = p.style.top;
  showEdgePopup(activeEdgePopup, {
    clientX: parseInt(px) + document.getElementById('map').getBoundingClientRect().left,
    clientY: parseInt(py) + document.getElementById('map').getBoundingClientRect().top,
  });
  document.getElementById('edge-popup').style.left = px;
  document.getElementById('edge-popup').style.top  = py;
}

// ── Netz-Pruning ──────────────────────────────────────────────────────────
function togglePruningMode() {
  netzPruningMode = !netzPruningMode;
  const btn = document.getElementById('btn-pruning-mode');
  const info = document.getElementById('pruning-info');
  if (btn) {
    btn.textContent = netzPruningMode ? '✂ Pruning-Modus: An' : '✂ Pruning-Modus: Aus';
    btn.style.borderColor = netzPruningMode ? '#f9a825' : 'var(--border)';
    btn.style.color = netzPruningMode ? '#f9a825' : '';
    btn.style.background = netzPruningMode ? 'rgba(249,168,37,0.08)' : '';
  }
  if (info) info.style.display = netzPruningMode ? 'block' : 'none';
  const lpBtn = document.getElementById('lp-btn-pruning');
  if (lpBtn) {
    lpBtn.style.borderColor = netzPruningMode ? '#f9a825' : 'var(--border)';
    lpBtn.style.color = netzPruningMode ? '#f9a825' : '';
    lpBtn.textContent = netzPruningMode ? '✂ Pruning (aktiv)' : '✂ Pruning';
  }
  updatePruningSummary();
}

function toggleEdgePruned(edge) {
  const e = edge || activeEdgePopup;
  if (!e) return;
  e.pruned = !e.pruned;
  applyEdgePrunedStyle(e);
  // Also prune downstream subtree if this edge is pruned
  if (e.pruned) pruneSubtree(e); else unpruneSubtree(e);
  recalcNetz();
  updatePruningSummary();
  // Re-render popup in place if visible
  if (activeEdgePopup === e) {
    const p = document.getElementById('edge-popup');
    if (p && p.style.display !== 'none') {
      const px = p.style.left; const py = p.style.top;
      showEdgePopup(e, {
        clientX: parseInt(px) + document.getElementById('map').getBoundingClientRect().left,
        clientY: parseInt(py) + document.getElementById('map').getBoundingClientRect().top,
      });
      p.style.left = px; p.style.top = py;
    }
  }
}

function applyEdgePrunedStyle(e) {
  if (!e || !e.layer) return;
  if (e.pruned) {
    e.layer.setStyle({ dashArray: '8 6', opacity: 0.3, color: '#78909c' });
  } else {
    e.layer.setStyle({ dashArray: null, opacity: 0.8 });
    // Color will be restored by recalcNetz → updateNetzColors
  }
}

function pruneSubtree(edge) {
  // Find which direction is "downstream" from zentrale and prune all edges in subtree
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId) return;
  const downstream = getDownstreamNodeId(edge, zId);
  if (downstream == null) return;
  const visited = new Set([downstream]);
  const queue = [downstream];
  while (queue.length > 0) {
    const curr = queue.shift();
    netzEdges.forEach(e => {
      if (e === edge || e.pruned) return;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        e.pruned = true;
        applyEdgePrunedStyle(e);
        queue.push(other);
      }
    });
  }
}

function unpruneSubtree(edge) {
  // Unprune all edges downstream of this edge
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId) return;
  const downstream = getDownstreamNodeId(edge, zId);
  if (downstream == null) return;
  const visited = new Set([downstream]);
  const queue = [downstream];
  while (queue.length > 0) {
    const curr = queue.shift();
    netzEdges.forEach(e => {
      if (e === edge) return;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        e.pruned = false;
        applyEdgePrunedStyle(e);
        queue.push(other);
      }
    });
  }
}

function getDownstreamNodeId(edge, zentraleId) {
  // BFS from zentrale to determine which side of the edge is downstream
  const visited = new Set([zentraleId]);
  const queue = [zentraleId];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const e of netzEdges) {
      if (e === edge || e.pruned) continue;
      const other = e.u === curr ? e.v : (e.v === curr ? e.u : null);
      if (other != null && !visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  // The node NOT reachable without this edge is downstream
  if (!visited.has(edge.u) && visited.has(edge.v)) return edge.u;
  if (!visited.has(edge.v) && visited.has(edge.u)) return edge.v;
  // If both reachable (cycle), pick the one further from zentrale
  return edge.v === zentraleId ? edge.u : edge.v;
}

function updatePruningSummary() {
  const div = document.getElementById('pruning-summary');
  if (!div) return;
  const prunedEdges = netzEdges.filter(e => e.pruned);
  if (prunedEdges.length === 0) { div.style.display = 'none'; return; }
  div.style.display = 'block';
  const prunedLen = prunedEdges.reduce((s, e) => s + (e.length || 0), 0);
  const prunedGebIds = new Set();
  prunedEdges.forEach(e => { prunedGebIds.add(e.u); prunedGebIds.add(e.v); });
  // Remove nodes still connected via active edges
  const activeGebIds = new Set();
  netzEdges.filter(e => !e.pruned).forEach(e => { activeGebIds.add(e.u); activeGebIds.add(e.v); });
  const disconnected = [...prunedGebIds].filter(id => !activeGebIds.has(id));
  const disconnectedMWh = disconnected.reduce((s, id) => {
    const g = gebaeude.find(x => x.id === id);
    return s + (g ? (parseFloat(g.waerme) || 0) : 0);
  }, 0);
  div.innerHTML = `
    <div style="color:#f9a825;font-weight:bold;margin-bottom:3px;">✂ Pruning aktiv</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;">
      <span style="color:var(--muted)">Deaktiviert:</span><span>${prunedEdges.length} Abschnitte (${Math.round(prunedLen)} m)</span>
      <span style="color:var(--muted)">Abgeklemmt:</span><span>${disconnected.length} Gebäude (${disconnectedMWh.toFixed(0)} MWh/a)</span>
    </div>
    <button onclick="clearAllPruning()" style="margin-top:5px;width:100%;padding:3px 6px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--muted);cursor:pointer;font-size:9px;font-family:'DM Mono',monospace;">Pruning aufheben</button>`;
}

function clearAllPruning() {
  netzEdges.forEach(e => { e.pruned = false; applyEdgePrunedStyle(e); });
  recalcNetz();
  updatePruningSummary();
}

// Close popup when clicking elsewhere on map
document.addEventListener('click', ev => {
  if (!ev.target.closest('#edge-popup') && !ev.target.closest('.leaflet-interactive')) {
    closeEdgePopup();
  }
});

function getKostenProMKlasse(dn, klass) {
  const row = KMR_KOSTEN[dn];
  if (!row) return 0;
  return row[{niedrig:0,mittel:1,hoch:2}[klass]??1];
}

// ── Print legend update ───────────────────────────────────────────────
function updatePrintLegend() {
  const tw = document.getElementById('tot-waerme')?.textContent || '—';
  const thl = document.getElementById('tot-hl')?.textContent || '—';
  const n  = gebaeude.length;
  const mode = {waerme:'Wärmeverbrauch',spez:'Spez. Verbrauch',heizlast:'Heizlast'}[currentMode];
  const el = id => document.getElementById(id);
  if(el('print-tot-w'))   el('print-tot-w').textContent   = tw;
  if(el('print-tot-hl'))  el('print-tot-hl').textContent  = thl;
  if(el('print-geb-n'))   el('print-geb-n').textContent   = n;
  if(el('print-mode-label')) el('print-mode-label').textContent = 'Modus: ' + mode;
  if(el('print-year-label')) el('print-year-label').textContent = 'Jahr: ' + globalYear;
}


// ── Draggable float panels ──────────────────────────────────────────
function startDrag(e, panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  // Resolve current position: if still using transform centering, convert to absolute px
  if (!panel.classList.contains('dragging')) {
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top  = rect.top  + 'px';
    panel.style.transform = 'none';
    panel.classList.add('dragging');
  }

  const startX = e.clientX - panel.offsetLeft;
  const startY = e.clientY - panel.offsetTop;

  function onMove(ev) {
    let nx = ev.clientX - startX;
    let ny = ev.clientY - startY;
    nx = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  nx));
    ny = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ny));
    panel.style.left = nx + 'px';
    panel.style.top  = ny + 'px';
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  e.preventDefault();
}

renderList();
tryRestoreAutosave();

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const collapsed = sb.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '◀';
  btn.style.right = collapsed ? '0' : '340px';
  const es = document.getElementById('erzeuger-status');
  if (es) es.style.right = collapsed ? '10px' : '350px';
  setTimeout(() => map.invalidateSize(), 210);
}

function togglePanelMinimize(id) {
  const p = document.getElementById(id);
  if (!p) return;
  p.classList.toggle('minimized');
  const btn = p.querySelector('.panel-minimize-btn');
  if (btn) btn.textContent = p.classList.contains('minimized') ? '▸' : '▾';
}

document.querySelectorAll('.float-panel').forEach(panel => {
  const handle = panel.querySelector('.panel-drag-handle');
  if (!handle) return;
  const btn = document.createElement('button');
  btn.className = 'panel-minimize-btn';
  btn.textContent = '▾';
  btn.title = 'Minimieren';
  btn.onclick = e => { e.stopPropagation(); togglePanelMinimize(panel.id); };
  const dots = handle.querySelector('.drag-dots');
  handle.insertBefore(btn, dots || null);
});

// ══════════════════════════════════════════════════════════════════
// 3-ZONEN GUI: View-Mode · Left-Panel · Center-Views
// ══════════════════════════════════════════════════════════════════

let currentViewMode = 'karte';

function setViewMode(mode) {
  currentViewMode = mode;
  // Stop live play when leaving live view
  if (mode !== 'live' && typeof _liveStopPlay === 'function') _liveStopPlay();
  // Update header tabs
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  // Show/hide center views
  const analyseView = document.getElementById('center-analyse-view');
  const optimierungView = document.getElementById('center-optimierung-view');
  const vergleichView = document.getElementById('center-vergleich-view');
  const liveView = document.getElementById('center-live-view');
  const vergleichOld = document.getElementById('vergleich-panel');
  if (analyseView) analyseView.style.display = mode === 'analyse' ? 'block' : 'none';
  if (optimierungView) optimierungView.style.display = mode === 'optimierung' ? 'block' : 'none';
  if (vergleichView) vergleichView.style.display = mode === 'vergleich' ? 'block' : 'none';
  if (liveView) liveView.style.display = mode === 'live' ? 'flex' : 'none';
  if (vergleichOld) vergleichOld.style.display = 'none'; // always hide old panel
  // Inline-Panels zurücksetzen bevor Modus wechselt
  if (typeof _restoreInlinePanels === 'function') _restoreInlinePanels();
  // Hide floating panels when switching to analyse/vergleich/live
  if (mode !== 'karte') hidePanels();
  // Invalidate map when switching back
  if (mode === 'karte') setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 100);
  // Populate views
  if (mode === 'analyse') refreshAnalyseView();
  if (mode === 'optimierung') {
    if (typeof _optPopulateYearSelect === 'function') _optPopulateYearSelect();
    if (typeof _optUpdateEstimate === 'function') _optUpdateEstimate();
  }
  if (mode === 'vergleich') refreshVergleichView();
  if (mode === 'live') {
    _hourlyModeActive = true;
    if (typeof _tlHistoDrawn !== 'undefined') _tlHistoDrawn = false; // Redraw histogram
    const slider = document.getElementById('live-slider');
    _onHourSlider(slider?.value || 0);
  }
}

// --- Auto-Hide Floating-Panels beim Zeichnen/Platzieren ---
let _drawHiddenPanels = [];

function _hideForDraw() {
  _drawHiddenPanels = [];
  document.querySelectorAll('.float-panel.visible').forEach(p => {
    _drawHiddenPanels.push(p.id);
    p.classList.remove('visible');
  });
}

function _restoreAfterDraw() {
  _drawHiddenPanels.forEach(id => {
    const p = document.getElementById(id);
    if (p) p.classList.add('visible');
  });
  _drawHiddenPanels = [];
}

// Left Panel
let leftPanelCollapsed = false;
function toggleLeftPanel() {
  leftPanelCollapsed = !leftPanelCollapsed;
  const lp = document.getElementById('left-panel');
  const btn = document.getElementById('lp-toggle');
  lp.classList.toggle('collapsed', leftPanelCollapsed);
  btn.textContent = leftPanelCollapsed ? '▶' : '◀';
  btn.style.left = leftPanelCollapsed ? '0' : '280px';
  document.querySelector('.lp-collapse-btn').textContent = leftPanelCollapsed ? '▶' : '◀';
  setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 260);
}

function setLeftTab(tabId) {
  document.querySelectorAll('#lp-tabs .lp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('#left-panel .lp-content').forEach(c => c.classList.toggle('active', c.id === 'lp-' + tabId));
  const titles = { gebiet: 'Gebiet', netz: 'Netz', erzeuger: 'Erzeuger', ergebnis: 'Ergebnis' };
  document.getElementById('lp-title').textContent = titles[tabId] || tabId;
  // Beim Verlassen des Netz-Tabs: beide Netze normalisieren
  if (tabId !== 'netz') {
    if (stromNetzSubTab === 'strom') {
      setStromNetzVisible(false);
    }
    setNetzVisible(true);
  } else {
    // Netz-Tab betreten: Sichtbarkeit an Sub-Tab anpassen
    if (stromNetzSubTab === 'strom') {
      setNetzVisible(false);
      setStromNetzVisible(true);
    } else {
      setStromNetzVisible(false);
      setNetzVisible(true);
    }
  }
  setTimeout(function() { if (typeof map !== 'undefined') map.invalidateSize(); }, 100);
}

// initLeftPanel: erzeuger buttons are now native in HTML, no cloning needed

// Update left panel merit order summary
function updateLpMeritOrder() {
  const container = document.getElementById('lp-merit-order');
  if (!container || typeof window.meritOrderKeys === 'undefined') return;
  const keys = window.meritOrderKeys || [];
  if (keys.length === 0) {
    container.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:4px;">Noch keine Erzeuger aktiv</div>';
    return;
  }
  const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG : {};
  let html = '';
  keys.forEach((k, i) => {
    const c = cfg[k] || {};
    const color = c.color || 'var(--muted)';
    const label = c.label || k;
    html += '<div class="lp-mo-item" style="border-left-color:' + color + ';">'
      + '<span class="mo-prio">' + (i+1) + '.</span>'
      + '<span class="mo-name">' + label + '</span>'
      + '</div>';
  });
  // Auto-Gaskessel als letzten Eintrag
  if (typeof netzEdges !== 'undefined' && netzEdges.length > 0
      && window._autoGkResult !== false) {
    const prio = keys.length + 1;
    const agk = window._autoGkResult;
    let detail = '';
    if (agk) detail = ' · ' + Math.round(agk.waermeMwh).toLocaleString('de-DE') + ' MWh';
    html += '<div class="lp-mo-item" style="border-left-color:#78909c;border-left-style:dashed;opacity:0.75;">'
      + '<span class="mo-prio">' + prio + '.</span>'
      + '<span class="mo-name">Auto-Gaskessel' + detail + ' <span class="htip" data-tip="Virtueller Reservekessel: Zeigt, wie viel Leistung die installierten Erzeuger nicht abdecken können. Wenn dieser Wert > 0 ist, fehlt Erzeugerkapazität.">?</span></span>'
      + '</div>';
  }
  container.innerHTML = html;
}

// Update left panel netz summary
function updateLpErgebnisKpis() {
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  if (!gebaeude || !gebaeude.length) {
    set('lp-kpi-waerme', '—'); set('lp-kpi-heizlast', '—'); set('lp-kpi-wgk', '—');
    set('lp-kpi-ee', '—'); set('lp-kpi-co2', '—'); set('lp-kpi-gebcount', '—');
    return;
  }
  var totalW = 0, totalHL = 0;
  gebaeude.forEach(function(g) {
    var st = typeof getComputedStats === 'function' ? getComputedStats(g, globalYear) : {};
    if (st.status === 'abgerissen') return;
    totalW += (st.waerme || parseFloat(g.waerme) || 0);
    totalHL += (st.heizlast || parseFloat(g.heizlast) || 0);
  });
  set('lp-kpi-waerme', totalW > 0 ? Math.round(totalW).toLocaleString('de-DE') : '—');
  set('lp-kpi-heizlast', totalHL > 0 ? Math.round(totalHL).toLocaleString('de-DE') : '—');
  set('lp-kpi-gebcount', gebaeude.length.toString());
  // WGK, EE, CO2 from footer status bar
  var wgkTxt = document.querySelector('#fs-wgk .fs-txt');
  var eeTxt = document.querySelector('#fs-ee .fs-txt');
  // Extract numeric parts: "WGK: 14,2 ct/kWh" → "14,2 ct/kWh"
  set('lp-kpi-wgk', wgkTxt ? wgkTxt.textContent.replace(/^[^:]*:\s*/, '') : '—');
  set('lp-kpi-ee', eeTxt ? eeTxt.textContent.replace(/^[^:]*:\s*/, '') : '—');
  // CO2 from dispatch results if available
  var co2Txt = document.querySelector('#fs-co2 .fs-txt');
  if (!co2Txt) {
    // Try to calc from variantResults
    var co2 = '—';
    if (typeof variantResults !== 'undefined' && variantResults[activeVariantId || '__base__']) {
      var r = variantResults[activeVariantId || '__base__'];
      if (r.co2) co2 = r.co2.toFixed(1) + ' t/a';
    }
    set('lp-kpi-co2', co2);
  } else {
    set('lp-kpi-co2', co2Txt.textContent.replace(/^[^:]*:\s*/, ''));
  }
}

function updateLpStepProgress() {
  // Step 1: Gebiet — done when gebaeude exist
  var s1 = document.querySelector('#lp-gebiet .lp-step-num');
  var done1 = gebaeude && gebaeude.length > 0;
  // Step 2: Netz — done when netzEdges exist
  var s2 = document.querySelector('#lp-netz .lp-step-num');
  var done2 = typeof netzEdges !== 'undefined' && netzEdges.length > 0;
  // Step 3: Erzeuger — done when meritOrderKeys has active entries
  var s3 = document.querySelector('#lp-erzeuger .lp-step-num');
  var done3 = window.meritOrderKeys && window.meritOrderKeys.length > 0;
  // Step 4: Ergebnis — done when dispatch has results
  var s4 = document.querySelector('#lp-ergebnis .lp-step-num');
  var done4 = window._dispatchEnergy && Object.keys(window._dispatchEnergy).length > 0;
  [[s1,done1],[s2,done2],[s3,done3],[s4,done4]].forEach(function(pair) {
    if (!pair[0]) return;
    if (pair[1]) {
      pair[0].textContent = '✓';
      pair[0].style.background = '#66bb6a';
    } else {
      // Restore original number
      var num = pair[0].getAttribute('data-num');
      if (num) { pair[0].textContent = num; pair[0].style.background = 'var(--accent)'; }
    }
  });
  // Also update tab indicators
  var tabs = document.querySelectorAll('#lp-tabs .lp-tab');
  var dones = [done1, done2, done3, done4];
  tabs.forEach(function(t, i) {
    if (i < dones.length) {
      var dot = t.querySelector('.lp-tab-done');
      if (dones[i] && !dot) {
        var d = document.createElement('span');
        d.className = 'lp-tab-done';
        d.style.cssText = 'display:inline-block;width:5px;height:5px;border-radius:50%;background:#66bb6a;margin-left:3px;vertical-align:middle;';
        t.appendChild(d);
      } else if (!dones[i] && dot) {
        dot.remove();
      }
    }
  });
}

function updateLpGebietStatus() {
  var el = document.getElementById('lp-gebiet-status');
  if (!el) return;
  var parts = [];
  if (typeof areaPolygon !== 'undefined' && areaPolygon) {
    parts.push('<span style="color:#ce93d8;">✓ Bereich definiert</span>');
  }
  if (typeof gebaeude !== 'undefined' && gebaeude.length > 0) {
    parts.push(gebaeude.length + ' Gebäude geladen');
  }
  el.innerHTML = parts.length ? parts.join(' · ') : '';
}

function updateLpNetzSummary() {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  var hint = document.getElementById('lp-netz-hint');
  if (typeof netzEdges === 'undefined' || !netzEdges.length) {
    if (hint) hint.style.display = '';
    setVal('lp-netz-laenge', '—');
    setVal('lp-netz-verluste', '—');
    setVal('lp-netz-verlust-pct', '—');
    setVal('lp-netz-wld', '—');
    setVal('lp-netz-geb', '—');
    setVal('lp-netz-locked', '—');
    return;
  }
  if (hint) hint.style.display = 'none';
  let totalLen = 0, totalLoss = 0;
  netzEdges.forEach(e => { totalLen += (e.length || 0); totalLoss += (e.lossKW_annual || 0); });
  const lossMWh = totalLoss * 8.76;
  const connIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const connGeb = gebaeude.filter(g => connIds.has(g.id));
  const totalW = connGeb.reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const wld = totalLen > 0 ? ((totalW + lossMWh) / (totalLen / 1000)).toFixed(1) : '—';
  const pct = (totalW + lossMWh) > 0 ? (lossMWh / (totalW + lossMWh) * 100).toFixed(1) + ' %' : '—';
  setVal('lp-netz-laenge', (totalLen).toFixed(0) + ' m');
  setVal('lp-netz-verluste', lossMWh.toFixed(1) + ' MWh/a');
  setVal('lp-netz-verlust-pct', pct);
  setVal('lp-netz-wld', wld + ' kWh/(m·a)');
  setVal('lp-netz-geb', connGeb.length + '');
  setVal('lp-netz-locked', typeof networkLocked !== 'undefined' && networkLocked ? 'Bestandsnetz' : 'Neubaunetz');

  // Druckverluste + Pumpe
  const pump = window._netzPumpe;
  if (pump && pump.kritPfadDp > 0) {
    setVal('lp-netz-dp', (pump.kritPfadDp / 1000).toFixed(1) + ' kPa (' + pump.foerderhoeheBar.toFixed(2) + ' bar)');
    setVal('lp-netz-foerderhoehe', pump.foerderhoeheMWS.toFixed(1) + ' mWS (' + pump.vDotGesamt.toFixed(1) + ' m³/h)');
    const pDisp = pump.pumpenLeistungKW < 1 ? (pump.pumpenLeistungKW * 1000).toFixed(0) + ' W' : pump.pumpenLeistungKW.toFixed(1) + ' kW';
    setVal('lp-netz-pumpe', pDisp + ' (η=' + Math.round(pump.etaPumpe * 100) + '%)');
  } else {
    setVal('lp-netz-dp', '—');
    setVal('lp-netz-foerderhoehe', '—');
    setVal('lp-netz-pumpe', '—');
  }
}

// ── Analyse Center View ──────────────────────────────────────────
let analyseCurrentSection = 'uebersicht';
let waermeCurrentTab = 'lastgang';

function setAnalyseSection(section) {
  analyseCurrentSection = section;
  document.querySelectorAll('#analyse-view-tabs .analyse-section-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.section === section));
  refreshAnalyseView();
}

function setWaermeTab(tab) {
  waermeCurrentTab = tab;
  document.querySelectorAll('#waerme-subtabs .analyse-sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  _renderWaermeTab();
}

function _renderWaermeTab() {
  const container = document.getElementById('analyse-waerme-content');
  if (!container) return;
  // Eingebettetes Panel zurücksetzen und neu einbetten
  _restoreInlinePanels();
  _embedPanelInline('analyse-panel', container);
  // Im analyse-panel die eigene Tab-Leiste verstecken
  const panelTabRow = document.querySelector('#analyse-panel .sa-tab-row');
  if (panelTabRow) panelTabRow.style.display = 'none';
  // Nur Wärme-relevante Sub-Tabs zulassen (kein Optimierung)
  if (typeof saSetTab === 'function') saSetTab(waermeCurrentTab);
}

/* ── Inline-Panel-Helfer: Floating-Panels im Analyse-Modus einbetten ── */
function _embedPanelInline(panelId, container) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  // Ursprüngliche Position merken
  if (!panel._origParent) {
    panel._origParent = panel.parentElement;
    panel._origNext   = panel.nextElementSibling;
  }
  container.appendChild(panel);
  panel.classList.add('inline-mode');
  panel.classList.add('visible');
  // Drag-Handle im Inline-Modus verstecken
  const dragHandle = panel.querySelector('.panel-drag-handle');
  if (dragHandle) dragHandle.style.display = 'none';
}
function _restoreInlinePanels() {
  document.querySelectorAll('.float-panel.inline-mode').forEach(p => {
    p.classList.remove('inline-mode', 'visible');
    // Versteckte Elemente wiederherstellen
    const tabRow = p.querySelector('.sa-tab-row');
    if (tabRow) tabRow.style.display = '';
    const dragHandle = p.querySelector('.panel-drag-handle');
    if (dragHandle) dragHandle.style.display = '';
    p.querySelectorAll('.float-panel-close, button[onclick="hidePanels()"]').forEach(b => b.style.display = '');
    if (p._origParent) {
      if (p._origNext && p._origNext.parentElement === p._origParent) {
        p._origParent.insertBefore(p, p._origNext);
      } else {
        p._origParent.appendChild(p);
      }
    }
  });
}

function refreshAnalyseView() {
  // Populate KPIs from footer-status or system state
  const ss = window.systemState;
  const setKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  if (ss) {
    setKpi('av-kpi-waerme', Math.round(ss.gesamtMwhMitNV || ss.nutzwaermeMwh || 0).toLocaleString('de-DE'));
    setKpi('av-kpi-pmax', Math.round(ss.pMaxKw || 0).toLocaleString('de-DE'));
  } else {
    // Try from gebaeude
    const tw = gebaeude.reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
    const thl = gebaeude.reduce((s, g) => s + (parseFloat(g.heizlast) || 0), 0);
    setKpi('av-kpi-waerme', tw.toFixed(0));
    setKpi('av-kpi-pmax', thl.toFixed(0));
  }

  // WGK + EE from globals (zuverlässiger als DOM-Footer)
  setKpi('av-kpi-wgk', window._lastWgk ? window._lastWgk.toFixed(1) + ' ct' : '—');
  // EE-Anteil direkt berechnen
  const _eeKeys = ['lwwp','fg','geo','pellets','hhs'];
  const _den = window._dispatchEnergy || {};
  let _eeW = 0, _gesW = 0;
  for (const k of Object.keys(_den)) { const w = _den[k]?.waermeMwh || 0; _gesW += w; if (_eeKeys.includes(k) || k === '_thermSpeicher') _eeW += w; }
  setKpi('av-kpi-ee', _gesW > 0 ? (_eeW / _gesW * 100).toFixed(0) + ' %' : '—');

  // CO₂ direkt aus Dispatch-Daten berechnen
  const _co2Eta = _getEtaMap();
  const _co2Emf = { gaskessel:gasEmF, heizoel:heizoelEmF, pellets:pelletsEmF, hhs:hhsEmF,
    _autoGk:gasEmF, fernwaerme:fernwaermeEmF, lwwp:stromEmF, fg:stromEmF, geo:stromEmF, stromkessel:stromEmF, bhkw:gasEmF };
  let _co2Tot = 0;
  for (const k of Object.keys(_den)) {
    const e = _den[k]; if (!e) continue;
    const emf = _co2Emf[k] || 0;
    if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
      _co2Tot += (e.elMwh || 0) * emf / 1e3;
    } else if (k === 'bhkw') {
      const etaTh = ((parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100) / (1 + (parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45));
      _co2Tot += (e.waermeMwh || 0) / etaTh * emf / 1e3;
    } else if (_co2Eta[k]) {
      _co2Tot += (e.waermeMwh || 0) / _co2Eta[k] * emf / 1e3;
    }
  }
  setKpi('av-kpi-co2', _co2Tot > 0.01 ? _co2Tot.toFixed(1) : '—');

  // Render the active section
  const grid    = document.getElementById('analyse-dispatch-grid');
  const waerme  = document.getElementById('analyse-waerme-wrap');
  const emWrap  = document.getElementById('analyse-emissionen-wrap');
  const content = document.getElementById('analyse-section-content');
  if (!grid || !content || !waerme) return;

  // Alle inline-eingebetteten Panels zurücksetzen
  _restoreInlinePanels();

  // Alle Bereiche ausblenden
  grid.style.display    = 'none';
  waerme.style.display  = 'none';
  if (emWrap) emWrap.style.display = 'none';
  content.style.display = 'none';

  if (analyseCurrentSection === 'uebersicht') {
    grid.style.display = 'grid';
    renderAnalyseDispatch();
  } else if (analyseCurrentSection === 'waerme') {
    waerme.style.display = 'block';
    _renderWaermeTab();
  } else if (analyseCurrentSection === 'wirtschaft') {
    content.style.display = '';
    _embedPanelInline('wirtschaft-panel', content);
    // Panel-eigene Tab-Leiste und Close-Button im Inline-Modus ausblenden
    const wp = document.getElementById('wirtschaft-panel');
    if (wp) wp.querySelectorAll('.float-panel-close, button[onclick="hidePanels()"]').forEach(b => b.style.display = 'none');
    if (typeof calcWirtschaftPanel === 'function') calcWirtschaftPanel();
  } else if (analyseCurrentSection === 'strom') {
    content.style.display = '';
    _embedPanelInline('strom-panel', content);
    const sp = document.getElementById('strom-panel');
    if (sp) sp.querySelectorAll('.float-panel-close, button[onclick="hidePanels()"]').forEach(b => b.style.display = 'none');
    if (typeof calcStromPanel === 'function') calcStromPanel();
  } else if (analyseCurrentSection === 'emissionen') {
    if (emWrap) { emWrap.style.display = 'block'; _renderEmissionenTab(); }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ── Emissionen-Tab: Sub-Tab-Steuerung + Rendering ────────────────────────
// ══════════════════════════════════════════════════════════════════════════
let _emCurrentTab = 'em-stunden';
let _emZoom = { startH: 0, endH: 8760 };
let _emRubber = null;

function setEmissionenTab(tab) {
  _emCurrentTab = tab;
  document.querySelectorAll('#emissionen-subtabs .analyse-sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.em-tab-panel').forEach(p => p.style.display = 'none');
  const el = document.getElementById('em-tab-' + tab.replace('em-',''));
  if (el) el.style.display = '';
  _renderEmissionenTab();
}

/* ── Stündliche CO₂-Daten berechnen (kgCO₂/h pro Erzeuger) ────────────── */
function _calcEmHourly() {
  const hourly = window._dispatchHourly || {};
  const keys   = window._dispatchActiveKeys || [];
  const en     = window._dispatchEnergy || {};
  if (!keys.length) return null;

  const ETA  = _getEtaMap();
  const EMF  = { gaskessel:gasEmF, heizoel:heizoelEmF, pellets:pelletsEmF, hhs:hhsEmF,
                 _autoGk:gasEmF, fernwaerme:fernwaermeEmF, lwwp:stromEmF, fg:stromEmF,
                 geo:stromEmF, stromkessel:stromEmF, bhkw:gasEmF };

  const result = {};
  const activeKeys = [];
  const N = 8760;

  for (const k of keys) {
    const h = hourly[k];
    const e = en[k];
    if (!h && !e) continue;
    const emf = EMF[k] || 0;
    if (emf === 0) continue;

    const co2h = new Float64Array(N);

    if (h && h.length >= N) {
      // Stundenscharfe Berechnung
      if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
        // WP/Stromkessel: h[t] = Wärme kW, el = Wärme/COP
        const wMwh = e?.waermeMwh || 0;
        const eMwh = e?.elMwh || 0;
        const ratio = wMwh > 0 ? eMwh / wMwh : (k === 'stromkessel' ? 1 : 0.25);
        for (let t = 0; t < N; t++) co2h[t] = h[t] * ratio * emf / 1e3; // kgCO₂/h
      } else if (k === 'bhkw') {
        const etaGes = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
        const sigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
        const etaTh  = (1 + sigma) > 0 ? etaGes / (1 + sigma) : 0.4;
        // Strom-Gutschrift: BHKW verdrängt Netzstrom → CO₂-Kredit
        const verdEmf = (typeof calcVerdraengungEmF === 'function') ? calcVerdraengungEmF() : stromEmF;
        const gutschrift = (typeof bhkwCo2Gutschrift !== 'undefined' && bhkwCo2Gutschrift) ? sigma * verdEmf / 1e3 : 0;
        for (let t = 0; t < N; t++) co2h[t] = Math.max(0, h[t] / etaTh * emf / 1e3 - h[t] * gutschrift);
      } else if (k === 'fernwaerme') {
        for (let t = 0; t < N; t++) co2h[t] = h[t] * emf / 1e3;
      } else if (ETA[k]) {
        const eta = ETA[k];
        for (let t = 0; t < N; t++) co2h[t] = h[t] / eta * emf / 1e3;
      }
    } else if (e) {
      // Kein Stundenprofil → gleichmäßig verteilen (Fallback)
      const wMwh = e.waermeMwh || 0;
      let tCo2;
      if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
        tCo2 = (e.elMwh || 0) * emf / 1e3;
      } else if (ETA[k]) {
        tCo2 = wMwh / ETA[k] * emf / 1e3;
      } else { tCo2 = wMwh * emf / 1e3; }
      const perH = tCo2 * 1000 / N; // kgCO₂/h
      for (let t = 0; t < N; t++) co2h[t] = perH;
    }

    let sum = 0;
    for (let t = 0; t < N; t++) sum += co2h[t];
    if (sum > 0.01) { result[k] = co2h; activeKeys.push(k); }
  }

  return { hourly: result, keys: activeKeys };
}

/* ── PEF-Daten pro Erzeuger berechnen ──────────────────────────────────── */
function _calcPefData() {
  const en   = window._dispatchEnergy || {};
  const keys = window._dispatchActiveKeys || [];
  if (!keys.length) return null;

  const PEF_MAP = {
    lwwp: pefWP, fg: pefWP, geo: pefWP, stromkessel: pefStrom,
    gaskessel: pefGas, _autoGk: pefGas, heizoel: pefHeizoel,
    pellets: pefPellets, hhs: pefHhs, fernwaerme: pefFernwaerme, bhkw: pefGas
  };
  const ETA = _getEtaMap();

  const rows = [];
  let totalPE = 0, totalEnd = 0;

  for (const k of keys) {
    const e = en[k]; if (!e) continue;
    const wMwh = e.waermeMwh || 0;
    if (wMwh < 0.01) continue;
    const fp = PEF_MAP[k] || 1.0;
    let endenergieMwh;
    if (k === 'lwwp' || k === 'fg' || k === 'geo' || k === 'stromkessel') {
      endenergieMwh = e.elMwh || 0;
    } else if (k === 'bhkw') {
      const etaGes = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
      const sigma  = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      endenergieMwh = wMwh / (etaGes / (1 + sigma));
    } else if (ETA[k]) {
      endenergieMwh = wMwh / ETA[k];
    } else {
      endenergieMwh = wMwh;
    }
    const peMwh = endenergieMwh * fp;
    totalPE += peMwh;
    totalEnd += endenergieMwh;
    rows.push({ key: k, label: DA_LABELS[k] || k, color: _daColor(k), wMwh, endenergieMwh, fp, peMwh });
  }

  // Gesamt-Wärme
  const totalWaerme = Object.values(en).reduce((s, e) => s + (e.waermeMwh || 0), 0);
  const fpGes = totalWaerme > 0 ? totalPE / totalWaerme : 0;

  return { rows, totalPE, totalEnd, totalWaerme, fpGes };
}

/* ── KPIs im Emissionen-Tab ─────────────────────────────────────────────── */
function _updateEmKpis() {
  const setKpi = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const emData = _calcEmHourly();
  const pefData = _calcPefData();
  const en = window._dispatchEnergy || {};
  const totalWaerme = Object.values(en).reduce((s, e) => s + (e.waermeMwh || 0), 0);

  if (emData && emData.keys.length > 0) {
    let totalCo2 = 0;
    for (const k of emData.keys) {
      const h = emData.hourly[k];
      for (let t = 0; t < 8760; t++) totalCo2 += h[t];
    }
    const tCo2 = totalCo2 / 1000; // t/a
    setKpi('em-kpi-co2', tCo2.toFixed(1));
    setKpi('em-kpi-spez', totalWaerme > 0 ? (totalCo2 / totalWaerme).toFixed(0) : '—');
    // Referenz: reiner Gaskessel (η=0.92, 240 g/kWh)
    const refCo2 = totalWaerme / 0.92 * gasEmF / 1e3; // tCO₂
    const red = refCo2 > 0 ? ((refCo2 - tCo2) / refCo2 * 100) : 0;
    setKpi('em-kpi-red', red > 0.5 ? '−' + red.toFixed(0) + ' %' : (red < -0.5 ? '+' + Math.abs(red).toFixed(0) + ' %' : '≈ 0 %'));
  } else {
    setKpi('em-kpi-co2', '—');
    setKpi('em-kpi-spez', '—');
    setKpi('em-kpi-red', '—');
  }

  if (pefData) {
    setKpi('em-kpi-pef', pefData.fpGes.toFixed(2));
  } else {
    setKpi('em-kpi-pef', '—');
  }
}

/* ── Haupt-Render-Dispatcher ────────────────────────────────────────────── */
function _renderEmissionenTab() {
  _updateEmKpis();
  const tab = _emCurrentTab;
  if (tab === 'em-stunden')    requestAnimationFrame(_renderEmStunden);
  if (tab === 'em-dauerlinie') requestAnimationFrame(_renderEmDauerlinie);
  if (tab === 'em-monat')      requestAnimationFrame(_renderEmMonat);
  if (tab === 'em-pef')        requestAnimationFrame(_renderEmPef);
}

/* ── Sub-Tab 1: Stundenprofil (gestapelt) ────────────────────────────────── */
function _renderEmStunden() {
  const canvas = document.getElementById('em-stunden-canvas');
  if (!canvas) return;
  const emData = _calcEmHourly();
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 700;
  const H = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!emData || !emData.keys.length) {
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Dispatch ausführen um Emissionen zu sehen.', 20, H / 2);
    return;
  }

  const PAD = { l: 44, r: 10, t: 8, b: 22 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const keys = emData.keys;
  const hourly = emData.hourly;
  const startH = _emZoom.startH, endH = _emZoom.endH;
  const span = endH - startH;

  // Max berechnen
  let maxV = 0;
  for (let t = startH; t < endH; t++) {
    let sum = 0;
    for (const k of keys) sum += hourly[k][t];
    if (sum > maxV) maxV = sum;
  }
  maxV = maxV * 1.08 || 1;

  // Hintergrund-Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  const nGrid = 4;
  for (let i = 1; i <= nGrid; i++) {
    const yy = PAD.t + iH - iH * i / nGrid;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText((maxV * i / nGrid).toFixed(0), PAD.l - 3, yy + 3);
  }

  // Y-Achse Label
  ctx.save(); ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '7px sans-serif';
  ctx.translate(8, PAD.t + iH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.fillText('kg CO₂/h', 0, 0); ctx.restore();

  // X-Achse
  ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  const monthLabels = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const mStarts = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
  if (span > 2000) {
    for (let m = 0; m < 12; m++) {
      const mid = mStarts[m] + (m < 11 ? (mStarts[m+1] - mStarts[m]) / 2 : (8760 - mStarts[m]) / 2);
      if (mid >= startH && mid <= endH) {
        const x = PAD.l + (mid - startH) / span * iW;
        ctx.fillText(monthLabels[m], x, H - 4);
      }
    }
  } else {
    const step = Math.max(1, Math.round(span / 8));
    for (let t = Math.ceil(startH / step) * step; t <= endH; t += step) {
      const x = PAD.l + (t - startH) / span * iW;
      ctx.fillText('h' + t, x, H - 4);
    }
  }

  // Gestapelte Flächen zeichnen
  const colW = iW / span;
  for (let s = keys.length - 1; s >= 0; s--) {
    const color = _daColor(keys[s]);
    ctx.fillStyle = color + '88';
    ctx.beginPath();
    // Obere Kante
    for (let t = startH; t < endH; t++) {
      let cum = 0;
      for (let j = 0; j <= s; j++) cum += hourly[keys[j]][t];
      const x = PAD.l + (t - startH) / span * iW;
      const y = PAD.t + iH - (cum / maxV) * iH;
      t === startH ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    // Untere Kante zurück
    for (let t = endH - 1; t >= startH; t--) {
      let cum = 0;
      for (let j = 0; j < s; j++) cum += hourly[keys[j]][t];
      const x = PAD.l + (t - startH) / span * iW;
      const y = PAD.t + iH - (cum / maxV) * iH;
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // Legende
  const legendEl = document.getElementById('em-stunden-legend');
  if (legendEl) {
    legendEl.innerHTML = keys.map(k =>
      `<span style="display:inline-flex;align-items:center;gap:3px;"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:${_daColor(k)};opacity:0.8;"></span><span style="color:var(--muted);">${DA_LABELS[k]||k}</span></span>`
    ).join('');
  }

  // Zoom-Label
  const zl = document.getElementById('em-stunden-zoom-label');
  const zb = document.getElementById('em-stunden-zoom-reset');
  if (startH > 0 || endH < 8760) {
    if (zl) zl.textContent = 'h' + startH + '–' + endH;
    if (zb) zb.style.display = '';
  } else {
    if (zl) zl.textContent = '';
    if (zb) zb.style.display = 'none';
  }

  // Hover-Tooltip
  _emSetupHover(canvas, keys, hourly, startH, endH, PAD, iW, iH, maxV);
  // Zoom-Drag
  _emSetupZoom(canvas, startH, endH, PAD, iW);
}

/* ── Hover + Zoom für Stundenprofil ─────────────────────────────────────── */
function _emSetupHover(canvas, keys, hourly, startH, endH, PAD, iW, iH, maxV) {
  if (canvas._emHover) return; // nur einmal binden
  canvas._emHover = true;
  const tooltip = document.getElementById('em-stunden-tooltip');
  canvas.addEventListener('mousemove', (e) => {
    if (_emRubber) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - rect.left);
    const span = _emZoom.endH - _emZoom.startH;
    const t = Math.floor(_emZoom.startH + (mx - PAD.l) / iW * span);
    if (t < _emZoom.startH || t >= _emZoom.endH || mx < PAD.l || mx > PAD.l + iW) {
      if (tooltip) tooltip.style.display = 'none'; return;
    }
    let html = `<b>Stunde ${t}</b><br>`;
    let total = 0;
    for (const k of keys) { const v = hourly[k][t]; total += v; html += `<span style="color:${_daColor(k)}">${DA_LABELS[k]||k}: ${v.toFixed(1)} kg</span><br>`; }
    html += `<b>Σ ${total.toFixed(1)} kg CO₂/h</b>`;
    if (tooltip) { tooltip.innerHTML = html; tooltip.style.display = ''; tooltip.style.left = Math.min(mx + 10, iW - 60) + 'px'; tooltip.style.top = '8px'; }
  });
  canvas.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
}

function _emSetupZoom(canvas, startH, endH, PAD, iW) {
  if (canvas._emZoom) return;
  canvas._emZoom = true;
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    _emRubber = { x0: e.clientX - rect.left, x1: e.clientX - rect.left };
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!_emRubber) return;
    const rect = canvas.getBoundingClientRect();
    _emRubber.x1 = e.clientX - rect.left;
  });
  canvas.addEventListener('mouseup', () => {
    if (!_emRubber) return;
    const x0 = Math.min(_emRubber.x0, _emRubber.x1);
    const x1 = Math.max(_emRubber.x0, _emRubber.x1);
    _emRubber = null;
    if (x1 - x0 < 5) return;
    const span = _emZoom.endH - _emZoom.startH;
    const h0 = Math.max(0, Math.floor(_emZoom.startH + (x0 - PAD.l) / iW * span));
    const h1 = Math.min(8760, Math.ceil(_emZoom.startH + (x1 - PAD.l) / iW * span));
    if (h1 - h0 < 10) return;
    _emZoom = { startH: h0, endH: h1 };
    _renderEmStunden();
  });
  canvas.addEventListener('dblclick', () => { _emZoom = { startH: 0, endH: 8760 }; _renderEmStunden(); });
}

function _emZoomReset() { _emZoom = { startH: 0, endH: 8760 }; _renderEmStunden(); }

/* ── Sub-Tab 2: Dauerlinie ────────────────────────────────────────────────── */
function _renderEmDauerlinie() {
  const canvas = document.getElementById('em-dauerlinie-canvas');
  if (!canvas) return;
  const emData = _calcEmHourly();
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 700;
  const H = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!emData || !emData.keys.length) {
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Dispatch ausführen um Emissionen zu sehen.', 20, H / 2); return;
  }

  // Gesamt-CO₂ pro Stunde
  const N = 8760;
  const totals = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    for (const k of emData.keys) totals[t] += emData.hourly[k][t];
  }
  // Sortieren absteigend
  const sorted = Array.from(totals).sort((a, b) => b - a);
  const maxV = sorted[0] * 1.08 || 1;

  const PAD = { l: 44, r: 10, t: 8, b: 22 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // Hintergrund-Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const yy = PAD.t + iH - iH * i / 4;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText((maxV * i / 4).toFixed(0), PAD.l - 3, yy + 3);
  }

  // Y-Achse
  ctx.save(); ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '7px sans-serif';
  ctx.translate(8, PAD.t + iH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.fillText('kg CO₂/h', 0, 0); ctx.restore();

  // X-Achse
  ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  for (let h = 0; h <= N; h += 1000) {
    const x = PAD.l + h / N * iW;
    ctx.fillText(h.toString(), x, H - 4);
  }

  // Fläche füllen
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t + iH);
  for (let i = 0; i < N; i++) {
    const x = PAD.l + i / N * iW;
    const y = PAD.t + iH - (sorted[i] / maxV) * iH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(PAD.l + iW, PAD.t + iH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(239,154,154,0.25)';
  ctx.fill();

  // Linie
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = PAD.l + i / N * iW;
    const y = PAD.t + iH - (sorted[i] / maxV) * iH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ef9a9a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Median + P90 Linien
  const median = sorted[Math.floor(N * 0.5)];
  const p90 = sorted[Math.floor(N * 0.1)]; // Top 10%
  const drawDash = (val, label, color, xFrac) => {
    const y = PAD.t + iH - (val / maxV) * iH;
    ctx.setLineDash([4, 3]); ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + iW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(label + ': ' + val.toFixed(1) + ' kg/h', PAD.l + 4, y - 3);
  };
  drawDash(median, 'Median', '#ffd54f');
  drawDash(p90, 'P90', '#ff8a65');

  // Info
  const infoEl = document.getElementById('em-dl-info');
  const totalTCo2 = sorted.reduce((s, v) => s + v, 0) / 1000;
  if (infoEl) infoEl.textContent = 'Σ ' + totalTCo2.toFixed(1) + ' t CO₂/a | Max ' + sorted[0].toFixed(1) + ' kg/h | Median ' + median.toFixed(1) + ' kg/h';
}

/* ── Sub-Tab 3: Monatsübersicht ──────────────────────────────────────────── */
function _renderEmMonat() {
  const canvas = document.getElementById('em-monat-canvas');
  if (!canvas) return;
  const emData = _calcEmHourly();
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 700;
  const H = 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!emData || !emData.keys.length) {
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Dispatch ausführen um Emissionen zu sehen.', 20, H / 2); return;
  }

  const keys = emData.keys;
  const hourly = emData.hourly;
  const mStarts = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016];
  const mEnds   = [744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
  const monthLabels = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  // Pro Monat + Erzeuger: tCO₂
  const monatData = [];
  let maxM = 0;
  for (let m = 0; m < 12; m++) {
    const row = {};
    let mTotal = 0;
    for (const k of keys) {
      let sum = 0;
      for (let t = mStarts[m]; t < mEnds[m]; t++) sum += hourly[k][t];
      row[k] = sum / 1000; // tCO₂
      mTotal += row[k];
    }
    monatData.push(row);
    if (mTotal > maxM) maxM = mTotal;
  }
  maxM = maxM * 1.12 || 1;

  const PAD = { l: 44, r: 10, t: 8, b: 22 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const barW = iW / 12 * 0.7;
  const gap  = iW / 12 * 0.3;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const yy = PAD.t + iH - iH * i / 4;
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(W - PAD.r, yy); ctx.stroke();
    ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'right';
    ctx.fillText((maxM * i / 4).toFixed(1), PAD.l - 3, yy + 3);
  }

  // Y-Achse
  ctx.save(); ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '7px sans-serif';
  ctx.translate(8, PAD.t + iH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.fillText('t CO₂', 0, 0); ctx.restore();

  // Gestapelte Balken
  for (let m = 0; m < 12; m++) {
    const bx = PAD.l + m * (barW + gap) + gap / 2;
    let cumY = 0;
    for (const k of keys) {
      const val = monatData[m][k] || 0;
      const barH = (val / maxM) * iH;
      ctx.fillStyle = _daColor(k) + 'bb';
      ctx.fillRect(bx, PAD.t + iH - cumY - barH, barW, barH);
      cumY += barH;
    }
    // Monatslabel
    ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(monthLabels[m], bx + barW / 2, H - 4);
    // Summe oben
    let mTotal = 0; for (const k of keys) mTotal += monatData[m][k] || 0;
    ctx.fillStyle = 'rgba(200,200,200,0.6)'; ctx.font = '7px "DM Mono", monospace';
    ctx.fillText(mTotal.toFixed(1), bx + barW / 2, PAD.t + iH - cumY - 3);
  }

  // Legende + Total
  const legendEl = document.getElementById('em-monat-legend');
  if (legendEl) {
    legendEl.innerHTML = keys.map(k =>
      `<span style="display:inline-flex;align-items:center;gap:3px;"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:${_daColor(k)};opacity:0.8;"></span><span style="color:var(--muted);">${DA_LABELS[k]||k}</span></span>`
    ).join('');
  }
  const totalEl = document.getElementById('em-monat-total');
  let yearTotal = 0; monatData.forEach(m => { for (const k of keys) yearTotal += m[k] || 0; });
  if (totalEl) totalEl.textContent = 'Σ ' + yearTotal.toFixed(1) + ' t CO₂/a';
}

/* ── Sub-Tab 4: Primärenergie ──────────────────────────────────────────── */
function _renderEmPef() {
  const canvas = document.getElementById('em-pef-canvas');
  const tableEl = document.getElementById('em-pef-table');
  if (!canvas) return;
  const pefData = _calcPefData();
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 700;
  const dpr = window.devicePixelRatio || 1;

  if (!pefData || !pefData.rows.length) {
    const H = 240;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
    ctx.fillText('Dispatch ausführen um Primärenergie zu sehen.', 20, H / 2);
    if (tableEl) tableEl.innerHTML = '';
    return;
  }

  const rows = pefData.rows;
  // Sortiert nach PE-Anteil absteigend
  rows.sort((a, b) => b.peMwh - a.peMwh);

  // Horizontales Balkendiagramm: ein Balken pro Erzeuger, Breite = Primärenergie MWh
  const rowH = 28;
  const H = Math.max(180, rows.length * (rowH + 6) + 60);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const PAD = { l: 110, r: 80, t: 10, b: 30 };
  const iW = W - PAD.l - PAD.r;
  const maxPE = Math.max(...rows.map(r => r.peMwh)) * 1.1 || 1;

  // Vertikale Grid-Linien
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(200,200,200,0.4)'; ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = PAD.l + iW * i / 4;
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
    if (i > 0) ctx.fillText((maxPE * i / 4).toFixed(0) + ' MWh', x, H - PAD.b + 12);
  }
  // X-Achsen-Titel
  ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Primärenergie (nicht-erneuerbar) MWh/a', PAD.l + iW / 2, H - 4);

  rows.forEach((r, i) => {
    const y = PAD.t + i * (rowH + 6);
    const barLen = (r.peMwh / maxPE) * iW;

    // Hintergrund: Endenergie (leichter, als Vergleich)
    const endLen = (r.endenergieMwh / maxPE) * iW;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(PAD.l, y + 2, endLen, rowH - 4);

    // Primärenergie-Balken
    ctx.fillStyle = r.color + 'cc';
    const rr = 3;
    const bx = PAD.l, by = y + 4, bw = barLen, bh = rowH - 8;
    ctx.beginPath();
    ctx.moveTo(bx, by + rr); ctx.arcTo(bx, by, bx + rr, by, rr);
    ctx.lineTo(bx + bw - rr, by); ctx.arcTo(bx + bw, by, bx + bw, by + rr, rr);
    ctx.lineTo(bx + bw, by + bh - rr); ctx.arcTo(bx + bw, by + bh, bx + bw - rr, by + bh, rr);
    ctx.lineTo(bx + rr, by + bh); ctx.arcTo(bx, by + bh, bx, by + bh - rr, rr);
    ctx.closePath(); ctx.fill();

    // Erzeuger-Label links
    ctx.fillStyle = r.color; ctx.font = '10px "DM Sans", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(r.label, PAD.l - 8, y + rowH / 2 + 4);

    // Werte rechts vom Balken: PE MWh + fp
    ctx.fillStyle = 'rgba(230,230,230,0.8)'; ctx.font = '9px "DM Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(r.peMwh.toFixed(0) + ' MWh', PAD.l + barLen + 6, y + rowH / 2 + 1);
    ctx.fillStyle = 'rgba(200,200,200,0.5)'; ctx.font = '8px "DM Mono", monospace';
    ctx.fillText('fp ' + r.fp.toFixed(1), PAD.l + barLen + 6, y + rowH / 2 + 11);
  });

  // Gesamt-Linie + Label
  const totalLen = (pefData.totalPE / maxPE) * iW;
  const totalY = PAD.t + rows.length * (rowH + 6) + 4;
  ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(79,195,247,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.l + totalLen, PAD.t); ctx.lineTo(PAD.l + totalLen, totalY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'var(--accent)'; ctx.font = 'bold 10px "DM Mono", monospace'; ctx.textAlign = 'left';
  ctx.fillText('Σ ' + pefData.totalPE.toFixed(0) + ' MWh PE | fp,ges = ' + pefData.fpGes.toFixed(2), PAD.l, totalY + 12);

  // Legende
  const legendEl = document.getElementById('em-pef-legend');
  if (legendEl) {
    legendEl.innerHTML =
      '<span style="color:var(--muted);font-size:9px;">Balken = Primärenergie (nicht-erneuerbar) · Hintergrund = Endenergie · fp = Primärenergiefaktor nach GEG Anlage 4</span>';
  }

  // Tabelle
  if (tableEl) {
    let html = `<table class="bom-table"><thead><tr>
      <th>Erzeuger</th>
      <th style="text-align:right" title="Vom Erzeuger bereitgestellte Wärme">Nutzwärme</th>
      <th style="text-align:right" title="Eingesetzte Energie (Brennstoff bzw. Strom)">Endenergie</th>
      <th style="text-align:right" title="Primärenergiefaktor (nicht-erneuerbar) nach GEG Anlage 4">f<sub>p</sub></th>
      <th style="text-align:right" title="Endenergie × fp = nicht-erneuerbarer Primärenergieeinsatz">Primärenergie</th>
    </tr></thead><tbody>`;
    rows.forEach(r => {
      html += `<tr>
        <td style="color:${r.color}">${r.label}</td>
        <td style="text-align:right">${r.wMwh.toFixed(0)} MWh</td>
        <td style="text-align:right">${r.endenergieMwh.toFixed(0)} MWh</td>
        <td style="text-align:right">${r.fp.toFixed(2)}</td>
        <td style="text-align:right">${r.peMwh.toFixed(0)} MWh</td>
      </tr>`;
    });
    html += `<tr style="border-top:1px solid var(--border);font-weight:600;">
      <td>Gesamt</td>
      <td style="text-align:right">${pefData.totalWaerme.toFixed(0)} MWh</td>
      <td style="text-align:right">${pefData.totalEnd.toFixed(0)} MWh</td>
      <td style="text-align:right">${pefData.fpGes.toFixed(2)}</td>
      <td style="text-align:right">${pefData.totalPE.toFixed(0)} MWh</td>
    </tr>`;
    html += '</tbody></table>';
    html += '<div style="font-size:9px;color:var(--muted);margin-top:6px;line-height:1.5;">Primärenergie = Endenergie × f<sub>p</sub> · f<sub>p</sub> = Primärenergiefaktor (nicht-erneuerbar) nach GEG Anlage 4<br>Wärmepumpen: Endenergie = Strombedarf · Kessel: Endenergie = Wärme ÷ Wirkungsgrad</div>';
    tableEl.innerHTML = html;
  }
}

function renderAnalyseDispatch() {
  // Render gestapelter Lastgang canvas in the analyse view
  const ss = window.systemState;
  let data = ss?.lastgangKw;
  if (!data || data.length === 0) {
    const canvas = document.getElementById('av-lastgang-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.clientWidth || 600; canvas.height = 200;
      ctx.fillStyle = 'rgba(15,17,23,0.5)'; ctx.fillRect(0, 0, canvas.width, 200);
      ctx.fillStyle = '#888'; ctx.font = '12px sans-serif';
      const msg = glKannBerechnen() ? '⏳ Bitte „Grundlage berechnen" klicken oder warten…' : 'Gebäude mit Verbrauchsdaten importieren.';
      ctx.fillText(msg, 20, 100);
    }
    // Auto-Berechnung anstoßen wenn möglich
    if (glKannBerechnen() && !_glIsRunning) glBerechnenDebounced(300);
    return;
  }

  const canvas = document.getElementById('av-lastgang-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const H = 200;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const n = data.length;
  let maxP = 0;
  for (let i = 0; i < n; i++) { if (data[i] > maxP) maxP = data[i]; }
  if (maxP < 1) maxP = 1;

  const hourly = window._dispatchHourly || {};
  const keys   = window._dispatchActiveKeys || [];
  const en     = window._dispatchEnergy || {};
  const hasHourlyStacking = keys.length > 0 && Object.keys(hourly).length > 0;
  // JDL-Modus: kein Stundenprofil, aber Energieanteile → proportionale Allokation
  const hasJdlStacking = !hasHourlyStacking && keys.length > 0 && Object.keys(en).length > 0;
  const hPerPx = n / W;

  // Energieanteile für JDL-Stacking berechnen
  let jdlShares = null;
  if (hasJdlStacking) {
    const totalMwh = keys.reduce((s, k) => s + (en[k]?.waermeMwh || 0), 0);
    if (totalMwh > 0.01) {
      jdlShares = {};
      keys.forEach(k => { jdlShares[k] = (en[k]?.waermeMwh || 0) / totalMwh; });
    }
  }

  const canStack = hasHourlyStacking || (hasJdlStacking && jdlShares);

  // Gestapelter Lastgang
  if (canStack) {
    for (let x = 0; x < W; x++) {
      const t0 = Math.floor(x * hPerPx);
      const t1 = Math.min(n, Math.floor((x + 1) * hPerPx) || t0 + 1);
      const cnt = t1 - t0 || 1;

      if (hasHourlyStacking) {
        // Echtes Stundenprofil vorhanden
        const avg = {};
        let lgAvg = 0;
        keys.forEach(k => { avg[k] = 0; });
        for (let t = t0; t < t1; t++) {
          keys.forEach(k => { avg[k] += (hourly[k]?.[t] || 0); });
          lgAvg += (data[t] || 0);
        }
        keys.forEach(k => { avg[k] /= cnt; });
        lgAvg /= cnt;
        const dispSum = keys.reduce((s, k) => s + avg[k], 0);
        const residual = Math.max(0, lgAvg - dispSum);

        let yBase = H;
        keys.forEach(k => {
          const h = (avg[k] / maxP) * H;
          if (h < 0.3) return;
          ctx.fillStyle = typeof _daColor === 'function' ? _daColor(k) : (DA_COLORS_FALLBACK[k] || '#aaa');
          ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
          yBase -= h;
        });
        if (residual > 0.1) {
          const h = (residual / maxP) * H;
          ctx.fillStyle = DA_COLORS_FALLBACK._residual || '#f9a825';
          ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
        }
      } else {
        // JDL-Modus: proportionale Aufteilung nach Energieanteilen
        let lgAvg = 0;
        for (let t = t0; t < t1; t++) lgAvg += (data[t] || 0);
        lgAvg /= cnt;

        let yBase = H;
        keys.forEach(k => {
          const share = jdlShares[k] || 0;
          const kw = lgAvg * share;
          const h = (kw / maxP) * H;
          if (h < 0.3) return;
          ctx.fillStyle = typeof _daColor === 'function' ? _daColor(k) : (DA_COLORS_FALLBACK[k] || '#aaa');
          ctx.fillRect(x, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
          yBase -= h;
        });
      }
    }
  } else {
    // Fallback: einfache Fläche wenn weder Dispatch noch Energieanteile
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(i / n * W, H - (data[i] / maxP) * (H - 10));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(79,195,247,0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(79,195,247,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Monatslinien
  const MHOURS = [0,744,1416,2160,2880,3624,4344,5088,5832,6552,7296,8016,8760];
  const MLABELS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  ctx.font = '9px sans-serif';
  MHOURS.forEach((mh, i) => {
    const x = Math.round(mh / n * W);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (i < 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(MLABELS[i], x + 2, H - 3);
    }
  });

  // Y-Achsen-Labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px "DM Mono", monospace';
  ctx.fillText(maxP.toFixed(0) + ' kW', 4, 12);
  [25, 50, 75].forEach(pct => {
    const y = H - (pct / 100) * H;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(Math.round(maxP * pct / 100) + ' kW', 4, y - 2);
  });

  // Legende für gestapelten Lastgang
  if (canStack) {
    const legEl = canvas.parentElement?.querySelector('.av-lastgang-legend');
    if (legEl) {
      const hasManualGk = keys.includes('gaskessel');
      legEl.innerHTML = keys
        .filter(k => !(k === '_autoGk' && hasManualGk))
        .map(k => {
          const label = (k === 'gaskessel' && keys.includes('_autoGk')) ? 'Gaskessel (teil-auto)' : (DA_LABELS?.[k] || k);
          const c = typeof _daColor === 'function' ? _daColor(k) : (DA_COLORS_FALLBACK[k] || '#aaa');
          return `<span style="display:inline-flex;align-items:center;gap:3px;"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:${c};"></span>${label}</span>`;
        }).join('');
    }
  }

  // JDL canvas — gestapelt nach Erzeuger
  const jdlCanvas = document.getElementById('av-jdl-canvas');
  if (jdlCanvas) {
    const jCtx = jdlCanvas.getContext('2d');
    const jW = jdlCanvas.clientWidth || jdlCanvas.parentElement.clientWidth || 400;
    const jH = 180;
    jdlCanvas.width = jW * dpr;
    jdlCanvas.height = jH * dpr;
    jdlCanvas.style.width = jW + 'px';
    jdlCanvas.style.height = jH + 'px';
    jCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    jCtx.clearRect(0, 0, jW, jH);
    jCtx.fillStyle = 'rgba(15,17,23,0.5)';
    jCtx.fillRect(0, 0, jW, jH);

    const hourly = window._dispatchHourly || {};
    const hasHourly = keys.length > 0 && keys.some(k => hourly[k]?.length > 0);

    if (hasHourly) {
      // Sortierindex: Stunden absteigend nach Gesamtlast sortieren
      const totalPerH = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        keys.forEach(k => { s += (hourly[k]?.[i] || 0); });
        totalPerH[i] = s;
      }
      // Index-Array für sortierte Reihenfolge
      const idx = new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      idx.sort((a, b) => totalPerH[b] - totalPerH[a]);

      const jdlMaxP = totalPerH[idx[0]] || maxP;
      const plotH = jH - 10;

      // Für jede x-Position (Pixel): gemittelte Stundenwerte im sortierten Bereich
      for (let px = 0; px < jW; px++) {
        const i0 = Math.floor(px / jW * n);
        const i1 = Math.min(n, Math.floor((px + 1) / jW * n) || i0 + 1);
        const cnt = i1 - i0 || 1;

        const avg = {};
        keys.forEach(k => { avg[k] = 0; });
        for (let i = i0; i < i1; i++) {
          const h = idx[i];
          keys.forEach(k => { avg[k] += (hourly[k]?.[h] || 0); });
        }
        keys.forEach(k => { avg[k] /= cnt; });

        let yBase = jH;
        keys.forEach(k => {
          const h = (avg[k] / jdlMaxP) * plotH;
          if (h < 0.3) return;
          jCtx.fillStyle = typeof _daColor === 'function' ? _daColor(k) : (DA_COLORS_FALLBACK[k] || '#aaa');
          jCtx.fillRect(px, Math.round(yBase - h), 1, Math.max(1, Math.ceil(h)));
          yBase -= h;
        });
      }

      jCtx.fillStyle = 'rgba(255,255,255,0.4)';
      jCtx.font = '10px "DM Mono", monospace';
      jCtx.fillText(jdlMaxP.toFixed(0) + ' kW', 4, 12);
    } else {
      // Fallback: einfache sortierte Kurve
      const sorted = Float32Array.from(data).sort().reverse();
      jCtx.beginPath();
      jCtx.moveTo(0, jH);
      for (let i = 0; i < sorted.length; i++) {
        jCtx.lineTo(i / sorted.length * jW, jH - (sorted[i] / maxP) * (jH - 10));
      }
      jCtx.lineTo(jW, jH);
      jCtx.closePath();
      jCtx.fillStyle = 'rgba(102,187,106,0.15)';
      jCtx.fill();
      jCtx.strokeStyle = 'rgba(102,187,106,0.6)';
      jCtx.lineWidth = 1;
      jCtx.stroke();
      jCtx.fillStyle = 'rgba(255,255,255,0.4)';
      jCtx.font = '10px "DM Mono", monospace';
      jCtx.fillText(maxP.toFixed(0) + ' kW', 4, 12);
    }
  }

  // Metriken-Content befüllen
  const metrikenEl = document.getElementById('av-metriken-content');
  if (metrikenEl) {
    let totalKwh = 0;
    for (let i = 0; i < n; i++) totalKwh += data[i];
    const totalMwh = totalKwh / 1000;
    const sorted2 = Float32Array.from(data).sort().reverse();
    const p65 = sorted2[Math.floor(n * 0.35)] || 0;
    const p90 = sorted2[Math.floor(n * 0.10)] || 0;
    const vbh = maxP > 0 ? Math.round(totalKwh / maxP) : 0;
    metrikenEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);">${maxP.toFixed(0)}</span> <span style="color:var(--muted);">kW P<sub>max</sub></span></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);">${Math.round(totalMwh).toLocaleString('de-DE')}</span> <span style="color:var(--muted);">MWh/a</span></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);">${p65.toFixed(0)}</span> <span style="color:var(--muted);">kW P<sub>65%</sub></span></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);">${p90.toFixed(0)}</span> <span style="color:var(--muted);">kW P<sub>90%</sub></span></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--text);">${vbh.toLocaleString('de-DE')}</span> <span style="color:var(--muted);">h/a VBH</span> <span class="htip" data-tip="Vollbenutzungsstunden: Wie viele Stunden pro Jahr liefe der Erzeuger auf voller Leistung, um die gleiche Energie zu liefern? Hohe VBH = gute Auslastung.">?</span></div>
      </div>`;
  }

  // Erzeuger table
  renderAnalyseErzeugerTable();

  // CO₂-Trajektorie Chart rendern (jetzt in der Übersicht)
  const _co2Keys = window._dispatchActiveKeys || [];
  const _co2En   = window._dispatchEnergy || {};
  if (_co2Keys.length > 0) {
    requestAnimationFrame(() => _renderWirtCo2Chart(_co2Keys, _co2En));
  }

  // Energiekrone 3D rendern wenn Dispatch-Daten vorhanden
  if (keys.length > 0 && Object.keys(hourly).length > 0) {
    requestAnimationFrame(_renderEnergiekrone);
  }
}

// ── 3D-Dispatch-Visualisierung (Teppich + Helix) ──────────────────────────
if (!window._ekroneMode) window._ekroneMode = 'carpet';

function _setEkroneMode(mode) {
  window._ekroneMode = mode;
  document.querySelectorAll('.ekrone-mode-btn').forEach(b => {
    const active = b.getAttribute('data-mode') === mode;
    b.style.background = active ? 'rgba(77,208,225,0.15)' : 'transparent';
    b.style.color = active ? '#4dd0e1' : 'var(--muted)';
    b.classList.toggle('active', active);
  });
  const title = document.getElementById('ekrone-title');
  if (title) title.textContent = (mode === 'helix' ? 'Helix' : '3D-Teppich') + ' \u2014 Dispatch (365 \u00d7 24 h)';
  window._ekroneState = mode === 'helix' ? { az: 0.4, el: 0.55, zoom: 1 } : { az: 0.6, el: 0.45, zoom: 1 };
  _renderEnergiekrone();
}

function _renderEnergiekrone() {
  const canvas = document.getElementById('energiekrone-canvas');
  if (!canvas) return;

  const hData = window._dispatchHourly || {};
  const keys  = window._dispatchActiveKeys || [];
  if (keys.length === 0 || Object.keys(hData).length === 0) {
    const W2 = canvas.offsetWidth || 600;
    canvas.width = W2; canvas.height = 300;
    const c2 = canvas.getContext('2d');
    c2.fillStyle = 'rgba(15,17,23,0.5)'; c2.fillRect(0, 0, W2, 300);
    c2.fillStyle = '#888'; c2.font = '12px sans-serif';
    c2.fillText('Dispatch-Berechnung erforderlich', 20, 150);
    return;
  }

  if (!window._ekroneState) window._ekroneState = { az: 0.6, el: 0.45, zoom: 1 };
  const { az, el, zoom } = window._ekroneState;

  const W = canvas.offsetWidth || 600;
  const H = Math.round(W * 0.58);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Pre-compute data
  const NDAY = 365, NHOUR = 24;
  let maxKw = 0;
  const totals = new Float32Array(8760);
  const domKeys = new Array(8760);
  for (let i = 0; i < 8760; i++) {
    let total = 0, best = 0, domK = null;
    for (const k of keys) { const v = hData[k]?.[i] || 0; total += v; if (v > best) { best = v; domK = k; } }
    totals[i] = total; domKeys[i] = domK;
    if (total > maxKw) maxKw = total;
  }
  if (maxKw < 1) maxKw = 1;
  window._ekroneMaxKw = maxKw;

  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);

  // Background
  const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W * 0.45);
  bg.addColorStop(0, 'rgba(20,22,30,0.6)'); bg.addColorStop(1, 'rgba(10,12,18,0.3)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  if (window._ekroneMode === 'helix') {
    _renderHelix3D(ctx, W, H, keys, hData, totals, domKeys, maxKw, az, el, zoom);
  } else {
    _renderCarpet3D(ctx, W, H, keys, hData, totals, domKeys, maxKw, az, el, zoom);
  }

  // Legend
  const legEl = document.getElementById('energiekrone-legend');
  if (legEl) {
    legEl.innerHTML = keys.map(k => {
      const c = _daColor(k);
      const l = (typeof DA_LABELS !== 'undefined' && DA_LABELS[k]) || k;
      return '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + ';"></span>' + l + '</span>';
    }).join('');
  }

  if (!canvas._ekroneListeners) _attachEkroneInteraction();
}

// ── 3D-Teppich (Carpet Plot) ──
function _renderCarpet3D(ctx, W, H, keys, hData, totals, domKeys, maxKw, az, el, zoom) {
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);
  const sW = W * 0.38 * zoom, sH = H * 0.44 * zoom;
  const cx = W * 0.50, cy = H * 0.55;
  const hScale = 0.6;

  function proj(x, y, z) {
    return { sx: cx + (x * cosA - z * sinA) * sW, sy: cy - (x * sinA * sinE + y * cosE + z * cosA * sinE) * sH };
  }

  const dayStep = 3, hourStep = 1;
  const nDaySlots = Math.ceil(365 / dayStep);
  const quads = [];

  for (let di = 0; di < nDaySlots; di++) {
    const d0 = di * dayStep, d1 = Math.min(d0 + dayStep, 365);
    const x0 = (d0 / 365 - 0.5) * 2, x1 = (d1 / 365 - 0.5) * 2; // -1 to 1

    for (let h = 0; h < 24; h += hourStep) {
      const h1 = Math.min(h + hourStep, 24);
      const z0 = (h / 24 - 0.5) * 1.2, z1 = (h1 / 24 - 0.5) * 1.2; // -0.6 to 0.6

      let tSum = 0, cnt = 0;
      const contribs = {};
      for (let dd = d0; dd < d1 && dd < 365; dd++) {
        for (let hh = h; hh < h1; hh++) {
          const idx = dd * 24 + hh;
          if (idx >= 8760) continue;
          tSum += totals[idx]; cnt++;
          const dk = domKeys[idx];
          if (dk) contribs[dk] = (contribs[dk] || 0) + (hData[dk]?.[idx] || 0);
        }
      }
      const avg = cnt > 0 ? tSum / cnt : 0;
      const ht = (avg / maxKw) * hScale;

      let domK = null, maxC = 0;
      for (const k in contribs) { if (contribs[k] > maxC) { maxC = contribs[k]; domK = k; } }
      const color = domK ? _daColor(domK) : '#333';

      const top = [[x0, ht, z0], [x1, ht, z0], [x1, ht, z1], [x0, ht, z1]];
      const bot = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
      const depth = ((x0+x1)/2) * sinA * cosE + ((z0+z1)/2) * cosA * cosE;
      quads.push({ top, bot, color, depth, ht, avg, domK, d0, h });
    }
  }

  quads.sort((a, b) => a.depth - b.depth);

  // Ground grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
  for (let g = 0; g <= 12; g++) {
    const x = (g / 12 - 0.5) * 2;
    const p0 = proj(x, 0, -0.6), p1 = proj(x, 0, 0.6);
    ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
  }
  for (let g = 0; g <= 4; g++) {
    const z = (g / 4 - 0.5) * 1.2;
    const p0 = proj(-1, 0, z), p1 = proj(1, 0, z);
    ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
  }

  // Draw quads
  for (const q of quads) {
    const pp = q.top.map(c => proj(c[0], c[1], c[2]));
    ctx.beginPath(); ctx.moveTo(pp[0].sx, pp[0].sy); ctx.lineTo(pp[1].sx, pp[1].sy); ctx.lineTo(pp[2].sx, pp[2].sy); ctx.lineTo(pp[3].sx, pp[3].sy); ctx.closePath();
    ctx.fillStyle = q.color; ctx.globalAlpha = 0.88; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.15; ctx.stroke();

    if (q.ht > 0.005) {
      const bp = q.bot.map(c => proj(c[0], c[1], c[2]));
      ctx.fillStyle = q.color; ctx.globalAlpha = 0.30;
      // Front side
      ctx.beginPath(); ctx.moveTo(pp[1].sx, pp[1].sy); ctx.lineTo(pp[2].sx, pp[2].sy);
      ctx.lineTo(bp[2].sx, bp[2].sy); ctx.lineTo(bp[1].sx, bp[1].sy); ctx.closePath(); ctx.fill();
      // Right side
      ctx.beginPath(); ctx.moveTo(pp[2].sx, pp[2].sy); ctx.lineTo(pp[3].sx, pp[3].sy);
      ctx.lineTo(bp[3].sx, bp[3].sy); ctx.lineTo(bp[2].sx, bp[2].sy); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Labels
  if (!window._ekroneDragging) {
    ctx.fillStyle = 'rgba(170,180,210,0.7)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    const months = ['Jan','Feb','M\u00e4r','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    const mDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    for (let m = 0; m < 12; m++) {
      const x = ((mDays[m] + 15) / 365 - 0.5) * 2;
      const p = proj(x, 0, 0.68);
      ctx.fillText(months[m], p.sx, p.sy + 10);
    }

    ctx.fillStyle = 'rgba(140,150,180,0.5)'; ctx.font = '7px "DM Mono", monospace'; ctx.textAlign = 'right';
    for (let h = 0; h < 24; h += 6) {
      const z = (h / 24 - 0.5) * 1.2;
      const p = proj(-1.06, 0, z);
      ctx.fillText(h + ':00', p.sx, p.sy + 3);
    }

    // Height axis
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(160,170,200,0.55)'; ctx.font = '8px sans-serif';
    const pB = proj(-1.06, 0, -0.6), pT = proj(-1.06, hScale, -0.6);
    ctx.fillText('0', pB.sx - 3, pB.sy);
    ctx.fillText(maxKw >= 1000 ? (maxKw/1000).toFixed(1)+' MW' : Math.round(maxKw)+' kW', pT.sx - 3, pT.sy);
    ctx.strokeStyle = 'rgba(160,170,200,0.25)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(pB.sx, pB.sy); ctx.lineTo(pT.sx, pT.sy); ctx.stroke();

    ctx.fillStyle = 'rgba(120,130,160,0.35)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Drag: drehen  \u00b7  Scroll: zoom  \u00b7  Doppelklick: Reset', W / 2, H - 6);
  }

  window._ekroneQuads = quads;
}

// ── 3D-Helix ──
function _renderHelix3D(ctx, W, H, keys, hData, totals, domKeys, maxKw, az, el, zoom) {
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);
  const sW = W * 0.32 * zoom, sH = H * 0.36 * zoom;
  const cx = W * 0.50, cy = H * 0.52;

  function proj(x, y, z) {
    return { sx: cx + (x * cosA - z * sinA) * sW, sy: cy - (x * sinA * sinE + y * cosE + z * cosA * sinE) * sH };
  }

  const dayStep = 2;
  const nSlots = Math.ceil(365 / dayStep);
  const REVOLUTIONS = 12; // 12 Windungen = 1 pro Monat
  const baseR = 0.25;     // Innenradius der Helix
  const maxBarH = 0.55;   // Max Balkenhöhe nach außen
  const helixH = 1.6;     // Gesamthöhe der Spirale

  const quads = [];

  for (let si = 0; si < nSlots; si++) {
    const d0 = si * dayStep, d1 = Math.min(d0 + dayStep, 365);
    const frac0 = d0 / 365, frac1 = d1 / 365;
    const angle0 = frac0 * REVOLUTIONS * 2 * Math.PI;
    const angle1 = frac1 * REVOLUTIONS * 2 * Math.PI;
    const y0 = (frac0 - 0.5) * helixH;
    const y1 = (frac1 - 0.5) * helixH;

    for (let h = 0; h < 24; h++) {
      const idx0 = d0 * 24 + h;
      if (idx0 >= 8760) continue;

      let tSum = 0, cnt = 0;
      const contribs = {};
      for (let dd = d0; dd < d1 && dd < 365; dd++) {
        const idx = dd * 24 + h;
        if (idx >= 8760) continue;
        tSum += totals[idx]; cnt++;
        const dk = domKeys[idx];
        if (dk) contribs[dk] = (contribs[dk] || 0) + (hData[dk]?.[idx] || 0);
      }
      const avg = cnt > 0 ? tSum / cnt : 0;
      const barH = (avg / maxKw) * maxBarH;

      let domK = null, maxC = 0;
      for (const k in contribs) { if (contribs[k] > maxC) { maxC = contribs[k]; domK = k; } }
      const color = domK ? _daColor(domK) : '#333';

      // Stunde bestimmt radiale Position innerhalb eines Rings
      const hFrac = h / 24;
      const a0 = angle0 + hFrac * (2 * Math.PI / REVOLUTIONS) * 0.9;
      const a1 = angle0 + (hFrac + 1/24) * (2 * Math.PI / REVOLUTIONS) * 0.9;
      const yM = (y0 + y1) / 2;

      // Innerer Punkt (Basis-Helix)
      const ri = baseR;
      const ro = baseR + barH;

      const top = [
        [ri * Math.cos(a0), yM, ri * Math.sin(a0)],
        [ro * Math.cos(a0), yM, ro * Math.sin(a0)],
        [ro * Math.cos(a1), yM, ro * Math.sin(a1)],
        [ri * Math.cos(a1), yM, ri * Math.sin(a1)]
      ];

      const depth = ((ri+ro)/2) * Math.cos((a0+a1)/2) * sinA * cosE
                   + ((ri+ro)/2) * Math.sin((a0+a1)/2) * cosA * cosE
                   + yM * sinE * 0.3;

      quads.push({ top, bot: null, color, depth, ht: barH, avg, domK, d0, h });
    }
  }

  quads.sort((a, b) => a.depth - b.depth);

  // Central axis
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
  const pBot = proj(0, -helixH/2, 0), pTop = proj(0, helixH/2, 0);
  ctx.beginPath(); ctx.moveTo(pBot.sx, pBot.sy); ctx.lineTo(pTop.sx, pTop.sy); ctx.stroke();

  // Helix spine (guide line)
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.3;
  ctx.beginPath();
  for (let i = 0; i <= 360; i++) {
    const f = i / 360;
    const a = f * REVOLUTIONS * 2 * Math.PI;
    const y = (f - 0.5) * helixH;
    const p = proj(baseR * Math.cos(a), y, baseR * Math.sin(a));
    i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();

  // Draw quads
  for (const q of quads) {
    const pp = q.top.map(c => proj(c[0], c[1], c[2]));
    ctx.beginPath(); ctx.moveTo(pp[0].sx, pp[0].sy); ctx.lineTo(pp[1].sx, pp[1].sy);
    ctx.lineTo(pp[2].sx, pp[2].sy); ctx.lineTo(pp[3].sx, pp[3].sy); ctx.closePath();
    ctx.fillStyle = q.color; ctx.globalAlpha = 0.85; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.15; ctx.stroke();
  }

  // Labels
  if (!window._ekroneDragging) {
    ctx.fillStyle = 'rgba(170,180,210,0.7)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
    const months = ['Jan','Feb','M\u00e4r','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    const mDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    for (let m = 0; m < 12; m++) {
      const f = (mDays[m] + 15) / 365;
      const a = f * REVOLUTIONS * 2 * Math.PI;
      const y = (f - 0.5) * helixH;
      const p = proj((baseR + maxBarH + 0.08) * Math.cos(a), y, (baseR + maxBarH + 0.08) * Math.sin(a));
      ctx.fillText(months[m], p.sx, p.sy);
    }

    ctx.fillStyle = 'rgba(120,130,160,0.35)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Drag: drehen  \u00b7  Scroll: zoom  \u00b7  Doppelklick: Reset', W / 2, H - 6);
  }

  window._ekroneQuads = quads;
}

function _attachEkroneInteraction() {
  const canvas = document.getElementById('energiekrone-canvas');
  if (!canvas || canvas._ekroneListeners) return;
  canvas._ekroneListeners = true;

  let dragX = 0, dragY = 0;
  canvas.addEventListener('mousedown', e => {
    window._ekroneDragging = true; dragX = e.clientX; dragY = e.clientY;
    canvas.style.cursor = 'grabbing'; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!window._ekroneDragging) return;
    const dx = e.clientX - dragX, dy = e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    const s = window._ekroneState;
    s.az -= dx * 0.009;
    s.el = Math.max(0.10, Math.min(1.35, s.el + dy * 0.007));
    _renderEnergiekrone();
  });
  window.addEventListener('mouseup', () => {
    if (!window._ekroneDragging) return;
    window._ekroneDragging = false; canvas.style.cursor = 'grab'; _renderEnergiekrone();
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const s = window._ekroneState;
    s.zoom = Math.max(0.3, Math.min(4, s.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
    _renderEnergiekrone();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    const mode = window._ekroneMode || 'carpet';
    window._ekroneState = mode === 'helix' ? { az: 0.4, el: 0.55, zoom: 1 } : { az: 0.6, el: 0.45, zoom: 1 };
    _renderEnergiekrone();
  });

  // Tooltip
  canvas.addEventListener('mousemove', e => {
    if (window._ekroneDragging) return;
    const tip = document.getElementById('energiekrone-tooltip');
    if (!tip) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const qs = window._ekroneQuads || [];
    const st = window._ekroneState || { az: 0.6, el: 0.45, zoom: 1 };
    const W2 = canvas.offsetWidth || 600, H2 = Math.round(W2 * 0.58);
    const cosA2 = Math.cos(st.az), sinA2 = Math.sin(st.az);
    const cosE2 = Math.cos(st.el), sinE2 = Math.sin(st.el);
    const mode = window._ekroneMode || 'carpet';
    const sW2 = W2 * (mode === 'helix' ? 0.32 : 0.38) * st.zoom;
    const sH2 = H2 * (mode === 'helix' ? 0.36 : 0.44) * st.zoom;
    const cx2 = W2 * 0.50, cy2 = H2 * (mode === 'helix' ? 0.52 : 0.55);

    let bestDist = 25, bestQ = null;
    for (const q of qs) {
      if (!q.top || q.top.length < 1) continue;
      const c = q.top[0];
      const sx = cx2 + (c[0] * cosA2 - c[2] * sinA2) * sW2;
      const sy = cy2 - (c[0] * sinA2 * sinE2 + c[1] * cosE2 + c[2] * cosA2 * sinE2) * sH2;
      const dist = Math.hypot(mx - sx, my - sy);
      if (dist < bestDist) { bestDist = dist; bestQ = q; }
    }

    if (!bestQ) { tip.style.display = 'none'; return; }
    const idx = bestQ.d0 * 24 + bestQ.h;
    if (idx >= 8760) { tip.style.display = 'none'; return; }
    const hData2 = window._dispatchHourly || {};
    const keys2 = window._dispatchActiveKeys || [];
    const dt = new Date(2025, 0, bestQ.d0 + 1);
    const dateStr = dt.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    let html = '<b>' + dateStr + ', ' + bestQ.h + ':00</b><br>';
    let totalH = 0; const parts = [];
    for (const k of keys2) {
      const v = hData2[k]?.[idx] || 0; totalH += v;
      if (v > 0.5) {
        const l = (typeof DA_LABELS !== 'undefined' && DA_LABELS[k]) || k;
        parts.push('<span style="color:' + _daColor(k) + '">' + l + ': ' + v.toFixed(0) + ' kW</span>');
      }
    }
    html += 'Gesamt: ' + totalH.toFixed(0) + ' kW<br>' + parts.join('<br>');
    tip.innerHTML = html; tip.style.display = 'block';
    tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 10) + 'px';
  });
  canvas.addEventListener('mouseleave', () => {
    const tip = document.getElementById('energiekrone-tooltip');
    if (tip) tip.style.display = 'none';
  });
  canvas.style.cursor = 'grab';
}

function renderAnalyseErzeugerTable() {
  const el = document.getElementById('av-erzeuger-table');
  if (!el) return;
  const cfg = typeof ERZEUGER_CFG !== 'undefined' ? ERZEUGER_CFG : {};
  const keys = (window._dispatchActiveKeys || window.meritOrderKeys || []).filter(k => k !== '_autoGk');
  if (keys.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;">Keine Erzeuger aktiv.</div>';
    return;
  }
  const dispEn = window._dispatchEnergy || {};
  // Gesamtwärme für Deckungsprozent
  const totalMwh = Object.values(dispEn).reduce((s, e) => s + (e.waermeMwh || 0), 0);

  let html = '<table class="bom-table"><thead><tr><th>Erzeuger</th><th>Leistung kW</th><th>Deckung %</th><th>Wärme MWh/a</th></tr></thead><tbody>';
  keys.forEach(k => {
    const c = cfg[k] || {};
    const color = c.color || '#fff';
    const label = c.label || k;
    const leistung = c.leistungId ? (parseFloat(document.getElementById(c.leistungId)?.value) || 0) : 0;
    const waermeMwh = (dispEn[k]?.waermeMwh || 0);
    const deckung = totalMwh > 0 ? (waermeMwh / totalMwh * 100) : 0;
    html += '<tr><td style="color:' + color + ';">' + label + '</td>';
    html += '<td style="text-align:right;">' + leistung.toFixed(0) + '</td>';
    html += '<td style="text-align:right;">' + deckung.toFixed(1) + '</td>';
    html += '<td style="text-align:right;">' + waermeMwh.toFixed(0) + '</td>';
    html += '</tr>';
  });
  // Auto-GK wenn vorhanden
  if (window._autoGkResult && window._autoGkResult.waermeMwh > 0) {
    const agk = window._autoGkResult;
    const deckung = totalMwh > 0 ? (agk.waermeMwh / totalMwh * 100) : 0;
    html += '<tr><td style="color:#78909c;">Spitzenlast-GK</td>';
    html += '<td style="text-align:right;">' + (agk.leistungKw || 0).toFixed(0) + '</td>';
    html += '<td style="text-align:right;">' + deckung.toFixed(1) + '</td>';
    html += '<td style="text-align:right;">' + agk.waermeMwh.toFixed(0) + '</td></tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ── Vergleich Center View ────────────────────────────────────────
function refreshVergleichView() {
  // Reuse the existing refreshVergleich logic but render to the new container
  if (typeof refreshVergleich === 'function') refreshVergleich();
  // Copy the rendered table to the new view
  const oldWrap = document.getElementById('vergleich-table-wrap');
  const newWrap = document.getElementById('vergleich-view-table-wrap');
  if (oldWrap && newWrap) {
    newWrap.innerHTML = oldWrap.innerHTML;
    // Make column headers clickable
    newWrap.querySelectorAll('th.clickable').forEach(th => {
      th.onclick = function() {
        const vid = this.dataset.variantId;
        if (vid === 'base') activateVariant(null);
        else activateVariant(vid);
        setTimeout(() => refreshVergleichView(), 200);
      };
    });
  }
}

function exportVergleichCSV() {
  const table = document.querySelector('#vergleich-view-table-wrap .vergleich-table') || document.querySelector('#vergleich-table-wrap .vergleich-table');
  if (!table) { alert('Keine Vergleichsdaten vorhanden. Bitte zuerst Varianten anlegen.'); return; }
  let csv = '';
  table.querySelectorAll('tr').forEach(row => {
    const cells = [];
    row.querySelectorAll('th, td').forEach(cell => cells.push('"' + cell.textContent.replace(/"/g, '""').trim() + '"'));
    csv += cells.join(';') + '\n';
  });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'variantenvergleich_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}


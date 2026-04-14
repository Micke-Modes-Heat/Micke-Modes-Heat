// ── 03b-netz.js — Netzplanung (Geothermie, Polygon-Zeichnen, Panel-Mgmt, OSM, Netzgraph, Strang-Report, Rohr-BOM) ──
// ── Geothermie-Sondenfeld ────────────────────────────────────────────────────
function toggleGeoPanel() {
  const p = document.getElementById('geo-panel');
  const btn = document.getElementById('btn-geo-toggle');
  const isOpen = p.classList.contains('visible');
  hidePanels();
  if (!isOpen) {
    p.classList.add('visible'); btn.classList.add('active');
    // 30%-Standardleistung wenn noch kein Wert eingetragen
    if (!document.getElementById('geo-heizlast').value) _setDefault30Pct('geo-heizlast');
    geoUpdateQperm(); calcGeoThermie();
  }
}

function geoUseNetworkValues() {
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  const lastKw = calculatedLoad && calculatedLoad[zId] ? calculatedLoad[zId] : 0;
  const connectedIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const verbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const lossAnnual = netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const erzeugungMWh = verbrauchMWh + lossAnnual * 8.76;
  if (lastKw > 0) document.getElementById('geo-heizlast').value = Math.round(lastKw);
  if (erzeugungMWh > 0) document.getElementById('geo-waerme').value = Math.round(erzeugungMWh);
  calcGeoThermie();
}

// Wärmeleitfähigkeit λ (W/mK) → spez. Entzugsleistung q (W/m)
// Stützpunkte aus Liegenschaftsrechner-Korrelation (drei lineare Segmente):
//   λ 1–2: Δq = 11.8/λ-Einheit  (Steigung 11.8)
//   λ 2–3: Δq =  9.4/λ-Einheit  (Steigung  9.4)
//   λ 3–4: Δq =  7.7/λ-Einheit  (Steigung  7.7)
function geoLambdaToQperm(lambda) {
  const pts = [[1.0, 19.6], [2.0, 31.4], [3.0, 40.8], [4.0, 48.5]];
  if (lambda <= pts[0][0]) return pts[0][1];
  if (lambda >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (lambda <= pts[i][0]) {
      const t = (lambda - pts[i-1][0]) / (pts[i][0] - pts[i-1][0]);
      return Math.round((pts[i-1][1] + t * (pts[i][1] - pts[i-1][1])) * 10) / 10;
    }
  }
  return pts[pts.length - 1][1];
}
function geoUpdateQperm() {
  const lambda = parseFloat(document.getElementById('geo-lambda')?.value) || 2.0;
  const q = geoLambdaToQperm(lambda);
  const el = document.getElementById('geo-q-perm');
  if (el) el.value = q;
}

// 30%-Standard-Leistung: setzt Eingabefeld auf 30% der Netz-Normlast
function _setDefault30Pct(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  // 1. Versuch: Summe aus Gebäude-Normlast
  let normKw = 0;
  if (typeof gebaeude !== 'undefined') {
    gebaeude.forEach(g => {
      if (typeof isExcluded === 'function' && isExcluded(g.id)) return;
      const stats = typeof getComputedStats === 'function'
        ? getComputedStats(g, globalYear) : { heizlast: parseFloat(g.heizlast) || 0 };
      normKw += stats.heizlast || 0;
    });
  }
  // 2. Fallback: Peak des hochgeladenen Lastgangs
  if (normKw <= 10 && typeof glLastgangKw !== 'undefined' && glLastgangKw) {
    for (let i = 0; i < glLastgangKw.length; i++) if (glLastgangKw[i] > normKw) normKw = glLastgangKw[i];
  }
  // 3. Fallback: CalcEngine-State Spitzenlast
  if (normKw <= 10 && window.systemState?.lastgangKw) {
    for (const v of window.systemState.lastgangKw) if (v > normKw) normKw = v;
  }
  if (normKw > 10) el.value = Math.round(normKw * 0.30);
}

let _geoDispatchTimer = null;
function _geoTriggerDispatch() {
  clearTimeout(_geoDispatchTimer);
  _geoDispatchTimer = setTimeout(() => {
    if (typeof updateAllDeckungen === 'function') updateAllDeckungen();
  }, 400);
}

function calcGeoThermie() {
  const heizlastKw = parseFloat(document.getElementById('geo-heizlast').value) || 0;
  const waermeJahr = parseFloat(document.getElementById('geo-waerme').value) || 0;
  const tiefe  = Math.min(400, Math.max(30,  parseFloat(document.getElementById('geo-tiefe').value)  || 100));
  const qPerM  = Math.min(60,  Math.max(10,  parseFloat(document.getElementById('geo-q-perm').value) || 31));
  const abstand = Math.min(15, Math.max(6,   parseFloat(document.getElementById('geo-abstand').value) || 10));
  // JS-Objekt immer mit DOM-Werten synchronisieren (wichtig nach State-Restore)
  if (geoThermie) { geoThermie.abstand = abstand; geoThermie.tiefe = tiefe; }
  // JAZ für Sondendimensionierung: echte JAZ aus Dispatch wenn vorhanden, sonst Carnot-Schätzung
  const guetegrad = parseFloat(document.getElementById('geo-guetegrad')?.value) || 0.50;
  const tVlK = 35 + 273.15;
  const tQK  = 10 + 273.15; // mittlere Erdreichtemperatur Deutschland
  const jazCarnot = Math.max(2, Math.min(8, (tVlK / (tVlK - tQK)) * guetegrad));
  const en  = window._dispatchEnergy?.['geo'];
  const jaz = (en && en.elMwh > 0) ? en.waermeMwh / en.elMwh : jazCarnot;
  const jazEl = document.getElementById('geo-jaz');
  if (jazEl) jazEl.value = jaz.toFixed(2);
  // Display: nur nach Dispatch einen Wert zeigen (vorher —)
  const jazDisp = document.getElementById('geo-jaz-display');
  if (jazDisp && en && en.elMwh > 0) jazDisp.textContent = jaz.toFixed(2) + ' (stundenscharf)';
  if (heizlastKw <= 0) {
    ['geo-r-sonden','geo-r-feld','geo-r-flaeche','geo-r-length','geo-r-strom','geo-r-erde'].forEach(id => { document.getElementById(id).textContent = '—'; });
    const hinwEl2 = document.getElementById('geo-r-hinweis'); const hinwLbl2 = document.getElementById('geo-r-hinweis-lbl');
    if (hinwEl2) hinwEl2.style.display = 'none'; if (hinwLbl2) hinwLbl2.style.display = 'none';
    const effEl = document.getElementById('geo-leistung-eff');
    if (effEl) effEl.value = 0;
    return;
  }
  // ── Kriterium 1: Leistung (Spitzenlast) ──────────────────────────────────
  const erdwaerme_kw = heizlastKw * (jaz - 1) / jaz;
  const pro_sonde_kw = qPerM * tiefe / 1000;             // kW Entzug je Sonde
  const n_leistung   = Math.max(1, Math.ceil(erdwaerme_kw / pro_sonde_kw));

  // ── Kriterium 2: Energie (VDI 4640 — angepasst auf 2100 VBH/a) ───────────
  // Max. Jahresentzug je Sonde = q_spez [W/m] × tiefe [m] × 2100 h/a / 1000
  const VBH_VDI = 2100;
  const maxEntzugProSonde_kwh = qPerM * tiefe / 1000 * VBH_VDI;
  let n_energie = 1;
  if (waermeJahr > 0) {
    const erdwaerme_kwh = waermeJahr * 1000 * (jaz - 1) / jaz; // kWh/a Erdwärme
    n_energie = Math.max(1, Math.ceil(erdwaerme_kwh / maxEntzugProSonde_kwh));
  }

  const n_sonden    = Math.max(n_leistung, n_energie);
  const limitGrund  = n_energie > n_leistung ? 'Energie' : 'Leistung'; // für Hinweis

  // ── Quadratische Grundfläche: ceil(√n) × ceil(√n) ─────────────────────────
  const side   = Math.ceil(Math.sqrt(n_sonden));  // Sonden je Seite
  const cols   = side;
  const rows   = side;
  const breite = cols * abstand;
  const laenge = rows * abstand;
  const flaeche = breite * laenge;
  const totalLength = n_sonden * tiefe;
  const strom = waermeJahr > 0 ? waermeJahr / jaz : null;
  const erde  = waermeJahr > 0 ? waermeJahr * (jaz - 1) / jaz : null;
  document.getElementById('geo-r-sonden').textContent =
    `${n_sonden} (${side}×${side}) — limitiert durch ${limitGrund}`;
  document.getElementById('geo-r-feld').textContent = `${breite.toFixed(0)} × ${laenge.toFixed(0)} m`;
  document.getElementById('geo-r-flaeche').textContent = `${flaeche.toFixed(0)} m²`;
  document.getElementById('geo-r-length').textContent = `${totalLength.toFixed(0)} m`;
  const co2Geo   = strom ? strom * stromEmF   / 1000 : null;
  const co2GeoLZ = strom ? strom * stromEmFLZ / 1000 : null;
  document.getElementById('geo-r-strom').textContent = strom ? `${strom.toFixed(0)} MWh/a` : '—';
  document.getElementById('geo-r-erde').textContent = erde ? `${erde.toFixed(0)} MWh/a` : '—';
  document.getElementById('geo-r-co2').textContent = co2Geo ? `${co2Geo.toFixed(1)} t/a (2026) · ${co2GeoLZ.toFixed(1)} t/a (Ø 2030–50)` : '—';

  if (geoThermie) {
    geoThermie.reqFlaeche = flaeche; // Automatisch berechnete Sollfläche für Farbfeedback beim Ziehen
    const manL = parseFloat(document.getElementById('geo-man-laenge')?.value) || 0;
    const manB = parseFloat(document.getElementById('geo-man-breite')?.value) || 0;
    const hinwEl = document.getElementById('geo-r-hinweis');
    const hinwLbl = document.getElementById('geo-r-hinweis-lbl');
    if (manL > 0 && manB > 0) {
      const mCols = Math.max(1, Math.floor(manB / abstand));
      const mRows = Math.max(1, Math.floor(manL / abstand));
      const n_actual = mCols * mRows;
      const fits = n_actual >= n_sonden;
      // Ergebnisse auf Basis der tatsächlich passenden Sonden neu berechnen
      const totalLengthMan = n_actual * tiefe;
      const erdeMan  = n_actual * maxEntzugProSonde_kwh * (jaz - 1) / jaz;
      const stromMan = erdeMan / (jaz - 1);
      // Effektive Leistung aus tatsächlicher Feldgröße
      const leistungKwEff = jaz > 1 ? n_actual * pro_sonde_kw * jaz / (jaz - 1) : heizlastKw;
      document.getElementById('geo-r-sonden').textContent =
        `${n_actual} (${mCols}×${mRows}) ✏ — VDI mind. ${n_sonden} ${fits ? '✓' : '⚠'} · ${Math.round(leistungKwEff)} kW`;
      document.getElementById('geo-r-feld').textContent = `${manB.toFixed(0)} × ${manL.toFixed(0)} m ✏`;
      document.getElementById('geo-r-flaeche').textContent = `${(manL * manB).toFixed(0)} m²`;
      document.getElementById('geo-r-length').textContent = `${totalLengthMan.toFixed(0)} m`;
      document.getElementById('geo-r-strom').textContent = `${stromMan.toFixed(0)} MWh/a (max.)`;
      document.getElementById('geo-r-erde').textContent = `${erdeMan.toFixed(0)} MWh/a (max.)`;
      // Heizlast- und Wärmeabgabe-Felder sofort mit Feldkapazität befüllen
      document.getElementById('geo-heizlast').value = Math.round(leistungKwEff);
      const maxWaermeMwh = n_actual * maxEntzugProSonde_kwh / 1000;
      const waermeEl = document.getElementById('geo-waerme');
      if (waermeEl) waermeEl.value = Math.round(maxWaermeMwh);
      // Limitierender Faktor anzeigen
      if (hinwLbl) { hinwLbl.style.display = ''; hinwLbl.textContent = 'Begrenzung'; }
      if (hinwEl) {
        const isEnergie = n_energie > n_leistung;
        hinwEl.style.display = '';
        hinwEl.style.color = isEnergie ? '#ff9800' : '#4caf50';
        hinwEl.textContent = `${limitGrund}-begrenzt · Feld ${fits ? '✓' : '⚠'} (${n_actual} von mind. ${n_sonden})`;
      }
      Object.assign(geoThermie, { n_sonden: n_actual, cols: mCols, rows: mRows, abstand, tiefe, flaeche: manL * manB, breite: manB, laenge: manL });
      const effEl = document.getElementById('geo-leistung-eff');
      if (effEl) effEl.value = leistungKwEff.toFixed(1);
    } else {
      // Auto-Modus: limitierenden Faktor anzeigen
      if (hinwLbl) { hinwLbl.style.display = ''; hinwLbl.textContent = 'Begrenzung'; }
      if (hinwEl) {
        const isEnergie = n_energie > n_leistung;
        hinwEl.style.display = '';
        hinwEl.style.color = isEnergie ? '#ff9800' : '#4caf50';
        hinwEl.textContent = `${limitGrund}-begrenzt (${n_leistung} Leistung / ${n_energie} Energie Sonden)`;
      }
      Object.assign(geoThermie, { n_sonden, cols, rows, abstand, tiefe, flaeche, breite, laenge,
        reqFlaeche: flaeche }); // Sollfläche = Quadrat für Farbfeedback
      const effEl = document.getElementById('geo-leistung-eff');
      if (effEl) effEl.value = heizlastKw;
    }
    redrawGeo();
    if (!window._wirtRefreshing) _geoTriggerDispatch();
  } else {
    // geoThermie nicht gesetzt — trotzdem leistung-eff aktualisieren
    const effEl = document.getElementById('geo-leistung-eff');
    if (effEl) effEl.value = heizlastKw;
  }
}

function togglePlaceGeo() {
  isPlacingGeo = !isPlacingGeo;
  const btn = document.getElementById('btn-place-geo');
  if (isPlacingGeo) {
    btn.textContent = 'Klicke auf Karte…';
    btn.style.borderColor = '#4caf50';
    _hideForDraw();
    map.getContainer().style.cursor = 'crosshair';
    showHint('Klicke auf die Karte, um das Sondenfeld zu platzieren.');
    document.getElementById('geo-panel').classList.remove('visible');
    document.getElementById('btn-geo-toggle')?.classList.remove('active');
  } else {
    btn.textContent = 'Auf Karte platzieren';
    btn.style.borderColor = '';
    _restoreAfterDraw();
    map.getContainer().style.cursor = '';
  }
}

function placeGeoAt(latlng) {
  if (!geoLayerGroup) geoLayerGroup = L.layerGroup().addTo(map);
  const jaz = parseFloat(document.getElementById('geo-jaz').value) || 4.5;
  const tiefe = parseFloat(document.getElementById('geo-tiefe').value) || 100;
  const abstand = parseFloat(document.getElementById('geo-abstand').value) || 10;
  document.getElementById('geo-man-laenge').value = '';
  document.getElementById('geo-man-breite').value = '';
  geoThermie = { lat: latlng.lat, lng: latlng.lng, n_sonden: 0, cols: 1, rows: 1, abstand, tiefe, flaeche: 0, breite: 0, laenge: 0 };
  moBeiAktivierung('geo');
  calcGeoThermie();
  document.getElementById('btn-place-geo').textContent = 'Position verschieben';
  redrawErzeugerIcons();
}

function redrawGeo() {
  if (!geoLayerGroup) return;
  geoLayerGroup.clearLayers();
  if (!geoThermie || !geoThermie.n_sonden || geoThermie.lat == null || geoThermie.lng == null) return;
  const center = L.latLng(geoThermie.lat, geoThermie.lng);
  const { cols, rows, abstand, n_sonden, breite, laenge } = geoThermie;
  const latPerM = 1 / 111320;
  const lngPerM = 1 / (111320 * Math.cos(center.lat * Math.PI / 180));
  // Mutable bounds – werden von Griffn live aktualisiert
  const sw = { lat: center.lat - laenge / 2 * latPerM, lng: center.lng - breite / 2 * lngPerM };
  const ne = { lat: center.lat + laenge / 2 * latPerM, lng: center.lng + breite / 2 * lngPerM };
  const reqF = geoThermie.reqFlaeche || laenge * breite;
  const tol = 0.08; // 8 % Toleranz
  function actF() { return ((ne.lat - sw.lat) / latPerM) * ((ne.lng - sw.lng) / lngPerM); }
  function fb(aF) {
    if (aF < reqF * (1 - tol)) return { c: '#ef5350', o: 0.30 }; // zu klein → Rot
    if (aF > reqF * (1 + tol)) return { c: '#66bb6a', o: 0.22 }; // zu groß → Grün
    return { c: '#795548', o: 0.15 };
  }
  const f0 = fb(actF());
  const rect = L.rectangle([sw, ne], { color: '#795548', weight: 2, fillColor: f0.c, fillOpacity: f0.o, dashArray: '6,4' })
    .bindTooltip(`${n_sonden} Sonden · ${(laenge * breite).toFixed(0)} m² · ${geoThermie.tiefe} m tief`, { sticky: true })
    .addTo(geoLayerGroup);
  // Bohrlöcher – immer anzeigen, Canvas-Renderer für Performance bei großen Feldern
  {
    const oLat = center.lat - (rows - 1) * abstand / 2 * latPerM;
    const oLng = center.lng - (cols - 1) * abstand / 2 * lngPerM;
    // Visuelle Parameter skalieren: bei sehr vielen Sonden kleiner + transparenter
    const r   = n_sonden > 800 ? abstand * 0.25 : n_sonden > 300 ? abstand * 0.35 : abstand * 0.45;
    const wt  = n_sonden > 300 ? 0 : 1;
    const fop = n_sonden > 800 ? 0.55 : 0.75;
    const renderer = L.canvas({ padding: 0.5 });
    let cnt = 0;
    for (let row = 0; row < rows && cnt < n_sonden; row++)
      for (let col = 0; col < cols && cnt < n_sonden; col++) {
        L.circle(L.latLng(oLat + row * abstand * latPerM, oLng + col * abstand * lngPerM),
          { radius: r, color: '#4e342e', fillColor: '#a1887f', fillOpacity: fop, weight: wt, renderer }).addTo(geoLayerGroup);
        cnt++;
      }
  }
  // Griffe
  const hIco = cur => L.divIcon({ className: '', html: `<div style="width:10px;height:10px;background:#f5f5f5;border:2px solid #795548;border-radius:2px;cursor:${cur};box-shadow:0 1px 3px rgba(0,0,0,.6);"></div>`, iconSize: [10,10], iconAnchor: [5,5] });
  const cIco = cur => L.divIcon({ className: '', html: `<div style="width:12px;height:12px;background:#fff3e0;border:2px solid #795548;border-radius:0;cursor:${cur};box-shadow:0 1px 3px rgba(0,0,0,.7);"></div>`, iconSize: [12,12], iconAnchor: [6,6] });
  const mLng = () => (sw.lng + ne.lng) / 2;
  const mLat = () => (sw.lat + ne.lat) / 2;
  function upRect() { rect.setBounds([L.latLng(sw.lat, sw.lng), L.latLng(ne.lat, ne.lng)]); const f = fb(actF()); rect.setStyle({ fillColor: f.c, fillOpacity: f.o }); }
  function done() {
    const aL = (ne.lat - sw.lat) / latPerM, aB = (ne.lng - sw.lng) / lngPerM;
    geoThermie.lat = (sw.lat + ne.lat) / 2;
    geoThermie.lng = (sw.lng + ne.lng) / 2;
    document.getElementById('geo-man-laenge').value = aL.toFixed(1);
    document.getElementById('geo-man-breite').value = aB.toFixed(1);
    calcGeoThermie();
  }
  // Seitengriffe: N S E W
  const nH = L.marker(L.latLng(ne.lat, mLng()), { draggable: true, icon: hIco('ns-resize'), zIndexOffset: 2000 }).addTo(geoLayerGroup);
  nH.on('drag', function() { const lat = this.getLatLng().lat; if (lat > sw.lat + 3 * latPerM) { ne.lat = lat; upRect(); } });
  nH.on('dragend', done);
  const sH = L.marker(L.latLng(sw.lat, mLng()), { draggable: true, icon: hIco('ns-resize'), zIndexOffset: 2000 }).addTo(geoLayerGroup);
  sH.on('drag', function() { const lat = this.getLatLng().lat; if (lat < ne.lat - 3 * latPerM) { sw.lat = lat; upRect(); } });
  sH.on('dragend', done);
  const eH = L.marker(L.latLng(mLat(), ne.lng), { draggable: true, icon: hIco('ew-resize'), zIndexOffset: 2000 }).addTo(geoLayerGroup);
  eH.on('drag', function() { const lng = this.getLatLng().lng; if (lng > sw.lng + 3 * lngPerM) { ne.lng = lng; upRect(); } });
  eH.on('dragend', done);
  const wH = L.marker(L.latLng(mLat(), sw.lng), { draggable: true, icon: hIco('ew-resize'), zIndexOffset: 2000 }).addTo(geoLayerGroup);
  wH.on('drag', function() { const lng = this.getLatLng().lng; if (lng < ne.lng - 3 * lngPerM) { sw.lng = lng; upRect(); } });
  wH.on('dragend', done);
  // Eckengriffe: NE NW SE SW
  const neH = L.marker(L.latLng(ne.lat, ne.lng), { draggable: true, icon: cIco('nesw-resize'), zIndexOffset: 2100 }).addTo(geoLayerGroup);
  neH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat > sw.lat + 3 * latPerM) ne.lat = ll.lat; if (ll.lng > sw.lng + 3 * lngPerM) ne.lng = ll.lng; upRect(); });
  neH.on('dragend', done);
  const nwH = L.marker(L.latLng(ne.lat, sw.lng), { draggable: true, icon: cIco('nwse-resize'), zIndexOffset: 2100 }).addTo(geoLayerGroup);
  nwH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat > sw.lat + 3 * latPerM) ne.lat = ll.lat; if (ll.lng < ne.lng - 3 * lngPerM) sw.lng = ll.lng; upRect(); });
  nwH.on('dragend', done);
  const seH = L.marker(L.latLng(sw.lat, ne.lng), { draggable: true, icon: cIco('nwse-resize'), zIndexOffset: 2100 }).addTo(geoLayerGroup);
  seH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat < ne.lat - 3 * latPerM) sw.lat = ll.lat; if (ll.lng > sw.lng + 3 * lngPerM) ne.lng = ll.lng; upRect(); });
  seH.on('dragend', done);
  const swH = L.marker(L.latLng(sw.lat, sw.lng), { draggable: true, icon: cIco('nesw-resize'), zIndexOffset: 2100 }).addTo(geoLayerGroup);
  swH.on('drag', function() { const ll = this.getLatLng(); if (ll.lat < ne.lat - 3 * latPerM) sw.lat = ll.lat; if (ll.lng < ne.lng - 3 * lngPerM) sw.lng = ll.lng; upRect(); });
  swH.on('dragend', done);
  // Zentrum verschieben
  const geoIcon = L.divIcon({ className: '', html: '<div style="width:26px;height:26px;background:rgba(121,85,72,0.35);border:2px solid #795548;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:grab;">' + drillSvg('#a1887f',14,20) + '</div>', iconSize: [26,26], iconAnchor: [13,13] });
  L.marker(center, { draggable: true, icon: geoIcon, zIndexOffset: 1000 }).addTo(geoLayerGroup)
    .on('dragend', function() { geoThermie.lat = this.getLatLng().lat; geoThermie.lng = this.getLatLng().lng; redrawGeo(); });
  if (!map.hasLayer(geoLayerGroup)) geoLayerGroup.addTo(map);
  redrawVerbindungslinien();
}

function setGeoVisible(visible) {
  if (!geoLayerGroup) return;
  if (visible) { if (!map.hasLayer(geoLayerGroup)) geoLayerGroup.addTo(map); }
  else { if (map.hasLayer(geoLayerGroup)) map.removeLayer(geoLayerGroup); }
}

function clearGeo() {
  geoThermie = null;
  moBeiDeaktivierung('geo');
  if (geoLayerGroup) geoLayerGroup.clearLayers();
  document.getElementById('btn-place-geo').textContent = 'Auf Karte platzieren';
  // Manuelle Maße zurücksetzen damit sie nicht in andere Varianten bluten
  document.getElementById('geo-man-laenge').value = '';
  document.getElementById('geo-man-breite').value = '';
  redrawErzeugerIcons();
}

function startDraw(id){
  clearArea(); cancelDraw();
  drawingId=id; drawPoints=[];
  showHint('Eckpunkte anklicken · Am Ende Startpunkt (rot) anklicken · Rechtsklick = Zurück');
  _hideForDraw();
  map.getContainer().style.cursor='crosshair';
  selectedId=id; renderList();
}

function cancelDraw(){
  if(drawPolyline){map.removeLayer(drawPolyline);drawPolyline=null;}
  if(drawStartMarker){map.removeLayer(drawStartMarker);drawStartMarker=null;}
  drawingId=null;drawPoints=[];
  map.getContainer().style.cursor='';hideHint();
  _restoreAfterDraw();
}

function finishDraw(){
  if(drawPoints.length < 3) return;
  const id=drawingId,pts=[...drawPoints];
  cancelDraw();
  const g=gebaeude.find(x=>x.id===id);if(!g) return;
  g.polygon=pts;
  g.flaeche=polygonAreaM2(pts);
  attachPolygonLayer(g);
  
  if(g.flaeche > 0) {
    if(g.waerme) g.spez = Math.round(parseFloat(g.waerme)*1000/g.flaeche*10)/10;
    if(g.heizlast) g.spezHeizlast = Math.round(parseFloat(g.heizlast)*1000/g.flaeche*10)/10;
  }
  
  renderList();updateViz();
}

function hidePanels(){
  document.getElementById('osm-panel').classList.remove('visible');
  document.getElementById('netz-panel').classList.remove('visible');
  document.getElementById('kennwerte-panel').classList.remove('visible');
  document.getElementById('fliessgewaesser-panel').classList.remove('visible');
  document.getElementById('lwwp-panel').classList.remove('visible');
  document.getElementById('gaskessel-panel').classList.remove('visible');
  document.getElementById('heizoel-panel').classList.remove('visible');
  document.getElementById('pellets-panel').classList.remove('visible');
  document.getElementById('hhs-panel').classList.remove('visible');
  document.getElementById('fernwaerme-panel').classList.remove('visible');
  document.getElementById('geo-panel').classList.remove('visible');
  document.getElementById('area-edit-panel').classList.remove('visible');
  document.getElementById('chart-panel').classList.remove('visible');
  document.getElementById('overlay-panel').classList.remove('visible');
  document.getElementById('btn-netz-toggle').classList.remove('active');
  document.getElementById('btn-kennwerte-toggle').classList.remove('active');
  document.getElementById('btn-fliessgewaesser-toggle').classList.remove('active');
  document.getElementById('btn-lwwp-toggle').classList.remove('active');
  document.getElementById('btn-gaskessel-toggle').classList.remove('active');
  document.getElementById('btn-heizoel-toggle').classList.remove('active');
  document.getElementById('btn-pellets-toggle').classList.remove('active');
  document.getElementById('btn-hhs-toggle').classList.remove('active');
  document.getElementById('btn-fernwaerme-toggle').classList.remove('active');
  document.getElementById('btn-geo-toggle').classList.remove('active');
  document.getElementById('btn-chart-toggle').classList.remove('active');
  document.getElementById('btn-overlay-toggle').classList.remove('active');
  document.getElementById('grundlagen-panel').classList.remove('visible');
  document.getElementById('btn-grundlagen-toggle').classList.remove('active');
  document.getElementById('analyse-panel').classList.remove('visible');
  document.getElementById('btn-analyse-toggle').classList.remove('active');
  document.getElementById('wirtschaft-panel').classList.remove('visible');
  document.getElementById('btn-wirtschaft-toggle').classList.remove('active');
  document.getElementById('strom-panel').classList.remove('visible');
  document.getElementById('btn-strom-toggle').classList.remove('active');
  const _tsP = document.getElementById('therm-speicher-panel');
  if (_tsP) _tsP.style.display = 'none';
  const _stP = document.getElementById('solarthermie-panel');
  if (_stP) { _stP.classList.remove('visible'); _stP.style.display = 'none'; }
  document.getElementById('btn-solarthermie-toggle')?.classList.remove('active');
  document.getElementById('bhkw-panel')?.classList.remove('visible');
  document.getElementById('btn-bhkw-toggle')?.classList.remove('active');
  document.getElementById('stromkessel-panel')?.classList.remove('visible');
  document.getElementById('btn-stromkessel-toggle')?.classList.remove('active');
  document.getElementById('geb-pv-panel')?.classList.remove('visible');
  document.getElementById('btn-geb-pv-toggle')?.classList.remove('active');
  document.getElementById('ff-pv-panel')?.classList.remove('visible');
  document.getElementById('btn-ff-pv-toggle')?.classList.remove('active');
  document.getElementById('pv-panel')?.classList.remove('visible');
  document.getElementById('batterie-panel')?.classList.remove('visible');
  if (isPlacingLwWp) togglePlaceLwWp();
  if (isPlacingGeo) { isPlacingGeo = false; map.getContainer().style.cursor = ''; }
  if (isPlacingPellets) { isPlacingPellets = false; map.getContainer().style.cursor = ''; }
  if (isPlacingHhs) { isPlacingHhs = false; map.getContainer().style.cursor = ''; }
  if (isPlacingFernwaerme) { isPlacingFernwaerme = false; map.getContainer().style.cursor = ''; }
  _restoreAfterDraw();
}

function toggleOverlayPanel() {
  const p = document.getElementById('overlay-panel');
  const btn = document.getElementById('btn-overlay-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
  }
}

function showOsmPanel(){
  if(areaPolygon) { showAreaEditPanel(); return; }
  hidePanels();
  document.getElementById('osm-panel').classList.add('visible');
}

function showAreaEditPanel(){
  hidePanels();
  document.getElementById('area-edit-panel').classList.add('visible');
}

function toggleChartPanel(){
  const p = document.getElementById('chart-panel');
  const btn = document.getElementById('btn-chart-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    drawChart();
  }
}

function toggleNetzPanel(){
  const p = document.getElementById('netz-panel');
  const btn = document.getElementById('btn-netz-toggle');
  if(p.classList.contains('visible')){
    p.classList.remove('visible');
    btn.classList.remove('active');
    if(isDrawingEdge) toggleDrawEdge();
    if(isDrawingTrasse) toggleDrawTrasse();
  } else {
    hidePanels();
    p.classList.add('visible');
    btn.classList.add('active');
    updateRohrListe();
    updateNetzColorLegend();
  }
}

function loadOverlay(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = function() {
      setupOverlayOnMap(dataUrl, img.width, img.height);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function setupOverlayOnMap(url, w, h) {
  clearOverlay();
  const center = map.getCenter();
  const offsetLat = 0.003;
  const ratio = w / h;
  const offsetLng = offsetLat * ratio;

  const bounds = [
    [center.lat + offsetLat, center.lng - offsetLng], 
    [center.lat - offsetLat, center.lng + offsetLng]  
  ];

  const opacity = document.getElementById('overlay-opacity').value;
  overlayLayer = L.imageOverlay(url, bounds, {opacity: opacity, interactive: false}).addTo(map);

  const iconNW = L.divIcon({className: 'area-edit-handle', html: '', iconSize: [14, 14]});
  const iconSE = L.divIcon({className: 'area-edit-handle', html: '', iconSize: [14, 14]});

  overlayMarkerNW = L.marker(bounds[0], {draggable: true, icon: iconNW, zIndexOffset: 3000}).addTo(map);
  overlayMarkerSE = L.marker(bounds[1], {draggable: true, icon: iconSE, zIndexOffset: 3000}).addTo(map);

  overlayMarkerNW.on('drag', updateOverlayBounds);
  overlayMarkerSE.on('drag', updateOverlayBounds);

  showHint('Verschiebe die gelben Punkte, um den Plan auf der Karte auszurichten.');
}

function updateOverlayBounds() {
  if (!overlayLayer || !overlayMarkerNW || !overlayMarkerSE) return;
  const nw = overlayMarkerNW.getLatLng();
  const se = overlayMarkerSE.getLatLng();
  overlayLayer.setBounds([nw, se]);
}

function changeOverlayOpacity(val) {
  if (overlayLayer) overlayLayer.setOpacity(val);
}

function clearOverlay() {
  if (overlayLayer) { map.removeLayer(overlayLayer); overlayLayer = null; }
  if (overlayMarkerNW) { map.removeLayer(overlayMarkerNW); overlayMarkerNW = null; }
  if (overlayMarkerSE) { map.removeLayer(overlayMarkerSE); overlayMarkerSE = null; }
  const fileInput = document.getElementById('overlay-file');
  if(fileInput) fileInput.value = '';
}

function pointInPolygon(pt, poly) {
  let x = pt.lng, y = pt.lat;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    let xi = poly[i].lng, yi = poly[i].lat;
    let xj = poly[j].lng, yj = poly[j].lat;
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Overpass-API — alle Server parallel anfragen, schnellste Antwort gewinnt
var OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
function _overpassFetchWithRetry(query) {
  // Gestaffelt-parallel: Hauptserver sofort, Backup nach 5s/10s.
  // Wer zuerst antwortet, gewinnt. Spart Rate-Limit vs. voll-parallel.
  showHint('⏳ OSM-Gebäude werden geladen…');
  var done = false;
  var controllers = [];
  var failures = 0;
  var STAGGER = [0, 5000, 10000]; // ms Verzögerung pro Server
  return new Promise(function(resolve) {
    function tryEndpoint(idx) {
      if (done || idx >= OVERPASS_ENDPOINTS.length) return;
      var endpoint = OVERPASS_ENDPOINTS[idx];
      var ctrl = new AbortController();
      controllers.push(ctrl);
      var timer = setTimeout(function() { ctrl.abort(); }, 30000);
      fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal
      }).then(function(resp) {
        clearTimeout(timer);
        if (done) return;
        if (!resp.ok || resp.status === 429 || resp.status === 504) throw new Error('HTTP ' + resp.status);
        return resp.json();
      }).then(function(data) {
        if (done || !data) return;
        done = true;
        controllers.forEach(function(c) { try { c.abort(); } catch(e){} });
        resolve(data);
      }).catch(function() {
        clearTimeout(timer);
        failures++;
        if (failures >= OVERPASS_ENDPOINTS.length && !done) {
          done = true;
          showHint('⚠ OSM-Server nicht erreichbar — bitte später erneut versuchen');
          setTimeout(hideHint, 5000);
          resolve(null);
        }
      });
    }
    // Gestaffelt starten
    OVERPASS_ENDPOINTS.forEach(function(_, idx) {
      setTimeout(function() { tryEndpoint(idx); }, STAGGER[idx] || idx * 5000);
    });
  });
}

async function loadOsmBuildings(){
  // Snapshot the area polygon coords immediately before anything else runs,
  // so hidePanels() or async timing can't clear/mutate them underneath us.
  const snapArea = (areaLatLngs && areaLatLngs.length >= 3)
    ? areaLatLngs.map(p => L.latLng(p.lat, p.lng))
    : null;

  hidePanels();
  const btn=document.getElementById('osm-btn');
  btn.classList.add('loading');
  showHint('OSM-Gebäude werden geladen…');

  let polyFilter;
  if(snapArea && snapArea.length >= 3){
    // Overpass poly-Filter: schneller als bbox bei unregelmäßigen Gebieten
    polyFilter = snapArea.map(p => p.lat.toFixed(6) + ' ' + p.lng.toFixed(6)).join(' ');
  }
  let bbox;
  if(!polyFilter){
    const b=map.getBounds();
    // Sicherheitsgrenze: max ~5 km Kantenlänge, sonst zu viele Gebäude
    const maxSpan = 0.05; // ~5 km
    const cLat = b.getCenter().lat, cLng = b.getCenter().lng;
    const latSpan = Math.min((b.getNorth() - b.getSouth()) / 2, maxSpan);
    const lngSpan = Math.min((b.getEast() - b.getWest()) / 2, maxSpan);
    bbox=[cLat - latSpan, cLng - lngSpan, cLat + latSpan, cLng + lngSpan];
  }

  const areaFilter = polyFilter
    ? `(poly:"${polyFilter}")`
    : `(${bbox.join(',')})`;
  const query=`[out:json][timeout:30];
(way["building"]${areaFilter};);
out body;>;out skel qt;`;

  try{
    const data = await _overpassFetchWithRetry(query, btn);
    if (!data) { btn.classList.remove('loading'); return; }

    // Alle Gebäude parsen (reine Daten, noch kein DOM)
    const toAdd = parseOsmData(data, snapArea);
    if(toAdd.length === 0){
      showHint('Keine neuen Gebäude gefunden');
      setTimeout(hideHint,3500);
      btn.classList.remove('loading');
      return;
    }

    // Gebäude in Häppchen einfügen — Polygone erscheinen batch-weise auf der Karte
    const CHUNK = 20;
    _batchImporting = true;
    for(let i = 0; i < toAdd.length; i += CHUNK){
      toAdd.slice(i, i + CHUNK).forEach(opts => addGebaeude(opts));
      showHint(`OSM: ${Math.min(i + CHUNK, toAdd.length)} / ${toAdd.length} Gebäude…`);
      await new Promise(r => setTimeout(r, 0));
    }
    _batchImporting = false;

    // Sofort Erfolgsmeldung + ausblenden
    showHint(`✓ ${toAdd.length} Gebäude geladen`);
    setTimeout(hideHint, 2000);

    // Einmalig alles aktualisieren
    renderList();
    updateViz();
    updateTotals();
    recalcNetz();
    populateZentraleSelect();

    // Plangebiet-Polygon + Eckpunkte ausblenden nach erfolgreichem Import
    if (areaPolygon) { map.removeLayer(areaPolygon); }
    areaEditMarkers.forEach(m => map.removeLayer(m));
  }catch(err){
    _batchImporting = false;
    showHint('⚠ Fehler: '+err.message);setTimeout(hideHint,4000);console.error(err);
  }
  btn.classList.remove('loading');
  // Sicherheit: Hint spätestens nach 3s ausblenden falls er hängenbleibt
  setTimeout(function(){ const h=document.getElementById('hint'); if(h && !h.classList.contains('hidden') && (h.textContent.indexOf('geladen')>-1 || h.textContent.indexOf('Gebäude')>-1)) hideHint(); }, 3000);
}

function parseOsmLevels(tags){
  const raw = tags['building:levels'] || tags.levels || '';
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  if(n > 0 && n < 100) return n;
  return null;
}

function parseOsmHeight(tags){
  const raw = tags.height || '';
  const m = String(raw).match(/^(\d+(?:[.,]\d+)?)\s*m/i) || String(raw).match(/^(\d+(?:[.,]\d+)?)$/);
  if(m) return parseFloat(m[1].replace(',', '.')) || null;
  return null;
}

function parseOsmBaujahr(tags){
  const raw = tags.start_date || tags['start_date:edtf'] || tags.construction_date || tags['construction:date'] || tags.year || '';
  const s = String(raw).trim();
  const y = s.length >= 4 ? parseInt(s.substring(0, 4), 10) : NaN;
  if(!isNaN(y) && y >= 1800 && y <= 2030) return y;
  return null;
}

// Gibt Array von Gebäude-Optionsobjekten zurück — keine Seiteneffekte.
function parseOsmData(data, snapArea){
  const nodes={};
  data.elements.forEach(el=>{ if(el.type==='node') nodes[el.id]={lat:el.lat,lng:el.lon}; });
  const existingOsm=new Set(gebaeude.filter(g=>g.osmId).map(g=>g.osmId));
  const result=[];

  data.elements.forEach(el=>{
    if(el.type!=='way'||!el.tags?.building) return;
    if(existingOsm.has(el.id)) return;

    // Garagen, Schuppen etc. überspringen
    if(OSM_SKIP_TYPES.has((el.tags.building||'').toLowerCase())) return;

    const coords=el.nodes.map(nid=>nodes[nid]).filter(Boolean);
    if(coords.length<3) return;

    if(snapArea&&snapArea.length>=3){
      const center=polygonCenter(coords);
      if(!pointInPolygon(center, snapArea)) return;
    }

    const t=el.tags;
    let name=t.name||(t['addr:street']&&(t['addr:street']+(t['addr:housenumber']?' '+t['addr:housenumber']:'')).trim())||t.amenity||t['building:use']||t.shop||t.office||'';
    const nutzung = osmNutzung(t.building);
    if(!name) name = null; // wird in addGebaeude via nextGebName(nutzung) gesetzt

    let stockwerke = parseOsmLevels(t);
    if (stockwerke == null) {
      const heightM = parseOsmHeight(t);
      if (heightM != null) stockwerke = Math.max(1, Math.round(heightM / 3));
    }
    if (stockwerke == null) stockwerke = 1;

    // Baujahr aus OSM-Tags — null wenn unbekannt (wird später per Nachbarschaft gefüllt)
    const osmBj = parseOsmBaujahr(t);

    // Schwerpunkt für spätere Nachbarschaftssuche
    const sumLat = coords.reduce((s,c) => s + c.lat, 0);
    const sumLng = coords.reduce((s,c) => s + c.lng, 0);
    const cLat = sumLat / coords.length;
    const cLng = sumLng / coords.length;

    result.push({coords, name, fromOsm:true, osmId:el.id, stockwerke,
                 baujahr: osmBj, _hasOsmBj: osmBj !== null, _lat: cLat, _lng: cLng, nutzung});
  });

  // ── Nachbarschaftsinferenz für Gebäude ohne Baujahr ─────────────────────────
  const defaultBj = parseInt(document.getElementById('osm-default-baujahr')?.value) || 1970;
  const withYear    = result.filter(b => b._hasOsmBj);
  const withoutYear = result.filter(b => !b._hasOsmBj);

  if (withYear.length >= 3) {
    // Max-Suchradius: ~400 m in Grad (~0.004°)
    const MAX_D2 = 0.004 * 0.004;
    const N = 5;

    withoutYear.forEach(b => {
      // Nächste N Nachbarn mit bekanntem Baujahr (nur innerhalb Suchradius)
      const nearby = [];
      for (const k of withYear) {
        const d2 = (k._lat - b._lat) ** 2 + (k._lng - b._lng) ** 2;
        if (d2 <= MAX_D2) nearby.push({d2, baujahr: k.baujahr});
      }
      if (nearby.length > 0) {
        nearby.sort((a, x) => a.d2 - x.d2);
        const years = nearby.slice(0, N).map(x => x.baujahr).sort((a, x) => a - x);
        b.baujahr = years[Math.floor(years.length / 2)]; // Median
      } else {
        b.baujahr = defaultBj; // kein Nachbar → Nutzer-Fallback
      }
    });
  } else {
    // Zu wenige Referenzgebäude → Fallback für alle
    withoutYear.forEach(b => { b.baujahr = defaultBj; });
  }

  // Hilfsfelder entfernen
  result.forEach(b => { delete b._hasOsmBj; delete b._lat; delete b._lng; });
  return result;
}

function populateZentraleSelect(){
  const sel = document.getElementById('netz-zentrale');
  if(!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- bitte wählen --</option>';
  gebaeude.forEach(g => {
    if(g.polygon){
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    }
  });
  if(currentVal && gebaeude.some(g => g.id == currentVal)) {
    sel.value = currentVal;
  }
}

function autoGenerateNetz(){
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if(!zId || isNaN(zId)){
    showHint('⚠ Bitte zuerst eine Heizzentrale auswählen!', 5000);
    // Dropdown hervorheben
    const sel = document.getElementById('netz-zentrale');
    if (sel) { sel.style.borderColor = '#e53935'; sel.style.boxShadow = '0 0 8px rgba(229,57,53,0.4)'; sel.focus(); setTimeout(() => { sel.style.borderColor = ''; sel.style.boxShadow = ''; }, 4000); }
    return;
  }

  clearNetz();

  const nodes = gebaeude.filter(g => g.polygon && getComputedStats(g, globalYear).heizlast > 0);
  if(nodes.length < 2) {
    showHint('Es müssen mindestens zwei Gebäude mit Verbrauch gezeichnet sein.');
    return;
  }

  const allPts = nodes.map(g => {
    const stats = getComputedStats(g, globalYear);
    return { id: g.id, type: 'geb', pt: polygonCenter(g.polygon), load: stats.heizlast||0 };
  });

  let tIdCounter = 10000;
  const tNodes = trassePoints.map(pt => ({ id: tIdCounter++, type: 'trasse', pt: pt, load: 0 }));
  allPts.push(...tNodes);

  const possibleEdges = [];
  for(let i=0; i<allPts.length; i++){
    for(let j=i+1; j<allPts.length; j++){
      if(allPts[i].type === 'trasse' && allPts[j].type === 'trasse') continue; 
      possibleEdges.push({ u: allPts[i].id, v: allPts[j].id, uNode: allPts[i], vNode: allPts[j], dist: allPts[i].pt.distanceTo(allPts[j].pt) });
    }
  }

  possibleEdges.sort((a, b) => a.dist - b.dist);

  const parent = {};
  allPts.forEach(n => parent[n.id] = n.id);
  function find(i) {
    if (parent[i] === i) return i;
    return parent[i] = find(parent[i]);
  }
  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
      return true;
    }
    return false;
  }

  const mstEdges = [];

  // Trasse-Knoten segmentweise verbinden (Multi-Branch-Unterstützung)
  const segs = trasseSegments.length > 0 ? trasseSegments : (tNodes.length > 1 ? [{start: 0, end: tNodes.length - 1}] : []);
  segs.forEach(seg => {
    for (let i = seg.start; i < seg.end; i++) {
      const ni = i, nj = i + 1;
      if (ni < tNodes.length && nj < tNodes.length) {
        union(tNodes[ni].id, tNodes[nj].id);
        mstEdges.push({ u: tNodes[ni].id, v: tNodes[nj].id, uNode: tNodes[ni], vNode: tNodes[nj] });
      }
    }
  });

  for(const edge of possibleEdges) {
    if(union(edge.u, edge.v)) {
      mstEdges.push(edge);
    }
  }

  mstEdges.forEach(e => {
    const layer = L.polyline([e.uNode.pt, e.vNode.pt], {color: '#e53935', weight: 4, opacity: 0.8, pane: 'netzPane'});
    const hitLayer = L.polyline([e.uNode.pt, e.vNode.pt], {color: 'transparent', weight: 20, pane: 'netzPane'});
    if (netzVisible) { layer.addTo(map); hitLayer.addTo(map); }
    const edgeObj = {
        u: e.u, v: e.v, uNode: e.uNode, vNode: e.vNode,
        layer: layer, hitLayer: hitLayer, load: 0, dn: 0, length: e.uNode.pt.distanceTo(e.vNode.pt),
        waypoint: null, segLayers: [], warnMarker: null, midMarker: null
    };
    hitLayer.on('click', (ev) => {
      if (isDrawingEdge) return;
      showEdgePopup(edgeObj, ev.originalEvent);
      L.DomEvent.stopPropagation(ev);
    });
    hitLayer.on('contextmenu', () => {
      map.removeLayer(layer);
      map.removeLayer(hitLayer);
      if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
      if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
      if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
      netzEdges = netzEdges.filter(x => x !== edgeObj);
      closeEdgePopup();
      recalcNetz();
    });
    netzEdges.push(edgeObj);
    addEdgeMidHandle(edgeObj);
  });

  applyWaypoints();
  recalcNetz();
  autoAssignEdgeCosts();
  // Haupttrasse nach Netzgenerierung ausblenden
  if (trassePolyline) {
    if (Array.isArray(trassePolyline)) trassePolyline.forEach(p => p.setStyle({opacity: 0}));
    else trassePolyline.setStyle({opacity: 0});
  }
}

function addNetzEdge(u, v){
  const gU = gebaeude.find(g=>g.id===u);
  const gV = gebaeude.find(g=>g.id===v);
  if(!gU || !gV || !gU.polygon || !gV.polygon) return;
  const uLoad = getComputedStats(gU, globalYear).heizlast || 0;
  const vLoad = getComputedStats(gV, globalYear).heizlast || 0;
  if (uLoad === 0) { showHint(`"${gU.name}" hat keinen Verbrauch und kann nicht angeschlossen werden.`); return; }
  if (vLoad === 0) { showHint(`"${gV.name}" hat keinen Verbrauch und kann nicht angeschlossen werden.`); return; }

  if(netzEdges.some(e => (e.u===u&&e.v===v) || (e.u===v&&e.v===u))) return;

  const c1 = polygonCenter(gU.polygon);
  const c2 = polygonCenter(gV.polygon);
  const layer = L.polyline([c1, c2], {color: '#e53935', weight: 4, opacity: 0.8, pane: 'netzPane'});
  const hitLayer = L.polyline([c1, c2], {color: 'transparent', weight: 20, pane: 'netzPane'});
  if (netzVisible) { layer.addTo(map); hitLayer.addTo(map); }

  const uStats = getComputedStats(gU, globalYear);
  const vStats = getComputedStats(gV, globalYear);

  const edgeObj = {
    u: u, v: v,
    uNode: {id: u, type: 'geb', pt: c1, load: uStats.heizlast||0},
    vNode: {id: v, type: 'geb', pt: c2, load: vStats.heizlast||0},
    layer: layer, hitLayer: hitLayer, load: 0, dn: 0,
    _straightLength: c1.distanceTo(c2), length: c1.distanceTo(c2),
    waypoint: null, segLayers: [], warnMarker: null, midMarker: null
  };

  hitLayer.on('click', (ev) => {
    if (isDrawingEdge) return;
    if (netzPruningMode) { toggleEdgePruned(edgeObj); L.DomEvent.stopPropagation(ev); return; }
    showEdgePopup(edgeObj, ev.originalEvent);
    L.DomEvent.stopPropagation(ev);
  });
  hitLayer.on('contextmenu', () => {
    map.removeLayer(layer);
    map.removeLayer(hitLayer);
    if (edgeObj.midMarker) map.removeLayer(edgeObj.midMarker);
    if (edgeObj.warnMarker) map.removeLayer(edgeObj.warnMarker);
    if (edgeObj.segLayers) edgeObj.segLayers.forEach(s => map.removeLayer(s));
    netzEdges = netzEdges.filter(e => e !== edgeObj);
    closeEdgePopup();
    recalcNetz();
  });

  netzEdges.push(edgeObj);
  addEdgeMidHandle(edgeObj);
}

function clearNetz(){
  netzEdges.forEach(e => {
    map.removeLayer(e.layer);
    if(e.hitLayer) map.removeLayer(e.hitLayer);
    if(e.midMarker) map.removeLayer(e.midMarker);
    if(e.warnMarker) map.removeLayer(e.warnMarker);
    if(e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  netzEdges = [];
  selectedStrandId = null;
  const sel = document.getElementById('netz-strang');
  if (sel) sel.value = '';
  updateRohrListe();
  gebaeude.forEach(g => delete g.tempIn);
}

function applyWaypoints() {
  netzEdges.forEach(e => {
    const wp = edgeWaypoints[edgeKey(e.u, e.v)];
    if (!wp) return;
    e.waypoint = L.latLng(wp.lat, wp.lng);
    const ll = e.layer.getLatLngs();
    e.layer.setLatLngs([ll[0], e.waypoint, ll[ll.length - 1]]);
    if (e.hitLayer) e.hitLayer.setLatLngs([ll[0], e.waypoint, ll[ll.length - 1]]);
    if (e.midMarker) e.midMarker.setLatLng(e.waypoint);
  });
}

function abklemmenGebaeude(id) {
  const toRemove = netzEdges.filter(e => e.u === id || e.v === id);
  toRemove.forEach(e => {
    if (map.hasLayer(e.layer)) map.removeLayer(e.layer);
    if (e.hitLayer && map.hasLayer(e.hitLayer)) map.removeLayer(e.hitLayer);
    if (e.midMarker) map.removeLayer(e.midMarker);
    if (e.warnMarker) map.removeLayer(e.warnMarker);
    if (e.segLayers) e.segLayers.forEach(s => { if(map.hasLayer(s)) map.removeLayer(s); });
  });
  netzEdges = netzEdges.filter(e => e.u !== id && e.v !== id);
  closeEdgePopup();
  recalcNetz();
  renderList();
}

function setNetzVisible(visible) {
  netzVisible = visible;
  netzEdges.forEach(e => {
    const layers = [e.layer, e.hitLayer, e.midMarker, e.warnMarker, ...(e.segLayers||[])].filter(Boolean);
    layers.forEach(l => {
      if (visible) { if (!map.hasLayer(l)) map.addLayer(l); }
      else { if (map.hasLayer(l)) map.removeLayer(l); }
    });
  });
  // Beide Checkboxen synchron halten
  const cb1 = document.getElementById('netz-visible');
  const cb2 = document.getElementById('netz-visible-ansicht');
  if (cb1) cb1.checked = visible;
  if (cb2) cb2.checked = visible;
}

function syncVLTemps(source) {
  if (source === 'netz') {
    document.getElementById('gl-vl5').value = document.getElementById('netz-vl').value;
    document.getElementById('gl-vl15').value = document.getElementById('netz-rl').value;
  } else {
    document.getElementById('netz-vl').value = document.getElementById('gl-vl5').value;
    document.getElementById('netz-rl').value = document.getElementById('gl-vl15').value;
  }
}

function recalcNetz(){
  const gebMap = new Map(gebaeude.map(g => [g.id, g]));
  // Auto-GK neu berechnen wenn Netz entsteht oder sich ändert
  if (typeof updateAllDeckungen === 'function') updateAllDeckungen();
  gebaeude.forEach(g => delete g.tempIn);

  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if(!zId || isNaN(zId)) {
    gebaeude.forEach(g => { g.netzVerlustKW = null; g.netzVerlustRatioPct = null; g.netzVerlustJahrMWh = null; });
    updateStrandDropdown();
    updateRohrListe();
    return;
  }

  let vlTemp = parseFloat(document.getElementById('netz-vl').value) || 90;
  let rlTemp = parseFloat(document.getElementById('netz-rl').value) || 60;

  const planJahr = parseInt(document.getElementById('netz-plan-jahr').value);
  if (planJahr && globalYear >= planJahr) {
    vlTemp = parseFloat(document.getElementById('netz-plan-vl').value) || vlTemp;
    rlTemp = parseFloat(document.getElementById('netz-plan-rl').value) || rlTemp;
  }

  const dt = Math.max(1, vlTemp - rlTemp);
  const vFlow = parseFloat(document.getElementById('netz-v').value) || 1.0;

  // Gleichzeitigkeitsfaktor (GZF) für Wärmenetz
  const wGzfMethode = document.getElementById('netz-gzf-methode')?.value || 'richtwert';
  const wGzfManuell = parseFloat(document.getElementById('netz-gzf-manuell')?.value) || 0.6;
  function _wGzf(nVerbraucher) {
    if (wGzfMethode === 'keine') return 1.0;
    if (wGzfMethode === 'manuell') return Math.max(0.1, Math.min(1.0, wGzfManuell));
    // Richtwert Wärme: 1/n^0.15 (AGFW-Näherung, flacher als Strom,
    // da Heizbedarf stark wetterkorreliert — bei Auslegungstemp. heizen fast alle)
    if (nVerbraucher <= 1) return 1.0;
    return Math.max(0.45, 1.0 / Math.pow(nVerbraucher, 0.15));
  }

  const nodeMap = {};
  const zGeb = gebMap.get(zId);
  if(zGeb) {
      nodeMap[zId] = { id: zId, load: getComputedStats(zGeb, globalYear).heizlast||0, adj: [] };
      zGeb.tempIn = vlTemp;
  }

  netzEdges.forEach(e => {
    if (e.pruned) { e.load = 0; e.loadRaw = 0; e.dn = 0; e.lossKW = 0; e.lossKW_annual = 0; return; }
    let uLoad = 0; if (e.uNode && e.uNode.type === 'geb') { const gu=gebMap.get(e.u); if(gu && !isExcluded(gu.id)) uLoad = getComputedStats(gu, globalYear).heizlast||0; }
    let vLoad = 0; if (e.vNode && e.vNode.type === 'geb') { const gv=gebMap.get(e.v); if(gv && !isExcluded(gv.id)) vLoad = getComputedStats(gv, globalYear).heizlast||0; }

    if(!nodeMap[e.u]) nodeMap[e.u] = { id: e.u, load: uLoad, adj: [] };
    if(!nodeMap[e.v]) nodeMap[e.v] = { id: e.v, load: vLoad, adj: [] };

    nodeMap[e.u].adj.push({ to: e.v, edge: e, ptTo: (e.vNode?e.vNode.pt:null) });
    nodeMap[e.v].adj.push({ to: e.u, edge: e, ptTo: (e.uNode?e.uNode.pt:null) });
  });

  const order = [];
  const parentEdge = {};
  const visited = new Set([zId]);
  const queue = [zId];

  while(queue.length > 0){
    const curr = queue.shift();
    order.push(curr);
    if(nodeMap[curr]){
        nodeMap[curr].adj.forEach(neighbor => {
          if(!visited.has(neighbor.to)){
            visited.add(neighbor.to);
            parentEdge[neighbor.to] = { e: neighbor.edge, pNodeId: curr };
            queue.push(neighbor.to);
          }
        });
    }
  }

  const neighborsOfZ = nodeMap[zId] ? nodeMap[zId].adj.map(a => a.to).sort((a,b)=>a-b) : [];
  netzEdges.forEach(e => {
    if (e.u === zId || e.v === zId) {
      const other = e.u === zId ? e.v : e.u;
      e.strandId = Math.max(0, neighborsOfZ.indexOf(other));
    }
  });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const e = parentEdge[nodeId].e;
    if (e.strandId != null) return;
    const pNodeId = parentEdge[nodeId].pNodeId;
    e.strandId = (parentEdge[pNodeId] && parentEdge[pNodeId].e.strandId != null)
      ? parentEdge[pNodeId].e.strandId
      : 0;
  });
  netzEdges.forEach(e => { if (e.strandId == null) e.strandId = 0; });

  netzEdges.forEach(e => { e.load = 0; e.loadRaw = 0; e._nVerbraucher = 0; e._gzf = 1.0; });

  // Summierte Rohlasten und Verbraucheranzahl pro Knoten
  // calculatedLoad bleibt global zugänglich für lwwpUseNetworkValues etc.
  calculatedLoad = {};
  const nVerb = {};
  Object.keys(nodeMap).forEach(k => {
    calculatedLoad[k] = nodeMap[k].load;
    const isVerb = nodeMap[k].load > 0;
    nVerb[k] = isVerb ? 1 : 0;
  });

  for(let i = order.length - 1; i > 0; i--){
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if(pInfo){
      calculatedLoad[pInfo.pNodeId] += calculatedLoad[curr];
      nVerb[pInfo.pNodeId] += nVerb[curr];
      // Kante: Rohlast (Σ Normheizlast) und GZF-Last
      const nV = nVerb[curr];
      const raw = calculatedLoad[curr];
      const gzfVal = _wGzf(nV);
      pInfo.e.loadRaw = raw;
      pInfo.e.load = raw * gzfVal;
      pInfo.e._nVerbraucher = nV;
      pInfo.e._gzf = gzfVal;

      let ptP = null;
      let ptC = null;
      if(pInfo.e.u === pInfo.pNodeId) { ptP = pInfo.e.uNode?.pt; ptC = pInfo.e.vNode?.pt; }
      else { ptP = pInfo.e.vNode?.pt; ptC = pInfo.e.uNode?.pt; }

      if(!ptP || !ptC){
         const bP = gebMap.get(pInfo.pNodeId);
         const bC = gebMap.get(curr);
         if(bP&&bP.polygon) ptP = polygonCenter(bP.polygon);
         if(bC&&bC.polygon) ptC = polygonCenter(bC.polygon);
      }
      if(ptP && ptC) {
          const wpt = pInfo.e.waypoint;
          const newPts = wpt ? [ptP, wpt, ptC] : [ptP, ptC];
          pInfo.e.layer.setLatLngs(newPts);
          if(pInfo.e.hitLayer) pInfo.e.hitLayer.setLatLngs(newPts);
      }
      // Länge aktualisieren (echte Polyline-Länge inkl. Waypoints)
      pInfo.e.length = calcEdgeLength(pInfo.e);
    }
  }

  const cp = 4.184;
  // Rohr-Dimensionierung mit DN-abhängiger Fließgeschwindigkeit (2 Iterationen für Konvergenz)
  for (let iter = 0; iter < 2; iter++) {
    netzEdges.forEach(e => {
      if(e.load > 0){
        const vEff = e.dn > 0 ? getVFlowForDN(e.dn, vFlow) : vFlow;
        const mDot = e.load / (cp * dt);
        const reqArea = (mDot / 1000) / vEff;
        const reqDMm = Math.sqrt(4 * reqArea / Math.PI) * 1000;

        if (!networkLocked || e.dn === 0) {
            e.dn = standardDNs.find(dn => dn >= reqDMm) || standardDNs[standardDNs.length - 1];
        }
      } else {
        e.dn = 0;
      }
    });
  }

  // ── Druckverluste (Darcy-Weisbach vereinfacht mit R-Wert) ──────────────
  // R = Druckverlust pro Meter [Pa/m], abhängig von DN, Volumenstrom, Rauigkeit
  // Formel: R = (lambda * rho * v^2) / (2 * d_i)  mit lambda aus Moody (vereinfacht)
  const rhoWater = 975; // kg/m³ bei ~70°C
  const nuWater = 0.000000415; // kinematische Viskosität m²/s bei ~70°C
  const kRough = 0.00005; // Rohrrauhigkeit Stahl/KMR [m]

  netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      const dInner = (e.dn / 1000); // Innendurchmesser in m (DN ≈ Innendurchmesser bei KMR)
      const aInner = Math.PI * Math.pow(dInner / 2, 2);
      const vEff = getVFlowForDN(e.dn, vFlow);
      const mDot = e.load / (cp * dt); // kg/s
      const vActual = (mDot / rhoWater) / aInner; // tatsächliche Fließgeschwindigkeit m/s

      // Reynolds-Zahl
      const Re = vActual * dInner / nuWater;

      // Rohrreibungszahl lambda (Colebrook-White Näherung nach Swamee-Jain)
      let lambda;
      if (Re < 2300) {
        lambda = 64 / Math.max(Re, 100); // laminar
      } else {
        const term = kRough / (3.7 * dInner) + 5.74 / Math.pow(Re, 0.9);
        lambda = 0.25 / Math.pow(Math.log10(term), 2);
      }

      // Druckverlust pro Meter [Pa/m] — Vorlauf + Rücklauf = Faktor 2
      e.dpPerM = lambda * rhoWater * Math.pow(vActual, 2) / (2 * dInner); // Pa/m, eine Leitung
      e.dpTotal = e.dpPerM * e.length * 2; // Pa, VL+RL
      e._vActual = vActual;
      e._reynolds = Re;
      e._lambda = lambda;
    } else {
      e.dpPerM = 0;
      e.dpTotal = 0;
      e._vActual = 0;
      e._reynolds = 0;
      e._lambda = 0;
    }
  });

  // Kritischer Pfad: maximaler Druckverlust von Zentrale zu einem Abnehmer
  let maxPathDp = 0;
  let maxPathNode = null;
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    let pathDp = 0;
    let curr = nodeId;
    while (parentEdge[curr]) {
      pathDp += parentEdge[curr].e.dpTotal || 0;
      curr = parentEdge[curr].pNodeId;
    }
    // Hausstationsdruckverlust: ~30 kPa pro Übergabestation
    const bNode = gebMap.get(nodeId);
    if (bNode && nodeMap[nodeId] && nodeMap[nodeId].load > 0) {
      pathDp += 30000; // 30 kPa Hausstation
    }
    if (pathDp > maxPathDp) {
      maxPathDp = pathDp;
      maxPathNode = nodeId;
    }
  });

  // Pumpenparameter
  const foerderhoehePa = maxPathDp; // Pa
  const foerderhoeheMWS = foerderhoehePa / 9810; // mWS (Meter Wassersäule)
  const foerderhoeheBar = foerderhoehePa / 100000; // bar
  // Volumenstrom an der Zentrale (gesamter Netzvolumenstrom)
  const zentraleEdges = netzEdges.filter(e => e.u === zId || e.v === zId);
  const totalLoadKW = zentraleEdges.reduce((s, e) => s + (e.load || 0), 0);
  const mDotGesamt = totalLoadKW / (cp * dt); // kg/s
  const vDotGesamt = mDotGesamt / rhoWater; // m³/s
  // Pumpenleistung: P = (V̇ * Δp) / η_pumpe
  // Gesamtwirkungsgrad (Motor × Hydraulik × Mechanik) leistungsabhängig gestaffelt
  // Quellen: Wilo/Grundfos Datenblätter, Hocheffizienz-Nassläufer IE4/IE5
  const pHydraulisch = vDotGesamt * foerderhoehePa; // hydraulische Leistung [W]
  const pHydKW = pHydraulisch / 1000;
  let etaPumpe;
  if (pHydKW < 0.1)       etaPumpe = 0.25; // Kleinstpumpen (< 100 W hydr.)
  else if (pHydKW < 0.5)  etaPumpe = 0.40; // kleine Umwälzpumpen
  else if (pHydKW < 2)    etaPumpe = 0.55; // kleine Nahwärmenetze
  else if (pHydKW < 10)   etaPumpe = 0.65; // mittlere Netze
  else if (pHydKW < 50)   etaPumpe = 0.73; // größere Quartiere
  else if (pHydKW < 200)  etaPumpe = 0.78; // große Netze, optimaler Betriebspunkt
  else                     etaPumpe = 0.82; // Großpumpen (> 200 kW hydr.)

  const pumpenLeistungW = pHydraulisch / etaPumpe;
  const pumpenLeistungKW = pumpenLeistungW / 1000;

  // Ergebnisse am recalcNetz-Scope verfügbar machen
  window._netzPumpe = {
    kritPfadDp: foerderhoehePa,
    foerderhoeheMWS: foerderhoeheMWS,
    foerderhoeheBar: foerderhoeheBar,
    pumpenLeistungKW: pumpenLeistungKW,
    etaPumpe: etaPumpe,
    mDotGesamt: mDotGesamt,
    vDotGesamt: vDotGesamt * 3600, // m³/h
    maxPathNode: maxPathNode
  };

  const tAussen = parseFloat(document.getElementById('netz-t-aussen').value) ?? -12;
  const tMittel = parseFloat(document.getElementById('netz-t-mittel').value) ?? 10;
  const uWertBase = parseFloat(document.getElementById('netz-u-wert').value) || 0.25;
  const tMeanPipe = (vlTemp + rlTemp) / 2;
  const deltaT = tMeanPipe - tAussen;
  const deltaTMittel = tMeanPipe - tMittel;

  let totalLossKW = 0;
  netzEdges.forEach(e => {
    if (e.load > 0 && e.length > 0) {
      // DN-abhängiger U-Wert (größere Rohre besser gedämmt)
      const uWert = getUWertForDN(e.dn, uWertBase);
      e.lossKW = uWert * e.length * deltaT / 1000;
      e.lossKW_annual = uWert * e.length * deltaTMittel / 1000;
      e.lossPerM = uWert * deltaT;
      e._uWert = uWert;  // für Tooltip
      totalLossKW += e.lossKW;
    } else {
      e.lossKW = 0;
      e.lossKW_annual = 0;
      e.lossPerM = 0;
      e._uWert = 0;
    }
  });

  const totalLossKW_annual = netzEdges.reduce((s, e) => s + (e.lossKW_annual || 0), 0);
  const totalLossJahrMWh = totalLossKW_annual * 8.76;
  const connectedIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const totalVerbrauchMWh = gebaeude.filter(g => connectedIds.has(g.id)).reduce((s, g) => s + (parseFloat(g.waerme) || 0), 0);
  const totalErzeugungMWh = totalLossJahrMWh + totalVerbrauchMWh;
  const lossPct = totalVerbrauchMWh > 0 ? (totalLossJahrMWh / totalErzeugungMWh * 100).toFixed(1) : '—';
  const lossDisp = document.getElementById('netz-loss-display');
  if (lossDisp) lossDisp.textContent = `Netzverluste: ${totalLossKW.toFixed(1)} kW | ${totalLossJahrMWh.toFixed(0)} MWh/a (${lossPct} % der Erzeugung) | ΔT: ${deltaT.toFixed(0)} K`;
  const summaryDiv = document.getElementById('netz-summary');
  if (summaryDiv) {
    if (totalVerbrauchMWh > 0) {
      summaryDiv.style.display = 'grid';
      summaryDiv.innerHTML = `<span style="color:var(--muted)">Gebäudebedarf</span><span>${totalVerbrauchMWh.toFixed(0)} MWh/a</span><span style="color:var(--muted)">+ Netzverluste</span><span style="color:#f9a825">${totalLossJahrMWh.toFixed(0)} MWh/a</span><span style="color:var(--muted);border-top:1px solid var(--border);padding-top:3px;margin-top:2px">= Zentrale erzeugt</span><span style="color:var(--accent);font-weight:bold;border-top:1px solid var(--border);padding-top:3px;margin-top:2px">${totalErzeugungMWh.toFixed(0)} MWh/a</span>`;
    } else {
      summaryDiv.style.display = 'none';
    }
  }

  nodeMap[zId].tempIn = vlTemp;

  for(let i = 0; i < order.length; i++){
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if(pInfo){
      const edge = pInfo.e;
      const mDot = edge.load / (cp * dt); 
      let drop = 0;
      if (mDot > 0.001) drop = edge.lossKW / (mDot * cp);
      
      const rawTempOut = nodeMap[pInfo.pNodeId].tempIn - drop;
      edge.tempIn = nodeMap[pInfo.pNodeId].tempIn;
      edge.tempOut = rawTempOut;
      edge.thermischKritisch = rawTempOut < rlTemp;
      nodeMap[curr].tempIn = Math.max(rawTempOut, tAussen);

      const bC = gebMap.get(curr);
      if(bC) bC.tempIn = nodeMap[curr].tempIn;
    }
  }

  // Per-Gebäude: zugerechnete Netzverluste (proportional nach Wärmestromanteil)
  gebaeude.forEach(g => { g.netzVerlustKW = null; g.netzVerlustRatioPct = null; g.netzVerlustJahrMWh = null; });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const g = gebMap.get(nodeId);
    if (!g) return;
    const bLoad = getComputedStats(g, globalYear).heizlast || 0;
    if (bLoad <= 0) return;
    let attributed = 0;
    let attributedAnnual = 0;
    let curr = nodeId;
    while (parentEdge[curr]) {
      const edge = parentEdge[curr].e;
      if (edge.loadRaw > 0 && edge.lossKW > 0) {
        const frac = bLoad / edge.loadRaw;
        attributed += edge.lossKW * frac;
        attributedAnnual += (edge.lossKW_annual || edge.lossKW) * frac;
      }
      curr = parentEdge[curr].pNodeId;
    }
    g.netzVerlustKW = Math.round(attributed * 100) / 100;
    g.netzVerlustJahrMWh = Math.round(attributedAnnual * 8.76 * 10) / 10;
    const waermeJahr = parseFloat(g.waerme) || 0;
    g.netzVerlustRatioPct = waermeJahr > 0 ? Math.round(g.netzVerlustJahrMWh / waermeJahr * 1000) / 10 : null;
  });

  // Kosten vorab berechnen (wird für Subtree-Analyse benötigt)
  netzEdges.forEach(e => {
    if ((e.load > 0 || e.loadRaw > 0) && e.dn > 0) {
      e.kosten = getKostenProM(e.dn, e.kostKlasse) * e.length;
    } else {
      e.kosten = 0;
    }
  });

  // ── Subtree-WLD + Wirtschaftlichkeit pro Kante ──────────────────────────
  // Für jede Kante: welche Wärme + Länge liegt im Subtree dahinter?
  const VBH = 1800;
  const subtreeLoad = {};   // nodeId → kW im Subtree (inkl. eigener Last)
  const subtreeLength = {}; // nodeId → Trassenmeter ab hier
  const subtreeKosten = {}; // nodeId → Investition im Subtree
  const subtreeLoss = {};   // nodeId → jährliche Verluste im Subtree (MWh)

  // Init: jeder Knoten = eigene Last
  Object.keys(nodeMap).forEach(k => {
    subtreeLoad[k] = nodeMap[k].load;
    subtreeLength[k] = 0;
    subtreeKosten[k] = 0;
    subtreeLoss[k] = 0;
  });

  // Rückwärts akkumulieren (Blätter → Wurzel)
  for (let i = order.length - 1; i > 0; i--) {
    const curr = order[i];
    const pInfo = parentEdge[curr];
    if (!pInfo) continue;
    const edge = pInfo.e;
    const parent = pInfo.pNodeId;
    subtreeLoad[parent]   += subtreeLoad[curr];
    subtreeLength[parent] += subtreeLength[curr] + edge.length;
    subtreeKosten[parent] += subtreeKosten[curr] + (edge.kosten || 0);
    subtreeLoss[parent]   += subtreeLoss[curr] + (edge.lossKW_annual || 0) * 8.76;
  }

  // Auf Kanten übertragen: Subtree-Werte = Werte des Kindknotens
  netzEdges.forEach(e => { e.subtreeWLD = 0; e.subtreeKosten = 0; e.subtreeDeltaWGK = 0; e.subtreeConsumers = 0; e.subtreeWaermeMWh = 0; e.subtreeLength = 0; });
  order.forEach(nodeId => {
    if (nodeId === zId || !parentEdge[nodeId]) return;
    const edge = parentEdge[nodeId].e;
    const stLen = subtreeLength[nodeId] + edge.length;
    const stLoadKW = subtreeLoad[nodeId];
    const stWaerme = stLoadKW * VBH / 1000;
    edge.subtreeWLD = stLen > 0 ? stWaerme / stLen : 0;
    edge.subtreeKosten = subtreeKosten[nodeId] + (edge.kosten || 0);
    edge.subtreeWaermeMWh = stWaerme;
    edge.subtreeLength = stLen;
    edge.subtreeLoss = subtreeLoss[nodeId] + (edge.lossKW_annual || 0) * 8.76;
    // Verbraucher zählen
    let consumers = 0;
    const countSub = (nId) => {
      if (nId !== zId && nodeMap[nId] && nodeMap[nId].load > 0) consumers++;
      if (nodeMap[nId]) nodeMap[nId].adj.forEach(a => { if (parentEdge[a.to] && parentEdge[a.to].pNodeId === nId) countSub(a.to); });
    };
    countSub(nodeId);
    edge.subtreeConsumers = consumers;
  });

  // ── Strang-Netzkosten-Zuschlag (€/MWh) ─────────────────────────────────
  // "Was kostet es zusätzlich zur Erzeugung, diesen Strang über das Netz zu versorgen?"
  // Bestand (networkLocked): nur laufende Verlustkosten (Rohre sind schon bezahlt)
  // Neubau (!networkLocked): Rohr-Annuität + Verlustkosten
  const _netzZins = (parseFloat(document.getElementById('wirt-zins')?.value) || 2.7) / 100;
  const _netzN = 50;  // Nutzungsdauer Wärmenetz nach VDI 2067 (konsistent mit Wirtschaftlichkeits-Panel)
  const annFaktor = _netzZins > 0 ? _netzZins * Math.pow(1 + _netzZins, _netzN) / (Math.pow(1 + _netzZins, _netzN) - 1) : 1 / _netzN;
  // Erzeugungskosten an der Zentrale (€/MWh) – für Verlustbewertung
  const wgkZentraleEl = document.getElementById('fs-wgk');
  const wgkZentrale = parseFloat(wgkZentraleEl?.textContent) || 80;

  netzEdges.forEach(e => {
    if (e.subtreeWaermeMWh > 0) {
      const strangVerlustKosten = (e.subtreeLoss || 0) * wgkZentrale;  // MWh/a × €/MWh = €/a

      let strangJahrKosten;
      if (networkLocked) {
        // Bestandsnetz: Rohre bereits verlegt → nur Verlustkosten relevant
        strangJahrKosten = strangVerlustKosten;
      } else {
        // Neubaunetz: Rohr-Annuität + Verlustkosten
        const strangAnnuitaet = e.subtreeKosten * annFaktor;  // €/a
        strangJahrKosten = strangAnnuitaet + strangVerlustKosten;
      }

      e._strangNetzZuschlag = strangJahrKosten / e.subtreeWaermeMWh;  // €/MWh
      // Verlust-Ratio: Subtree-Verluste / Subtree-Wärmebedarf
      e._strangVerlustRatio = e.subtreeWaermeMWh > 0 ? (e.subtreeLoss || 0) / e.subtreeWaermeMWh : 0;
    } else {
      e._strangNetzZuschlag = 0;
      e._strangVerlustRatio = 0;
    }
  });

  netzEdges.forEach(e => {
    const targetLayer = e.hitLayer || e.layer;

    if(e.load > 0){
      const actualArea = Math.PI * Math.pow((e.dn / 1000) / 2, 2);
      const mDot = e.load / (cp * dt); 
      const actualVel = (mDot / 1000) / actualArea;
      const maxMDot = actualArea * vFlow * 1000;
      const maxLoad = maxMDot * cp * dt;
      const auslastung = (e.load / maxLoad) * 100;

      const wld = getWLD(e);
      const wldColor = getWLDColor(wld);
      const w = Math.max(1.5, Math.min(5, 1 + e.dn / 50));

      let pColor = getEdgeColor(e, vlTemp, dt, vFlow);
      if (networkLocked && auslastung > 110) pColor = '#f44336';

      const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
      e.layer.setStyle({weight: dim ? 2 : w, color: pColor, opacity: dim ? 0.2 : 0.8});

      // Kosten berechnen (per-edge override oder globales Szenario)
      const kostenProM = getKostenProM(e.dn, e.kostKlasse);
      const kostenGesamt = kostenProM * e.length;
      e.kosten = kostenGesamt;
      // Badge-Farbe für Kostenklasse
      const kBadgeColor = {niedrig:'#4caf50',mittel:'#4fc3f7',hoch:'#e53935'}[e.kostKlasse||kostenSzenario]||'#4fc3f7';

      const _m = '<span style="color:var(--muted);font-size:9px">';
      const _me = '</span>';
      const _sep = '<div style="border-top:1px solid #444;margin:5px 0 4px;padding-top:4px;">';
      const _grp = (icon, title) => `${_sep}<span style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.04em">${icon} ${title}</span></div>`;

      // ── 1. LEITUNG ──
      let ttHtml = _grp('', 'Leitung');
      ttHtml += `KMR DN ${e.dn} · ${Math.round(e.length)} m<br>`;
      // Normheizlast (Summe aller Gebäude hinter diesem Abschnitt)
      if (wGzfMethode !== 'keine' && e._nVerbraucher > 1) {
        ttHtml += `Normheizlast (Σ ${e._nVerbraucher} Gebäude): ${e.loadRaw.toFixed(1)} kW<br>`;
        ttHtml += `Auslegungslast (GZF ${e._gzf.toFixed(2)}): <span style="font-weight:normal;color:var(--accent)">${e.load.toFixed(1)} kW</span><br>`;
        ttHtml += `${_m}GZF berücksichtigt, dass nie alle Gebäude gleichzeitig Volllast heizen${_me}<br>`;
      } else {
        ttHtml += `Last (Σ ${e._nVerbraucher} Gebäude): ${e.load.toFixed(1)} kW<br>`;
      }
      if (networkLocked) {
        ttHtml += `Auslastung: ${auslastung.toFixed(1)} % · ${actualVel.toFixed(2)} m/s<br>`;
        ttHtml += `${_m}Kapazität: ${maxLoad.toFixed(0)} kW bei ${vFlow} m/s Auslegungsgeschwindigkeit${_me}<br>`;
      }

      // ── 2. THERMIK ──
      if (e.lossKW !== undefined && e.tempOut !== undefined) {
        ttHtml += _grp('', 'Wärmetransport');
        // Verluste dieses Abschnitts
        const lossJahrMwh = (e.lossKW_annual || e.lossKW) * 8.76;
        const lossPctEdge = e.loadRaw > 0 ? (e.lossKW / e.loadRaw * 100) : 0;
        ttHtml += `Wärmeverlust: ${e.lossKW.toFixed(1)} kW (${e.lossPerM.toFixed(1)} W/m)<br>`;
        ttHtml += `${_m}${lossJahrMwh.toFixed(1)} MWh/a gehen auf ${Math.round(e.length)} m durch die Rohrdämmung verloren (${lossPctEdge.toFixed(1)} % der transportierten Leistung)${_me}<br>`;
        // Temperatur
        ttHtml += `Temperatur: ${e.tempIn.toFixed(1)} → ${e.tempOut.toFixed(1)} °C (−${(e.tempIn - e.tempOut).toFixed(1)} K)<br>`;
        ttHtml += `${_m}Vorlauf kühlt auf dem Weg zum Verbraucher ab${_me}<br>`;
        if (e.thermischKritisch) {
          ttHtml += `<span style="color:#f44336;font-size:10px;">⚠ Ankunftstemperatur unter Rücklauf — Strang nicht versorgbar!</span><br>`;
        } else if (e.tempOut < 60) {
          ttHtml += `<span style="color:#f44336;font-size:10px;">⚠ Temp. unter 60 °C — Legionellengefahr</span><br>`;
        }
        // Druckverlust
        if (e.dpPerM > 0) {
          const dpColor = e.dpPerM < 100 ? '#4caf50' : e.dpPerM < 200 ? '#8bc34a' : e.dpPerM < 300 ? '#f9a825' : '#e53935';
          ttHtml += `Druckverlust: <span style="color:${dpColor}">${e.dpPerM.toFixed(0)} Pa/m</span> · ${(e.dpTotal/1000).toFixed(1)} kPa gesamt<br>`;
          ttHtml += `${_m}Reibungsverlust im Rohr, bestimmt die benötigte Pumpenleistung${_me}<br>`;
        }
      }

      // ── 3. WIRTSCHAFTLICHKEIT ──
      ttHtml += _grp('', 'Wirtschaftlichkeit');
      ttHtml += `Kosten: ${kostenProM.toLocaleString('de-DE')} €/m (${kostenSzenario}) → <span style="color:#4fc3f7">${Math.round(kostenGesamt).toLocaleString('de-DE')} €</span><br>`;
      const wldLabel = wld < 0.5 ? '⚠ unwirtschaftlich' : wld < 1.0 ? 'grenzwertig' : wld < 2.0 ? 'wirtschaftlich' : '✓ sehr wirtschaftlich';
      ttHtml += `WLD: <span style="color:${wldColor}">${wld.toFixed(2)} MWh/(m·a)</span> — ${wldLabel}<br>`;
      ttHtml += `${_m}Wärmeliniendichte: transportierte Jahreswärme pro Meter Trasse${_me}<br>`;

      // ── 4. STRANG AB HIER ──
      if (e.subtreeWaermeMWh > 0) {
        const swldColor = getWLDColor(e.subtreeWLD);
        const verlustPct = (e._strangVerlustRatio * 100);
        const verlustColor = verlustPct < 5 ? '#4caf50' : verlustPct < 10 ? '#8bc34a' : verlustPct < 20 ? '#f9a825' : verlustPct < 40 ? '#ef6c00' : '#e53935';
        const nzColor = (e._strangNetzZuschlag || 0) <= 5 ? '#4caf50' : (e._strangNetzZuschlag || 0) <= 15 ? '#8bc34a' : (e._strangNetzZuschlag || 0) <= 30 ? '#f9a825' : (e._strangNetzZuschlag || 0) <= 60 ? '#ef6c00' : '#e53935';
        ttHtml += _grp('', `Strang ab hier${networkLocked ? ' (Bestand)' : ' (Neubau)'}`);
        ttHtml += `${e.subtreeConsumers} Verbraucher · ${Math.round(e.subtreeLength)} m · ${e.subtreeWaermeMWh.toFixed(0)} MWh/a<br>`;
        ttHtml += `Strang-WLD: <span style="color:${swldColor}">${e.subtreeWLD.toFixed(2)} MWh/(m·a)</span><br>`;
        ttHtml += `${_m}Wirtschaftlichkeit des gesamten Teilnetzes hinter diesem Punkt${_me}<br>`;
        ttHtml += `Verluste: <span style="color:${verlustColor}">${verlustPct.toFixed(1)} %</span> der Strang-Wärme<br>`;
        ttHtml += `${_m}Anteil der Wärme, der auf dem Weg zu den Verbrauchern verloren geht${_me}<br>`;
        if (!networkLocked) {
          ttHtml += `Investition: ${Math.round(e.subtreeKosten).toLocaleString('de-DE')} €<br>`;
        }
        ttHtml += `Netzkosten-Zuschlag: <span style="color:${nzColor}">${(e._strangNetzZuschlag || 0).toFixed(1)} €/MWh</span>`;
        if (networkLocked) {
          ttHtml += ` ${_m}(nur Verlustkosten)${_me}`;
        } else {
          ttHtml += `<br>${_m}Mehrkosten pro MWh durch Rohrbau (Annuität) + Wärmeverluste${_me}`;
        }
      }

      targetLayer.bindTooltip(ttHtml, {sticky: true, className:'geb-tooltip'});

      // Gradient
      if (netzColorMode === 'temp' || netzColorMode === 'abkuehlung') {
        drawEdgeGradient(e, vlTemp, dt, vFlow);
      } else {
        clearEdgeGradient(e);
      }

      // Warndreieck bei Überlastung
      const showWarn = auslastung > 100;
      const midPt = getEdgeMidDisplayPt(e);
      if (showWarn) {
        if (!e.warnMarker) {
          const warnIcon = L.divIcon({className:'', html:'<div class="netz-warn-icon">⚠</div>', iconSize:[20,20], iconAnchor:[10,10]});
          e.warnMarker = L.marker(midPt, {icon: warnIcon, interactive: false, zIndexOffset: 2500});
          if (netzVisible) e.warnMarker.addTo(map);
        } else {
          e.warnMarker.setLatLng(midPt);
          if (netzVisible && !map.hasLayer(e.warnMarker)) e.warnMarker.addTo(map);
        }
      } else {
        if (e.warnMarker) { map.removeLayer(e.warnMarker); e.warnMarker = null; }
      }

    } else {
      clearEdgeGradient(e);
      if (e.warnMarker) { map.removeLayer(e.warnMarker); e.warnMarker = null; }
      const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
      e.layer.setStyle({weight: 2, color: '#999', dashArray: '6, 4', opacity: dim ? 0.2 : 0.8});
      targetLayer.bindTooltip(`<span style="font-weight:normal">0 kW (inaktiv/Ringleitung)</span>`, {sticky: true, className:'geb-tooltip'});
    }

    // midMarker position aktualisieren (wenn kein manueller Waypoint)
    if (e.midMarker && !e.waypoint) {
      e.midMarker.setLatLng(getEdgeMidDisplayPt(e));
    }
  });

  updateStrandDropdown();
  updateStrangReport();
  updateNetzColorLegend();
  updateRohrListe();
  if (currentMode === 'verlust') updateViz();
  if (fliessgewaesser) redrawFliessgewaesser();
  if (gasKessel) redrawGasKessel();
  cacheVariantResults();
  // Pipe-Animation nur starten wenn aktive Kanten vorhanden
  if (netzEdges.some(e => e.load > 0)) startAnimPipes(); else stopAnimPipes();
}

function updateStrandDropdown() {
  const sel = document.getElementById('netz-strang');
  if (!sel) return;
  const strands = [...new Set(netzEdges.map(e => e.strandId).filter(id => id != null))].sort((a,b)=>a-b);
  const current = sel.value === '' ? null : parseInt(sel.value, 10);
  sel.innerHTML = '<option value="">Alle Stränge</option>' + strands.map(i => `<option value="${i}" ${current === i ? 'selected' : ''}>Strang ${i + 1}</option>`).join('');
}

function updateStrangReport() {
  const el = document.getElementById('strang-report');
  if (!el) return;
  const zId = parseInt(document.getElementById('netz-zentrale').value);
  if (!zId || netzEdges.length === 0) { el.style.display = 'none'; return; }

  // Strang-Wurzelkanten finden (direkt an Zentrale angeschlossen)
  const wurzelKanten = netzEdges.filter(e => (e.u === zId || e.v === zId) && e.load > 0);
  if (wurzelKanten.length === 0) { el.style.display = 'none'; return; }

  // Strangdaten sammeln
  const straenge = wurzelKanten.map(e => {
    const verlustPct = e.subtreeWaermeMWh > 0 ? ((e.subtreeLoss || 0) / e.subtreeWaermeMWh * 100) : 0;
    const netzZuschlag = e._strangNetzZuschlag || 0;
    // Ampel: grün ≤15, gelb ≤40, rot >40 €/MWh
    let ampel = 'g';
    if (netzZuschlag > 40) ampel = 'r';
    else if (netzZuschlag > 15) ampel = 'y';
    return {
      id: e.strandId,
      waerme: e.subtreeWaermeMWh || 0,
      trasse: e.subtreeLength || 0,
      invest: e.subtreeKosten || 0,
      verlust: e.subtreeLoss || 0,
      verlustPct,
      zuschlag: netzZuschlag,
      consumers: e.subtreeConsumers || 0,
      wld: e.subtreeWLD || 0,
      ampel
    };
  }).sort((a, b) => a.id - b.id);

  const fmtD = (v, d) => v.toLocaleString('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d});
  const ampelCol = {g:'#4caf50', y:'#ffa000', r:'#e53935'};
  const ampelTxt = {g:'wirtschaftlich', y:'grenzwertig', r:'unwirtschaftlich'};

  let h = '<div style="font-size:10px;font-weight:600;color:var(--text);margin-bottom:6px;">Strang-Bewertung</div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:9px;font-family:\'DM Mono\',monospace;">';
  h += '<thead><tr style="color:var(--muted);border-bottom:1px solid var(--border);">';
  h += '<th style="text-align:left;padding:2px 4px;font-weight:normal;"></th>';
  h += '<th style="text-align:left;padding:2px 3px;font-weight:normal;">Strang</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Geb.</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">MWh/a</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Trasse m</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">Verlust</th>';
  h += '<th style="text-align:right;padding:2px 3px;font-weight:normal;">€/MWh</th>';
  h += '</tr></thead><tbody>';

  straenge.forEach(s => {
    const col = ampelCol[s.ampel];
    const rowStyle = selectedStrandId === s.id ? 'background:rgba(255,255,255,0.05);' : '';
    h += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;${rowStyle}" `
       + `onclick="selectedStrandId=${s.id};document.getElementById('netz-strang').value='${s.id}';updateNetzStrandVisibility();" `
       + `title="${ampelTxt[s.ampel]}: ${fmtD(s.zuschlag,0)} €/MWh Netzkosten, ${fmtD(s.verlustPct,1)}% Verluste">`;
    h += `<td style="padding:3px 4px;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};"></span></td>`;
    h += `<td style="padding:3px 3px;color:var(--text);">${s.id + 1}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${s.consumers}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${fmtD(s.waerme, 0)}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;">${fmtD(s.trasse, 0)}</td>`;
    h += `<td style="padding:3px 3px;text-align:right;color:${s.verlustPct > 15 ? '#e53935' : s.verlustPct > 8 ? '#ffa000' : 'var(--muted)'};">${fmtD(s.verlustPct, 1)}%</td>`;
    h += `<td style="padding:3px 3px;text-align:right;font-weight:600;color:${col};">${fmtD(s.zuschlag, 0)}</td>`;
    h += '</tr>';
  });

  // Gesamtzeile
  const totW = straenge.reduce((s, x) => s + x.waerme, 0);
  const totV = straenge.reduce((s, x) => s + x.verlust, 0);
  const totL = straenge.reduce((s, x) => s + x.trasse, 0);
  const totI = straenge.reduce((s, x) => s + x.invest, 0);
  const totVPct = totW > 0 ? totV / totW * 100 : 0;
  h += `<tr style="border-top:1px solid var(--border);color:var(--text);font-weight:600;">`;
  h += `<td colspan="2" style="padding:3px 4px;">Σ</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${straenge.reduce((s,x)=>s+x.consumers,0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totW, 0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totL, 0)}</td>`;
  h += `<td style="padding:3px 3px;text-align:right;color:${totVPct > 15 ? '#e53935' : totVPct > 8 ? '#ffa000' : 'var(--muted)'};">${fmtD(totVPct, 1)}%</td>`;
  h += `<td style="padding:3px 3px;text-align:right;">${fmtD(totI, 0)} €</td>`;
  h += '</tr>';

  h += '</tbody></table>';
  el.innerHTML = h;
  el.style.display = 'block';
}

function updateNetzStrandVisibility() {
  const vlTemp = parseFloat(document.getElementById('netz-vl')?.value) || 90;
  const rlTemp = parseFloat(document.getElementById('netz-rl')?.value) || 60;
  const dt = Math.max(1, vlTemp - rlTemp);
  const vFlow = parseFloat(document.getElementById('netz-v')?.value) || 1.0;
  const stromMode = (currentMode === 'strom');
  netzEdges.forEach(e => {
    const dim = (selectedStrandId != null && e.strandId !== selectedStrandId);
    const w = Math.max(3, Math.min(14, 2 + (e.dn||0) / 15));
    if (e.segLayers && e.segLayers.length > 0) {
      e.segLayers.forEach(s => s.setStyle({opacity: stromMode ? 0.1 : (dim ? 0.2 : 0.85), weight: dim ? 2 : w}));
      e.layer.setStyle({opacity: 0});
    } else if (e.load > 0) {
      const pColor = stromMode ? '#546e7a' : getEdgeColor(e, vlTemp, dt, vFlow);
      e.layer.setStyle({weight: dim ? 2 : w, color: pColor, opacity: stromMode ? 0.15 : (dim ? 0.2 : 0.8)});
    } else {
      e.layer.setStyle({weight: 2, color: '#999', dashArray: '6, 4', opacity: stromMode ? 0.1 : (dim ? 0.2 : 0.8)});
    }
  });
}

function updateRohrListe() {
  const container = document.getElementById('bom-container');
  const content = document.getElementById('bom-content');
  
  const rohre = {};
  let totalLength = 0;
  let totalKosten = 0;
  netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      if (!rohre[e.dn]) rohre[e.dn] = { length: 0, kosten: 0 };
      rohre[e.dn].length += e.length;
      const kEdge = getKostenProM(e.dn, e.kostKlasse) * e.length;
      rohre[e.dn].kosten += kEdge;
      totalLength += e.length;
      totalKosten += kEdge;
    }
  });

  if (Object.keys(rohre).length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Netz-WLD = Summe Verbraucher-Jahreswärme / Gesamttrassenlänge
  // (nicht Summe Kantenlast, da Stammleitung akkumulierte Last trägt)
  const connIds = new Set(netzEdges.flatMap(e => [e.u, e.v]));
  const totalConsumerKW = gebaeude.filter(g => connIds.has(g.id))
    .reduce((s, g) => s + (getComputedStats(g, globalYear).heizlast || 0), 0);
  const totalWaerme = totalConsumerKW * 1800 / 1000;
  const wldGesamt = totalLength > 0 ? totalWaerme / totalLength : 0;
  const wldColor = getWLDColor(wldGesamt);
  const szenarioLabel = {niedrig:'Niedrig',mittel:'Mittel',hoch:'Hoch'}[kostenSzenario];
  
  let html = `
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="flex:1;background:var(--surface2);border-radius:4px;padding:6px 8px;border:1px solid var(--border);">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Gesamtkosten (${szenarioLabel})</div>
        <div style="font-size:15px;font-family:'DM Mono',monospace;color:#4fc3f7;margin-top:2px">${Math.round(totalKosten).toLocaleString('de-DE')} €</div>
      </div>
      <div style="flex:1;background:var(--surface2);border-radius:4px;padding:6px 8px;border:1px solid var(--border);">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Ø WLD Gesamtnetz</div>
        <div style="font-size:15px;font-family:'DM Mono',monospace;color:${wldColor};margin-top:2px">${wldGesamt.toFixed(2)} MWh/(m·a)</div>
      </div>
    </div>
    <table class="bom-table">
      <thead><tr><th>DN (mm)</th><th>Länge (m)</th><th>€/m</th><th>Kosten (€)</th></tr></thead>
      <tbody>`;
  
  Object.keys(rohre).sort((a,b) => Number(a) - Number(b)).forEach(dn => {
    const r = rohre[dn];
    const euM = getKostenProM(Number(dn));
    html += `<tr>
      <td>KMR DN ${dn}</td>
      <td>${Math.round(r.length)}</td>
      <td>${euM.toLocaleString('de-DE')}</td>
      <td style="color:#4fc3f7">${Math.round(r.kosten).toLocaleString('de-DE')}</td>
    </tr>`;
  });
  
  html += `<tr>
    <th>Gesamt</th>
    <th>${Math.round(totalLength)}</th>
    <th>—</th>
    <th style="color:#4fc3f7">${Math.round(totalKosten).toLocaleString('de-DE')}</th>
  </tr>`;
  html += `</tbody></table>`;
  
  content.innerHTML = html;
}

function exportRohreCSV() {
  const rohre = {};
  netzEdges.forEach(e => {
    if (e.load > 0 && e.dn > 0) {
      if (!rohre[e.dn]) rohre[e.dn] = { length: 0, kosten: 0 };
      rohre[e.dn].length += e.length;
      rohre[e.dn].kosten += getKostenProM(e.dn) * e.length;
    }
  });
  
  let csvContent = `DN (mm);Laenge (m);Euro_pro_m (${kostenSzenario});Kosten (EUR)\n`;
  Object.keys(rohre).sort((a,b) => Number(a) - Number(b)).forEach(dn => {
    const r = rohre[dn];
    csvContent += `${dn};${Math.round(r.length)};${getKostenProM(Number(dn))};${Math.round(r.kosten)}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "rohrnetz_auszug.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function toggleDrawEdge(){
  isDrawingEdge = !isDrawingEdge;
  const btn = document.getElementById('btn-draw-edge');
  if(isDrawingEdge){
    btn.classList.add('active');
    showHint('Klicke auf das erste Gebäude für die Leitung.');
    edgeStartId = null;
    map.getContainer().style.cursor='crosshair';
  } else {
    btn.classList.remove('active');
    hideHint();
    edgeStartId = null;
    map.getContainer().style.cursor='';
  }
}

function startNetzEdgeFrom(id) {
  if (!isDrawingEdge) toggleDrawEdge();
  edgeStartId = id;
  showHint('Zweites Gebäude auf der Karte anklicken.');
}


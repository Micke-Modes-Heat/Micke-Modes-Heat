// ── 09a-pv-profile.js — PV-Profil, Datei-Upload, Preise, Invest ──
// ── Synthetisches PV-Profil (normiert, Summe = 1.0 über 8760h) ───────────
// Sonnenaufgang / Sonnenuntergang (ganze Stunde, lokale Zeit) je Monat
const _PV_SUN = [[8,16],[7,17],[6,18],[5,20],[5,21],[4,21],[4,21],[5,20],[6,19],[7,18],[8,16],[8,16]];

// Monatliche Ertragsanteile je Ausrichtung (Deutschland ~51°N)
const _PV_MONTH = {
  // Süd 30° Neigung: Winterernte höher durch steilen Winkel
  sued:    [0.026,0.039,0.076,0.109,0.134,0.144,0.139,0.128,0.097,0.060,0.028,0.020],
  // Ost-West 10° flach: Sommer-Mittag schwächer, aber breiterer Tagesertrag
  ostwest: [0.024,0.036,0.072,0.107,0.138,0.150,0.145,0.132,0.094,0.056,0.026,0.020]
};

// Empfohlene spezifische Erträge (kWh/kWp·a) je Ausrichtung
const _PV_SPEZ_DEFAULT = { sued: 1050, ostwest: 950 };

function pvAusrichtungChanged() {
  const ausrichtung = document.getElementById('pv-ausrichtung')?.value || 'sued';
  const spezField = document.getElementById('pv-spez');
  if (spezField) spezField.value = _PV_SPEZ_DEFAULT[ausrichtung] || 1000;
  // Profil-Cache invalidieren
  window._pvProfileCache = null;
  calcStromPanel();
}

function makePvProfile8760(ausrichtung) {
  ausrichtung = ausrichtung || document.getElementById('pv-ausrichtung')?.value || 'sued';
  const monthFrac = _PV_MONTH[ausrichtung] || _PV_MONTH.sued;
  const result = new Float32Array(8760);
  let ptr = 0;
  for (let m = 0; m < 12; m++) {
    const [rise, set] = _PV_SUN[m];
    const mFrac = monthFrac[m];
    const daysInMonth = GL_MONTH_HOURS[m] / 24;

    // Tagesprofil: Süd = spitze Sinusglocke, OW/flach = breiteres Plateau
    const shape = new Array(24).fill(0);
    let shapeSum = 0;
    const span = set - rise;
    for (let h = rise; h < set; h++) {
      const t = (h - rise) / span;  // 0..1
      if (ausrichtung === 'sued') {
        // Klassische Sinusglocke (Mittagsspitze)
        shape[h] = Math.sin(Math.PI * t);
      } else {
        // Ost-West / flach: zwei Peaks morgens+abends, flacheres Mittagstal
        // cos²-abgeflachte Glocke → breiterer Ertrag über den Tag
        const s = Math.sin(Math.PI * t);
        shape[h] = s * (0.7 + 0.3 * Math.cos(Math.PI * (t - 0.5)));
      }
      shapeSum += shape[h];
    }
    if (shapeSum > 0) shape.forEach((v, i, a) => { a[i] = v / shapeSum; });
    const perHour = mFrac / daysInMonth;
    for (let d = 0; d < daysInMonth; d++) {
      for (let h = 0; h < 24; h++) {
        if (ptr < 8760) result[ptr++] = perHour * shape[h];
      }
    }
  }
  return result;
}

// ── PV-Upload ─────────────────────────────────────────────────────────────
function pvFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const tokens = text.split(/[\n\r;,]+/).map(s => s.trim()).filter(s => s !== '' && !isNaN(s));
    if (tokens.length < 100) { alert('Zu wenig Werte — bitte 8760-Werte-CSV hochladen.'); return; }
    const arr = new Float32Array(8760);
    let sum = 0, pMax = 0;
    for (let i = 0; i < 8760; i++) {
      const v = parseFloat(tokens[i]) || 0;
      arr[i] = v; sum += v; if (v > pMax) pMax = v;
    }
    window.elPvH = arr;
    document.getElementById('pv-kwp').value = '';
    document.getElementById('pv-upload-info').textContent =
      `${file.name} · ${(sum/1000).toFixed(0)} MWh/a · max ${Math.round(pMax)} kW`;
    document.getElementById('pv-clear-btn').style.display = '';
    document.getElementById('pv-file-input').value = '';
    calcStromPanel();
  };
  reader.readAsText(file);
}

function pvClear() {
  window.elPvH = null;
  document.getElementById('pv-upload-info').textContent = '';
  document.getElementById('pv-clear-btn').style.display = 'none';
  document.getElementById('pv-file-input').value = '';
  calcStromPanel();
}

// ── PV-Panel ─────────────────────────────────────────────────────────────
function togglePvPanel() {
  const p = document.getElementById('pv-panel');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
}

// ── Batteriespeicher ──────────────────────────────────────────────────────
function toggleBatteriePanel() {
  const p = document.getElementById('batterie-panel');
  if (p.classList.contains('visible')) { hidePanels(); return; }
  hidePanels();
  p.classList.add('visible');
}

function getBatParams() {
  // Gibt { kapKwh, leistKw, eta } zurück, oder null wenn deaktiviert (Kapazität = 0)
  const kapKwh  = parseFloat(document.getElementById('bat-kapazitaet')?.value) || 0;
  const leistKw = parseFloat(document.getElementById('bat-leistung')?.value)   || 0;
  if (kapKwh <= 0 || leistKw <= 0) return null;
  return { kapKwh, leistKw, eta: 0.90 };
}

// ── CSV-Upload ────────────────────────────────────────────────────────────
function stromFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    // Trennzeichen: Zeilenumbruch, Semikolon oder Komma
    const tokens = text.split(/[\n\r;,]+/).map(s => s.trim()).filter(s => s !== '' && !isNaN(s));
    if (tokens.length < 100) {
      alert('Zu wenig Werte — bitte 8760-Werte-CSV hochladen.');
      return;
    }
    const arr = new Float32Array(8760);
    let sum = 0, pMax = 0;
    for (let i = 0; i < 8760; i++) {
      const v = parseFloat(tokens[i]) || 0;
      arr[i] = v;
      sum += v;
      if (v > pMax) pMax = v;
    }
    window.elQuartierH = arr;
    // Manuelle Eingabe leeren (Upload hat Vorrang)
    document.getElementById('strom-quartier-mwh').value = '';
    // Info anzeigen
    const mwh = (sum / 1000).toFixed(0);
    document.getElementById('strom-upload-info').textContent =
      `${file.name} · ${Number(mwh).toLocaleString('de-DE')} MWh/a · max ${Math.round(pMax).toLocaleString('de-DE')} kW`;
    document.getElementById('strom-clear-btn').style.display = '';
    document.getElementById('strom-file-input').value = '';
    calcStromPanel();
  };
  reader.readAsText(file);
}

function stromClear() {
  window.elQuartierH = null;
  document.getElementById('strom-upload-info').textContent = '';
  document.getElementById('strom-clear-btn').style.display = 'none';
  document.getElementById('strom-file-input').value = '';
  calcStromPanel();
}

function _onGaspreisChange(srcId) {
  const val = document.getElementById(srcId)?.value;
  // wirt-p-gas is the single source of truth for gas price
  if (srcId !== 'wirt-p-gas') {
    const el = document.getElementById('wirt-p-gas');
    if (el && el.value !== val) el.value = val;
  }
  calcWirtschaftPanel();
  updateGasKesselDisplay();
  updateBhkwDisplay();
}

function _onStrompreisChange(srcId) {
  const val = document.getElementById(srcId)?.value;
  for (const id of ['wirt-p-strom', 'strom-preis-bezug']) {
    if (id === srcId) continue;
    const el = document.getElementById(id);
    if (el && el.value !== val) el.value = val;
  }
  // Eigenverbrauchspreise synchronisieren (= vermiedene Bezugskosten)
  const bezug = parseFloat(val) || 35;
  const pvEigen = document.getElementById('pv-preis-eigen');
  if (pvEigen) pvEigen.value = bezug;
  const bhkwEigen = document.getElementById('bhkw-preis-eigen');
  if (bhkwEigen) bhkwEigen.value = bezug;
  calcStromPanel();  // MUSS vor calcWirtschaftPanel: aktualisiert _bhkwStromErloes mit neuem Preis
  calcWirtschaftPanel();
  updateBhkwDisplay();
  updateStromkesselDisplay();
}

// ── PV-Vergütungsmodell Dropdown ─────────────────────────────────────────
function onPvVergModellChange() {
  const modell = document.getElementById('pv-verg-modell')?.value || 'teil';
  const einspEl = document.getElementById('strom-preis-einsp');
  const hintEl = document.getElementById('pv-verg-hint');
  const pvKwp = parseFloat(document.getElementById('pv-kwp')?.value) || 100;
  let einsp = 8.1, hint = '';
  switch (modell) {
    case 'teil':
      // EEG §48 Teileinspeisung: gestaffelt nach Anlagengröße
      if (pvKwp <= 10) einsp = 8.1;
      else if (pvKwp <= 40) einsp = 7.0;
      else if (pvKwp <= 100) einsp = 5.7;
      else if (pvKwp <= 400) einsp = 5.7;
      else einsp = 5.7;
      hint = 'EEG §48 Teileinspeisung: bis 10 kWp 8,1 ct, bis 40 kWp 7,0 ct, ab 40 kWp 5,7 ct/kWh';
      break;
    case 'voll':
      // EEG §48 Volleinspeisung: höhere Vergütung
      if (pvKwp <= 10) einsp = 12.9;
      else if (pvKwp <= 40) einsp = 10.8;
      else if (pvKwp <= 100) einsp = 10.8;
      else if (pvKwp <= 400) einsp = 10.8;
      else einsp = 10.8;
      hint = 'EEG §48 Volleinspeisung: bis 10 kWp 12,9 ct, ab 10 kWp 10,8 ct/kWh';
      break;
    case 'ausschreibung':
      einsp = 5.5;
      hint = 'Ausschreibungszuschlag PV >1 MWp: ca. 5,0–6,0 ct/kWh (mittlerer Zuschlagswert)';
      break;
    case 'markt':
      einsp = 7.5;
      hint = 'Marktprämienmodell: Marktwert Solar (ca. 7–8 ct/kWh, variiert mit Börsenpreis)';
      break;
    case 'manuell':
      hint = 'Manuell: Einspeisungspreis frei einstellbar';
      break;
  }
  if (modell !== 'manuell' && einspEl) einspEl.value = einsp;
  if (hintEl) hintEl.textContent = hint;
  calcStromPanel();
}

// ── PV-Invest Auto-Update ────────────────────────────────────────────────
function updatePvInvestAuto() {
  const autoChk = document.getElementById('pv-invest-auto');
  const invEl = document.getElementById('opt-pv-invest');
  if (!autoChk?.checked || !invEl) return;
  const kwp = (parseFloat(document.getElementById('pv-kwp')?.value) || 0)
    + gebaeude.reduce((s, g) => s + (g.pvAktiv ? calcGebKwp(g) : 0), 0)
    + freiflaechen.reduce((s, ff) => s + calcFFKwp(ff), 0);
  if (typeof CalcEngine !== 'undefined' && kwp > 0) {
    calcStromPanel._updating = true;
    invEl.value = CalcEngine.getPvInvestPerKwp(kwp);
    calcStromPanel._updating = false;
  }
  calcStromPanel();
}


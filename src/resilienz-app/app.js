// ── resilienz-app/app.js — Oberfläche des Erhebungs-Werkzeugs ───────────────
//
// Läuft in der verschickten HTML-Datei (lib/resilienz-app.js setzt sie aus
// vorlage.html und diesem Skript zusammen). Bewusst ohne Imports und ohne
// Bibliotheken: die Datei muss für sich allein in jedem Browser laufen, auch
// ohne Internet. Nur der Kartenhintergrund kommt — abschaltbar — aus dem Netz.
//
// Der Stand liegt im Element #ra-stand. „Speichern" schreibt die Datei selbst
// mit dem neuen Stand neu; das Hauptwerkzeug liest sie über raLesenErhebung().
// Felder, Begriffe und Beispielkatalog kommen aus #ra-konfig
// (lib/resilienz-abfrage.js).
//
// Gleichartige Gebäude: keine Vererbung, sondern Übertragen. Was an einem
// Gebäude steht, gilt dort — eine Kopie merkt sich ihre Vorlage (`quelle`),
// damit spätere Änderungen erneut übertragen und offene Punkte gebündelt
// werden können. Der Beispielkatalog liefert nur Startwerte; die Herkunft der
// Angaben bleibt leer, bis der Betreiber sie einträgt.
//
// Die Einordnung A–D wird hier nur zur Anzeige berechnet — dieselbe Regel wie
// raKlasseVorschlag(). Maßgeblich ist die Einordnung beim Einlesen.

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Vor dem ersten Zeichnen: so sieht die Datei unverändert aus — Grundlage fürs Speichern.
  const ORIGINAL = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  let K, S;
  try {
    K = JSON.parse($('ra-konfig').textContent);
    S = JSON.parse($('ra-stand').textContent);
  } catch {
    $('app').innerHTML = '<div class="seite"><div class="hinweis warn"><b>Leere Vorlage.</b> Diese Datei wird vom '
      + 'Hauptwerkzeug befüllt (Resilienz-Abfrage → Erhebungs-Werkzeug erzeugen) und ist so noch nicht nutzbar.</div></div>';
    return;
  }
  S.ui = S.ui || {};
  for (const feld of ['allgemein', 'bestand', 'rueckmeldung', 'meta']) S[feld] = S[feld] || {};
  S.funktionen = S.funktionen || [];
  S.gebaeude = S.gebaeude || [];
  S.kategorien = [];
  K.katalog = K.katalog || [];

  const SCHRITTE = [
    { key: 'start',     titel: 'Start' },
    { key: 'szenarien', titel: 'Lagen' },
    { key: 'katalog',   titel: 'Beispiele' },
    { key: 'karte',     titel: 'Liegenschaft' },
    { key: 'bestand',   titel: 'Vorhandene Technik' },
    { key: 'abschluss', titel: 'Abschluss' },
  ];
  const KLASSE = Object.fromEntries(K.klassen.map(k => [k.key, k]));
  const ORDNUNG = { A: 0, B: 1, C: 2, D: 3 };
  /** Was „Übertragen" kopiert. Krisenlast und Ersatzversorgung gehören zum Gebäude und bleiben. */
  const KOPIERFELDER = ['name', 'betrieb', 'ausw_s', 'ausw_4h', 'ausw_3d', 'autarkie_text', 'sz', 'reduziert', 'abh', 'herkunft'];
  /** Was der Beispielkatalog vorbelegt — ohne Herkunft: die gibt der Betreiber an. */
  const KATALOGFELDER = ['betrieb', 'ausw_s', 'ausw_4h', 'ausw_3d', 'autarkie_text', 'sz', 'reduziert', 'abh'];
  const ABH = ['Wärme', 'Wasser', 'IT-Netz', 'Kommunikation', 'Personal'];
  const GEWICHT = { 'Auftrag gefährdet': 'w-rot', 'eingeschränkt': 'w-orange', 'unbekannt': 'w-grau' };
  const HG = {
    karte:    { url: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`, max: 18, quelle: '© OpenStreetMap-Mitwirkende' },
    luftbild: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
      max: 19, quelle: 'Luftbild © Esri, Maxar, Earthstar Geographics' },
    aus:      null,
  };

  const UI = {
    schritt: Math.min(Math.max(Number(S.ui.schritt) || 0, 0), SCHRITTE.length - 1),
    sel: new Set(),          // markierte Gebäude (IDs als Text)
    selF: null,              // aktive Funktion
    faerbung: 'klasse',
    hg: S.ui.hg && S.ui.hg in HG ? S.ui.hg : 'karte',
    zuordnen: null,          // Funktion, die gerade einem Gebäude zugeordnet wird
    uebertragen: null,       // { von: Funktions-ID, ziele: Set<Gebäude-ID> }
    legendeZu: false,
  };

  // ── Zugriff auf den Stand ─────────────────────────────────────────────────
  const gid = id => (id == null ? '' : String(id));
  const gebNach = id => S.gebaeude.find(g => gid(g.id) === gid(id)) || null;
  const funktionNach = id => S.funktionen.find(f => f.id === id) || null;
  const katalogNach = name => K.katalog.find(k => norm(k.name) === norm(name)) || null;
  const fktImGeb = id => S.funktionen.filter(f => f.gebId != null && gid(f.gebId) === gid(id));
  const ohneGeb = () => S.funktionen.filter(f => f.gebId == null || !gebNach(f.gebId));
  const ortVon = f => (f.gebId != null && gebNach(f.gebId) ? gebNach(f.gebId).name : 'ohne Gebäude');

  function ziel(schluessel) {
    const [art, id] = String(schluessel).split('|');
    if (art === 'f') return funktionNach(id);
    if (art === 'sz') return S.szenarien.find(s => s.id === id) || null;
    return S[art] || null;
  }

  const hatKreuz = sz => !!sz && Object.values(sz).some(Boolean);
  const kreuze = sz => K.szenarien.map(s => s.id).filter(id => sz?.[id]);

  /** Einordnung wie raKlasseVorschlag(); null, solange keine Auswirkung angegeben ist. */
  function klasse(f) {
    const s = f?.ausw_s, h = f?.ausw_4h, d = f?.ausw_3d;
    if (!s && !h && !d) return null;
    if (s === 'Auftrag gefährdet') return 'A';
    if (h === 'Auftrag gefährdet') return 'B';
    if (d === 'Auftrag gefährdet' || d === 'eingeschränkt') return 'C';
    return 'D';
  }
  function klassenGrund(f) {
    const s = f.ausw_s, h = f.ausw_4h, d = f.ausw_3d;
    if (s === 'Auftrag gefährdet') return 'weil schon ein Ausfall von Sekunden den Auftrag gefährdet';
    if (h === 'Auftrag gefährdet') return 'weil ein Ausfall von 4 Stunden den Auftrag gefährdet';
    if (d === 'Auftrag gefährdet' || d === 'eingeschränkt') return `weil ein Ausfall von 3 Tagen den Auftrag ${d === 'eingeschränkt' ? 'einschränkt' : 'gefährdet'}`;
    if (!s && !h && !d) return 'noch keine Angabe zur Auswirkung';
    return [s, h, d].every(v => v === 'keine') ? 'keine Auswirkung in allen drei Zeitschnitten' : 'keine auftragsgefährdende Auswirkung angegeben';
  }

  /** Was einer Funktion noch fehlt (leere Liste = vollständig). */
  function fehlt(f) {
    const out = [];
    if (!f.name) out.push('Bezeichnung');
    if (!f.ausw_s) out.push('Auswirkung nach Sekunden');
    if (!f.ausw_4h) out.push('Auswirkung nach 4 Stunden');
    if (!f.ausw_3d) out.push('Auswirkung nach 3 Tagen');
    if (!f.autarkie_text) out.push('Dauer ohne Netz');
    if (!hatKreuz(f.sz) && klasse(f) !== 'D') out.push('Lagen');
    if (!f.herkunft) out.push(f.katalog ? 'Prüfung der Beispielwerte (Herkunft)' : 'Herkunft der Angaben');
    return out;
  }
  function fStand(f) {
    if (!fehlt(f).length) return 'fertig';
    return (f.ausw_s || f.ausw_4h || f.ausw_3d || f.autarkie_text) ? 'teil' : 'leer';
  }
  function gebKlasse(g) {
    let best = null;
    for (const f of fktImGeb(g.id)) {
      const k = klasse(f);
      if (k && (best == null || ORDNUNG[k] < ORDNUNG[best])) best = k;
    }
    return best;
  }
  function gebStand(g) {
    const fs = fktImGeb(g.id);
    if (!fs.length) return 'ohne';
    const st = fs.map(fStand);
    if (st.every(x => x === 'fertig')) return 'fertig';
    return st.some(x => x !== 'leer') ? 'teil' : 'leer';
  }
  const STAND_FARBE = { fertig: '#43a047', teil: '#fb8c00', leer: '#ffffff', ohne: '#cfd6d1' };
  const STAND_TEXT = { fertig: 'beschrieben', teil: 'begonnen', leer: 'offen', ohne: 'keine Funktion erfasst' };

  function neueFunktionsId() {
    let max = 0;
    for (const f of S.funktionen) { const n = Number(/^F(\d+)$/.exec(f.id || '')?.[1]); if (n > max) max = n; }
    return 'F' + String(max + 1).padStart(2, '0');
  }

  // ── Übertragen und Beispielkatalog ────────────────────────────────────────
  const kopie = v => (v && typeof v === 'object' ? { ...v } : v ?? '');
  const kopien = f => S.funktionen.filter(x => x.quelle === f.id && x !== f);
  const vorlageVon = f => (f.quelle ? funktionNach(f.quelle) : null);
  const vergleichswert = (f, k) => JSON.stringify(k === 'sz' ? kreuze(f.sz) : (f[k] ?? ''));
  const weichtAb = (kop, vorlage) => KOPIERFELDER.some(k => vergleichswert(kop, k) !== vergleichswert(vorlage, k));
  const hatAngaben = f => !!(f.ausw_s || f.ausw_4h || f.ausw_3d || f.autarkie_text);

  function kopiereIn(von, nach) {
    for (const k of KOPIERFELDER) nach[k] = kopie(von[k]);
    nach.quelle = von.id;
    delete nach.katalog;
  }

  /**
   * Angaben einer Funktion auf Gebäude übertragen. Im Zielgebäude wird eine
   * gleichnamige Funktion überschrieben, sonst die einzige noch nicht fertige;
   * gibt es keine passende, kommt eine neue Funktion hinzu.
   */
  function uebertrage(von, gebIds) {
    let neu = 0, ueber = 0;
    for (const id of gebIds) {
      const g = gebNach(id);
      if (!g || (von.gebId != null && gid(von.gebId) === gid(g.id))) continue;
      const fs = fktImGeb(g.id).filter(x => x !== von);
      let nach = fs.find(x => norm(x.name) === norm(von.name))
        || (fs.length === 1 && fStand(fs[0]) !== 'fertig' ? fs[0] : null);
      if (nach) ueber++;
      else {
        nach = { id: neueFunktionsId(), geb: g.name, gebId: g.id, sz: {} };
        S.funktionen.push(nach); neu++;
      }
      kopiereIn(von, nach);
    }
    geaendert();
    return { neu, ueber };
  }

  function katalogUebernehmen(f, eintrag) {
    if (hatAngaben(f) && !confirm(`Die bisherigen Antworten von „${f.name || f.id}" durch das Beispiel „${eintrag.name}" ersetzen?`)) return;
    for (const k of KATALOGFELDER) f[k] = kopie(eintrag[k]);
    if (!f.name || /noch festzulegen/i.test(f.name)) f.name = eintrag.name;
    f.herkunft = '';
    f.katalog = eintrag.name;
    geaendert();
  }

  // ── Zwischenspeicher im Browser ───────────────────────────────────────────
  const LS_KEY = 'ra-erhebung:' + (S.uid || 'ohne-kennung');
  let lsTimer = null;
  function geaendert() {
    S.geaendert = new Date().toISOString();
    clearTimeout(lsTimer);
    lsTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* privat / gesperrt */ }
      kopfInfo();
    }, 300);
  }
  function lsLesen() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  let banner = null;
  {
    const ls = lsLesen();
    if (ls && ls.geaendert && (!S.geaendert || ls.geaendert > S.geaendert)) banner = ls;
  }

  // ── Speichern, Export, Druck ──────────────────────────────────────────────
  const LS1 = String.fromCharCode(0x2028), LS2 = String.fromCharCode(0x2029);
  const jsonFuerSkript = w => JSON.stringify(w).replace(/</g, '\\u003c').split(LS1).join('\\u2028').split(LS2).join('\\u2029');
  const datum = () => new Date().toISOString().slice(0, 10);
  function dateiStamm() {
    const lieg = String(S.allgemein.lieg || S.meta.lieg || '').replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return `Resilienzerhebung_${lieg ? lieg + '_' : ''}${datum()}`;
  }
  function herunterladen(inhalt, typ, name) {
    const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function speichern() {
    S.gespeichert = new Date().toISOString();
    S.ui = { schritt: UI.schritt, hg: UI.hg };
    const titel = 'Resilienz-Erhebung' + ((S.allgemein.lieg || S.meta.lieg) ? ' – ' + (S.allgemein.lieg || S.meta.lieg) : '');
    const html = ORIGINAL
      .replace(/(<script[^>]*\bid="ra-stand"[^>]*>)[\s\S]*?(<\/script>)/, (m, a, b) => a + jsonFuerSkript(S) + b)
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(titel)}</title>`);
    herunterladen(html, 'text/html;charset=utf-8', dateiStamm() + '.html');
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* egal */ }
    toast('Datei gespeichert — sie enthält alle Angaben und lässt sich wieder öffnen.');
    kopfInfo();
  }
  function speichernJson() {
    S.gespeichert = new Date().toISOString();
    herunterladen(JSON.stringify(S, null, 1), 'application/json', dateiStamm() + '.json');
    toast('Daten als .json gespeichert.');
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text; el.classList.add('an');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('an'), 3800);
  }

  // ── Lageplan: Projektion und Ansicht ──────────────────────────────────────
  // Web-Mercator in „Weltpixeln" der Zoomstufe 0 (256 × 256). Bildschirm = Welt · s + t.
  function merc(lat, lng) {
    const x = (lng + 180) / 360 * 256;
    const sn = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * 256;
    return [x, y];
  }
  const GEO = S.gebaeude.filter(g => Array.isArray(g.umriss) && g.umriss.length >= 3).map(g => {
    const pts = g.umriss.map(([a, b]) => merc(a, b));
    // Schwerpunkt relativ zum ersten Punkt — absolute Weltkoordinaten löschen sich sonst numerisch aus.
    const [ox, oy] = pts[0];
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const x1 = pts[i][0] - ox, y1 = pts[i][1] - oy;
      const x2 = pts[(i + 1) % pts.length][0] - ox, y2 = pts[(i + 1) % pts.length][1] - oy;
      const q = x1 * y2 - x2 * y1;
      A += q; cx += (x1 + x2) * q; cy += (y1 + y2) * q;
    }
    const c = Math.abs(A) > 1e-24 ? [ox + cx / (3 * A), oy + cy / (3 * A)]
      : [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { g, pts, c, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const GEO_NACH = new Map(GEO.map(o => [gid(o.g.id), o]));
  const PLAN = { s: 1, tx: 0, ty: 0, w: 0, h: 0, eingepasst: false, kacheln: new Map(), raf: 0 };

  function gesamtBox() {
    if (!GEO.length) return null;
    return GEO.reduce((b, o) => [Math.min(b[0], o.bb[0]), Math.min(b[1], o.bb[1]), Math.max(b[2], o.bb[2]), Math.max(b[3], o.bb[3])],
      [Infinity, Infinity, -Infinity, -Infinity]);
  }
  function einpassen(bb, rand = 0.86) {
    if (!bb || !PLAN.w) return;
    const bw = Math.max(bb[2] - bb[0], 1e-7), bh = Math.max(bb[3] - bb[1], 1e-7);
    PLAN.s = Math.min(PLAN.w / bw, PLAN.h / bh) * rand;
    PLAN.s = Math.min(PLAN.s, Math.pow(2, 21));
    PLAN.tx = PLAN.w / 2 - (bb[0] + bb[2]) / 2 * PLAN.s;
    PLAN.ty = PLAN.h / 2 - (bb[1] + bb[3]) / 2 * PLAN.s;
    PLAN.eingepasst = true;
  }
  function zoomUm(faktor, px, py) {
    const s2 = Math.min(Math.max(PLAN.s * faktor, 64), Math.pow(2, 22));
    const f = s2 / PLAN.s;
    PLAN.tx = px - (px - PLAN.tx) * f;
    PLAN.ty = py - (py - PLAN.ty) * f;
    PLAN.s = s2;
    planZeichnen();
  }
  function zeigeGebaeude(id) {
    const o = GEO_NACH.get(gid(id));
    if (!o || !PLAN.w) return;
    const bw = (o.bb[2] - o.bb[0]) * PLAN.s, bh = (o.bb[3] - o.bb[1]) * PLAN.s;
    if (Math.max(bw, bh) < 40 || bw > PLAN.w * 0.8 || bh > PLAN.h * 0.8) {
      const pad = Math.max(o.bb[2] - o.bb[0], o.bb[3] - o.bb[1]) * 3;
      einpassen([o.c[0] - pad, o.c[1] - pad, o.c[0] + pad, o.c[1] + pad], 1);
    } else {
      PLAN.tx = PLAN.w / 2 - o.c[0] * PLAN.s;
      PLAN.ty = PLAN.h / 2 - o.c[1] * PLAN.s;
    }
  }
  const sx = x => x * PLAN.s + PLAN.tx;
  const sy = y => y * PLAN.s + PLAN.ty;

  function fuellung(g) {
    const st = gebStand(g);
    if (UI.faerbung === 'stand') return { fill: STAND_FARBE[st], op: st === 'leer' ? 0.75 : 0.72, strich: st === 'leer' ? '4 3' : '' };
    if (st === 'ohne') return { fill: '#cfd6d1', op: 0.55, strich: '' };
    const k = gebKlasse(g);
    if (!k) return { fill: '#ffffff', op: 0.78, strich: '4 3' };
    return { fill: KLASSE[k].farbe, op: st === 'fertig' ? 0.78 : 0.45, strich: st === 'fertig' ? '' : '4 3' };
  }

  function kachelnZeichnen(gruppe) {
    const hg = HG[UI.hg];
    const used = new Set();
    if (hg) {
      const z = Math.max(0, Math.min(hg.max, Math.round(Math.log2(PLAN.s))));
      const n = Math.pow(2, z), groesse = 256 / n;
      const x0 = Math.floor((-PLAN.tx / PLAN.s) / groesse), x1 = Math.floor(((PLAN.w - PLAN.tx) / PLAN.s) / groesse);
      const y0 = Math.floor((-PLAN.ty / PLAN.s) / groesse), y1 = Math.floor(((PLAN.h - PLAN.ty) / PLAN.s) / groesse);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 120) {
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            if (y < 0 || y >= n) continue;
            const xw = ((x % n) + n) % n;
            const key = `${UI.hg}/${z}/${xw}/${y}@${x}`;
            used.add(key);
            let el = PLAN.kacheln.get(key);
            if (!el) {
              el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
              el.setAttribute('href', hg.url(z, xw, y));
              el.setAttribute('preserveAspectRatio', 'none');
              el.addEventListener('error', () => { el.style.display = 'none'; });
              gruppe.appendChild(el);
              PLAN.kacheln.set(key, el);
            }
            const px = sx(x * groesse), py = sy(y * groesse), w = groesse * PLAN.s;
            el.setAttribute('x', px.toFixed(1)); el.setAttribute('y', py.toFixed(1));
            el.setAttribute('width', (w + 0.6).toFixed(1)); el.setAttribute('height', (w + 0.6).toFixed(1));
          }
        }
      }
    }
    for (const [key, el] of PLAN.kacheln) if (!used.has(key)) { el.remove(); PLAN.kacheln.delete(key); }
  }

  function planZeichnen() {
    if (PLAN.raf) return;
    PLAN.raf = requestAnimationFrame(() => { PLAN.raf = 0; planZeichnenJetzt(); });
  }
  function planZeichnenJetzt() {
    const svg = $('plan-svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    PLAN.w = r.width; PLAN.h = r.height;
    if (!PLAN.eingepasst) einpassen(gesamtBox());
    kachelnZeichnen($('plan-kacheln'));

    const U = UI.uebertragen;
    const vonGeb = U ? gid(funktionNach(U.von)?.gebId) : '';
    const teile = [], namen = [];
    for (const o of GEO) {
      const g = o.g, id = gid(g.id);
      const bb = o.bb;
      if (sx(bb[2]) < -50 || sx(bb[0]) > PLAN.w + 50 || sy(bb[3]) < -50 || sy(bb[1]) > PLAN.h + 50) continue;
      const d = 'M' + o.pts.map(p => sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join('L') + 'Z';
      const fu = fuellung(g);
      let rand = '#33413a', breite = 1, strich = fu.strich;
      if (U) {
        if (U.ziele.has(id)) { rand = '#e8890c'; breite = 4; strich = ''; }
        else if (id === vonGeb) { rand = '#0d47a1'; breite = 3; strich = ''; }
      } else if (UI.sel.has(id)) { rand = '#0d47a1'; breite = 3; strich = ''; }
      teile.push(`<g class="geb" data-geb="${esc(id)}"><title>${esc(g.name)}</title>`
        + `<path d="${d}" fill="${fu.fill}" fill-opacity="${fu.op}" stroke="${rand}" stroke-width="${breite}" `
        + `${strich ? `stroke-dasharray="${strich}"` : ''}/></g>`);
      const bpx = (bb[2] - bb[0]) * PLAN.s;
      if (bpx > 46 || (UI.sel.has(id) && !U)) {
        // so viele Zeichen, wie ungefähr auf das Gebäude passen (mindestens 8, höchstens 22)
        const max = Math.max(8, Math.min(22, Math.floor(bpx / 6.2)));
        namen.push(`<text class="geb-name" x="${sx(o.c[0]).toFixed(1)}" y="${(sy(o.c[1]) + 4).toFixed(1)}" text-anchor="middle">`
          + `${esc(g.name.length > max ? g.name.slice(0, max - 1) + '…' : g.name)}</text>`);
      }
    }
    $('plan-geb').innerHTML = teile.join('');
    $('plan-namen').innerHTML = namen.join('');
    const q = $('plan-quelle');
    if (q) { q.textContent = HG[UI.hg]?.quelle || ''; q.style.display = HG[UI.hg] ? '' : 'none'; }
  }

  function planBinden() {
    const svg = $('plan-svg');
    if (!svg || svg._gebunden) return;
    svg._gebunden = true;
    let start = null;
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, tx: PLAN.tx, ty: PLAN.ty, bewegt: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.bewegt && Math.hypot(dx, dy) < 4) return;
      start.bewegt = true;
      svg.style.cursor = 'grabbing';
      PLAN.tx = start.tx + dx; PLAN.ty = start.ty + dy;
      planZeichnen();
    });
    svg.addEventListener('pointerup', e => {
      if (!start) return;
      const war = start; start = null;
      svg.style.cursor = '';
      if (war.bewegt) return;
      const treffer = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.geb');
      gebKlick(treffer ? treffer.getAttribute('data-geb') : null, e.shiftKey || e.ctrlKey || e.metaKey);
    });
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomUm(Math.pow(1.0018, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    new ResizeObserver(() => planZeichnen()).observe(svg);
  }

  function gebKlick(id, mehrfach) {
    if (UI.uebertragen) {
      if (!id) return;
      const von = funktionNach(UI.uebertragen.von);
      if (von && gid(von.gebId) === id) { toast('Das ist das Gebäude, von dem übertragen wird.'); return; }
      const z = UI.uebertragen.ziele;
      if (z.has(id)) z.delete(id); else z.add(id);
      planSeiteAktualisieren();
      return;
    }
    if (UI.zuordnen) {
      if (!id) return;
      const f = funktionNach(UI.zuordnen);
      const g = gebNach(id);
      if (f && g) {
        f.gebId = g.id; f.geb = g.name;
        geaendert();
        toast(`„${f.name || f.id}" liegt jetzt in ${g.name}.`);
      }
      UI.zuordnen = null;
      UI.sel = new Set([gid(id)]); UI.selF = f ? f.id : null;
      planSeiteAktualisieren();
      return;
    }
    if (!id) { if (!mehrfach) { UI.sel.clear(); UI.selF = null; } planSeiteAktualisieren(); return; }
    if (mehrfach) {
      if (UI.sel.has(id)) UI.sel.delete(id); else UI.sel.add(id);
      UI.selF = null;
    } else {
      UI.sel = new Set([id]);
      UI.selF = fktImGeb(id)[0]?.id || null;
    }
    planSeiteAktualisieren();
  }

  function miniPlanSvg(w, h) {
    const bb = gesamtBox();
    if (!bb) return '';
    const bw = Math.max(bb[2] - bb[0], 1e-7), bh = Math.max(bb[3] - bb[1], 1e-7);
    const s = Math.min(w / bw, h / bh) * 0.92;
    const tx = w / 2 - (bb[0] + bb[2]) / 2 * s, ty = h / 2 - (bb[1] + bb[3]) / 2 * s;
    const alt = UI.faerbung; UI.faerbung = 'klasse';
    const pfade = GEO.map(o => {
      const fu = fuellung(o.g);
      return `<path d="M${o.pts.map(p => (p[0] * s + tx).toFixed(1) + ',' + (p[1] * s + ty).toFixed(1)).join('L')}Z" `
        + `fill="${fu.fill}" fill-opacity="${fu.op}" stroke="#33413a" stroke-width="0.7" ${fu.strich ? `stroke-dasharray="${fu.strich}"` : ''}/>`;
    }).join('');
    UI.faerbung = alt;
    return `<svg class="mini-plan" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${pfade}</svg>`;
  }

  // ── Bausteine ─────────────────────────────────────────────────────────────

  /** Auswahlknöpfe für ein Feld; ein zweiter Klick auf die Auswahl hebt sie auf. */
  function seg(zielKey, obj, feld, werte, opt = {}) {
    const v = obj?.[feld] || '';
    const knoepfe = werte.map(w => {
      const cls = [];
      if (v === w) cls.push('an');
      if (opt.gewichtet && GEWICHT[w]) cls.push(GEWICHT[w]);
      if (!opt.gewichtet && w === 'unbekannt') cls.push('w-grau');
      return `<button type="button" class="${cls.join(' ')}" data-act="setze" data-ziel="${esc(zielKey)}" data-feld="${esc(feld)}" `
        + `data-wert="${esc(w)}">${esc(w)}</button>`;
    }).join('');
    return `<div class="seg">${knoepfe}</div>`;
  }

  function textFeld(zielKey, obj, feld, label, opt = {}) {
    const wert = obj?.[feld] ?? '';
    const attr = `data-ziel="${esc(zielKey)}" data-feld="${esc(feld)}"`;
    const eingabe = opt.mehrzeilig
      ? `<textarea ${attr} placeholder="${esc(opt.platzhalter || '')}">${esc(wert)}</textarea>`
      : `<input type="text" ${opt.zahl ? 'inputmode="decimal" data-zahl="1"' : ''} ${attr} `
        + `value="${esc(wert)}" placeholder="${esc(opt.platzhalter || '')}" ${opt.liste ? `list="${opt.liste}"` : ''}>`;
    return `<div class="feld"><label>${esc(label)}</label>${opt.erkl ? `<span class="erkl">${opt.erkl}</span>` : ''}${eingabe}</div>`;
  }

  /** Frage-Antwort-Felder (Allgemeines, Bestand, Rückmeldung). */
  function fragenForm(zielKey, felder, obj) {
    return felder.map(f => {
      if (f.liste) {
        return `<div class="feld"><div class="label">${esc(f.frage)}</div>${seg(zielKey, obj, f.feld, K.listen[f.liste])}</div>`;
      }
      return textFeld(zielKey, obj, f.feld, f.frage, { mehrzeilig: (f.hoehe || 0) >= 45, zahl: f.art === 'zahl' });
    }).join('');
  }

  const SZ_KURZ = { S1: 'kurzer Netzausfall', S2: 'Blackout', S3: 'Brennstoffmangel', S4: 'Komponentenausfall (n-1)',
    S5: 'Sabotage', S6: 'Cyberangriff', S7: 'Extremwetter / Brand' };
  const kurzSz = id => SZ_KURZ[id] || K.szenarien.find(s => s.id === id)?.name || id;

  function szChips(zielKey, obj) {
    return `<div class="seg">${K.szenarien.map(s => {
      const an = !!obj.sz?.[s.id];
      const rel = S.szenarien.find(x => x.id === s.id)?.relevant;
      return `<button type="button" class="${an ? 'an' : ''}" data-act="szUmschalten" data-ziel="${esc(zielKey)}" `
        + `data-sz="${s.id}" title="${esc(s.name)}${rel === 'nein' ? ' — als nicht relevant markiert' : ''}" `
        + `style="${rel === 'nein' && !an ? 'opacity:.5' : ''}"><b>${s.id}</b> ${esc(kurzSz(s.id))}</button>`;
    }).join('')}</div>`;
  }

  const abhTeile = text => String(text || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  function abhChips(zielKey, obj) {
    const teile = abhTeile(obj.abh);
    const rest = teile.filter(t => !ABH.some(a => norm(a) === norm(t))).join(', ');
    return `<div class="seg" style="margin-bottom:6px">${ABH.map(a => {
      const an = teile.some(t => norm(t) === norm(a));
      return `<button type="button" class="${an ? 'an' : ''}" data-act="abhUmschalten" `
        + `data-ziel="${esc(zielKey)}" data-wert="${esc(a)}">${esc(a)}</button>`;
    }).join('')}</div>
    <input type="text" data-ziel="${esc(zielKey)}" data-abh-rest="1" value="${esc(rest)}"
      placeholder="weitere, z. B. Kältemaschine, Druckluft">`;
  }

  /** Die Fragen zur Auswirkung eines Ausfalls. */
  function auswirkungsFragen(zk, f) {
    const L = K.listen;
    const zeile = (feld, zeit) => `<div class="zeit">nach <b>${zeit}</b></div>` + seg(zk, f, feld, L.L_Auswirkung, { gewichtet: true });
    return `
      <div class="feld"><div class="label">Was passiert, wenn hier der Strom ausfällt — für den Auftrag?</div>
        <span class="erkl">Ein Zeitschnitt nach dem anderen. „unbekannt" ist eine gute Antwort, wenn Sie es nicht wissen.</span>
        <div class="zeitstrahl">${zeile('ausw_s', 'Sekunden')}${zeile('ausw_4h', '4 Stunden')}${zeile('ausw_3d', '3 Tagen')}</div></div>
      <div class="feld"><div class="label">Wie lange muss die Aufgabe ohne öffentliches Netz weiterlaufen?</div>
        ${seg(zk, f, 'autarkie_text', L.L_Autarkie)}</div>
      <div class="raster2">
        <div class="feld"><div class="label">Betriebszeit</div>${seg(zk, f, 'betrieb', L.L_Betrieb)}</div>
        <div class="feld"><div class="label">Reduzierter Betrieb im Krisenfall möglich?</div>${seg(zk, f, 'reduziert', L.L_JaNein)}</div>
      </div>
      <div class="feld"><div class="label">Für welche Lagen gilt das?</div>
        <span class="erkl">Bei welchen Ereignissen muss die Aufgabe weiterlaufen? Mehrfachauswahl.</span>
        ${szChips(zk, f)}</div>
      <div class="feld"><div class="label">Hängt ab von</div>
        <span class="erkl">Was muss außer Strom noch funktionieren, damit die Aufgabe läuft?</span>
        ${abhChips(zk, f)}</div>
      <div class="feld"><div class="label">Woher stammen diese Angaben?</div>
        ${f.katalog && !f.herkunft ? '<span class="erkl" style="color:var(--orange)">Bitte angeben, sobald Sie die Beispielwerte geprüft haben.</span>' : ''}
        ${seg(zk, f, 'herkunft', L.L_Herkunft)}</div>`;
  }

  function technikFragen(zk, f) {
    const L = K.listen;
    return `
      <div class="raster2">
        ${textFeld(zk, f, 'pk', 'Krisenlast [kW], falls bekannt', { zahl: true, platzhalter: 'z. B. 35',
    erkl: 'Leistung, die im Notbetrieb mindestens gebraucht wird.' })}
        <div class="feld"><div class="label">Leistungsangabe ist</div>
          <span class="erkl">&nbsp;</span>${seg(zk, f, 'pk_art', L.L_Leistung)}</div>
      </div>
      <div class="feld"><div class="label">Vorhandene Ersatzversorgung</div>${seg(zk, f, 'ersatz', L.L_Ersatz)}</div>
      ${f.ersatz && f.ersatz !== 'keine' && f.ersatz !== 'unbekannt'
    ? textFeld(zk, f, 'ersatz_info', 'Überbrückungszeit USV bzw. Tankreichweite NEA', { platzhalter: 'z. B. USV 15 min, NEA 48 h' }) : ''}`;
  }

  const marke = (k, extra = '') => (k ? `<span class="marke" style="background:${KLASSE[k].farbe};${extra}" title="${esc(KLASSE[k].label)}">${k}</span>`
    : `<span class="marke" style="background:#cfd6d1;${extra}">–</span>`);

  function klassenKarte(k, grund, prefix = '') {
    if (!k) {
      return `<div class="klassen-karte"><div class="kl" style="background:#cfd6d1;color:#55615a">?</div>
        <div class="txt"><b>${prefix}noch nicht eingeordnet</b>Beantworten Sie die Fragen zur Auswirkung — oder übernehmen Sie
        ein Beispiel als Startwert. Die Einordnung erscheint dann hier und auf dem Plan.</div></div>`;
    }
    return `<div class="klassen-karte"><div class="kl" style="background:${KLASSE[k].farbe}">${k}</div>
      <div class="txt"><b>${prefix}Einordnung ${k}: ${esc(KLASSE[k].label)}</b>${esc(grund || '')}. Vorschlag — wird mit der zuständigen Stelle abgestimmt.</div></div>`;
  }

  // ── Schritt 1: Start ──────────────────────────────────────────────────────
  function seiteStart() {
    const m = S.meta;
    const lieg = S.allgemein.lieg || m.lieg;
    return `<div class="seite">
      <h1>Resilienz-Erhebung${lieg ? ' · ' + esc(lieg) : ''}</h1>
      <p class="unterzeile">Für die Liegenschaft wird ein Energiekonzept erstellt. Damit eine Notversorgung richtig geplant
        werden kann, brauchen wir Ihre Einschätzung: <b>Welche Aufgaben müssen bei einem Stromausfall weiterlaufen — und wie lange?</b></p>
      <div class="karte-box">
        <h3>So geht's</h3>
        <div class="weg">
          <div><b>① Beschreiben</b><span>Gebäude auf dem Lageplan anklicken und beantworten, was ein Ausfall bewirken würde.
            Beispiele helfen beim Start; gleichartige Gebäude übertragen Sie mit wenigen Klicks.</span></div>
          <div><b>② Speichern</b><span>„💾 Datei speichern" legt diese Datei mit Ihren Angaben neu ab.
            Sie können sie jederzeit wieder öffnen und weitermachen.</span></div>
          <div><b>③ Zurücksenden</b><span>Die gespeicherte Datei an ${m.ansprechpartner ? esc(m.ansprechpartner) : 'die erhebende Stelle'} schicken.</span></div>
        </div>
      </div>
      <div class="hinweis">Gefragt wird nach den <b>Auswirkungen</b> eines Ausfalls, nicht nach Technik. „unbekannt" ist eine
        gute Antwort — eine ehrliche Lücke ist mehr wert als eine geschätzte Angabe. <b>Bitte keine eingestuften Inhalte eintragen.</b>
        Ihre Angaben bleiben auf diesem Rechner, bis Sie die Datei selbst verschicken. Nur der Kartenhintergrund wird aus dem
        Internet geladen; er lässt sich auf dem Lageplan abschalten.</div>
      ${(m.empfaenger || m.ansprechpartner || m.stelle) ? `<div class="karte-box"><h3>Ansprechpartner</h3>
        <div class="raster2">
          ${m.empfaenger ? `<div class="feld"><div class="label">Empfänger der Erhebung</div>${esc(m.empfaenger)}</div>` : ''}
          ${m.ansprechpartner ? `<div class="feld"><div class="label">Rückfragen an</div>${esc(m.ansprechpartner)}</div>` : ''}
          ${m.stelle ? `<div class="feld"><div class="label">Erhebende Stelle</div>${esc(m.stelle)}</div>` : ''}
        </div></div>` : ''}
      <div class="karte-box"><h2>Allgemeines</h2>
        <p class="unterzeile">Grunddaten der Liegenschaft und der Stand der Vorgaben.</p>
        ${fragenForm('allgemein', K.allgemein, S.allgemein)}</div>
    </div>`;
  }

  // ── Schritt 2: Lagen (Szenarien) ──────────────────────────────────────────
  function seiteSzenarien() {
    return `<div class="seite">
      <h1>Für welche Lagen soll vorgesorgt werden?</h1>
      <p class="unterzeile">Sieben Referenzlagen. Bitte je Lage angeben, ob sie für die Liegenschaft eine Rolle spielt und mit
        welcher Dauer gerechnet werden soll. Später ordnen Sie jeder Aufgabe zu, in welchen Lagen sie weiterlaufen muss.</p>
      ${S.szenarien.map(s => {
    const def = K.szenarien.find(x => x.id === s.id) || { name: s.id };
    return `<div class="karte-box sz-karte ${s.relevant === 'nein' ? 'nein' : ''}">
          <div class="sz-id">${esc(s.id)}</div>
          <div>
            <div class="sz-titel">${esc(def.name)}</div>
            <div class="raster2">
              <div class="feld"><div class="label">Relevant für die Liegenschaft?</div>${seg('sz|' + s.id, s, 'relevant', K.listen.L_Relevant)}</div>
              ${s.relevant === 'nein' ? '<div></div>' : textFeld('sz|' + s.id, s, 'dauer', 'Angenommene Dauer', { platzhalter: 'z. B. 72 h, 14 Tage' })}
            </div>
            ${s.relevant === 'nein' ? '' : `<div class="feld"><div class="label">Woher stammt die Annahme?</div>${seg('sz|' + s.id, s, 'herkunft', K.listen.L_Herkunft)}</div>`}
            <details class="abschnitt" ${s.bem ? 'open' : ''}><summary>Bemerkung</summary>
              <div style="margin-top:8px">${textFeld('sz|' + s.id, s, 'bem', 'Bemerkung', { mehrzeilig: true })}</div></details>
          </div></div>`;
  }).join('')}
    </div>`;
  }

  // ── Schritt 3: Beispielkatalog ────────────────────────────────────────────
  function katalogKarte(e) {
    const zeile = (t, v) => `<tr><td>${t}</td><td>${v}</td></tr>`;
    const ausw = v => `<span class="${GEWICHT[v] || ''}">${esc(v)}</span>`;
    const sz = kreuze(e.sz);
    const n = S.funktionen.filter(f => norm(f.name) === norm(e.name)).length;
    return `<div class="karte-box katalog-karte">
      <div class="art-kopf">${marke(klasse(e))}<b style="flex:1;min-width:0">${esc(e.name)}
        ${n ? `<span class="art-zahl" style="display:block;font-weight:400">${n}× in dieser Liegenschaft</span>` : ''}</b></div>
      <table class="katalog-tab">
        ${zeile('Ausfall nach Sekunden', ausw(e.ausw_s))}
        ${zeile('nach 4 Stunden', ausw(e.ausw_4h))}
        ${zeile('nach 3 Tagen', ausw(e.ausw_3d))}
        ${zeile('ohne Netz weiterlaufen', esc(e.autarkie_text))}
        ${zeile('Lagen', sz.length ? sz.map(id => `<span title="${esc(kurzSz(id))}">${id}</span>`).join(' ') : '—')}
        ${zeile('hängt ab von', esc(e.abh || '—'))}
      </table>
      <p class="katalog-warum">${esc(e.warum)}</p>
    </div>`;
  }
  function seiteKatalog() {
    return `<div class="seite">
      <h1>Beispiele</h1>
      <p class="unterzeile">So könnten typische Aufgaben einer Liegenschaft beantwortet sein. Die Beispiele sind <b>keine Vorgabe</b>:
        Auf dem Lageplan können Sie ein Beispiel als Startwert übernehmen und dann an Ihre Liegenschaft anpassen.
        Erst wenn Sie angeben, woher die Angaben stammen, gilt ein Gebäude als beschrieben.</p>
      <div class="hinweis">Die Buchstaben zeigen die Einordnung, die sich aus den Antworten ergibt:
        ${K.klassen.map(k => `${marke(k.key)} ${esc(k.label)}`).join(' · ')}.</div>
      <div class="katalog-raster">${K.katalog.map(katalogKarte).join('')}</div>
    </div>`;
  }

  // ── Schritt 4: Lageplan ───────────────────────────────────────────────────
  function legende() {
    if (UI.faerbung === 'stand') {
      return `<div class="titel" data-act="legende">Bearbeitungsstand ▾</div>` + ['fertig', 'teil', 'leer', 'ohne'].map(st =>
        `<div><i style="background:${STAND_FARBE[st]};${st === 'leer' ? 'border-style:dashed' : ''}"></i>${STAND_TEXT[st]}</div>`).join('');
    }
    return `<div class="titel" data-act="legende">Einordnung (Vorschlag) ▾</div>` + K.klassen.map(k =>
      `<div><i style="background:${k.farbe}"></i><b>${k.key}</b>&nbsp;${esc(k.label)}</div>`).join('')
      + '<div><i style="background:#fff;border-style:dashed"></i>noch offen</div>'
      + '<div style="color:var(--leise);margin-top:3px;font-size:11px">blass = noch nicht vollständig</div>';
  }

  function seiteKarte() {
    return `<div class="plan-seite">
      <div class="plan" id="plan">
        <svg id="plan-svg" xmlns="http://www.w3.org/2000/svg"><g id="plan-kacheln"></g><g id="plan-geb"></g><g id="plan-namen"></g></svg>
        ${GEO.length ? '' : `<div class="hinweis warn" style="position:absolute;top:60px;left:60px;right:60px">Für diese Liegenschaft
          sind keine Gebäudeumrisse hinterlegt. Die Gebäude stehen rechts in der Liste.</div>`}
        <div class="plan-werkzeug">
          <button data-act="zoom" data-f="1.6" title="Vergrößern">+</button>
          <button data-act="zoom" data-f="0.625" title="Verkleinern">−</button>
          <button data-act="einpassen" title="Ganze Liegenschaft zeigen">⤢</button>
        </div>
        <div class="plan-oben">
          <select data-ui="faerbung" title="Färbung der Gebäude">
            <option value="klasse"${UI.faerbung === 'klasse' ? ' selected' : ''}>Färbung: Einordnung</option>
            <option value="stand"${UI.faerbung === 'stand' ? ' selected' : ''}>Färbung: Bearbeitungsstand</option>
          </select>
          <select data-ui="hg" title="Kartenhintergrund (lädt Kacheln aus dem Internet)">
            <option value="karte"${UI.hg === 'karte' ? ' selected' : ''}>Hintergrund: Karte</option>
            <option value="luftbild"${UI.hg === 'luftbild' ? ' selected' : ''}>Hintergrund: Luftbild</option>
            <option value="aus"${UI.hg === 'aus' ? ' selected' : ''}>Hintergrund: aus</option>
          </select>
        </div>
        <div id="plan-band"></div>
        <div class="legende" id="plan-legende"></div>
        <div class="quelle" id="plan-quelle"></div>
      </div>
      <aside class="panel" id="panel"></aside>
    </div>`;
  }

  function bandHtml() {
    const U = UI.uebertragen;
    if (U) {
      const von = funktionNach(U.von);
      const n = U.ziele.size;
      return `<div class="zuordnen-band">⇉ Gebäude anklicken, die die Angaben von „${esc(von?.name || '')}" bekommen sollen — ${n} gewählt
        <button data-act="uebertragenAusfuehren" ${n ? '' : 'disabled'}>Übertragen</button>
        <button data-act="uebertragenAbbruch">abbrechen</button></div>`;
    }
    const fz = UI.zuordnen && funktionNach(UI.zuordnen);
    return fz ? `<div class="zuordnen-band">📍 Gebäude für „${esc(fz.name || fz.id)}" anklicken
      <button data-act="zuordnenAbbruch">abbrechen</button></div>` : '';
  }

  function planSeiteAktualisieren() {
    const p = $('panel');
    if (!p) { render(); return; }
    p.innerHTML = panelHtml();
    $('plan-legende').innerHTML = legende();
    $('plan-legende').classList.toggle('zu', !!UI.legendeZu);
    $('plan-band').innerHTML = bandHtml();
    planZeichnen();
    schritteZeichnen();
  }

  function fortschritt() {
    const mit = S.gebaeude.filter(g => fktImGeb(g.id).length);
    const fertig = mit.filter(g => gebStand(g) === 'fertig').length;
    const fFertig = S.funktionen.filter(f => fStand(f) === 'fertig').length;
    return { geb: mit.length, gebFertig: fertig, fkt: S.funktionen.length, fktFertig: fFertig };
  }

  function naechstesOffenes() {
    const reihe = [...GEO.map(o => o.g), ...S.gebaeude.filter(g => !GEO_NACH.has(gid(g.id)))];
    const start = UI.sel.size === 1 ? reihe.findIndex(g => UI.sel.has(gid(g.id))) : -1;
    for (let i = 1; i <= reihe.length; i++) {
      const g = reihe[(start + i + reihe.length) % reihe.length];
      const st = gebStand(g);
      if (st === 'leer' || st === 'teil') return { geb: g };
    }
    const f = ohneGeb().find(x => fStand(x) !== 'fertig');
    return f ? { fkt: f } : null;
  }
  function geheZuNaechstem() {
    const n = naechstesOffenes();
    if (!n) { toast('Alle Gebäude und Funktionen sind beschrieben. 🎉'); UI.sel.clear(); UI.selF = null; planSeiteAktualisieren(); return; }
    if (n.geb) {
      UI.sel = new Set([gid(n.geb.id)]);
      const fs = fktImGeb(n.geb.id);
      UI.selF = (fs.find(f => fStand(f) !== 'fertig') || fs[0])?.id || null;
      zeigeGebaeude(n.geb.id);
    } else { UI.sel.clear(); UI.selF = n.fkt.id; }
    planSeiteAktualisieren();
    $('panel')?.scrollTo?.(0, 0);
  }

  function datalist() {
    const namen = [...new Set([...K.vorlagen, ...K.katalog.map(k => k.name)])];
    return `<datalist id="dl-funktionen">${namen.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  }

  /** Beispiel als Startwert: Vorschlag passend zum Namen, sonst Auswahl. */
  function katalogBlock(f) {
    if (f.katalog && !f.herkunft) {
      return `<div class="hinweis warn"><b>Startwerte aus dem Beispiel „${esc(f.katalog)}".</b> Bitte jede Antwort prüfen und an
        Ihre Liegenschaft anpassen; unten angeben, woher die Angaben stammen. Bis dahin gilt die Funktion als offen.</div>`;
    }
    if (hatAngaben(f) || vorlageVon(f)) return '';
    const passend = katalogNach(f.name);
    const opt = K.katalog.map(k => `<option value="${esc(k.name)}"${passend && k.name === passend.name ? ' selected' : ''}>`
      + `${esc(k.name)} (${klasse(k)})</option>`).join('');
    return `<div class="katalog-vorschlag">
      ${passend ? `<div>Für „${esc(passend.name)}" gibt es ein Beispiel ${marke(klasse(passend))} — als Startwert übernehmen?</div>`
    : '<div>Noch keine Antworten. Ein Beispiel als Startwert übernehmen?</div>'}
      <div class="knopfreihe" style="margin-top:7px">
        <select id="katalog-wahl" style="flex:1;width:auto"><option value="">— Beispiel wählen —</option>${opt}</select>
        <button class="knopf klein voll" data-act="katalogUebernehmen" data-f="${esc(f.id)}">übernehmen</button>
      </div></div>`;
  }

  /** Hinweise zu Vorlage und Kopien. */
  function uebertragBlock(f) {
    const v = vorlageVon(f);
    const k = kopien(f);
    let out = '';
    if (v) {
      const ab = weichtAb(f, v);
      out += `<div class="liste-zeile verbund">⇇
        <span class="name">Übertragen von <b>${esc(v.name || v.id)}</b> (${esc(ortVon(v))})
          <small>${ab ? 'inzwischen geändert — hier gilt, was hier steht' : 'gleich wie die Vorlage'}</small></span>
        <button class="knopf klein leise" data-act="zurVorlage" data-f="${esc(v.id)}">zur Vorlage</button>
        <button class="knopf klein leise" data-act="loesen" data-f="${esc(f.id)}" title="Verbindung zur Vorlage aufheben">lösen</button></div>`;
    }
    if (k.length) {
      const ab = k.filter(x => weichtAb(x, f));
      out += `<div class="liste-zeile verbund">⇉
        <span class="name">Auf <b>${k.length} Gebäude</b> übertragen
          <small>${ab.length ? `${ab.length} ${ab.length === 1 ? 'weicht' : 'weichen'} inzwischen ab` : 'alle gleich'}</small></span>
        ${ab.length ? `<button class="knopf klein voll" data-act="nachtragen" data-f="${esc(f.id)}"
          title="Die Angaben dieser Funktion erneut auf alle übertragenen Gebäude schreiben">Änderungen übertragen</button>` : ''}</div>`;
    }
    return out;
  }

  function funktionsForm(f) {
    const zk = 'f|' + f.id;
    return `${klassenKarte(klasse(f), klassenGrund(f))}
      ${uebertragBlock(f)}
      ${textFeld(zk, f, 'name', 'Aufgabe / Funktion', { liste: 'dl-funktionen', platzhalter: 'z. B. Führung / IT / Kommunikation',
    erkl: 'Was wird hier geleistet? Nicht die Anlage, sondern die Aufgabe.' })}
      ${katalogBlock(f)}
      <div class="block"><div class="block-titel">Auswirkung eines Ausfalls</div>${auswirkungsFragen(zk, f)}</div>
      <div class="block"><div class="block-titel">Technik vor Ort</div>${technikFragen(zk, f)}</div>
      <div class="block">${textFeld(zk, f, 'bem', 'Bemerkung', { mehrzeilig: true })}</div>`;
  }

  function panelHtml() {
    const fp = fortschritt();
    // Übertragen läuft
    if (UI.uebertragen) {
      const von = funktionNach(UI.uebertragen.von);
      const ziele = [...UI.uebertragen.ziele].map(gebNach).filter(Boolean);
      return `<h2>Angaben übertragen</h2>
        <p class="unterzeile" style="margin-bottom:10px">Von <b>${esc(von?.name || '')}</b> (${esc(von ? ortVon(von) : '')}).
          Klicken Sie auf dem Plan die Gebäude an, die dieselben Antworten bekommen sollen; ein zweiter Klick nimmt ein Gebäude wieder heraus.</p>
        <div class="hinweis">Übertragen werden Aufgabe, Auswirkungen, Dauer, Lagen, Abhängigkeiten und Herkunft. <b>Krisenlast und
          Ersatzversorgung bleiben am Gebäude.</b> Eine gleichnamige Funktion im Zielgebäude wird überschrieben, sonst kommt eine hinzu.
          Danach kann jedes Gebäude einzeln angepasst werden.</div>
        ${ziele.map(g => `<div class="liste-zeile"><span class="name">${esc(g.name)}<small>${esc(fktImGeb(g.id).map(x => x.name).join(', ') || 'keine Funktion')}</small></span>
          <button class="knopf klein leise" data-act="zielWeg" data-geb="${esc(gid(g.id))}">✕</button></div>`).join('')
          || '<div class="leer">Noch kein Gebäude gewählt.</div>'}
        <div class="knopfreihe" style="margin-top:12px">
          <button class="knopf voll" data-act="uebertragenAusfuehren" ${ziele.length ? '' : 'disabled'}>Auf ${ziele.length} Gebäude übertragen</button>
          <button class="knopf leise" data-act="uebertragenAbbruch">abbrechen</button></div>`;
    }
    // Funktion ohne Gebäude
    if (!UI.sel.size && UI.selF) {
      const f = funktionNach(UI.selF);
      if (f) {
        return `${datalist()}<button class="knopf klein leise" data-act="uebersicht">← Übersicht</button>
          <h2 style="margin-top:12px">${esc(f.name || f.id)}</h2>
          <div class="knopfreihe" style="margin:6px 0 4px">
            <span class="leer">Funktion ohne Gebäude</span>
            <button class="knopf klein" data-act="zuordnen" data-f="${esc(f.id)}">📍 Gebäude zuordnen</button>
            <button class="knopf klein rot" data-act="fLoeschen" data-f="${esc(f.id)}">entfernen</button>
          </div>
          ${funktionsForm(f)}
          <div class="knopfreihe" style="margin-top:14px;justify-content:flex-end">
            <button class="knopf voll" data-act="naechstes">Weiter: nächstes offenes ▶</button></div>`;
      }
    }
    // Mehrfachauswahl
    if (UI.sel.size > 1) {
      const gs = [...UI.sel].map(gebNach).filter(Boolean);
      const quellen = S.funktionen.filter(hatAngaben);
      return `<button class="knopf klein leise" data-act="uebersicht">← Übersicht</button>
        <h2 style="margin-top:12px">${gs.length} Gebäude markiert</h2>
        <p class="unterzeile" style="margin-bottom:10px">Gleichartige Gebäude? Übertragen Sie die Angaben eines bereits
          beschriebenen Gebäudes auf alle markierten.</p>
        ${quellen.length ? `<div class="feld"><label>Angaben übernehmen von</label>
          <select id="mehrfach-quelle">${quellen.map(x => `<option value="${esc(x.id)}">${esc(x.name || x.id)} — ${esc(ortVon(x))}</option>`).join('')}</select></div>
          <button class="knopf voll" data-act="mehrfachUebertragen">Auf ${gs.length} Gebäude übertragen</button>`
    : '<div class="hinweis">Beschreiben Sie zuerst ein Gebäude — dann können Sie dessen Angaben hier übertragen.</div>'}
        <div class="block" style="margin-top:14px">${gs.map(g => `<div class="liste-zeile"><span class="punkt" style="background:${STAND_FARBE[gebStand(g)]};border:1px solid #9aa59f"></span>
          <span class="name">${esc(g.name)}<small>${esc(fktImGeb(g.id).map(x => x.name).join(', ') || 'keine Funktion')}</small></span></div>`).join('')}
        <button class="knopf klein leise" data-act="uebersicht">Markierung aufheben</button></div>`;
    }
    // Ein Gebäude
    if (UI.sel.size === 1) {
      const g = gebNach([...UI.sel][0]);
      if (g) {
        const fs = fktImGeb(g.id);
        const f = fs.find(x => x.id === UI.selF) || fs[0] || null;
        if (f) UI.selF = f.id;
        return `${datalist()}<button class="knopf klein leise" data-act="uebersicht">← Übersicht</button>
          <h2 style="margin-top:12px">${esc(g.name)}</h2>
          ${g.nutzung ? `<div class="leer" style="font-style:normal">Nutzung laut Planung: ${esc(g.nutzung)}</div>` : ''}
          ${fs.length > 1 ? klassenKarte(gebKlasse(g), 'strengste Einordnung der Funktionen in diesem Gebäude', 'Gebäude: ') : ''}
          <div class="reiter">
            ${fs.map(x => `<button class="${x.id === f?.id ? 'an' : ''}" data-act="fReiter" data-f="${esc(x.id)}">
              ${klasse(x) ? marke(klasse(x), 'min-width:16px;padding:0 3px;font-size:10.5px') + ' ' : ''}${esc(x.name || x.id)}</button>`).join('')}
            <button data-act="fNeu" data-geb="${esc(gid(g.id))}" title="Weitere Aufgabe in diesem Gebäude">＋ Funktion</button>
          </div>
          ${f ? funktionsForm(f) + `
            <div class="knopfreihe" style="margin-top:14px">
              <button class="knopf" data-act="uebertragenStart" data-f="${esc(f.id)}" ${hatAngaben(f) ? '' : 'disabled'}
                title="Diese Antworten auf gleichartige Gebäude übertragen">⇉ auf andere Gebäude übertragen</button>
              <button class="knopf voll" data-act="naechstes" style="margin-left:auto">Weiter: nächstes offenes ▶</button></div>
            <div class="knopfreihe" style="margin-top:8px">
              <button class="knopf klein leise" data-act="zuordnen" data-f="${esc(f.id)}" title="Funktion liegt in einem anderen Gebäude">📍 verschieben</button>
              <button class="knopf klein rot" data-act="fLoeschen" data-f="${esc(f.id)}">entfernen</button></div>`
    : `<div class="hinweis">Für dieses Gebäude ist keine Funktion erfasst. Hat es eine Aufgabe, die bei einem Stromausfall wichtig
              ist? Dann legen Sie sie mit „＋ Funktion" an. Sonst ist nichts weiter zu tun.</div>
            <button class="knopf voll" data-act="naechstes">Weiter: nächstes offenes ▶</button>`}`;
      }
    }
    // Übersicht
    const pct = fp.geb ? Math.round(fp.gebFertig / fp.geb * 100) : 0;
    const og = ohneGeb();
    const reihe = [...S.gebaeude].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de', { numeric: true }));
    return `<h2>Liegenschaft</h2>
      <div class="fortschritt"><div style="width:${pct}%"></div></div>
      <div style="font-size:13px;color:var(--leise)"><b style="color:var(--text)">${fp.gebFertig} von ${fp.geb}</b> Gebäuden beschrieben ·
        ${fp.fktFertig} von ${fp.fkt} Funktionen vollständig</div>
      <div class="knopfreihe" style="margin:14px 0">
        <button class="knopf voll" data-act="naechstes">▶ Nächstes offenes Gebäude</button></div>
      <div class="hinweis"><b>Gebäude anklicken</b>, um es zu beschreiben — ein Beispiel aus dem Katalog hilft beim Start.
        <b>Gleichartige Gebäude</b> (z. B. alle Unterkünfte): eines beschreiben, dann „⇉ auf andere Gebäude übertragen".
        <b>Umschalt + Klick</b> markiert mehrere Gebäude auf einmal. Ziehen verschiebt den Plan, das Mausrad zoomt.</div>
      <div class="block"><div class="block-titel">Funktionen ohne Gebäude (${og.length})</div>
        <span class="erkl" style="display:block;color:var(--leise);font-size:12.5px;margin-bottom:8px">Typische Aufgaben, die noch keinem
          Gebäude zugeordnet sind. Zuordnen, beschreiben oder entfernen, wenn es sie hier nicht gibt.</span>
        ${og.map(f => `<div class="liste-zeile">${marke(klasse(f))}
            <span class="name">${esc(f.name || f.id)}<small>${STAND_TEXT[fStand(f)]}</small></span>
            <button class="knopf klein" data-act="fOeffnen" data-f="${esc(f.id)}">beschreiben</button>
            <button class="knopf klein leise" data-act="zuordnen" data-f="${esc(f.id)}" title="Gebäude auf dem Plan anklicken">📍</button></div>`).join('')
          || '<div class="leer">keine</div>'}
        <button class="knopf klein" data-act="fNeu">＋ Funktion ohne Gebäude</button></div>
      <details class="abschnitt" style="margin-top:16px"><summary>Alle Gebäude als Liste (${S.gebaeude.length})</summary>
        <div style="margin-top:8px">${reihe.map(g => `<div class="liste-zeile" style="cursor:pointer" data-act="gebWaehlen" data-geb="${esc(gid(g.id))}">
            ${marke(gebKlasse(g))}
            <span class="name">${esc(g.name)}<small>${STAND_TEXT[gebStand(g)]}${GEO_NACH.has(gid(g.id)) ? '' : ' · ohne Umriss'}</small></span></div>`).join('')}</div></details>`;
  }

  // ── Schritt 5: Vorhandene Technik ─────────────────────────────────────────
  function seiteBestand() {
    return `<div class="seite">
      <h1>Vorhandene Technik und Organisation</h1>
      <p class="unterzeile">Was ist heute vorhanden? Diese Angaben werden nicht bewertet — sie ordnen den Ausgangszustand ein.
        Was Sie nicht wissen, lassen Sie leer oder wählen „unbekannt".</p>
      <div class="karte-box">${fragenForm('bestand', K.bestand, S.bestand)}</div>
    </div>`;
  }

  // ── Schritt 6: Abschluss ──────────────────────────────────────────────────
  /**
   * Offene Punkte mit Sprungziel. Hat eine übertragene Funktion dieselbe Lücke
   * wie ihre Vorlage, wird das einmal an der Vorlage gemeldet.
   */
  function offenePunkte() {
    const out = [];
    const a = S.allgemein;
    const leer = v => !v || v === 'unbekannt';
    if (!a.lieg) out.push({ ref: 'Allgemeines', text: 'Die Liegenschaft ist nicht bezeichnet.', ziel: { schritt: 0 } });
    if (!a.zustaendig) out.push({ ref: 'Allgemeines', text: 'Die für die Resilienz zuständige Stelle ist nicht benannt.', ziel: { schritt: 0 } });
    if (leer(a.vorgaben)) out.push({ ref: 'Allgemeines', text: 'Offen, ob es Vorgaben zur Energie- bzw. Notstromversorgung gibt.', ziel: { schritt: 0 } });
    else if (a.vorgaben === 'ja' && !a.vorgaben_bez) out.push({ ref: 'Allgemeines', text: 'Vorgaben vorhanden, aber Bezeichnung und Stelle fehlen.', ziel: { schritt: 0 } });
    if (leer(a.liste_kf)) out.push({ ref: 'Allgemeines', text: 'Offen, ob es eine abgestimmte Liste kritischer Funktionen gibt.', ziel: { schritt: 0 } });
    for (const s of S.szenarien) {
      if (leer(s.relevant)) out.push({ ref: s.id, text: 'Relevanz der Lage ist offen.', ziel: { schritt: 1 } });
      else if (s.relevant === 'ja' && !s.dauer) out.push({ ref: s.id, text: 'Angenommene Dauer fehlt.', ziel: { schritt: 1 } });
    }
    const gruppen = new Map();
    const leise = [];
    for (const f of S.funktionen) {
      const v = vorlageVon(f);
      const vFehlt = v ? fehlt(v) : [];
      for (const x of fehlt(f)) {
        const wurzel = v && vFehlt.includes(x) ? v : f;
        const gr = gruppen.get(wurzel.id) || { f: wurzel, felder: new Set(), ids: new Set() };
        gr.felder.add(x); gr.ids.add(f.id);
        gruppen.set(wurzel.id, gr);
      }
      const au = f.autarkie_text;
      if (au && !['keine', 'unbekannt'].includes(au) && f.pk == null) {
        leise.push({ ref: f.id, text: `${f.name || f.id} (${ortVon(f)}): Krisenlast unbekannt — eine grobe Schätzung hilft schon.`,
          ziel: { schritt: 3, geb: f.gebId, f: f.id }, leise: true });
      }
    }
    for (const gr of gruppen.values()) {
      const f = gr.f, n = gr.ids.size - (gr.ids.has(f.id) ? 1 : 0);
      const was = fStand(f) === 'leer' ? 'noch nicht beschrieben.' : `fehlt ${[...gr.felder].join(', ')}.`;
      out.push({ ref: f.id, text: `${f.name || f.id} (${ortVon(f)})${n ? ` und ${n} übertragene ${n === 1 ? 'Funktion' : 'Funktionen'}` : ''}: `
        + `${was}${n ? ' Einmal an der Vorlage ergänzen und erneut übertragen.' : ''}`,
      ziel: { schritt: 3, geb: f.gebId, f: f.id } });
    }
    return [...out, ...leise];
  }

  function seiteAbschluss() {
    const fp = fortschritt();
    const op = offenePunkte();
    const jeKl = { A: 0, B: 0, C: 0, D: 0, offen: 0 };
    for (const f of S.funktionen) { const k = klasse(f); if (k) jeKl[k]++; else jeKl.offen++; }
    const m = S.meta;
    UI.offen = op;
    return `<div class="seite">
      <h1>Abschluss</h1>
      <p class="unterzeile">Prüfen Sie, was noch offen ist, ergänzen Sie die Rückmeldung — und senden Sie die gespeicherte Datei zurück.
        Offene Punkte sind kein Fehler: was Sie nicht beantworten können, klären wir gemeinsam.</p>
      <div class="kacheln">
        <div class="kachel"><div class="z">${fp.gebFertig}/${fp.geb}</div><div class="l">Gebäude beschrieben</div></div>
        <div class="kachel"><div class="z">${fp.fktFertig}/${fp.fkt}</div><div class="l">Funktionen vollständig</div></div>
        <div class="kachel"><div class="z" style="color:${op.length ? 'var(--orange)' : 'var(--gruen)'}">${op.length}</div><div class="l">offene Punkte</div></div>
        <div class="kachel"><div class="z" style="font-size:15px;line-height:1.9">${K.klassen.map(k =>
    `<span class="marke" style="background:${k.farbe}">${k.key} ${jeKl[k.key]}</span>`).join(' ')}</div><div class="l">Einordnung (Vorschlag)</div></div>
      </div>
      ${GEO.length ? `<div class="karte-box">${miniPlanSvg(860, 300)}</div>` : ''}
      <div class="karte-box"><h2>Offene Punkte</h2>
        ${op.length ? `<ul class="offen-liste">${op.map((p, i) => `<li><span class="ref" style="${p.leise ? 'color:var(--leiser)' : ''}">${esc(p.ref)}</span>
          <span class="txt">${esc(p.text)}</span><button class="knopf klein" data-act="sprung" data-i="${i}">ergänzen →</button></li>`).join('')}</ul>`
    : '<div style="color:var(--gruen);font-weight:600">✓ Alles beantwortet — vielen Dank!</div>'}</div>
      <div class="karte-box"><h2>Rückmeldung</h2>
        <p class="unterzeile">Was offen bleibt, und wer die Angaben freigibt.</p>
        ${fragenForm('rueckmeldung', K.rueckmeldung, S.rueckmeldung)}</div>
      <div class="karte-box" style="border-color:var(--gruen-mittel)"><h2>Zurücksenden</h2>
        <p class="unterzeile">1. „💾 Datei speichern" — es entsteht eine neue Datei mit Ihren Angaben (im Download-Ordner).<br>
          2. Diese Datei per E-Mail an ${m.ansprechpartner ? `<b>${esc(m.ansprechpartner)}</b>` : 'die erhebende Stelle'} schicken.<br>
          Falls Ihr E-Mail-System .html-Anhänge blockiert: „Daten als .json" speichern und diese Datei schicken.</p>
        <div class="knopfreihe">
          <button class="knopf voll" data-act="speichern">💾 Datei speichern</button>
          <button class="knopf" data-act="speichernJson">⬇ Daten als .json</button>
          <button class="knopf leise" data-act="drucken">🖨 Übersicht drucken</button>
        </div></div>
    </div>`;
  }

  function druckHtml() {
    const lieg = S.allgemein.lieg || S.meta.lieg || '';
    const zeilen = S.funktionen.map(f => {
      const k = klasse(f);
      const g = f.gebId != null ? gebNach(f.gebId) : null;
      return `<tr><td>${esc(f.id)}</td><td>${esc(f.name)}</td><td>${esc(g ? g.name : (f.geb || '—'))}</td>
        <td><b>${k || '–'}</b></td><td>${esc(f.autarkie_text || '—')}</td><td>${esc(kreuze(f.sz).join(' ') || '—')}</td>
        <td>${f.pk != null ? esc(String(f.pk).replace('.', ',')) + ' kW' : '—'}</td><td>${esc(f.herkunft || '—')}</td></tr>`;
    }).join('');
    return `<h1>Resilienz-Erhebung${lieg ? ' · ' + esc(lieg) : ''}</h1>
      <p>Stand ${esc(new Date().toLocaleDateString('de-DE'))} · ausgefüllt von ${esc(S.allgemein.stelle || '—')} (${esc(S.allgemein.bearb || '—')}) ·
        zuständig: ${esc(S.allgemein.zustaendig || '—')}</p>
      ${miniPlanSvg(860, 330)}
      <p style="font-size:9pt">Einordnung (Vorschlag): ${K.klassen.map(k => `<b style="color:${k.farbe}">${k.key}</b> ${esc(k.label)}`).join(' · ')}</p>
      <table><thead><tr><th>ID</th><th>Funktion</th><th>Gebäude</th><th>Einordnung</th><th>Dauer ohne Netz</th>
        <th>Lagen</th><th>Krisenlast</th><th>Herkunft</th></tr></thead><tbody>${zeilen}</tbody></table>
      <p style="font-size:9pt">Offene Punkte: ${offenePunkte().length}. Die Einordnung ist ein Vorschlag und wird mit der zuständigen Stelle abgestimmt.</p>`;
  }

  // ── Rahmen ────────────────────────────────────────────────────────────────
  function schrittStand(i) {
    const a = S.allgemein;
    switch (SCHRITTE[i].key) {
      case 'start': return (a.lieg && a.zustaendig) ? 'fertig' : '';
      case 'szenarien': return S.szenarien.every(s => s.relevant && s.relevant !== 'unbekannt') ? 'fertig' : '';
      case 'karte': { const fp = fortschritt(); return fp.fkt && fp.fktFertig === fp.fkt ? 'fertig' : ''; }
      default: return '';
    }
  }
  function schrittText(i) {
    const key = SCHRITTE[i].key;
    if (key === 'szenarien') return `${S.szenarien.filter(s => s.relevant && s.relevant !== 'unbekannt').length}/${S.szenarien.length}`;
    if (key === 'karte') { const fp = fortschritt(); return `${fp.gebFertig}/${fp.geb}`; }
    return '';
  }
  function schritteZeichnen() {
    const nav = $('schritte');
    if (!nav) return;
    nav.innerHTML = SCHRITTE.map((s, i) => {
      const st = schrittStand(i), t = schrittText(i);
      return `<button class="schritt ${i === UI.schritt ? 'aktiv' : ''} ${st}" data-act="schritt" data-i="${i}">
        <span class="nr">${st === 'fertig' && i !== UI.schritt ? '✓' : i + 1}</span>${esc(s.titel)}${t ? ` <span class="stand">${t}</span>` : ''}</button>`;
    }).join('');
  }
  function kopfInfo() {
    const el = $('sichern-info');
    if (!el) return;
    const fmt = iso => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    el.textContent = S.gespeichert ? `Datei zuletzt gespeichert ${fmt(S.gespeichert)}` : 'noch nicht als Datei gespeichert';
  }

  function render() {
    const lieg = S.allgemein.lieg || S.meta.lieg || '';
    const istKarte = SCHRITTE[UI.schritt].key === 'karte';
    const seiten = [seiteStart, seiteSzenarien, seiteKatalog, seiteKarte, seiteBestand, seiteAbschluss];
    const vor = SCHRITTE[UI.schritt + 1], zur = SCHRITTE[UI.schritt - 1];
    $('app').style.cssText = 'display:flex;flex-direction:column;height:100vh';
    $('app').innerHTML = `
      <header class="kopf">
        <div class="marke">Resilienz-Erhebung<small>Ausfall der Stromversorgung</small></div>
        <div class="lieg">${esc(lieg)}</div>
        <span class="sichern-info" id="sichern-info"></span>
        <button class="knopf" data-act="speichern" title="Speichert diese Datei mit allen Angaben neu">💾 Datei speichern</button>
      </header>
      ${banner ? `<div class="banner">In diesem Browser liegt ein jüngerer Zwischenstand
        (${esc(new Date(banner.geaendert).toLocaleString('de-DE'))}) als in dieser Datei.
        <button class="knopf klein voll" data-act="bannerLaden">Zwischenstand fortsetzen</button>
        <button class="knopf klein leise" data-act="bannerWeg">Datei-Stand behalten</button></div>` : ''}
      <nav class="schritte" id="schritte"></nav>
      <main style="overflow-y:auto" id="inhalt">${seiten[UI.schritt]()}</main>
      <footer class="fuss">
        <button class="knopf leise" data-act="schritt" data-i="${UI.schritt - 1}" ${zur ? '' : 'disabled'}>◀ ${zur ? esc(zur.titel) : 'Zurück'}</button>
        <span class="mitte">Eingaben werden in diesem Browser zwischengespeichert. Zum Zurücksenden: 💾 Datei speichern.</span>
        ${vor ? `<button class="knopf voll" data-act="schritt" data-i="${UI.schritt + 1}">Weiter: ${esc(vor.titel)} ▶</button>`
    : '<button class="knopf voll" data-act="speichern">💾 Datei speichern</button>'}
      </footer>`;
    schritteZeichnen();
    kopfInfo();
    if (istKarte) {
      PLAN.kacheln.clear();
      planBinden();
      planSeiteAktualisieren();
      requestAnimationFrame(() => { if (!PLAN.eingepasst) planZeichnen(); });
    }
  }

  // ── Ereignisse ────────────────────────────────────────────────────────────
  function nachAktion() {
    if (SCHRITTE[UI.schritt].key === 'karte') planSeiteAktualisieren();
    else {
      const y = $('inhalt')?.scrollTop || 0;
      render();
      if ($('inhalt')) $('inhalt').scrollTop = y;
    }
  }

  // Ein „change" beim Verlassen eines Textfelds kommt zwischen Maus-Drücken und Klick.
  // Würde sofort neu gezeichnet, ginge der Klick ins Leere — darum bis nach dem Loslassen warten.
  let mausUnten = false, nachMaus = null;
  document.addEventListener('pointerdown', () => { mausUnten = true; }, true);
  document.addEventListener('pointerup', () => {
    mausUnten = false;
    if (nachMaus) { const fn = nachMaus; nachMaus = null; setTimeout(fn, 0); }
  }, true);
  const spaeter = fn => { if (mausUnten) nachMaus = fn; else fn(); };

  const AKTION = {
    schritt: d => {
      const i = Number(d.i);
      if (i < 0 || i >= SCHRITTE.length) return;
      UI.schritt = i; UI.zuordnen = null; UI.uebertragen = null;
      S.ui.schritt = i;
      render();
      $('inhalt')?.scrollTo?.(0, 0);
    },
    setze: d => {
      const o = ziel(d.ziel);
      if (!o) return;
      o[d.feld] = o[d.feld] === d.wert ? '' : d.wert;
      geaendert(); nachAktion();
    },
    szUmschalten: d => {
      const o = ziel(d.ziel);
      if (!o) return;
      const sz = { ...(o.sz || {}) };
      if (sz[d.sz]) delete sz[d.sz]; else sz[d.sz] = 1;
      o.sz = sz;
      geaendert(); nachAktion();
    },
    abhUmschalten: d => {
      const o = ziel(d.ziel);
      if (!o) return;
      const teile = abhTeile(o.abh);
      const i = teile.findIndex(t => norm(t) === norm(d.wert));
      if (i >= 0) teile.splice(i, 1); else teile.push(d.wert);
      o.abh = teile.join(', ');
      geaendert(); nachAktion();
    },
    legende: () => { UI.legendeZu = !UI.legendeZu; $('plan-legende')?.classList.toggle('zu', UI.legendeZu); },
    zoom: d => zoomUm(Number(d.f), PLAN.w / 2, PLAN.h / 2),
    einpassen: () => { einpassen(gesamtBox()); planZeichnen(); },
    uebersicht: () => { UI.sel.clear(); UI.selF = null; UI.zuordnen = null; planSeiteAktualisieren(); },
    naechstes: () => geheZuNaechstem(),
    gebWaehlen: d => {
      UI.sel = new Set([d.geb]); UI.selF = fktImGeb(d.geb)[0]?.id || null;
      zeigeGebaeude(d.geb); planSeiteAktualisieren();
    },
    fReiter: d => { UI.selF = d.f; planSeiteAktualisieren(); },
    fOeffnen: d => { UI.sel.clear(); UI.selF = d.f; planSeiteAktualisieren(); },
    fNeu: d => {
      const g = d.geb ? gebNach(d.geb) : null;
      const f = { id: neueFunktionsId(), name: '', geb: g ? g.name : '', gebId: g ? g.id : null, sz: {} };
      S.funktionen.push(f);
      UI.selF = f.id;
      if (!g) UI.sel.clear();
      geaendert(); planSeiteAktualisieren();
      setTimeout(() => document.querySelector(`[data-ziel="f|${f.id}"][data-feld="name"]`)?.focus(), 30);
    },
    fLoeschen: d => {
      const f = funktionNach(d.f);
      if (!f || !confirm(`Funktion „${f.name || f.id}" entfernen?`)) return;
      for (const k of kopien(f)) delete k.quelle;
      S.funktionen.splice(S.funktionen.indexOf(f), 1);
      UI.selF = null;
      geaendert(); planSeiteAktualisieren();
    },
    zuordnen: d => {
      if (!GEO.length) { toast('Keine Gebäudeumrisse vorhanden — Zuordnung auf dem Plan nicht möglich.'); return; }
      UI.zuordnen = d.f; planSeiteAktualisieren();
    },
    zuordnenAbbruch: () => { UI.zuordnen = null; planSeiteAktualisieren(); },
    katalogUebernehmen: d => {
      const f = funktionNach(d.f);
      const e = katalogNach($('katalog-wahl')?.value);
      if (!f) return;
      if (!e) { toast('Bitte zuerst ein Beispiel wählen.'); return; }
      katalogUebernehmen(f, e);
      planSeiteAktualisieren();
    },
    uebertragenStart: d => {
      const f = funktionNach(d.f);
      if (!f || !hatAngaben(f)) return;
      if (!GEO.length) { toast('Keine Gebäudeumrisse — bitte mehrere Gebäude in der Liste markieren.'); return; }
      UI.uebertragen = { von: f.id, ziele: new Set() };
      planSeiteAktualisieren();
    },
    zielWeg: d => { UI.uebertragen?.ziele.delete(d.geb); planSeiteAktualisieren(); },
    uebertragenAbbruch: () => { UI.uebertragen = null; planSeiteAktualisieren(); },
    uebertragenAusfuehren: () => {
      const U = UI.uebertragen;
      const von = U && funktionNach(U.von);
      if (!von || !U.ziele.size) return;
      const r = uebertrage(von, U.ziele);
      UI.uebertragen = null;
      UI.sel = von.gebId != null && gebNach(von.gebId) ? new Set([gid(von.gebId)]) : new Set();
      UI.selF = von.id;
      toast(`Angaben auf ${U.ziele.size} Gebäude übertragen${r.neu ? ` (${r.neu} Funktion${r.neu === 1 ? '' : 'en'} neu angelegt)` : ''}.`);
      planSeiteAktualisieren();
    },
    mehrfachUebertragen: () => {
      const von = funktionNach($('mehrfach-quelle')?.value);
      if (!von) return;
      const ziele = [...UI.sel].filter(id => id !== gid(von.gebId));
      const r = uebertrage(von, ziele);
      toast(`Angaben von „${von.name}" auf ${ziele.length} Gebäude übertragen${r.neu ? ` (${r.neu} neu angelegt)` : ''}.`);
      UI.sel.clear(); UI.selF = null;
      planSeiteAktualisieren();
    },
    nachtragen: d => {
      const f = funktionNach(d.f);
      if (!f) return;
      const ab = kopien(f).filter(x => weichtAb(x, f));
      if (!ab.length || !confirm(`Die Angaben von „${f.name}" erneut auf ${ab.length} abweichende Gebäude übertragen?\n`
        + 'Dort zwischenzeitlich geänderte Antworten werden überschrieben (Krisenlast und Ersatzversorgung bleiben).')) return;
      for (const x of ab) kopiereIn(f, x);
      geaendert();
      toast(`${ab.length} Gebäude aktualisiert.`);
      planSeiteAktualisieren();
    },
    zurVorlage: d => {
      const f = funktionNach(d.f);
      if (!f) return;
      if (f.gebId != null && gebNach(f.gebId)) { UI.sel = new Set([gid(f.gebId)]); zeigeGebaeude(f.gebId); } else UI.sel.clear();
      UI.selF = f.id;
      planSeiteAktualisieren();
    },
    loesen: d => {
      const f = funktionNach(d.f);
      if (!f) return;
      delete f.quelle;
      geaendert(); planSeiteAktualisieren();
    },
    speichern: () => speichern(),
    speichernJson: () => speichernJson(),
    drucken: () => { $('druck').innerHTML = druckHtml(); window.print(); },
    sprung: d => {
      const p = UI.offen?.[Number(d.i)];
      if (!p) return;
      UI.schritt = p.ziel.schritt;
      if (p.ziel.f) {
        UI.selF = p.ziel.f;
        UI.sel = p.ziel.geb != null && gebNach(p.ziel.geb) ? new Set([gid(p.ziel.geb)]) : new Set();
      }
      render();
      if (p.ziel.geb != null) requestAnimationFrame(() => { zeigeGebaeude(p.ziel.geb); planZeichnen(); });
    },
    bannerLaden: () => {
      const ui = S.ui;
      S = banner; S.ui = S.ui || ui; S.kategorien = [];
      banner = null;
      toast('Zwischenstand aus diesem Browser geladen.');
      render();
    },
    bannerWeg: () => { banner = null; render(); },
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = AKTION[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset); }
  });

  function eingabe(e, endgueltig) {
    const el = e.target;
    if (el.dataset.ui) {
      if (!endgueltig) return;
      UI[el.dataset.ui] = el.value;
      if (el.dataset.ui === 'hg') { S.ui.hg = el.value; geaendert(); }
      planSeiteAktualisieren();
      return;
    }
    if (el.dataset.abhRest != null) {
      const o = ziel(el.dataset.ziel);
      if (!o) return;
      const chips = abhTeile(o.abh).filter(t => ABH.some(a => norm(a) === norm(t)));
      o.abh = [...chips, ...abhTeile(el.value)].join(', ');
      geaendert();
      if (endgueltig) spaeter(nachAktion);
      return;
    }
    if (!el.dataset.ziel || !el.dataset.feld) return;
    const o = ziel(el.dataset.ziel);
    if (!o) return;
    const feld = el.dataset.feld;
    if (el.dataset.zahl) {
      const t = el.value.trim().replace(/\s/g, '').replace(',', '.');
      o[feld] = t === '' ? null : (Number.isFinite(Number(t)) ? Number(t) : el.value.trim());
    } else {
      o[feld] = el.value;
    }
    geaendert();
    if (endgueltig) spaeter(nachAktion);
  }
  document.addEventListener('input', e => eingabe(e, false));
  document.addEventListener('change', e => eingabe(e, true));

  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* egal */ }
  });

  render();
}());

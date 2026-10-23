// tools/skizzen-veroeffentlichen.mjs — baut aus docs/skizzen/ die Ausgabe für das Netzlaufwerk.
//
//   npm run skizzen
//
// Ablauf: Erzeuger laufen neu (quelle in katalog.json), jede Skizze bekommt eine Fußzeile mit Stand und
// Version (Entwürfe zusätzlich ein Wasserzeichen), PNG in 3-facher Auflösung über Edge oder Chrome, Übersicht
// als 00_Übersicht.html. Ersetzte Stände wandern nach _Archiv/. _Änderungsprotokoll.txt sagt, was diesmal von
// Hand auf das Laufwerk zu kopieren oder dort zu löschen ist. Stand = Datum der letzten inhaltlichen Änderung.
//
// Zwei Phasen: Erst entstehen alle neuen SVGs und PNGs in einem Zwischenordner. Nur wenn jedes PNG geschrieben
// wurde, wird archiviert und eingesetzt. Scheitert ein PNG, bleibt die Ausgabe unverändert.
//
// Zielordner: skizzen-ausgabe/ im Repo (nicht versioniert) oder Umgebungsvariable SKIZZEN_AUSGABE.
// Browser: Edge, sonst Chrome. SKIZZEN_EDGE = Pfad, der zuerst versucht wird; SKIZZEN_BROWSER = nur diese
// Pfade (durch ; getrennt), ohne Rückfall.
/* global process, console */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIB = path.join(ROOT, 'docs/skizzen');
const AUS = path.resolve(process.env.SKIZZEN_AUSGABE || path.join(ROOT, 'skizzen-ausgabe'));
const ARCHIV = '_Archiv';
const STAND_DATEI = path.join(AUS, '.stand.json');
const ZWISCHEN = path.join(AUS, '.in-arbeit');
const PROTOKOLL = '_Änderungsprotokoll.txt';
const UEBERSICHT = '00_Übersicht.html';
const WUENSCHE = 'Änderungswünsche.csv';

const THEMEN = { strom: 'Strom', waerme: 'Wärme', ga: 'GA' };
const STATUS = { entwurf: 'Entwurf', abgestimmt: 'Abgestimmt', 'im-tool': 'Im Tool' };

// BOM tolerieren: Windows-Editoren und PowerShell schreiben UTF-8 gern mit BOM
const leseJson = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8').replace(/^\uFEFF/, ''));
const katalog = leseJson(path.join(BIB, 'katalog.json'));
const heute = new Date().toISOString().slice(0, 10);
const datumDE = (iso) => iso.split('-').reverse().join('.');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rel = (p) => path.relative(AUS, p).split(path.sep).join('/');

function gitVersion() {
  try {
    const v = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const offen = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'docs/skizzen'], { encoding: 'utf8' }).trim();
    return offen ? `${v}+` : v;   // „+“: Stand enthält noch nicht committete Änderungen
  } catch { return 'ohne Git'; }
}

function findeBrowser() {
  const nur = (process.env.SKIZZEN_BROWSER || '').split(';').map((p) => p.trim()).filter(Boolean);
  const kandidaten = nur.length ? nur : [process.env.SKIZZEN_EDGE,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  return [...new Set(kandidaten.map((k) => path.resolve(k)))].filter((k) => fs.existsSync(k));
}

function masse(svg) {
  const m = svg.match(/<svg[^>]*?viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) throw new Error('SVG ohne viewBox "0 0 W H"');
  return { W: +m[1], H: +m[2] };
}

// Fußzeile mit Stand/Version unter die Skizze setzen (Fläche wird um 20 px verlängert), Entwürfe mit Wasserzeichen
function stempeln(svg, { stand, version, entwurf }) {
  const { W, H } = masse(svg);
  const H2 = H + 20;
  let out = svg.replace(/(<svg[^>]*?)viewBox="0 0 [\d.]+ [\d.]+"/, `$1viewBox="0 0 ${W} ${H2}"`)
    .replace(/(<svg[^>]*?)height="[\d.]+"/, `$1height="${H2}"`);
  let zusatz = `<rect x="0" y="${H}" width="${W}" height="20" fill="#FAFAF8"/>` +
    `<text x="${W - 28}" y="${H + 12}" font-family="Tahoma, Verdana, sans-serif" font-size="9.5" text-anchor="end" fill="#8A8F8A">` +
    `${entwurf ? 'ENTWURF · ' : ''}Stand ${datumDE(stand)} · Version ${esc(version)} · Skizzenbibliothek</text>`;
  if (entwurf) {
    zusatz += `<text x="${W / 2}" y="${H / 2}" transform="rotate(-28 ${W / 2} ${H / 2})" font-family="Tahoma, Verdana, sans-serif" ` +
      'font-size="150" font-weight="700" letter-spacing="12" text-anchor="middle" fill="#C8641E" fill-opacity="0.09">ENTWURF</text>';
  }
  out = out.replace(/<\/svg>\s*$/, zusatz + '</svg>');
  return { svg: out, W, H: H2 };
}

// Ein Versuch mit eigenem Wegwerf-Profil, damit ein offenes Browserfenster des Nutzers nicht stört.
// Edge schreibt z. B. kein PNG, solange ein Update nur halb installiert ist.
function versuchePng(browser, svgDatei, pngDatei, W, H) {
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'skizzen-browser-'));
  try {
    execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profil}`,
      '--force-device-scale-factor=3', `--screenshot=${pngDatei}`, `--window-size=${W},${H}`, pathToFileURL(svgDatei).href],
    { stdio: 'ignore', timeout: 120000 });
  } catch { /* Fehlercode oder Zeitüberschreitung: zählt nur, ob das PNG da ist */ }
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Browser hält das Profil evtl. noch kurz */ }
  return fs.existsSync(pngDatei);
}

// Browser der Reihe nach, je zwei Versuche; der zuletzt erfolgreiche kommt beim nächsten PNG zuerst dran
function renderePng(browser, svgDatei, pngDatei, W, H) {
  for (const b of [...browser]) {
    for (let v = 0; v < 2; v++) {
      if (versuchePng(b, svgDatei, pngDatei, W, H)) {
        if (b !== browser[0]) {
          log.hinweise.push(`${path.basename(browser[0])} lieferte kein PNG, ab ${path.basename(pngDatei)} ${path.basename(b)} verwendet.`);
          browser.splice(browser.indexOf(b), 1);
          browser.unshift(b);
        }
        return;
      }
    }
  }
  throw new Error(`Kein Browser hat ${path.basename(pngDatei)} geschrieben (versucht: ${browser.map((b) => path.basename(b)).join(', ')}). ` +
    'Die Ausgabe ist unverändert. Tipp: offene Edge-Fenster schließen oder SKIZZEN_EDGE auf chrome.exe setzen.');
}

function verschiebe(von, nach) {
  if (!fs.existsSync(von)) return false;
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  fs.renameSync(von, nach);
  return true;
}

// ── Lauf ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(AUS, { recursive: true });
const zustand = fs.existsSync(STAND_DATEI) ? leseJson(STAND_DATEI) : { skizzen: {} };
const version = gitVersion();
const browser = findeBrowser();
const log = { kopieren: [], loeschen: [], archiviert: [], hinweise: [] };
if (!browser.length) log.hinweise.push('Weder Edge noch Chrome gefunden — keine PNGs erzeugt (Pfad über SKIZZEN_EDGE setzen).');

// Phase 1: alles Neue im Zwischenordner erzeugen; die Ausgabe wird dabei nicht angefasst
fs.rmSync(ZWISCHEN, { recursive: true, force: true });
const plan = [];
const gelaufen = new Set();
try {
  for (const s of katalog.skizzen) plan.push(planeSkizze(s));
} catch (e) {
  fs.rmSync(ZWISCHEN, { recursive: true, force: true });
  throw e;
}

// Phase 2: alte Stände archivieren bzw. entfernen, neue Dateien einsetzen
const eintraege = [];
for (const p of plan) {
  const { s, alt, ordner, geaendert, hash, stand, ver, svgNeu, pngNeu, svgZiel, pngZiel } = p;
  if (alt && (geaendert || alt.ordner !== ordner)) {
    for (const ext of ['svg', 'png']) {
      const altDatei = path.join(AUS, alt.ordner, `${s.datei}.${ext}`);
      if (geaendert) {
        if (verschiebe(altDatei, path.join(AUS, ARCHIV, `${s.datei}_${alt.stand}.${ext}`))) log.archiviert.push(`${ARCHIV}/${s.datei}_${alt.stand}.${ext}`);
      } else if (fs.existsSync(altDatei)) fs.rmSync(altDatei);
    }
    if (alt.ordner !== ordner) log.loeschen.push(`${alt.ordner.split(path.sep).join('/')}/${s.datei}.svg und .png`);
  }
  if (svgNeu) { verschiebe(svgNeu, svgZiel); log.kopieren.push(rel(svgZiel)); }
  if (pngNeu) { verschiebe(pngNeu, pngZiel); log.kopieren.push(rel(pngZiel)); }
  zustand.skizzen[s.datei] = { hash, stand, version: ver, ordner };
  eintraege.push({ ...s, stand, version: ver, svg: rel(svgZiel), png: fs.existsSync(pngZiel) ? rel(pngZiel) : null });
}
fs.rmSync(ZWISCHEN, { recursive: true, force: true });

// Eine Skizze vorbereiten: Erzeuger laufen lassen, stempeln, SVG und PNG in den Zwischenordner schreiben
function planeSkizze(s) {
  if (!THEMEN[s.thema]) throw new Error(`${s.datei}: unbekanntes Thema „${s.thema}“`);
  if (!STATUS[s.status]) throw new Error(`${s.datei}: unbekannter Status „${s.status}“`);
  const quellSvg = path.join(BIB, s.thema, `${s.datei}.svg`);
  // Erzeuger bekommen den Themenordner und schreiben ihre Skizze(n) dorthin; je Erzeuger und Ordner nur ein Lauf
  const lauf = s.quelle && `${s.quelle}|${s.thema}`;
  if (lauf && !gelaufen.has(lauf)) {
    execFileSync(process.execPath, [path.join(BIB, s.quelle), path.join(BIB, s.thema)], { stdio: ['ignore', 'ignore', 'inherit'] });
    gelaufen.add(lauf);
  }
  if (!fs.existsSync(quellSvg)) throw new Error(`${s.datei}: ${rel(quellSvg)} fehlt`);

  const roh = fs.readFileSync(quellSvg, 'utf8');
  const hash = sha(roh);
  const alt = zustand.skizzen[s.datei];
  const ordner = path.join(...(s.status === 'entwurf' ? ['Entwurf', THEMEN[s.thema]] : [THEMEN[s.thema]]));
  const geaendert = !alt || alt.hash !== hash;
  const stand = geaendert ? heute : alt.stand;
  // unveränderter Inhalt, der beim letzten Lauf noch nicht committet war („+“), bekommt jetzt die Commit-Version
  const ver = geaendert || (alt.version.endsWith('+') && !version.endsWith('+')) ? version : alt.version;

  const svgZiel = path.join(AUS, ordner, `${s.datei}.svg`);
  const pngZiel = path.join(AUS, ordner, `${s.datei}.png`);
  const neuGeschrieben = geaendert || alt.ordner !== ordner || alt.version !== ver || !fs.existsSync(svgZiel);
  const pngNoetig = browser.length > 0 && (neuGeschrieben || !fs.existsSync(pngZiel));
  let svgNeu = null, pngNeu = null;
  if (neuGeschrieben || pngNoetig) {
    const { svg, W, H } = stempeln(roh, { stand, version: ver, entwurf: s.status === 'entwurf' });
    const svgDatei = path.join(ZWISCHEN, ordner, `${s.datei}.svg`);
    fs.mkdirSync(path.dirname(svgDatei), { recursive: true });
    fs.writeFileSync(svgDatei, svg);
    if (neuGeschrieben) svgNeu = svgDatei;
    if (pngNoetig) {
      pngNeu = path.join(ZWISCHEN, ordner, `${s.datei}.png`);
      renderePng(browser, svgDatei, pngNeu, W, H);
    }
  }
  return { s, alt, ordner, geaendert, hash, stand, ver, svgNeu, pngNeu, svgZiel, pngZiel };
}

// Skizzen, die aus dem Katalog verschwunden sind
for (const [datei, alt] of Object.entries(zustand.skizzen)) {
  if (katalog.skizzen.some((s) => s.datei === datei)) continue;
  for (const ext of ['svg', 'png']) {
    if (verschiebe(path.join(AUS, alt.ordner, `${datei}.${ext}`), path.join(AUS, ARCHIV, `${datei}_${alt.stand}.${ext}`))) {
      log.archiviert.push(`${ARCHIV}/${datei}_${alt.stand}.${ext}`);
    }
  }
  log.loeschen.push(`${alt.ordner.split(path.sep).join('/')}/${datei}.svg und .png (nicht mehr im Katalog)`);
  delete zustand.skizzen[datei];
}

// Wunschliste nur beim allerersten Lauf beilegen, danach aus der Ausgabe nehmen,
// damit beim Kopieren nie die Einträge der Kollegen überschrieben werden
const wunschDatei = path.join(AUS, WUENSCHE);
if (!zustand.wunschlisteAngelegt) {
  fs.writeFileSync(wunschDatei, '\uFEFFSkizze;Wunsch;Von;Datum;Erledigt\r\n');
  zustand.wunschlisteAngelegt = heute;
  log.kopieren.push(`${WUENSCHE} (nur dieses eine Mal)`);
} else if (fs.existsSync(wunschDatei)) fs.rmSync(wunschDatei);

fs.writeFileSync(path.join(AUS, UEBERSICHT), uebersicht(eintraege));
fs.writeFileSync(STAND_DATEI, JSON.stringify(zustand, null, 2));
schreibeReadmeTabelle(eintraege);

// Protokoll (neuester Lauf oben)
const zeilen = [`=== ${datumDE(heute)} · Version ${version} ===`];
const teil = (titel, liste) => { if (liste.length) zeilen.push(titel, ...liste.map((l) => `  ${l}`)); };
teil('Auf das Netzlaufwerk kopieren (ersetzen):', [UEBERSICHT, PROTOKOLL, ...log.kopieren]);
teil('Auf dem Netzlaufwerk löschen:', log.loeschen);
teil('Ins Archiv verschoben (mitkopieren):', log.archiviert);
teil('Hinweise:', log.hinweise);
if (!log.kopieren.length && !log.loeschen.length) zeilen.push('Keine Skizze geändert — nur Übersicht und Protokoll neu.');
const protokollDatei = path.join(AUS, PROTOKOLL);
const bisher = fs.existsSync(protokollDatei) ? fs.readFileSync(protokollDatei, 'utf8').replace(/^\uFEFF/, '') : '';
fs.writeFileSync(protokollDatei, '\uFEFF' + zeilen.join('\r\n') + '\r\n\r\n' + bisher);
console.log(zeilen.join('\n'));
console.log(`\nAusgabe: ${AUS}`);

// ── Übersicht für die Kollegen ───────────────────────────────────────────────
function uebersicht(liste) {
  const reihenfolge = Object.keys(THEMEN);
  const sortiert = [...liste].sort((a, b) => reihenfolge.indexOf(a.thema) - reihenfolge.indexOf(b.thema) || a.titel.localeCompare(b.titel, 'de'));
  const url = (p) => p.split('/').map(encodeURIComponent).join('/');
  const karten = sortiert.map((s) => `
    <article class="karte" data-thema="${s.thema}" data-status="${s.status}" data-text="${esc([s.titel, s.datei, s.kapitel, s.beschreibung].join(' ').toLowerCase())}">
      <a class="bild" href="${url(s.png || s.svg)}" target="_blank"><img src="${url(s.png || s.svg)}" alt="${esc(s.titel)}" loading="lazy"></a>
      <div class="info">
        <div class="kopf"><span class="thema">${THEMEN[s.thema]}</span><span class="status s-${s.status}">${STATUS[s.status]}</span></div>
        <h2>${esc(s.titel)}</h2>
        <p>${esc(s.beschreibung)}</p>
        <dl><dt>Kapitel</dt><dd>${esc(s.kapitel || '–')}</dd><dt>Stand</dt><dd>${datumDE(s.stand)} · ${esc(s.version)}</dd>
        ${s.toolFigur ? `<dt>Im Tool</dt><dd>Analyse › Gutachten-Grafiken (${esc(s.toolFigur)})</dd>` : ''}</dl>
        <div class="links"><a href="${url(s.svg)}" target="_blank">SVG für Word</a>${s.png ? `<a href="${url(s.png)}" target="_blank">PNG</a>` : ''}<span class="name">${esc(s.datei)}</span></div>
      </div>
    </article>`).join('');
  const themenKnoepfe = Object.entries(THEMEN).map(([k, v]) => `<button data-f="${k}">${v}</button>`).join('');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skizzenbibliothek</title>
<style>
  :root { --gruen:#266426; --gruen2:#3F9C3F; --text:#1B1F1C; --grau:#5A5F5A; --hell:#8A8F8A; --linie:#E2E4DF; --bg:#FAFAF8; --orange:#C8641E; --blau:#2A64B4; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 Tahoma, Verdana, sans-serif; }
  header { border-top:5px solid var(--gruen); background:#fff; border-bottom:1px solid var(--linie); padding:18px 28px 14px; }
  .dach { font:500 11px Consolas, monospace; letter-spacing:.16em; color:var(--gruen2); text-transform:uppercase; }
  h1 { margin:4px 0 0; font-size:22px; }
  .hinweis { margin:14px 28px 0; padding:10px 14px; background:#FBF1E8; border:1px solid var(--orange); border-radius:3px; }
  .leiste { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:16px 28px; }
  .leiste input[type=search] { flex:1 1 240px; padding:7px 10px; border:1px solid #C9CCC5; border-radius:3px; font:inherit; }
  .leiste button { padding:6px 12px; border:1px solid #C9CCC5; background:#fff; border-radius:3px; font:inherit; cursor:pointer; }
  .leiste button.an { background:var(--gruen); color:#fff; border-color:var(--gruen); }
  .leiste label { color:var(--grau); }
  main { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:16px; margin:0 28px 28px; }
  .karte { background:#fff; border:1px solid var(--linie); border-radius:3px; display:flex; flex-direction:column; }
  .bild { display:block; background:var(--bg); border-bottom:1px solid var(--linie); aspect-ratio:4/3; overflow:hidden; }
  .bild img { width:100%; height:100%; object-fit:contain; object-position:top; }
  .info { padding:12px 14px 14px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .kopf { display:flex; gap:8px; font-size:12px; }
  .thema { color:var(--grau); }
  .status { padding:0 7px; border-radius:9px; font-weight:700; }
  .s-entwurf { background:#FBF1E8; color:var(--orange); } .s-abgestimmt { background:#EEF3EC; color:var(--gruen); } .s-im-tool { background:#EEF2F9; color:var(--blau); }
  h2 { margin:0; font-size:15px; }
  p { margin:0; color:var(--grau); }
  dl { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin:4px 0 0; font-size:12.5px; }
  dt { color:var(--hell); } dd { margin:0; }
  .links { margin-top:auto; padding-top:8px; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
  .links a { color:var(--gruen); font-weight:700; }
  .name { margin-left:auto; font:12px Consolas, monospace; color:var(--hell); }
  .leer { margin:0 28px; color:var(--grau); }
  footer { margin:0 28px 28px; color:var(--hell); font-size:12.5px; }
  @media (max-width:600px) { header, .leiste, main, footer { margin-left:16px; margin-right:16px; } .hinweis { margin:14px 16px 0; } main { grid-template-columns:1fr; } }
</style></head>
<body>
<header><div class="dach">LKEBw · Gutachten</div><h1>Skizzenbibliothek</h1></header>
<div class="hinweis"><b>Nur lesen.</b> Diese Ablage wird aus dem Tool-Repository erzeugt (docs/skizzen). Hier geänderte Dateien werden beim nächsten Abgleich überschrieben.
Änderungswünsche bitte in <b>${WUENSCHE}</b> in diesem Ordner eintragen${katalog.ansprechpartner ? ` oder an ${esc(katalog.ansprechpartner)} richten` : ''}.
Skizzen mit Status <b>Entwurf</b> sind noch nicht abgestimmt und liegen im Ordner Entwurf.</div>
<div class="leiste">
  <input type="search" id="suche" placeholder="Suchen: Titel, Kapitel, Stichwort …">
  <button data-f="" class="an">Alle</button>${themenKnoepfe}
  <label><input type="checkbox" id="entwuerfe" checked> Entwürfe zeigen</label>
</div>
<main id="liste">${karten}
</main>
<p class="leer" id="leer" hidden>Keine Skizze passt zur Auswahl.</p>
<footer>Stand der Übersicht ${datumDE(heute)} · Version ${esc(version)} · ${liste.length} Skizzen. Ältere Stände liegen im Ordner ${ARCHIV}, was sich geändert hat, steht in ${PROTOKOLL}.
SVG lässt sich in Word ab Microsoft 365 über Einfügen › Bilder verlustfrei einfügen; für ältere Programme das PNG nehmen.</footer>
<script>
  const karten = [...document.querySelectorAll('.karte')];
  let thema = '';
  function filtern() {
    const q = document.getElementById('suche').value.trim().toLowerCase();
    const entw = document.getElementById('entwuerfe').checked;
    let n = 0;
    for (const k of karten) {
      const ok = (!thema || k.dataset.thema === thema) && (entw || k.dataset.status !== 'entwurf') && (!q || k.dataset.text.includes(q));
      k.hidden = !ok; if (ok) n++;
    }
    document.getElementById('leer').hidden = n > 0;
  }
  document.querySelectorAll('.leiste button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.leiste button').forEach((x) => x.classList.toggle('an', x === b));
    thema = b.dataset.f; filtern();
  }));
  document.getElementById('suche').addEventListener('input', filtern);
  document.getElementById('entwuerfe').addEventListener('change', filtern);
</script>
</body></html>
`;
}

// Tabelle im README zwischen den Markern neu schreiben
function schreibeReadmeTabelle(liste) {
  const datei = path.join(BIB, 'README.md');
  if (!fs.existsSync(datei)) return;
  const text = fs.readFileSync(datei, 'utf8');
  const kopf = '| Skizze | Thema | Kapitel | Status | Quelle | Stand |\n|---|---|---|---|---|---|\n';
  const zeilen = liste.map((s) => `| [${s.titel}](${s.thema}/${s.datei}.svg) | ${THEMEN[s.thema]} | ${s.kapitel || '–'} | ${STATUS[s.status]} | ` +
    `${s.quelle ? `\`${s.quelle}\`` : s.toolFigur ? `Tool-Figur \`${s.toolFigur}\`` : 'nur SVG'} | ${datumDE(s.stand)} |`).join('\n');
  const neu = text.replace(/(<!-- katalog:start -->)[\s\S]*?(<!-- katalog:end -->)/, `$1\n${kopf}${zeilen}\n$2`);
  if (neu !== text) fs.writeFileSync(datei, neu);
}

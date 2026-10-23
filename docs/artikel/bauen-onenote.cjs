// Baut die OneNote-Fassung aus derselben Vorlage wie die Web-Fassung (bauen.cjs):
// alle Stile inline, Abbildungen als PNG (Edge rendert, sharp verkleinert), Kästen als Tabellen.
// node docs/artikel/bauen-onenote.cjs [Artikel|alle] [Zielordner]   Standard: alle → artikel-ausgabe/
// Kopfangaben (Dachzeile, Zweck, Grundlage, Stand) aus <meta name="on-…"> der Vorlage.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const sharp = require('sharp');

const REPO = path.resolve(__dirname, '../..');
const skizzen = path.join(REPO, 'docs', 'skizzen');
const katalog = JSON.parse(fs.readFileSync(path.join(skizzen, 'katalog.json'), 'utf8')).skizzen;
const LOGO = fs.readFileSync(path.join(REPO, 'src/config/lkebw-logo.js'), 'utf8')
  .match(/export const LKEBW_LOGO = '(data:image\/png;base64,[A-Za-z0-9+/=]+)'/)[1];
const wahl = process.argv[2] || 'alle';
const ZIEL_ORDNER = path.resolve(process.argv[3] || path.join(REPO, 'artikel-ausgabe'));
const artikelListe = wahl === 'alle'
  ? fs.readdirSync(__dirname).filter(d => d.endsWith('.html')).map(d => d.slice(0, -5))
  : [wahl];
// je Artikel gesetzt (siehe unten)
let artikel, VORLAGE, BILDER_NAME, BILDER, ZIEL;
const meta = name => {
  const m = new RegExp(`<meta name="on-${name}" content="([^"]*)"`).exec(fs.readFileSync(VORLAGE, 'utf8'));
  if (!m) throw new Error(`${artikel}: <meta name="on-${name}"> fehlt`);
  return m[1];
};
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);

// ── Stile wie im Netzanschluss-Papier (OneNote) ──────────────────────────────
const F = 'font-family:Tahoma,Verdana,sans-serif;';
const S = {
  body: `${F}background:#FFFFFF;color:#1B1F1C;margin:24px;max-width:760px;`,
  p: `${F}font-size:10.5pt;color:#1B1F1C;margin:0 0 8px;line-height:1.45;`,
  klein: `${F}font-size:9pt;color:#5A5F5A;margin:2px 0 10px;`,
  merke: `${F}font-size:10.5pt;background:#EEF3EC;border-left:5px solid #266426;padding:6px 10px;margin:4px 0 10px;`,
  merkeEza: `${F}font-size:10.5pt;background:#FBF1EA;border-left:5px solid #C8641E;padding:6px 10px;margin:4px 0 10px;`,
  h1: `${F}font-size:22pt;font-weight:bold;color:#1B1F1C;margin:6px 0 4px;`,
  h2: `${F}font-size:15pt;font-weight:bold;color:#266426;margin:22px 0 6px;border-bottom:3px solid #266426;padding-bottom:2px;`,
  h3: `${F}font-size:11.5pt;font-weight:bold;color:#266426;margin:12px 0 4px;`,
  eyebrow: `${F}font-size:9pt;letter-spacing:2px;color:#3F9C3F;font-weight:bold;margin:10px 0 0;`,
  table: `${F}border-collapse:collapse;font-size:10pt;margin:4px 0 10px;width:760px;`,
  th: `${F}background:#EEF3EC;color:#266426;font-weight:bold;text-align:left;vertical-align:top;padding:5px 8px;border:1px solid #C9CCC5;`,
  thEza: `${F}background:#FBF1EA;color:#C8641E;font-weight:bold;text-align:left;vertical-align:top;padding:5px 8px;border:1px solid #C9CCC5;`,
  thRot: `${F}background:#FBECEB;color:#B3261E;font-weight:bold;text-align:left;vertical-align:top;padding:5px 8px;border:1px solid #C9CCC5;`,
  td: `${F}text-align:left;vertical-align:top;padding:5px 8px;border:1px solid #C9CCC5;`,
  list: 'margin:0 0 8px 0;',
  li: `${F}font-size:10.5pt;margin:0 0 4px;`,
  zeile: `${F}font-size:10pt;margin:0 0 4px;line-height:1.4;`,
  a: 'color:#266426;',
  img: 'width:758px;max-width:100%;border:1px solid #E2E4DF;',
};

// ── Mini-Parser: die Vorlage ist wohlgeformt und von uns geschrieben ─────────
const VOID = new Set(['img', 'meta', 'br', 'hr', 'input', 'link']);
function parse(html) {
  const root = { tag: '#root', attrs: {}, kinder: [] };
  const stapel = [root];
  for (const tok of html.split(/(<[^>]+>)/)) {
    if (!tok) continue;
    const top = stapel[stapel.length - 1];
    if (tok.startsWith('<!') || tok.startsWith('<?')) continue;
    const zu = /^<\/([a-z0-9]+)/i.exec(tok);
    if (zu) {
      if (top.tag !== zu[1].toLowerCase()) throw new Error(`</${zu[1]}> schließt <${top.tag}>`);
      stapel.pop(); continue;
    }
    const auf = /^<([a-z0-9]+)([^>]*)>$/i.exec(tok);
    if (auf) {
      const attrs = {};
      for (const m of auf[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[m[1]] = m[2] ?? '';
      const knoten = { tag: auf[1].toLowerCase(), attrs, cls: (attrs.class || '').split(/\s+/).filter(Boolean), kinder: [] };
      top.kinder.push(knoten);
      if (!VOID.has(knoten.tag) && !auf[2].endsWith('/')) stapel.push(knoten);
      continue;
    }
    top.kinder.push(tok);
  }
  return root;
}
const hat = (k, c) => typeof k === 'object' && k.cls.includes(c);
const elemente = k => k.kinder.filter(x => typeof x === 'object');
const finde = (k, pred) => {
  for (const x of k.kinder) {
    if (typeof x !== 'object') continue;
    if (pred(x)) return x;
    const t = finde(x, pred); if (t) return t;
  }
  return null;
};
const text = k => typeof k === 'string' ? k : k.kinder.map(text).join('');

// ── Abbildungen: SVG → PNG (2×) → verkleinert ────────────────────────────────
const abbNr = new Map();
async function bild(name, eigen) {
  const k = eigen || katalog.find(e => e.datei === name);
  if (!k) throw new Error('Nicht im Katalog: ' + name);
  const svgDatei = eigen ? eigen.datei : path.join(skizzen, k.thema, name + '.svg');
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(fs.readFileSync(svgDatei, 'utf8'));
  const nr = abbNr.size + 1; abbNr.set(name, nr);
  fs.mkdirSync(BILDER, { recursive: true });
  const roh = path.join(BILDER, `_roh_${name}.png`);
  const png = path.join(BILDER, `Abb${nr}_${name.replace(/^Prinzip-/, '')}.png`);
  execFileSync(EDGE, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--user-data-dir=${path.join(BILDER, '_edge')}`, `--screenshot=${roh}`,
    `--window-size=${Math.round(vb[1])},${Math.round(vb[2])}`, pathToFileURL(svgDatei).href], { stdio: 'ignore' });
  if (!fs.existsSync(roh)) throw new Error('Edge hat kein PNG geschrieben: ' + name);
  await sharp(roh).resize({ width: 1600 }).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(png);
  fs.rmSync(roh);
  return { png, titel: k.titel, b64: fs.readFileSync(png).toString('base64') };
}

// ── Rendern ───────────────────────────────────────────────────────────────────
const bilder = {};
function inline(k) {
  if (typeof k === 'string') return k;
  const innen = k.kinder.map(inline).join('');
  switch (k.tag) {
    case 'a': return `<a href="${k.attrs.href}" target="_blank" rel="noopener" style="${S.a}">${innen}</a>`;
    case 'b': case 'sub': case 'em': case 'i': return `<${k.tag}>${innen}</${k.tag}>`;
    case 'span': return hat(k, 'art') ? `<span style="color:${hat(k, 'norm') ? '#C8641E' : '#5A5F5A'};">${innen}</span>` : innen;
    default: return innen;
  }
}
// Listen in Tabellenzellen und ±-Listen als Zeilen, damit OneNote sie nicht doppelt bebullet
function zeilen(liste, praefix) {
  return elemente(liste).map(li => `<p style="${S.zeile}">${praefix}${inline(li)}</p>`).join('');
}
function kastenInhalt(kasten) {
  return elemente(kasten).filter(x => x.tag !== 'h3').map(x => {
    if (x.tag === 'ul' && hat(x, 'plus')) return zeilen(x, '<span style="color:#3F9C3F;font-weight:bold;">+</span>&nbsp; ');
    if (x.tag === 'ul' && hat(x, 'minus')) return zeilen(x, '<span style="color:#B3261E;font-weight:bold;">–</span>&nbsp; ');
    if (x.tag === 'ul' || x.tag === 'ol') return zeilen(x, '•&nbsp; ');
    return `<p style="${S.zeile}">${inline(x)}</p>`;
  }).join('');
}
function spalten(k) {
  const kaesten = elemente(k);
  if (kaesten.length === 2 && hat(kaesten[0], 'dafuer') && hat(kaesten[1], 'dagegen')) {
    return `<table width="760" style="${S.table}"><tr><th style="${S.th}width:380px;">${inline(finde(kaesten[0], x => x.tag === 'h3'))}</th>` +
      `<th style="${S.thRot}width:380px;">${inline(finde(kaesten[1], x => x.tag === 'h3'))}</th></tr>` +
      `<tr><td style="${S.td}">${kastenInhalt(kaesten[0])}</td><td style="${S.td}">${kastenInhalt(kaesten[1])}</td></tr></table>`;
  }
  return kaesten.map(kasten => `<table width="760" style="${S.table}"><tr><th style="${hat(kasten, 'eza') ? S.thEza : S.th}">${inline(finde(kasten, x => x.tag === 'h3'))}</th></tr>` +
    `<tr><td style="${S.td}">${kastenInhalt(kasten)}</td></tr></table>`).join('');
}
function herausforderungen(k) {
  let html = `<table width="760" style="${S.table}"><tr><th style="${S.thEza}width:340px;">Herausforderung</th><th style="${S.thEza}width:120px;">Trifft</th><th style="${S.thEza}width:300px;">Lösung</th></tr>`;
  for (const kasten of elemente(k)) {
    const h3 = finde(kasten, x => x.tag === 'h3');
    const nr = text(finde(h3, x => x.tag === 'b'));
    const titel = text(h3).replace(nr, '').trim();
    const ps = elemente(kasten).filter(x => x.tag === 'p');
    const trifft = text(finde(kasten, x => x.tag === 'em'));
    const beschr = ps.filter(p => !hat(p, 'trifft') && !hat(p, 'loesung')).map(inline).join(' ');
    const loesung = inline(ps.find(p => hat(p, 'loesung'))).replace(/^\s*<b>Lösung:<\/b>\s*/, '');
    html += `<tr><td style="${S.td}"><b><span style="color:#C8641E;">${nr}</span> ${titel}</b><br>${beschr}</td><td style="${S.td}">${trifft}</td><td style="${S.td}">${loesung}</td></tr>`;
  }
  return html + '</table>';
}
function block(k) {
  if (typeof k === 'string') return k.trim() ? k : '\n';
  const innen = () => k.kinder.map(block).join('');
  switch (k.tag) {
    case 'nav': case 'dialog': case 'script': case 'header': case 'footer': return '';
    case 'section': case 'button': return innen();
    case 'div':
      if (hat(k, 'regel')) return '';
      if (hat(k, 'spalten')) return spalten(k);
      if (hat(k, 'herausforderungen')) return herausforderungen(k);
      return innen();
    case 'h2': {
      const nr = text(finde(k, x => x.tag === 'b'));
      return `<h2 style="${S.h2}"><span style="color:#3F9C3F;">${nr}</span>&nbsp;&nbsp;${text(k).replace(nr, '').trim()}</h2>`;
    }
    case 'h3': return `<h3 style="${S.h3}">${inline(k)}</h3>`;
    case 'p':
      if (hat(k, 'hinweis-lupe')) return '';
      if (hat(k, 'merke')) return `<p style="${hat(k, 'eza') ? S.merkeEza : S.merke}">${inline(k)}</p>`;
      if (hat(k, 'tabcap')) return `<p style="${S.klein}">${inline(k)}</p>`;
      return `<p style="${S.p}">${inline(k)}</p>`;
    case 'ul': case 'ol': return `<${k.tag} style="${S.list}">${elemente(k).map(li => `<li style="${S.li}">${inline(li)}</li>`).join('')}</${k.tag}>`;
    case 'table': {
      const zeilenK = [];
      (function sammle(x) { for (const y of elemente(x)) y.tag === 'tr' ? zeilenK.push(y) : sammle(y); })(k);
      return `<table width="760" style="${S.table}">` + zeilenK.map(tr => '<tr>' + elemente(tr).map(z =>
        z.tag === 'th' ? `<th style="${hat(z, 'eza') ? S.thEza : S.th}">${inline(z)}</th>`
          : `<td style="${S.td}${hat(z, 'num') ? 'font-family:Consolas,monospace;white-space:nowrap;' : ''}">${inline(z)}</td>`).join('') + '</tr>').join('') + '</table>';
    }
    case 'figure': {
      const img = finde(k, x => x.tag === 'img');
      const b = bilder[img.attrs.alt];
      const cap = finde(k, x => x.tag === 'figcaption');
      return `<p style="margin:6px 0 2px;"><img src="data:image/png;base64,${b.b64}" alt="${img.attrs.alt}" width="758" style="${S.img}"></p>` +
        `<p style="${S.klein}">${inline(cap)}</p>`;
    }
    default: throw new Error('Nicht behandelt: <' + k.tag + ' class="' + k.cls.join(' ') + '">');
  }
}

async function einArtikel() {
  const STAND = meta('stand');
  const vorlage = fs.readFileSync(VORLAGE, 'utf8');
  const baum = parse(vorlage.slice(vorlage.indexOf('<main'), vorlage.indexOf('</main>') + 7));
  const main = finde(baum, x => x.tag === 'main');
  const kopf = finde(main, x => x.tag === 'header');

  // Skizzen und eigene Abbildungen in Reihenfolge des Auftretens rendern, Schlüssel = alt-Text = Titel
  for (const m of vorlage.matchAll(/\{\{FIG:([\w-]+)\}\}|\{\{SVG:([^|}]+)\|([^}]+)\}\}/g)) {
    const b = m[1] ? await bild(m[1]) : await bild(path.basename(m[2], '.svg'), { datei: path.join(__dirname, m[2]), titel: m[3] });
    bilder[b.titel] = b;
  }
  // Platzhalter in der Vorlage durch ein img mit dem Titel ersetzen, damit figure() es findet
  const mitBildern = vorlage.replace(/\{\{FIG:([\w-]+)\}\}/g, (_, n) => `<img alt="${katalog.find(e => e.datei === n).titel}">`)
    .replace(/\{\{SVG:([^|}]+)\|([^}]+)\}\}/g, (_, d, t) => `<img alt="${t}">`);
  const baum2 = parse(mitBildern.slice(mitBildern.indexOf('<main'), mitBildern.indexOf('</main>') + 7));
  const main2 = finde(baum2, x => x.tag === 'main');

  const h1 = text(finde(kopf, x => x.tag === 'h1'));
  const lead = finde(kopf, x => hat(x, 'lead'));
  const kurz = finde(kopf, x => hat(x, 'merke'));
  const fuss = text(finde(main, x => x.tag === 'footer')).trim();

  let html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${h1} (intern)</title></head>
<body style="${S.body}">
<p style="${S.klein}margin:0;">So in OneNote übernehmen: diese Datei im Browser öffnen, Strg+A, Strg+C, in OneNote Strg+V. Die Abbildungen liegen zusätzlich als PNG im Ordner „${BILDER_NAME}".</p>
<hr style="border:0;border-top:4px solid #266426;margin:10px 0 14px;">
<p style="margin:0;"><img src="${LOGO}" alt="LKEBw" width="128" style="width:128px;"></p>
<p style="${S.eyebrow}">${meta('eyebrow')}</p>
<h1 style="${S.h1}">${h1}</h1>
<table width="760" style="${S.table}"><tr><th style="${S.th}">Stand</th><th style="${S.th}">Zweck</th><th style="${S.th}">Grundlage</th></tr><tr><td style="${S.td}">${STAND}</td><td style="${S.td}">${meta('zweck')}</td><td style="${S.td}">${meta('grundlage')}</td></tr></table>
<p style="${S.merke}">${inline(kurz)} Dieselbe Fassung mit vergrößerbaren Abbildungen gibt es als „${artikel}_Web.html".</p>
<p style="${S.p}">${inline(lead)}</p>
`;
  html += elemente(main2).map(block).join('\n');
  html += `\n<hr style="border:0;border-top:1px solid #E2E4DF;margin:16px 0 6px;">
<p style="${S.klein}">${fuss}</p>
<p style="${S.klein}">LKEBw · intern · ${h1} · Stand ${STAND}</p>
</body></html>
`;
  fs.rmSync(path.join(BILDER, '_edge'), { recursive: true, force: true });
  fs.writeFileSync(ZIEL, html);
  console.log(ZIEL, Math.round(html.length / 1024) + ' KB');
  for (const b of Object.values(bilder)) console.log('  ', path.basename(b.png), Math.round(b.b64.length * 0.75 / 1024) + ' KB');
}

(async () => {
  fs.mkdirSync(ZIEL_ORDNER, { recursive: true });
  for (const a of artikelListe) {
    artikel = a;
    VORLAGE = path.join(__dirname, `${a}.html`);
    BILDER_NAME = `${a}-OneNote-Bilder`;
    BILDER = path.join(ZIEL_ORDNER, BILDER_NAME);
    ZIEL = path.join(ZIEL_ORDNER, `${a}_OneNote.html`);
    abbNr.clear();
    for (const k of Object.keys(bilder)) delete bilder[k];
    await einArtikel();
  }
})().catch(e => { console.error(e); process.exit(1); });

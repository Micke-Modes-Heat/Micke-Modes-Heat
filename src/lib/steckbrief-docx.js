// ── lib/steckbrief-docx.js — Anlagenteil des Gutachtens als OOXML (word/document.xml) ──
// DOM-frei. Formatierung wie der Anlagenteil der Vorlage „Gutachten_Energieversorgung_LKEBw":
//   • „Anlagen" (neue Seite, fett 20 pt) mit zweispaltiger Liste „Anlage I | Titel" (grüne Nummer,
//     graue Haarlinien) — steht direkt hinter den Verzeichnissen
//   • jede Anlage auf einer neuen Seite: Kennzeile „ANLAGE I" (Kapitälchen, hellgrün, gesperrt,
//     9,5 pt), darunter der Titel fett 20 pt, dann der Inhalt
// Inhalt einer Stations-Anlage ist das Steckbrief-Blatt aus lib/stations-steckbrief.js
// (ssSteckbriefBlatt) — dieselben Zeilen wie Druckfassung und Seitenvorschau.

import { GD_FARBE, GD_SEITE } from './docx-paket.js';
import { gdxLauf, gdxAbsatz } from './gutachten-docx.js';
import { SS_BLATT_SPALTEN } from './stations-steckbrief.js';

const ENG = 'w:after="0" w:line="240" w:lineRule="auto"';
const RAND = `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="C5CCC4"/><w:left w:val="single" w:sz="4" w:space="0" w:color="C5CCC4"/>`
  + `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="C5CCC4"/><w:right w:val="single" w:sz="4" w:space="0" w:color="C5CCC4"/></w:tcBorders>`;
const RAND_LISTE = `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${GD_FARBE.linie}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${GD_FARBE.linie}"/></w:tcBorders>`;
const MARGE = '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar>';
const SZ = 18;   // 9 pt — das Blatt ist dicht wie die Word-Vorlage des Steckbriefs

/** Spaltenbreiten des Blatts (twips): 24 % Bezeichnung, je 19 % für die vier Angabespalten */
export function ssdxSpalten(gesamt = GD_SEITE.breiteTw) {
  const b = [0.24, 0.19, 0.19, 0.19, 0.19].map(f => Math.round(gesamt * f));
  b[b.length - 1] += gesamt - b.reduce((s, x) => s + x, 0);
  return b;
}

function tc(breite, absaetze, { span = 1, fill = '', rand = RAND } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rand}`
    + (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '') + `${MARGE}</w:tcPr>${absaetze || gdxAbsatz('', { abstand: ENG })}</w:tc>`;
}

const tabelle = (breiten, zeilen, { einzug = 0 } = {}) => `<w:tbl><w:tblPr><w:tblW w:w="${breiten.reduce((s, b) => s + b, 0)}" w:type="dxa"/>`
  + `<w:tblInd w:w="${einzug}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>`
  + `<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${breiten.map(b => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>${zeilen}</w:tbl>`;

/** Zelle des Blatts → Absätze (eine Zeile je Eintrag; grauer Zusatz am Ende) */
function zellAbsaetze(z) {
  const zeilen = (Array.isArray(z.t) ? z.t : [z.t]).map(v => (v == null ? '' : String(v)));
  const lauf = z.lbl ? { b: true, sz: SZ } : { sz: SZ };
  const hat = zeilen.some(Boolean);
  // Leere Zelle mit grauem Hinweis: nur der Hinweis, keine Leerzeile davor
  const out = hat || !z.mut ? zeilen.map(t => gdxAbsatz(t ? gdxLauf(t, lauf) : '', { abstand: ENG })) : [];
  if (z.mut) {
    out.push(gdxAbsatz(gdxLauf(hat ? `(${z.mut})` : z.mut, { sz: 16, farbe: GD_FARBE.grau, i: !z.lbl }), { abstand: ENG }));
  }
  return out.join('');
}

/** Steckbrief-Blatt als Word-Tabelle */
export function ssdxBlattTabelle(blatt) {
  const br = ssdxSpalten();
  const breite = (start, span) => br.slice(start, start + span).reduce((s, b) => s + b, 0);
  const rows = blatt.zeilen.map(r => {
    if (r.art === 'titel') {
      const t = text => gdxAbsatz(gdxLauf(text, { b: true, farbe: 'FFFFFF', sz: 19 }), { abstand: ENG, keepNext: true });
      const inhalt = r.rechts
        ? tc(breite(0, 2), t(r.text), { span: 2, fill: GD_FARBE.gruen }) + tc(breite(2, 3), t(r.rechts), { span: 3, fill: GD_FARBE.gruen })
        : tc(breite(0, SS_BLATT_SPALTEN), t(r.text), { span: SS_BLATT_SPALTEN, fill: GD_FARBE.gruen });
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${inhalt}</w:tr>`;
    }
    if (r.art === 'fotos') {
      // Fotos aus der Feld-App liegen nur in der Sitzung (nicht in der Projektdatei) — im Word-Blatt
      // steht deshalb die Fotozeile der Vorlage mit Hinweis statt der Bilder.
      const hinweis = r.fotos.length ? `${r.fotos.length} Foto(s) aus der Begehung — siehe Fotodokumentation` : '—';
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tc(breite(0, SS_BLATT_SPALTEN),
        gdxAbsatz(gdxLauf(`Fotos (${r.text})`, { b: true, sz: SZ }), { abstand: ENG })
        + gdxAbsatz(gdxLauf(hinweis, { sz: 16, farbe: GD_FARBE.grau }), { abstand: ENG }), { span: SS_BLATT_SPALTEN })}</w:tr>`;
    }
    let spalte = 0;
    const zellen = r.zellen.map(z => {
      const span = Math.max(1, z.span || 1);
      const x = tc(breite(spalte, span), zellAbsaetze(z), { span, fill: z.lbl ? GD_FARBE.band : '' });
      spalte += span;
      return x;
    }).join('');
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${zellen}</w:tr>`;
  }).join('');
  return tabelle(br, rows);
}

/** Seite „Anlagen" mit der Liste aller Anlagen (eintraege: [{nr: 'I', titel}]) */
export function ssdxAnlagenVerzeichnis(eintraege) {
  if (!eintraege.length) return '';
  const br = [2041, GD_SEITE.breiteTw - 2041];
  const rows = eintraege.map(e => `<w:tr>`
    + tc(br[0], gdxAbsatz(gdxLauf(`Anlage ${e.nr}`, { farbe: GD_FARBE.gruen, sz: 19 }), { abstand: ENG }), { rand: RAND_LISTE })
    + tc(br[1], gdxAbsatz(gdxLauf(e.titel, { sz: 20 }), { abstand: ENG }), { rand: RAND_LISTE })
    + `</w:tr>`).join('');
  return gdxAbsatz('<w:r><w:br w:type="page"/></w:r>' + gdxLauf('Anlagen', { b: true, sz: 40 }), { keepNext: true, abstand: 'w:after="200"' })
    + tabelle(br, rows, { einzug: 100 })
    + gdxAbsatz('', { abstand: 'w:after="0"' });
}

/** Eine Anlage: neue Seite, Kennzeile „ANLAGE I", Titel, Inhalt (fertiges OOXML) */
export function ssdxAnlage({ nr, titel, inhalt, fussnote = '' }) {
  return gdxAbsatz('<w:r><w:br w:type="page"/></w:r>' + gdxLauf(`Anlage ${nr}`, { caps: true, farbe: GD_FARBE.gruenHell, abstand: 30, sz: 19 }),
    { abstand: 'w:after="80"' })
    + gdxAbsatz(gdxLauf(titel, { b: true, sz: 40 }), { keepNext: true, abstand: 'w:after="200"' })
    + inhalt
    + (fussnote ? gdxAbsatz(gdxLauf(fussnote, { sz: 17, farbe: GD_FARBE.grau }), { abstand: 'w:before="120" w:after="0"' }) : '');
}

/** Stations-Steckbrief als Anlage */
export function ssdxSteckbriefAnlage(nr, titel, blatt) {
  return ssdxAnlage({ nr, titel, inhalt: ssdxBlattTabelle(blatt),
    fussnote: `Datum der Begehung: ${blatt.kopf.begehung || '__.__.____'}` });
}

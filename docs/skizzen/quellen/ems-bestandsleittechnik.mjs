// Prinzip-EMS-Bestandsleittechnik: Varianten A/B/C mit Dafür/Dagegen und Prüffragen
import { C, T, TL, R, P, badge, wrap, frame, schreibe } from './_basis.mjs';

function svgVarianten() {
  const W = 1000, H = 1150;
  let b = '';
  const cols = [30, 352, 674], w = 296;
  const head = [
    ['A · Getrennte Netzregelung', 'GLT übernimmt das EMS, EZA-Regler eigenständig', C.gl, C.g],
    ['B · Alles in der Bestandsleittechnik', 'GLT ist EMS, Fernwirkstelle und EZA-Regler', C.rl, C.r],
    ['C · Netzleittechnik mit Reglerbaustein', 'zertifizierter Parkregler im MS-Leitsystem', C.bl, C.b],
  ];
  cols.forEach((x, i) => {
    const [h, sub, fill, stroke] = head[i];
    b += R(x, 92, w, 52, { fill, stroke, sw: 1.4, rx: 3 }) + T(x + 12, 113, h, { size: 12.5, bold: true, fill: C.t }) + T(x + 12, 131, sub, { size: 10 });
    b += R(x, 154, w, 370, { fill: '#fff', stroke: C.br, sw: 1, rx: 0 });
    b += R(x + 10, 166, 130, 34, { stroke: C.l, dash: '4 3' }) + T(x + 75, 187, 'Netzbetreiber', { size: 10.5, bold: true, anchor: 'middle', fill: C.t });
    b += R(x + 156, 166, 130, 34, { stroke: C.l, dash: '4 3' }) + T(x + 221, 187, 'Direktvermarkter', { size: 10.5, bold: true, anchor: 'middle', fill: C.t });
    b += P(`M${x + 4} 216 H${x + w - 4}`, { stroke: C.l, sw: 1.2, dash: '5 4' });
    // Einheiten unten (alle Varianten gleich)
    b += R(x + 10, 470, 150, 42, { fill: C.gr }) + T(x + 85, 488, 'PV · Batterie', { size: 10.5, bold: true, anchor: 'middle', fill: C.t }) + T(x + 85, 503, 'Umrichter', { size: 10, anchor: 'middle' });
    b += R(x + 176, 470, 110, 42, { fill: C.gr }) + T(x + 231, 488, 'Verbraucher', { size: 10.5, bold: true, anchor: 'middle', fill: C.t }) + T(x + 231, 503, 'WP · Laden', { size: 10, anchor: 'middle' });
  });
  const glt = (x, y, lines) => R(x + 176, y, 110, 64, { fill: C.gl, stroke: C.g, sw: 1.4 }) +
    T(x + 231, y + 20, 'Bestands-GLT', { size: 10.5, bold: true, anchor: 'middle', fill: C.g }) + TL(x + 231, y + 36, lines, { size: 10, anchor: 'middle', lh: 13 });

  // A
  let x = cols[0];
  b += R(x + 10, 232, 130, 30, { stroke: C.o, sw: 1.3 }) + T(x + 75, 251, 'Fernwirkgerät', { size: 10.5, bold: true, anchor: 'middle', fill: C.t });
  b += R(x + 156, 232, 130, 30, { stroke: C.o, sw: 1.3 }) + T(x + 221, 251, 'Steuerbox DV', { size: 10.5, bold: true, anchor: 'middle', fill: C.t });
  b += P(`M${x + 75} 200 V231`, { stroke: C.o, sw: 1.6, end: 'aO' }) + P(`M${x + 221} 200 V231`, { stroke: C.o, sw: 1.6, end: 'aO' });
  b += P(`M${x + 75} 262 V299`, { stroke: C.o, sw: 1.6, end: 'aO' }) + P(`M${x + 221} 262 V280 H${x + 130} V299`, { stroke: C.o, sw: 1.6, end: 'aO' });
  b += R(x + 10, 300, 150, 56, { fill: C.ol, stroke: C.o, sw: 1.6, rx: 3 }) + T(x + 85, 323, 'EZA-Regler', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(x + 85, 340, 'eigenes Gerät, zertifiziert', { size: 10, anchor: 'middle' });
  b += P(`M${x + 160} 340 H${x + 231} V379`, { stroke: C.b, sw: 1.6, end: 'aB', start: 'aB' }) + T(x + 226, 368, 'Wunsch · Messwerte', { size: 9.5, anchor: 'end', fill: C.b });
  b += glt(x, 380, ['+ EMS-Funktion', 'Bedienen, Monitoring']);
  b += P(`M${x + 85} 356 V469`, { stroke: C.o, sw: 1.6, end: 'aO' }) + T(x + 91, 420, 'Modbus / SunSpec', { size: 9.5, fill: C.o });
  b += P(`M${x + 231} 444 V469`, { stroke: C.b, sw: 1.6, end: 'aB' });

  // B
  x = cols[1];
  b += P(`M${x + 75} 200 V245`, { stroke: C.o, sw: 1.6, end: 'aO' }) + P(`M${x + 221} 200 V245`, { stroke: C.o, sw: 1.6, end: 'aO' });
  b += R(x + 10, 246, 276, 152, { fill: C.gl, stroke: C.g, sw: 1.6, rx: 3 }) + T(x + 22, 264, 'Bestands-GLT (Server + DDC)', { size: 11, bold: true, fill: C.g }) + badge(x + 272, 260, '4');
  const rowsB = [['IEC-104-Treiber als Unterstation', ['3']], ['Schnittstelle Direktvermarkter', ['3']], ['EMS-Funktion', []], ['EZA-Regelung als Software', ['1', '2']]];
  rowsB.forEach(([t, bs], i) => {
    const y = 274 + i * 29;
    b += R(x + 22, y, 252, 24, { stroke: i === 3 ? C.o : C.g2, fill: i === 3 ? C.ol : '#fff', sw: 1.2 }) + T(x + 32, y + 16, t, { size: 10, fill: C.t });
    bs.forEach((n, k) => { b += badge(x + 262 - (bs.length - 1 - k) * 18, y + 12, n); });
  });
  b += P(`M${x + 148} 398 V419`, { stroke: C.b, sw: 1.6, end: 'aB' });
  b += R(x + 60, 420, 176, 28, { stroke: C.b, sw: 1.3 }) + T(x + 140, 438, 'Gateway BACnet → Modbus', { size: 10, anchor: 'middle', fill: C.t }) + badge(x + 226, 434, '2');
  b += P(`M${x + 85} 448 V469`, { stroke: C.o, sw: 1.6, end: 'aO' }) + P(`M${x + 221} 448 V469`, { stroke: C.b, sw: 1.6, end: 'aB' });

  // C
  x = cols[2];
  b += P(`M${x + 75} 200 V235`, { stroke: C.o, sw: 1.6, end: 'aO' }) + P(`M${x + 221} 200 V235`, { stroke: C.o, sw: 1.6, end: 'aO' });
  b += R(x + 10, 236, 276, 122, { fill: C.bl, stroke: C.b, sw: 1.6, rx: 3 }) + T(x + 22, 254, 'Netzleittechnik der Liegenschaft', { size: 11, bold: true, fill: C.b }) + T(x + 22, 268, 'nur wenn eigenes MS-Netz fernüberwacht', { size: 10 });
  b += R(x + 22, 278, 252, 26, { stroke: C.o, sw: 1.2 }) + T(x + 32, 295, 'Fernwirk-Kopplung NB und DV', { size: 10, fill: C.t });
  b += R(x + 22, 312, 252, 36, { fill: C.ol, stroke: C.o, sw: 1.2 }) + T(x + 32, 327, 'Parkregler-Baustein', { size: 10.5, bold: true, fill: C.t }) + T(x + 32, 341, 'mit eigenem Komponentenzertifikat', { size: 10 });
  b += P(`M${x + 231} 358 V379`, { stroke: C.b, sw: 1.6, end: 'aB', start: 'aB' }) + T(x + 224, 372, 'Wunsch · Messwerte', { size: 9.5, anchor: 'end', fill: C.b });
  b += glt(x, 380, ['+ EMS-Funktion', 'Bedienen, Monitoring']);
  b += P(`M${x + 85} 358 V469`, { stroke: C.o, sw: 1.6, end: 'aO' }) + T(x + 91, 420, 'Modbus / SunSpec', { size: 9.5, fill: C.o });
  b += P(`M${x + 231} 444 V469`, { stroke: C.b, sw: 1.6, end: 'aB' });

  // Dafür / Dagegen
  const pc = [
    {
      pro: ['Zertifizierte Regelkette bleibt unberührt', 'GLT-Updates ohne Folgen für den Netzanschluss', 'Klare Haftung: Netzregelung beim EZA-Lieferanten', 'Bestands-GLT bleibt nutzbar (EMS, Bedienung)'],
      con: [[null, 'Zusätzliches Gerät und eine Schnittstelle EZA ↔ GLT'], [null, 'Zwei Systeme, zwei Wartungsverträge'], [null, 'Schnittstelle muss abgestimmt und gemeinsam getestet werden']],
      fazit: ['Empfehlung', 'Regelfall über 500 kW bzw. 270 kW Einspeisung'], col: C.g,
    },
    {
      pro: ['Ein System, eine Oberfläche, bekanntes Personal', 'Mess- und Zählerdaten liegen schon in der GLT', 'Auf den ersten Blick geringere Investition'],
      con: [['1', 'Kein Komponentenzertifikat: Anlagenzertifikat scheitert oder wird teurer Einzelnachweis'], ['2', 'Zykluszeit und Verfügbarkeit einer GLT (Polling, Server-Neustart) reichen selten'], ['3', 'Fernzugang für NB und DV ins GA-Netz vergrößert die Angriffsfläche'], ['4', 'Jedes GLT-Update berührt die Netzregelung; GLT lebt kürzer als die EZA'], [null, 'Herstellerbindung, Erweiterung meist nur als Nachtrag']],
      fazit: ['Für die Netzregelung nicht empfehlenswert', 'EMS und Monitoring in der GLT: ja'], col: C.r,
    },
    {
      pro: ['Zertifikat liegt beim Leittechnik-Baustein', 'Ein Leitsystem für Netz und Erzeugung', 'Passt, wenn das MS-Netz ohnehin fernüberwacht wird'],
      con: [[null, 'Nur, wenn genau dieser Baustein und Softwarestand zertifiziert ist'], [null, 'Leitsystem wird Teil der EZA: Änderungen nur mit Zertifizierer'], [null, 'Hersteller- und Vergabebindung']],
      fazit: ['Möglich', 'wenn Zertifikat und Herstellerfreigabe vorliegen'], col: C.b,
    },
  ];
  cols.forEach((x, i) => {
    const d = pc[i];
    let y = 552;
    b += T(x, y, 'Dafür', { size: 11.5, bold: true, fill: C.g }); y += 18;
    for (const t of d.pro) {
      wrap(t, 46).forEach((l, k) => { b += T(x + (k ? 14 : 0), y, (k ? '' : '+ ') + l, { size: 10.5, fill: C.t }); y += 14; });
      y += 3;
    }
    y += 10;
    b += T(x, y, 'Dagegen', { size: 11.5, bold: true, fill: C.r }); y += 18;
    for (const [n, t] of d.con) {
      if (n) b += badge(x + 6, y - 4, n);
      else b += T(x, y, '–', { size: 10.5, fill: C.t });
      wrap(t, 44).forEach((l) => { b += T(x + 18, y, l, { size: 10.5, fill: C.t }); y += 14; });
      y += 3;
    }
    b += R(x, 838, w, 44, { fill: i === 0 ? C.gl : i === 1 ? C.rl : C.bl, stroke: d.col, sw: 1.4, rx: 3 });
    b += T(x + 12, 856, d.fazit[0], { size: 11.5, bold: true, fill: d.col }) + T(x + 12, 873, d.fazit[1], { size: 10.5, fill: C.t });
  });

  // Prüffragen
  b += P('M28 904 H972', { stroke: C.br, sw: 1 });
  b += T(28, 930, 'Prüffragen an die Bestandsleittechnik', { size: 13.5, bold: true, fill: C.t });
  const q = [
    ['Zertifikat', 'Gibt es für die Regelfunktion ein Komponentenzertifikat nach VDE-AR-N 4110? Wenn nein, gehört die EZA-Regelung nicht in die Leittechnik.'],
    ['Fernwirken', 'Kann sie IEC 60870-5-104 als Unterstation nach Signalliste des NB, mit Zeitstempel und Quittung?'],
    ['Zeitverhalten', 'Wie lange dauert Messen → Stellen? Gibt es USV, Redundanz und Updates ohne Regelunterbrechung?'],
    ['IT-Sicherheit', 'Lässt sich die netzrelevante Funktion als eigene Zone (IEC 62443) abtrennen, mit Fernzugang nur für NB und DV?'],
    ['Lebenszyklus', 'Wie lange unterstützt der Hersteller das System noch? Ist ein Ersatz der GLT schon geplant?'],
    ['Betrieb, Vergabe', 'Wer ist für den NB rund um die Uhr erreichbar und haftet? Ist die Erweiterung beim Bestandshersteller vergaberechtlich möglich?'],
  ];
  q.forEach(([k, t], i) => {
    const x0 = i < 3 ? 28 : 510, y0 = 958 + (i % 3) * 52;
    b += badge(x0 + 7, y0 - 4, String(i + 1), C.t) + T(x0 + 22, y0, k, { size: 10.5, bold: true, fill: C.t });
    wrap(t, 76).forEach((l, k2) => { b += T(x0 + 22, y0 + 15 + k2 * 14, l, { size: 10.5 }); });
  });
  b += T(28, 1124, 'Prinzipskizze. Die Nummern 1–4 in Variante B verweisen auf die Gegenargumente. Die Bewertung ist allgemein; im Einzelfall entscheidet,', { size: 10.5, fill: C.l });
  b += T(28, 1139, 'was die Bestandsleittechnik nachweislich kann (Zertifikat, Datenblatt, Herstellererklärung).', { size: 10.5, fill: C.l });
  return frame(W, H, 'GUTACHTEN · GEBÄUDEAUTOMATION · VARIANTEN', 'EMS und EZA-Regelung über die Bestandsleittechnik?', b);
}

schreibe('Prinzip-EMS-Bestandsleittechnik.svg', svgVarianten());

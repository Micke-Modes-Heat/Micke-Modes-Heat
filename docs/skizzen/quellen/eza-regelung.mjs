// Prinzip-EZA-Regelung: EZA-Regler am NAP mit Sollwertquellen, Vorrang, Rückfall und Signalliste
import { C, T, TL, R, P, badge, frame, legend, schreibe } from './_basis.mjs';

function svgEza() {
  const W = 1000, H = 1280;
  let b = R(20, 90, 960, 812, { fill: '#fff', stroke: C.br, sw: 1, rx: 0 });

  // extern
  b += R(50, 105, 120, 42, { stroke: '#0000FF', dash: '4 3' }) + T(110, 123, 'Netz', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(110, 137, 'MS 20 kV', { size: 10, anchor: 'middle' });
  b += R(240, 105, 190, 42, { stroke: C.l, dash: '4 3' }) + T(335, 123, 'Leitstelle Netzbetreiber', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(335, 137, 'Netzsicherheit · Redispatch', { size: 10, anchor: 'middle' });
  b += R(470, 105, 190, 42, { stroke: C.l, dash: '4 3' }) + T(565, 123, 'Direktvermarkter', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(565, 137, 'Marktsteuerung · EIV Redispatch', { size: 10, anchor: 'middle' });
  b += R(775, 105, 186, 42, { stroke: C.l, dash: '4 3' }) + T(868, 123, 'Wetter-/Preisprognose', { size: 11.5, bold: true, anchor: 'middle', fill: C.t }) + T(868, 137, 'Dienst, optional', { size: 10, anchor: 'middle' });
  b += P('M30 172 H970', { stroke: C.l, sw: 1.2, dash: '5 4' });
  b += T(120, 188, 'NAP · Bilanzgrenze', { size: 10.5 });
  b += T(968, 166, 'extern', { size: 10, anchor: 'end', fill: C.l }) + T(968, 188, 'Liegenschaft', { size: 10, anchor: 'end', fill: C.l });

  // Kommunikationsgeräte
  b += P('M335 147 V191', { stroke: C.o, sw: 1.8, end: 'aO' }) + T(343, 163, 'IEC 60870-5-104 · VPN', { size: 10, fill: C.o });
  b += R(240, 192, 190, 44, { stroke: C.o, sw: 1.4 }) + T(335, 210, 'Fernwirkgerät (FWG)', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(335, 225, 'Unterstation nach Signalliste NB', { size: 10, anchor: 'middle' });
  b += P('M565 147 V191', { stroke: C.o, sw: 1.8, end: 'aO' }) + T(573, 163, 'Mobilfunk / VPN', { size: 10, fill: C.o });
  b += R(470, 192, 190, 44, { stroke: C.o, sw: 1.4 }) + T(565, 210, 'Steuerbox Direktvermarkter', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(565, 225, '§ 10b EEG · künftig über SMGW', { size: 10, anchor: 'middle' });
  b += P('M868 147 V189', { stroke: C.b, sw: 1.6, dash: '4 3', end: 'aB' }) + T(860, 163, 'HTTPS, Firewall', { size: 10, anchor: 'end', fill: C.b });
  b += R(720, 190, 240, 92, { fill: C.gl, stroke: C.g, sw: 1.6, rx: 3 }) + T(733, 209, 'Gebäudeleittechnik (GLT)', { size: 12, bold: true, fill: C.g });
  b += R(733, 219, 214, 54, { stroke: C.g2, sw: 1.4 }) + T(745, 237, 'EMS-Funktion', { size: 11.5, bold: true, fill: C.t }) +
    T(745, 252, 'Fahrplan ¼ h, Kaskaden', { size: 10 }) + T(745, 265, 'meldet Wünsche, keine Grenzen', { size: 10 });

  // Verbindungen zum EZA-Regler
  b += P('M335 236 V299', { stroke: C.o, sw: 1.8, end: 'aO', start: 'aO' }) + T(343, 263, 'Sollwerte ↓', { size: 10, fill: C.o }) + T(343, 276, 'Messwerte, Quittung ↑', { size: 10, fill: C.o });
  b += P('M565 236 V299', { stroke: C.o, sw: 1.8, end: 'aO', start: 'aO' }) + T(573, 263, 'P-Sollwert ↓', { size: 10, fill: C.o }) + T(573, 276, 'Ist-Einspeisung ↑', { size: 10, fill: C.o });
  b += P('M840 282 V420 H702', { stroke: C.b, sw: 1.8, end: 'aB', start: 'aB' });
  b += T(771, 412, 'Modbus TCP / IEC 104', { size: 10, bold: true, anchor: 'middle', fill: C.b }) + T(771, 436, '← Wunsch-Sollwerte', { size: 10, anchor: 'middle', fill: C.b }) + T(771, 449, 'Messwerte NAP →', { size: 10, anchor: 'middle', fill: C.b });

  // EZA-Regler
  b += R(230, 300, 470, 400, { fill: C.ol, stroke: C.o, sw: 1.8, rx: 3 });
  b += T(245, 322, 'EZA-Regler (Parkregler)', { size: 13, bold: true, fill: C.t });
  b += T(245, 338, 'Komponentenzertifikat nach VDE-AR-N 4110 · Teil des Anlagenzertifikats', { size: 10 });
  const src = [
    ['1', C.o, 'Netzbetreiber', 'P-Grenze %, Q-Verfahren'],
    ['2', C.o, 'Anschlussgrenzen', 'P_AV,E · P_AV,B fest'],
    ['3', C.s, 'Direktvermarkter', 'P-Sollwert (Markt)'],
    ['4', C.g, 'EMS (GLT)', 'Wunsch P Batterie / PV'],
  ];
  src.forEach(([n, col, h, sub], i) => {
    const y = 350 + i * 54;
    b += R(245, y, 160, 46, { stroke: col, sw: 1.3 }) + badge(258, y + 15, n, col) +
      T(272, y + 19, h, { size: 11, bold: true, fill: C.t }) + T(258, y + 36, sub, { size: 10 });
    b += P(`M405 ${y + 23} H419`, { sw: 1.2, end: 'aI' });
  });
  b += R(420, 350, 120, 208, { stroke: C.t, sw: 1.3 });
  b += TL(480, 372, [{ t: 'Vorrang-', bold: true, fill: C.t, size: 11.5 }, { t: 'auswahl', bold: true, fill: C.t, size: 11.5 }], { anchor: 'middle', lh: 15 });
  b += TL(480, 410, ['engster Wert', 'gewinnt'], { size: 10, anchor: 'middle', lh: 13 });
  b += T(480, 446, 'P = min(1…4)', { size: 10, mono: true, anchor: 'middle', fill: C.t });
  b += T(480, 462, 'Q nur aus 1', { size: 10, mono: true, anchor: 'middle', fill: C.t });
  b += T(480, 490, 'Rang', { size: 10, anchor: 'middle' }) + T(480, 505, '1 › 2 › 3 › 4', { size: 11, bold: true, anchor: 'middle', fill: C.t });
  b += TL(480, 530, ['Schutz steht', 'außerhalb'], { size: 10, anchor: 'middle', lh: 13 });
  b += P('M540 400 H554', { sw: 1.2, end: 'aI' }) + P('M540 511 H554', { sw: 1.2, end: 'aI' });
  b += R(555, 350, 130, 104, { stroke: C.o, sw: 1.3 }) + T(567, 370, 'P-Regler NAP', { size: 11, bold: true, fill: C.t }) +
    TL(567, 388, ['PI-Regelung,', 'Rampe begrenzt,', 'Aufteilung auf die', 'Einheiten nach', 'Verfügbarkeit'], { size: 10, lh: 13 });
  b += R(555, 464, 130, 94, { stroke: C.o, sw: 1.3 }) + T(567, 484, 'Q-Regler NAP', { size: 11, bold: true, fill: C.t }) +
    TL(567, 502, ['Q(U), cos φ(P)', 'oder Q fest,', 'Kennlinie vom NB,', 'Spannung am NAP'], { size: 10, lh: 13 });
  b += R(245, 572, 440, 116, { stroke: C.o, sw: 1.3 }) + T(257, 592, 'Überwachung & Rückmeldung', { size: 11.5, bold: true, fill: C.t });
  b += TL(257, 611, [
    '• Watchdog je Schnittstelle: Ausfall → Rückfallwert (Tabelle unten)',
    '• Plausibilisierung der Regelmessung, Grenzwertalarme',
    '• Ereignisspeicher mit Zeitstempel (NTP- oder GPS-Zeit)',
    '• Rückmeldung an NB, DV, EMS: Ist-P/Q, Quittung, verfügbare Leistung',
    '• Betriebsart netzparallel / Insel (bei Blackout-Konzept)',
  ], { size: 10.5, lh: 15 });

  // MS-Übergabe links
  b += P('M110 147 V780', { sw: 1.6 }) + `<circle cx="110" cy="172" r="3" fill="${C.t}"/>`;
  b += R(103, 208, 14, 14, { rx: 0, sw: 1.4 }) + P('M103 208 L117 222 M117 208 L103 222', { sw: 1 }) + T(124, 219, 'Übergabe-LS', { size: 10 });
  b += R(124, 250, 92, 44, { fill: C.rl, stroke: C.r, sw: 1.3 }) + T(170, 268, 'NA-Schutz', { size: 10.5, bold: true, anchor: 'middle', fill: C.t }) + T(170, 283, 'übergeordnet', { size: 10, anchor: 'middle' });
  b += P('M110 272 H123', { stroke: C.r, sw: 1 }) + P('M170 250 V236 H118 V223', { stroke: C.r, sw: 1.3, dash: '4 3', end: 'aR' });
  b += TL(124, 330, ['MS-Übergabe-', 'station'], { size: 10, lh: 13 });
  b += `<circle cx="110" cy="600" r="9" fill="#fff" stroke="${C.t}" stroke-width="1.4"/>` + T(122, 586, 'Wandler', { size: 10 });
  b += P('M119 600 H229', { sw: 1.1, end: 'aI' }) + T(124, 616, 'Regelmessung', { size: 10 }) + T(124, 629, 'P, Q, U, I, f', { size: 10 });
  b += P('M101 600 H62 V634', { sw: 1 }) + R(26, 635, 72, 40) + T(62, 652, 'RLM-Zähler', { size: 10, bold: true, anchor: 'middle', fill: C.t }) + T(62, 666, 'Abrechnung', { size: 10, anchor: 'middle' });
  b += `<circle cx="110" cy="790" r="10" fill="#fff" stroke="${C.t}" stroke-width="1.4"/><circle cx="110" cy="804" r="10" fill="none" stroke="${C.t}" stroke-width="1.4"/>`;
  b += P('M110 814 V860', { sw: 1.6 }) + P('M60 860 H950', { sw: 4 }) + T(60, 880, 'NS-Hauptverteilung', { size: 10 });

  // Einheiten
  b += T(312, 735, 'Modbus / SunSpec', { size: 10, anchor: 'end', fill: C.o });
  const units = [[320, 'PV-Anlage', 'Wechselrichter', 'P-Grenze, Q'], [450, 'Batterie', 'Umrichter (PCS)', 'P ±, Q'], [580, 'BHKW / KWK', 'falls vorhanden', 'P, Q']];
  for (const [cx, h, sub, lab] of units) {
    b += P(`M${cx} 701 V759`, { stroke: C.o, sw: 1.8, end: 'aO' }) + T(cx + 6, 735, lab, { size: 10, fill: C.o });
    b += R(cx - 50, 760, 100, 50, { fill: C.gr }) + T(cx, 781, h, { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(cx, 797, sub, { size: 10, anchor: 'middle' });
    b += P(`M${cx} 810 V860`, { sw: 1.6 });
  }
  b += P('M900 282 V759', { stroke: C.b, sw: 1.6, end: 'aB' }) + T(894, 600, 'BACnet / OCPP', { size: 10, bold: true, anchor: 'end', fill: C.b }) + T(894, 613, 'nicht netzrelevant', { size: 10, anchor: 'end', fill: C.b });
  b += R(800, 760, 150, 50, { fill: C.gr }) + T(875, 781, 'Verbraucher', { size: 11, bold: true, anchor: 'middle', fill: C.t }) + T(875, 797, 'WP · Laden · Lüftung', { size: 10, anchor: 'middle' });
  b += P('M875 810 V860', { sw: 1.6 });

  // Tabelle Rückfall
  b += T(28, 932, 'Rückfallverhalten bei Ausfall', { size: 13.5, bold: true, fill: C.t });
  b += T(28, 948, 'Beispiel · verbindlich sind TAB, Signalliste und Anlagenzertifikat', { size: 10, fill: C.l });
  const rows = [
    ['Verbindung NB', ['Letzten Sollwert halten, nach Frist Rückfallwert laut TAB;', 'Störmeldung an Leitstelle und Betreiber']],
    ['Verbindung DV', ['DV-Vorgabe entfällt (100 %). NB-Vorgabe und', 'Anschlussgrenzen gelten unverändert weiter']],
    ['EMS / GLT', ['Wunsch entfällt: Batterie in Grundstrategie,', 'PV frei bis zur Anschlussgrenze']],
    ['Regelmessung', ['Sicherer Zustand: Einspeisung auf parametrierten', 'Ersatzwert (bis 0 kW), Alarm']],
    ['EZA-Regler', ['Einheiten gehen auf eigenen Rückfallwert; ist P_AV,E < Pinst,', 'zusätzlich Überwachungsrelais P> am NAP (Hardware)']],
    ['Netzfehler', ['NA-Schutz trennt am Übergabe-LS, unabhängig', 'von allen Reglern']],
  ];
  rows.forEach(([k, v], i) => {
    const y = 960 + i * 36;
    b += P(`M28 ${y} H560`, { stroke: C.br, sw: 1 });
    b += T(28, y + 15, k, { size: 10.5, bold: true, fill: C.t }) + TL(140, y + 15, v, { size: 10.5, lh: 14 });
  });

  // Signalliste
  b += T(600, 932, 'Signalliste zum NB (typischer Umfang)', { size: 13.5, bold: true, fill: C.t });
  b += T(600, 948, 'IEC 60870-5-104 · Datenpunkte legt der NB fest', { size: 10, fill: C.l });
  const sig = [
    ['Messwerte', ['P, Q, U (3×), I am NAP, ggf. f']],
    ['Meldungen', ['Übergabe-LS Ein/Aus, NA-Schutz ausgelöst,', 'EZA-Regler bereit/gestört, Verbindung ok']],
    ['Sollwerte', ['P-Begrenzung in % Pinst mit Rückmeldung,', 'Q-Verfahren und Sollwert, Kennlinienwahl']],
    ['Speicher', ['Lade-/Entladeleistung, ggf. Ladezustand']],
    ['Redispatch 2.0', ['Echtzeitdaten auf Anforderung (Rolle BTR)']],
  ];
  let sy = 974;
  for (const [k, v] of sig) {
    b += T(600, sy, k, { size: 10.5, bold: true, fill: C.t }) + TL(705, sy, v, { size: 10.5, lh: 14 });
    sy += 14 * v.length + 10;
  }

  b += legend(1200, [
    { c: C.t, w: 1.6, t: 'MS-Leitung' }, { c: C.t, w: 4, t: 'NS-Schiene' }, { c: C.b, w: 2, t: 'Daten GA / EMS' },
    { c: C.o, w: 2, t: 'netzrelevante Vorgabe' }, { c: C.r, w: 1.4, dash: '4 3', t: 'Schutzauslösung' }, { c: C.l, w: 1.2, dash: '5 4', t: 'Bilanzgrenze' },
  ]);
  b += T(28, 1234, 'Prinzipskizze ohne Auslegung, Protokolle und Werte beispielhaft. Maßgeblich sind VDE-AR-N 4110 in der beim Netzanschlussbegehren gültigen Fassung,', { size: 10.5, fill: C.l });
  b += T(28, 1249, 'die TAB und Signalliste des Netzbetreibers sowie §§ 9, 10b EEG. Änderungen an der Regelkette mit Zertifizierer und Netzbetreiber abstimmen.', { size: 10.5, fill: C.l });
  return frame(W, H, 'GUTACHTEN · GEBÄUDEAUTOMATION · EZA-REGELUNG', 'EZA-Regler am Netzanschlusspunkt: Vorgaben, Vorrang, Rückfall', b);
}

schreibe('Prinzip-EZA-Regelung.svg', svgEza());

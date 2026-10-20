// ── lib/netzanschluss-check.js — Netzanschluss-Modul: Bedarf, Wege, Textbaustein ──
// DOM-frei (Vitest). Oberfläche: 44-netzanschluss-modul.js (Elektro › 3 · Auswerten › Netzanschluss).
//
// Bezug je Jahr: exakt die Bedarfsprognose (lib/bedarfsprognose.js, bpJahresreihe) — dieselbe Rechnung
// wie NAP-Analyse und Gutachten 5.3. Erzeugung mindert den Bezug nicht.
// Einspeisung je Jahr: Summe der Nennleistung aller Erzeuger, die im Jahr stehen (Bestand + Zubau −
// Rückbau), ohne Gleichzeitigkeitsfaktor — wie Gutachten 5.3.4. Die Bedarfsprognose allein kennt nur
// den Zubau nach dem Messjahr; vorhandene PV gehört aber genauso an den Anschluss.
// Vergleich mit der vereinbarten Leistung wie im Gutachten: kW gegen kVA ohne Leistungsfaktor.

import { bpJahresreihe, bpAssetLeistung, bpZieljahr, BP_LEISTUNGS_TYPEN } from './bedarfsprognose.js';
import { uwMw, uwEurSpanne, uwEbene } from './umspannwerk-core.js';
import { AE_BAENDER, aeKva } from './anschlussebenen.js';

const jahrVon = v => parseInt(v, 10) || null;

/** Einspeiseleistung (kW) aller Erzeuger, die im Jahr in Betrieb sind. */
export function ncEinspeisungImJahr(assets, jahr) {
  let kw = 0;
  for (const a of assets || []) {
    if (!BP_LEISTUNGS_TYPEN.includes(a.type)) continue;
    const bj = jahrVon(a.baujahr), aj = jahrVon(a.abrissjahr);
    if ((bj && bj > jahr) || (aj && aj <= jahr)) continue;
    kw += bpAssetLeistung(a).genKW;
  }
  return kw;
}

/** Zieljahr: Endausbau der Bedarfsprognose, mindestens das Messjahr. */
export function ncZieljahr(stand, assets) {
  const ausMassnahmen = bpZieljahr(stand?.massnahmen || []);
  let ausErzeugern = null;
  for (const a of assets || []) {
    const bj = jahrVon(a.baujahr);
    if (bj && bpAssetLeistung(a).genKW > 0 && (ausErzeugern == null || bj > ausErzeugern)) ausErzeugern = bj;
  }
  return Math.max(stand?.dataYear || 0, ausMassnahmen || 0, ausErzeugern || 0) || null;
}

/** Jahresreihe { jahr, bezugKw, einspKw } von `von` bis `bis`. */
export function ncReihe({ stand, assets, von, bis }) {
  const bezug = bpJahresreihe({ basisKw: stand?.basisKw || 0, gzf: stand?.gzf ?? 1, massnahmen: stand?.massnahmen || [], von, bis });
  return bezug.map(z => ({ jahr: z.jahr, bezugKw: z.bezugKw, einspKw: ncEinspeisungImJahr(assets, z.jahr) }));
}

/** Erstes Jahr, in dem `feld` die Grenze überschreitet — null, wenn nie oder ohne Grenze. */
export function ncUeberschreitung(reihe, feld, grenze) {
  if (!(grenze > 0)) return null;
  return reihe.find(z => z[feld] > grenze)?.jahr ?? null;
}

/**
 * Wege A–D gegen den Bedarf im Zieljahr.
 *   ziel:    { jahr, bezugKw, einspKw }
 *   grenzen: { bezugKw, einspKw } — vereinbart am NAP (null = nicht eingetragen)
 *   reihe:   für „reicht bis"
 *   p:       Parameter aus uwParameterMischen (Orientierungsgrenzen Strang/UW, cos φ)
 *   uw:      { name, b } — Bewertung des gewählten Umspannwerks (uwBewerten) oder null
 * → [{ id, titel, kurz, traegt, kosten, ebene, zahlt, ampel: { stufe: 'ok'|'warn'|'bad'|'na', text },
 *      naechster: { text, aktion: 'grenzen'|'pva'|'ergebnis'|'uw-waehlen'|'uw-zeigen'|null },
 *      leiter: { fest, annahme, grenzbereich, kerbe } }]
 *   leiter: Bereiche in kVA für die Leistungsleiter — fest = belastbar (Vertrag, eigenes Kabel), selten = belastbar, aber selten wirtschaftlich,
 *   annahme = Orientierungswert bzw. Reserve im UW, grenzbereich = „nur auf Anfrage", kerbe = Einspeisezusage.
 */
export function ncWege({ ziel, grenzen, reihe, p, uw }) {
  const zB = (ziel?.bezugKw || 0) / 1000, zE = (ziel?.einspKw || 0) / 1000;
  const cos = p.cosPhi || 1;
  const zielMva = Math.max(zB, zE) / cos;
  const strangKva = p.grenzeStrangMva * 1000, uwKva = p.grenzeUwMva * 1000;
  const out = [];

  // A — Bestand halten; was erst nach dem Zieljahr knapp wird, zählt hier nicht
  const gB = grenzen?.bezugKw > 0 ? grenzen.bezugKw : null, gE = grenzen?.einspKw > 0 ? grenzen.einspKw : null;
  const bisZiel = ziel?.jahr ? (reihe || []).filter(z => z.jahr <= ziel.jahr) : (reihe || []);
  const uB = ncUeberschreitung(bisZiel, 'bezugKw', gB), uE = ncUeberschreitung(bisZiel, 'einspKw', gE);
  let a;
  if (!gB && !gE) a = { stufe: 'na', text: 'NAP-Grenzen fehlen' };
  else if (uB == null && uE == null) a = { stufe: 'ok', text: `reicht bis ${ziel?.jahr ?? '—'}` };
  else {
    const erst = Math.min(uB ?? 9999, uE ?? 9999);
    const richtung = uB != null && uE != null ? '' : uB != null ? ' (Bezug)' : ' (Einspeisung)';
    a = erst <= (reihe[0]?.jahr ?? erst)
      ? { stufe: 'bad', text: `schon heute überschritten${richtung}` }
      : { stufe: 'warn', text: `reicht bis ${erst - 1}${richtung}` };
  }
  out.push({ id: 'A', titel: 'Bestand halten, Spitzen kappen (Speicher, Einspeisebegrenzung, Lastmanagement)', kurz: 'Bestand halten',
    // Bezug ist in kVA vereinbart, Einspeisung in kW zugesagt — Einheiten nicht vermischen
    traegt: `Bezug ${gB ? aeKva(gB) : '—'} · Einsp. ${gE ? kwText(gE) : '—'}`, kosten: 'Speicher/Steuerung, siehe PV-Analyse', ebene: 'wie heute', zahlt: 'Kunde', ampel: a,
    naechster: a.stufe === 'na' ? { text: 'Vereinbarte Leistung eintragen', aktion: 'grenzen' }
      : a.stufe === 'ok' ? { text: 'Nichts zu tun bis zum Zieljahr', aktion: null }
      : { text: 'Spitzenkappung in der PV-Analyse prüfen', aktion: 'pva' },
    leiter: { fest: gB ? [[0, gB]] : [], annahme: [], grenzbereich: [], kerbe: gE ? gE / cos : null } });

  // B — Erhöhung am bestehenden Strang (Orientierungswert, keine Zusage)
  const bVon = Math.min(gB || 200, strangKva);
  out.push({ id: 'B', titel: 'Anschlussleistung am bestehenden MS-Strang erhöhen', kurz: 'MS-Strang erhöhen',
    traegt: `bis ≈ ${uwMw(p.grenzeStrangMva)} MVA (Orientierung)`, kosten: 'Angebot Netzbetreiber + BKZ', ebene: 'NE 5', zahlt: 'Kunde (Bezug) / VNB (Einspeisung)',
    ampel: !(zielMva > 0) ? { stufe: 'na', text: 'kein Bedarf' }
      : zielMva <= p.grenzeStrangMva ? { stufe: 'ok', text: 'im üblichen Bereich – Anfrage' }
      : zielMva <= p.grenzeStrangMva * 2.5 ? { stufe: 'warn', text: 'Grenzbereich – Anfrage' }
      : { stufe: 'bad', text: 'über Orientierungswert' },
    naechster: { text: 'Netzanschlussanfrage vorbereiten', aktion: 'ergebnis' },
    leiter: { fest: [], annahme: [[bVon, strangKva]], grenzbereich: [[strangKva, strangKva * 2.5]], kerbe: null } });

  // C — Direktanschluss Umspannwerk
  if (uw?.b) {
    const b = uw.b, n = b.ziel?.systeme || b.stufen[0].systeme;
    const traegtB = (n - (b.redundant ? 1 : 0)) * b.jeSystem.bezugMw, traegtE = (n - (b.redundant ? 1 : 0)) * b.jeSystem.einspMw;
    const kosten = (b.ziel?.kosten || b.stufen[0].kosten).anschlussEur;
    const ueberUw = b.n1Mw > 0 && Math.max(zB, zE) > b.n1Mw;
    // Belastbar ist das eigene Kabel (kleinere der beiden Richtungen), die (n-1)-Reserve des UW nur Obergrenze.
    // Unter ≈ 1 MVA trägt das Kabel auch, lohnt aber selten — dort blass (nur Darstellung).
    const kabelKva = Math.min(traegtB, traegtE) * 1000 / cos, n1Kva = (b.n1?.mva || 0) * 1000;
    out.push({ id: 'C', titel: `Direktanschluss ${uw.name || 'Umspannwerk'}, ${n} System${n > 1 ? 'e' : ''}${b.redundant ? ' (n-1)' : ''}, Trasse ≈ ${uwMw(b.laengeKm)} km`,
      kurz: 'Direktanschluss UW',
      traegt: `Bezug ${uwMw(traegtB)} MW · Einsp. ${uwMw(traegtE)} MW${b.redundant ? ' (gesichert)' : ''}`, kosten: uwEurSpanne(kosten), ebene: 'NE 4', zahlt: 'Kunde (Bezug), Anlagenbetreiber (EEG)',
      ampel: !(zielMva > 0) ? { stufe: 'na', text: 'kein Bedarf' }
        : ueberUw ? { stufe: 'warn', text: 'über (n-1) des UW – Ausbau nötig' }
        : n > 3 ? { stufe: 'warn', text: `${n} Systeme – HS prüfen` }
        : { stufe: 'ok', text: `deckt ${ziel?.jahr ?? 'Ziel'}` },
      naechster: { text: 'Trasse auf der Karte zeigen', aktion: 'uw-zeigen' },
      leiter: { fest: kabelKva > 1000 ? [[1000, kabelKva]] : [], selten: [[0, Math.min(1000, kabelKva)]],
        annahme: n1Kva > kabelKva ? [[Math.max(1000, kabelKva), n1Kva]] : [], grenzbereich: [], kerbe: null } });
  } else {
    out.push({ id: 'C', titel: 'Direktanschluss an ein Umspannwerk', kurz: 'Direktanschluss UW', traegt: '—', kosten: '—', ebene: 'NE 4', zahlt: 'Kunde (Bezug), Anlagenbetreiber (EEG)',
      ampel: { stufe: 'na', text: 'Umspannwerk wählen (unten)' },
      naechster: { text: 'Umspannwerke laden und eines wählen', aktion: 'uw-waehlen' },
      leiter: { fest: [], annahme: [[strangKva, uwKva]], grenzbereich: [], kerbe: null } });
  }

  // D — eigenes Umspannwerk
  const ebene = uwEbene(zielMva, p);
  out.push({ id: 'D', titel: 'Eigenes Umspannwerk 110 kV / MS', kurz: 'Eigenes Umspannwerk', traegt: `über ≈ ${uwMw(p.grenzeUwMva)} MVA`, kosten: 'noch kein Ansatz (FNN-Beispiel: rund 5 × Direktanschluss)', ebene: 'NE 3', zahlt: 'Kunde',
    ampel: ebene?.id === 'hs' ? { stufe: 'warn', text: 'Größenordnung passt – prüfen' } : { stufe: 'na', text: 'überdimensioniert' },
    naechster: ebene?.id === 'hs' ? { text: 'Mit Netzbetreiber über HS-Anschluss sprechen', aktion: 'ergebnis' }
      : { text: `erst ab ≈ ${uwMw(p.grenzeUwMva)} MVA sinnvoll`, aktion: null },
    leiter: { fest: [], annahme: [[uwKva, 110000]], grenzbereich: [], kerbe: null } });
  return out;
}

/**
 * Die Antwort in drei Sätzen: reicht Bezug / Einspeisung bis zum Zieljahr, welcher Weg liegt nahe.
 *   reihe, ziel, grenzen wie ncWege; wege = Ergebnis von ncWege; heute = Messjahr
 * → { bezug, einsp, empfehlung } je { stufe: 'ok'|'warn'|'bad'|'na', satz, unter, weg? }
 */
export function ncAntwort({ reihe, ziel, grenzen, wege, heute }) {
  const bisZiel = (reihe || []).filter(z => z.jahr <= ziel.jahr);
  const richtung = (feld, g, einheit) => {
    const wertZiel = ziel[feld] || 0;
    if (!(g > 0)) return { stufe: 'na', satz: 'keine Grenze eingetragen', unter: `im Zieljahr ${kwText(wertZiel)}` };
    const u = ncUeberschreitung(bisZiel, feld, g);
    if (u == null) return { stufe: 'ok', satz: `reicht bis ${ziel.jahr}`, unter: `${kwText(wertZiel)} von ${de(g)} ${einheit} im Zieljahr` };
    const wertU = bisZiel.find(z => z.jahr === u)?.[feld] || 0;
    if (u <= heute) return { stufe: 'bad', satz: 'schon heute zu knapp', unter: `${kwText(wertU)} gegen ${de(g)} ${einheit}` };
    return { stufe: 'warn', satz: `reicht bis ${u - 1}`, unter: `ab ${u}: ${kwText(wertU)} gegen ${de(g)} ${einheit}${u < ziel.jahr ? `, im Zieljahr ${kwText(wertZiel)}` : ''}` };
  };
  const bezug = richtung('bezugKw', grenzen?.bezugKw, 'kVA');
  const einsp = richtung('einspKw', grenzen?.einspKw, 'kW');
  const wA = (wege || []).find(w => w.id === 'A');
  let empfehlung;
  if (!(ziel.bezugKw > 0 || ziel.einspKw > 0)) {
    empfehlung = { stufe: 'na', satz: 'Kein Bedarf ermittelt', unter: 'Lastgang laden bzw. Verbraucher und Erzeuger anlegen.' };
  } else if (bezug.stufe === 'na' && einsp.stufe === 'na') {
    empfehlung = { stufe: 'na', satz: 'Erst die vereinbarte Leistung eintragen', unter: 'Ohne NAP-Grenzen lässt sich kein Weg bewerten.' };
  } else if (wA?.ampel.stufe === 'ok') {
    empfehlung = { stufe: 'ok', satz: 'Nichts zu tun', unter: 'Der bestehende Anschluss trägt den Bedarf.', weg: 'A' };
  } else {
    const rest = (wege || []).filter(w => w.id !== 'A');
    const w = rest.find(x => x.ampel.stufe === 'ok') || rest.find(x => x.ampel.stufe === 'warn');
    empfehlung = w
      ? { stufe: w.ampel.stufe, satz: `Weg ${w.id}: ${w.kurz}`, unter: w.ampel.text, weg: w.id }
      : { stufe: 'bad', satz: 'Kein Weg passt ohne Weiteres', unter: 'Netzanschlussanfrage stellen; Umspannwerk wählen.' };
  }
  return { bezug, einsp, empfehlung };
}

const de = (v, d = 0) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const kwText = kw => (kw >= 1000 ? `${de(kw / 1000, 1)} MW` : `${de(kw)} kW`);

/**
 * Textbaustein (Gutachten/Notiz). Nur, was belegt ist; Lücken werden benannt statt erfunden.
 *   stand: napBedarfsStand(), reihe, ziel, grenzen, uw: { name, betreiber, kvs, b } | null, osmStand
 */
export function ncBaustein({ stand, ziel, grenzen, reihe, uw, osmStand }) {
  const teile = [];
  const gB = grenzen?.bezugKw > 0 ? grenzen.bezugKw : null, gE = grenzen?.einspKw > 0 ? grenzen.einspKw : null;
  if (gB || gE) {
    teile.push(`Der heutige Netzanschluss ist mit ${gB ? `${de(gB)} kVA Bezug` : 'nicht eingetragener Bezugsleistung'} und ${gE ? `${de(gE)} kW Einspeisung` : 'ohne eingetragene Einspeisezusage'} vereinbart.`);
  } else {
    teile.push('Die vereinbarte Anschlussleistung ist noch nicht erfasst.');
  }
  if (ziel?.jahr) {
    const basis = stand?.basisKw > 0
      ? `Ausgehend von der gemessenen Höchstlast von ${kwText(stand.basisKw)} im Jahr ${stand.dataYear} steigt die Bezugsleistung nach der Bedarfsprognose`
      : 'Ohne gemessenen Lastgang, allein aus den geplanten Maßnahmen, ergibt sich nach der Bedarfsprognose';
    teile.push(`${basis} bis ${ziel.jahr} auf etwa ${kwText(ziel.bezugKw)}; die Einspeiseleistung der Erzeugungsanlagen beträgt dann etwa ${kwText(ziel.einspKw)}.`);
  }
  const uB = ncUeberschreitung(reihe, 'bezugKw', gB), uE = ncUeberschreitung(reihe, 'einspKw', gE);
  if (gB || gE) {
    const satz = [];
    const start = reihe[0]?.jahr;
    const bis = (u, was) => (u == null ? `für ${was} über den Betrachtungszeitraum` : u <= start ? null : `für ${was} bis ${u - 1}`);
    const schon = [];
    if (gB) { const t = bis(uB, 'den Bezug'); if (t) satz.push(t); else schon.push('den Bezug'); }
    if (gE) { const t = bis(uE, 'die Einspeisung'); if (t) satz.push(t); else schon.push('die Einspeisung'); }
    if (satz.length) teile.push(`Der bestehende Anschluss reicht damit ${satz.join(' und ')}.`);
    if (schon.length) teile.push(`Für ${schon.join(' und ').replace(/^den /, 'den ')} ist die vereinbarte Leistung bereits heute überschritten.`);
  }
  if (uw?.b) {
    const b = uw.b;
    // Spannung nur als Tatsache nennen, wenn sie aus OSM oder von Hand stammt — sonst als Annahme kennzeichnen
    const kv = !b.uKv ? 'Mittelspannungs-Sammelschiene'
      : b.uAusUw ? `${de(b.uKv)}-kV-Sammelschiene` : `Mittelspannungs-Sammelschiene (angenommen ${de(b.uKv)} kV)`;
    const n = b.ziel?.systeme || b.stufen[0].systeme;
    const kosten = (b.ziel?.kosten || b.stufen[0].kosten).anschlussEur;
    const name = String(uw.name || '').trim();
    const bezeichnung = !name ? 'Umspannwerk' : /^(umspannwerk|uw)\b/i.test(name) ? name : `Umspannwerk ${name}`;
    teile.push(`Das nächstgelegene geeignete ${bezeichnung}${uw.betreiber ? ` (${uw.betreiber})` : ''} liegt rund ${de(b.luftlinieM / 1000, 1)} km Luftlinie entfernt${osmStand ? ` (Quelle: OpenStreetMap, Stand ${osmStand})` : ''}. `
      + `Ein Direktanschluss an dessen ${kv} könnte je Kabelsystem überschlägig etwa ${uwMw(b.jeSystem.bezugMw)} MW übertragen (Trasse ca. ${de(b.laengeKm, 1)} km); `
      + `für den Bedarf im Zieljahr ${n === 1 ? 'wäre ein Kabelsystem' : `wären ${n} Kabelsysteme`}${b.redundant ? ' mit gegenseitiger Reserve (n-1)' : ''} nötig, bei Anschlusskosten in der Größenordnung von ${uwEurSpanne(kosten)}.`);
  }
  teile.push((uw?.b
    ? 'Ob Umspannwerk und vorgelagertes Netz diese Leistung aufnehmen bzw. bereitstellen können, ist nur über eine Netzanschlussanfrage beim Netzbetreiber zu klären.'
    : 'Wo und in welcher Spannungsebene der Netzbetreiber die zusätzliche Leistung bereitstellen kann, ist über eine Netzanschlussanfrage zu klären.')
    + ' Für den Bezug fällt zusätzlich ein Baukostenzuschuss nach Preisblatt an; bei Einspeisung nach EEG trägt der Anlagenbetreiber die Kosten bis zum Verknüpfungspunkt, der Netzbetreiber den Netzausbau.');
  return teile.join(' ').replace(/\s+/g, ' ').replace(' )', ')').trim();
}

/** Leistungstabelle für die Netzanschlussanfrage (CSV, Semikolon, deutsches Dezimalkomma). */
export function ncCsv(reihe, grenzen) {
  const z = v => (Number.isFinite(v) ? String(Math.round(v)) : '');
  const kopf = 'Jahr;Bezugsleistung (kW);Einspeiseleistung (kW);vereinbart Bezug (kVA);zugesagt Einspeisung (kW)';
  return [kopf, ...reihe.map(r => [r.jahr, z(r.bezugKw), z(r.einspKw), z(grenzen?.bezugKw), z(grenzen?.einspKw)].join(';'))].join('\r\n');
}

/** Diagramm Bezug/Einspeisung über die Jahre mit den vereinbarten Grenzen. farben: { text, muted, linie, bezug, einsp } */
export function ncBedarfSvg({ reihe, grenzen, farben, zieljahr }) {
  if (!reihe?.length) return '';
  const f = { text: '#ddd', muted: '#999', linie: '#444', bezug: '#4fc3f7', einsp: '#ef9a9a', ...farben };
  const W = 900, H = 250, x0 = 56, x1 = 880, y0 = 214, y1 = 16;
  const von = reihe[0].jahr, bis = reihe[reihe.length - 1].jahr;
  const maxKw = Math.max(1, ...reihe.map(r => Math.max(r.bezugKw, r.einspKw)), grenzen?.bezugKw || 0, grenzen?.einspKw || 0) * 1.12;
  const mwSkala = maxKw >= 2000;
  const teiler = mwSkala ? 1000 : 1;
  const schritt = (() => { const roh = maxKw / teiler / 5; const p = 10 ** Math.floor(Math.log10(roh)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= roh); })();
  const top = Math.ceil(maxKw / teiler / schritt) * schritt;
  const xs = j => x0 + (bis === von ? 0 : (j - von) / (bis - von)) * (x1 - x0);
  const ys = kw => y0 - (kw / teiler) / top * (y0 - y1);
  let s = '';
  for (let v = 0; v <= top + 1e-9; v += schritt) {
    s += `<line x1="${x0}" x2="${x1}" y1="${ys(v * teiler).toFixed(1)}" y2="${ys(v * teiler).toFixed(1)}" style="stroke:${f.linie};stroke-width:1"/>`;
    s += `<text x="${x0 - 6}" y="${(ys(v * teiler) + 4).toFixed(1)}" text-anchor="end" style="fill:${f.muted};font-size:10px;font-family:monospace;">${de(v, schritt < 1 ? 1 : 0)}</text>`;
  }
  const jSchritt = Math.max(1, Math.ceil((bis - von) / 10));
  for (let j = von; j <= bis; j += jSchritt) s += `<text x="${xs(j).toFixed(1)}" y="${y0 + 16}" text-anchor="middle" style="fill:${f.muted};font-size:10px;font-family:monospace;">${j}</text>`;
  s += `<text x="8" y="12" style="fill:${f.muted};font-size:10px;">${mwSkala ? 'MW' : 'kW'}</text>`;
  const grenze = (kw, farbe, text, unten) => {
    if (!(kw > 0)) return;
    const y = ys(kw).toFixed(1);
    s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" style="stroke:${farbe};stroke-width:1.5;stroke-dasharray:6 4"/>`;
    s += `<text x="${x1}" y="${(+y + (unten ? 13 : -5)).toFixed(1)}" text-anchor="end" style="fill:${farbe};font-size:10px;">${text}</text>`;
  };
  grenze(grenzen?.bezugKw, f.bezug, `vereinbart Bezug ${de(grenzen?.bezugKw || 0)} kVA`, false);
  grenze(grenzen?.einspKw, f.einsp, `Zusage Einspeisung ${de(grenzen?.einspKw || 0)} kW`, true);
  const linie = (feld, farbe, stufig) => {
    let d = '';
    reihe.forEach((r, i) => { const x = xs(r.jahr).toFixed(1), y = ys(r[feld]).toFixed(1); d += !i ? `M${x} ${y}` : stufig ? ` H${x} V${y}` : ` L${x} ${y}`; });
    s += `<path d="${d}" style="fill:none;stroke:${farbe};stroke-width:2.5"/>`;
  };
  linie('bezugKw', f.bezug, true);   // Jahreswerte: Änderungen wirken ab ihrem Jahr → Treppe
  linie('einspKw', f.einsp, true);
  const markiere = (feld, grenzeKw, farbe) => {
    const j = ncUeberschreitung(reihe, feld, grenzeKw);
    if (j == null) return;
    const r = reihe.find(z => z.jahr === j);
    s += `<rect x="${(xs(j) - 5).toFixed(1)}" y="${(ys(r[feld]) - 5).toFixed(1)}" width="10" height="10" style="fill:${farbe}"><title>${j}: erste Überschreitung</title></rect>`;
  };
  markiere('bezugKw', grenzen?.bezugKw, f.bezug);
  markiere('einspKw', grenzen?.einspKw, f.einsp);
  if (zieljahr && zieljahr >= von && zieljahr <= bis) {
    s += `<line x1="${xs(zieljahr).toFixed(1)}" x2="${xs(zieljahr).toFixed(1)}" y1="${y1}" y2="${y0}" style="stroke:${f.muted};stroke-width:1;stroke-dasharray:2 3"/>`;
    s += `<text x="${(xs(zieljahr) + 4).toFixed(1)}" y="${y1 + 10}" style="fill:${f.muted};font-size:10px;">Zieljahr ${zieljahr}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:100%;height:auto;" role="img" aria-label="Bezugs- und Einspeiseleistung über die Jahre">${s}</svg>`;
}

/* ── Leistungsleiter ────────────────────────────────────────────────────── */

const escX = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Netzebenen als Streifen: je NE der Kernbereich aus AE_BAENDER, Grenzen im geometrischen Mittel dazwischen. */
export const NC_NETZEBENEN = (() => {
  const namen = { 'NE 7': 'NS-Netz', 'NE 6': 'NS-Station', 'NE 5': 'MS-Netz', 'NE 4': 'UW-Sammelschiene', 'NE 3': 'Hochspannung' };
  const ne = Object.keys(namen).map(id => {
    const b = AE_BAENDER.filter(x => x.ne === id);
    return { id, name: namen[id], kv: Math.min(...b.map(x => x.kv)), kb: Math.max(...b.map(x => x.kb)), baender: b };
  });
  return ne.map((n, i) => ({
    ...n,
    von: i === 0 ? 1 : Math.sqrt(ne[i - 1].kb * n.kv),
    bis: i === ne.length - 1 ? 1e6 : Math.sqrt(n.kb * ne[i + 1].kv),
  }));
})();

/** Maßgebliche Leistung (kVA) wie ncWege: größere Richtung, durch cos φ. */
export const ncMassgeblichKva = (ziel, p) => Math.max(ziel?.bezugKw || 0, ziel?.einspKw || 0) / (p?.cosPhi || 1);

/**
 * Leistungsleiter: eine logarithmische Achse (kVA) mit Netzebenen-Streifen, dem Bedarf im Zieljahr
 * und den Wegen A–D als Balken (fest = belastbar, schraffiert = Annahme/Orientierung).
 *   ziel, p wie ncWege; wege = ncWege(...); farben: { text, muted, linie, flaeche, ok, okFlaeche, fest, band, bezug, einsp, warn, bad }
 */
export function ncLeiterSvg({ ziel, p, wege, farben }) {
  const f = { text: '#ddd', muted: '#999', linie: '#444', flaeche: 'rgba(127,127,127,.08)', ok: '#66bb6a', okFlaeche: 'rgba(102,187,106,.14)',
    fest: '#888', band: '#66bb6a', bezug: '#4fc3f7', einsp: '#ef9a9a', warn: '#ffb74d', bad: '#ef5350', ...farben };
  const W = 900, L = 214, R = 884, LOG0 = 1, LOG1 = Math.log10(150000);
  const x = v => L + (Math.log10(Math.min(150000, Math.max(10, v))) - LOG0) / (LOG1 - LOG0) * (R - L);
  const ROW0 = 64, ROW = 40, AY = ROW0 + (wege?.length || 4) * ROW + 6, H = AY + 26;
  const cos = p?.cosPhi || 1;
  const tx = (xx, y, s, st = '', a = '') => `<text x="${(+xx).toFixed(1)}" y="${y}" ${a} style="font-family:inherit;${st}">${escX(s)}</text>`;
  let s = '';
  const defs = ['fest', 'ok'].map(k => `<pattern id="ncl-schraff-${k}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<rect width="6" height="6" style="fill:${k === 'ok' ? f.okFlaeche : 'transparent'}"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:${k === 'ok' ? f.ok : f.fest};stroke-width:2"/></pattern>`).join('');

  // Netzebenen
  s += tx(L - 10, 25, 'Netzebene (typisch)', `fill:${f.muted};font-size:11px;`, 'text-anchor="end"');
  NC_NETZEBENEN.forEach((n, i) => {
    const x1 = x(Math.max(10, n.von)), x2 = x(n.bis);
    const tip = `${n.id} ${n.name} — häufig ${aeKva(n.kv)} bis ${aeKva(n.kb)}: ${n.baender.map(b => b.name).join(', ')} (VDE FNN, Orientierung)`;
    s += `<rect x="${x1.toFixed(1)}" y="8" width="${(x2 - x1).toFixed(1)}" height="26" style="fill:${f.band};fill-opacity:${(0.1 + i * 0.09).toFixed(2)}"><title>${escX(tip)}</title></rect>`;
    if (x2 - x1 > n.name.length * 6) s += tx((x1 + x2) / 2, 25, n.name, `fill:${f.text};font-size:11px;pointer-events:none;`, 'text-anchor="middle"');
  });

  // Gitter + Achse
  for (const [v, t] of [[10, '10 kVA'], [100, '100 kVA'], [1000, '1 MVA'], [10000, '10 MVA'], [100000, '100 MVA']]) {
    s += `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="8" y2="${AY}" style="stroke:${f.linie};stroke-width:1"/>`;
    s += tx(x(v), AY + 16, t, `fill:${f.muted};font-size:10.5px;`, `text-anchor="${v === 10 ? 'start' : 'middle'}"`);
  }
  s += `<line x1="${L}" x2="${R}" y1="${AY}" y2="${AY}" style="stroke:${f.muted};stroke-width:1"/>`;

  // Wege
  const farbeStufe = st => ({ ok: f.ok, warn: f.warn, bad: f.bad }[st] || f.muted);
  (wege || []).forEach((w, i) => {
    const y = ROW0 + i * ROW, passt = w.ampel?.stufe === 'ok', lt = w.leiter || {};
    s += `<rect x="4" y="${y}" width="${R - 4 + 8}" height="${ROW - 6}" rx="3" style="fill:${passt ? f.okFlaeche : f.flaeche}"/>`;
    s += tx(12, y + 15, `${w.id}  ${w.kurz || w.titel}`, `fill:${f.text};font-size:12.5px;font-weight:600;`);
    s += tx(12, y + 29, w.ampel?.text || '', `fill:${farbeStufe(w.ampel?.stufe)};font-size:11px;`);
    const balken = (a, b, stil, tip) => {
      const x1 = x(Math.max(10, a)), x2 = x(b);
      if (x2 - x1 < 1) return;
      s += `<rect x="${x1.toFixed(1)}" y="${y + 8}" width="${(x2 - x1).toFixed(1)}" height="18" rx="2" style="${stil}"><title>${escX(tip)}</title></rect>`;
    };
    for (const [a, b] of lt.selten || []) balken(a, b, `fill:${passt ? f.ok : f.fest};opacity:.3;`, `${w.id}: technisch möglich bis ${aeKva(b)}, bei kleiner Leistung selten wirtschaftlich`);
    for (const [a, b] of lt.fest || []) balken(a, b, `fill:${passt ? f.ok : f.fest};`, `${w.id}: belastbar bis ${aeKva(b)}`);
    for (const [a, b] of lt.annahme || []) balken(a, b, `fill:url(#ncl-schraff-${passt ? 'ok' : 'fest'});stroke:${passt ? f.ok : f.fest};stroke-width:1;`, `${w.id}: Annahme/Orientierung bis ${aeKva(b)}`);
    for (const [a, b] of lt.grenzbereich || []) balken(a, b, `fill:url(#ncl-schraff-fest);opacity:.45;`, `${w.id}: Grenzbereich bis ${aeKva(b)} – nur auf Anfrage`);
    if (lt.kerbe > 0) {
      const xk = x(lt.kerbe).toFixed(1);
      s += `<line x1="${xk}" x2="${xk}" y1="${y + 4}" y2="${y + 30}" style="stroke:${f.einsp};stroke-width:2.5"><title>${escX(`Einspeisezusage ${aeKva(lt.kerbe)} (kW / cos φ)`)}</title></line>`;
    }
    const letzteAnnahme = (lt.annahme || []).slice(-1)[0];
    if (w.id === 'C' && letzteAnnahme && (lt.fest || []).length) s += tx(x(letzteAnnahme[1]) + 5, y + 21, 'UW (n-1)', `fill:${f.muted};font-size:10.5px;`);
  });

  // Bedarf im Zieljahr
  const sKva = ncMassgeblichKva(ziel, p);
  if (sKva > 0) {
    const xs = x(sKva);
    s += `<line x1="${xs.toFixed(1)}" x2="${xs.toFixed(1)}" y1="40" y2="${AY}" style="stroke:${f.text};stroke-width:1.5;stroke-dasharray:4 3"/>`;
    s += `<path d="M${(xs - 6).toFixed(1)} 38 L${(xs + 6).toFixed(1)} 38 L${xs.toFixed(1)} 46 Z" style="fill:${f.text}"/>`;
    const rechts = xs > R - 200;
    s += tx(xs + (rechts ? -9 : 9), 54, `Bedarf ${ziel.jahr}: ${aeKva(sKva)}`, `fill:${f.text};font-size:12px;font-weight:700;`, `text-anchor="${rechts ? 'end' : 'start'}"`);
    const punkt = (kw, farbe, name) => kw > 0 && (s += `<circle cx="${x(kw / cos).toFixed(1)}" cy="${AY}" r="4.5" style="fill:${farbe}"><title>${escX(`${name} ${ziel.jahr}: ${kwText(kw)} (${aeKva(kw / cos)})`)}</title></circle>`);
    punkt(ziel.bezugKw, f.bezug, 'Bezug');
    punkt(ziel.einspKw, f.einsp, 'Einspeisung');
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:100%;height:auto;" role="img" aria-label="Leistungsleiter: Bedarf, Netzebenen und Wege A bis D"><defs>${defs}</defs>${s}</svg>`;
}

/* ── Steckbrief: Checkliste und Maßnahme ────────────────────────────────── */

/**
 * Was für die Netzanschlussanfrage vorliegt. Abgeleitet, wo das Tool es weiß; von Hand abzuhaken,
 * wo nicht (Lageplan beigelegt, Zuständigkeit geprüft).
 *   reihe, stand, grenzen wie ncWege; erzeuger = Anzahl Erzeuger-Assets; netzbetreiber = Name (String);
 *   empfWeg = 'A'…'D' | undefined; uwGewaehlt = bool; haken = { lageplan, zustaendigkeit }
 * → [{ id, text, hinweis, stufe: 'ok'|'fehlt'|'na', aktion, manuell }]
 */
export function ncCheckliste({ reihe, stand, grenzen, erzeuger, netzbetreiber, empfWeg, uwGewaehlt, haken = {} }) {
  const daten = (reihe || []).some(r => r.bezugKw > 0 || r.einspKw > 0);
  const uwNoetig = empfWeg === 'C' || empfWeg === 'D';
  return [
    { id: 'tabelle', text: 'Leistungstabelle je Jahr', hinweis: 'Bezug und Einspeisung aus Bedarfsprognose und Erzeugern', stufe: daten ? 'ok' : 'fehlt', aktion: daten ? 'csv' : null },
    { id: 'lastgang', text: 'Gemessener Lastgang', hinweis: stand?.basisKw > 0 ? `${stand.quelle || stand.dataYear}` : 'Strom-Grundlagen › Messjahre', stufe: stand?.basisKw > 0 ? 'ok' : 'fehlt', aktion: 'lastgang' },
    { id: 'grenzen', text: 'Vereinbarte Anschlussleistung', hinweis: 'aus dem Netzanschlussvertrag', stufe: grenzen?.bezugKw > 0 && grenzen?.einspKw > 0 ? 'ok' : 'fehlt', aktion: 'grenzen' },
    { id: 'netzbetreiber', text: 'Netzbetreiber und Spannungsebene', hinweis: netzbetreiber || 'Strom-Grundlagen › Netzanschluss', stufe: String(netzbetreiber || '').trim() ? 'ok' : 'fehlt', aktion: 'grenzen' },
    { id: 'erzeuger', text: 'Erzeugungsanlagen mit Leistung und Inbetriebnahmejahr', hinweis: erzeuger > 0 ? `${erzeuger} Anlage${erzeuger > 1 ? 'n' : ''} im Projekt` : 'keine Erzeuger – entfällt', stufe: erzeuger > 0 ? 'ok' : 'na', aktion: null },
    { id: 'uw', text: 'Umspannwerk für den Direktanschluss', hinweis: uwNoetig ? (uwGewaehlt ? 'gewählt' : 'unter „2 · Wege" wählen') : 'nur bei Weg C/D nötig', stufe: !uwNoetig ? 'na' : uwGewaehlt ? 'ok' : 'fehlt', aktion: uwNoetig ? 'uw' : null },
    { id: 'lageplan', text: 'Lageplan mit Übergabestation beigelegt', hinweis: 'Auswertung › Liegenschaftsbilder', stufe: haken.lageplan ? 'ok' : 'fehlt', aktion: 'lageplan', manuell: true },
    { id: 'zustaendigkeit', text: 'Zuständigen Netzbetreiber geprüft', hinweis: 'z. B. über VNB Digital — das nächste UW gehört nicht immer dem eigenen VNB', stufe: haken.zustaendigkeit ? 'ok' : 'fehlt', aktion: null, manuell: true },
  ];
}

const NC_MASSNAHME_TYP = { A: 'Sonstiges', B: 'Ertuechtigung', C: 'Bau', D: 'Bau' };

/**
 * Vorschlag für die Maßnahme zu einem Weg: Titel, Art, Jahr (erste Überschreitung bis zum Zieljahr,
 * frühestens das Messjahr; sonst das Zieljahr) und Kosten (nur beim Direktanschluss bezifferbar).
 *   weg = Eintrag aus ncWege; reihe, grenzen, ziel, p wie dort; heute = Messjahr; uw = { name, b } | null
 * → { titel, typ, jahr, kosten, weg }
 */
export function ncMassnahme({ weg, reihe, grenzen, ziel, p, heute, uw }) {
  const bisZiel = (reihe || []).filter(z => z.jahr <= ziel.jahr);
  const u = [ncUeberschreitung(bisZiel, 'bezugKw', grenzen?.bezugKw), ncUeberschreitung(bisZiel, 'einspKw', grenzen?.einspKw)].filter(j => j != null);
  const jahr = u.length ? Math.max(heute, Math.min(...u)) : ziel.jahr;
  const sKva = ncMassgeblichKva(ziel, p);
  let titel, kosten = 0;
  if (weg.id === 'A') titel = 'Netzanschluss: Leistungsspitzen kappen (Speicher, Einspeisebegrenzung, Lastmanagement)';
  else if (weg.id === 'B') titel = `Netzanschluss: Anschlussleistung am MS-Strang erhöhen auf ≈ ${aeKva(sKva)}`;
  else if (weg.id === 'C') {
    const b = uw?.b, n = b?.ziel?.systeme || b?.stufen?.[0]?.systeme || 1;
    titel = `Netzanschluss: Direktanschluss ${uw?.name || 'Umspannwerk'}, ${n} Kabelsystem${n > 1 ? 'e' : ''}${b ? `, Trasse ≈ ${uwMw(b.laengeKm)} km` : ''}`;
    kosten = Math.round((b?.ziel?.kosten || b?.stufen?.[0]?.kosten)?.anschlussEur || 0);
  } else titel = 'Netzanschluss: eigenes Umspannwerk 110 kV / MS';
  return { titel, typ: NC_MASSNAHME_TYP[weg.id] || 'Sonstiges', jahr, kosten, weg: weg.id };
}

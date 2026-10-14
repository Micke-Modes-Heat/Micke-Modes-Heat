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
 * → [{ id, titel, traegt, kosten, ebene, zahlt, ampel: { stufe: 'ok'|'warn'|'bad'|'na', text } }]
 */
export function ncWege({ ziel, grenzen, reihe, p, uw }) {
  const zB = (ziel?.bezugKw || 0) / 1000, zE = (ziel?.einspKw || 0) / 1000;
  const zielMva = Math.max(zB, zE) / (p.cosPhi || 1);
  const mw = kw => (kw > 0 ? `${uwMw(kw / 1000)} MW` : '—');
  const out = [];

  // A — Bestand halten
  const gB = grenzen?.bezugKw > 0 ? grenzen.bezugKw : null, gE = grenzen?.einspKw > 0 ? grenzen.einspKw : null;
  const uB = ncUeberschreitung(reihe, 'bezugKw', gB), uE = ncUeberschreitung(reihe, 'einspKw', gE);
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
  out.push({ id: 'A', titel: 'Bestand halten, Spitzen kappen (Speicher, Einspeisebegrenzung, Lastmanagement)',
    // Bezug ist in kVA vereinbart, Einspeisung in kW zugesagt — Einheiten nicht vermischen
    traegt: `${gB ? `${uwMw(gB / 1000)} MVA` : '—'} / ${gE ? mw(gE) : '—'}`, kosten: 'Speicher/Steuerung, siehe PV-Analyse', ebene: 'wie heute', zahlt: 'Kunde', ampel: a });

  // B — Erhöhung am bestehenden Strang
  out.push({ id: 'B', titel: 'Anschlussleistung am bestehenden MS-Strang erhöhen',
    traegt: `bis ≈ ${uwMw(p.grenzeStrangMva)} MVA (Orientierung)`, kosten: 'Angebot Netzbetreiber + BKZ', ebene: 'NE 5', zahlt: 'Kunde (Bezug) / VNB (Einspeisung)',
    ampel: !(zielMva > 0) ? { stufe: 'na', text: 'kein Bedarf' }
      : zielMva <= p.grenzeStrangMva ? { stufe: 'ok', text: 'im üblichen Bereich – Anfrage' }
      : zielMva <= p.grenzeStrangMva * 2.5 ? { stufe: 'warn', text: 'Grenzbereich – Anfrage' }
      : { stufe: 'bad', text: 'über Orientierungswert' } });

  // C — Direktanschluss Umspannwerk
  if (uw?.b) {
    const b = uw.b, n = b.ziel?.systeme || b.stufen[0].systeme;
    const traegtB = (n - (b.redundant ? 1 : 0)) * b.jeSystem.bezugMw, traegtE = (n - (b.redundant ? 1 : 0)) * b.jeSystem.einspMw;
    const kosten = (b.ziel?.kosten || b.stufen[0].kosten).anschlussEur;
    const ueberUw = b.n1Mw > 0 && Math.max(zB, zE) > b.n1Mw;
    out.push({ id: 'C', titel: `Direktanschluss ${uw.name || 'Umspannwerk'}, ${n} System${n > 1 ? 'e' : ''}${b.redundant ? ' (n-1)' : ''}, Trasse ≈ ${uwMw(b.laengeKm)} km`,
      traegt: `${uwMw(traegtB)} / ${uwMw(traegtE)} MW${b.redundant ? ' gesichert' : ''}`, kosten: uwEurSpanne(kosten), ebene: 'NE 4', zahlt: 'Kunde (Bezug), Anlagenbetreiber (EEG)',
      ampel: !(zielMva > 0) ? { stufe: 'na', text: 'kein Bedarf' }
        : ueberUw ? { stufe: 'warn', text: 'über (n-1) des UW – Ausbau nötig' }
        : n > 3 ? { stufe: 'warn', text: `${n} Systeme – HS prüfen` }
        : { stufe: 'ok', text: `deckt ${ziel?.jahr ?? 'Ziel'}` } });
  } else {
    out.push({ id: 'C', titel: 'Direktanschluss an ein Umspannwerk', traegt: '—', kosten: '—', ebene: 'NE 4', zahlt: 'Kunde (Bezug), Anlagenbetreiber (EEG)',
      ampel: { stufe: 'na', text: 'Umspannwerk wählen (unten)' } });
  }

  // D — eigenes Umspannwerk
  const ebene = uwEbene(zielMva, p);
  out.push({ id: 'D', titel: 'Eigenes Umspannwerk 110 kV / MS', traegt: `über ≈ ${uwMw(p.grenzeUwMva)} MVA`, kosten: 'noch kein Ansatz (FNN-Beispiel: rund 5 × Direktanschluss)', ebene: 'NE 3', zahlt: 'Kunde',
    ampel: ebene?.id === 'hs' ? { stufe: 'warn', text: 'Größenordnung passt – prüfen' } : { stufe: 'na', text: 'überdimensioniert' } });
  return out;
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

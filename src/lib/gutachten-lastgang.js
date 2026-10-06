// ── lib/gutachten-lastgang.js — Gutachtentexte zum Wärmelastgang: Witterungsbereinigung, Sommergrundlast,
//    Spitzenlast und Auslegungsheizlast, Leistung ↔ Jahresdeckung ──
// DOM-frei. Eingaben kommen aus systemState, der Witterungsbereinigung (34-witterung.js) und der Bestandsanlage.
import { F, wtHilfen, wtDeckungsleistung } from './gutachten-waerme-texte.js';
import { sommerMittel } from './witterung.js';

const { ok, nf, pct, absatz } = wtHilfen;
const L = kw => (kw >= 1000 ? `${nf(kw / 1000, 2)} MW` : `${nf(kw)} kW`);

/** Bezugstemperatur der linearen Extrapolation (Innentemperatur, bei der die Heizlast null wird), °C. */
export const LG_INNEN = 22;

/** Witterungsbereinigung des Lastgangs (wb = window._wbInfo) oder Hinweis auf das Messjahr. */
export function lgTextWitterung(wb, o = {}) {
  if (wb && ok(wb.faktor)) {
    return [absatz(`Um eine repräsentative Planungsgrundlage zu erhalten, wurde der Lastgang einer Witterungsbereinigung unterzogen. `,
      `Maßgeblich ist das Verhältnis der Gradtagzahlen G20/15 des Messjahres ${wb.messjahr} (${nf(wb.gMess)} Kd) zum Mittel der Jahre ${wb.vonJahr}–${wb.bisJahr} (${nf(wb.gMittel)} Kd). `,
      `Das Messjahr war damit ${wb.faktor > 1 ? 'wärmer' : 'kälter'} als im langjährigen Mittel; der Bereinigungsfaktor beträgt ${nf(wb.faktor, 3)}. `,
      `Bereinigt wurde nur der witterungsabhängige Anteil oberhalb der Sommergrundlast von ${L(wb.grundlastKw)}; Warmwasser und Netzverluste bleiben unverändert. `,
      `Der Jahresverbrauch ändert sich dadurch von ${nf(wb.vorMwh)} MWh auf ${nf(wb.nachMwh)} MWh. Datengrundlage der Temperaturen sind Tagesmittelwerte aus dem Open-Meteo-Archiv (ERA5-Reanalyse) am Standort der Liegenschaft.`)];
  }
  if (o.gemessen) {
    return [absatz(o.messjahr ? `Der Lastgang spiegelt die Witterung des Messjahres ${o.messjahr} wider; eine Witterungsbereinigung ist ` : 'Der Lastgang spiegelt die Witterung des Messjahres wider; eine Witterungsbereinigung ist ',
      F('nicht erfolgt / erfolgt (Gradtagzahlen unter 🔥 Wärme-Grundlagen → Lastgang laden)'), '.')];
  }
  return [];
}

/** Sommergrundlast Juli/August = Warmwasser + Netzverluste, aufs Jahr hochgerechnet. */
export function lgTextGrundlast({ lastgangKw, gesamtMwh, netzverlustMwh } = {}) {
  if (!lastgangKw || lastgangKw.length < 8760 || !(gesamtMwh > 0)) return [];
  const pS = sommerMittel(lastgangKw);
  if (!(pS > 0)) return [];
  const grundMwh = (pS * 8760) / 1000;
  const anteil = (grundMwh / gesamtMwh) * 100;
  const nvKw = ok(netzverlustMwh) && netzverlustMwh > 0 ? (netzverlustMwh * 1000) / 8760 : NaN;
  const twwKw = ok(nvKw) ? Math.max(0, pS - nvKw) : NaN;
  const out = [absatz('Unter der Prämisse, dass in den Sommermonaten Juli und August keine Raumwärme benötigt wird, dient die in diesem Zeitraum eingespeiste Wärmemenge ausschließlich der Trinkwarmwasserbereitung (TWW) sowie der Deckung der Netzverluste. ',
    `Die Hochrechnung dieser Grundlast auf das gesamte Kalenderjahr ergibt rund ${nf(grundMwh)} MWh; das entspricht etwa ${pct(anteil)} der Gesamtwärme und einer durchschnittlichen Dauerleistung von ${L(pS)}.`)];
  if (ok(nvKw) && nvKw >= 0.95 * pS) {
    out.push(absatz(`Die angesetzten Netzverluste von rund ${L(nvKw)} erreichen bereits die gesamte Sommergrundlast; ein Trinkwarmwasseranteil lässt sich so nicht abgrenzen. Die Netzverluste sollten daher geprüft werden.`));
  } else if (ok(twwKw)) {
    out.push(absatz(`Davon entfallen rechnerisch rund ${L(twwKw)} (${pct((twwKw / pS) * 100)}) auf die Trinkwarmwasserbereitung und rund ${L(nvKw)} (${pct((nvKw / pS) * 100)}) auf die Netzverluste.`));
  }
  return out;
}

/**
 * Spitzenlast und Auslegungsheizlast.
 * o: { lastgangKw, tageT (365 Tagesmittel des Messjahres), normAtC, auffaelligeNutzung, bestandThermKw }
 */
export function lgSpitzenlast(lastgangKw, tageT, normAtC) {
  if (!lastgangKw || lastgangKw.length < 8760) return null;
  let pMax = 0, hMax = 0;
  for (let h = 0; h < 8760; h++) if (lastgangKw[h] > pMax) { pMax = lastgangKw[h]; hMax = h; }
  const tag = Math.floor(hMax / 24);
  const tSpitze = Array.isArray(tageT) && tageT.length === 365 ? tageT[tag] : NaN;
  const tMin = Array.isArray(tageT) && tageT.length === 365 ? Math.min(...tageT) : NaN;
  const grund = sommerMittel(lastgangKw);
  // Linear über die Temperaturdifferenz zur Innentemperatur: P(T_Norm) = P(T_Spitze) · (22 − T_Norm) / (22 − T_Spitze)
  let pNorm = NaN;
  if (ok(tSpitze) && ok(normAtC) && tSpitze < LG_INNEN) {
    pNorm = normAtC < tSpitze ? pMax * (LG_INNEN - normAtC) / (LG_INNEN - tSpitze) : pMax;
  }
  return { pMax, tag, tSpitze, tMin, normAtC, pNorm, grund };
}

export function lgTextSpitzenlast(o = {}) {
  const s = lgSpitzenlast(o.lastgangKw, o.tageT, o.normAtC);
  if (!s) return [];
  const out = [];
  const datum = new Date(Date.UTC(2023, 0, 1 + s.tag)).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  if (ok(s.pNorm)) {
    out.push(absatz(`Die Auswertung der Jahresdauerlinie ergibt eine maximale thermische Spitzenlast von ${L(s.pMax)}. Sie trat am ${datum} bei einer Tagesmitteltemperatur von ${nf(s.tSpitze, 1)} °C auf`,
      ok(s.tMin) && s.tMin < s.tSpitze - 0.5 ? ` (tiefstes Tagesmittel des Jahres: ${nf(s.tMin, 1)} °C)` : '', '. ',
      s.normAtC < s.tSpitze
        ? `Durch lineare Extrapolation auf die standortspezifische Norm-Außentemperatur von ${nf(s.normAtC, 1)} °C – im Verhältnis der Temperaturdifferenzen zur Innentemperatur von ${LG_INNEN} °C (${nf(LG_INNEN - s.normAtC, 1)} K zu ${nf(LG_INNEN - s.tSpitze, 1)} K) – ergibt sich eine rechnerische Auslegungsheizlast von rund ${L(s.pNorm)}.`
        : `Da diese Temperatur bereits unter der Norm-Außentemperatur von ${nf(s.normAtC, 1)} °C liegt, wird die gemessene Spitzenlast unmittelbar als Auslegungsheizlast angesetzt.`));
  } else {
    out.push(absatz(`Die Auswertung der Jahresdauerlinie ergibt eine maximale thermische Spitzenlast von ${L(s.pMax)}. Die Extrapolation auf die Norm-Außentemperatur setzt die Tagestemperaturen des Messjahres voraus `,
      F('Gradtagzahlen unter 🔥 Wärme-Grundlagen → Lastgang laden'), '; ohne sie wird die Spitzenlast des Lastgangs als Auslegungsheizlast angesetzt.'));
  }
  const ausl = ok(s.pNorm) ? s.pNorm : s.pMax;
  const reserve = o.reserve || 'auto';
  if (reserve === '10' || reserve === '20') {
    const f = 1 + Number(reserve) / 100;
    out.push(absatz(`Für die Dimensionierung der Wärmeerzeugung wird eine Leistungsreserve von ${reserve} % empfohlen; die Erzeugerleistung ist damit auf rund ${L(ausl * f)} auszulegen.`));
  } else if (reserve === 'auto' && o.auffaelligeNutzung) {
    out.push(absatz(`Die Gebäudeauswertung deutet aufgrund der sehr hohen spezifischen Verbrauchswerte der Nutzungsart ${o.auffaelligeNutzung} auf mögliche Fehlbetriebszustände bzw. ungünstige Nutzungsweisen hin. `,
      'Die daraus resultierenden Leistungs- und Wärmebedarfe liegen teilweise über den auf Grundlage des Gebäudestandards zu erwartenden Werten. ',
      `Vor diesem Hintergrund sollte geprüft werden, ob die Wärmeerzeugung mit einer zusätzlichen Leistungsreserve dimensioniert und beispielsweise auf rund ${L(ausl * 1.1)} bis ${L(ausl * 1.2)} ausgelegt werden sollte.`));
  }
  if (o.bestandThermKw > 0) {
    out.push(absatz(`Der Abgleich mit der derzeit installierten thermischen Gesamtleistung von ${L(o.bestandThermKw)} zeigt, dass der bestehende Anlagenpark `,
      o.bestandThermKw >= ausl ? `über eine Leistungsreserve von rund ${L(o.bestandThermKw - ausl)} verfügt. ` : `die Auslegungsheizlast um rund ${L(ausl - o.bestandThermKw)} unterschreitet. `,
      `Für die weiteren Berechnungen und die Dimensionierung der neuen Wärmeerzeuger wird die Auslegungsheizlast von ${L(ausl)} zugrunde gelegt${reserve === '10' || reserve === '20' ? ` zuzüglich der Reserve von ${reserve} %` : reserve === 'auto' && o.auffaelligeNutzung ? ' – vorbehaltlich einer optionalen zusätzlichen Reserve' : ''}.`));
  }
  return out;
}

/** Erforderliche EE-Leistung für Deckungsquoten (z. B. GEG 65 %) aus der Jahresdauerlinie. */
export function lgTextDeckung({ jdlKw, quoten = [65, 90] } = {}) {
  if (!jdlKw || !jdlKw.length) return [];
  const r = quoten.map(q => ({ q, kw: wtDeckungsleistung(jdlKw, q / 100) })).filter(x => ok(x.kw));
  if (!r.length) return [];
  const [a, ...rest] = r;
  return [
    absatz('Die Analyse der Jahresdauerlinie zeigt, dass die maximalen Spitzenlasten nur über eine sehr begrenzte Anzahl an Betriebsstunden pro Jahr abgerufen werden. Daraus lässt sich die Korrelation zwischen installierter Erzeugerleistung und abdeckbarer Jahreswärmemenge ableiten.'),
    absatz(`Um ${a.q === 65 ? 'die Anforderungen des Gebäudeenergiegesetzes (GEG) zu erfüllen und ' : ''}einen regenerativen Anteil von ${pct(a.q)} an der Jahreswärmemenge zu erreichen, ist eine installierte Leistung von rund ${L(a.kw)} aus erneuerbaren Energien erforderlich.`,
      rest.map(x => ` Soll eine regenerative Deckungsrate von ${pct(x.q)} realisiert werden, erhöht sich die benötigte EE-Leistung auf rund ${L(x.kw)}.`).join('')),
    absatz('Einschränkend ist festzuhalten, dass diese modellhafte Berechnung von einer konstanten thermischen Leistung der Erzeuger ausgeht. Da Wärmepumpen bei sinkenden Außentemperaturen und steigenden Vorlauftemperaturen an Leistung verlieren, muss dies bei der Auslegung der Wärmepumpenleistung berücksichtigt werden; die temperaturabhängige Leistungscharakteristik wird in der Potenzialanalyse betrachtet.'),
  ];
}

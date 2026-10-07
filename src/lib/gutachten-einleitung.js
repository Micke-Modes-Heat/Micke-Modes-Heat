// ── lib/gutachten-einleitung.js — Textbausteine Einleitung (1.1, 1.2) und Einstieg in den Ist-Zustand Wärme ──
// DOM-frei, Absätze wie in lib/gutachten-waerme-texte.js (Zeichenketten und Platzhalter {feld, wert}).
//
// Sprachliche Varianz: Die Einleitung ist von Gutachten zu Gutachten fast gleich. Damit nicht jedes Gutachten
// wortgleich beginnt, gibt es je Absatz mehrere gleichwertige Formulierungen. Welche gilt, hängt am Projekt
// (Startwert aus dem Liegenschaftsnamen) und an einem Zähler im Gutachten-Dokument („andere Formulierung“) —
// so bleibt der Text bei jedem Export gleich, bis der Gutachter bewusst umschaltet.
//
// Vorgaben des Auftraggebers (Erlasse usw.) stehen bewusst nicht im Quellcode. Der Text übernimmt sie aus
// einer lokal gespeicherten Vorlage; fehlt sie, bleibt ein gelber Platzhalter.
import { F, wtHilfen } from './gutachten-waerme-texte.js';

const { liste, absatz } = wtHilfen;

/** Stabiler Startwert aus einem Text (z. B. dem Liegenschaftsnamen). */
export function geStartwert(text) {
  let h = 0;
  for (const c of String(text || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h;
}

/** Wählt eine Formulierung: Absatz `slot` bekommt je Startwert eine andere, aber feste Variante. */
export function geWaehle(optionen, seed, slot = 0) {
  const n = optionen.length;
  return optionen[(((seed + slot * 7) % n) + n) % n];
}

const seedVon = o => geStartwert(o.liegenschaft) + (Number(o.variante) || 0);

/**
 * 1.1 Ziele und Grundsätze.
 * o: { liegenschaft, ort, vorgaben (lokaler Text, mehrere Absätze durch Leerzeilen), variante, mitResilienz = true }
 */
export function geTextZiele(o = {}) {
  const s = seedVon(o);
  const L = F('Name der Liegenschaft', o.liegenschaft);
  const ORT = F('Ort', o.ort);
  const kriterien = liste(['Energieeffizienz', 'Klimaschutz', 'Wirtschaftlichkeit', ...(o.mitResilienz === false ? [] : ['Resilienz'])]);
  const out = [];

  out.push(absatz(...geWaehle([
    ['Ziel des Gutachtens zur Energieversorgung der ', L, ' in ', ORT, ` ist die Bewertung der bestehenden Energieversorgung unter den Gesichtspunkten ${kriterien}. Auf dieser Grundlage wird eine Empfehlung für die zukünftige Strom- und Wärmeversorgung der Liegenschaft entwickelt.`],
    ['Das vorliegende Gutachten bewertet die bestehende Energieversorgung der ', L, ' in ', ORT, ` hinsichtlich ${kriterien}. Daraus wird eine Empfehlung für die künftige Strom- und Wärmeversorgung der Liegenschaft abgeleitet.`],
    ['Gegenstand dieses Gutachtens ist die Energieversorgung der ', L, ' in ', ORT, `. Sie wird unter den Gesichtspunkten ${kriterien} bewertet; darauf aufbauend wird eine Empfehlung für die zukünftige Strom- und Wärmeversorgung erarbeitet.`],
  ], s, 0)));

  out.push(absatz(geWaehle([
    'Im Mittelpunkt stehen die Einhaltung der gesetzlichen Vorgaben, insbesondere des Gebäudeenergiegesetzes (GEG), sowie die Integration erneuerbarer Energien im Sinne der klimapolitischen Ziele der Bundesrepublik Deutschland und der Europäischen Union. Grundlage hierfür sind das Pariser Klimaschutzabkommen, das Europäische Klimagesetz und die nationale Zielvorgabe, bis 2045 Klimaneutralität zu erreichen.',
    'Maßgeblich sind dabei die gesetzlichen Anforderungen, allen voran das Gebäudeenergiegesetz (GEG), und die verstärkte Nutzung erneuerbarer Energien entsprechend den Klimaschutzzielen von Bund und Europäischer Union. Den Rahmen bilden das Pariser Klimaschutzabkommen, das Europäische Klimagesetz sowie das nationale Ziel der Klimaneutralität bis 2045.',
    'Den Bewertungsrahmen bilden die gesetzlichen Vorgaben, insbesondere das Gebäudeenergiegesetz (GEG), und die klimapolitischen Ziele Deutschlands und der Europäischen Union, die eine konsequente Einbindung erneuerbarer Energien verlangen. Hierzu zählen das Pariser Klimaschutzabkommen, das Europäische Klimagesetz und das Ziel, bis 2045 klimaneutral zu sein.',
  ], s, 1)));

  const vorgaben = String(o.vorgaben || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
  if (vorgaben.length) vorgaben.forEach((t, i) => out.push(absatz(F(`Vorgaben des Auftraggebers${vorgaben.length > 1 ? ` (${i + 1})` : ''}`, t))));
  else out.push(absatz(F('Vorgaben des Auftraggebers (Erlasse, Kurzfassung) – im Gutachten-Editor unter „Vorgaben des Auftraggebers“ hinterlegen', '')));

  out.push(absatz(geWaehle([
    'Als öffentlicher Auftraggeber ist der Bund darüber hinaus verpflichtet, eine Vorbildfunktion einzunehmen und seinen Gebäudebestand konsequent auf klimaneutrale Versorgungskonzepte auszurichten.',
    'Dem Bund kommt als öffentlichem Eigentümer zudem eine Vorbildfunktion zu; sein Gebäudebestand ist konsequent auf eine klimaneutrale Versorgung auszurichten.',
    'Hinzu kommt die Vorbildfunktion der öffentlichen Hand, die eine konsequente Ausrichtung des Gebäudebestands auf klimaneutrale Versorgungskonzepte verlangt.',
  ], s, 2)));

  out.push(absatz(geWaehle(['Die Zielsetzung des Gutachtens umfasst:', 'Das Gutachten verfolgt im Einzelnen folgende Ziele:', 'Im Einzelnen umfasst die Zielsetzung:'], s, 3)));
  out.push(absatz('• Bewertung der bestehenden Energieversorgung hinsichtlich energetischer Qualität, Wirtschaftlichkeit und Klimawirkung,'));
  out.push(absatz('• Entwicklung eines zukunftsfähigen Versorgungskonzepts im Einklang mit den gesetzlichen Rahmenbedingungen und den Vorgaben des Auftraggebers,'));
  out.push(absatz('• Prüfung der technischen und wirtschaftlichen Realisierbarkeit erneuerbarer Energien zur Erreichung der Klimaneutralität bis 2045.'));

  out.push(absatz(geWaehle([
    'Das Gutachten unterstützt damit die strategische Transformation hin zu einer klimaresilienten, nachhaltigen und klimaneutralen Energieversorgung der Bundesliegenschaften.',
    'Damit leistet das Gutachten einen Beitrag zur Transformation der Bundesliegenschaften hin zu einer klimaneutralen, nachhaltigen und widerstandsfähigen Energieversorgung.',
    'Es bildet so einen Baustein der strategischen Transformation der Bundesliegenschaften zu einer klimaneutralen und krisenfesten Energieversorgung.',
  ], s, 4)));
  return out;
}

/** 1.2 Liegenschaftsinformationen — bewusst kein Standardtext (zu liegenschaftsspezifisch). */
export function geTextLiegenschaft() {
  return [absatz(F('Kapitelerstellung ausstehend – liegenschaftsspezifische Angaben ergänzen (Lage, Nutzung und Auftrag der Liegenschaft, Anzahl Gebäude und Nutzer, Besonderheiten)', ''))];
}

/**
 * Einstieg in den Ist-Zustand Wärme (Kapitelanfang vor 2.1).
 * o: { traeger: ['Erdgas', 'Heizöl', …], lastgang: true|false, liegenschaft, variante }
 */
export function geTextIstEinstieg(o = {}) {
  const s = seedVon(o);
  const tr = (o.traeger || []).filter(Boolean);
  const verbrauch = tr.length ? `der monatlichen ${liste(tr.map(t => `${t}-`)).replace(/-$/, '')}verbräuche` : 'der vorliegenden Verbrauchsdaten';
  const daten = o.lastgang ? `der Lastgangdaten und ${verbrauch}` : verbrauch;
  return [
    absatz(geWaehle([
      `In diesem Kapitel wird die Liegenschaft zunächst hinsichtlich ihres baulichen und anlagentechnischen Zustands analysiert. Im zweiten Schritt folgt eine Auswertung des Energiebedarfs anhand ${daten}.`,
      `Zunächst wird der bauliche und anlagentechnische Zustand der Liegenschaft analysiert. Anschließend wird der Energiebedarf anhand ${daten} ausgewertet.`,
      `Die Analyse beginnt mit dem baulichen und anlagentechnischen Zustand der Liegenschaft; darauf folgt die Auswertung des Energiebedarfs auf Basis ${daten}.`,
    ], s, 5)),
    absatz('Die folgende Abbildung gibt einen Gesamtüberblick über die Liegenschaft.'),
  ];
}

/** Anzahl der Formulierungsvarianten je Absatz. */
export const GE_VARIANTEN = 3;

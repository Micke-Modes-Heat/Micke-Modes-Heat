// ── lib/gutachten-rechenstand.js — „Stand der Berechnungen“ für das Gutachten Kapitel 5 ──
// DOM- und importfrei. Das Elektrokapitel setzt sich aus Rechnungen zusammen, die zu verschiedenen
// Zeitpunkten und mit verschiedenen Eingaben gelaufen sein können: Bedarfsprognose (live), Netzmodell
// (Engpass-Sweep), PV-Analyse (gespeicherter Lauf) und Resilienz-Rechnung. Passen sie nicht
// zusammen, widerspricht sich der Text (z. B. 5.4.2 „kein Netzmodell“ neben 5.4.1 mit 11 Trafos).
// Diese Datei vergleicht die Stände und sagt je Rechnung, ob sie zum Projekt passt.
//
// Status: 'ok' passt · 'hinweis' passt mit Einschränkung · 'veraltet' neu rechnen · 'fehlt' nicht gerechnet.

export const GR_STATUS = Object.freeze({ ok: 'aktuell', hinweis: 'mit Einschränkung', veraltet: 'veraltet', fehlt: 'fehlt' });

const n0 = v => Math.round(v).toLocaleString('de-DE');
const dateiName = p => String(p || '').split(/[\\/]/).pop().trim();

/**
 * d.bedarf   { lastgang, dataYear, zieljahr, zubauKw }   — Bedarfsprognose 5.3 (live); lastgang = aktueller Dateiname
 *                                                          zubauKw = geplante Verbraucher ohne Gebäude (WP, Lade …)
 * d.netz     { modell, frisch, berechnet }                — Netzmodell 5.4.1; frisch: Netz seit der Berechnung unverändert
 *                                                          (null = in dieser Sitzung nicht gerechnet)
 * d.pv       { berechnet, stale, stand, varianteAbweichend, lastgang, lastfall, zielJahr, netzkurve, bestandsnetz }
 *            — gespeicherter Lauf der PV-Analyse 5.4.2; lastfall 'ziel' (Zielausbau) | 'basis' (Messung)
 * d.resilienz { berechnet }                               — Resilienz-Rechnung 5.4.3 / Kapitel 8
 * @returns {Array<{ id, titel, kapitel, status, stand, hinweise: string[], wo }>}
 */
export function grRechenstand(d = {}) {
  const zeilen = [];
  const b = d.bedarf || {};
  const lastgangJetzt = dateiName(b.lastgang);

  // Bedarfsprognose rechnet beim Zeichnen — sie ist immer aktuell, solange ein Lastgang da ist
  zeilen.push(b.dataYear
    ? { id: 'bedarf', titel: 'Bedarfsprognose', kapitel: '5.2–5.3', status: 'ok',
        stand: `Referenzjahr ${b.dataYear}${b.zieljahr ? ` · Zieljahr ${b.zieljahr}` : ''}`,
        hinweise: [], wo: 'Strom-Grundlagen › Messjahre' }
    : { id: 'bedarf', titel: 'Bedarfsprognose', kapitel: '5.2–5.3', status: 'fehlt', stand: 'kein Lastgang',
        hinweise: ['Ohne Referenzjahr bleiben 5.2 bis 5.4 leer.'], wo: 'Strom-Grundlagen › Messjahre' });

  const nz = d.netz || {};
  if (!nz.modell) {
    zeilen.push({ id: 'netz', titel: 'Netzmodell', kapitel: '5.4.1', status: 'fehlt', stand: 'kein Netz erfasst',
      hinweise: ['Ohne Trafos und Kabel bewertet 5.4.1 das interne Netz nur mit Platzhaltern.'], wo: 'Planung › Strom › Netz' });
  } else if (nz.frisch === false) {
    zeilen.push({ id: 'netz', titel: 'Netzmodell', kapitel: '5.4.1', status: 'veraltet', stand: 'Netz seit der Berechnung geändert',
      hinweise: ['Das Netz wurde nach der letzten Berechnung geändert; Engpässe und Kosten können abweichen.'], wo: 'Planung › Strom › Berechnen' });
  } else {
    zeilen.push({ id: 'netz', titel: 'Netzmodell', kapitel: '5.4.1', status: nz.frisch ? 'ok' : 'hinweis',
      stand: nz.frisch ? 'berechnet, unverändert' : 'beim Zeichnen gerechnet',
      hinweise: nz.frisch ? [] : ['In dieser Sitzung nicht gerechnet; das Gutachten rechnet den Engpass-Verlauf selbst.'],
      wo: 'Planung › Strom › Berechnen' });
  }

  const pv = d.pv || {};
  if (!pv.berechnet && !pv.stale) {
    zeilen.push({ id: 'pv', titel: 'PV-Analyse', kapitel: '5.4.2, 5.5, 5.6', status: 'fehlt', stand: 'nicht gerechnet',
      hinweise: ['Ohne „Varianten berechnen“ fehlen PV-Auslegung, Kosten und Bewertung.'], wo: 'Auswertung › PV-Analyse' });
  } else {
    const h = [], veraltet = [];
    if (pv.stale) veraltet.push('Eingaben der PV-Analyse wurden nach der Berechnung geändert.');
    if (pv.varianteAbweichend) veraltet.push(`Gerechnet für die Variante „${pv.varianteAbweichend}“, nicht für die aktive.`);
    const lgPv = dateiName(pv.lastgang);
    if (lgPv && lastgangJetzt && lgPv !== lastgangJetzt) veraltet.push(`Gerechnet mit dem Lastgang „${lgPv}“, aktuell ist „${lastgangJetzt}“.`);
    if (pv.lastfall === 'basis' && b.zubauKw > 0.5) {
      h.push(`Gerechnet mit dem gemessenen Lastgang ohne die geplanten Verbraucher (+${n0(b.zubauKw)} kW laut 5.3); `
        + 'Eigenverbrauch und Autarkie sind dadurch zu niedrig angesetzt.');
    }
    if (pv.lastfall === 'ziel' && pv.zielJahr && b.zieljahr && pv.zielJahr !== b.zieljahr) {
      h.push(`Zielausbau ${pv.zielJahr} der PV-Analyse weicht vom Zieljahr ${b.zieljahr} der Bedarfsprognose ab.`);
    }
    if (!pv.netzkurve && nz.modell && pv.bestandsnetz) {
      h.push('Rechenstand von vor dem Ausbaupfad: Netzkosten pauschal, die Ertüchtigung des internen Netzes fehlt in der Wirtschaftlichkeit.');
    }
    zeilen.push({ id: 'pv', titel: 'PV-Analyse', kapitel: '5.4.2, 5.5, 5.6',
      status: veraltet.length ? 'veraltet' : h.length ? 'hinweis' : 'ok',
      stand: [pv.stand ? `gerechnet ${pv.stand}` : 'gerechnet', pv.lastfall === 'basis' ? 'Lastgang Messung' : pv.lastfall === 'ziel' ? `Zielausbau${pv.zielJahr ? ' ' + pv.zielJahr : ''}` : '']
        .filter(Boolean).join(' · '),
      hinweise: [...veraltet, ...h], wo: 'Auswertung › PV-Analyse › Varianten berechnen' });
  }

  const rs = d.resilienz;
  if (rs) {
    zeilen.push(rs.berechnet
      ? { id: 'resilienz', titel: 'Resilienz-Rechnung', kapitel: '5.4.3, 8', status: 'ok', stand: 'gerechnet', hinweise: [], wo: 'PV-Analyse › Resilienz' }
      : { id: 'resilienz', titel: 'Resilienz-Rechnung', kapitel: '5.4.3, 8', status: 'fehlt', stand: 'nicht gerechnet',
          hinweise: ['Notstromauslegung und -kosten bleiben offen.'], wo: 'PV-Analyse › Resilienz' });
  }
  return zeilen;
}

/** Zusammenfassung für die Prüfliste am Export: nur was nicht passt, eine Zeile je Rechnung. */
export function grWarnungen(zeilen) {
  return (zeilen || []).filter(z => z.status === 'veraltet' || z.status === 'hinweis')
    .map(z => ({ stufe: z.status === 'veraltet' ? 'warn' : 'info',
                 text: `Stand der Berechnungen – ${z.titel} (${z.kapitel}): ${z.hinweise.join(' ')}` }));
}

// ── 39-pv-anschluss.js — Dach-PV an die Verteilung ihres Gebäudes hängen ──────
//
// Problem (07.10.2026): PV-Assets aus PV-Modus, automatischer Belegung und
// Belegungsständen entstanden ohne Kabel. Die Strang-Rechnungen (elCalcAssets,
// PV-Netzaufnahme 28, Netzstrategie 30, Einlinienschema 29) sahen sie dann gar
// nicht bzw. mit 0 kWp. Jetzt bekommt jedes Dach-PV-Asset beim Anlegen/Angleichen
// (03c _pvuEnsurePvAsset) ein gebäudeinternes Kabel zur UV, ohne UV zur NSHV.
// addStromEdge verbindet Assets desselben Gebäudes direkt (stationsintern, ohne
// Trassenrouting); Bau-/Abrissjahr erbt das Kabel von seinen Endpunkten.
//
// Für bestehende Projekte: Hinweis + Knopf im PV-Modus (25 über window.pvAnschlussHinweisHtml).

import { addStromEdge } from './05b-stromnetz.js';
import { ASSETS, TYPE_RANK, getAssetsForBuilding } from './13a-assets-core.js';
import { pvmPlanungsSchrittMerken, pvModusRender } from './25-pv-modus.js';

/** Verteilungen im Gebäude, an die eine Dach-PV angeschlossen wird — tiefste zuerst. */
const VERTEILER = ['UV', 'NSHV'];
const ORANGE = '#ffb74d';

const _kanten = () => window.stromEdges || [];
const _hatKabel = id => _kanten().some(e => e.u === id || e.v === id);

/** Verteilung im Gebäude der Anlage: UV vor NSHV, angeschlossene vor freien, die nächste. */
export function pvAnschlussZiel(a) {
  if (a?.buildingId == null) return null;
  const kand = getAssetsForBuilding(a.buildingId).filter(x => x.id !== a.id && VERTEILER.includes(x.type));
  if (!kand.length) return null;
  const d = x => (+x.lat - +a.lat) ** 2 + (+x.lng - +a.lng) ** 2;
  kand.sort((x, y) => ((TYPE_RANK[y.type] ?? 0) - (TYPE_RANK[x.type] ?? 0))
    || (Number(_hatKabel(y.id)) - Number(_hatKabel(x.id))) || (d(x) - d(y)));
  return kand[0];
}

/**
 * Dach-PV ohne Kabel an ihre Gebäudeverteilung hängen. Kein Ziel (Gebäude ohne
 * UV/NSHV) oder schon verbunden → nichts.
 * @returns {any|null} neues Kabel
 */
export function pvAssetAnschliessen(a) {
  if (!a || a.type !== 'PV' || a.buildingId == null || _hatKabel(a.id)) return null;
  const z = pvAnschlussZiel(a);
  if (!z) return null;
  try { return addStromEdge(z.id, a.id); }
  catch (err) { console.warn('[PV-Anschluss] Kabel nicht angelegt:', err); return null; }
}

/** Dach-PV-Assets ohne Kabel; `mitZiel` = davon an eine Verteilung im Gebäude anschließbar. */
export function pvUnverbundene() {
  const alle = ASSETS.items.filter(a => a.type === 'PV' && a.buildingId != null && !_hatKabel(a.id));
  return { alle, mitZiel: alle.filter(a => pvAnschlussZiel(a)) };
}

/** Alle anschließbaren Dach-PV-Assets anschließen — ein Strg+Z-Schritt (Planungstransaktion). */
export function pvUnverbundeneAnschliessen() {
  const { alle, mitZiel } = pvUnverbundene();
  if (!mitZiel.length) {
    alert(alle.length
      ? `${alle.length} PV-Anlage(n) ohne Kabel — ihre Gebäude haben weder UV noch NSHV. Erst eine Verteilung im Gebäude anlegen.`
      : 'Alle Dach-PV-Anlagen sind angeschlossen.');
    return;
  }
  let n = 0;
  const lauf = () => { for (const a of mitZiel) if (pvAssetAnschliessen(a)) n++; };
  try {
    if (typeof window.runPlanningTransaction === 'function') window.runPlanningTransaction('Dach-PV an Gebäudeverteilung anschließen', lauf);
    else lauf();
  } catch (err) {
    console.error(err);
    alert('Anschließen fehlgeschlagen: ' + err.message);
    return;
  }
  pvmPlanungsSchrittMerken();
  window.pvuNachlauf?.();
  window.calcStromPanel?.();
  window.pvMarkStale?.();
  const ohne = alle.length - mitZiel.length;
  window.showHint?.(`🔌 ${n} PV-Anlage(n) an UV/NSHV ihres Gebäudes angeschlossen.`
    + (ohne ? ` ${ohne} ohne Verteilung im Gebäude bleiben offen.` : '') + ' Strg+Z im PV-Modus nimmt den Schritt zurück.', 7000);
  pvModusRender();
}

/** Hinweis im PV-Modus, solange es unverbundene Dach-PV gibt. */
export function pvAnschlussHinweisHtml() {
  const { alle, mitZiel } = pvUnverbundene();
  if (!alle.length) return '';
  return `
    <div style="margin-top:6px;border:1px solid ${ORANGE}66;border-radius:5px;padding:5px 7px;background:${ORANGE}0d;font-size:10px;line-height:1.4;">
      <div style="color:${ORANGE};font-weight:600;">🔌 ${alle.length} PV-Anlage${alle.length > 1 ? 'n' : ''} ohne Kabel</div>
      <div style="font-size:9px;color:var(--muted);">Die Stromnetz-Berechnung und die PV-Netzaufnahme sehen sie sonst nicht.${
        alle.length > mitZiel.length ? ` ${alle.length - mitZiel.length} davon ohne UV/NSHV im Gebäude.` : ''}</div>
      ${mitZiel.length ? `<button class="btn-xs" style="width:100%;margin-top:4px;border-color:${ORANGE};color:${ORANGE};"
        data-click="pvUnverbundeneAnschliessen()" title="Gebäudeinternes Kabel zur UV (ohne UV zur NSHV) — ein Strg+Z-Schritt">
        ${mitZiel.length} an UV/NSHV ihres Gebäudes anschließen</button>` : ''}
    </div>`;
}

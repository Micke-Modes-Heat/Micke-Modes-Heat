// ── lib/asset-namen.js — Namen von Elektroassets an Gebäuden ─────────────────
// Ein Asset an einem Gebäude heißt „Typ Gebäudenummer Gebäudename". 13a liest
// den Namen damit LIVE (Getter auf asset.name), sodass Umbenennen oder Nummer-
// Nachtragen am Gebäude überall ankommt.
//   nameAuto   true  = Name wird gebildet; false = von Hand vergeben, bleibt fest
//   nameZusatz Text hinter dem gebildeten Namen („(Einsp.)", „Keller" …)

/** „Typ Nr Gebäudename"; fehlende Teile entfallen, Nummer am Namensanfang nicht doppelt. */
export function bildeAssetName(typLabel, g) {
  if (!g) return null;
  const nr = String(g.gebaeudenummer ?? '').trim();
  let gn   = String(g.name ?? '').trim();
  if (nr && (gn === nr || gn.startsWith(nr + ' '))) gn = gn.slice(nr.length).trim();
  const teile = [typLabel, nr, gn].filter(Boolean);
  if (teile.length === 1) teile.push(String(g.id));
  return teile.join(' ');
}

/**
 * Was eine Namenseingabe bedeutet. auto = gebildeter Name (null ohne Gebäude).
 * Leer oder der gebildete Name → automatisch; gebildeter Name + Text → automatisch
 * mit Zusatz; alles andere → fest.
 * @returns {{ auto:boolean, zusatz:string }}
 */
export function deuteNamensEingabe(eingabe, auto) {
  const s = String(eingabe ?? '').trim();
  if (auto && (!s || s === auto)) return { auto: true, zusatz: '' };
  if (auto && s.startsWith(auto + ' ')) return { auto: true, zusatz: s.slice(auto.length + 1).trim() };
  return { auto: !s, zusatz: '' };   // ohne Gebäude: leer = sobald zugeordnet, automatisch
}

// Altbestand ohne nameAuto-Kennung: alles, was mit dem Typ beginnt und dahinter
// nicht nur eine laufende Nummer trägt („UV Werkstatt", nicht „Trafo 2a"), war
// beim Anlegen aus dem Gebäudenamen gebildet.
const EINSP = '(Einsp.)';
/** @returns {{ auto:boolean, zusatz:string }} */
export function deuteAltenNamen(name, praefixe) {
  const s = String(name ?? '').trim();
  if (!s) return { auto: true, zusatz: '' };
  for (const p of new Set(praefixe.filter(Boolean))) {
    if (s === p) return { auto: true, zusatz: '' };
    if (!s.startsWith(p + ' ')) continue;
    let rest = s.slice(p.length + 1).trim(), zusatz = '';
    if (rest.endsWith(' ' + EINSP)) { rest = rest.slice(0, -EINSP.length).trim(); zusatz = EINSP; }
    if (!rest || /^\d+[a-z]?$/i.test(rest)) return { auto: false, zusatz: '' };
    return { auto: true, zusatz };
  }
  return { auto: false, zusatz: '' };
}

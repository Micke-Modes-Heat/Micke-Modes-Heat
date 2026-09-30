// ── lib/netz-uebersicht.js — Übersichtsschaltbild des Liegenschaftsnetzes (Gutachten 3.1.2) ──
//
// Verdichtet das Netzmodell (Assets + Stromkanten) auf die Ebene, die ein Gutachten zeigt:
// Stationen statt Einzelbetriebsmittel. Eine Station ist alles, was an Mittelspannungstechnik
// (NAP, Schaltanlage, Trafo) in EINEM Gebäude steht; ohne Gebäude ist jedes MS-Asset seine
// eigene Station. Zwischen den Stationen bleiben nur die MS-Verbindungen, gebündelt je Paar.
//
// Von jeder Station mit NAP (Übergabestation) gehen Abgänge aus: jede zusammenhängende Gruppe
// der übrigen Stationen ist ein Abgang, eingeordnet als Ring (beide Enden der Kette an der
// Übergabe), Strahl (Kette mit einem Ende an der Übergabe) oder verzweigt/vermascht. Die
// Reihenfolge `folge` ist die Zeichenreihenfolge; Verbindungen zwischen nicht benachbarten
// Stationen der Folge stehen in `innen` mit i < j, die Anbindung an die Übergabe in `wurzel`.
//
// Rein und DOM-frei — der Renderer in 17-gutachten-grafik.js liest nur das Ergebnis.

const MS_TYPEN = new Set(['NAP', 'Schaltanlage', 'Trafo']);
/** Vorgabe = TYPE_RANK aus 13a-assets-core (nicht importiert, damit die Lib ohne App-Kern läuft). */
const RANG_VORGABE = {
  NAP: 0, Schaltanlage: 1, Trafo: 2, NSHV: 3, UV: 4, KVS: 4,
  Verbraucher: 5, WP: 5, Geo: 5, FG: 5, Stromkessel: 5, Lade: 5, TWW: 5, Nsa: 5, KWK: 5,
  Wind: 6, PV: 6, Batterie: 6, H2: 6, Reserve: 7,
};
const ERZEUGER_TYPEN = ['PV', 'KWK', 'Wind', 'Batterie', 'Nsa', 'H2'];

/** Jahre der geplanten Maßnahmen mit newProps (für das Zieljahr der Darstellung). */
function nuPlanJahre(massnahmen, jahrVon, zj) {
  return (massnahmen || []).filter(m => m?.status === 'geplant' && m.newProps).map(m => jahrVon(m))
    .filter(j => Number.isFinite(j) && j <= zj);
}

const zahl = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const ganz = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const wahr = v => v === true || /^(true|ja|1|x|offen)$/i.test(String(v ?? '').trim());

/**
 * Geplant = Planungsschicht (entwicklung/entscheidung) oder Baujahr in der Zukunft — dieselbe
 * Regel wie die Trafo-Tabelle und die Anlagenübersichten des Gutachtens. Ohne eigenes Baujahr
 * gilt das des Gebäudes.
 */
export function nuIstGeplant(obj, geb, heute) {
  if (obj?.schicht === 'entwicklung' || obj?.schicht === 'entscheidung') return true;
  const bj = ganz(obj?.baujahr ?? geb?.baujahr);
  return bj != null && bj > heute;
}

/** Abgerissen = Abrissjahr (eigenes oder des Gebäudes) vor dem laufenden Jahr. */
export function nuIstAbgerissen(obj, geb, heute) {
  const ab = ganz(obj?.abrissjahr ?? geb?.abrissjahr);
  return ab != null && ab < heute;
}

/**
 * Wirksame Eigenschaften eines Betriebsmittels: Basis + Maßnahmen mit `newProps`, chronologisch —
 * dieselbe Regel wie getAssetPropsForYear (13a) bzw. die Kanten-Variante in 05b.
 * Ist: nur umgesetzte Maßnahmen, fällig bis `heute`. Ziel: umgesetzte UND geplante bis zum Zieljahr.
 * Maßnahmen ohne auflösbares Jahr wirken immer.
 */
export function nuWirksameProps(basis, massnahmen, { ziel = false, heute, zieljahr = Infinity, jahrVon = nuMassnahmeJahr } = {}) {
  const grenze = ziel ? zieljahr : heute;
  const out = { ...(basis || {}) };
  (massnahmen || [])
    .filter(m => m && m.newProps && Object.keys(m.newProps).length
      && (m.status === 'umgesetzt' || (ziel && m.status === 'geplant')))
    .map(m => ({ m, j: jahrVon(m) }))
    .filter(x => x.j == null || x.j <= grenze)
    .sort((a, b) => (a.j ?? 0) - (b.j ?? 0))
    .forEach(x => Object.assign(out, x.m.newProps));
  return out;
}

/** Jahr einer Maßnahme ohne Phasenkenntnis (App: window.massnahmeJahr löst auch Phasen auf). */
export const nuMassnahmeJahr = m => ganz(m?.jahr);

/**
 * @param {object} p
 * @param {object[]} p.assets   Elektro-Assets ({id, type, name, buildingId, props, schicht, baujahr, abrissjahr})
 * @param {object[]} p.edges    Stromkanten ({id, u, v, cableType, crossSection, qsGeschaetzt, lengthM, trennstelle, baujahr, abrissjahr})
 * @param {object[]} p.gebaeude Gebäude ({id, name, gebaeudenummer, baujahr, abrissjahr})
 * @param {object}   [p.typeRank] TYPE_RANK (niedriger = versorgungsseitig); ohne Angabe die Vorgabe oben
 * @param {number}   p.heute    laufendes Jahr
 * @param {boolean}  [p.mitPlanung=false] Zielnetz: geplante Betriebsmittel (markiert mit geplant: true) und geplante
 *                   Maßnahmen einbeziehen, alles mit Abrissjahr bis zum Zieljahr weglassen
 * @param {number}   [p.zieljahr] Zielnetz bis zu diesem Jahr (ohne Angabe: alle Planungen)
 * @param {function} [p.massnahmeJahr] Jahr einer Maßnahme (m) → number|null; in der App window.massnahmeJahr (Phasen)
 */
export function nuNetzUebersicht({ assets = [], edges = [], gebaeude = [], typeRank = RANG_VORGABE, heute,
  mitPlanung = false, zieljahr = null, massnahmeJahr = nuMassnahmeJahr } = {}) {
  const jahr = Number.isFinite(heute) ? heute : new Date().getFullYear();
  const zj = Number.isFinite(zieljahr) ? zieljahr : Infinity;
  const propsIst = obj => nuWirksameProps(obj.props, obj.massnahmen, { heute: jahr, jahrVon: massnahmeJahr });
  const propsZiel = obj => (mitPlanung
    ? nuWirksameProps(obj.props, obj.massnahmen, { ziel: true, heute: jahr, zieljahr: zj, jahrVon: massnahmeJahr })
    : propsIst(obj));
  // Im Zielnetz fällt alles mit Abrissjahr bis zum Zieljahr weg; neu Geplantes zählt nur bis dahin.
  const weg = (obj, g) => (mitPlanung
    ? (() => { const ab = ganz(obj?.abrissjahr ?? g?.abrissjahr); return ab != null && ab <= zj; })()
    : nuIstAbgerissen(obj, g, jahr));
  const zuSpaet = (obj, g) => { const bj = ganz(obj?.baujahr ?? g?.baujahr); return bj != null && bj > zj; };
  const planJahre = [];
  const gebMap = new Map(gebaeude.map(g => [String(g.id), g]));
  const gebVon = a => (a?.buildingId != null ? gebMap.get(String(a.buildingId)) || null : null);
  const rang = t => typeRank[t] ?? 5;

  // ── Betriebsmittel des Betrachtungsstands ──
  const aktiv = [];
  for (const a of assets) {
    if (!a || a.id == null) continue;
    const g = gebVon(a);
    if (weg(a, g)) continue;
    const geplant = nuIstGeplant(a, g, jahr);
    if (geplant && (!mitPlanung || zuSpaet(a, g))) continue;
    if (geplant && MS_TYPEN.has(a.type)) planJahre.push(ganz(a.baujahr ?? g?.baujahr));
    aktiv.push({ a, g, geplant });
  }
  const aktivMap = new Map(aktiv.map(x => [x.a.id, x]));
  const kanten = edges.filter(e => {
    if (!e || !aktivMap.has(e.u) && !gebMap.has(String(e.u))) return false;
    if (!aktivMap.has(e.v) && !gebMap.has(String(e.v))) return false;
    if (weg(e, null)) return false;
    return !nuIstGeplant(e, null, jahr) || (mitPlanung && !zuSpaet(e, null));
  });
  const kanteGeplant = e => nuIstGeplant(e, null, jahr) || !!aktivMap.get(e.u)?.geplant || !!aktivMap.get(e.v)?.geplant;

  // ── Stationen ──
  const stationKey = a => (a.buildingId != null ? 'g' + a.buildingId : 'a' + a.id);
  const stationen = new Map();
  const stationVon = new Map();      // assetId → Stationsschlüssel (nur MS-Assets)
  for (const { a, g, geplant } of aktiv) {
    if (!MS_TYPEN.has(a.type)) continue;
    const key = stationKey(a);
    if (!stationen.has(key)) {
      stationen.set(key, {
        key, gebId: a.buildingId ?? null, gebName: g?.name || '', gebNummer: String(g?.gebaeudenummer || '').trim(),
        gebIdx: g ? gebaeude.indexOf(g) : 1e9,
        hatNap: false, napKV: null, trafos: [], schaltanlagen: 0, nshv: 0, trennstelle: false,
        geplant: true, gebaeudeVersorgt: 0, erzeuger: {},
      });
    }
    const st = stationen.get(key);
    stationVon.set(a.id, key);
    if (!geplant) st.geplant = false;
    if (a.type === 'NAP') {
      st.hatNap = true;
      st.napKV = st.napKV ?? zahl(a.props?.spannungKV);
    } else if (a.type === 'Schaltanlage') {
      st.schaltanlagen++;
      if (wahr(a.props?.trennstelle)) st.trennstelle = true;
    } else {
      const ist = propsIst(a), ziel = propsZiel(a);
      const kva = zahl(ziel.leistungKVA), kvaIst = geplant ? null : zahl(ist.leistungKVA);
      st.trafos.push({ id: a.id, name: a.name || 'Trafo', kva, kvaIst, erzeugung: ziel.netzart === 'erzeugung', geplant,
                       ertuechtigt: !geplant && kva !== kvaIst });
      if (mitPlanung && !geplant && kva !== kvaIst) planJahre.push(...nuPlanJahre(a.massnahmen, massnahmeJahr, zj));
    }
  }
  for (const { a } of aktiv) {
    if (a.type !== 'NSHV') continue;
    const st = stationen.get(stationKey(a));
    if (st) st.nshv++;
  }

  // ── NS-Seite je Station: versorgte Gebäude und Erzeuger ──
  // Breitensuche von den Trafos der Station nur stromabwärts (gleicher oder höherer Typrang). Ein
  // Knoten gehört der ersten Station, die ihn erreicht — Kupplungen zwischen NS-Netzen zählen so nicht doppelt.
  const nachbarn = new Map();
  for (const e of kanten) {
    if (!nachbarn.has(e.u)) nachbarn.set(e.u, []);
    if (!nachbarn.has(e.v)) nachbarn.set(e.v, []);
    nachbarn.get(e.u).push(e.v);
    nachbarn.get(e.v).push(e.u);
  }
  const vergeben = new Set();
  const stationsListe = [...stationen.values()];
  for (const st of stationsListe) {
    const gebSet = new Set();
    const queue = st.trafos.map(t => t.id);
    queue.forEach(id => vergeben.add(id));
    while (queue.length) {
      const cur = queue.shift();
      const ca = aktivMap.get(cur)?.a;
      const cr = ca ? rang(ca.type) : 99;
      // Die NSHV steht meist im Stationsgebäude selbst — erst UV, Verbraucher oder Erzeuger machen ein Gebäude zum versorgten.
      if (ca && ca.buildingId != null && !MS_TYPEN.has(ca.type) && ca.type !== 'NSHV') gebSet.add(String(ca.buildingId));
      if (!ca && gebMap.has(String(cur))) gebSet.add(String(cur));
      if (ca && ERZEUGER_TYPEN.includes(ca.type)) {
        const p = ca.props || {};
        const kw = ca.type === 'PV' ? zahl(p.leistungKWp)
                 : ca.type === 'KWK' ? zahl(p.leistungElKW)
                 : ca.type === 'H2' ? zahl(p.brennstoffzelleKW)
                 : zahl(p.leistungKW);
        const e = st.erzeuger[ca.type] || (st.erzeuger[ca.type] = { anzahl: 0, kw: 0, ohneWert: 0 });
        e.anzahl++;
        if (kw != null && kw > 0) e.kw += kw; else e.ohneWert++;
      }
      if (!ca) continue;   // Gebäudeknoten ohne Asset sind Blätter
      for (const nb of nachbarn.get(cur) || []) {
        if (vergeben.has(nb)) continue;
        const na = aktivMap.get(nb)?.a;
        if (na && (MS_TYPEN.has(na.type) || rang(na.type) < cr)) continue;
        vergeben.add(nb);
        queue.push(nb);
      }
    }
    st.gebaeudeVersorgt = gebSet.size;
  }

  // ── MS-Verbindungen zwischen Stationen, gebündelt je Paar ──
  const verbindungen = new Map();
  for (const e of kanten) {
    const ka = stationVon.get(e.u), kb = stationVon.get(e.v);
    if (!ka || !kb || ka === kb) continue;
    const [a, b] = ka < kb ? [ka, kb] : [kb, ka];
    const schl = a + '|' + b;
    if (!verbindungen.has(schl)) verbindungen.set(schl, { a, b, anzahl: 0, kabel: [], trennstelle: false, laengeM: 0, geplant: true, ertuechtigt: false });
    const v = verbindungen.get(schl);
    // Kabeldaten stehen direkt an der Kante; Maßnahmen überschreiben crossSection/nParallel/cableType.
    const basis = { cableType: e.cableType, crossSection: e.crossSection, nParallel: e.nParallel };
    const ist = propsIst({ props: basis, massnahmen: e.massnahmen });
    const ziel = propsZiel({ props: basis, massnahmen: e.massnahmen });
    const neu = kanteGeplant(e);
    const geaendert = !neu && ['cableType', 'crossSection', 'nParallel'].some(f => String(ist[f] ?? '') !== String(ziel[f] ?? ''));
    if (geaendert) { v.ertuechtigt = true; planJahre.push(...nuPlanJahre(e.massnahmen, massnahmeJahr, zj)); }
    if (neu && mitPlanung) planJahre.push(ganz(e.baujahr));
    // Systeme = modellierte Parallelkanten. nParallel taugt dafür nicht: bei MS-Einleiterkabeln
    // steht dort oft 3 (3×1×185 mm²) für EIN System.
    v.anzahl++;
    v.kabel.push({ typ: String(ziel.cableType || '').trim(), qs: zahl(ziel.crossSection) || null, geschaetzt: !!e.qsGeschaetzt && !geaendert });
    if (wahr(e.trennstelle)) v.trennstelle = true;
    v.laengeM += zahl(e.lengthM) || 0;
    if (!neu) v.geplant = false;
  }
  const verbListe = [...verbindungen.values()];
  const adj = new Map(stationsListe.map(s => [s.key, []]));
  for (const v of verbListe) {
    adj.get(v.a).push({ nb: v.b, v });
    adj.get(v.b).push({ nb: v.a, v });
  }

  // Sortierung: Bestand vor Planung, dann Gebäudeliste, dann Trafoname — wie die Trafo-Tabelle.
  const ordnung = (x, y) => ((x.geplant ? 1 : 0) - (y.geplant ? 1 : 0)) || (x.gebIdx - y.gebIdx)
    || String(x.trafos[0]?.name || '').localeCompare(String(y.trafos[0]?.name || ''), 'de', { numeric: true })
    || x.key.localeCompare(y.key);
  const nachOrdnung = keys => keys.sort((p, q) => ordnung(stationen.get(p), stationen.get(q)));

  const wurzelKeys = nachOrdnung(stationsListe.filter(s => s.hatNap).map(s => s.key));
  const wurzelSet = new Set(wurzelKeys);
  const zugeordnet = new Set(wurzelKeys);

  // Zusammenhangskomponente ohne Übergabestationen ab `start`
  const komponente = start => {
    const out = [start];
    const seen = new Set([start]);
    for (let i = 0; i < out.length; i++) {
      for (const { nb } of adj.get(out[i])) {
        if (seen.has(nb) || wurzelSet.has(nb)) continue;
        seen.add(nb);
        out.push(nb);
      }
    }
    return out;
  };

  // Weg zwischen zwei Stationen innerhalb einer Komponente (Breitensuche)
  const baumWeg = (von, bis, set) => {
    const vor = new Map([[von, null]]);
    const q = [von];
    while (q.length) {
      const k = q.shift();
      if (k === bis) break;
      for (const { nb } of adj.get(k)) {
        if (!set.has(nb) || vor.has(nb)) continue;
        vor.set(nb, k);
        q.push(nb);
      }
    }
    const weg = [];
    for (let k = bis; k != null; k = vor.get(k)) weg.unshift(k);
    return weg[0] === von ? weg : [von];
  };

  const abgangAus = (keys, wurzel) => {
    const set = new Set(keys);
    const innenV = verbListe.filter(v => set.has(v.a) && set.has(v.b));
    const grad = new Map(keys.map(k => [k, 0]));
    innenV.forEach(v => { grad.set(v.a, grad.get(v.a) + 1); grad.set(v.b, grad.get(v.b) + 1); });
    const wurzelV = wurzel ? verbListe.filter(v => (v.a === wurzel && set.has(v.b)) || (v.b === wurzel && set.has(v.a))) : [];
    const anWurzel = nachOrdnung([...new Set(wurzelV.map(v => (v.a === wurzel ? v.b : v.a)))]);
    const n = keys.length, m = innenV.length;
    const kette = m === n - 1 && [...grad.values()].every(g => g <= 2);
    const enden = n === 1 ? [keys[0], keys[0]] : keys.filter(k => grad.get(k) <= 1);

    // Ring = intern ein Baum mit genau zwei Anbindungen an die Übergabe: der Weg zwischen ihnen ist der
    // Ring, alles andere hängt als Stich (Abzweig) an einer Ringstation.
    let art = 'vermascht', start = anWurzel[0] ?? nachOrdnung([...keys])[0];
    let ringWeg = null;
    if (m === n - 1 && anWurzel.length === 2 && n > 1) {
      art = 'ring';
      ringWeg = baumWeg(anWurzel[0], anWurzel[1], set);
    } else if (kette && anWurzel.length <= 1 && enden.includes(start)) art = wurzel ? 'strahl' : 'kette';
    else if (m === n - 1 && anWurzel.length <= 1) art = 'verzweigt';

    // Zeichenfolge: beim Ring erst der Ringweg, dann die Abzweige; sonst Tiefensuche ab dem ersten an
    // der Übergabe hängenden Knoten. Nachbarn jeweils in Stationsordnung.
    const folge = [];
    const besucht = new Set(ringWeg || []);
    const tiefe = k => {
      besucht.add(k);
      folge.push(k);
      const nbs = nachOrdnung(adj.get(k).map(x => x.nb).filter(nb => set.has(nb) && !besucht.has(nb)));
      for (const nb of nbs) if (!besucht.has(nb)) tiefe(nb);
    };
    if (ringWeg) {
      folge.push(...ringWeg);
      for (const k of ringWeg) {
        for (const nb of nachOrdnung(adj.get(k).map(x => x.nb).filter(x => set.has(x) && !besucht.has(x)))) {
          if (!besucht.has(nb)) tiefe(nb);
        }
      }
    } else tiefe(start);
    for (const k of nachOrdnung([...keys])) if (!besucht.has(k)) tiefe(k);   // Sicherheitsnetz

    const idx = new Map(folge.map((k, i) => [k, i]));
    const innen = innenV.map(v => {
      const i = idx.get(v.a), j = idx.get(v.b);
      return { i: Math.min(i, j), j: Math.max(i, j), kante: v };
    }).sort((p, q) => (p.i - q.i) || (p.j - q.j));
    const wurzelAnb = wurzelV.map(v => ({ i: idx.get(v.a === wurzel ? v.b : v.a), kante: v })).sort((p, q) => p.i - q.i);
    const trennstelleErfasst = innenV.some(v => v.trennstelle) || wurzelV.some(v => v.trennstelle)
      || folge.some(k => stationen.get(k).trennstelle);
    return { art, folge, innen, wurzel: wurzelAnb, trennstelleErfasst, abzweige: ringWeg ? n - ringWeg.length : 0 };
  };

  const wurzeln = wurzelKeys.map(w => {
    const abgaenge = [];
    const nbs = nachOrdnung(adj.get(w).map(x => x.nb).filter(nb => !wurzelSet.has(nb)));
    for (const nb of nbs) {
      if (zugeordnet.has(nb)) continue;
      const keys = komponente(nb);
      keys.forEach(k => zugeordnet.add(k));
      abgaenge.push(abgangAus(keys, w));
    }
    const kopplungen = verbListe.filter(v => (v.a === w && wurzelSet.has(v.b)) || (v.b === w && wurzelSet.has(v.a)));
    return { key: w, abgaenge, kopplungen };
  });

  // Stationen ohne MS-Verbindung zu einer Übergabestation (Lücke im Modell oder eigener Anschluss)
  const ohneNap = [];
  for (const k of nachOrdnung(stationsListe.map(s => s.key))) {
    if (zugeordnet.has(k)) continue;
    const keys = komponente(k);
    keys.forEach(x => zugeordnet.add(x));
    ohneNap.push(abgangAus(keys, null));
  }

  // ── Hinweise auf Lücken im Modell ──
  const hinweise = [];
  if (!stationsListe.length) hinweise.push('Keine Mittelspannungsbetriebsmittel (NAP, Schaltanlage, Trafo) im Modell.');
  else if (!wurzelKeys.length) hinweise.push('Kein Netzanschlusspunkt (NAP) im Modell — die Übergabestation fehlt.');
  const ringeOhneTs = wurzeln.flatMap(w => w.abgaenge).filter(a => a.art === 'ring' && !a.trennstelleErfasst).length;
  if (ringeOhneTs) hinweise.push(`${ringeOhneTs === 1 ? 'Ein Ring' : ringeOhneTs + ' Ringe'} ohne erfasste offene Trennstelle.`);
  const ohneNapN = ohneNap.reduce((s, a) => s + a.folge.length, 0);
  if (ohneNapN && wurzelKeys.length) {
    hinweise.push(`${ohneNapN === 1 ? 'Eine Station' : ohneNapN + ' Stationen'} ohne MS-Verbindung zum Netzanschlusspunkt.`);
  }
  const trafosOhneKva = stationsListe.reduce((s, st) => s + st.trafos.filter(t => !(t.kva > 0)).length, 0);
  if (trafosOhneKva) hinweise.push(`${trafosOhneKva === 1 ? 'Ein Trafo' : trafosOhneKva + ' Trafos'} ohne Nennleistung.`);

  // ── Kennzahlen ──
  const trafos = stationsListe.flatMap(s => s.trafos);
  const kennzahlen = {
    stationen: stationsListe.filter(s => s.trafos.length).length,
    schaltstationen: stationsListe.filter(s => !s.trafos.length && !s.hatNap).length,
    trafos: trafos.length,
    kva: trafos.reduce((s, t) => s + (t.kva > 0 ? t.kva : 0), 0),
    ringe: wurzeln.reduce((s, w) => s + w.abgaenge.filter(a => a.art === 'ring').length, 0),
    abgaenge: wurzeln.reduce((s, w) => s + w.abgaenge.length, 0),
    msLaengeM: verbListe.reduce((s, v) => s + v.laengeM, 0),
    napKV: stationsListe.find(s => s.hatNap && s.napKV > 0)?.napKV ?? null,
    zieljahr: mitPlanung ? (Number.isFinite(zj) ? zj : Math.max(...planJahre.filter(Number.isFinite), -Infinity)) : null,
  };
  if (kennzahlen.zieljahr === -Infinity) kennzahlen.zieljahr = null;

  return { stationen: Object.fromEntries(stationen), verbindungen: verbListe, wurzeln, ohneNap, hinweise, kennzahlen };
}

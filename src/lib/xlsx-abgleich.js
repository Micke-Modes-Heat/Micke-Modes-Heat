// ── lib/xlsx-abgleich.js — Zellwerte des Excel-Vollexports lesen und abgleichen ──
// Reine Funktionen ohne DOM/App-Zustand (Export/Import selbst: 05a-export.js).
//
// Grundregel des Imports: Ein Wert wird nur übernommen, wenn die Zelle vom
// Stand vor dem Import abweicht. Ein unverändert wieder eingelesener Export
// ändert damit nichts — auch keine Merker wie autoSized oder waermeManual.

/** Leere Zelle (fehlt, null, nur Leerzeichen). */
export function istLeer(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Zahl aus einer Zelle; deutsche Dezimalkommas werden akzeptiert. Leer/ungültig → null. */
export function xNum(v) {
  if (istLeer(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  let s = String(v).trim().replace(/\s/g, '');
  // „1.234,5" → 1234.5 ; „1,5" → 1.5
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Ganzzahl (Jahre, Anzahlen). Leer/ungültig → null. */
export function xInt(v) {
  const n = xNum(v);
  return n == null ? null : Math.round(n);
}

/** Text, getrimmt. Leer → ''. */
export function xStr(v) {
  return istLeer(v) ? '' : String(v).trim();
}

const _JA   = new Set(['ja', 'j', 'true', 'wahr', '1', 'x', 'yes']);
const _NEIN = new Set(['nein', 'n', 'false', 'falsch', '0', 'no']);
/** Ja/Nein-Zelle → true/false; leer oder unlesbar → null. */
export function xBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = xStr(v).toLowerCase();
  if (_JA.has(s)) return true;
  if (_NEIN.has(s)) return false;
  return null;
}

/** Export-Darstellung eines Wahrheitswerts. */
export function janein(v) {
  return v === true ? 'ja' : v === false ? 'nein' : '';
}

/**
 * Spaltenindex über die Kopfzeile. Mehrere Namen = Aliase (ältere Exporte).
 * @param {any[]} header
 */
export function kopfIndex(header) {
  const m = new Map();
  (header || []).forEach((h, i) => {
    const k = xStr(h);
    if (k && !m.has(k)) m.set(k, i);
  });
  return {
    /** @param {...string} namen */
    hat: (...namen) => namen.some(n => m.has(n)),
    /** @param {any[]} row @param {...string} namen */
    zelle(row, ...namen) {
      for (const n of namen) if (m.has(n)) return row?.[m.get(n)];
      return undefined;
    },
  };
}

/**
 * Weicht eine Zahl von der Zelle ab? Verglichen wird auf die Nachkommastellen,
 * mit denen der Export schreibt — sonst gälte jeder gerundete Wert als „geändert".
 * Leer und null/'' gelten als gleich.
 */
export function zahlGeaendert(alt, neu, stellen = 6) {
  const a = xNum(alt), b = xNum(neu);
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  const f = Math.pow(10, stellen);
  return Math.round(a * f) !== Math.round(b * f);
}

/** Text verschieden? Leer und null gelten als gleich. */
export function textGeaendert(alt, neu) {
  return xStr(alt) !== xStr(neu);
}

/**
 * Auswahlwert lesen: Schlüssel oder Anzeigename, Groß-/Kleinschreibung egal.
 * @param {Record<string,string>} werte  Schlüssel → Anzeigename
 * @returns {string|null|undefined} Schlüssel; null = leer; undefined = unbekannt
 */
export function xAuswahl(v, werte) {
  const s = xStr(v);
  if (!s) return null;
  const lc = s.toLowerCase();
  for (const [k, l] of Object.entries(werte)) {
    if (k.toLowerCase() === lc || String(l).toLowerCase() === lc) return k;
  }
  return undefined;
}

// ── Typ-Props der Assets ─────────────────────────────────────────────────────

/**
 * Zellwert für eine Prop-Definition.
 * @param {{art?:string, werte?:Record<string,string>}} def
 */
export function propZuZelle(def, v) {
  if (v == null || v === '') return '';
  if (def.art === 'janein') return janein(!!v);
  if (def.art === 'auswahl' && def.werte) return def.werte[v] ?? v;
  return v;
}

/**
 * Zelle → Prop-Wert.
 * @returns {{ok:true, wert:any} | {ok:false, fehler:string}}
 *   wert null = Feld geleert (Inspektor speichert ebenfalls null)
 */
export function zelleZuProp(def, zelle) {
  if (istLeer(zelle)) return { ok: true, wert: null };
  switch (def.art) {
    case 'janein': {
      const b = xBool(zelle);
      return b == null ? { ok: false, fehler: `„${zelle}" ist kein ja/nein` } : { ok: true, wert: b };
    }
    case 'auswahl': {
      const k = xAuswahl(zelle, def.werte || {});
      return k === undefined
        ? { ok: false, fehler: `„${zelle}" ist nicht erlaubt (${Object.values(def.werte || {}).join(', ')})` }
        : { ok: true, wert: k };
    }
    case 'text':
      return { ok: true, wert: xStr(zelle) };
    default: {
      const n = xNum(zelle);
      return n == null ? { ok: false, fehler: `„${zelle}" ist keine Zahl` } : { ok: true, wert: n };
    }
  }
}

/** Prop-Wert verschieden? null/undefined/'' gelten als gleich. */
export function propGeaendert(def, alt, neu) {
  const leerA = alt == null || alt === '', leerB = neu == null || neu === '';
  if (leerA && leerB) return false;
  if (leerA !== leerB) return true;
  if (def.art === 'janein') return !!alt !== !!neu;
  if (def.art === 'text' || def.art === 'auswahl') return String(alt) !== String(neu);
  return zahlGeaendert(alt, neu);
}

// ── Ziel-Parameter einer Maßnahme ────────────────────────────────────────────

/**
 * newProps → „Leistung (kVA)=1000; UK (%)=6". Bekannte Schlüssel erscheinen mit
 * ihrem Anzeigenamen, unbekannte als Schlüssel.
 * @param {Record<string,any>|null|undefined} newProps
 * @param {{key:string,label:string}[]} defs
 */
export function zielParameterText(newProps, defs = []) {
  if (!newProps) return '';
  const label = new Map(defs.map(d => [d.key, d.label]));
  return Object.entries(newProps)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${label.get(k) || k}=${v}`)
    .join('; ');
}

/**
 * „Label=Wert; key=Wert" → newProps. Erlaubt sind Anzeigenamen und Schlüssel aus
 * `defs` sowie Schlüssel, die die Maßnahme schon hat.
 * @returns {{props:Record<string,any>, unbekannt:string[]}}
 */
export function zielParameterLesen(text, defs = [], vorhandeneKeys = []) {
  const props = {}, unbekannt = [];
  const s = xStr(text);
  if (!s) return { props, unbekannt };
  const nachLabel = new Map(defs.map(d => [d.label.toLowerCase(), d.key]));
  const keys = new Set([...defs.map(d => d.key), ...vorhandeneKeys]);
  for (const teil of s.split(';')) {
    const i = teil.indexOf('=');
    if (i < 0) { if (teil.trim()) unbekannt.push(teil.trim()); continue; }
    const name = teil.slice(0, i).trim(), roh = teil.slice(i + 1).trim();
    const key = nachLabel.get(name.toLowerCase()) ?? (keys.has(name) ? name : null);
    if (!key) { unbekannt.push(name); continue; }
    const n = xNum(roh);
    props[key] = n != null ? n : roh;
  }
  return { props, unbekannt };
}

/** Zwei newProps-Objekte inhaltlich gleich? */
export function zielParameterGleich(a, b) {
  const ea = Object.entries(a || {}).filter(([, v]) => v != null && v !== '');
  const eb = Object.entries(b || {}).filter(([, v]) => v != null && v !== '');
  if (ea.length !== eb.length) return false;
  const mb = new Map(eb);
  return ea.every(([k, v]) => mb.has(k) && String(mb.get(k)) === String(v));
}

// ── „Gilt für" (Geltungsbereich einer Maßnahme) ─────────────────────────────

export const GILT_ALLE = 'alle Varianten';

/**
 * Export-Text. m.variante: fehlt = Standardregel (leer), null = alle Varianten,
 * Schlüssel = nur diese Variante.
 * @param {(key:string)=>string} nameVon
 */
export function geltungText(m, nameVon) {
  if (!m || !('variante' in m) || m.variante === undefined) return '';
  if (m.variante === null) return GILT_ALLE;
  return nameVon(m.variante);
}

/**
 * Zelle → Geltung.
 * @param {{key:string,name:string}[]} varianten  inkl. Hauptplan (key 'base')
 * @returns {{aendern:false} | {aendern:true, wert:string|null} | {aendern:false, fehler:string}}
 *   leer = nicht ändern (die Standardregel bleibt bzw. der gespeicherte Wert)
 */
export function geltungLesen(zelle, varianten) {
  const s = xStr(zelle);
  if (!s) return { aendern: false };
  const lc = s.toLowerCase().replace(/^nur\s+/, '');
  if (lc === 'alle' || lc === GILT_ALLE.toLowerCase()) return { aendern: true, wert: null };
  const v = varianten.find(x => x.name.toLowerCase() === lc || String(x.key).toLowerCase() === lc);
  return v ? { aendern: true, wert: v.key } : { aendern: false, fehler: `Variante „${s}" unbekannt` };
}

// ── lib/vdi2067.js — Annuitätenmethode nach VDI 2067 Blatt 1 (DOM-frei) ──
// Betrachtungszeitraum T, Zins i, Preisänderungen je Kostengruppe:
//   kapitalgebunden  A_N,K = (A0 + Σ A_k − R_W) · a          Ersatzbeschaffungen A_k = A0 · r_K^(k·n) / q^(k·n)
//                                                            Restwert R_W = A0 · r_K^(m·n) · ((m+1)·n − T)/n / q^T
//   bedarfsgebunden  A_N,V = A_V1 · a · b_V                   (Energie, CO₂)
//   betriebsgebunden A_N,B = A_IN1 · a · b_IN + A_B1 · a · b_B (Instandsetzung/Wartung, Bedienen)
//   a = (q − 1) / (1 − q^−T),  b = (1 − (r/q)^T) / (q − r)  (r = q: b = T/q)
// Alle Funktionen sind in sich geschlossen (var, keine Importe): der Optimierer-Worker bettet sie per
// .toString() ein.

/** Annuitätsfaktor a für Zins (Bruchteil, z. B. 0,035) und T Jahre; Zins 0 → 1/T. */
export function vdiAnnuitaetsfaktor(zins, T) {
  var q = 1 + zins;
  if (!(T > 0)) return 0;
  return zins > 1e-9 ? (q - 1) / (1 - Math.pow(q, -T)) : 1 / T;
}

/** Preisdynamischer Faktor a·b: Jahr-1-Kosten mit Preisänderung r (Bruchteil) → annuitätische Kosten. */
export function vdiDynFaktor(zins, T, r) {
  var q = 1 + zins, rr = 1 + (r || 0);
  if (!(T > 0)) return 1;
  var b = Math.abs(rr - q) < 1e-12 ? T / q : (1 - Math.pow(rr / q, T)) / (q - rr);
  return vdiAnnuitaetsfaktor(zins, T) * b;
}

/**
 * Annuitätische Kosten eines Bauteils (Investition A0 €, vdi { n, inst, wart, bedien }) im Zeitraum T.
 * w: { zins (Bruchteil), T, rK, rIN, rB (Preisänderungen, Bruchteile), lohn (€/h) }.
 * Ergebnis: { kapital, instandhaltung, wartung, bedienung, gesamt, ersatzBarwert, restwertBarwert } in €/a bzw. €.
 */
export function vdiBausteinAnnuitaet(A0, vdi, w) {
  var zins = w.zins || 0, T = w.T > 0 ? w.T : 20, q = 1 + zins;
  var rK = 1 + (w.rK || 0);
  var a = vdiAnnuitaetsfaktor(zins, T);
  var n = vdi && vdi.n > 0 ? vdi.n : 0;
  var bedienung = (vdi && vdi.bedien || 0) * (w.lohn || 0) * vdiDynFaktor(zins, T, w.rB);
  if (!(A0 > 0) || !n) {
    return { kapital: 0, instandhaltung: 0, wartung: 0, bedienung: bedienung, gesamt: bedienung, ersatzBarwert: 0, restwertBarwert: 0 };
  }
  // Ersatzbeschaffungen in den Jahren n, 2n, … < T
  var ersatz = 0, m = 0;
  for (var k = 1; k * n < T - 1e-9; k++) { ersatz += A0 * Math.pow(rK, k * n) / Math.pow(q, k * n); m = k; }
  // Restwert der zuletzt beschafften Anlage (Jahr m·n) am Ende des Zeitraums, linear
  var rest = A0 * Math.pow(rK, m * n) * Math.max(0, (m + 1) * n - T) / n / Math.pow(q, T);
  var kapital = (A0 + ersatz - rest) * a;
  var dynIN = vdiDynFaktor(zins, T, w.rIN);
  var instandhaltung = A0 * (vdi.inst || 0) / 100 * dynIN;
  var wartung = A0 * (vdi.wart || 0) / 100 * dynIN;
  return { kapital: kapital, instandhaltung: instandhaltung, wartung: wartung, bedienung: bedienung,
    gesamt: kapital + instandhaltung + wartung + bedienung, ersatzBarwert: ersatz, restwertBarwert: rest };
}

/**
 * KWK-Zuschlag nach KWKG annuitätisch: gefördert werden höchstens 3.500 Vollbenutzungsstunden je Jahr und
 * 30.000 Vollbenutzungsstunden insgesamt. Faktor auf den Zuschlag eines vollen Jahres (alle Stunden gefördert).
 * vbhJahr: Vollbenutzungsstunden des BHKW, zins (Bruchteil), T Betrachtungszeitraum.
 */
export function vdiKwkZuschlagFaktor(vbhJahr, zins, T) {
  var vbh = Number(vbhJahr) || 0;
  if (!(vbh > 0) || !(T > 0)) return 0;
  var anteil = Math.min(1, 3500 / vbh);
  var jahre = 30000 / Math.min(vbh, 3500);
  var q = 1 + zins, bw = 0;
  for (var y = 1; y <= T; y++) bw += Math.min(1, Math.max(0, jahre - (y - 1))) / Math.pow(q, y);
  return anteil * bw * vdiAnnuitaetsfaktor(zins, T);
}

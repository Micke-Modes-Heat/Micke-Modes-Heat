// ── lib/euro-format.js — Geldbeträge gut lesbar: unter 1 Mio. in k€, ab 1 Mio. in Mio. € ──

/** eur → { zahl, einheit } in deutscher Schreibweise, z. B. 7.765.000 → { zahl: '7,77', einheit: 'Mio. €' }. */
export function euroTeile(eur, proJahr = false) {
  const v = Number(eur) || 0;
  const a = Math.abs(v);
  const nf = (x, d) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const suffix = proJahr ? '/a' : '';
  if (a >= 999500) return { zahl: nf(v / 1e6, a >= 99.95e6 ? 0 : a >= 9.995e6 ? 1 : 2), einheit: 'Mio. €' + suffix };
  return { zahl: nf(v / 1000, a > 0 && a < 9950 ? 1 : 0), einheit: 'k€' + suffix };
}

/** Als Text: '7,77 Mio. €' bzw. '940 k€/a'. */
export function euroKompakt(eur, proJahr = false) {
  const t = euroTeile(eur, proJahr);
  return `${t.zahl} ${t.einheit}`;
}

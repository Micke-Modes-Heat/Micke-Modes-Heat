// ── lib/spitzenkessel.js — Art des automatischen Spitzenlastkessels (DOM-frei) ──
// Der automatische Spitzenlastkessel ('_autoGk') deckt die Restlast der Einsatzplanung und die im Auslegungsfall
// fehlende Leistung. Seine Art bestimmt Investition, Bedienaufwand, Energieträger (Preis, Wirkungsgrad, CO₂,
// Primärenergie) und ob er Feuerungsanlage (Schornstein) bzw. fossil ist. Standard: Erdgas.
// Die Schlüssel `key` verweisen auf den gleichartigen Erzeuger in ERZEUGER_CFG (Preise, Wirkungsgrade, Faktoren).

export const SPITZENKESSEL_ARTEN = Object.freeze({
  gas: Object.freeze({ art: 'gas', key: 'gaskessel', traeger: 'Erdgas', bedien: 'gk_auto', ce: 'Gaskessel',
    label: 'Gaskessel', name: 'Spitzenlast-Gaskessel', verbrennung: true, fossil: true, strom: false }),
  heizoel: Object.freeze({ art: 'heizoel', key: 'heizoel', traeger: 'Heizoel', bedien: 'hko', ce: 'Heizoel',
    label: 'Heizölkessel', name: 'Spitzenlast-Ölkessel', verbrennung: true, fossil: true, strom: false }),
  strom: Object.freeze({ art: 'strom', key: 'stromkessel', traeger: 'Strom', bedien: 'sk', ce: 'Stromkessel',
    label: 'Stromkessel', name: 'Spitzenlast-Stromkessel', verbrennung: false, fossil: false, strom: true }),
});

/** Art des Spitzenlastkessels; unbekannt oder leer → Erdgas. */
export function spitzenkesselSpec(art) {
  return SPITZENKESSEL_ARTEN[art] || SPITZENKESSEL_ARTEN.gas;
}

/** Erzeugerschlüssel für Preise, Wirkungsgrade und Faktoren: '_autoGk' → gleichartiger Erzeuger, sonst unverändert. */
export function erzeugerSchluessel(key, art) {
  return key === '_autoGk' ? spitzenkesselSpec(art).key : key;
}

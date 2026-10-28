// ── lib/elektro-checkliste.js — Inhalt und Logik der Elektro-Checkliste ──
// DOM-frei (Vitest). Die Oberfläche ist das Begleitfenster in 54-checkliste-fenster.js.
//
// Jede Aufgabe trägt `orte`: Marken der Stelle im Tool, an der sie erledigt wird. Das Fenster
// ermittelt laufend die Marken der aktuellen Stelle (ecOrtMarken) und zeigt die passenden
// Aufgaben oben an. Marken:
//   s:<schritt>      Arbeitsschritt (projekt, bestand, planung, auswertung, gutachten)
//   el:<reiter>      Planung › Strom › Reiter (netz, pv, erzeugung, berechnen, pruefen)
//   w:<reiter>       Planung › Wärme › Reiter (netz, erzeuger)
//   b:tabelle        Bestand als Tabelle
//   a:<abschnitt>    Seite in Auswertung/Gutachten (Schlüssel aus _ABSCHNITTE in 49)
//   p:<element-id>   offenes Fenster (.float-panel u. a.)
//   x:<asset-typ>    im Inspektor ausgewähltes Asset
//
// Gespeichert wird im Projekt unter `elektroCheckliste` (je Liegenschaft):
//   { v: 1, punkte: { <id>: { s: Status, n: Notiz, t: Zeitstempel } } }
// Die ids nie ändern — daran hängen Status und Notiz.

export const EC_STATUS = [
  { id: 'offen',     titel: 'Offen' },
  { id: 'arbeit',    titel: 'In Arbeit' },
  { id: 'klaeren',   titel: 'Klären' },
  { id: 'erledigt',  titel: 'Erledigt' },
  { id: 'entfaellt', titel: 'Entfällt' },
];
const _STATUS_IDS = new Set(EC_STATUS.map(s => s.id));

/**
 * @typedef {{ id: string, t: string, wo: string, ok: string, kap?: string, opt?: boolean, ext?: boolean, orte?: string[], phase?: string }} EcPunkt
 * @typedef {{ v: number, punkte: Record<string, { s: string, n: string, t?: number, a?: string }> }} EcStand
 */
/** @returns {EcPunkt} */
const P = (/** @type {string} */ id, /** @type {string} */ t, /** @type {string} */ wo, /** @type {string} */ ok, /** @type {Partial<EcPunkt>} */ extra = {}) => ({ id, t, wo, ok, ...extra });

export const EC_PHASEN = [
  { id: 'unterlagen', titel: 'Unterlagen und Erhebung', kap: '—', punkte: [
    P('u-plan', 'Bestands-Einlinienplan MS/NS anfordern', '', 'Plan als PDF oder Bild liegt vor, Stand bekannt', { ext: true, orte: ['p:plandigi-panel'] }),
    P('u-lastgang', 'Lastgänge am Netzanschluss anfordern (15-min, möglichst 2–3 Jahre)', '', 'Bezug als CSV/Excel je Jahr vorhanden', { ext: true, orte: ['p:strom-panel'] }),
    P('u-bhkw', 'Erzeugungsdaten bestehender Anlagen anfordern (BHKW, PV)', '', 'Erzeugungslastgang oder Jahresmengen vorhanden', { ext: true, opt: true, orte: ['p:strom-panel'] }),
    P('u-vertrag', 'Netzanschlussvertrag klären: vereinbarte Leistung, Einspeiselimit, Spannungsebene', '', 'Werte schriftlich vom Betreiber oder Netzbetreiber', { ext: true, orte: ['x:NAP', 'a:netzanschluss'] }),
    P('u-stationen', 'Stationsdaten erheben: Trafo-Typenschild, Baujahr, Schaltanlage, Reserven', '', 'Je Station Leistung, Baujahr, Zustand bekannt', { ext: true, orte: ['x:Trafo', 'p:stations-steckbrief'] }),
    P('u-nea', 'Notstromaggregate und USV im Bestand erheben', '', 'Standort, Leistung, versorgte Gebäude bekannt', { ext: true, orte: ['x:Nsa'] }),
    P('u-entwicklung', 'Bauliche Entwicklung abfragen: Neubau, Rückbau, Nutzungsänderung', '', 'Liste mit Gebäude, Jahr, Fläche bzw. Leistung', { ext: true, orte: ['b:tabelle'] }),
    P('u-lade', 'Bedarf an Ladeinfrastruktur abfragen (Fahrzeuge, Ladepunkte, Zeitplan)', '', 'Anzahl Ladepunkte und Leistung je Standort', { ext: true, orte: ['x:Lade'] }),
    P('u-begehung', 'Ortsbegehung der Stationen und Verteilungen (Feld-App)', 'Feld-App auf dem Handy, danach Hilfe › Felddaten auswerten', 'Fotos und Notizen je Station erfasst', { opt: true, orte: ['p:feldapp-panel'] }),
  ]},
  { id: 'grundlagen', titel: 'Projekt und Gebäude', kap: '1.2', punkte: [
    P('g-name', 'Name der Liegenschaft und WE-Nummer eintragen', 'Projekt › Projektdaten', 'Beide Felder gefüllt', { kap: 'Deckblatt', orte: ['s:projekt'] }),
    P('g-plangebiet', 'Plangebiet zeichnen und Gebäude aus OSM laden', 'Bestand › Karte', 'Alle Gebäude der Liegenschaft auf der Karte', { orte: ['s:bestand'] }),
    P('g-ladestatus', 'Ladeübersicht prüfen (Gebäude, Straßen, Bäume, LoD2 …)', 'Ladeübersicht Plangebiet', 'Keine Importschritte mit Fehler', { orte: ['p:lade-status-panel'] }),
    P('g-benennen', 'Gebäude benennen und Nutzung prüfen', 'Bestand › Tabelle', 'Kein Gebäude ohne Namen', { orte: ['b:tabelle', 's:bestand'] }),
    P('g-grundriss', 'Grundrisse auf Überlappungen prüfen', 'Bestand › Grundrisse prüfen', 'Keine doppelten Gebäude mehr', { opt: true, orte: ['p:grundriss-panel'] }),
    P('g-excel', 'Vorhandene Excel-Daten abgleichen (Vollimport mit Vorschau)', 'Projekt › Excel-Import', 'Abgleich übernommen, Konflikte entschieden', { opt: true, orte: ['s:projekt'] }),
    P('g-qualitaet', 'Datenqualität prüfen', 'Projekt › Datenqualität', 'Keine roten Feldmarkierungen offen', { orte: ['s:projekt'] }),
  ]},
  { id: 'verbrauch', titel: 'Stromverbrauch und Messdaten', kap: '5.2', punkte: [
    P('v-messjahre', 'Messjahre laden (Bezug, ggf. BHKW-Erzeugung)', 'Planung › Strom › Strom-Grundlagen', 'Alle Jahre ohne Lücken eingelesen', { kap: '5.2', orte: ['p:strom-panel'] }),
    P('v-referenz', 'Referenzjahr von Hand wählen', 'Planung › Strom › Strom-Grundlagen', 'Referenzjahr gesetzt', { kap: '5.2', orte: ['p:strom-panel'] }),
    P('v-autofill', 'Stromverbrauch der Gebäude ermitteln', 'Planung › Strom › Verbrauch', 'Jedes Gebäude hat einen Verbrauchswert', { kap: '5.2', orte: ['el:verbrauch'] }),
    P('v-profile', 'Lastprofile der Gebäude prüfen (BW0–BW3, Sonderprofile)', 'Gebäude-Inspektor / Lastprofil-Editor', 'Profil passt zur Nutzung jedes Gebäudes', { orte: ['p:slp-editor-overlay', 'p:geb-profile-dialog', 'x:Verbraucher'] }),
    P('v-abgleich', 'Summe der Gebäude mit dem gemessenen Jahr abgleichen', 'Auswertung › Strom › Strombilanz', 'Abweichung erklärt oder unter ca. 10 %', { kap: '5.2', orte: ['a:strom', 'p:strom-panel'] }),
    P('v-jahresvergleich', 'Jahresvergleich der Messjahre auf Ausreißer prüfen', 'Planung › Strom › Strom-Grundlagen', 'Ausreißerjahr begründet oder verworfen', { kap: '5.2', opt: true, orte: ['p:strom-panel'] }),
  ]},
  { id: 'netz', titel: 'Bestandsnetz erfassen', kap: '5.1.2', punkte: [
    P('n-trassen', 'Trassen anlegen (Straßen aus OSM übernehmen oder zeichnen)', 'Planung › Strom › Netz › 1 · Trassen', 'Kabelwege folgen realen Trassen', { orte: ['el:netz'] }),
    P('n-digital', 'Bestandsplan einblenden und mit Passpunkten ausrichten', 'Planung › Strom › Netz › Bestandsplan digitalisieren', 'Plan deckt sich mit der Karte (formtreu)', { orte: ['p:plandigi-panel', 'el:netz'] }),
    P('n-nap', 'Netzanschlusspunkt und Übergabestation setzen', 'Planung › Strom › Netz › 2 · Komponenten', 'NAP sitzt am realen Übergabepunkt', { kap: '5.1.1', orte: ['el:netz', 'x:NAP', 'x:Schaltanlage'] }),
    P('n-stationen', 'Trafostationen setzen (Standardgebäude) und Trafos eintragen', 'Planung › Strom › Netz › Standardgebäude platzieren', 'Jede Station mit Trafo-Leistung und Baujahr', { kap: '5.1.2', orte: ['el:netz', 'x:Trafo'] }),
    P('n-betriebsart', 'Betriebsart bei mehreren Trafos festlegen (N-1 oder Parallelbetrieb)', 'Inspektor › Trafo', 'Gruppe und Betriebsart gesetzt', { opt: true, orte: ['x:Trafo'] }),
    P('n-verteiler', 'NSHV, Unterverteilungen und Kabelverteilerschränke setzen', 'Planung › Strom › Netz › 2 · Komponenten', 'Alle Verteilpunkte aus dem Plan vorhanden', { orte: ['el:netz', 'x:NSHV', 'x:UV', 'x:KVS'] }),
    P('n-kabel', 'Kabel ziehen und neu ausrichten', 'Planung › Strom › Netz › 3 · Kabel', 'Jedes Gebäude ist angeschlossen', { orte: ['el:netz'] }),
    P('n-kabeldaten', 'Kabeltyp, Querschnitt, Baujahr und MS-Spannung je Kabel pflegen', 'Inspektor › Kabel', 'Keine Kabel mit Standardwerten aus Versehen', { orte: ['el:netz'] }),
    P('n-steckbrief', 'Stations-Steckbriefe ausfüllen', 'Inspektor › Station › Steckbrief', 'Je Station ein vollständiges Blatt', { kap: 'Anlage', orte: ['p:stations-steckbrief', 'x:Trafo', 'x:NSHV'] }),
    P('n-pruefen', 'Bestand prüfen: Längen, Querschnitte, Topologie, Lebenszyklus', 'Planung › Strom › Prüfen › Bestand prüfen', 'Keine Fehler, Topologie erfüllt', { kap: '5.1.2', orte: ['p:bestand-panel'] }),
    P('n-sld', 'Einlinienschema gegen den Bestandsplan lesen', 'Planung › Strom › Prüfen › Einlinienschema', 'Schaltbild entspricht dem Plan', { orte: ['p:sld-panel'] }),
  ]},
  { id: 'anschluss', titel: 'Netzanschluss und Grenzen', kap: '5.1.1', punkte: [
    P('a-grenzen', 'Max. Bezug und Einspeiselimit am NAP hinterlegen', 'Inspektor › NAP', 'NAP, max. Bezug und Einspeiselimit hinterlegt', { kap: '5.1.1', orte: ['x:NAP'] }),
    P('a-lastgang', 'Netzanschluss-Lastgang auswerten (Spitze, Dauerlinie, GZF)', 'Auswertung › Strom › Netzanschluss-Lastgang', 'Jahreshöchstlast und Auslastung des Anschlusses bekannt', { kap: '5.1.1', orte: ['a:nap'] }),
    P('a-modul', 'Netzanschluss-Modul: Bedarf je Jahr gegen vereinbarte Leistung', 'Auswertung › Strom › Netzanschluss', 'Ergebnis „reicht“ oder Jahr der Überschreitung bekannt', { kap: '5.1.1', orte: ['a:netzanschluss'] }),
    P('a-uw', 'Anschlussebene und Wege zum Umspannwerk prüfen (UW aus OSM, n-1)', 'Auswertung › Strom › Netzanschluss › Optionen', 'Mindestens eine tragfähige Option benannt', { kap: '5.4.1', opt: true, orte: ['a:netzanschluss'] }),
  ]},
  { id: 'ist', titel: 'Ist-Zustand Erzeugung und Notstrom', kap: '5.1.3–5.1.4', punkte: [
    P('i-erzeugung', 'Bestehende Erzeugung erfassen (BHKW, PV-Bestand, Batterie)', 'Planung › Strom › Erzeugung › Anlagen setzen', 'Alle Bestandsanlagen mit Leistung und Baujahr', { kap: '5.1.3', orte: ['el:erzeugung', 'x:KWK', 'x:PV', 'x:Batterie'] }),
    P('i-kopplung', 'Kopplung mit der Wärmeplanung prüfen (WP, BHKW, Stromkessel)', 'Planung › Strom › Erzeugung › Aus der Wärmeplanung', 'Status-Chips zeigen die richtigen Anlagen', { orte: ['el:erzeugung'] }),
    P('i-nea', 'Bestehende Netzersatzanlagen erfassen', 'Planung › Strom › Erzeugung › Anlagen setzen', 'NEA mit Leistung und versorgten Gebäuden', { kap: '5.1.4', orte: ['el:erzeugung', 'x:Nsa'] }),
    P('i-rechnen', 'Ist-Netz rechnen (Schicht Bestand)', 'Planung › Strom › Berechnen', 'Auslastung und Spannungsfall im Bestand bekannt', { kap: '5.1.2', orte: ['el:berechnen'] }),
    P('i-trafo', 'Trafo-Auslastung im Bestand ansehen', 'Karte (Hover, Füllstand am Trafo)', 'Kein Trafo über 100 %, Reserven notiert', { kap: '5.1.2', orte: ['el:berechnen', 'x:Trafo'] }),
  ]},
  { id: 'prognose', titel: 'Bedarfsprognose Strom (Soll)', kap: '5.3', punkte: [
    P('p-bestand', 'Bauliche Entwicklung einpflegen (Neubau, Rückbau, Jahr)', 'Bestand › Gebäude-Inspektor', 'Jedes betroffene Gebäude mit Jahr und Zustand', { kap: '5.3.1', orte: ['b:tabelle', 's:bestand'] }),
    P('p-waerme', 'Zusatzbedarf aus dem Wärmekonzept übernehmen', 'Planung › Wärme › Erzeugung und Speicher', 'WP- und Stromkessel-Last in der Strombilanz sichtbar', { kap: '5.3.2', orte: ['w:erzeuger'] }),
    P('p-lade', 'Ladeinfrastruktur planen (Ladepark, Ladepunkte, Leistung)', 'Planung › Strom › Netz › Standardgebäude › Ladepark', 'Ladepunkte mit Jahr der Inbetriebnahme', { kap: '5.3.3', orte: ['x:Lade'] }),
    P('p-ergebnis', 'Resultierende Anschlussleistung prüfen (Wasserfall + Tabelle)', 'Gutachten › Grafiken › Bedarfsprognose', 'Zahl stimmt mit der NAP-Analyse überein', { kap: '5.3.4', orte: ['a:ggrafik', 'a:nap'] }),
  ]},
  { id: 'varianten', titel: 'Varianten bilden', kap: '5.4', punkte: [
    P('w-anlegen', 'Varianten anlegen (Hauptplan + Alternativen)', 'Varianten-Leiste', 'Jede Variante hat einen sprechenden Namen', { kap: '5.4', orte: ['p:var-menu'] }),
    P('w-massnahmen', 'Maßnahmen je Variante in die Entscheidungsschicht legen', 'Planung › Strom (Schicht Entscheidung)', 'Geplante Objekte in jeder Variante', { kap: '5.4.1', orte: ['el:netz', 'p:var-menu'] }),
    P('w-dachdaten', 'PV · Stufe 1 Dachdaten (LoD2 laden oder Dach aus Grundriss)', 'Planung › Strom › Photovoltaik › 1 Dachdaten', 'Dachflächen mit Neigung und Azimut', { kap: '5.4.2', orte: ['el:pv'] }),
    P('w-baeume', 'Bäume und Verschattung berücksichtigen', 'Bäume (OSM / von Hand)', 'Verschattungsfaktor je Dachfläche gerechnet', { opt: true, orte: ['p:baum-panel'] }),
    P('w-regeln', 'PV · Stufe 2 Belegungsregeln festlegen (Rand, Lage, Mindestmodule)', 'Planung › Strom › Photovoltaik › 2 Regeln', 'Regeln passen zu den Dächern der Liegenschaft', { orte: ['el:pv'] }),
    P('w-belegen', 'PV · Stufe 3 Dächer belegen (automatisch, netzverträglich)', 'Planung › Strom › Photovoltaik › 3 Belegen', 'Belegung je Variante plausibel', { kap: '5.4.2', orte: ['el:pv'] }),
    P('w-ff', 'Freiflächen-PV zeichnen', 'Planung › Strom › Photovoltaik › 3 Belegen › Freifläche', 'Fläche mit kWp und Ertrag', { opt: true, orte: ['el:pv'] }),
    P('w-staende', 'PV · Stufe 4 Belegungsstände speichern (Potenzial, Auslegungen)', 'Planung › Strom › Photovoltaik › 4 Stände', 'Je Variante ein benannter Stand aktiv', { orte: ['el:pv'] }),
    P('w-pvpruefen', 'PV · Stufe 5 Anlagen abgleichen und PV-Pflicht prüfen', 'Planung › Strom › Photovoltaik › 5 Prüfen', 'Keine verwaisten PV-Assets, PV-Pflicht bewertet', { kap: '5.4.2', orte: ['el:pv'] }),
    P('w-pva', 'PV-Analyse: Zielausbau und Ausbaupfad', 'Auswertung › Strom › Photovoltaik', 'Zielausbau-Lastgang und Ausbaupfad festgelegt', { kap: '5.4.2', orte: ['a:pva'] }),
    P('w-netzaufnahme', 'Netzaufnahme im Bestand und Ausbautreppe €/kWp', 'Auswertung › Strom › Photovoltaik › Netzaufnahme (Bestand)', 'PV-Menge ohne Ertüchtigung bekannt', { kap: '5.4.2', orte: ['a:pva'] }),
    P('w-netzstrategie', 'Netzstrategie: Anschlusswege je Flächengruppe', 'Auswertung › Strom › Photovoltaik › Netzstrategie', 'Empfohlener Anschlussweg je Gruppe', { opt: true, orte: ['a:pva'] }),
    P('w-speicher', 'Batteriespeicher setzen und dimensionieren', 'Planung › Strom › Erzeugung › Anlagen setzen', 'Kapazität und Leistung begründet', { kap: '5.4.2', orte: ['el:erzeugung', 'x:Batterie'] }),
    P('w-wind', 'Windanalyse (Ertrag, Abstände, Eignungsfläche)', 'Planung › Strom › Erzeugung › Windanalyse', 'Szenario bewertet oder bewusst verworfen', { opt: true, orte: ['p:windanalyse-panel', 'x:Wind'] }),
    P('w-autarkie', 'Autarkieziel mit H₂ rechnen', 'Auswertung › Strom › Photovoltaik › Autarkieziel', 'Nur wenn der Auftraggeber Autarkie fordert', { opt: true, orte: ['a:pva'] }),
    P('w-trafo', 'Neue Trafostandorte oder Ertüchtigung planen', 'Planung › Strom › Prüfen › Netzanalyse › Trafo', 'Entlastung und Kapazität je Vorschlag bekannt', { kap: '5.4.1', orte: ['p:netzanalyse-panel', 'x:Trafo'] }),
    P('w-nea', 'Notstrom und Lastmanagement je Variante festlegen', 'Planung › Strom › Prüfen › Blackout-Modus', 'NEA-Leistung und abwerfbare Lasten benannt', { kap: '5.4.3', orte: ['p:blackout-modus-panel'] }),
    P('w-lade', 'Ladeinfrastruktur je Variante (gesteuert / ungesteuert)', 'Planung › Strom › Netz', 'Ladeleistung in jeder Variante berücksichtigt', { kap: '5.4.4', orte: ['x:Lade'] }),
  ]},
  { id: 'rechnen', titel: 'Berechnen und Prüfen', kap: '5.4', punkte: [
    P('r-annahmen', 'Berechnungsannahmen prüfen (cos φ, Leitertemperatur, Gleichzeitigkeit, Verlegeart, Häufung)', 'Planung › Strom › Berechnen › Berechnungsannahmen', 'Werte bewusst gesetzt, nicht nur Vorgabe', { orte: ['el:berechnen'] }),
    P('r-kosten', 'Kostenkennwerte prüfen (Tiefbau, Trafo, PV, Batterie …)', 'Planung › Strom › Berechnen › Kostenkennwerte', 'Kennwerte mit aktuellem Preisstand', { kap: '5.5', orte: ['el:berechnen'] }),
    P('r-rechnen', 'Elektroberechnung je Variante starten', 'Planung › Strom › Berechnen › Elektroberechnung starten', 'Status „berechnet“, nicht „veraltet“', { orte: ['el:berechnen'] }),
    P('r-karte', 'Karte nach Auslastung und Spannungsfall einfärben', 'Planung › Strom › Berechnen › Karte einfärben nach', 'Keine roten Kabel ohne Maßnahme', { orte: ['el:berechnen'] }),
    P('r-netzanalyse', 'Netzanalyse: Schwachstellen durchgehen', 'Planung › Strom › Prüfen › Netzanalyse', 'Jede Schwachstelle hat eine Maßnahme oder Begründung', { kap: '5.4.1', orte: ['p:netzanalyse-panel', 'el:pruefen'] }),
    P('r-kna', 'Knotenpunkt-Analyse', 'Auswertung › Strom › Knotenpunkt-Analyse', 'Kritische Knoten benannt', { opt: true, orte: ['a:kna', 'p:kna-right-panel'] }),
    P('r-engpass', 'Engpass-Fahrplan: wann wird was zum Engpass', 'Planung › Strom › Prüfen › Engpass-Fahrplan', 'Ertüchtigungen mit Jahr abgeleitet', { kap: '5.4.1', orte: ['p:engpass-panel', 'el:pruefen'] }),
    P('r-schwelle', 'Schwellentreppe: trägt das Bestandsnetz die Erzeugung?', 'Planung › Strom › Prüfen › Schwellentreppe', 'Ergebnis je Variante notiert', { kap: '5.4.2', orte: ['p:schwellen-panel'] }),
    P('r-ergebnisblatt', 'Ergebnisblatt Elektro durchsehen', 'Auswertung › Strom › Ergebnisblatt Elektro', 'Ergebnis, Last, Netz je Station plausibel', { orte: ['a:ergebnisblatt', 'a:f:ergebnisblatt', 'p:el-ergebnisblatt'] }),
    P('r-bilanz', 'Strombilanz je Variante prüfen', 'Auswertung › Strom › Strombilanz', 'Bezug, Einspeisung, Eigenverbrauch plausibel', { orte: ['a:strom'] }),
  ]},
  { id: 'bewertung', titel: 'Wirtschaftlichkeit, Bewertung, Empfehlung', kap: '5.5–5.7', punkte: [
    P('b-vergleich', 'Varianten nebeneinanderlegen', 'Auswertung › Übergreifend › Variantenvergleich', 'Kennzahlen aller Varianten vorhanden', { kap: '5.4', orte: ['a:v:vergleich'] }),
    P('b-wirtschaft', 'Investition und Annuität je Variante', 'Auswertung › Übergreifend › Wirtschaftlichkeit', 'Kosten je Variante mit Quelle der Kennwerte', { kap: '5.5', orte: ['a:wirtschaft'] }),
    P('b-matrix', 'Bewertungsmatrix ausfüllen', 'Gutachten › Kapitel 5.6', 'Kriterien gewichtet, Punkte begründet', { kap: '5.6', orte: ['s:gutachten'] }),
    P('b-empfehlung', 'Empfehlung festlegen und als ★ Gutachten-Variante markieren', 'Varianten-Leiste › ★', 'Genau eine Variante markiert', { kap: '5.7', orte: ['p:var-menu', 'a:v:vergleich'] }),
    P('b-fahrplan', 'Maßnahmen und Fahrplan prüfen (Netzumbau im Fahrplan!)', 'Auswertung › Übergreifend › Maßnahmen und Fahrplan', 'Netzertüchtigungen stehen mit Jahr im Fahrplan', { kap: '9.2', orte: ['a:ausbauplaner'] }),
    P('b-invest', 'Investitionsplan erzeugen', 'Gutachten › Anlagen und Blätter › Investitionsplan', 'Summen decken sich mit der Wirtschaftlichkeit', { kap: '5.5', orte: ['a:f:steckbriefe'] }),
  ]},
  { id: 'resilienz', titel: 'Resilienz und Notstrom', kap: '8', punkte: [
    P('s-abfrage', 'Resilienz-Abfrage erzeugen und an die zuständige Stelle schicken', 'Planung › Strom › Prüfen › Resilienz-Abfrage', 'Fragebogen verschickt', { kap: '8.1', orte: ['p:resilienz-abfrage-panel'] }),
    P('s-einlesen', 'Ausgefüllte Abfrage einlesen', 'Planung › Strom › Prüfen › Resilienz-Abfrage', 'Anforderungen je Gebäude übernommen', { kap: '8.2.1', orte: ['p:resilienz-abfrage-panel'] }),
    P('s-klassen', 'Notstromklassen A/B/C je Gebäude festlegen', 'Planung › Strom › Prüfen › Blackout-Modus', 'Jedes Gebäude hat eine Klasse', { kap: '8.2.1', orte: ['p:blackout-modus-panel'] }),
    P('s-sz1', 'Szenario 1: Versorgung der kritischen Gebäude', 'Blackout-Modus', 'NEA-Leistung für Klasse A bilanziert', { kap: '8.2.2', orte: ['p:blackout-modus-panel'] }),
    P('s-sz2', 'Szenario 2: Versorgung je Trafostation (stationär + mobil)', 'Blackout-Modus', 'Je Station NEA an der NSHV bemessen', { kap: '8.2.3', orte: ['p:blackout-modus-panel'] }),
    P('s-sz3', 'Szenario 3: Gesamtliegenschaft als Insel am NAP', 'Blackout-Modus › Liegenschaft', 'Inselleistung inkl. Wärme bilanziert', { kap: '8.2.4', orte: ['p:blackout-modus-panel'] }),
    P('s-gegen', 'Szenarien gegenüberstellen, allgemeine Empfehlungen (Einspeisepunkte)', 'Gutachten › Kapitel 8.2', 'Kurz- und langfristige Maßnahmen benannt', { kap: '8.2.5–8.2.8', orte: ['s:gutachten'] }),
  ]},
  { id: 'ga', titel: 'Gebäudeautomation und EMS', kap: '6', punkte: [
    P('ga-ziele', 'Zielrangfolge und Betriebszustände des EMS festlegen', 'Gutachten › Kapitel 6 (Text von Hand)', 'Zielrangfolge, Überschuss- und Spitzenkaskade beschrieben', { kap: '6', opt: true, orte: ['s:gutachten'] }),
    P('ga-eza', 'EZA-Regler / Anlagenzertifikat klären (Schwellen nach NELEV)', 'Gutachten › Kapitel 6', 'Aussage, ob Zertifikat nötig ist', { kap: '6', opt: true, orte: ['s:gutachten'] }),
  ]},
  { id: 'gutachten', titel: 'Gutachten zusammenstellen', kap: '5 · 8 · 9.2', punkte: [
    P('z-editor', 'Kapitel 5 im Gutachten-Editor füllen (Bausteine übernehmen)', 'Gutachten › Gutachten', 'Kein Unterkapitel leer', { kap: '5.1–5.7', orte: ['s:gutachten'] }),
    P('z-grafiken', 'Gutachten-Grafiken erzeugen (Übersichtsschaltbild MS-Netz, Wasserfall, Lastgang …)', 'Gutachten › Gutachten-Grafiken', 'Stationsnamen nach Regel, alle Abbildungen aktuell', { kap: '5.1.2 · 5.3', orte: ['a:ggrafik'] }),
    P('z-bilder', 'Liegenschaftsbilder (Lageplan, Kartenausschnitt)', 'Gutachten › Liegenschaftsbilder', 'Lageplan im Dokument', { kap: '1.2', orte: ['a:liegenschaftsbilder'] }),
    P('z-anlagen', 'Stations-Steckbriefe als Anlagen anhängen', 'Gutachten › Anlagen', 'Je Station eine Anlage', { kap: 'Anlage', orte: ['s:gutachten', 'p:stations-steckbrief'] }),
    P('z-fazit', 'Fazit Elektrotechnik schreiben', 'Gutachten › Kapitel 9.2', 'Kernaussagen decken sich mit 5.7', { kap: '9.2', orte: ['s:gutachten'] }),
    P('z-luecken', 'Textlücken prüfen: Herkunft im Tool · fehlt/doppelt · reale Quelle', 'Gutachten-Editor', 'Keine Platzhalter mehr', { orte: ['s:gutachten'] }),
    P('z-widerspruch', 'Zahlen auf Widersprüche prüfen (Einspeisung, Anschlussleistung, Variantenstand)', 'Gutachten-Editor + Ergebnisblatt', 'Gleiche Größe hat überall denselben Wert', { orte: ['s:gutachten', 'a:ergebnisblatt'] }),
    P('z-stil', 'Textstil prüfen: unverbindlich („sollte“, „voraussichtlich“), kein Tool-Jargon', 'Gutachten-Editor', 'Liest sich wie ein Grundkonzept', { orte: ['s:gutachten'] }),
    P('z-export', 'Als .docx exportieren und in Word durchsehen', 'Gutachten › Export', 'Layout der Vorlage, Verzeichnisse aktualisiert', { orte: ['s:gutachten'] }),
    P('z-sichern', 'Projektstand sichern (Projektdatei speichern)', 'Projekt › Speichern', 'Datei mit Datum abgelegt', { orte: ['p:ui-proj-menu'] }),
  ]},
];

export const EC_PUNKTE = EC_PHASEN.flatMap(ph => ph.punkte.map(p => ({ ...p, phase: ph.id })));

/** Gewicht einer Marke: je spezieller die Stelle, desto stärker der Treffer. */
function _gewicht(marke) {
  const art = marke.slice(0, marke.indexOf(':'));
  return art === 'p' || art === 'x' ? 3 : art === 's' ? 1 : 2;
}

/**
 * Aufgaben zur aktuellen Stelle. Liefert nur die bestbewerteten Treffer: wer ein Fenster offen
 * hat, sieht dessen Aufgaben, nicht alle des Reiters dahinter. `marken`: Liste aus ecOrtMarken.
 * @returns {{ punkte: EcPunkt[], gewicht: number }}
 */
export function ecPassend(marken) {
  const m = new Set(marken || []);
  let best = 0;
  const treffer = [];
  for (const p of EC_PUNKTE) {
    let g = 0;
    for (const o of p.orte || []) if (m.has(o)) g = Math.max(g, _gewicht(o));
    if (!g) continue;
    treffer.push({ p, g });
    if (g > best) best = g;
  }
  return { punkte: treffer.filter(t => t.g === best).map(t => t.p), gewicht: best };
}

/**
 * Marken der aktuellen Stelle aus einem schlichten Zustandsobjekt (von der Oberfläche gelesen).
 * @param {{ schritt?: string, sparte?: string, elTab?: string, waermeTab?: string,
 *           bestandAnsicht?: string, abschnitt?: string, panels?: string[], assetTyp?: string }} z
 */
export function ecOrtMarken(z = {}) {
  const m = [];
  if (z.schritt) m.push('s:' + z.schritt);
  if (z.schritt === 'planung') {
    if (z.sparte === 'strom' && z.elTab) m.push('el:' + z.elTab);
    if (z.sparte === 'waerme') m.push('w:' + (z.waermeTab === 'erzeuger' ? 'erzeuger' : 'netz'));
  }
  if (z.schritt === 'bestand' && z.bestandAnsicht === 'tabelle') m.push('b:tabelle');
  if ((z.schritt === 'auswertung' || z.schritt === 'gutachten') && z.abschnitt) m.push('a:' + z.abschnitt);
  for (const id of z.panels || []) m.push('p:' + id);
  if (z.assetTyp) m.push('x:' + z.assetTyp);
  return m;
}

/**
 * Gespeicherten Stand säubern (fremde ids bleiben erhalten, falls Aufgaben später wiederkommen).
 * @returns {EcStand}
 */
export function ecNormalisieren(/** @type {any} */ daten) {
  /** @type {EcStand['punkte']} */
  const punkte = {};
  const roh = daten && typeof daten === 'object' && daten.punkte && typeof daten.punkte === 'object' ? daten.punkte : {};
  for (const [id, e] of Object.entries(roh)) {
    if (!e || typeof e !== 'object') continue;
    const s = _STATUS_IDS.has(e.s) ? e.s : 'offen';
    const n = typeof e.n === 'string' ? e.n : '';
    if (s === 'offen' && !n) continue;
    punkte[id] = { s, n, ...(Number.isFinite(e.t) ? { t: e.t } : {}), ...(_ADR_IDS.has(e.a) ? { a: e.a } : {}) };
  }
  return { v: 1, punkte };
}

// ── Rückfragen ─────────────────────────────────────────────────────────
// Aufgaben mit Status „Klären“ werden zur Rückfragenliste, gruppiert nach Adressat. Der Adressat
// steht je Eintrag unter `a`; ohne Eintrag gilt die Vorgabe der Aufgabe (außerhalb des Tools =
// Liegenschaft, sonst intern).
export const EC_ADRESSATEN = [
  { id: 'liegenschaft',  titel: 'Liegenschaft / Betreiber' },
  { id: 'netzbetreiber', titel: 'Netzbetreiber' },
  { id: 'nutzer',        titel: 'Nutzer' },
  { id: 'auftraggeber',  titel: 'Auftraggeber' },
  { id: 'intern',        titel: 'Intern' },
];
const _ADR_IDS = new Set(EC_ADRESSATEN.map(a => a.id));
const _ADR_VORGABE = /** @type {Record<string, string>} */ ({
  'u-vertrag': 'netzbetreiber', 'a-grenzen': 'netzbetreiber', 'a-modul': 'netzbetreiber', 'a-uw': 'netzbetreiber',
  'u-lade': 'nutzer', 'p-lade': 'nutzer', 'w-lade': 'nutzer', 's-abfrage': 'nutzer', 's-einlesen': 'nutzer', 's-klassen': 'nutzer',
  'u-entwicklung': 'auftraggeber', 'p-bestand': 'auftraggeber', 'b-empfehlung': 'auftraggeber', 'b-matrix': 'auftraggeber',
  'u-stationen': 'liegenschaft', 'u-nea': 'liegenschaft', 'i-erzeugung': 'liegenschaft', 'i-nea': 'liegenschaft',
  'n-kabeldaten': 'liegenschaft', 'n-steckbrief': 'liegenschaft', 'v-messjahre': 'liegenschaft', 'g-name': 'auftraggeber',
});

/** Adressat einer Rückfrage: gewählt, sonst Vorgabe der Aufgabe. */
export function ecAdressat(/** @type {EcStand|null} */ stand, /** @type {EcPunkt} */ p) {
  return stand?.punkte?.[p.id]?.a || _ADR_VORGABE[p.id] || (p.ext ? 'liegenschaft' : 'intern');
}

/**
 * Rückfragen gruppiert nach Adressat (Reihenfolge wie EC_ADRESSATEN, je Gruppe in Phasenfolge).
 * @returns {{ id: string, titel: string, eintraege: { id: string, phase: string, t: string, kap: string, n: string, seit: number|null }[] }[]}
 */
export function ecRueckfragen(/** @type {EcStand|null} */ stand) {
  const phase = new Map(EC_PHASEN.map(ph => [ph.id, ph.titel]));
  return EC_ADRESSATEN.map(a => ({
    id: a.id, titel: a.titel,
    eintraege: EC_PUNKTE.filter(p => ecStatus(stand, p.id) === 'klaeren' && ecAdressat(stand, p) === a.id).map(p => ({
      id: p.id, phase: phase.get(p.phase || '') || '', t: p.t, kap: p.kap || '',
      n: String(stand?.punkte?.[p.id]?.n || '').trim(), seit: stand?.punkte?.[p.id]?.t ?? null,
    })),
  })).filter(g => g.eintraege.length);
}

const _datum = (/** @type {number|null|undefined} */ t) => Number.isFinite(t) ? new Date(/** @type {number} */ (t)).toLocaleDateString('de-DE') : '';

/** Rückfragen als Text zum Einfügen in eine E-Mail. */
export function ecRueckfragenText(/** @type {ReturnType<typeof ecRueckfragen>} */ gruppen, /** @type {string} */ liegenschaft, heute = Date.now()) {
  const z = [`Rückfragen Elektrotechnik – ${liegenschaft || 'Liegenschaft'}`, `Stand: ${_datum(heute)}`, ''];
  for (const g of gruppen) {
    z.push(`An: ${g.titel}`);
    g.eintraege.forEach((e, i) => {
      z.push(`${i + 1}. ${e.t}${e.kap ? ` (Gutachten Kap. ${e.kap})` : ''}`);
      if (e.n) e.n.split(/\r?\n/).forEach((zeile, j) => z.push(`   ${j ? '' : 'Frage: '}${zeile}`));
    });
    z.push('');
  }
  return z.join('\n').trimEnd() + '\n';
}

/** Rückfragen als CSV für Excel (Semikolon, mit Kopfzeile). */
export function ecRueckfragenCsv(/** @type {ReturnType<typeof ecRueckfragen>} */ gruppen) {
  const feld = (/** @type {any} */ v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const zeilen = [['Adressat', 'Phase', 'Aufgabe', 'Kapitel', 'Frage / Notiz', 'Stand'].join(';')];
  for (const g of gruppen) for (const e of g.eintraege) zeilen.push([g.titel, e.phase, e.t, e.kap, e.n, _datum(e.seit)].map(feld).join(';'));
  return zeilen.join('\r\n') + '\r\n';
}

/**
 * Kurzstand für die Projektseite: Fortschritt je Phase, Zahl der Rückfragen, nächste Aufgabe.
 * `hinweise`: Stand aus dem Tool je Aufgabe (zählt, wo das Tool noch etwas offen sieht).
 */
export function ecUebersicht(/** @type {EcStand|null} */ stand, /** @type {Record<string, { stufe: string }>} */ hinweise = {}) {
  let fertig = 0, gesamt = 0;
  const phasen = EC_PHASEN.map(ph => {
    const z = ecZaehle(stand, ph.punkte);
    fertig += z.fertig; gesamt += z.gesamt;
    const toolOffen = ph.punkte.filter(p => ['offen', 'veraltet'].includes(hinweise[p.id]?.stufe || '')
      && !['erledigt', 'entfaellt'].includes(ecStatus(stand, p.id))).length;
    const begonnen = ph.punkte.some(p => ecStatus(stand, p.id) !== 'offen');
    return { id: ph.id, titel: ph.titel, kap: ph.kap, ...z, toolOffen, begonnen };
  });
  const klaeren = EC_PUNKTE.filter(p => ecStatus(stand, p.id) === 'klaeren').length;
  return { fertig, gesamt, klaeren, phasen, naechste: ecNaechste(stand) };
}

/** Status einer Aufgabe ('offen', wenn nichts gespeichert ist). */
export function ecStatus(stand, id) { return stand?.punkte?.[id]?.s || 'offen'; }

/** Erledigt zählt, entfällt zählt als erledigt; optionale Aufgaben zählen nicht mit. */
export function ecZaehle(stand, punkte) {
  const pflicht = punkte.filter(p => !p.opt);
  const fertig = pflicht.filter(p => { const s = ecStatus(stand, p.id); return s === 'erledigt' || s === 'entfaellt'; }).length;
  return { fertig, gesamt: pflicht.length };
}

/** Nächste offene Pflichtaufgabe in Reihenfolge der Phasen. */
export function ecNaechste(stand) {
  return EC_PUNKTE.find(p => !p.opt && !['erledigt', 'entfaellt'].includes(ecStatus(stand, p.id))) || null;
}

// ── Kapitelstand im Gutachten ──────────────────────────────────────────
// Eingang: gutKapitelStand() aus 21 — { kapitel: [{ nr, titel, ebene, texte, figuren, bilder }], stationsAnlagen }.
// Kapitel werden über ihren Titelpfad gefunden (nicht über die Nummer), damit eigene Kapitel
// oder eine umgestellte Gliederung nichts verschieben. Titelvergleich: Anfang, ohne Groß/klein.
const _EC_KAPITEL = [
  { id: 'z-editor',  pfad: ['Elektrotechnik'], baum: true },
  { id: 'p-ergebnis', pfad: ['Elektrotechnik', 'Bedarfsprognose Strom', 'Resultierende Anschlussleistung'] },
  { id: 'b-matrix',  pfad: ['Elektrotechnik', 'Bewertungsmatrix'] },
  { id: 'ga-ziele',  pfad: ['Gebäudeautomation'], baum: true },
  { id: 's-sz1',     pfad: ['Maßnahmen zur Steigerung der Resilienz', 'Bewertung Resilienz', 'Szenario 1'] },
  { id: 's-sz2',     pfad: ['Maßnahmen zur Steigerung der Resilienz', 'Bewertung Resilienz', 'Szenario 2'] },
  { id: 's-sz3',     pfad: ['Maßnahmen zur Steigerung der Resilienz', 'Bewertung Resilienz', 'Szenario 3'] },
  { id: 's-gegen',   pfad: ['Maßnahmen zur Steigerung der Resilienz', 'Bewertung Resilienz', 'Gegenüberstellung'] },
  { id: 'z-fazit',   pfad: ['Fazit', 'Elektrotechnik'] },
];

const _norm = (/** @type {any} */ s) => String(s || '').trim().toLowerCase();

/** Index eines Kapitels über den Titelpfad, oder -1. */
function _kapitelIndex(/** @type {any[]} */ kap, /** @type {string[]} */ pfad) {
  let von = 0, bis = kap.length, idx = -1;
  for (let stufe = 0; stufe < pfad.length; stufe++) {
    const suche = _norm(pfad[stufe]);
    // nur direkte Kinder: die flachste Ebene im Bereich
    let minEbene = Infinity;
    for (let i = von; i < bis; i++) minEbene = Math.min(minEbene, kap[i].ebene);
    idx = -1;
    for (let i = von; i < bis; i++) if (kap[i].ebene === minEbene && _norm(kap[i].titel).startsWith(suche)) { idx = i; break; }
    if (idx < 0) return -1;
    von = idx + 1;
    bis = _ende(kap, idx);
  }
  return idx;
}

/** Erster Index hinter dem Unterbaum von Kapitel i. */
function _ende(/** @type {any[]} */ kap, /** @type {number} */ i) {
  let j = i + 1;
  while (j < kap.length && kap[j].ebene > kap[i].ebene) j++;
  return j;
}

const _hatInhalt = (/** @type {any} */ k) => k.texte + k.figuren + k.bilder > 0;

function _inhaltText(/** @type {any} */ k) {
  if (!_hatInhalt(k)) return 'leer';
  const teile = [];
  if (k.texte) teile.push(`${k.texte} eigene${k.texte === 1 ? 'r' : ''} Text${k.texte === 1 ? '' : 'e'}`);
  if (k.figuren) teile.push(`${k.figuren} Baustein${k.figuren === 1 ? '' : 'e'}/Abbildung${k.figuren === 1 ? '' : 'en'}`);
  if (k.bilder) teile.push(`${k.bilder} Bild${k.bilder === 1 ? '' : 'er'}`);
  return teile.join(', ') + (k.texte ? '' : ' — kein eigener Text');
}

/**
 * Hinweise je Aufgabe aus dem Kapitelstand. Einzelkapitel: leer = offen, sonst ok mit Inhaltsangabe.
 * Kapitelbaum: Unterkapitel ohne eigene Unterkapitel zählen; leere werden mit Nummer genannt.
 * @returns {Record<string, { stufe: string, text: string }>}
 */
export function ecKapitelHinweise(/** @type {any} */ stand) {
  /** @type {Record<string, { stufe: string, text: string }>} */
  const h = {};
  const kap = stand?.kapitel;
  if (!Array.isArray(kap)) return h;
  for (const def of _EC_KAPITEL) {
    const i = _kapitelIndex(kap, def.pfad);
    if (i < 0) { h[def.id] = { stufe: 'leer', text: `Kapitel „${def.pfad[def.pfad.length - 1]}“ nicht im Dokument` }; continue; }
    const k = kap[i];
    const ende = _ende(kap, i);
    if (!def.baum || ende === i + 1) {
      h[def.id] = { stufe: _hatInhalt(k) ? 'ok' : 'offen', text: `Kap. ${k.nr}: ${_inhaltText(k)}` };
      continue;
    }
    const blaetter = kap.slice(i + 1, ende).filter((x, j, arr) => !(arr[j + 1] && arr[j + 1].ebene > x.ebene));
    const leer = blaetter.filter(x => !_hatInhalt(x));
    const ohneText = blaetter.filter(x => _hatInhalt(x) && !x.texte).length;
    const nennen = leer.slice(0, 6).map(x => x.nr).join(', ') + (leer.length > 6 ? ' …' : '');
    h[def.id] = {
      stufe: leer.length ? 'offen' : 'ok',
      text: `Kap. ${k.nr}: ${blaetter.length - leer.length} von ${blaetter.length} Unterkapiteln mit Inhalt`
        + (leer.length ? ` · leer: ${nennen}` : '') + (ohneText ? ` · ${ohneText} nur mit Bausteinen` : ''),
    };
  }
  // Abbildungen und Bilder im ganzen Dokument
  const fig = kap.reduce((s, k) => s + k.figuren, 0), bild = kap.reduce((s, k) => s + k.bilder, 0);
  h['z-grafiken'] = { stufe: fig ? 'ok' : 'offen', text: fig ? `${fig} Bausteine/Abbildungen im Dokument` : 'Noch keine Abbildungen im Dokument' };
  h['z-bilder'] = { stufe: bild ? 'ok' : 'offen', text: bild ? `${bild} Bild${bild === 1 ? '' : 'er'} (Lageplan o. ä.) im Dokument` : 'Noch kein Lageplan im Dokument' };
  return h;
}

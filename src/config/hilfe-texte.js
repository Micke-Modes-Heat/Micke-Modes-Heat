// ── Hilfe-Texte für alle UI-Elemente ─────────────────────────────────────
// Reine Daten — wird vom Hilfe-Modus in 11-hilfe-leitfaden.js verwendet.
export const HILFE_TEXTE = {
  // Header
  'btn-theme': 'Wechselt das Farbschema der Anwendung (Dunkel / Hell / Kontrast).',
  'btn-tile': 'Schaltet zwischen Karten-Ansicht und Satellitenbildern um.',
  'btn-berechnungslogik': 'Öffnet die technische Dokumentation aller Berechnungsmethoden.',
  'addr-input': 'Adresse eingeben → die Karte fliegt zum Ort. Start für jedes neue Projekt.',
  'btn-hilfe-toggle': 'Hilfe-Modus ein/aus: Im Hilfe-Modus zeigt jeder Button eine Erklärung beim Überfahren mit der Maus.',

  // View Tabs
  'view-tab-live': 'Zeigt die stundenscharfe Live-Simulation mit Dispatch, Lastgang und Energieflüssen.',

  // Context Bar
  'year-slider': 'Zeitstrahl: Verschiebt das Betrachtungsjahr. Gebäude-Sanierungen und -Abrisse werden berücksichtigt.',

  // Gebiet-Tab
  'lp-gebiet': 'Tab "Gebiet": Hier definierst du das Planungsgebiet und importierst Gebäude.',
  'lp-netz': 'Tab "Netz": Wärme- und Stromnetz planen und konfigurieren.',
  'lp-erzeuger': 'Tab "Erzeuger": Wärmeerzeuger, Speicher und PV-Anlagen hinzufügen.',
  'lp-ergebnis': 'Tab "Ergebnis": Wirtschaftlichkeit, Energiebilanzen und Export.',

  // Gebiet Buttons
  'btn-draw-area-main': 'Zeichnet ein Polygon auf der Karte das dein Plangebiet definiert. Innerhalb dieses Bereichs werden Gebäude importiert.',
  'btn-draw-area': 'Zeichnet ein Polygon auf der Karte das dein Plangebiet definiert. Innerhalb dieses Bereichs werden Gebäude importiert.',
  'btn-grundlagen': 'Wärme-Grundlagen: Klimastandort, SigLinDe-Lastprofil, Vorlauf-/Rücklauftemperaturen und Netzverluste konfigurieren.',
  'btn-strom-grundlagen': 'Strom-Grundlagen: Strompreis, Einspeisevergütung, Quartier-Stromverbrauch und Lastgang-Upload.',
  'btn-kennwerte': 'Kennwerte: Spezifischer Wärmebedarf nach Baujahr/Nutzung, Emissionsfaktoren, Primärenergiefaktoren.',
  'btn-overlay': 'Plan-Overlay: Ein Bild (z.B. Bebauungsplan) auf der Karte einblenden und positionieren.',
  'btn-osm-import': 'Lädt alle Gebäude im Plangebiet aus OpenStreetMap: Grundrisse, Stockwerke, Baujahr, Nutzung.',
  'btn-leitfaden': 'Öffnet den Schritt-für-Schritt Leitfaden für die Quartierplanung.',

  // Netz
  'lp-btn-lock': 'Wechselt den Berechnungsfall: Bestandsnetz bildet den frei bearbeitbaren Stand 2026 mit nicht automatisch veränderten DN und Engpasshinweisen ab; Neubaunetz wird für alle Planjahre ausreichend dimensioniert.',
  'lp-btn-pruning': 'Pruning-Modus: Klicke auf Netzleitungen um sie zu entfernen (abzuklemmen). Nochmal klicken stellt sie wieder her.',

  // Netz-Einfärbung
  'lp-netz-viz': 'Netz-Einfärbung: WLD = Wärmeliniendichte, DN = Rohrdurchmesser, Strang = Wirtschaftlichkeit pro Teilstrang.',

  // Erzeuger
  'btn-lwwp-toggle': 'Luft-Wasser-Wärmepumpe: Auf der Karte platzieren, Leistung wird automatisch oder manuell dimensioniert.',
  'btn-fliessgewaesser-toggle': 'Fließgewässer-Wärmepumpe: Entzieht einem nahegelegenen Gewässer Wärme. Linie auf der Karte zeichnen.',
  'btn-geo-toggle': 'Geothermie-WP: Erdwärmesonden-Feld platzieren. Bohrtiefe und Entzugsleistung konfigurierbar.',
  'btn-gaskessel-toggle': 'Gaskessel als Spitzenlast- oder Grundlast-Erzeuger. Wirkungsgrad und Leistung einstellbar.',
  'btn-heizoel-toggle': 'Heizöl-Kessel: Wie Gaskessel, aber mit Heizöl als Brennstoff.',
  'btn-pellets-toggle': 'Pelletkessel: Biomasse-Erzeuger. Auf der Karte platzierbar (Lagerfläche berücksichtigen).',
  'btn-hhs-toggle': 'Hackschnitzel-Kessel: Günstigerer Brennstoff, aber mehr Lagerbedarf als Pellets.',
  'btn-fernwaerme-toggle': 'Fernwärme-Übergabestation: Anschluss an ein bestehendes Fernwärmenetz.',
  'btn-stromkessel-toggle': 'Stromkessel (Power-to-Heat): Wandelt Strom direkt in Wärme um. Sinnvoll bei PV-Überschuss.',
  'btn-bhkw-toggle': 'Blockheizkraftwerk: Kraft-Wärme-Kopplung — erzeugt gleichzeitig Strom und Wärme aus Gas.',

  // PV
  'btn-geb-pv-toggle': 'Gebäude-PV: Aktiviert PV auf ausgewählten Gebäudedächern. Belegungsanteil pro Gebäude einstellbar.',
  'btn-ff-pv-toggle': 'Freiflächen-PV: Zeichne eine Freifläche auf der Karte für eine PV-Anlage am Boden.',

  // Speicher
  'btn-solarthermie-toggle': 'Solarthermie: Thermische Solaranlage zur Warmwasser- oder Heizungsunterstützung.',

  // Ergebnis Buttons
  'btn-wirtschaft-toggle': 'Zeigt die vollständige Wirtschaftlichkeitsberechnung: Investition, Annuitäten, Wärmegestehungskosten (WGK).',
  'btn-strom-toggle': 'Strom-Bilanz: PV-Erzeugung, Eigenverbrauch, Einspeisung, WP-Strombedarf, Autarkiegrad.',
  'btn-status-toggle': 'Status-Panel: Übersicht aller Erzeuger mit Deckungsanteilen und Kennwerten.',

  // Strom-Netz
  'btn-draw-strom-edge': 'Kabel zeichnen: Verbindet Strom-Komponenten (NAP → Trafo → NSHV → Gebäude).',
  'btn-sld-toggle': 'Einlinienschema: schematische Übersicht des Stromnetzes (Schaltanlagen, Trafos, NSHV, Abgänge) als Strukturdiagramm.',
  'btn-netzanalyse-toggle': 'Netzanalyse: Lastübersicht (Heatmap), automatische Trafo-Standort-Optimierung und MS-Netz-Analyse (Ringe, n-1-Sicherheit) für das Stromnetz.',
  'btn-osm-strassen': 'Lädt Straßenverläufe aus OpenStreetMap im aktuellen Kartenausschnitt — als Vorlage zum schnellen Anlegen von Elektrotrassen.',
  'btn-osm-strassen-toggle': 'Blendet die geladenen OSM-Straßen auf der Karte ein oder aus.',

  // Erzeuger aktivieren / platzieren
  'btn-activate-gaskessel': 'Gaskessel aktivieren und dem Erzeugermix hinzufügen.',
  'btn-activate-heizoel': 'Heizölkessel aktivieren und dem Erzeugermix hinzufügen.',
  'btn-activate-pellets': 'Pelletkessel aktivieren und dem Erzeugermix hinzufügen.',
  'btn-activate-hhs': 'Hackschnitzelkessel aktivieren und dem Erzeugermix hinzufügen.',
  'btn-activate-fernwaerme': 'Fernwärme-Übergabestation aktivieren.',
  'btn-activate-stromkessel': 'Stromkessel (Power-to-Heat) aktivieren.',
  'btn-activate-bhkw': 'BHKW (Blockheizkraftwerk) aktivieren.',
  'btn-place-lwwp': 'Luft-WP auf der Karte platzieren. Klicke auf den gewünschten Standort.',
  'btn-place-geo': 'Geothermie-Sondenfeld auf der Karte platzieren.',
  'btn-place-fw': 'Fernwärme-Übergabestation auf der Karte platzieren.',
  'btn-place-pellets': 'Pelletkessel auf der Karte platzieren (Lagerfläche beachten).',
  'btn-place-hhs': 'Hackschnitzelkessel auf der Karte platzieren.',

  // Netz-Zeichnung
  'btn-draw-trasse': 'Trasse zeichnen: Klicke Punkte auf der Karte um den Verlauf der Hauptleitung zu definieren.',
  'btn-draw-edge': 'Einzelne Netzleitung manuell zeichnen (von Knoten zu Knoten).',
  'btn-draw-river': 'Fließgewässer einzeichnen: Linie entlang des Flusses/Bachs auf der Karte.',

  // Solarthermie / Freifläche
  'btn-st-draw': 'Solarthermie-Fläche auf der Karte einzeichnen.',
  'btn-st-cancel': 'Solarthermie-Zeichnung abbrechen.',
  'btn-ff-draw': 'PV-Freifläche auf der Karte einzeichnen.',
  'btn-ff-cancel': 'Freiflächen-Zeichnung abbrechen.',

  // Netz-Einfärbung (Detail)
  'ncbtn-wld': 'Einfärbung: Wärmeliniendichte — zeigt wirtschaftliche Eignung jeder Leitung.',
  'ncbtn-dn': 'Einfärbung: Rohrdurchmesser (DN) — zeigt die Dimensionierung.',
  'ncbtn-verlust': 'Einfärbung: Wärmeverluste pro Leitungsabschnitt.',
  'ncbtn-subtree': 'Einfärbung: Strang-WLD — Wirtschaftlichkeit des gesamten Teilstrangs ab diesem Segment.',
  'ncbtn-netzkosten': 'Einfärbung: Investitionskosten pro Leitungsabschnitt (Rohr + Tiefbau).',
  'ncbtn-auslastung': 'Einfärbung: Auslastung — wie stark wird die Leitung im Verhältnis zu ihrer Kapazität genutzt.',
  'ncbtn-druck': 'Einfärbung: Druckverlust (Δp) pro Leitungsmeter.',
  'ncbtn-geschw': 'Einfärbung: Fließgeschwindigkeit (m/s) — zu hoch = Geräusche, zu niedrig = Ablagerungen.',
  'ncbtn-temp': 'Einfärbung: Temperaturverlauf im Netz — zeigt Auskühlung der Vorlaufleitung.',
  'ncbtn-abkuehlung': 'Einfärbung: Abkühlung — Temperaturdifferenz zwischen Zentrale und Abnehmer.',

  // Optimierung
  'btn-opt-start': 'Startet die automatische Optimierung: Testet tausende Erzeuger-Kombinationen und findet die wirtschaftlichste Lösung.',
  'opt-view-2d': 'Optimierungs-Ergebnis als 2D-Heatmap darstellen.',
  'opt-view-3d': 'Optimierungs-Ergebnis als 3D-Landschaft darstellen.',

  // Analyse Tabs
  'sa-tab-btn-lastgang': 'Analyse: Stundenscharfer Lastgang mit Erzeuger-Dispatch (8760 Stunden).',
  'sa-tab-btn-jdl': 'Analyse: Jahresdauerlinie — sortierter Lastgang von höchster zu niedrigster Stunde.',
  'sa-tab-btn-woche': 'Analyse: Typische Wochen — Winter, Sommer, Übergang im Vergleich.',
  'sa-tab-btn-monate': 'Analyse: Monatliche Energiebilanz als Balkendiagramm.',
  'sa-tab-btn-split': 'Analyse: Deckungsanteile — welcher Erzeuger liefert wie viel Wärme.',
  'sa-tab-btn-dim': 'Analyse: Dimensionierung — Leistung vs. Energieanteil der Erzeuger.',
  'sa-tab-btn-metriken': 'Analyse: Kennzahlen-Übersicht (JAZ, VBH, Deckungsgrad, etc.).',
  'sa-tab-btn-sensitivitaet': 'Analyse: Sensitivitätsanalyse — wie ändern sich die WGK wenn Preise schwanken.',

  // Strom Tabs
  'strom-tab-lastgang': 'Strom: Stundenscharfer Lastgang mit PV-Erzeugung, Eigenverbrauch, Netzein-/ausspeisung.',
  'strom-tab-jdl': 'Strom: Jahresdauerlinie des Stromlastgangs.',
  'strom-tab-monat': 'Strom: Monatliche Strombilanz.',
  'strom-tab-sankey': 'Strom: Sankey-Diagramm der Stromflüsse (PV → Eigenverbrauch/Einspeisung/Batterie).',
  'strom-tab-fluss': 'Strom: Energiefluss-Diagramm des Gesamtsystems.',

  // Wirtschaftlichkeit
  'wirt-view-table': 'Wirtschaftlichkeit als Tabelle: Alle Kostenpositionen mit Investition, Annuität, VDI-Parametern.',
  'wirt-view-waterfall': 'Wirtschaftlichkeit als Wasserfall-Diagramm: Visualisiert den Aufbau der Wärmegestehungskosten.',

  // Live-Ansicht
  'live-play-btn': 'Stundensimulation abspielen: Zeigt den Dispatch animiert über das Jahr.',
  'live-slider': 'Stundenschieber: Manuell durch alle 8760 Stunden des Jahres navigieren.',
  'live-speed-btn': 'Abspielgeschwindigkeit ändern (1×, 2×, 5×, 10×).',

  // Lastgang
  'lg-view-8760': 'Lastgang: Alle 8760 Stunden des Jahres anzeigen.',
  'lg-view-kalender': 'Lastgang: Kalender-Ansicht (Heatmap nach Tag und Stunde).',
  'lg-view-monate': 'Lastgang: Monatsweise Darstellung.',

  // Sonstige
  'netz-sanierung-toggle': 'Netz-Sanierung: Simuliert Wärmedämmverbesserung des Bestandsnetzes.',
  'pv-clear-btn': 'PV-Lastgang löschen und zum berechneten Standardprofil zurückkehren.',
  'pv-file-input': 'PV-Lastgang als CSV hochladen (8760 Stundenwerte in kW).',
  'strom-clear-btn': 'Strom-Lastgang löschen und zum SLP-Standardprofil zurückkehren.',
  'strom-file-input': 'Strom-Lastgang als CSV hochladen (Smart-Meter-Daten, 8760 Stundenwerte).',
  'strom-szenario': 'Strom-Netz Szenario: Spitzenlast, PV-Maximum, Rückspeisung oder Jahresmittel.',
  'bhkw-co2-gutschrift-toggle': 'CO₂-Gutschrift für BHKW-Strom: Vermiedene Emissionen aus dem Stromnetz werden dem BHKW gutgeschrieben.',
  'pv-co2-gutschrift-toggle': 'CO₂-Gutschrift für PV-Eigenverbrauch: Vermiedene Netzstrom-Emissionen werden der PV gutgeschrieben.',
  'sidebar-toggle': 'Gebäude-Sidebar ein-/ausblenden.',
  'lp-toggle': 'Linkes Panel ein-/ausblenden für mehr Kartenplatz.',
  'chart-visible-cb': 'Zeitstrahl-Chart unter der Karte ein-/ausblenden.',
  'geb-pv-dachanteil': 'Anteil der Dachfläche der mit PV belegt wird (in %). Berücksichtigt Dachfenster, Schornsteine, ungünstige Ausrichtung.',
  'gl-run-btn': 'Grundlagen-Berechnung starten: Erzeugt den synthetischen Lastgang aus den eingestellten Parametern.',
  'btn-send-to-lr': 'Gebäudedaten an den Liegenschaftsrechner senden für Einzelgebäude-Detailberechnung.',
  'gbi-btn-manual': 'Gebäude manuell anlegen: Einzelnes Gebäude mit Adresse/Koordinaten hinzufügen.',
  'import-file': 'Projektdatei (JSON) laden: Öffnet ein zuvor gespeichertes Projekt mit allen Einstellungen.',
  'split-view-balken': 'Deckungsanteile als gestapeltes Balkendiagramm.',
  'split-view-treemap': 'Deckungsanteile als Treemap (Flächendiagramm).',

  // Karten-Modi
  'btn-waerme': 'Karte zeigt Gebäude eingefärbt nach absolutem Wärmebedarf (MWh/a).',
  'btn-spez': 'Karte zeigt spezifischen Wärmebedarf (kWh/m²a) — vergleicht Energieeffizienz unabhängig von der Größe.',
  'btn-heizlast': 'Karte zeigt die Heizlast (kW) — bestimmt die nötige Erzeugerleistung.',
  'btn-verlust': 'Karte zeigt die Netzverluste pro Leitung.',
  'btn-strom': 'Karte zeigt den Stromverbrauch der Gebäude.',

  // Visualisierung
  'vbtn-circle': 'Gebäude als Kreise darstellen — Größe proportional zum Wärmebedarf.',
  'vbtn-bar': 'Gebäude als Balken darstellen.',
  'vbtn-none': 'Gebäude nur als Grundriss zeigen (keine Größenvisualisierung).',

  // Ansicht-Checkboxen (Tab Gebiet)
  'geb-visible': 'Gebäude auf der Karte ein-/ausblenden.',
  'netz-visible-ansicht': 'Wärmenetz auf der Karte ein-/ausblenden.',
  'labels-visible': 'Beschriftung (Gebäudenamen, Verbrauchswerte) auf der Karte anzeigen.',
  'overlay-visible-cb': 'Plan-Overlay (z.B. Bebauungsplan) auf der Karte ein-/ausblenden.',

  // Stromnetz-Parameter
  'strom-kabel-typ': 'Kabeltyp für das Stromnetz — bestimmt Querschnitt und Belastbarkeit.',
  'strom-gzf-methode': 'Methode zur Berechnung des Gleichzeitigkeitsfaktors für die Stromlast.',
  'strom-gzf-manuell': 'Manueller Gleichzeitigkeitsfaktor — überschreibt die automatische Berechnung.',
  'strom-k-tiefbau': 'Tiefbaukosten pro Meter Kabelgraben (€/m).',
  'strom-k-nap': 'Pauschale Kosten für den Netzanschlusspunkt (€).',
  'strom-k-trafo': 'Transformator-Kosten pro kVA Nennleistung (€/kVA).',
  'strom-k-nd': 'Nutzungsdauer des Stromnetzes für die Annuitätsberechnung (Jahre).',
  'strom-netz-visible': 'Stromnetz auf der Karte ein-/ausblenden.',

  // Sichtbarkeit Wärmenetz (Tab Netz)
  'netz-visible': 'Wärmenetz-Leitungen auf der Karte ein-/ausblenden.',

  // Emissionsfaktoren (Kennwerte-Panel)
  'strom-emf': 'CO₂-Emissionsfaktor Strommix aktuell (g CO₂eq/kWh) — für Wärmepumpen und Stromkessel.',
  'strom-emf-lz': 'CO₂-Emissionsfaktor Strom langfristig Ø 2030–2050 (g CO₂eq/kWh) — für Annuitätsbetrachtung.',
  'verdraengung-emf-override': 'Manueller Verdrängungsfaktor (g CO₂/kWh) — wird für BHKW/PV-Gutschriften verwendet.',
  'gas-emf': 'CO₂-Emissionsfaktor Erdgas (g CO₂eq/kWh) nach GEG Anlage 9.',
  'heizoel-emf': 'CO₂-Emissionsfaktor Heizöl (g CO₂eq/kWh) nach GEG Anlage 9.',
  'fernwaerme-emf': 'CO₂-Emissionsfaktor Fernwärme (g CO₂eq/kWh) — abhängig vom lokalen Wärmemix.',
  'pellets-emf': 'CO₂-Emissionsfaktor Holzpellets (g CO₂eq/kWh) nach GEG Anlage 9.',
  'hhs-emf': 'CO₂-Emissionsfaktor Holzhackschnitzel (g CO₂eq/kWh) nach GEG Anlage 9.',

  // Primärenergiefaktoren
  'pef-strom': 'Primärenergiefaktor Strom — Verhältnis Primär- zu Endenergie.',
  'pef-wp': 'Primärenergiefaktor Umweltwärme (Wärmepumpe) — i.d.R. 0.',
  'pef-gas': 'Primärenergiefaktor Erdgas nach GEG.',
  'pef-heizoel': 'Primärenergiefaktor Heizöl nach GEG.',
  'pef-pellets': 'Primärenergiefaktor Holzpellets nach GEG — erneuerbar, daher niedrig.',
  'pef-hhs': 'Primärenergiefaktor Holzhackschnitzel nach GEG.',
  'pef-fernwaerme': 'Primärenergiefaktor Fernwärme — abhängig vom lokalen Erzeugungsmix.',

  // Wärme-Grundlagen Panel
  'gl-norm-at': 'Normaussentemperatur (°C) — offizieller PLZ-Wert aus der BWP-Klimakarte nach DIN/TS 12831-1; einheitlich für Wärme- und Netzauslegung.',
  'gl-gesamt': 'Jahresgesamtwärmebedarf des Quartiers (kWh) — wird auf die Gebäude verteilt wenn kein Lastgang vorliegt.',
  'gl-file-input': 'Wärmelastgang hochladen — CSV-Datei mit 8760 Stundenwerten (kW). Höchste Genauigkeit für die Simulation.',

  // OSM Import
  'osm-default-baujahr': 'Standard-Baujahr für importierte Gebäude, falls OpenStreetMap kein Baujahr liefert.',
  'osm-default-baujahr-area': 'Standard-Baujahr für Gebäude im gezeichneten Plangebiet.',

  // Gebäude-Sidebar
  'geb-filter': 'Gebäudeliste filtern — Suche nach Name, Adresse oder Nutzung.',
  'bulk-spez': 'Sammelbearbeitung: Spezifischen Wärmebedarf (kWh/m²a) für alle ausgewählten Gebäude setzen.',
  'bulk-waerme': 'Sammelbearbeitung: Jahreswärmebedarf (MWh/a) für alle ausgewählten Gebäude setzen.',
  'bulk-hl': 'Sammelbearbeitung: Heizlast (kW) für alle ausgewählten Gebäude setzen.',

  // Overlay
  'overlay-opacity': 'Transparenz des Plan-Overlays anpassen — ganz links = durchsichtig, ganz rechts = deckend.',

  // Optimierung — Kandidaten und Grenzen
  'opt-cand-lwwp': 'Luft-Wasser-Wärmepumpe als Optimierungskandidat aktivieren.',
  'opt-cand-fg': 'Fließgewässer-Wärmepumpe als Optimierungskandidat aktivieren.',
  'opt-cand-geo': 'Geothermie als Optimierungskandidat aktivieren.',
  'opt-cand-gaskessel': 'Gaskessel als Optimierungskandidat aktivieren.',
  'opt-cand-bhkw': 'BHKW als Optimierungskandidat aktivieren.',
  'opt-cand-stromkessel': 'Stromkessel als Optimierungskandidat aktivieren.',
  'opt-cand-pellets': 'Pelletskessel als Optimierungskandidat aktivieren.',
  'opt-cand-hhs': 'Holzhackschnitzelkessel als Optimierungskandidat aktivieren.',
  'opt-cand-fernwaerme': 'Fernwärme als Optimierungskandidat aktivieren.',
  'opt-cand-heizoel': 'Ölkessel als Optimierungskandidat aktivieren.',
  'opt-cand-pv': 'PV-Anlage in die Optimierung einbeziehen — Leistung wird automatisch variiert.',
  'opt-cand-bat': 'Batteriespeicher in die Optimierung einbeziehen — Kapazität wird automatisch variiert.',
  'opt-cand-st': 'Solarthermie in die Optimierung einbeziehen — Kollektorfläche wird automatisch variiert.',
  'opt-cand-ts': 'Wärmespeicher in die Optimierung einbeziehen — Volumen wird automatisch variiert.',
  'opt-pv-max-amort': 'Maximale Amortisationszeit für PV-Anlagen (Jahre) — Varianten mit längerer Amortisation werden verworfen.',

  // PV-Varianten-Workflow (M2–M6)
  'btn-pv-merit-order': 'Startet die Flächen-Merit-Order: Bewertet alle PV-Kandidaten (Dächer, Freifl., Assets) nach wirtschaftlichem Zusatznutzen (Δ Überschuss abzgl. Δ Infrastrukturkosten) und ordnet sie in Tiers A/B/C ein.',
  'btn-pv-ertuechtigung': 'Berechnet die notwendigen Netzertüchtigungen (Trafoverstärkung, Leitungsausbau) für jeden NAP und integriert die Kosten in das Merit-Order-Ranking.',
  'analyse-section-tab-ausbauplaner': 'Öffnet den Ausbauplaner: Gantt-Board mit Gewerk-Swimlanes, Phasen-Editor und Drag-Drop-Planung der PV-Ausbaumaßnahmen. Auto-Plan erzeugt einen optimierten Fahrplan aus dem Merit-Order-Ergebnis.',
  'asset-bulk-bar': 'Bulk-Aktionen für ausgewählte Elektro-Assets: Phase zuweisen, Maßnahme aus Vorlage anlegen, Status und Jahr setzen. Assets per Shift+Klick oder Box-Select (Shift+Ziehen auf der Karte) wählen.',
};

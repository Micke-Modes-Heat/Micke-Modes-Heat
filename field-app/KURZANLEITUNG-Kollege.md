# Feldapp – Kurzanleitung für den Außendienst

Mit der Feldapp dokumentierst du Gebäude vor Ort: Fotos, Notizen und Status –
alles offline auf dem Handy. Am Ende schickst du ein ZIP zurück ins Büro.

> 💡 **Tipp zum Einstieg:** Tippe auf dem Startbildschirm auf
> **„🎬 Kurzer Rundgang (Demo)"** – die App zeigt dir an Beispiel-Gebäuden in
> 17 Schritten, wo welcher Knopf ist. Dein echtes Projekt bleibt dabei unberührt.

---

## 1. App aufs Handy holen (einmalig)

**Variante A – empfohlen, funktioniert auch im Funkloch:**
1. Öffne im **Chrome** die Adresse, die du von Andre bekommen hast
   (z. B. `https://…netlify.app`).
2. Chrome-Menü **⋮** → **„App installieren"** / **„Zum Startbildschirm hinzufügen"**.
3. Es erscheint ein **Feldapp-Icon**. Ab jetzt immer über dieses Icon öffnen.

**Variante B – nur wenn du überall Handyempfang hast:**
1. Die Datei `feldapp.html` (per WhatsApp/Mail) **zuerst speichern** →
   landet in **Downloads**.
2. **Eigene Dateien → Downloads → feldapp.html** → **mit Chrome öffnen**.
   *(Nicht direkt aus WhatsApp öffnen!)*

> ⚠️ **Roter Warnbalken?** Wenn oben ein roter Streifen „Daten könnten verloren
> gehen" erscheint, hast du die Datei aus einer temporären Quelle (z. B. direkt
> aus WhatsApp) geöffnet. Dann **erst speichern** wie in Variante B – sonst sind
> deine Fotos beim nächsten Öffnen evtl. weg.

---

## 2. Projekt laden
1. App öffnen → **„📂 Projekt-JSON laden"**.
2. Die Projektdatei (`.json`, liegt in **Downloads**) auswählen.
3. Es erscheint „✓ … Gebäude geladen" und die Karte öffnet sich. Das Projekt
   bleibt gespeichert – auch offline und nach dem Schließen.

---

## 3. VOR der Abfahrt (solange du noch WLAN/Netz hast!)
1. Reiter **Karte** öffnen, ins Einsatzgebiet zoomen.
2. Oben rechts auf das **Wolken-Symbol** tippen → der sichtbare Kartenausschnitt
   wird für offline gespeichert („Ausschnitt offline gespeichert").
3. Bei mehreren Gebieten: jeweils hinzoomen und erneut tippen.

> Ohne diesen Schritt bleibt die Karte im Funkloch leer.

---

## 4. Vor Ort arbeiten
Unten gibt es vier Reiter: **Karte · Gebäude · Projekt · Export**.

- **Gebäude finden:** auf der **Karte** (Name steht im Umriss) oder im Reiter
  **Gebäude** über die Suche. Die Filter (Vorgemerkt, Offen, Besucht, Erledigt)
  gibt es in beiden Ansichten.
- **Farben auf der Karte:** grau = offen, gelb = besucht, grün = erledigt.
  Ein dunkelgrüner Rahmen bzw. ★ heißt: im Büro für die Begehung vorgemerkt.
- **Gebäude antippen** → unten öffnet sich die Detail-Karte:
  - **Checkliste:** zeigt, was für diesen Gebäudetyp noch fehlt (z. B. Foto
    Typenschild, Baujahr Heizung). Einen offenen Punkt antippen → die App
    springt direkt zur Kamera bzw. zum Feld. „Erledigt" geht auch mit
    offenen Punkten, die App fragt dann nach.
  - **Status** setzen (Offen / Besucht / Erledigt),
  - **Foto-Kategorie** vor dem Fotografieren wählen (Fassade, Heizraum,
    Typenschild, Zähler, Mangel, Sonstiges). Gelb = fehlt noch laut
    Checkliste. Nachträglich ändern: Foto antippen, unten Kategorie wählen.
  - **Fotos:** „Foto" öffnet die Kamera-App für ein Bild, **„Serie"** nimmt
    beliebig viele Bilder hintereinander auf (Auslöser drücken, am Ende
    „Fertig"), „Galerie" übernimmt mehrere vorhandene Bilder auf einmal.
    GPS-Daten im Foto werden entfernt. Die Fotoqualität (Standard / Hoch /
    Maximal) stellst du im Reiter **Export** ein – „Hoch" ist voreingestellt,
    „Maximal" lohnt sich für Typenschilder und Zählerstände,
  - **Vor Ort erfasst:** Heizung aus der Liste wählen, Baujahr und Leistung
    vom Typenschild, Jahresverbrauch oder Zählerstand (Datum wird automatisch
    gesetzt). Nur Zahlen eintragen, ohne Einheit – rot markierte Felder
    werden nicht gespeichert,
  - **Notiz** schreiben (Mikrofon-Knopf für Spracheingabe).
- Alles wird sofort lokal gespeichert. Du kannst offline arbeiten.
- Reiter **Projekt:** Kennzahlen, Erzeugermix und Varianten aus dem Büro – nur
  zum Nachschauen, gerechnet wird im Büro.

### Trafostationen (Blitz-Symbol auf der Karte)
Stationen öffnen sich als **Stationsakte** – die Station als Ganzes, nicht jedes
Bauteil einzeln. Mit dem Filter **Stationen** siehst du nur sie.
1. **Station antippen** → Status, Erfassungsstand und der Aufbau als Kacheln:
   **Gebäude & Station → Schaltanlage → Trafo(s) → NSHV**. Jede Kachel zeigt
   Zustand, erfasste Pflichtangaben und die Nutzungsdauer (rot = überschritten).
2. **Kachel antippen** → Steckbrief-Abschnitt: Auswahlfelder antippen, Zahlen
   eintragen, **Zustand** (gut / mittel / schlecht) wählen.
   - **Gestrichelte Werte** kommen aus der Planung – bitte prüfen, bei Abweichung
     einfach überschreiben.
   - **Foto-Plätze** (z. B. *Typenschild*): Kamera, Serie oder Galerie direkt am
     Platz. Gelb markierte Plätze sind Pflicht.
   - Die **Nutzungsdauer** (VDI 2067) rechnet die App aus dem Baujahr selbst aus.
3. Unten **„Weiter: …"** führt der Reihe nach durch die ganze Station.
4. In der Übersicht **Mängel** mit Priorität (sofort … Hinweis) und Bezug
   (z. B. *Trafo 1a*) erfassen.
5. **Erledigt** geht auch mit offenen Pflichtangaben – die App fragt dann nach.

Der Export nimmt alles mit. Beim Einlesen im Büro zeigt das Planungstool vorher,
welche Werte (z. B. Trafoleistung, Baujahr) es in die Planung übernimmt.

---

## 5. AM ENDE DES TAGES – Daten zurückschicken (wichtig!)
1. Reiter **Export** öffnen. Oben siehst du, wie viele Fotos, Notizen, Status
   und Daten erfasst sind; die Zahl am Reiter zeigt, wie viele Objekte noch
   nicht verschickt wurden.
2. **„ZIP teilen"** tippen → es entsteht ein ZIP mit allen Fotos, Notizen,
   Werten und einem Bericht.
3. Im Teilen-Dialog **Dienst-Mail** (oder eure Dateiablage) wählen und an das
   Büro schicken. Kein privater Messenger.
   *(Kein Teilen-Dialog? „Als Datei speichern" – das ZIP liegt dann in
   **Downloads**.)*

> Mach den Export **am besten täglich**. Solange unexportierte Daten da sind,
> warnt die App beim Schließen.

---

## Goldene Regeln
- ✅ Immer über das **App-Icon** (oder die gespeicherte Datei) öffnen – nie
  direkt aus einem Messenger.
- ✅ **Vor** der Fahrt Karte cachen (Schritt 3).
- ✅ **Täglich exportieren** und ans Büro schicken.
- ❌ App-Daten **nicht** über „Projekt löschen" oder Browserdaten-Löschen
  entfernen, bevor exportiert wurde.

Bei Problemen: Screenshot machen und an Andre schicken.

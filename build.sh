#!/bin/bash
# Build-Script: Fügt alle Module zu einer einzigen HTML-Datei zusammen
# Ergebnis: dist/Index.html — identisch mit dem Original-Format
set -e

DIST="dist"
mkdir -p "$DIST"

SRC="src"
OUT="$DIST/Index.html"

echo "Baue $OUT ..."

# 1. Head + CSS inline
cat > "$OUT" << 'HTMLHEAD'
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Liegenschaft – Energiekarte</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<style>
HTMLHEAD

cat "$SRC/styles/app.css" >> "$OUT"

echo '</style>' >> "$OUT"

# 2. HTML Body (zwischen </head> und dem module-Script)
sed -n '/<\/head>/,/<script type="module"/p' index.html | head -n -1 >> "$OUT"

# 3. JS-Module als <script>-Blöcke einfügen
JS_FILES=(
  "$SRC/config/netz-kosten.js"
  "$SRC/config/erzeuger-cfg.js"
  "$SRC/config/optimizer-defaults.js"
  "$SRC/config/hilfe-texte.js"
  "$SRC/01-globals-varianten.js"
  "$SRC/02a-netz-physik.js"
  "$SRC/02b-gebaeude.js"
  "$SRC/02c-karte-werkzeuge.js"
  "$SRC/03a-erzeuger.js"
  "$SRC/03b-netz.js"
  "$SRC/03c-gebaeude-io.js"
  "$SRC/04a-ui-panels.js"
  "$SRC/04b-emissionen-3d.js"
  "$SRC/05a-export.js"
  "$SRC/05b-stromnetz.js"
  "$SRC/05c-sankey.js"
  "$SRC/06a-gbi-lastgang.js"
  "$SRC/06b-gl-berechnen.js"
  "$SRC/06c-dispatch-core.js"
  "$SRC/07a-analysis-charts.js"
  "$SRC/07b-analysis-economics.js"
  "$SRC/08-calc-engine.js"
  "$SRC/09a-pv-profile.js"
  "$SRC/09b-pv-calc.js"
  "$SRC/09c-pv-charts-opt.js"
  "$SRC/10a-optimizer-core.js"
  "$SRC/10b-hourly-live.js"
  "$SRC/10c-optimizer-run.js"
  "$SRC/10d-optimizer-worker.js"
  "$SRC/11-hilfe-leitfaden.js"
  "$SRC/12-inline-handlers.js"
)

for js in "${JS_FILES[@]}"; do
  echo "<script>" >> "$OUT"
  # ES-Module → globaler Scope: import/export entfernen, window.xyz → xyz
  sed -e '/^import /d' -e 's/^export //' -e 's/window\.\([a-zA-Z_][a-zA-Z0-9_]*\)/\1/g' "$js" >> "$OUT"
  echo "" >> "$OUT"
  echo "</script>" >> "$OUT"
done

# 4. Schließen
echo '</body>' >> "$OUT"
echo '</html>' >> "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
LINES=$(wc -l < "$OUT")
echo "Fertig: $OUT ($SIZE, $LINES Zeilen)"

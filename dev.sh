#!/bin/bash
# Dev-Server mit Auto-Reload — öffne http://localhost:3000 im Browser
# Änderungen an JS/CSS-Dateien werden automatisch im Browser aktualisiert

# Auto-Sync: Berechnungslogik-Doku aus dem Parent-Ordner kopieren,
# falls dort eine neuere Version liegt (cp -u = nur kopieren wenn neuer)
mkdir -p docs
if [ -f ../docs/berechnungslogik.html ]; then
  cp -u ../docs/berechnungslogik.html docs/berechnungslogik.html
fi

# Architektur-Doku regenerieren (analysiert src/*.js automatisch)
node tools/generate-architecture.mjs

npm run dev

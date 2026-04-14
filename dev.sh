#!/bin/bash
# Einfacher Dev-Server — öffne http://localhost:3000 im Browser
# Änderungen an JS/CSS-Dateien erfordern Browser-Refresh (F5)
echo "Dev-Server startet auf http://localhost:3000"
echo "Strg+C zum Beenden"
python3 -m http.server 3000

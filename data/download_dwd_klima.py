#!/usr/bin/env python3
"""
DWD-Klimadaten-Downloader für Energieplanung-Tool
==================================================
Lädt stündliche Temperaturdaten vom DWD Open Data Server für alle
konfigurierten Städte (2020–2025) und berechnet ein TMY (Typisches
Meteorologisches Jahr = Median je Stunde). Speichert als gzip+base64-
kodierte Int16-Arrays (×10 → 0.1°C Auflösung) in JS-Dateien unter
data/klima/{Stadt}.js, die vom Tool dynamisch nachgeladen werden.

Benötigt: pip install requests
Ausführen: python3 download_dwd_klima.py
"""

import requests
import zipfile
import io
import struct
import gzip
import base64
import math
import re
import datetime
from pathlib import Path

# ── Stadtkoordinaten ──────────────────────────────────────────────────────────
STAEDTE = {
    # Norddeutschland
    'Hamburg':           (53.55, 10.00),
    'Kiel':              (54.33, 10.13),
    'Lübeck':            (53.87, 10.68),
    'Flensburg':         (54.78,  9.44),
    'Rostock':           (54.09, 12.13),
    'Greifswald':        (54.09, 13.38),
    'Schwerin':          (53.63, 11.40),
    'Bremen':            (53.07,  8.80),
    'Osnabrück':         (52.28,  8.05),
    # Nordrhein-Westfalen
    'Münster':           (51.96,  7.63),
    'Bielefeld':         (52.02,  8.53),
    'Paderborn':         (51.72,  8.76),
    'Dortmund':          (51.52,  7.47),
    'Bochum':            (51.48,  7.22),
    'Duisburg':          (51.43,  6.76),
    'Köln':              (50.94,  6.96),
    'Bonn':              (50.73,  7.10),
    'Wuppertal':         (51.27,  7.19),
    'Aachen':            (50.77,  6.08),
    # Niedersachsen / Mitte
    'Hannover':          (52.37,  9.72),
    'Braunschweig':      (52.27, 10.52),
    'Göttingen':         (51.54,  9.93),
    'Kassel':            (51.32,  9.50),
    # Ostdeutschland
    'Berlin':            (52.52, 13.41),
    'Potsdam':           (52.40, 13.07),
    'Frankfurt (Oder)':  (52.34, 14.55),
    'Cottbus':           (51.76, 14.33),
    'Magdeburg':         (52.13, 11.62),
    'Halle (Saale)':     (51.48, 11.97),
    'Leipzig':           (51.33, 12.37),
    'Erfurt':            (50.98, 11.03),
    'Jena':              (50.93, 11.59),
    'Dresden':           (51.05, 13.74),
    'Chemnitz':          (50.83, 12.92),
    # Rheinland-Pfalz / Saarland
    'Koblenz':           (50.36,  7.59),
    'Trier':             (49.75,  6.64),
    'Mainz':             (49.99,  8.27),
    'Kaiserslautern':    (49.44,  7.77),
    'Saarbrücken':       (49.23,  7.00),
    # Hessen
    'Frankfurt a.M.':    (50.11,  8.68),
    'Wiesbaden':         (50.08,  8.24),
    # Baden-Württemberg
    'Mannheim':          (49.48,  8.47),
    'Heidelberg':        (49.41,  8.71),
    'Karlsruhe':         (49.01,  8.40),
    'Heilbronn':         (49.14,  9.22),
    'Stuttgart':         (48.78,  9.18),
    'Reutlingen':        (48.49,  9.21),
    'Ulm':               (48.40,  9.98),
    'Freiburg':          (47.99,  7.85),
    # Bayern
    'Würzburg':          (49.80,  9.95),
    'Bamberg':           (49.90, 10.90),
    'Bayreuth':          (49.94, 11.58),
    'Nürnberg':          (49.45, 11.08),
    'Ingolstadt':        (48.76, 11.43),
    'Regensburg':        (49.02, 12.10),
    'Augsburg':          (48.37, 10.90),
    'Landshut':          (48.54, 12.15),
    'München':           (48.14, 11.58),
    'Rosenheim':         (47.86, 12.13),
    'Passau':            (48.57, 13.46),
}

YEARS = [2020, 2021, 2022, 2023, 2024, 2025]
BASE  = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature"
OUT   = Path(__file__).parent / "data" / "klima"


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def get_station_list():
    """Lädt DWD-Stationsliste und gibt Liste von (id, lat, lon, name) zurück."""
    url = f"{BASE}/historical/TU_Stundenwerte_Beschreibung_Stationen.txt"
    print("  Lade Stationsliste…")
    r = requests.get(url, timeout=60)
    r.encoding = 'latin-1'
    stations = []
    for line in r.text.split('\n')[2:]:
        parts = line.split()
        # DWD-Format: station_id  date_from  date_to  elevation  lat  lon  name...
        if len(parts) >= 6:
            try:
                sid      = int(parts[0])
                date_to  = int(parts[2])   # YYYYMMDD
                lat      = float(parts[4])
                lon      = float(parts[5])
                name     = ' '.join(parts[6:]) if len(parts) > 6 else ''
                # Nur aktive Stationen (Betrieb bis mindestens Anfang 2024)
                if date_to >= 20240101:
                    stations.append((sid, lat, lon, name))
            except Exception:
                pass
    print(f"  {len(stations)} Stationen gefunden")
    return stations


def nearest_station(stations, lat, lon):
    best, best_d = None, 1e9
    for sid, slat, slon, name in stations:
        d = haversine(lat, lon, slat, slon)
        if d < best_d:
            best_d, best = d, (sid, name)
    return best[0], best[1], best_d


def fetch_zip_temps(url):
    """Lädt ZIP, entpackt CSV, gibt dict {(year,month,day,hour): temp} zurück."""
    temps = {}
    try:
        r = requests.get(url, timeout=120)
        if r.status_code != 200:
            return temps
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            for name in zf.namelist():
                if name.startswith('produkt_'):
                    with zf.open(name) as f:
                        for line in f.read().decode('latin-1').split('\n')[1:]:
                            parts = line.split(';')
                            if len(parts) < 4:
                                continue
                            try:
                                dt   = parts[1].strip()
                                temp = float(parts[3].strip())
                                if temp <= -50:  # Fehlwert
                                    continue
                                year  = int(dt[0:4])
                                month = int(dt[4:6])
                                day   = int(dt[6:8])
                                hour  = int(dt[8:10])
                                temps[(year, month, day, hour)] = temp
                            except Exception:
                                pass
    except Exception as e:
        print(f"    Fehler beim Download: {e}")
    return temps


def download_station(staid):
    """Lädt historische + aktuelle Daten für eine Station."""
    # Dateiindex für historical
    hist_url = f"{BASE}/historical/"
    r = requests.get(hist_url, timeout=30)
    fnames = re.findall(rf'href="(stundenwerte_TU_{staid:05d}_[^"]+\.zip)"', r.text)

    temps = {}
    for fname in fnames:
        print(f"    hist: {fname}")
        temps.update(fetch_zip_temps(f"{hist_url}{fname}"))

    # Aktuelle Daten (letzte ~500 Tage)
    akt_url = f"{BASE}/recent/stundenwerte_TU_{staid:05d}_akt.zip"
    print(f"    akt:  {akt_url.split('/')[-1]}")
    temps.update(fetch_zip_temps(akt_url))

    return temps


def extract_year(temps, year):
    """Extrahiert 8760 Stundenwerte für ein Jahr (Schaltjahr: 29. Feb wird übersprungen)."""
    is_leap = (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0))
    result  = []
    last    = 0.0
    dt      = datetime.datetime(year, 1, 1, 0)
    delta   = datetime.timedelta(hours=1)

    while dt.year == year:
        if is_leap and dt.month == 2 and dt.day == 29:
            dt += delta
            continue
        key = (dt.year, dt.month, dt.day, dt.hour)
        if key in temps:
            last = temps[key]
        result.append(last)
        dt += delta

    return result[:8760]


def compute_tmy(yearly):
    """Typisches Meteorologisches Jahr: Median je Stunde über alle Jahre."""
    n    = 8760
    tmy  = []
    data = list(yearly.values())
    for h in range(n):
        vals = sorted(d[h] for d in data if h < len(d))
        tmy.append(vals[len(vals) // 2] if vals else 0.0)
    return tmy


def to_b64gz(temps):
    """Float-Liste → gzip-komprimiertes Int16×10 → base64."""
    raw        = struct.pack(f'<{len(temps)}h', *[max(-32768, min(32767, round(t * 10))) for t in temps])
    compressed = gzip.compress(raw, compresslevel=9)
    return base64.b64encode(compressed).decode('ascii')


def js_safe(name):
    return (name.replace('ä','ae').replace('ö','oe').replace('ü','ue')
                .replace('Ä','Ae').replace('Ö','Oe').replace('Ü','Ue')
                .replace(' ','_').replace('.',''))


# ── Haupt-Routine ─────────────────────────────────────────────────────────────

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stations = get_station_list()

    # Bereits vorhandene Dateien überspringen
    already_done = {f.stem for f in OUT.glob('*.js')}

    for stadtname, (lat, lon) in STAEDTE.items():
        if js_safe(stadtname) in already_done:
            print(f"  {stadtname}: bereits vorhanden – übersprungen")
            continue
        print(f"\n{'='*60}")
        print(f"  {stadtname}")
        staid, sta_name, dist = nearest_station(stations, lat, lon)
        print(f"  Station: {staid} – {sta_name} ({dist:.1f} km)")

        temps = download_station(staid)
        if not temps:
            print("  KEINE DATEN – übersprungen")
            continue

        yearly = {}
        for year in YEARS:
            data = extract_year(temps, year)
            n_valid = sum(1 for v in data if v != 0)
            t_mean = sum(data) / len(data) if data else 0
            if len(data) == 8760 and n_valid > 7000 and -5 <= t_mean <= 20:
                yearly[str(year)] = data
                print(f"  {year}: {n_valid}/8760 gültig, T_mean={t_mean:.1f}°C")
            elif not (-5 <= t_mean <= 20):
                print(f"  {year}: T_mean={t_mean:.1f}°C unplausibel – übersprungen")
            else:
                print(f"  {year}: zu wenig Daten ({n_valid}/8760) – übersprungen")

        if not yearly:
            print("  Kein Jahr mit ausreichend Daten – übersprungen")
            continue

        yearly['TMY'] = compute_tmy(yearly)
        t_mean = sum(yearly['TMY']) / len(yearly['TMY'])
        print(f"  TMY: T_mean={t_mean:.1f}°C")

        # JS-Datei schreiben
        lines = [
            f"// Klimadaten {stadtname} — DWD-Daten, automatisch generiert",
            "window.KLIMA_DATA = window.KLIMA_DATA || {};",
            f"window.KLIMA_DATA['{stadtname}'] = {{",
        ]
        for key, data in sorted(yearly.items()):
            b64    = to_b64gz(data)
            chunks = '\\\n    '.join(b64[i:i+100] for i in range(0, len(b64), 100))
            lines.append(f"  '{key}': '{chunks}',")
        lines.append("};")

        out = OUT / f"{js_safe(stadtname)}.js"
        out.write_text('\n'.join(lines), encoding='utf-8')
        size_kb = out.stat().st_size // 1024
        print(f"  → {out.name} ({size_kb} KB)")

    print(f"\n{'='*60}")
    print("✓ Fertig! Alle Dateien in data/klima/")
    print("  Nun Index.html öffnen — Klimajahr-Auswahl ist aktiv.")


if __name__ == '__main__':
    main()

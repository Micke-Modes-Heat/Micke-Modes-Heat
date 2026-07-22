// @ts-check
import { normalizeHourlyYear } from './time-series.js';

/** @param {string} text @param {{filename?:string}} [options] */
export function parsePvProfileCsv(text, {filename = 'PV-Profil.csv'} = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let values = [];
  let format = 'generic-hourly';
  let unitConversion = null;
  const headerIndex = lines.findIndex(line => {
    const cells = line.split(/[;,\t]/).map(v => v.trim().replace(/^"|"$/g, ''));
    return cells.includes('time') && cells.includes('P');
  });
  if (headerIndex >= 0) {
    format = 'pvgis-hourly-csv';
    const sep = lines[headerIndex].includes(';') ? ';' : lines[headerIndex].includes('\t') ? '\t' : ',';
    const headers = lines[headerIndex].split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
    const pIndex = headers.indexOf('P');
    for (const line of lines.slice(headerIndex + 1)) {
      const cells = line.split(sep);
      const timestamp = (cells[0] || '').replace(/^"|"$/g, '').trim();
      if (!/^\d{8}:\d{4}$/.test(timestamp)) continue;
      const watts = Number.parseFloat((cells[pIndex] || '').trim().replace(',', '.'));
      if (Number.isFinite(watts) && watts >= 0) values.push(watts / 1000);
    }
    unitConversion = 'PVGIS P: W → kW (stündlich zugleich kWh/h)';
  } else {
    values = lines.map(line => Number.parseFloat(line.replace(',', '.'))).filter(Number.isFinite);
  }
  const normalized = normalizeHourlyYear(values, {source: format === 'pvgis-hourly-csv' ? 'PVGIS modeled hourly CSV' : 'uploaded PV hourly series'});
  return {
    values: normalized.values,
    meta: {
      ...normalized.meta, filename, format, unit:'kWh/h', unitConversion,
      quality: format === 'pvgis-hourly-csv' ? 'modeled_external' : 'uploaded_unverified',
      importedAt: new Date().toISOString(),
      source: format === 'pvgis-hourly-csv' ? 'European Commission JRC PVGIS' : 'User-uploaded hourly PV profile',
      sourceUrl: format === 'pvgis-hourly-csv' ? 'https://re.jrc.ec.europa.eu/pvg_tools/en/' : null,
    },
  };
}

export function syntheticPvProfileMeta() {
  return {quality:'synthetic_screening', source:'Interne Monats-/Tagesform', format:'synthetic', unit:'normalized', sourceUrl:null};
}

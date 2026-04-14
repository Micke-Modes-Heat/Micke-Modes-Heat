// ── Event-Delegation für data-* Handler ──────────────────────────────────
// Ersetzt inline onclick/oninput/onchange — Handler-Code steht in data-Attributen.
import { CalcEngine } from './08-calc-engine.js';
import { OPT_INVEST_DEFAULT } from './config/optimizer-defaults.js';

(function() {
  function exec(el, code) {
    try { new Function('event', code).call(el, event); }
    catch(e) { console.error('Handler-Fehler:', code, e); }
  }

  document.addEventListener('click', function(event) {
    const el = event.target.closest('[data-click]');
    if (el) exec(el, el.dataset.click);
  });

  document.addEventListener('input', function(event) {
    const el = event.target.closest('[data-input]');
    if (el) exec(el, el.dataset.input);
  });

  document.addEventListener('change', function(event) {
    const el = event.target.closest('[data-change]');
    if (el) exec(el, el.dataset.change);
  });

  document.addEventListener('keydown', function(event) {
    const el = event.target.closest('[data-keydown]');
    if (el) exec(el, el.dataset.keydown);
  });
})();

// ── Spezielle addEventListener-Registrierungen ──────────────────────────
          document.getElementById('strom-gzf-methode').addEventListener('change', function() {
            document.getElementById('strom-gzf-manuell-wrap').style.display = this.value === 'manuell' ? '' : 'none';
          });
    document.getElementById('opt-erklaerung-details').addEventListener('toggle', function() {
      document.getElementById('opt-erklaerung-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
    });
    document.getElementById('opt-kosten-details').addEventListener('toggle', function() {
      document.getElementById('opt-kosten-arrow').style.transform = this.open ? 'rotate(90deg)' : '';
      if (this.open) _renderOptKostenUebersicht();
    });
    function _renderOptKostenUebersicht() {
      const wrap = document.getElementById('opt-kosten-content');
      if (!wrap) return;
      const pStrom = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
      const pGas = parseFloat(document.getElementById('wirt-p-gas')?.value) || 10;
      const pHko = parseFloat(document.getElementById('wirt-p-hko')?.value) || 10;
      const pFw = parseFloat(document.getElementById('wirt-p-fw')?.value) || 17;
      const pPk = parseFloat(document.getElementById('wirt-p-pk')?.value) || 8;
      const pHhs = parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6;
      const pCo2 = parseFloat(document.getElementById('wirt-p-co2')?.value) || 120;
      const zins = parseFloat(document.getElementById('wirt-zins')?.value) || 3.5;
      const lohn = parseFloat(document.getElementById('wirt-lohn')?.value) || 45;
      const pEinsp = parseFloat(document.getElementById('strom-preis-einsp')?.value) || 8;
      const pBhkwE = parseFloat(document.getElementById('bhkw-preis-einsp')?.value) || 8;
      const pBhkwKwk = parseFloat(document.getElementById('bhkw-kwk-einsp')?.value) || 8;
      const pBhkwEig = parseFloat(document.getElementById('bhkw-kwk-eigen')?.value) || 4;
      const co2Alle = document.getElementById('wirt-co2-alle')?.checked;

      // Vollständige Komponenten-Liste (alle Kostenbausteine nach VDI 2067 / KWW)
      const rows = [
        // Wärmeerzeuger
        {k:'lwwp',     label:'Luft-WP (Anlage)',inv:OPT_INVEST_DEFAULT.lwwp, unit:'€/kW', n:20, ih:1.0, wart:1.5, bed:5,   color:'#66bb6a', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'LuftWP'},
        {k:'fg',       label:'FG-WP (Anlage)',  inv:OPT_INVEST_DEFAULT.fg,   unit:'€/kW', n:20, ih:2.0, wart:1.0, bed:5,   color:'#29b6f6', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'FlussWP'},
        {k:'fg_ent',   label:'\u2514 Entnahmebauwerk', inv:300, unit:'€/kW', n:30, ih:2.0, wart:1.0, bed:100, color:'#29b6f6', fuel:'\u2014', grp:'erz'},
        {k:'geo',      label:'Geo-WP (Anlage)', inv:OPT_INVEST_DEFAULT.geo,  unit:'€/kW', n:20, ih:1.0, wart:1.5, bed:5,   color:'#a1887f', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'GeoWP'},
        {k:'geo_sond', label:'\u2514 Erdsondenbohrung',inv:95,  unit:'€/Bohrmeter', n:50, ih:2.0, wart:1.0, bed:0, color:'#a1887f', fuel:'\u2014', grp:'erz'},
        {k:'gaskessel',label:'Gaskessel',       inv:OPT_INVEST_DEFAULT.gaskessel, unit:'€/kW', n:20, ih:1.0, wart:2.0, bed:20, color:'#78909c', fuel:'Erdgas '+pGas+' ct', grp:'erz', ce:'Gaskessel'},
        {k:'bhkw',     label:'BHKW/KWK',       inv:OPT_INVEST_DEFAULT.bhkw, unit:'€/kW\u209c\u2095', n:15, ih:3.0, wart:3.5, bed:'100\u2013408', color:'#ff69b4', fuel:'Erdgas '+pGas+' ct', grp:'erz', ce:'BHKW'},
        {k:'bhkw_hyd', label:'\u2514 Hydraulik/Einbindung',inv:150, unit:'€/kW\u209c\u2095', n:25, ih:1.5, wart:1.0, bed:0, color:'#ff69b4', fuel:'\u2014', grp:'erz'},
        {k:'stromkessel',label:'Stromkessel',   inv:80,  unit:'€/kW', n:20, ih:1.0, wart:1.0, bed:0, color:'#ff8f00', fuel:'Strom '+pStrom+' ct', grp:'erz', ce:'Stromkessel'},
        {k:'pellets',  label:'Pelletkessel',    inv:OPT_INVEST_DEFAULT.pellets, unit:'€/kW', n:15, ih:3.0, wart:3.0, bed:'100\u2013408', color:'#ff7043', fuel:'Pellets '+pPk+' ct', grp:'erz', ce:'Pellets'},
        {k:'pk_lager', label:'\u2514 Pelletlager',inv:100, unit:'€/kW', n:20, ih:3.0, wart:2.0, bed:'50\u2013204', color:'#ff7043', fuel:'\u2014', grp:'erz'},
        {k:'hhs',      label:'Hackschnitzelkessel',inv:OPT_INVEST_DEFAULT.hhs, unit:'€/kW', n:15, ih:3.0, wart:3.0, bed:'150\u2013408', color:'#8d6e63', fuel:'HHS '+pHhs+' ct', grp:'erz', ce:'Hackschnitzel'},
        {k:'hhs_lager',label:'\u2514 HHS-Lager',inv:150, unit:'€/kW', n:30, ih:1.0, wart:1.0, bed:'100\u2013612', color:'#8d6e63', fuel:'\u2014', grp:'erz'},
        {k:'heizoel',  label:'Ölkessel',        inv:OPT_INVEST_DEFAULT.heizoel, unit:'€/kW', n:20, ih:1.0, wart:2.0, bed:20, color:'#455a64', fuel:'Heizöl '+pHko+' ct', grp:'erz', ce:'Heizoel'},
        {k:'fernwaerme',label:'Fernwärme (Üst.)',inv:OPT_INVEST_DEFAULT.fernwaerme, unit:'€/kW', n:20, ih:2.0, wart:1.0, bed:0, color:'#e53935', fuel:'FW '+pFw+' ct', grp:'erz'},
        // Solarthermie + Speicher
        {k:'st',       label:'Solarthermie',    inv:300,  unit:'€/m\u00b2', n:25, ih:1.0, wart:1.0, bed:0, color:'#ef6c00', fuel:'Sonne (0 ct)', grp:'zusatz'},
        {k:'ts',       label:'Wärmespeicher',   inv:'60\u201380', unit:'€/kWh\u209c\u2095', n:20, ih:1.0, wart:0.5, bed:0, color:'#26a69a', fuel:'\u2014', grp:'zusatz', note:'Puffer 80\u2013100 · Gro\u00df 60\u201380 · Saisonal ~40'},
        // PV + Batterie
        {k:'pv',       label:'PV-Anlage',       inv:OPT_INVEST_DEFAULT.pv, unit:'€/kWp', n:20, ih:1.0, wart:0.5, bed:0, color:'#ffd54f', fuel:'\u2014', grp:'strom', note:'Gr\u00f6\u00dfenabh. 600\u20131.400 €/kWp'},
        {k:'bat',      label:'Batterie',        inv:OPT_INVEST_DEFAULT.bat, unit:'€/kWh', n:15, ih:1.0, wart:0.5, bed:0, color:'#b39ddb', fuel:'\u2014', grp:'strom'},
        // Nebenkomponenten (Infrastruktur)
        {k:'schornstein',label:'Schornstein',   inv:60, unit:'€/kW\u209c\u2095', n:40, ih:1.0, wart:2.0, bed:0, color:'#616161', fuel:'\u2014', grp:'neben', note:'bei Feuerungsanlagen'},
        {k:'puffer',   label:'Pufferspeicher',  inv:'~175', unit:'€/kW (25L/kW \u00d7 7€/L)', n:20, ih:1.0, wart:1.0, bed:0, color:'#546e7a', fuel:'\u2014', grp:'neben'},
        {k:'schall',   label:'Schallschutz',    inv:75, unit:'€/kW', n:25, ih:0.5, wart:0.5, bed:0, color:'#78909c', fuel:'\u2014', grp:'neben', note:'bei Luft-WP, BHKW'},
        {k:'entstaub', label:'Entstaubung',     inv:'20\u201340k', unit:'€ pauschal', n:15, ih:2.0, wart:3.0, bed:100, color:'#795548', fuel:'\u2014', grp:'neben', note:'bei Biomasse >200 kW'},
        {k:'huest',    label:'Haus\u00fcbergabestationen', inv:'5\u201315k', unit:'€/Geb.', n:25, ih:1.0, wart:1.0, bed:0, color:'#607d8b', fuel:'\u2014', grp:'neben'},
        {k:'netzanschl',label:'Netzanschluss (Strom)',inv:40, unit:'€/kW\u2091\u2097', n:40, ih:0.5, wart:0, bed:0, color:'#9e9e9e', fuel:'\u2014', grp:'neben', note:'bei >500 kW\u2091\u2097'},
        {k:'waermenetz',label:'Wärmenetz (KMR)',inv:'\u2014', unit:'strangweise', n:50, ih:1.5, wart:0.5, bed:40, color:'#c62828', fuel:'\u2014', grp:'neben', note:'aus Netzplanung'},
        // Prozentuale Zuschläge
        {k:'bauteil',  label:'Bautechnik',      inv:'5%', unit:'der Basisinvest.', n:50, ih:1.0, wart:1.0, bed:0, color:'#9e9e9e', fuel:'\u2014', grp:'zuschlag'},
        {k:'hydr_elt', label:'Hydraulik + E-Technik',inv:'12%', unit:'der Basisinvest.', n:40, ih:1.0, wart:0, bed:0, color:'#9e9e9e', fuel:'\u2014', grp:'zuschlag'},
        {k:'planung',  label:'Planung + Projektsteuerung',inv:'10%', unit:'der Basisinvest.', n:20, ih:0, wart:0, bed:0, color:'#9e9e9e', fuel:'\u2014', grp:'zuschlag'},
        {k:'unvorg',   label:'Unvorhergesehenes',inv:'7%', unit:'der Basisinvest.', n:20, ih:0, wart:0, bed:0, color:'#9e9e9e', fuel:'\u2014', grp:'zuschlag'},
      ];

      let html = '<div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Investitions-, Nutzungsdauer- und Instandhaltungswerte der Optimierung. Energiepreise aus dem Wirtschaftlichkeits-Panel. VDI 2067 / KWW-Technikkatalog.</div>';

      // Energiepreise
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
      html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Energiepreise</span>';
      const ep = [
        ['Strom (Bezug)',pStrom,'ct/kWh'],['Erdgas',pGas,'ct/kWh'],['Heizöl',pHko,'ct/kWh'],
        ['Fernwärme',pFw,'ct/kWh'],['Pellets',pPk,'ct/kWh'],['HHS',pHhs,'ct/kWh'],
        ['PV-Einspeisung',pEinsp,'ct/kWh'],['BHKW-Einsp.',pBhkwE,'ct/kWh'],
        ['BHKW KWK-Netz',pBhkwKwk,'ct/kWh'],['BHKW KWK-Eigen',pBhkwEig,'ct/kWh'],
        ['CO\u2082-Ansatz',pCo2,'€/t' + (co2Alle ? ' (alle ET)' : ' (nur fossil)')],
      ];
      ep.forEach(([l,v,u]) => {
        html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;white-space:nowrap;">' + l + ': <b>' + v + '</b> ' + u + '</span>';
      });
      html += '</div>';

      // Kapital & Wirkungsgrade
      const etaGk = parseFloat(document.getElementById('gk-eta')?.value) || 92;
      const etaHko = parseFloat(document.getElementById('hko-eta')?.value) || 90;
      const etaPk = parseFloat(document.getElementById('pk-eta')?.value) || 88;
      const etaHhs = parseFloat(document.getElementById('hhs-eta')?.value) || 85;
      const etaBhkw = parseFloat(document.getElementById('bhkw-eta')?.value) || 88;
      const bhkwSkz = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
      html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Kapital &amp; Betrieb</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Kapitalzins: <b>' + zins + '</b> %</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Stundensatz: <b>' + lohn + '</b> €/h</span>';
      html += '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;">';
      html += '<span style="font-size:9px;font-weight:600;color:var(--text);width:100%;margin-bottom:2px;">Wirkungsgrade / Kennwerte</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Gaskessel: <b>'+etaGk+'</b> %</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Heizöl: <b>'+etaHko+'</b> %</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">Pellets: <b>'+etaPk+'</b> %</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">HHS: <b>'+etaHhs+'</b> %</span>';
      html += '<span style="font-size:10px;font-family:\'DM Mono\',monospace;">BHKW \u03B7\u209c\u2095: <b>'+etaBhkw+'</b> % · \u03C3: <b>'+bhkwSkz+'</b></span>';
      html += '</div>';

      // Komponenten-Tabelle
      const z = zins / 100;
      const grpLabels = {erz:'Wärmeerzeuger',zusatz:'Solarthermie &amp; Speicher',strom:'PV &amp; Batterie',neben:'Infrastruktur &amp; Nebenkomponenten',zuschlag:'Prozentuale Zuschläge'};
      html += '<div style="overflow-x:auto;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:\'DM Mono\',monospace;">';
      html += '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);color:var(--muted);font-size:9px;text-align:right;">';
      html += '<th style="text-align:left;padding:3px 6px;">Komponente</th>';
      html += '<th style="padding:3px 6px;">Invest</th>';
      html += '<th style="padding:3px 6px;">Nutzung (a)</th>';
      html += '<th style="padding:3px 6px;">IH (% p.a.)</th>';
      html += '<th style="padding:3px 6px;">Wartung (% p.a.)</th>';
      html += '<th style="padding:3px 6px;">Bedienung (h/a)</th>';
      html += '<th style="padding:3px 6px;">Brennstoff / Hinweis</th>';
      html += '</tr></thead><tbody>';

      // CalcEngine Beispielwerte bei 200 kW (falls verfügbar)
      const ceAvail = typeof CalcEngine !== 'undefined';

      let lastGrp = '';
      rows.forEach(r => {
        if (r.grp !== lastGrp) {
          lastGrp = r.grp;
          html += '<tr><td colspan="7" style="padding:6px 6px 2px;font-size:9px;font-weight:600;color:var(--accent);border-bottom:1px solid rgba(255,255,255,0.06);">'+grpLabels[r.grp]+'</td></tr>';
        }
        const n = r.n;
        const ann = z > 0 && n > 0 ? (z * Math.pow(1+z,n) / (Math.pow(1+z,n)-1) * 100).toFixed(1) : (n > 0 ? (100/n).toFixed(1) : '\u2014');
        const isSub = r.label.startsWith('\u2514');
        const bedStr = (typeof r.bed === 'string') ? r.bed : (r.bed > 0 ? r.bed : '\u2014');
        // Dynamischer Invest aus CalcEngine (Beispiel 200 kW)
        let invDisplay = '' + r.inv;
        if (r.ce && ceAvail) {
          const ce200 = Math.round(CalcEngine.investEurProKw(r.ce, 200));
          const ce50 = Math.round(CalcEngine.investEurProKw(r.ce, 50));
          if (ce200 > 0) invDisplay = ce50+'/'+ce200+' <span style="color:var(--muted);font-size:7px;">50/200kW</span>';
        }
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);'+(isSub?'opacity:0.75;':'')+'">';
        html += '<td style="padding:3px 6px;text-align:left;'+(isSub?'padding-left:20px;':'')+'"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+r.color+';vertical-align:middle;margin-right:5px;'+(isSub?'opacity:0.4;':'')+'"></span>'+r.label+'</td>';
        html += '<td style="padding:3px 6px;text-align:right;">'+invDisplay+' <span style="color:var(--muted);font-size:8px;">'+r.unit+'</span></td>';
        html += '<td style="padding:3px 6px;text-align:right;">'+n+' <span style="color:var(--muted);font-size:8px;">('+ann+'%)</span></td>';
        html += '<td style="padding:3px 6px;text-align:right;">'+(typeof r.ih === 'number' ? r.ih.toFixed(1) : r.ih)+'</td>';
        html += '<td style="padding:3px 6px;text-align:right;">'+(typeof r.wart === 'number' ? r.wart.toFixed(1) : r.wart)+'</td>';
        html += '<td style="padding:3px 6px;text-align:right;">'+bedStr+'</td>';
        html += '<td style="padding:3px 6px;text-align:right;font-size:9px;color:var(--muted);">'+(r.note || r.fuel)+'</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      html += '<div style="margin-top:6px;font-size:8px;color:var(--muted);">'
        + (ceAvail ? 'Invest-Spalte zeigt leistungsabhängige Werte aus CalcEngine (KWW-Technikkatalog 12/2025) bei 50 und 200 kW.'
                   : 'Invest = pauschale Fallback-Werte. CalcEngine nicht geladen — im Normalbetrieb werden leistungsabhängige Kostenkurven verwendet.')
        + ' IH/Wartung/Bedienung nach VDI 2067. Annuität = Kapitalwiedergewinnungsfaktor bei '+zins+'% Zins.'
        + ' Bedienung wird mit '+lohn+' €/h bewertet.</div>';
      wrap.innerHTML = html;
    }

const H = 8760;
const THETA_0=40;
const SIGLINDE={
  HEF34:{A:1.3819663,B:-37.4124155,C:6.1723179,D:0.0396284,mh:-0.0672159,bh:1.1167138,mw:-0.0019982,bw:0.135507},
  HMF34:{A:1.0443538,B:-35.0333754,C:6.2240634,D:0.0502917,mh:-0.053583,bh:0.9995901,mw:-0.0021758,bw:0.1633299},
  GMK34:{A:1.3284913,B:-35.8715062,C:7.5186829,D:0.017554,mh:-0.0758983,bh:1.1942555,mw:-0.000898,bw:0.0603337},
  GKO34:{A:1.4256684,B:-36.6590504,C:7.6083226,D:0.0371116,mh:-0.0809359,bh:1.2364527,mw:-0.0007628,bw:0.1002979},
  GBD34:{A:1.5175792,B:-37.5,C:6.8,D:0.0295801,mh:-0.0788559,bh:1.216125,mw:-0.0013134,bw:0.0968721},
  GHD34:{A:1.25696,B:-36.6078453,C:7.321187,D:0.077696,mh:-0.0696826,bh:1.1379702,mw:-0.0008522,bw:0.1921068},
};

function sigH(theta,p) {
  const diff=theta-THETA_0;
  const denominator=Math.abs(diff)<1e-10 ? (diff<0 ? -1e-10 : 1e-10) : diff;
  return p.A/(1+Math.pow(p.B/denominator,p.C))+p.D+
    Math.max(p.mh*theta+p.bh,p.mw*theta+p.bw);
}

// SigLinDe liefert die temperaturabhängige Tagesmenge. Diese Archetypen
// ergänzen ausschließlich die Verteilung innerhalb von Tag und Woche.
const ARCHETYPES = {
  efh: {
    label:'Einfamilienhaus',sig:'HEF34',baseShare:0.18,weekend:1,
    weekday:[.48,.42,.40,.42,.55,.82,1.18,1.30,1.05,.82,.70,.64,.62,.62,.66,.74,.92,1.18,1.32,1.30,1.14,.92,.70,.56],
  },
  mfh: {
    label:'Mehrfamilienhaus',sig:'HMF34',baseShare:0.22,weekend:1.04,
    weekday:[.58,.53,.50,.52,.62,.84,1.12,1.25,1.08,.88,.76,.70,.68,.68,.72,.80,.96,1.14,1.26,1.25,1.12,.94,.76,.64],
  },
  buero: {
    label:'Büro und Verwaltung',sig:'GBD34',baseShare:0.04,weekend:0.25,
    weekday:[.25,.24,.23,.24,.30,.58,1.18,1.48,1.36,1.20,1.10,1.05,1.02,1.02,1.06,1.12,1.04,.80,.55,.40,.33,.29,.27,.25],
  },
  schule: {
    label:'Schule und Kita',sig:'GKO34',baseShare:0.06,weekend:0.16,
    weekday:[.20,.19,.18,.20,.28,.72,1.42,1.58,1.34,1.20,1.12,1.05,1.00,.94,.82,.62,.45,.34,.28,.25,.23,.22,.21,.20],
  },
  industrie: {
    label:'Industrie und Produktion',sig:'GMK34',baseShare:0.18,weekend:0.55,
    weekday:[.48,.46,.45,.47,.60,.92,1.12,1.18,1.18,1.17,1.16,1.15,1.14,1.14,1.14,1.12,1.05,.92,.75,.62,.56,.52,.50,.48],
  },
  oeffentlich: {
    label:'Öffentliches Gebäude',sig:'GKO34',baseShare:0.08,weekend:0.35,
    weekday:[.28,.27,.26,.27,.34,.64,1.18,1.38,1.30,1.20,1.14,1.10,1.08,1.08,1.10,1.08,.96,.76,.58,.46,.39,.34,.31,.29],
  },
  ghd: {
    label:'Gewerbe, Handel und Dienstleistung',sig:'GHD34',baseShare:0.10,weekend:0.48,
    weekday:[.34,.32,.31,.32,.39,.66,1.08,1.28,1.26,1.20,1.16,1.13,1.10,1.10,1.11,1.10,1.00,.84,.68,.55,.46,.40,.37,.35],
  },
};

const FALLBACK = ARCHETYPES.ghd;
// Erweiterte Nutzungen erhalten bis zur fachlichen Ausarbeitung eigener
// Wärme-Archetypen eine explizite, nachvollziehbare Referenz. Dadurch fällt
// kein neuer Gebäudetyp unbemerkt auf das allgemeine GHD-Profil zurück.
const ARCHETYPE_ALIASES = {
  unterkunft:'mfh', wohnheim:'mfh', kaserne:'mfh', pflegeheim:'mfh', hotel:'mfh', krankenhaus:'mfh',
  kita:'schule', hochschule:'schule',
  verwaltung:'buero', bibliothek:'buero', arztpraxis:'buero', justiz:'oeffentlich',
  polizei:'oeffentlich', feuerwehr:'oeffentlich', rettungswache:'oeffentlich',
  sporthalle:'oeffentlich', schwimmbad:'oeffentlich', kultur:'oeffentlich', sakral:'oeffentlich',
  kantine:'ghd', werkstatt:'industrie', lager:'industrie', technik:'industrie', labor:'industrie',
};

function archetypeFor(building) {
  const requested=building?.heatProfileType || building?.nutzung;
  return ARCHETYPES[requested] || ARCHETYPES[ARCHETYPE_ALIASES[requested]] || FALLBACK;
}

function normalizeInto(out,raw,totalKwh,share) {
  let sum=0;
  for (let i=0;i<raw.length;i++) sum+=raw[i];
  if (!(sum>0) || !(totalKwh>0) || !(share>0)) return;
  const factor=totalKwh*share/sum;
  for (let i=0;i<raw.length;i++) out[i]+=raw[i]*factor;
}

function constrainPeak(profile,maximumKw) {
  const result={adjustedDays:0,conflictDays:[]};
  if (!(maximumKw>0)) return result;
  for (let day=0;day<365;day++) {
    const start=day*24,end=start+24;
    let dayEnergy=0,excess=0,capacity=0;
    for (let i=start;i<end;i++) {
      dayEnergy+=profile[i];
      if (profile[i]>maximumKw) excess+=profile[i]-maximumKw;
      else capacity+=maximumKw-profile[i];
    }
    if (excess<1e-5) continue;
    if (dayEnergy>maximumKw*24+1e-3 || capacity+1e-5<excess) {
      result.conflictDays.push({day,requiredKwh:dayEnergy,maximumKwh:maximumKw*24});
      continue;
    }
    result.adjustedDays++;
    for (let i=start;i<end;i++) {
      if (profile[i]>maximumKw) profile[i]=maximumKw;
      else profile[i]+=excess*(maximumKw-profile[i])/capacity;
    }
    // Float32-Rundungen dürfen die feste Tagesbilanz nicht auf andere Tage
    // verlagern. Eine kleine Restdifferenz bleibt innerhalb dieses Tages.
    let correctedEnergy=0;
    for (let i=start;i<end;i++) correctedEnergy+=profile[i];
    const difference=dayEnergy-correctedEnergy;
    if (Math.abs(difference)>1e-6) {
      for (let i=start;i<end;i++) {
        const room=maximumKw-profile[i];
        if (room<=0) continue;
        const correction=Math.max(-profile[i],Math.min(room,difference));
        profile[i]+=correction;
        break;
      }
    }
  }
  return result;
}

export function buildBuildingHeatProfile(building,tempH,annualMwh,maximumKw,year=2026) {
  const archetype=archetypeFor(building);
  const weatherRaw=new Float64Array(H);
  const baseRaw=new Float64Array(H);
  const days=Math.min(365,Math.floor((tempH?.length || 0)/24));
  const firstDay=new Date(Date.UTC(Number(year)||2026,0,1)).getUTCDay();
  const params=SIGLINDE[archetype.sig] || SIGLINDE.GHD34;
  for (let day=0;day<days;day++) {
    let mean=0;
    for (let hour=0;hour<24;hour++) mean+=Number(tempH[day*24+hour])||0;
    mean/=24;
    const weekDay=(firstDay+day)%7;
    const weekend=weekDay===0 || weekDay===6;
    const dayFactor=weekend ? archetype.weekend : 1;
    const weather=Math.max(0,sigH(mean,params))*dayFactor;
    let scheduleSum=0;
    for (const value of archetype.weekday) scheduleSum+=value;
    for (let hour=0;hour<24;hour++) {
      const index=day*24+hour;
      const schedule=archetype.weekday[hour]/scheduleSum;
      weatherRaw[index]=weather*schedule;
      // Grundlast bleibt weniger wetterabhängig, folgt aber den Nutzungszeiten.
      baseRaw[index]=(0.45+0.55*schedule*24)*(weekend ? Math.max(.45,archetype.weekend) : 1);
    }
  }
  const result=new Float32Array(H);
  const totalKwh=Math.max(0,Number(annualMwh)||0)*1000;
  normalizeInto(result,weatherRaw,totalKwh,1-archetype.baseShare);
  normalizeInto(result,baseRaw,totalKwh,archetype.baseShare);
  const peakConstraint=constrainPeak(result,Number(maximumKw)||0);
  return {
    values:result,
    meta:{
      type:Object.entries(ARCHETYPES).find(([,value])=>value===archetype)?.[0] || 'ghd',
      label:archetype.label,
      sigLinDe:archetype.sig,
      baseShare:archetype.baseShare,
      annualMwh:result.reduce((sum,value)=>sum+value,0)/1000,
      peakKw:Math.max(...result),
      peakAdjustedDays:peakConstraint.adjustedDays,
      peakConflictDays:peakConstraint.conflictDays,
    },
  };
}

export function buildBuildingHeatProfiles(buildings,tempH,year,getStats,isExcluded=()=>false) {
  const aggregate=new Float32Array(H);
  const profiles=new Map();
  for (const building of buildings || []) {
    if (isExcluded(building.id)) continue;
    const stats=getStats(building,year);
    if (!stats || stats.status==='geplant' || stats.status==='abgerissen' || !(stats.waerme>0)) continue;
    const profile=buildBuildingHeatProfile(building,tempH,stats.waerme,stats.heizlast,year);
    profiles.set(building.id,profile);
    for (let i=0;i<H;i++) aggregate[i]+=profile.values[i];
  }
  return {aggregate,profiles};
}

export function getBuildingHeatProfileMeta(building) {
  const archetype=archetypeFor(building);
  return {
    type:Object.entries(ARCHETYPES).find(([,value])=>value===archetype)?.[0] || 'ghd',
    label:archetype.label,
    sigLinDe:archetype.sig,
    baseShare:archetype.baseShare,
  };
}

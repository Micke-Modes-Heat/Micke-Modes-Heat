// @ts-check
import { ASSETS } from '../13a-assets-core.js';
import { activeVariantId, baseErzeugerSnapshot, baseNetzSnapshot, baseStromNetzSnapshot, gebaeude, phasen, setActiveVariantId, setBaseErzeugerSnapshot, setBaseNetzSnapshot, setBaseStromNetzSnapshot, setPhasen, varianten } from '../01-globals-varianten.js';
import { clusters } from '../14f-cluster-core.js';
import { runStateTransaction } from './state-transaction.js';

const RUNTIME_KEYS = new Set(['_marker','marker','layer','_layer','popup','tooltip']);
/** @typedef {Record<string, any>} AnyRecord */
/** @typedef {{assets:AnyRecord[],legacyEdges:AnyRecord[],selectedId:any,buildingMeasures:Array<{id:any,massnahmen:AnyRecord[]}>,clusters:AnyRecord[],phasen:AnyRecord[],varianten:AnyRecord[],activeVariantId:any,baseNetz:any,baseErzeuger:any,baseStrom:any,runtimeVariant:any}} PlanningSnapshot */
/** @type {Array<{label:string,at:string,before:PlanningSnapshot}>} */
const history = [];
let transactionDepth = 0;
let transactionSuspended = 0;

/** @param {any} value @param {WeakSet<object>} [seen] @returns {any} */
function plain(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map(v => plain(v, seen));
  if (ArrayBuffer.isView(value)) return Array.from(/** @type {any} */(value));
  /** @type {AnyRecord} */
  const out = {};
  for (const [key,val] of Object.entries(value)) {
    if (RUNTIME_KEYS.has(key) || typeof val === 'function') continue;
    const cloned = plain(val, seen);
    if (cloned !== undefined) out[key] = cloned;
  }
  return out;
}

export function capturePlanningState() {
  const runtimeVariant = typeof window !== 'undefined' ? {
    netz:window.captureNetzState?.(), erzeuger:window.captureErzeugerState?.(), strom:window.captureStromNetzState?.(),
  } : null;
  return {
    assets:plain(ASSETS.items), legacyEdges:plain(ASSETS.edges), selectedId:ASSETS.selectedId,
    buildingMeasures:gebaeude.map(g => ({id:g.id,massnahmen:plain(g.massnahmen || [])})),
    clusters:plain(clusters), phasen:plain(phasen), varianten:plain(varianten), activeVariantId,
    baseNetz:plain(baseNetzSnapshot),baseErzeuger:plain(baseErzeugerSnapshot),baseStrom:plain(baseStromNetzSnapshot),runtimeVariant:plain(runtimeVariant),
  };
}

/** @param {PlanningSnapshot} snapshot */
function restoreAssets(snapshot) {
  const assetItems = /** @type {AnyRecord[]} */ (ASSETS.items);
  const current = new Map(assetItems.map(item => [item.id,item]));
  const restored = snapshot.assets.map(saved => {
    const live = current.get(saved.id);
    if (!live) return saved;
    const runtime = Object.fromEntries(Object.entries(live).filter(([key,val]) => RUNTIME_KEYS.has(key) || typeof val === 'function'));
    for (const key of Object.keys(live)) if (!(key in runtime)) delete live[key];
    Object.assign(live,saved,runtime);
    current.delete(saved.id);
    return live;
  });
  for (const removed of current.values()) removed._marker?.remove?.();
  assetItems.splice(0,assetItems.length,...restored);
}

/** @param {PlanningSnapshot} snapshot */
export function restorePlanningState(snapshot) {
  restoreAssets(snapshot);
  const legacyEdges = /** @type {AnyRecord[]} */ (ASSETS.edges);
  legacyEdges.splice(0,legacyEdges.length,...plain(snapshot.legacyEdges));
  ASSETS.selectedId = snapshot.selectedId;
  const measures = new Map(snapshot.buildingMeasures.map(row => [row.id,row.massnahmen]));
  for (const g of gebaeude) if (measures.has(g.id)) g.massnahmen = plain(measures.get(g.id));
  clusters.splice(0,clusters.length,...plain(snapshot.clusters));
  setPhasen(plain(snapshot.phasen));
  varianten.splice(0,varianten.length,...plain(snapshot.varianten));
  setBaseNetzSnapshot(plain(snapshot.baseNetz));
  setBaseErzeugerSnapshot(plain(snapshot.baseErzeuger));
  setBaseStromNetzSnapshot(plain(snapshot.baseStrom));
  setActiveVariantId(snapshot.activeVariantId);
  if (snapshot.runtimeVariant && typeof window !== 'undefined') {
    window.applyNetzState?.(snapshot.runtimeVariant.netz);
    window.applyErzeugerState?.(snapshot.runtimeVariant.erzeuger);
    window.applyStromNetzState?.(snapshot.runtimeVariant.strom);
  }
}

/** @param {string} label @param {AnyRecord[]} rows */
function assertUnique(label, rows) {
  const seen = new Set();
  for (const row of rows) {
    if (row?.id == null || row.id === '') throw new Error(`${label} ohne ID`);
    if (seen.has(String(row.id))) throw new Error(`Doppelte ${label}-ID: ${row.id}`);
    seen.add(String(row.id));
  }
  return seen;
}

/** @param {PlanningSnapshot} [state] */
export function validatePlanningState(state = capturePlanningState()) {
  assertUnique('Asset',state.assets);
  const phaseIds = assertUnique('Phase',state.phasen);
  const clusterIds = assertUnique('Cluster',state.clusters);
  const variantIds = assertUnique('Variante',state.varianten);
  if (state.activeVariantId != null && !variantIds.has(String(state.activeVariantId))) throw new Error(`Unbekannte aktive Variante ${state.activeVariantId}`);
  for (const p of state.phasen) {
    if (Number(p.jahrVon) > Number(p.jahrBis)) throw new Error(`Phase ${p.id}: Startjahr liegt nach Endjahr`);
    if (p.variantId != null && !variantIds.has(String(p.variantId))) throw new Error(`Phase ${p.id}: unbekannte Variante ${p.variantId}`);
  }
  const measures = [];
  for (const a of state.assets) for (const m of (a.massnahmen || [])) measures.push(m);
  for (const g of state.buildingMeasures) for (const m of (g.massnahmen || [])) measures.push(m);
  const measureIds = assertUnique('Maßnahme',measures);
  for (const m of measures) {
    if (m.phaseId != null && !phaseIds.has(String(m.phaseId))) throw new Error(`Maßnahme ${m.id}: unbekannte Phase ${m.phaseId}`);
    if (m.clusterId != null && !clusterIds.has(String(m.clusterId))) throw new Error(`Maßnahme ${m.id}: unbekannter Cluster ${m.clusterId}`);
    for (const dep of (m.dependsOn || [])) {
      if (String(dep) === String(m.id)) throw new Error(`Maßnahme ${m.id}: Selbstabhängigkeit`);
      if (!measureIds.has(String(dep))) throw new Error(`Maßnahme ${m.id}: unbekannte Abhängigkeit ${dep}`);
    }
  }
  const byId = new Map(measures.map(m => [String(m.id),m]));
  const visiting = new Set(), done = new Set();
  /** @param {string} id */
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Zyklische Maßnahmenabhängigkeit bei ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of (byId.get(id)?.dependsOn || [])) visit(String(dep));
    visiting.delete(id); done.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return true;
}

/** @template R @param {string} label @param {()=>R} mutate */
export function runPlanningTransaction(label, mutate) {
  if (transactionSuspended > 0) return mutate();
  if (transactionDepth > 0) return mutate();
  const historyLength = history.length;
  transactionDepth++;
  try {
    return runStateTransaction({label,capture:capturePlanningState,restore:restorePlanningState,mutate,validate:validatePlanningState,
      onCommit(before) {
        history.push({label,at:new Date().toISOString(),before});
        if (history.length > 20) history.shift();
        if (typeof window !== 'undefined') window._lastPlanningTransaction = {label,at:history[history.length-1].at};
      }});
  } catch (error) {
    // Auch Seiteneffekte verschachtelter Wiederherstellungsroutinen dürfen bei
    // einem Rollback keinen scheinbar erfolgreichen Undo-Eintrag hinterlassen.
    history.length = historyLength;
    throw error;
  }
  finally { transactionDepth--; }
}

export function undoLastPlanningTransaction() {
  const entry = history.pop();
  if (!entry) return false;
  transactionSuspended++;
  try {
    restorePlanningState(entry.before);
    validatePlanningState();
    return true;
  } catch (error) {
    // Ein fehlgeschlagenes Undo bleibt erneut verfügbar, statt still verloren
    // zu gehen. Interne Lösch-/Aufbauoperationen erzeugen dabei keine Historie.
    history.push(entry);
    throw error;
  } finally {
    transactionSuspended--;
  }
}

export function getPlanningTransactionHistory() { return history.map(({label,at}) => ({label,at})); }
export function clearPlanningTransactionHistory() { history.length = 0; }

/** Für bereits selbst transaktionale Gesamtimporte; erzeugt keine Teilhistorie. */
/** @template R @param {()=>R} mutate @returns {R} */
export function withoutPlanningTransactions(mutate) {
  transactionSuspended++;
  try { return mutate(); }
  finally { transactionSuspended--; }
}

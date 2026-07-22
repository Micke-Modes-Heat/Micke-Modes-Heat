// @ts-check
const DATABASES=['micke-heat-autosave','feldapp-db'];
const STORAGE_KEYS=['energiekarte_autosave','live-flow-mode','live-flow-mode-v2','slp_vorlagen','windGwaUrl'];
const CACHE_PREFIXES=['micke-heat','energieplanung','feldapp-'];

/** @param {string} name */
function deleteDatabase(name){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){resolve(false);return;}
    const request=indexedDB.deleteDatabase(name);
    request.onsuccess=()=>resolve(true);
    request.onerror=()=>reject(request.error || new Error(`Datenbank ${name} konnte nicht gelöscht werden`));
    request.onblocked=()=>reject(new Error(`Datenbank ${name} ist noch in einem anderen Tab geöffnet`));
  });
}

/** Löscht ausschließlich bekannte Daten dieser App auf der aktuellen Origin. */
export async function clearAllLocalAppData(){
  const databases=[];
  for(const name of DATABASES) if(await deleteDatabase(name)) databases.push(name);
  const storage=[];
  if(typeof localStorage!=='undefined') for(const key of STORAGE_KEYS){
    if(localStorage.getItem(key)!==null) storage.push(key);
    localStorage.removeItem(key);
  }
  const cacheNames=[];
  if(typeof caches!=='undefined') for(const name of await caches.keys()){
    if(CACHE_PREFIXES.some(prefix=>name.startsWith(prefix)) && await caches.delete(name)) cacheNames.push(name);
  }
  return {databases,storage,cacheNames};
}

export function showPrivacyPanel(){ document.getElementById('privacy-panel')?.classList.add('visible'); }

export async function deleteAllLocalAppData(){
  const appWindow=typeof window!=='undefined' ? /** @type {any} */ (window) : null;
  const confirmFn=appWindow?.epConfirm;
  const confirmed=confirmFn ? await confirmFn('Alle lokalen App-Daten löschen','Autosaves, Feldfotos, Notizen, Offline-Karten und lokale Einstellungen werden auf diesem Gerät unwiderruflich gelöscht. Bitte vorher benötigte Projekte und Feld-Daten exportieren.',{danger:true,okText:'Alles lokal löschen'}) : false;
  if(!confirmed) return false;
  try{
    const result=await clearAllLocalAppData();
    appWindow?.showHint?.(`Lokale App-Daten gelöscht (${result.databases.length} Datenbanken, ${result.storage.length} Einstellungen, ${result.cacheNames.length} Caches).`,7000);
    return result;
  }catch(error){
    appWindow?.showHint?.(`Löschen nicht vollständig: ${error instanceof Error?error.message:String(error)}`,9000);
    throw error;
  }
}

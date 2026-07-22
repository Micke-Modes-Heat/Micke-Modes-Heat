// @ts-check
/** @typedef {{id:string,at:string,severity:'info'|'warning'|'error',area:string,message:string,action:string}} Diagnostic */
/** @type {Diagnostic[]} */
const entries=[];
let seq=0;

/** @param {{severity?:Diagnostic['severity'],area?:string,message:string,action?:string}} item */
export function reportDiagnostic(item){
  const entry={id:`diag_${++seq}`,at:new Date().toISOString(),severity:item.severity||'error',area:item.area||'Allgemein',message:String(item.message),action:item.action||'Vorgang erneut versuchen oder Projekt exportieren und neu laden.'};
  entries.unshift(entry); if(entries.length>100) entries.length=100; renderDiagnostics(); return entry;
}
export function getDiagnostics(){return entries.map(x=>({...x}));}
export function clearDiagnostics(){entries.length=0;renderDiagnostics();}
export function showDiagnostics(){document.getElementById('diagnostics-panel')?.classList.add('visible');renderDiagnostics();}
export function renderDiagnostics(){
  if(typeof document==='undefined')return;
  const list=document.getElementById('diagnostics-list'),badge=document.getElementById('diagnostics-badge');
  if(badge){badge.textContent=String(entries.length);badge.style.display=entries.length?'inline-flex':'none';}
  if(!list)return;
  list.replaceChildren(...entries.map(entry=>{
    const row=document.createElement('div');row.style.cssText='padding:9px;border-bottom:1px solid var(--border);font-size:11px;line-height:1.45;';
    const title=document.createElement('div');title.style.color=entry.severity==='error'?'#ef9a9a':entry.severity==='warning'?'#ffd54f':'#90caf9';title.textContent=`${entry.area} · ${new Date(entry.at).toLocaleString('de-DE')}`;
    const msg=document.createElement('div');msg.textContent=entry.message;
    const action=document.createElement('div');action.style.color='var(--muted)';action.textContent=`Nächster Schritt: ${entry.action}`;
    row.append(title,msg,action);return row;
  }));
  if(!entries.length){const empty=document.createElement('div');empty.style.cssText='padding:18px;color:var(--muted);text-align:center;';empty.textContent='Keine gemeldeten Probleme in dieser Sitzung.';list.append(empty);}
}

export function installGlobalDiagnostics(){
  if(typeof window==='undefined')return;
  const appWindow=/** @type {any} */(window);
  if(appWindow._diagnosticsInstalled)return;
  appWindow._diagnosticsInstalled=true;
  window.addEventListener('error',event=>reportDiagnostic({area:'Laufzeit',message:event.message,action:'Betroffenen Schritt erneut versuchen; bei Wiederholung Diagnose exportieren.'}));
  window.addEventListener('unhandledrejection',event=>reportDiagnostic({area:'Hintergrundvorgang',message:event.reason instanceof Error?event.reason.message:String(event.reason),action:'Netzverbindung und Eingaben prüfen; Vorgang erneut starten.'}));
}

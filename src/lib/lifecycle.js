// @ts-check

export class LifecycleScope {
  /** @param {string} name */
  constructor(name) {
    this.name=name;
    /** @type {Array<()=>void>} */
    this.cleanups=[];
    this.disposed=false;
  }
  /** @param {()=>void} cleanup */
  add(cleanup) {
    if (this.disposed) { cleanup(); return cleanup; }
    this.cleanups.push(cleanup); return cleanup;
  }
  /** @param {EventTarget} target @param {string} type @param {EventListenerOrEventListenerObject} listener @param {AddEventListenerOptions|boolean} [options] */
  listen(target,type,listener,options) {
    target.addEventListener(type,listener,options);
    return this.add(()=>target.removeEventListener(type,listener,options));
  }
  /** @param {{on:(type:string,listener:(...args:any[])=>void)=>any,off:(type:string,listener:(...args:any[])=>void)=>any}} target @param {string} type @param {(...args:any[])=>void} listener */
  mapOn(target,type,listener) {
    target.on(type,listener); return this.add(()=>target.off(type,listener));
  }
  /** @param {()=>void} callback @param {number} delay */
  timeout(callback,delay) {
    const id=setTimeout(()=>{ this.cleanups=this.cleanups.filter(fn=>fn!==cleanup); if(!this.disposed) callback(); },delay);
    const cleanup=()=>clearTimeout(id); this.add(cleanup); return id;
  }
  /** @param {()=>void} callback @param {number} delay */
  interval(callback,delay) {
    const id=setInterval(()=>{ if(!this.disposed) callback(); },delay);
    this.add(()=>clearInterval(id)); return id;
  }
  /** Beendet Listener/Timer in umgekehrter Registrierungsreihenfolge. */
  dispose() {
    if(this.disposed) return;
    this.disposed=true;
    const errors=[];
    for(const cleanup of this.cleanups.splice(0).reverse()) try{cleanup();}catch(error){errors.push(error);}
    if(errors.length) {
      const error=new Error(`Lifecycle „${this.name}“ konnte nicht vollständig beendet werden (${errors.length} Fehler)`);
      /** @type {any} */ (error).causes=errors;
      throw error;
    }
  }
}

export const appLifecycle = new LifecycleScope('app');
/** @param {string} name */
export function createLifecycleScope(name){ return new LifecycleScope(name); }

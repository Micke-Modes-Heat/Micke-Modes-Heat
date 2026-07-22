// @ts-check

export class StateTransactionError extends Error {
  /** @param {string} label @param {unknown} cause */
  constructor(label, cause) {
    super(`Transaktion „${label}“ zurückgerollt: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StateTransactionError';
    this.cause = cause;
  }
}

/**
 * Synchroner atomarer Zustandswechsel mit Validierung und garantiertem Rollback.
 * @template T,R
 * @param {{label:string,capture:()=>T,restore:(snapshot:T)=>void,mutate:()=>R,validate?:()=>void,onCommit?:(before:T)=>void}} tx
 */
export function runStateTransaction(tx) {
  const before = tx.capture();
  try {
    const result = tx.mutate();
    if (result && typeof result === 'object' && typeof /** @type {any} */ (result).then === 'function') {
      throw new TypeError('Asynchrone Mutatoren sind in synchronen Zustandstransaktionen nicht zulässig');
    }
    tx.validate?.();
    tx.onCommit?.(before);
    return result;
  } catch (error) {
    try { tx.restore(before); }
    catch (restoreError) {
      const rollbackError = new Error(`Transaktion „${tx.label}“ und Rollback fehlgeschlagen: ${String(restoreError)}`);
      /** @type {any} */ (rollbackError).cause = error;
      throw rollbackError;
    }
    throw new StateTransactionError(tx.label, error);
  }
}

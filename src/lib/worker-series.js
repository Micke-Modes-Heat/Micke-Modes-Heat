// @ts-check

/** @param {ArrayLike<number>} source @param {boolean} shared */
export function copyWorkerSeries(source, shared) {
  if (shared && typeof SharedArrayBuffer !== 'undefined') {
    const buffer = new SharedArrayBuffer(source.length * Float32Array.BYTES_PER_ELEMENT);
    const view = new Float32Array(buffer);
    view.set(source);
    return view;
  }
  return new Float32Array(source);
}

export function canUseSharedWorkerSeries() {
  return typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
}

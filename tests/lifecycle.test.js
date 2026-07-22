import { describe,expect,it,vi } from 'vitest';
import { createLifecycleScope } from '../src/lib/lifecycle.js';

describe('LifecycleScope',()=>{
  it('entfernt DOM-Listener symmetrisch und idempotent',()=>{
    const scope=createLifecycleScope('test'), target=new EventTarget(), fn=vi.fn();
    scope.listen(target,'change',fn); target.dispatchEvent(new Event('change'));
    scope.dispose(); scope.dispose(); target.dispatchEvent(new Event('change'));
    expect(fn).toHaveBeenCalledOnce();
  });
  it('beendet Intervalle beim Dispose',()=>{
    vi.useFakeTimers(); const scope=createLifecycleScope('timer'), fn=vi.fn();
    scope.interval(fn,100); vi.advanceTimersByTime(250); scope.dispose(); vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2); vi.useRealTimers();
  });
});

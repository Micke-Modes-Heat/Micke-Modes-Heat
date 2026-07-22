import { beforeEach,describe,expect,it,vi } from 'vitest';
import { beginInteraction,cancelInteraction,commitInteraction,getActiveInteraction,resetInteractionState } from '../src/lib/interaction-state.js';

describe('zentrale Karteninteraktion',()=>{
  beforeEach(()=>resetInteractionState());
  it('bricht das alte Werkzeug vor dem Wechsel genau einmal ab',()=>{
    const cancelA=vi.fn(), cancelB=vi.fn();
    beginInteraction({id:'a',label:'A',cancel:cancelA});
    beginInteraction({id:'b',label:'B',cancel:cancelB});
    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();
    expect(getActiveInteraction()?.id).toBe('b');
  });
  it('unterscheidet Abschluss und Abbruch',()=>{
    const cancel=vi.fn();
    beginInteraction({id:'draw',label:'Zeichnen',cancel});
    expect(commitInteraction('draw')).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(cancelInteraction()).toBe(false);
  });
});

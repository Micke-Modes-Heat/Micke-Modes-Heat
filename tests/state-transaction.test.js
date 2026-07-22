import { describe,expect,it } from 'vitest';
import { runStateTransaction,StateTransactionError } from '../src/lib/state-transaction.js';

describe('atomare Zustandstransaktion',()=>{
  it('committet erst nach erfolgreicher Validierung',()=>{
    const state={value:1};
    const result=runStateTransaction({label:'Test',capture:()=>({...state}),restore:s=>Object.assign(state,s),mutate:()=>{state.value=2;return 7;},validate:()=>expect(state.value).toBe(2)});
    expect(result).toBe(7); expect(state.value).toBe(2);
  });
  it('rollt Mutations- und Validierungsfehler vollständig zurück',()=>{
    const state={value:1,nested:[1]};
    expect(()=>runStateTransaction({label:'Fehler',capture:()=>structuredClone(state),restore:s=>{state.value=s.value;state.nested=s.nested;},mutate:()=>{state.value=9;state.nested.push(2);},validate:()=>{throw new Error('ungültig');}})).toThrow(StateTransactionError);
    expect(state).toEqual({value:1,nested:[1]});
  });
  it('weist versehentlich asynchrone Mutatoren zurück',()=>{
    const state={value:1};
    expect(()=>runStateTransaction({label:'Async',capture:()=>({...state}),restore:s=>Object.assign(state,s),mutate:async()=>2})).toThrow(/Asynchrone/);
    expect(state.value).toBe(1);
  });
});

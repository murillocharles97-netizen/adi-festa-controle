'use strict';

const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {test}=require('node:test');
const {runInNewContext}=require('node:vm');
const {harness}=require('./helpers/owner-receipt-v219.cjs');

test('receipt shows the selected amount and keeps future installments separate',async()=>{
  const h=harness(),{w}=h;
  try{
    w.InstallmentCredit={has:()=>true,refresh:async()=>({dueCents:3000,futureCents:1000,totalCents:4000})};
    await w.Fiados.openReceive('qa-client');
    const text=selector=>w.document.querySelector(selector).textContent;
    const form=w.document.querySelector('#modal form'),value=form.elements.valor;
    assert.equal(text('[data-receive-total-label]'),'Quitar valor exigível');
    assert.match(text('[data-receive-amount]'),/30,00/);
    assert.match(text('[data-receive-after]'),/0,00/);
    assert.match(text('[data-receive-future]'),/10,00/);
    value.value='5';value.dispatchEvent(new w.Event('input'));
    assert.match(text('[data-receive-amount]'),/5,00/);
    assert.match(text('[data-receive-after]'),/25,00/);
    assert.match(text('[data-receive-future]'),/10,00/);
    form.elements.advance.checked=true;
    form.elements.advance.dispatchEvent(new w.Event('change'));
    value.value='35';value.dispatchEvent(new w.Event('input'));
    assert.match(text('[data-receive-after]'),/0,00/);
    assert.match(text('[data-receive-future]'),/5,00/);
    assert.equal(h.commits(),0);
  }finally{h.close();}
});

test('PWA first control is silent and replacing an existing worker requires durable flush',async()=>{
  const calls=[];
  const workers=new EventTarget(),registration=new EventTarget();
  workers.controller=null;
  workers.register=async()=>registration;
  const window={
    confirm:message=>{calls.push(message.startsWith('Há')?'offer':'reload-prompt');return true;},
    alert:()=>assert.fail('unexpected disk error'),
    DB:{flush:async()=>{calls.push('flush');}},
    location:{reload:()=>calls.push('reload')},
  };
  runInNewContext(readFileSync('js/pwa-update.js','utf8'),{window,navigator:{serviceWorker:workers}});
  await window.PwaUpdate.register();
  const first=new EventTarget();
  registration.installing=first;
  registration.dispatchEvent(new Event('updatefound'));
  first.state='installed';first.dispatchEvent(new Event('statechange'));
  registration.active=workers.controller=first;
  workers.dispatchEvent(new Event('controllerchange'));
  assert.deepEqual(calls,[]);

  const replacement=new EventTarget();
  replacement.postMessage=message=>calls.push(message);
  registration.installing=replacement;
  registration.dispatchEvent(new Event('updatefound'));
  replacement.state='installed';replacement.dispatchEvent(new Event('statechange'));
  await new Promise(setImmediate);
  assert.deepEqual(calls,['offer','flush','SKIP_WAITING']);
  workers.controller=replacement;
  workers.dispatchEvent(new Event('controllerchange'));
  workers.dispatchEvent(new Event('controllerchange'));
  await new Promise(setImmediate);
  assert.deepEqual(calls,['offer','flush','SKIP_WAITING','reload-prompt','flush','reload']);
});

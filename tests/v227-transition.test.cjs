'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {harness} = require('./helpers/owner-receipt-v219.cjs');

for (const role of ['owner', 'seller']) {
  test(role + ' incomplete calendar blocks new receipt with existing queue intact', () => {
    const h = harness({role, grants: {'customers.receiveDebt': true}});
    try {
      h.rows().clientes[0].hasInstallmentFiado = true;
      const before = JSON.stringify(h.rows());
      assert.throws(() => h.w.Fiados.receber('qa-client', 50, '', {spaceId: 'qa-space'}), /calend.rio completo/);
      assert.equal(JSON.stringify(h.rows()), before);
      assert.equal(h.commits(), 0);
    } finally { h.close(); }
  });
}

function updateRuntime({answer = true, flushFails = false} = {}) {
  const calls = [];
  const window = {
    confirm: () => answer, alert: text => calls.push(['alert', text]),
    DB: {flush: async () => { calls.push(['flush']); if (flushFails) throw Error('disk'); }},
    location: {reload: () => calls.push(['reload'])},
  };
  vm.runInNewContext(fs.readFileSync('js/pwa-update.js', 'utf8'), {window});
  return {window, calls};
}
test('worker activation waits for durable local flush', async () => {
  const {window,calls} = updateRuntime();
  await window.PwaUpdate.offer({postMessage: message => calls.push([message])});
  assert.deepEqual(calls, [['flush'],['SKIP_WAITING']]);
});
test('cancelled update leaves current session running', async () => {
  const {window,calls} = updateRuntime({answer:false});
  await window.PwaUpdate.offer({postMessage: () => assert.fail()});
  await window.PwaUpdate.reload();
  assert.equal(calls.length,0);
});
test('failed flush prevents activation and reload', async () => {
  const {window,calls} = updateRuntime({flushFails:true});
  await window.PwaUpdate.offer({postMessage: () => assert.fail()});
  await window.PwaUpdate.reload();
  assert.equal(calls.filter(c => c[0] === 'reload').length,0);
  assert.equal(calls.filter(c => c[0] === 'alert').length,2);
});
test('confirmed reload flushes without replaying operations', async () => {
  const {window,calls} = updateRuntime();
  await window.PwaUpdate.reload();
  assert.deepEqual(calls,[['flush'],['reload']]);
});

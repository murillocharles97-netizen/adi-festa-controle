'use strict';
// V242.7: the receive form has no "total/parcial" selector. The amount opens with
// the full allowed value, the kind is identified from the typed amount and the
// form shows what stays open. Contracts and calculations are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/owner-receipt-v219.cjs');

function modal(config) {
  const h = harness(config), messages = [];
  h.w.Utils.toast = (...m) => messages.push(m);
  h.w.Modais = { fechar: () => h.w.document.getElementById('modal').replaceChildren(), layout: () => {} };
  return { ...h, messages };
}
const text = (h, selector) => h.w.document.querySelector(selector)?.textContent || '';
const type = (h, value) => {
  const input = h.w.document.querySelector('#modal form').elements.valor;
  input.value = value;
  input.dispatchEvent(new h.w.Event('input'));
};

test('opens with the full allowed amount and no kind selector', async () => {
  const h = modal();
  try {
    await h.w.Fiados.openReceive('qa-client');
    const form = h.w.document.querySelector('#modal form');
    assert.equal(form.querySelectorAll('[name=kind]').length, 0);
    assert.equal(form.querySelector('.payment-kind'), null);
    assert.equal(form.elements.valor.value, '214.00');
    assert.equal(form.elements.valor.max, '214');
    assert.equal(text(h, '[data-receive-total-label]'), 'Pagamento total');
    assert.equal(form.querySelector('[data-receive-outcome]').dataset.kind, 'total');
    assert.match(text(h, '[data-receive-outcome]'), /Fica em aberto após receber: R\$\s*0,00/);
  } finally { h.close(); }
});

test('a typed partial amount is identified and shows what stays open', async () => {
  const h = modal();
  try {
    await h.w.Fiados.openReceive('qa-client');
    type(h, '50');
    assert.equal(text(h, '[data-receive-total-label]'), 'Pagamento parcial');
    assert.match(text(h, '[data-receive-after]'), /164,00/);
    type(h, '214');
    assert.equal(text(h, '[data-receive-total-label]'), 'Pagamento total');
    assert.match(text(h, '[data-receive-after]'), /0,00/);
    for (const value of ['', '0', '214.01']) {
      type(h, value);
      assert.equal(h.w.document.querySelector('[data-receive-outcome]').dataset.kind, 'invalid');
      assert.match(text(h, '[data-receive-total-label]'), /Informe um valor de R\$\s*0,01 a R\$\s*214,00/);
    }
    assert.equal(h.commits(), 0);
  } finally { h.close(); }
});

test('payment mode keeps being derived from the amount (total and partial)', async () => {
  for (const [value, mode, balance] of [['214.00', 'total', 0], ['50', 'partial', -164]]) {
    const h = modal();
    try {
      let success = 0;
      await h.w.Fiados.openReceive('qa-client', { onRecorded: () => success++ });
      const form = h.w.document.querySelector('#modal form');
      type(h, value);
      await form.onsubmit({ preventDefault() {} });
      assert.equal(success, 1);
      assert.equal(h.commits(), 1);
      assert.equal(h.rows().pagamentos[0].paymentMode, mode);
      assert.equal(h.rows().clientes[0].saldo, balance);
    } finally { h.close(); }
  }
});

test('future installments: due, future and total open; advance follows the full amount only', async () => {
  const h = modal();
  try {
    h.w.InstallmentCredit = { has: () => true, refresh: async () => ({ dueCents: 3000, futureCents: 1000, totalCents: 4000 }) };
    await h.w.Fiados.openReceive('qa-client');
    const form = h.w.document.querySelector('#modal form'), advance = form.elements.advance;
    assert.equal(form.elements.valor.value, '30.00');
    assert.equal(text(h, '[data-receive-total-label]'), 'Quitar valor exigível');
    assert.match(text(h, '[data-receive-future]'), /10,00/);
    assert.match(text(h, '[data-receive-open]'), /10,00/);
    // Full amount: checking "advance" moves the amount to the whole debt.
    advance.checked = true; advance.dispatchEvent(new h.w.Event('change'));
    assert.equal(form.elements.valor.value, '40.00');
    assert.equal(text(h, '[data-receive-total-label]'), 'Quitar dívida total');
    assert.match(text(h, '[data-receive-open]'), /0,00/);
    advance.checked = false; advance.dispatchEvent(new h.w.Event('change'));
    assert.equal(form.elements.valor.value, '30.00');
    // Partial amount: it is kept when "advance" changes.
    type(h, '5');
    assert.equal(text(h, '[data-receive-total-label]'), 'Pagamento parcial');
    assert.match(text(h, '[data-receive-after]'), /25,00/);
    assert.match(text(h, '[data-receive-open]'), /35,00/);
    advance.checked = true; advance.dispatchEvent(new h.w.Event('change'));
    assert.equal(form.elements.valor.value, '5');
    type(h, '35');
    assert.match(text(h, '[data-receive-after]'), /0,00/);
    assert.match(text(h, '[data-receive-future]'), /5,00/);
    assert.match(text(h, '[data-receive-open]'), /5,00/);
    assert.equal(h.commits(), 0);
  } finally { h.close(); }
});

'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {REQUIRED_METHODS,assertProviderContract}=require('../src/terminal-payments/provider-contract');
const {SimulatorProvider,SIMULATOR_CAPABILITIES}=require('../src/terminal-payments/providers/simulator-provider');
const {CieloProvider}=require('../src/terminal-payments/providers/cielo-provider');
const {ProviderRegistry}=require('../src/terminal-payments/provider-registry');
const {normalizeSaleDraft,validatePaymentInput,publicIntent,saleStatusForPayment}=require('../src/terminal-payments/terminal-payment-service');
const {isTerminalPaymentSale}=require('../src/services/financial-income-service');

test('contrato comum cobre ciclo completo e providers registrados o implementam',()=>{
  assert.deepEqual(REQUIRED_METHODS,['createPayment','getPaymentStatus','cancelPayment','refundPayment','handleWebhook','pairTerminal','listTerminals','healthCheck']);
  const registry=new ProviderRegistry();
  assert.equal(assertProviderContract(registry.get('simulator')).id,'simulator');
  assert.equal(assertProviderContract(registry.get('cielo')).id,'cielo');
  assert.throws(()=>registry.get('provider_inventado'),/não suportado/);
});

test('SimulatorProvider reproduz aprovado, recusado, timeout, erro e cancelamento',async()=>{
  const provider=new SimulatorProvider(),intent={id:'pi_test'};
  assert.equal((await provider.createPayment({intent})).status,'awaiting_terminal');
  for(const [scenario,status] of Object.entries({approved:'approved',declined:'declined',timeout:'pending_confirmation',error:'error',cancelled:'cancelled'}))
    assert.equal((await provider.dispatchPayment({scenario})).status,status);
  assert.equal((await provider.cancelPayment({intent})).status,'cancelled');
  assert.equal((await provider.refundPayment({intent})).status,'refunded');
  assert.equal((await provider.healthCheck()).ok,true);
});

test('adapter Cielo existe sem endpoints ou credenciais inventadas',()=>{
  const provider=new CieloProvider();
  assert.equal(provider.healthCheck().status,'not_configured');
  assert.throws(()=>provider.createPayment({}),error=>error.code==='provider-not-configured');
});

test('validação respeita capabilities, crédito, débito e parcelamento',()=>{
  const terminal={capabilities:SIMULATOR_CAPABILITIES};
  assert.deepEqual(validatePaymentInput({amountCents:8990,paymentMethod:'credit',installments:3},terminal),{amountCents:8990,paymentMethod:'credit',installments:3});
  assert.throws(()=>validatePaymentInput({amountCents:8990,paymentMethod:'debit',installments:2},terminal),/Débito/);
  assert.throws(()=>validatePaymentInput({amountCents:8990,paymentMethod:'credit',installments:13},terminal),/Parcelamento/);
  assert.throws(()=>validatePaymentInput({amountCents:0,paymentMethod:'credit',installments:1},terminal),/Valor/);
});

test('sale draft guarda apenas snapshot operacional e descarta dados de cartão',()=>{
  const draft=normalizeSaleDraft({id:'sale_12345678',clienteId:'client-1',pan:'4111111111111111',cvv:'123',itens:[{produtoId:'p1',nome:'Produto',quantidade:1,precoFinalUnitario:89.9,pan:'5555'}]});
  assert.equal(draft.id,'sale_12345678');
  assert.equal(draft.itens.length,1);
  assert.equal('pan' in draft,false);
  assert.equal('cvv' in draft,false);
  assert.equal('pan' in draft.itens[0],false);
});

test('estados internos preservam timeout como pendente e venda só fica paga após aprovação',()=>{
  assert.equal(saleStatusForPayment('pending_confirmation'),'payment_pending');
  assert.equal(saleStatusForPayment('declined'),'payment_failed');
  assert.equal(saleStatusForPayment('approved'),'paid');
  const visible=publicIntent('pi_1',{businessId:'a',saleId:'s1',status:'pending_confirmation',capabilities:{supportsCancellation:true}});
  assert.equal(visible.saleStatus,'payment_pending');
  assert.equal(visible.canCancel,true);
});

test('cartão presencial é recebível e não entrada imediata em conta bancária',()=>{
  assert.equal(isTerminalPaymentSale({formaPagamento:'cartao_presencial'}),true);
  assert.equal(isTerminalPaymentSale({paymentMetadata:{channel:'card_present'}}),true);
  assert.equal(isTerminalPaymentSale({formaPagamento:'dinheiro'}),false);
});

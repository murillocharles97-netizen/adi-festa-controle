'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
  let current='qa',seq=0;
  const data={clientes:[{id:'client',nome:'QA',ativo:true,saldo:-100}],pagamentos:[],vendas:[],movimentacoes:[]};
  const ctx={structuredClone,console,Date,Utils:{uuid:()=>`payment-${++seq}`},DB:{getBusinessId:()=> 'qa-business',carregar:()=>data,alterar:fn=>fn(data)},TeamAccess:{has:()=>true,actor:()=>({actorUid:'qa-owner'})},SpaceContext:{salesSpaces:()=>[{id:'qa',name:'VECONI QA'},{id:'finance',name:'Loja com Financeiro'}],salesId:()=>current,requireSalesSpace:id=>{const chosen=id||current;if(!['qa','finance'].includes(chosen))throw Error('Espaço não autorizado');return chosen;}}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/fiados.js','utf8'),ctx);
  return{ctx,data,select:id=>{current=id;}};
}
test('recebimento persiste empresa/espaço explícito sem alterar a conta de fiado nem duplicar saldo em retry',()=>{
  const {ctx,data,select}=harness();
  const first=ctx.Fiados.receber('client',25,'QA',{operationId:'one',spaceId:'qa'});
  assert.equal(first.businessId,'qa-business');assert.equal(first.spaceId,'qa');assert.equal(first.financialSpaceId,'qa');
  assert.equal(data.clientes[0].saldo,-75);assert.equal(first.legacyAmount,25);
  select('finance');assert.equal(ctx.Fiados.receber('client',25,'Retry',{operationId:'one'}).spaceId,'qa');
  assert.equal(data.clientes[0].saldo,-75);assert.equal(data.pagamentos.length,1);
  assert.throws(()=>ctx.Fiados.receber('client',25,'Moved retry',{operationId:'one',spaceId:'finance'}),/outro espaço/);
  const second=ctx.Fiados.receber('client',15,'Recebido',{spaceId:'finance'});
  assert.equal(second.spaceId,'finance');assert.equal(data.clientes[0].saldo,-60);
  assert.equal(data.movimentacoes[1].spaceId,'finance');
});
test('espaço não autorizado não altera dívida nem cria pagamento; formulário deixa origem visível',()=>{
  const {ctx,data}=harness();
  assert.throws(()=>ctx.Fiados.receber('client',10,'Invalid',{spaceId:'other'}),/não autorizado/);
  assert.equal(data.clientes[0].saldo,-100);assert.equal(data.pagamentos.length,0);
  assert.match(ctx.Fiados.spaceField(),/name="paymentSpaceId" required/);
  assert.match(ctx.Fiados.spaceField(),/VECONI QA/);
  for(const file of ['js/clientes-page.js','js/app.js']){
    const source=fs.readFileSync(file,'utf8');assert.match(source,/Fiados\?\.spaceField/);assert.match(source,/f\.get\(['"]paymentSpaceId['"]\)/);
  }
});
test('histórico não é reprocessado e criação de receita não modifica vendas, pagamentos ou ledger de clientes',()=>{
  const service=fs.readFileSync('functions/src/services/financial-income-service.js','utf8');
  assert.doesNotMatch(service,/transaction\.(?:set|update|create)\((?:paymentRef|clientRef|evidenceRef)/);
  assert.doesNotMatch(service,/spaceIdFor|spaceRefFor|backfillProcessedPaymentEvidence/);
  assert.match(service,/historical-reconciliation-requires-authorization/);
  const index=fs.readFileSync('functions/src/index.js','utf8');
  for(const name of ['projectSaleFinancialIncome','projectCustomerPaymentFinancialIncome']){
    const trigger=index.slice(index.indexOf(`exports.${name}=`)).split('\n\n')[0];
    assert.match(trigger,/retry:true/);assert.match(trigger,/before:/);assert.match(trigger,/spaceId:source.spaceId/);
  }
});

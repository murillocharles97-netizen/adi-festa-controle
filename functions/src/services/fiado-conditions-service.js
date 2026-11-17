'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const Plan=require('../shared/installment-plan');
const Account=require('../shared/fiado-account');
const History=require('../shared/fiado-history-account');
const {prove}=require('../shared/fiado-history-proof');
const {readHistoryInput}=require('./fiado-history-service');
const {restricted}=require('../shared/operational-privacy-policy');
const {validId}=require('./workspace-reset-policy');

const MODES=['none','weekly','fortnight','monthly','custom'];
const hash=parts=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const fault=(code,message)=>{throw new HttpsError(code,message);};
const getGeneration=c=>c.business.workspaceGeneration??0;
const scopeKey=(c,spaceId)=>getGeneration(c)+':'+spaceId;
const key=(c,spaceId,clientId)=>hash([scopeKey(c,spaceId),clientId]);
const owned=(record,c)=>record&&(!record.businessId||record.businessId===c.bid)&&(record.workspaceGeneration??0)===getGeneration(c);
const origin=row=>{
 if(row?.spaceId&&row.financialSpaceId&&row.spaceId!==row.financialSpaceId)throw Error('Origem financeira divergente.');
 return row?.spaceId||row?.financialSpaceId||null;
};
function dueDate(start,policy) {
 if(!start||!policy||policy.mode==='none')return null;
 if(policy.mode==='monthly')return Plan.month(start,1);
 const days=policy.mode==='weekly'?7:policy.mode==='fortnight'?15:policy.days;
 return new Date(Date.parse(start+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
}
function cycle(start,effects) {
 let {cents=0,openedOn=null,cycleId=null}=start;
 for(const effect of effects){
  const next=cents+effect.debtDelta;
  if(!Number.isSafeInteger(next)||next<0)throw Error('Saldo tradicional por espaço sem prova suficiente.');
  if(!cents&&next){openedOn=effect.day;cycleId=effect.id;}
  if(!next){openedOn=null;cycleId=null;}
  cents=next;
 }
 return {cents,openedOn,cycleId};
}
function project(input,spaceId,day) {
 const {client,collections,opening}=input;
 // A newly opened directory entry has no financial effects. Do not classify
 // existing dated or incomplete sources as a proved zero.
 const noCreditSales=collections.sales.every(row=>row.formaPagamento!=='fiado');
 if(!opening&&client.saldo===0&&(client.financialVersion??0)===0&&noCreditSales&&
   ['payments','balanceAdjustments','balanceEvents','paymentAllocations'].every(name=>!collections[name].length))
  return cycle({},[]);
 const proof=prove(input,day);
 if(!proof.financialProof)throw Error('Histórico financeiro sem prova suficiente neste espaço.');
 const verified=History.project(input,day,{scoped:true});
 if(verified.entries.some(row=>!row.spaceId))throw Error('Dívida sem origem comprovada.');
 const initial=opening?.parts.find(part=>part.spaceId===spaceId)?.traditionalCents||0;
 const start={cents:initial,openedOn:initial?opening.day:null,cycleId:initial?'opening:'+opening.hash:null};
 const groups={
  sales:new Map(collections.sales.map(row=>[row.id,row])),
  payments:new Map(collections.payments.map(row=>[row.id,row])),
  balanceAdjustments:new Map(collections.balanceAdjustments.map(row=>[row.id,row])),
 };
 const allocations=new Map();
 for(const entry of collections.paymentAllocations){
  const rows=allocations.get(entry.paymentId)||[];
  rows.push(entry);allocations.set(entry.paymentId,rows);
 }
 const effects=[];
 for(const effect of proof.confirmedEffects){
  if(proof.anchor.kind==='confirmed-zero'&&effect.id===proof.anchor.eventId)continue;
  const source=groups[effect.col].get(effect.sourceId);
  if(effect.col==='sales'&&source.installmentPlan)continue;
  let debtDelta=-effect.delta;
  if(effect.col==='payments'){
   for(const row of allocations.get(effect.sourceId)||[]){
    const sale=groups.sales.get(row.saleId);
    if(!sale||origin(sale)!==origin(source)||origin(row)&&origin(row)!==origin(source))throw Error('Alocação sem origem comprovada.');
    if(sale.installmentPlan)debtDelta+=Plan.cents(row.amount);
   }
   if(debtDelta>0)throw Error('Alocação supera o recebimento confirmado.');
  }
  if(!debtDelta)continue;
  const space=origin(source);
  if(!space)throw Error('Movimentação sem origem comprovada.');
  if(space===spaceId)effects.push({id:effect.id,debtDelta,
    day:debtDelta>0?Account.commercialDay(source):Plan.today(new Date(effect.at))});
 }
 const actual=cycle(start,effects);
 const expected=verified.entries.filter(row=>row.spaceId===spaceId&&!Number.isInteger(row.number)).reduce((n,row)=>n+row.remainingCents,0);
 if(actual.cents!==expected)throw Error('Saldo tradicional por espaço sem prova suficiente.');
 return actual;
}
function summarize(config,financial,day) {
 const current=financial?config?.cycleId&&config.cycleId===financial.cycleId?config.dueDate:
   dueDate(financial.openedOn,config):null;
 const late=current?Math.max(0,Math.round((Date.parse(day)-Date.parse(current))/86400000)):0;
 const limit=config?.limitCents??null, used=financial?.cents??null;
 return {
  configured:!!config, revision:config?.revision??0, mode:config?.mode||'none', days:config?.days||null,
  limitCents:limit, usedCents:used, availableCents:used!==null&&limit!==null?Math.max(0,limit-used):null,
  percent:used!==null&&limit>0?Math.round(100*used/limit):null, confirmed:!!financial, dueDate:current, overdueDays:late,
  promise:config?.promise?{...config.promise,state:config.promise.status==='fulfilled'?'fulfilled':config.promise.date<day?'missed':'pending'}:null
 };
}
function validateSettings(d) {
 if(!MODES.includes(d.mode))fault('invalid-argument','Escolha um prazo válido.');
 if(d.mode==='custom'&&(!Number.isInteger(d.days)||d.days<1||d.days>365))fault('invalid-argument','Informe de 1 a 365 dias.');
 if(d.limitCents!==null&&(!Number.isSafeInteger(d.limitCents)||d.limitCents<1||d.limitCents>100000000))fault('invalid-argument','Informe um limite maior que zero ou deixe em branco.');
 const promise=d.promise;
 if(promise!==null){
  if(!promise||typeof promise!=='object')fault('invalid-argument','Informe a promessa ou deixe em branco.');
  try{Plan.date(promise.date);}catch{fault('invalid-argument','Informe a data combinada.');}
  if(!Number.isSafeInteger(promise.amountCents)||promise.amountCents<1||promise.amountCents>100000000||
    !['pending','fulfilled'].includes(promise.status)||typeof promise.note!=='string'||promise.note.length>500)fault('invalid-argument','Confira a promessa de pagamento.');
 }
 return {mode:d.mode,days:d.mode==='custom'?d.days:null,limitCents:d.limitCents,
  promise:promise?{date:promise.date,amountCents:promise.amountCents,status:promise.status,note:promise.note.trim()}:null};
}
async function access(c,spaceId) {
 if(!c.has('customers.view')||(!c.has('customers.receiveDebt')&&!c.has('sales.create'))||restricted(c.member))
  fault('permission-denied','Sem acesso às condições de Fiado.');
 const space=await c.space(spaceId);
 if(space.active===false||space.status==='archived'||space.capabilities?.sales===false)fault('permission-denied','Espaço sem operação de vendas.');
}
function belongs(client,c,spaceId) {
 if(!owned(client,c)||client.active===false||client.ativo===false||client.deletedAt)return false;
 const links=Array.isArray(client.customerSpaceIds)?client.customerSpaceIds:client.spaceId?[client.spaceId]:[];
 return links.includes(spaceId)||(c.owner&&!links.length);
}
async function handler({tx,c,ref,d,now,write=false}) {
 const spaceId=validId(d.spaceId,'Espaço'), day=Plan.today(now);
 await access(c,spaceId);
 if(d.kind==='fiado_conditions_list'&&!write){
  const collection=ref(c.bid,'fiadoConditions','_').parent;
  let query=collection.where('scopeKey','==',scopeKey(c,spaceId)).orderBy('__name__');
  if(d.cursor){const cursor=await tx.get(collection.doc(validId(d.cursor,'Cursor')));if(!owned(cursor.data(),c)||cursor.data().spaceId!==spaceId)fault('permission-denied','Cursor fora do espaço.');query=query.startAfter(cursor);}
  const docs=(await tx.get(query.limit(51))).docs;
  return {rows:docs.slice(0,50).filter(doc=>owned(doc.data(),c)).map(doc=>({clientId:doc.data().clientId})),
   cursor:docs.length>50?docs[49].id:null};
 }
 const clientId=validId(d.clientId,'Cliente'),client=(await tx.get(ref(c.bid,'clients',clientId))).data();
 if(!belongs(client,c,spaceId))fault('permission-denied','Cliente fora do espaço selecionado.');
 const reference=ref(c.bid,'fiadoConditions',key(c,spaceId,clientId));
 const current=(await tx.get(reference)).data();
 if(current&&(!owned(current,c)||current.spaceId!==spaceId||current.clientId!==clientId))fault('permission-denied','Condições fora do espaço.');
 if(!write&&!current)return summarize(null,null,day);
 if(write&&(!c.has('customers.edit')||!c.has('customers.receiveDebt')))fault('permission-denied','Sem permissão para editar condições de pagamento.');
 let financial;
 try{financial=project(await readHistoryInput({tx,c,ref,clientId,client,checkRowAccess:false}),spaceId,day);}
 catch(error){if(error.code&&error.code!=='failed-precondition')throw error;}
 const result={...summarize(current,financial,day),financialVersion:client.financialVersion??0};
 if(!write)return result;
 if(d.revision!==(current?.revision??0))fault('aborted','As condições mudaram. Reabra e revise antes de salvar.');
 const settings=validateSettings(d);
 let due=result.dueDate;
 if(d.renegotiatedDueDate){
  if(!financial?.cents)fault('failed-precondition','Confirme o ciclo em aberto antes de renegociar o vencimento.');
  try{due=Plan.date(d.renegotiatedDueDate);}catch{fault('invalid-argument','Confira a nova data de vencimento.');}
 }else if((!current||current.mode==='none'&&!result.dueDate)&&financial?.cents)due=dueDate(day,settings);
 const updated={...settings,businessId:c.bid,workspaceGeneration:getGeneration(c),scopeKey:scopeKey(c,spaceId),spaceId,clientId,
  cycleId:financial?.cycleId??current?.cycleId??null,dueDate:financial?due:current?.dueDate??null,
  revision:(current?.revision??0)+1,updatedBy:c.uid,updatedAt:now.toISOString()};
 tx.set(reference,updated);
 return {...summarize(updated,financial,day),financialVersion:client.financialVersion??0};
}
module.exports={dueDate,cycle,project,summarize,handler};

'use strict';

const {createHash}=require('node:crypto');
const Plan=require('./installment-plan');

const COLLECTION='fiadoOpeningBalances';
const tracked=['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations'];
const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?
 Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])):row);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const active=row=>row.active!==false&&row.ativo!==false&&!row.deletedAt&&!row.cancelledAt&&!row.desfeita;
const pending=row=>['pending','pending_sync','conflict','error','adjustment_required','not_applied','manual_review','quarantined','rejected','failed'].includes(row.status)||
 ['pending','not_applied','conflict','adjustment_required'].includes(row.applicationStatus);
const origin=row=>row.spaceId||row.financialSpaceId||null;
const money=value=>{
 if(typeof value!=='number')throw Error('Saldo cadastral inválido.');
 const cents=Plan.cents(Math.abs(value));
 return value<0?-cents:cents;
};

function calendars(input,day){
 const totals=new Map(),proof=[];
 for(const sale of input.collections.sales.filter(sale=>sale.installmentPlan&&active(sale))){
  Plan.assertSale({...sale,status:'fiado'});
  const spaceId=origin(sale);
  if(!spaceId||sale.spaceId&&sale.financialSpaceId&&sale.spaceId!==sale.financialSpaceId)
   throw Error('Há parcelamento sem espaço financeiro comprovado.');
  const balance=totals.get(spaceId)||{totalCents:0,futureCents:0};
  for(const row of Plan.rows(sale,day)){
   balance.totalCents+=row.remainingCents;
   if(row.dueDate>day)balance.futureCents+=row.remainingCents;
  }
  totals.set(spaceId,balance);
  proof.push({saleId:sale.id,spaceId,scheduleHash:digest([sale.installmentPlan,sale.data,sale.valorFinal,sale.creditOriginalAmount??null])});
 }
 return {totals,proof:proof.sort((a,b)=>a.saleId.localeCompare(b.saleId))};
}

function createPlan(input,{day,spaceIds,balances,reason}){
 const {client,collections,businessId,generation}=input;
 if(!input.complete||!input.stable||!active(client)||client.fiadoOpeningBalance)
  throw Error('A conta não está disponível para confirmação de saldo.');
 if([...collections.payments,...collections.sales.filter(sale=>sale.formaPagamento==='fiado'),...collections.balanceAdjustments].some(pending))
  throw Error('Há operação financeira pendente no servidor. Revise a sincronização.');
 const bookCents=-money(client.saldo);
 const financialVersion=client.financialVersion??0;
 if(bookCents<=0||!Number.isSafeInteger(financialVersion)||financialVersion<0||financialVersion>=Number.MAX_SAFE_INTEGER)
  throw Error('Saldo ou versão cadastral fora do escopo desta confirmação.');
 const {totals,proof}=calendars(input,day);
 if([...totals.keys()].some(id=>!spaceIds.includes(id)))
  throw Error('Há parcelamento vinculado a outro espaço. A conta exige conferência.');
 if(collections.sales.some(sale=>sale.formaPagamento==='fiado'&&active(sale)&&origin(sale)&&!spaceIds.includes(origin(sale))&&
    Number(sale.creditRemainingAmount??(Number(sale.creditOriginalAmount??sale.valorFinal??sale.valorTotal)-Number(sale.creditPaidAmount??0)))>0))
  throw Error('Há dívida registrada em outro espaço. A conta exige conferência.');
 const contractTotal=[...totals.values()].reduce((sum,value)=>sum+value.totalCents,0);
 const defaults=spaceIds.map((spaceId,index)=>({spaceId,totalCents:(totals.get(spaceId)?.totalCents||0)+(index===0?Math.max(0,bookCents-contractTotal):0)}));
 const selection=balances??defaults;
 if(!Array.isArray(selection)||selection.length!==spaceIds.length||new Set(selection.map(row=>row?.spaceId)).size!==spaceIds.length||
    selection.some(row=>!spaceIds.includes(row?.spaceId)||!Number.isSafeInteger(row.totalCents)||row.totalCents<0))
  throw Error('Informe um saldo válido em centavos para cada espaço.');
 const parts=spaceIds.map(spaceId=>{
  const {totalCents}=selection.find(row=>row.spaceId===spaceId);
  const calendar=totals.get(spaceId)||{totalCents:0,futureCents:0};
  if(totalCents<calendar.totalCents)throw Error('O saldo do espaço deve cobrir as parcelas já registradas nele.');
  return {spaceId,totalCents,dueCents:totalCents-calendar.futureCents,futureCents:calendar.futureCents,
   traditionalCents:totalCents-calendar.totalCents};
 });
 const confirmedCents=parts.reduce((sum,part)=>sum+part.totalCents,0);
 if(!Number.isSafeInteger(confirmedCents))throw Error('Saldo final inválido.');
 const deltaCents=confirmedCents-bookCents;
 const explanation=typeof reason==='string'?reason.trim():'';
 if(explanation.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(explanation))
  throw Error('Informe uma justificativa válida de até 300 caracteres.');
 if(balances&&deltaCents&&explanation.length<10)
  throw Error('Explique a diferença em relação ao cadastro em pelo menos 10 caracteres.');
 const baseline=Object.fromEntries(tracked.map(name=>[name,collections[name].map(row=>row.id).sort()]));
 return {version:1,businessId,workspaceGeneration:generation,clientId:client.id,day,bookCents,financialVersion,
  confirmedCents,deltaCents,reason:explanation,parts,baseline,calendars:proof};
}

function prior(opening,collection,id){
 return opening?.baseline[collection]?.includes(id)===true;
}

function readOpening(input,audit){
 const {client,businessId,generation}=input;
 const marker=client.fiadoOpeningBalance;
 if(!marker||marker.version!==1||typeof marker.hash!=='string'||!audit||audit.type!=='fiado_confirmed_opening'||
    audit.businessId!==businessId||audit.workspaceGeneration!==generation||audit.clientId!==client.id||
    audit.version!==1||audit.hash!==marker.hash||audit.plan?.clientId!==client.id||
    audit.plan.businessId!==businessId||audit.plan.workspaceGeneration!==generation||
    !Number.isSafeInteger(audit.plan.financialVersion)||audit.plan.financialVersion+1>(client.financialVersion??0)||
    audit.reviewHash!==digest([audit.plan,audit.evidenceDigest])||
    !Number.isFinite(Date.parse(audit.at))||digest({plan:audit.plan,at:audit.at,actorUid:audit.actorUid,requestId:audit.requestId,reviewHash:audit.reviewHash})!==marker.hash)
  throw Error('Saldo final sem confirmação e auditoria correspondentes.');
 const {plan}=audit;
 const actual=new Map(calendars(input,plan.day).proof.map(row=>[row.saleId,row]));
 for(const row of plan.calendars){
  if(digest(actual.get(row.saleId)??null)!==digest(row))
   throw Error('O calendário original do saldo confirmado mudou.');
 }
 return {...plan,at:audit.at,hash:audit.hash};
}

module.exports={COLLECTION,active,pending,origin,digest,createPlan,prior,readOpening};

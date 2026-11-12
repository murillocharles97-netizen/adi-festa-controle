'use strict';
const Plan=require('./installment-plan'),Account=require('./fiado-account'),{prove}=require('./fiado-history-proof');
const order=(a,b)=>a.dueDate.localeCompare(b.dueDate)||a.createdAt.localeCompare(b.createdAt)||String(a.saleId||a.historyEventId).localeCompare(String(b.saleId||b.historyEventId))||(a.number??-1)-(b.number??-1);
const origin=row=>row.spaceId||row.financialSpaceId||null;
function project(input,day=Plan.today(),{scoped=false}={}){
 const proof=prove(input,day);if(!proof.financialProof)throw Error('Histórico financeiro sem prova suficiente: '+proof.reason+(proof.details?.length?' ('+proof.details.join(', ')+')':''));
 const {client,collections,opening}=input,own=r=>[r.clienteId,r.clientId,r.customerId].includes(client.id),sales=collections.sales.filter(own),payments=collections.payments.filter(own),adjustments=collections.balanceAdjustments.filter(own),entries=[];
 if(opening){
  scoped=true;
  for(const part of opening.parts)if(part.traditionalCents)entries.push({saleId:null,number:null,
   historyEventId:'confirmed_opening:'+part.spaceId,dueDate:opening.day,createdAt:opening.at,
   remainingCents:part.traditionalCents,spaceId:part.spaceId});
 }
 const consume=(amount,spaceId)=>{entries.sort(order);for(const entry of entries){if(scoped&&entry.spaceId!==spaceId)continue;const n=Math.min(amount,entry.remainingCents);entry.remainingCents-=n;amount-=n;if(!amount)break;}if(amount)throw Error('Recebimento/ajuste histórico excede as obrigações comprovadas.');};
 const effects=proof.confirmedEffects.filter(e=>proof.anchor.kind!=='confirmed-zero'||e.id!==proof.anchor.eventId);
 for(const effect of effects){
  const source=({sales,payments,balanceAdjustments:adjustments}[effect.col]).find(s=>s.id===effect.sourceId);
  if(effect.col==='sales'&&source.installmentPlan)continue;
  if(effect.col==='sales'&&effect.delta>0){const original=entries.find(e=>e.historyEventId==='credit_sale:'+source.id);if(!original||original.remainingCents<effect.delta)throw Error('Reversão de dívida histórica já recebida exige revisão.');original.remainingCents-=effect.delta;continue;}
  if(effect.delta<0){const dueDate=Account.commercialDay(source);if(dueDate>day)throw Error('Obrigação histórica com data futura exige revisão.');entries.push({saleId:null,number:null,historyEventId:effect.id,dueDate,createdAt:source.data||source.financialAppliedAt,remainingCents:-effect.delta,spaceId:scoped?origin(source):source.spaceId||null});}
  else if(effect.delta>0){let amount=effect.delta;if(effect.col==='payments'){
    const planIds=new Set(sales.filter(s=>s.installmentPlan).map(s=>s.id));
    const allocations=collections.paymentAllocations.filter(a=>a.paymentId===source.id&&(scoped||planIds.has(a.saleId)));
    for(const allocation of allocations){
     const allocated=Plan.cents(allocation.amount);
     amount-=allocated;
     if(!scoped)continue;
     const sale=sales.find(s=>s.id===allocation.saleId);
     if(!sale||origin(sale)!==origin(source)||origin(allocation)&&origin(allocation)!==origin(source))
      throw Error('Alocação histórica entre espaços exige revisão.');
     if(!planIds.has(sale.id)){
      const entry=entries.find(e=>e.historyEventId==='credit_sale:'+sale.id);
      if(!entry||entry.remainingCents<allocated)throw Error('Alocação histórica sem obrigação comprovada.');
      entry.remainingCents-=allocated;
     }
    }
    if(amount<0)throw Error('Alocação excede o recebimento confirmado.');
   }consume(amount,origin(source));}
 }
 const active=s=>s.active!==false&&!s.deletedAt&&!s.cancelledAt&&!s.desfeita;
 for(const sale of sales.filter(s=>s.installmentPlan&&active(s)))for(const row of Plan.rows(sale,day))if(row.remainingCents)entries.push({saleId:sale.id,number:row.number,dueDate:row.dueDate,createdAt:sale.data,remainingCents:row.remainingCents,spaceId:scoped?origin(sale):sale.spaceId||null});
 const remaining=entries.filter(e=>e.remainingCents);remaining.sort(order);const dueCents=remaining.filter(e=>e.dueDate<=day).reduce((n,e)=>n+e.remainingCents,0),futureCents=remaining.filter(e=>e.dueDate>day).reduce((n,e)=>n+e.remainingCents,0);
 if(dueCents!==proof.account.dueCents||futureCents!==proof.account.futureCents)throw Error('Calendário e histórico agregado divergem.');
 return{version:2,historyProofVersion:1,clientId:client.id,asOf:day,financialVersion:Number(client.financialVersion||0),dueCents,futureCents,totalCents:dueCents+futureCents,creditCents:0,hasInstallments:sales.some(s=>s.installmentPlan&&active(s)),entries:remaining};
}
module.exports={project};

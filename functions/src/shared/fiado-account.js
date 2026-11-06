(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./installment-plan'));else root.FiadoAccount=factory(root.InstallmentPlan);})(globalThis,Plan=>{
 'use strict';
 const active=s=>!s.deletedAt&&s.active!==false&&!s.desfeita&&!s.cancelledAt&&['fiado','applied'].includes(s.status||'fiado');
 const canonicalDate=v=>v?.toDate?.().toISOString()||String(v||'');
 // V226 stores an explicit civil date; old records store the commercial instant in data.
 // createdAt is technical registration time and must never replace the sale date.
 function commercialDay(sale){
  const explicit=sale.priorSale?.commercialDate||sale.commercialDate;
  if(explicit)return Plan.date(explicit);
  const value=canonicalDate(sale.occurredAt||sale.data);
  if(!value)return '0001-01-01'; // undated historical debt remains immediately due
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Plan.date(value);
  // Historical zone-less strings represent local business wall time, not host time.
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value))return Plan.date(value.slice(0,10));
  const instant=new Date(value);if(!Number.isFinite(+instant))throw Error('Data comercial inválida; conciliação necessária.');
  return Plan.today(instant); // canonical business timezone: America/Sao_Paulo, as in V226
 }
 function project(client,sales,day=Plan.today()){
  Plan.date(day);const entries=[],eligible=sales.filter(s=>(s.clienteId||s.clientId)===client.id&&s.formaPagamento==='fiado'&&active(s));
  for(const s of eligible){
   const paid=Plan.cents(s.creditPaidAmount||0),original=Plan.cents(s.creditOriginalAmount??s.valorFinal??s.valorTotal);
   if(paid>original)throw Error('Recebimentos excedem o valor contratado. Conciliação necessária.');
   if(s.installmentPlan){for(const row of Plan.rows(s,day))if(row.remainingCents)entries.push({saleId:s.id,number:row.number,dueDate:row.dueDate,createdAt:canonicalDate(s.data),remainingCents:row.remainingCents,spaceId:s.spaceId||null});}
   else if(original>paid)entries.push({saleId:s.id,number:null,dueDate:commercialDay(s),createdAt:canonicalDate(s.data),remainingCents:original-paid,spaceId:s.spaceId||null});
  }
  const bookCents=Math.round(-Number(client.saldo||0)*100),tracked=entries.reduce((n,e)=>n+e.remainingCents,0);
  if(tracked>Math.max(0,bookCents))throw Error('Saldo e alocações divergem. Conciliação necessária; nenhum recebimento foi registrado.');
  const legacy=Math.max(0,bookCents)-tracked;if(client.legacyBalanceRemaining!==undefined&&Plan.cents(client.legacyBalanceRemaining)!==legacy)throw Error('Histórico incompleto ou saldo divergente. Atualize a conta antes de exibir o exigível.');if(legacy)entries.push({saleId:null,number:null,dueDate:'0001-01-01',createdAt:'',remainingCents:legacy,spaceId:null});
  entries.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.createdAt.localeCompare(b.createdAt)||String(a.saleId||'').localeCompare(String(b.saleId||''))||(a.number??-1)-(b.number??-1));
  const dueCents=entries.filter(e=>e.dueDate<=day).reduce((n,e)=>n+e.remainingCents,0),futureCents=entries.filter(e=>e.dueDate>day).reduce((n,e)=>n+e.remainingCents,0);
  return {version:1,clientId:client.id,asOf:day,financialVersion:Number(client.financialVersion||0),dueCents,futureCents,totalCents:dueCents+futureCents,creditCents:Math.max(0,-bookCents),hasInstallments:eligible.some(s=>!!s.installmentPlan),entries};
 }
 function allocate(account,amountCents,{advance=false}={}){
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>(advance?account.totalCents:account.dueCents))throw Error('Valor excede o saldo exigível. Para antecipar, confirme explicitamente o pagamento de parcelas futuras.');
  let remaining=amountCents;const rows=[];
  for(const e of account.entries){if(!remaining)break;if(!advance&&e.dueDate>account.asOf)continue;const cents=Math.min(e.remainingCents,remaining);rows.push({saleId:e.saleId,number:e.number,dueDate:e.dueDate,amountCents:cents,anticipated:e.dueDate>account.asOf});remaining-=cents;}
  if(remaining)throw Error('Alocação incompleta.');return rows;
 }
 function applyAllocations(db,clientId,rows,paymentId,at){
  db.alocacoesPagamento||=[];
  if(db.alocacoesPagamento.some(a=>a.paymentId===paymentId))throw Error('Recebimento já alocado.');
  const ids=[...new Set(rows.map(r=>r.saleId).filter(Boolean))],allocations=[];
  for(const id of ids){const sale=db.vendas.find(s=>s.id===id&&(s.clienteId||s.clientId)===clientId);if(!sale)throw Error('Venda não carregada; atualize o cliente.');
   const scheduleRows=rows.filter(r=>r.saleId===id),amount=scheduleRows.reduce((n,r)=>n+r.amountCents,0)/100,original=Plan.cents(sale.creditOriginalAmount??sale.valorFinal),paid=Plan.cents(sale.creditPaidAmount||0)+Plan.cents(amount);
   if(paid>original)throw Error('Pagamento excede a venda.');
   Object.assign(sale,{creditOriginalAmount:original/100,creditPaidAmount:paid/100,creditRemainingAmount:(original-paid)/100,creditSettled:paid===original,creditSettledAt:paid===original?at:null});
   const allocation={id:paymentId+'__'+id,operationId:paymentId,schemaVersion:2,engineVersion:2,paymentId,saleId:id,clientId,businessId:sale.businessId||null,amount,settledSale:sale.creditSettled,createdAt:at,scheduleRows};db.alocacoesPagamento.push(allocation);allocations.push(allocation);
  }return allocations;
 }
 return Object.freeze({commercialDay,project,allocate,applyAllocations});
});

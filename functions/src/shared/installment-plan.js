(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InstallmentPlan=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const fail=message=>{throw Error(message);};
  function cents(value){const n=Number(value),v=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(v)||Math.abs(n*100-v)>0.00001||v<0)fail('Informe um valor em centavos válido.');return v;}
  function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Data de vencimento inválida.');return value;}
  function today(at=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(at);}
  function month(first,offset){date(first);const [y,m,d]=first.split('-').map(Number),last=new Date(Date.UTC(y,m+offset,0)).getUTCDate();return new Date(Date.UTC(y,m-1+offset,Math.min(d,last))).toISOString().slice(0,10);}
  function create({total,downPayment=0,count,firstDueDate,saleDate=today(),downPaymentMethod='pix'}){
    const totalCents=cents(total),downPaymentCents=cents(downPayment),n=Number(count);date(saleDate);date(firstDueDate);
    if(!totalCents||downPaymentCents>=totalCents||!Number.isInteger(n)||n<1||n>60||totalCents-downPaymentCents<n)fail('Configure de 1 a 60 parcelas de pelo menos R$0,01, com entrada menor que o total.');
    if(firstDueDate<saleDate||!['pix','cash'].includes(downPaymentMethod))fail('Confira o primeiro vencimento e a forma da entrada.');
    const principal=totalCents-downPaymentCents,base=Math.floor(principal/n),remainder=principal%n;
    return {version:1,kind:'store_credit',currency:'BRL',totalCents,downPaymentCents,downPaymentMethod,count:n,firstDueDate,saleDate,interestCents:0,penaltyCents:0,installments:Array.from({length:n},(_,i)=>({number:i+1,dueDate:month(firstDueDate,i),amountCents:base+(i<remainder?1:0)}))};
  }
  function assertSale(sale){const p=sale.installmentPlan;if(!p)return;if(sale.formaPagamento!=='fiado'||sale.status!=='fiado'||!sale.clienteId)fail('Crediário exige venda Fiado e cliente identificado.');const expected=create({total:sale.valorFinal,downPayment:p.downPaymentCents/100,count:p.count,firstDueDate:p.firstDueDate,saleDate:p.saleDate,downPaymentMethod:p.downPaymentMethod});const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;if(JSON.stringify(canonical(p))!==JSON.stringify(canonical(expected)))fail('Calendário de parcelas inconsistente.');if(today(new Date(sale.data))!==p.saleDate)fail('Data comercial do crediário divergente.');}
  function rows(sale,day=today()){const p=sale.installmentPlan;if(!p)return[];date(day);let paid=cents(sale.creditPaidAmount||0);const entries=[...(p.downPaymentCents?[{number:0,dueDate:p.saleDate,amountCents:p.downPaymentCents}]:[]),...p.installments];return entries.map(row=>{const paidCents=Math.min(paid,row.amountCents);paid-=paidCents;const remainingCents=row.amountCents-paidCents,cancelled=!!(sale.deletedAt||sale.active===false||sale.desfeita);return{...row,paidCents,remainingCents:cancelled?0:remainingCents,status:cancelled?'cancelled':!remainingCents?'paid':paidCents?'partial':row.dueDate<day?'overdue':'open',overdue:!cancelled&&remainingCents>0&&row.dueDate<day};});}
  return Object.freeze({cents,date,today,month,create,assertSale,rows});
});

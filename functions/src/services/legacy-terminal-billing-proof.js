'use strict';
// Read-only proof for a past retry retained on terminal provider objects. This
// does not close a checkout reservation or authorize activation of a new plan.
const crypto=require('node:crypto');
const TTL=15000,PAGE=50,MAX=100;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const time=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const cancelled=s=>['cancelled','canceled'].includes(s);
const failed=s=>['rejected','cancelled','canceled'].includes(s);
const deny=()=>{throw Object.assign(Error('A retentativa do contrato cancelado ainda não tem comprovação suficiente. Nenhuma nova cobrança foi liberada.'),{code:'legacy-source-retry-unverified'});};
const shape=p=>[String(p?.id),p?.status,p?.external_reference,p?.currency_id,Number(p?.transaction_amount),p?.date_approved??null,p?.date_last_updated];
function validate({contract,invoice,payment,index,subscription,now}){
 const clock=+now,cm=time(contract?.last_modified),im=time(invoice?.last_modified),pm=time(payment?.date_last_updated),retry=time(invoice?.next_retry_date),debit=time(invoice?.debit_date||invoice?.date_created),cutoff=time(subscription?.currentPeriodEnd||subscription?.expiresAt),amount=Number(index?.chargedPrice??index?.officialPrice);
 if(!Number.isFinite(clock)||!cancelled(contract?.status)||!cancelled(invoice?.status)||!failed(invoice?.payment?.status)||!failed(payment?.status)||payment.status!==invoice.payment.status||String(invoice?.preapproval_id)!==String(contract?.id)||String(invoice?.payment?.id)!==String(payment?.id)||!contract?.id||!invoice?.id||!payment?.id||payment.date_approved!=null||!index?.expectedExternalReference||contract.external_reference!==index.expectedExternalReference||payment.external_reference!==index.expectedExternalReference||invoice.external_reference!=null&&invoice.external_reference!==index.expectedExternalReference||payment.currency_id!=='BRL'||invoice.currency_id!=='BRL'||contract.auto_recurring?.currency_id!=='BRL'||!Number.isFinite(amount)||amount<=0||[payment.transaction_amount,invoice.transaction_amount,contract.auto_recurring?.transaction_amount].some(v=>!Number.isFinite(Number(v))||Math.abs(Number(v)-amount)>0.009)||![cm,im,pm,retry,debit,cutoff].every(Number.isFinite)||retry>=clock||debit>clock||pm>im||im>cm||cm>clock)deny();
}
async function readTerminalProof(provider,input){
 const {businessId,ownerUid,contract,invoice,index,subscription,now}=input;
 if(typeof provider.searchPaymentsByExternalReference!=='function'||typeof provider.getAuthorizedPayment!=='function'||typeof provider.getPayment!=='function')deny();
 const fresh=await provider.getAuthorizedPayment(invoice.id),E=require('./legacy-cancellation-evidence');
 if(E.invoiceHash(fresh)!==E.invoiceHash(invoice))deny();
 const payment=await provider.getPayment(invoice.payment.id);validate({...input,payment});validate({...input,invoice:fresh,payment});
 let total=null,rows=[];const ids=new Set(),cutoff=time(subscription.currentPeriodEnd||subscription.expiresAt);
 for(let offset=0;offset<MAX;offset+=PAGE){
  const page=await provider.searchPaymentsByExternalReference(index.expectedExternalReference,{limit:PAGE,offset}),t=Number(page?.paging?.total);
  if(!Array.isArray(page?.results)||!Number.isSafeInteger(t)||t<1||t>MAX||Number(page.paging.limit)!==PAGE||Number(page.paging.offset)!==offset||total!=null&&t!==total||page.results.length!==Math.min(PAGE,t-offset))deny();total=t;
  for(const p of page.results){const id=String(p?.id||''),updated=time(p?.date_last_updated),approved=time(p?.date_approved);if(!id||ids.has(id)||p.external_reference!==index.expectedExternalReference||p.currency_id!=='BRL'||!Number.isFinite(Number(p.transaction_amount))||Number(p.transaction_amount)<=0||!Number.isFinite(updated)||updated>+now)deny();ids.add(id);
   if(p.status==='approved'){if(!Number.isFinite(approved)||approved>=cutoff||approved>+now)deny();}
   else if(!failed(p.status)||p.date_approved!=null)deny();rows.push(p);
  }
  if(rows.length===total)break;
 }
 if(rows.length!==total||JSON.stringify(shape(rows.find(p=>String(p.id)===String(payment.id))))!==JSON.stringify(shape(payment)))deny();
 // A state change between search and exact reads invalidates this observation.
 const lastInvoice=await provider.getAuthorizedPayment(invoice.id),lastPayment=await provider.getPayment(invoice.payment.id);
 if(E.invoiceHash(lastInvoice)!==E.invoiceHash(fresh)||JSON.stringify(shape(lastPayment))!==JSON.stringify(shape(payment)))deny();validate({...input,invoice:lastInvoice,payment:lastPayment});
 const checkedAt=new Date(now).toISOString(),paymentSearchHash=hash(rows.map(shape).sort((a,b)=>a[0].localeCompare(b[0])));
 return{version:2,source:'provider_terminal_gets',invoiceId:String(invoice.id),invoiceHash:E.invoiceHash(invoice),contractStatus:contract.status,invoiceStatus:invoice.status,paymentStatus:payment.status,paymentSearchComplete:true,paymentSearchHash,checkedAt,expiresAt:new Date(+now+TTL).toISOString(),evidenceId:'live_'+hash([businessId,ownerUid,String(contract.id),String(invoice.id),String(payment.id),contract.last_modified,paymentSearchHash])};
}
function assertTerminalCheck(check){if(check.source!=='provider_terminal_gets'||!cancelled(check.contractStatus)||!cancelled(check.invoiceStatus)||!failed(check.paymentStatus)||check.paymentSearchComplete!==true||!/^[a-f0-9]{64}$/.test(check.paymentSearchHash||'')||!Number.isFinite(time(check.checkedAt))||time(check.expiresAt)!==time(check.checkedAt)+TTL)deny();}
module.exports={readTerminalProof,assertTerminalCheck};

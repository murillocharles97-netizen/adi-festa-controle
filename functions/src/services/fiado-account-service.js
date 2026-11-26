'use strict';
const Account=require('../shared/fiado-account'),Plan=require('../shared/installment-plan'),{HttpsError}=require('firebase-functions/v2/https');
const fail=message=>{throw new HttpsError('failed-precondition',message);};
const CustomerAccount=require('../shared/customer-account'),Ledger=require('../shared/customer-account-ledger');
// Etapa 7: false answers every lookup by rebuilding the history, as before.
const LEDGER_READ_ENABLED=true;
// A Space-scoped customer whose account is current with every operation (Etapa 5) is answered from
// the account: the same shape and items as the reconstruction, the same Space access, constant cost.
async function accountView({tx,c,ref,clientId,client,now}){
 const scoped=client.fiadoOpeningBalance?.version===1||client.fiadoHistoryActivation?.spaceRegularization?.version===1;
 if(!LEDGER_READ_ENABLED||!scoped||client.fiadoHistoryVersion!==1||require('../shared/operational-privacy-policy').restricted(c.member))return null;
 const stored=(await tx.get(ref(c.bid,'customerAccounts',clientId))).data(),version=client.financialVersion??0;
 if(!stored||stored.schemaVersion!==CustomerAccount.SCHEMA_VERSION||stored.workspaceGeneration!==(c.business.workspaceGeneration??0)||stored.clientId!==clientId||
  !CustomerAccount.PUBLISHED.has(stored.status)||stored.ledgerVersion!==Ledger.LEDGER_VERSION||!stored.ledger||stored.clientFinancialVersion!==version||
  stored.unattributedCents!==0||stored.debtCents!==-Math.round(Number(client.saldo||0)*100))return null;
 const day=Plan.today(now),entries=Ledger.entries(stored.ledger,day);
 if(!c.owner)for(const id of new Set(entries.map(e=>e.spaceId)))await c.space(id);
 const dueCents=entries.filter(e=>e.dueDate<=day).reduce((n,e)=>n+e.remainingCents,0),futureCents=entries.filter(e=>e.dueDate>day).reduce((n,e)=>n+e.remainingCents,0);
 return{version:2,historyProofVersion:1,clientId,asOf:day,financialVersion:Number(version),dueCents,futureCents,totalCents:dueCents+futureCents,creditCents:0,
  hasInstallments:Object.values(stored.ledger.plans||{}).some(p=>p.active),entries,source:'customer_account'};
}
async function loadFiadoAccount({tx,c,ref,clientId,now=new Date(),checkPermission=true,includeTraditional=false,historyProofVersion=0}){
 if(checkPermission&&(!c.has('customers.receiveDebt')||!c.has('customers.view')))throw new HttpsError('permission-denied','Sem acesso ao Fiado deste cliente.');

 const client=(await tx.get(ref(c.bid,'clients',clientId))).data();
 if(!client||client.businessId&&client.businessId!==c.bid||(client.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))throw new HttpsError('permission-denied','Cliente não pertence à empresa/geração.');
 const fromAccount=await accountView({tx,c,ref,clientId,client,now});
 if(fromAccount)return fromAccount;
 if(client.fiadoOpeningBalance)return(await require('./fiado-history-service').loadHistory({tx,c,ref,clientId,client,day:Plan.today(now)})).account;
 const snapshot=await tx.get(ref(c.bid,'sales','__none__').parent.where('clienteId','==',clientId));
 const sales=snapshot.docs.map(d=>({...d.data(),id:d.id})).filter(s=>(s.workspaceGeneration??0)===(c.business.workspaceGeneration??0));
 if(!includeTraditional&&!client.fiadoHistoryVersion&&!sales.some(s=>s.installmentPlan&&!s.deletedAt&&s.active!==false&&!s.desfeita))return null;
 if(snapshot.size>350)fail('Conta parcelada excede 350 vendas; exige apuração paginada antes de receber.');
 if(require('../shared/operational-privacy-policy').restricted(c.member))throw new HttpsError('permission-denied','Conta parcelada indisponível neste contexto restritivo.');
 for(const s of sales.filter(s=>s.formaPagamento==='fiado'&&!s.deletedAt&&s.active!==false)){if(s.spaceId)await c.space(s.spaceId);else if(!c.owner)throw new HttpsError('permission-denied','Histórico sem espaço exige proprietário.');}
 if(sales.some(s=>s.installmentPlan)){
  const allocations=await tx.get(ref(c.bid,'paymentAllocations','__none__').parent.where('clientId','==',clientId).limit(2001));if(allocations.size>2000)fail('Histórico de alocações excede o limite seguro.');
  for(const s of sales.filter(s=>s.installmentPlan&&!s.deletedAt&&s.active!==false)){const paid=allocations.docs.map(d=>d.data()).filter(a=>a.saleId===s.id).reduce((n,a)=>n+Plan.cents(a.amount),0);if(paid!==Plan.cents(s.creditPaidAmount||0))fail('Parcela com alocação não comprovada. Conciliação necessária.');}
 }
 let originalError;
 if(client.fiadoHistoryVersion!==1){try{return Account.project({...client,id:clientId},sales,Plan.today(now));}catch(e){originalError=e;}}
 if(historyProofVersion!==1)throw new HttpsError('failed-precondition','Atualize o aplicativo para apurar este histórico. A operação original foi preservada. '+(originalError?.message||''),{reason:'fiado-history-update-required',historyProofVersion:1});
 return(await require('./fiado-history-service').loadHistory({tx,c,ref,clientId,client,day:Plan.today(now)})).account;
}
module.exports={loadFiadoAccount,accountView,LEDGER_READ_ENABLED};

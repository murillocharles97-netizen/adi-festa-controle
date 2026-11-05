'use strict';
const Account=require('../shared/fiado-account'),Plan=require('../shared/installment-plan'),{HttpsError}=require('firebase-functions/v2/https');
const fail=message=>{throw new HttpsError('failed-precondition',message);};
async function loadFiadoAccount({tx,c,ref,clientId,now=new Date(),checkPermission=true}){
 if(checkPermission&&(!c.has('customers.receiveDebt')||!c.has('customers.view')))throw new HttpsError('permission-denied','Sem acesso ao Fiado deste cliente.');

 const client=(await tx.get(ref(c.bid,'clients',clientId))).data();
 if(!client||client.businessId&&client.businessId!==c.bid||(client.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))throw new HttpsError('permission-denied','Cliente não pertence à empresa/geração.');
 const snapshot=await tx.get(ref(c.bid,'sales','__none__').parent.where('clienteId','==',clientId));
 const sales=snapshot.docs.map(d=>({...d.data(),id:d.id})).filter(s=>(s.workspaceGeneration??0)===(c.business.workspaceGeneration??0));
 if(!sales.some(s=>s.installmentPlan&&!s.deletedAt&&s.active!==false&&!s.desfeita))return null;
 if(snapshot.size>350)fail('Conta parcelada excede 350 vendas; exige apuração paginada antes de receber.');
 if(require('../shared/operational-privacy-policy').restricted(c.member))throw new HttpsError('permission-denied','Conta parcelada indisponível neste contexto restritivo.');
 for(const s of sales.filter(s=>s.formaPagamento==='fiado'&&!s.deletedAt&&s.active!==false)){if(s.spaceId)await c.space(s.spaceId);else if(!c.owner)throw new HttpsError('permission-denied','Histórico sem espaço exige proprietário.');}
 if(sales.some(s=>s.installmentPlan)){
  const allocations=await tx.get(ref(c.bid,'paymentAllocations','__none__').parent.where('clientId','==',clientId).limit(2001));if(allocations.size>2000)fail('Histórico de alocações excede o limite seguro.');
  for(const s of sales.filter(s=>s.installmentPlan&&!s.deletedAt&&s.active!==false)){const paid=allocations.docs.map(d=>d.data()).filter(a=>a.saleId===s.id).reduce((n,a)=>n+Plan.cents(a.amount),0);if(paid!==Plan.cents(s.creditPaidAmount||0))fail('Parcela com alocação não comprovada. Conciliação necessária.');}
 }
 try{return Account.project({...client,id:clientId},sales,Plan.today(now));}catch(e){fail(e.message);}
}
module.exports={loadFiadoAccount};

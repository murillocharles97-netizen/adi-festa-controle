'use strict';
// A confirmed total changes only the traditional receivable in the selected
// space. Reuse the existing adjustment/proof ledger, never a sale or cash entry.
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {FieldValue}=require('firebase-admin/firestore');
const {validId}=require('./workspace-reset-policy');
const {operationalId}=require('../shared/operational-id');
const {readHistoryInput}=require('./fiado-history-service');
const {decideReceiptRoute}=require('./fiado-receipt-route');
const History=require('../shared/fiado-history-account');
const Plan=require('../shared/installment-plan');
const WRITES_ENABLED=true; // Compatible rollback pauses new intents, keeps proof/receipts.
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(code,message)=>{throw new HttpsError(code,message);};
const marked=client=>client.fiadoHistoryActivation?.spaceRegularization?.version===1;
async function handler({tx,c,ref,d,now,write=false}){
 if(!c.owner||c.business.ownerId!==c.uid||!c.has('customers.adjustBalance')||!c.has('customers.receiveDebt'))
  fail('permission-denied','Somente o proprietário da empresa pode regularizar saldos.');
 const spaceId=validId(d.spaceId,'Espaço'),clientId=validId(d.clientId,'Cliente');
 const space=await c.space(spaceId),generation=c.business.workspaceGeneration??0;
 if(space.status==='archived'||space.capabilities?.sales!==true)fail('failed-precondition','Selecione um espaço de vendas ativo.');
 const clientRef=ref(c.bid,'clients',clientId),client=(await tx.get(clientRef)).data();
 if(!client||client.businessId!==c.bid||(client.workspaceGeneration??0)!==generation||client.active===false||client.ativo===false||client.deletedAt||
  !(client.customerSpaceIds||[client.spaceId]).includes(spaceId))fail('permission-denied','Vincule explicitamente o cliente ao espaço antes de regularizar.');
 const scope={version:1,businessId:c.bid,workspaceGeneration:generation,clientId,spaceId};
 const operationId=d.operationId?operationalId(d.operationId,'Operação'):null;
 const marker=operationId?(await tx.get(ref(c.bid,'processedOperations',operationId))).data():null;
 const intent={...scope,actorUid:c.uid,quoteHash:d.quoteHash,financialVersion:d.financialVersion,targetDebtCents:d.targetDebtCents,purpose:d.purpose,reason:d.reason};
 const requestHash=write?hash(intent):null;
 if(marker){
  if(marker.actorUid!==c.uid||marker.businessId!==c.bid||marker.workspaceGeneration!==generation||marker.spaceRegularizationVersion!==1||
    marker.result?.clientId!==clientId||marker.result?.spaceId!==spaceId||write&&marker.requestHash!==requestHash)
   fail('already-exists','O identificador pertence a outra operação. Nenhum saldo foi alterado.');
  return {...marker.result,replayed:true};
 }
 if(d.kind==='fiado_space_regularization_status')return {...scope,status:'not_found'};
 const input=await readHistoryInput({tx,c,ref,clientId,client,checkRowAccess:false}),day=Plan.today(now);
 let account;
 // An untouched zero account has no historical debt to reconstruct. Any source
 // or prior financial version requires the normal proof, including pending rows.
 const cleanZero=client.saldo===0&&(client.financialVersion??0)===0&&!input.opening&&
  ['payments','balanceAdjustments','balanceEvents','paymentAllocations'].every(k=>!input.collections[k].length)&&
  input.collections.sales.every(s=>s.formaPagamento!=='fiado');
 if(cleanZero)account={version:2,financialVersion:0,asOf:day,totalCents:0,dueCents:0,futureCents:0,entries:[]};
 else{
  const route=await decideReceiptRoute({tx,c,ref,clientId,spaceId,now,includeAccount:true,scopedReceiptVersion:1,forConfirmation:true});
  if(route.mode!=='space')fail('failed-precondition',route.reason==='pending_payment'?'Há recebimento pendente. Confira a operação original antes de regularizar.':'A conta precisa de conferência financeira antes de regularizar.');
  try{account=History.project(input,day,{scoped:true});}catch{fail('failed-precondition','O saldo por espaço ainda não possui comprovação suficiente.');}
 }
 if(account.entries.some(e=>!e.spaceId)||account.totalCents!==-Math.round(client.saldo*100))fail('failed-precondition','Saldo ou origem financeira não comprovados.');
 const entries=account.entries.filter(e=>e.spaceId===spaceId),currentDebtCents=entries.reduce((n,e)=>n+e.remainingCents,0),
  protectedInstallmentsCents=entries.filter(e=>Number.isInteger(e.number)).reduce((n,e)=>n+e.remainingCents,0);
 const version=client.financialVersion??0,quoteHash=hash([scope,c.uid,day,version,client.saldo,account.entries,input.opening?.hash||null]);
 const quote={...scope,status:'preview',financialVersion:version,quoteHash,currentDebtCents,protectedInstallmentsCents,asOf:day};
 if(!write)return quote;
 if(!WRITES_ENABLED)fail('failed-precondition','Novas regularizações estão temporariamente pausadas. Recebimentos confirmados permanecem preservados.');
 if(!c.access.canMutate)fail('permission-denied','A conta não possui acesso de escrita.');
 if(!operationId||d.confirmed!==true||d.localQueueChecked!==true||!['historical_debt','correction'].includes(d.purpose)||
   typeof d.reason!=='string'||d.reason.trim().length<10||d.reason.length>500||
   !Number.isSafeInteger(d.targetDebtCents)||d.targetDebtCents<0||d.targetDebtCents>100000000)
  fail('invalid-argument','Informe o total correto e um motivo de pelo menos 10 caracteres. Confira as pendências locais.');
 if(d.quoteHash!==quoteHash||d.financialVersion!==version)fail('aborted','O saldo mudou. Consulte o servidor e revise a diferença antes de confirmar.');
 if(d.targetDebtCents<protectedInstallmentsCents)fail('failed-precondition','A regularização não pode reduzir ou substituir parcelas existentes.');
 const deltaDebtCents=d.targetDebtCents-currentDebtCents;
 if(!deltaDebtCents)fail('failed-precondition','O total informado já corresponde ao saldo confirmado.');
 const previousBalance=client.saldo,newBalance=(Math.round(previousBalance*100)-deltaDebtCents)/100;
 const last=Math.max(0,...input.collections.balanceEvents.map(e=>Date.parse(e.appliedAt)||0));
 if(last>now.getTime()+1000)fail('failed-precondition','A sequência financeira precisa de conferência de horário.');
 const at=new Date(Math.max(now.getTime(),last+1)).toISOString(),eventId='balance_adjustment:'+operationId;
 const common={id:operationId,operationId,businessId:c.bid,workspaceGeneration:generation,spaceId,financialSpaceId:spaceId,
  clienteId:clientId,clientId,customerId:clientId,actorUid:c.uid,actorRoleSnapshot:c.role,
  actorNameSnapshot:String(c.user.nome||c.user.name||'Proprietário').slice(0,120),
  createdAt:at,data:at,status:'applied',applicationStatus:'applied',spaceRegularizationVersion:1,
  ...(input.opening?{fiadoOpeningHash:input.opening.hash}:{} )};
 const adjustment={...common,tipo:'ajuste_saldo',purpose:d.purpose,motivo:d.reason.trim(),
  saldoAnterior:previousBalance,saldoNovo:newBalance,previousSpaceDebtCents:currentDebtCents,newSpaceDebtCents:d.targetDebtCents,
  deltaDebtCents,financialAppliedAt:at,financialOperationId:eventId,expectedFinancialVersion:version,financialVersionAfter:version+1};
 const event={...common,id:eventId,type:'balance_adjustment',sourceCollection:'balanceAdjustments',sourceDocumentId:operationId,
  balanceBefore:previousBalance,balanceAfter:newBalance,balanceDelta:-deltaDebtCents/100,appliedAt:at};
 const nextClient={...client,saldo:newBalance,financialVersion:version+1,fiadoHistoryVersion:1,
  fiadoHistoryActivation:{...(client.fiadoHistoryActivation||{}),spaceRegularization:{version:1,operationId,at}}};
 const result={...scope,status:'confirmed',operationId,previousDebtCents:currentDebtCents,newDebtCents:d.targetDebtCents,deltaDebtCents,financialVersion:version+1,confirmedAt:at};
 const processed={id:operationId,businessId:c.bid,workspaceGeneration:generation,actorUid:c.uid,eventKind:'balance_adjustment',status:'processed',
  spaceRegularizationVersion:1,requestHash,result,processedAt:at};
 const afterInput={...input,client:nextClient,collections:{...input.collections,
  balanceAdjustments:[...input.collections.balanceAdjustments,adjustment],balanceEvents:[...input.collections.balanceEvents,event],
  processedOperations:[...input.collections.processedOperations,processed]}};
 let after;
 try{after=History.project(afterInput,day,{scoped:true});}catch{fail('failed-precondition','A diferença não preserva a comprovação da conta. Nenhum saldo foi alterado.');}
 const totals=a=>Object.fromEntries([...new Set(a.entries.map(e=>e.spaceId))].sort().map(s=>[s,a.entries.filter(e=>e.spaceId===s).reduce((n,e)=>n+e.remainingCents,0)]));
 const beforeTotals=totals(account),afterTotals=totals(after);
 if((afterTotals[spaceId]||0)!==d.targetDebtCents||new Set([...Object.keys(beforeTotals),...Object.keys(afterTotals)]).size>30||
  [...new Set([...Object.keys(beforeTotals),...Object.keys(afterTotals)])].some(s=>s!==spaceId&&(beforeTotals[s]||0)!==(afterTotals[s]||0)))
  fail('failed-precondition','A diferença afetaria outra conta. Nenhum saldo foi alterado.');
 // Etapa 5: the per-Space account follows the regularization in this transaction.
 const accountWriter=await require('./customer-account-ledger-service').prepare({tx,ref,businessId:c.bid,generation,clientId,versionBefore:version,versionAfter:version+1,
  changes:[{event,source:adjustment}],at});
 // All reads and validations finish before the first write.
 tx.create(ref(c.bid,'balanceAdjustments',operationId),adjustment);
 tx.create(ref(c.bid,'balanceEvents',eventId),event);
 tx.create(ref(c.bid,'processedOperations',operationId),processed);
 tx.update(clientRef,{saldo:newBalance,financialVersion:version+1,fiadoHistoryVersion:1,fiadoHistoryActivation:nextClient.fiadoHistoryActivation,atualizadoEm:at});
 if(accountWriter)accountWriter(tx);
 const names=['clients','balanceAdjustments','balanceEvents'],revision='server:'+operationId;
 tx.set(ref(c.bid,'syncMetadata','last-sync'),{businessId:c.bid,workspaceGeneration:generation,
  publisher:'operational_server',sourceSessionId:revision,sourceOperationId:operationId,
  ownerId:c.uid,actorUid:c.uid,sourceUid:c.uid,sourceDeviceId:FieldValue.delete(),revision,
  updatedAt:FieldValue.serverTimestamp(),changedCollections:names,collectionVersions:Object.fromEntries(names.map(n=>[n,revision]))},{merge:true});
 return result;
}
module.exports={handler,marked};

'use strict';
// V240: server-validated, reversible configuration of a financial space's
// automatic income. The financial space and the sales space are the SAME
// document (financialSpaces/{spaceId}); income projectors already route each
// sale/payment by its own spaceId, so linking never moves revenue between
// spaces and never imports events that happened before the activation instant.
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {FieldValue}=require('firebase-admin/firestore');

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const OP=/^[A-Za-z0-9_:-]{8,160}$/;
const fail=(code,message,reason)=>{throw new HttpsError(code,message,reason?{reason}:undefined);};
const text=v=>String(v??'').trim();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bool=(v,name)=>{if(typeof v!=='boolean')fail('invalid-argument',`Informe ${name}.`,'invalid-flag');return v;};
const canonicalAutomation=a=>a&&typeof a==='object'?{
  enabled:a.enabled===true,linkedBusinessId:text(a.linkedBusinessId)||null,linkedSalesSpaceId:text(a.linkedSalesSpaceId)||null,
  activatedAt:text(a.activatedAt)||null,
  defaultIncomeFinancialAccountId:text(a.defaultIncomeFinancialAccountId)||null,
  defaultIncomeFinancialAccountHomeSpaceId:text(a.defaultIncomeFinancialAccountHomeSpaceId)||null,
  autoIncome:{sales:a.autoIncome?.sales===true,customerPayments:a.autoIncome?.customerPayments===true,onlineOrders:a.autoIncome?.onlineOrders===true},
  expensesManual:true,
}:null;

function accountAllowsSpace(account,homeSpaceId,spaceId){
  if(!account||account.active===false)return false;
  if(account.accessMode==='all_spaces')return true;
  if(account.accessMode==='selected_spaces')return Array.isArray(account.allowedFinancialSpaceIds)&&account.allowedFinancialSpaceIds.includes(spaceId);
  return (text(account.defaultFinancialSpaceId)||text(account.accountHomeSpaceId)||homeSpaceId)===spaceId;
}

function financialSpaceAutomationService(db,{now=()=>new Date()}={}){
  const spaceRef=id=>db.doc(`financialSpaces/${id}`);
  const changeRef=(id,op)=>db.doc(`financialSpaces/${id}/automationChanges/${op}`);

  function assertLinkable(space,{bid,uid,spaceId}){
    if(!space||space.id!==undefined&&space.id!==spaceId)fail('not-found','Espaço financeiro não encontrado.','space-not-found');
    if(['all','all_spaces'].includes(spaceId))fail('invalid-argument','Todos os espaços é uma visão, não um espaço real.','reserved-space');
    if(space.active===false||(space.status&&space.status!=='active'))fail('failed-precondition','Este espaço está arquivado.','space-inactive');
    if(text(space.ownerUid)!==uid)fail('permission-denied','Somente o proprietário do espaço pode vincular a automação.','space-owner-mismatch');
    const bindings=[space.businessId,space.linkedBusinessId].map(text).filter(Boolean);
    if(!bindings.length||bindings.some(v=>v!==bid))fail('permission-denied','Este espaço pertence a outra empresa.','space-business-mismatch');
    const linked=text(space.automation?.linkedBusinessId);
    if(linked&&linked!==bid)fail('permission-denied','A automação deste espaço pertence a outra empresa.','automation-business-mismatch');
    if(space.capabilities?.finance!==true)fail('failed-precondition','Ative o financeiro neste espaço antes de vincular.','finance-disabled');
    if(space.capabilities?.sales!==true)fail('failed-precondition','Este espaço não possui vendas para vincular.','sales-disabled');
  }

  async function authorize(tx,request){
    const uid=request.auth?.uid;
    if(!uid)fail('unauthenticated','Entre novamente para continuar.');
    const d=request.data||{},bid=text(d.businessId),spaceId=text(d.spaceId);
    if(!ID.test(bid)||!ID.test(spaceId))fail('invalid-argument','Empresa ou espaço inválido.','invalid-scope');
    const business=(await tx.get(db.doc(`businesses/${bid}`))).data();
    if(!business||business.deletedAt||business.status==='deleted')fail('not-found','Empresa não encontrada.','business-not-found');
    if(business.ownerId!==uid)fail('permission-denied','Somente o proprietário da empresa pode alterar a automação financeira.','owner-required');
    const snapshot=await tx.get(spaceRef(spaceId));
    const space=snapshot.exists?snapshot.data():null;
    assertLinkable(space,{bid,uid,spaceId});
    return {uid,d,bid,spaceId,space};
  }

  async function resolveAccount(tx,{space,spaceId,accountId,homeSpaceId}){
    if(!accountId)return {id:null,home:null};
    if(!ID.test(accountId)||homeSpaceId&&!ID.test(homeSpaceId))fail('invalid-argument','Conta financeira inválida.','invalid-account');
    const home=homeSpaceId||spaceId;
    if(home!==spaceId){
      const homeSpace=(await tx.get(spaceRef(home))).data();
      if(!homeSpace||text(homeSpace.ownerUid)!==text(space.ownerUid)||homeSpace.active===false)
        fail('failed-precondition','A conta escolhida não está disponível neste espaço.','account-unavailable');
    }
    const account=(await tx.get(db.doc(`financialSpaces/${home}/financialAccounts/${accountId}`))).data();
    if(!account||text(account.ownerUid||space.ownerUid)!==text(space.ownerUid)||!accountAllowsSpace(account,home,spaceId))
      fail('failed-precondition','A conta escolhida não está disponível neste espaço.','account-unavailable');
    return {id:accountId,home};
  }

  async function configure(request){
    return db.runTransaction(async tx=>{
      const {uid,d,bid,spaceId,space}=await authorize(tx,request);
      const operationId=text(d.operationId);
      if(!OP.test(operationId))fail('invalid-argument','Operação inválida.','invalid-operation');
      const revision=Number.isSafeInteger(space.automationRevision)?space.automationRevision:0;
      const revert=text(d.revertOperationId)||null;
      const intent=revert?{bid,spaceId,uid,revert}:{bid,spaceId,uid,enabled:bool(d.enabled,'se a automação fica ativa'),
        sales:bool(d.sales,'vendas pagas'),customerPayments:bool(d.customerPayments,'pagamentos de clientes'),
        onlineOrders:bool(d.onlineOrders,'pedidos online'),account:text(d.defaultIncomeFinancialAccountId)||null,
        accountHome:text(d.defaultIncomeFinancialAccountHomeSpaceId)||null};
      const requestHash=hash(intent);
      const existing=(await tx.get(changeRef(spaceId,operationId))).data();
      if(existing){
        if(existing.requestHash!==requestHash||existing.actorUid!==uid||existing.businessId!==bid)
          fail('already-exists','Este identificador pertence a outra alteração. Nada foi modificado.','operation-reused');
        return {...existing.result,replayed:true};
      }
      if(!Number.isSafeInteger(d.expectedRevision)||d.expectedRevision!==revision)
        fail('aborted','A automação foi alterada em outro aparelho. Abra novamente e revise.','revision-changed');
      const before=space.automation===undefined?null:space.automation;
      const at=now().toISOString();
      let after;
      if(revert){
        if(!OP.test(revert))fail('invalid-argument','Operação inválida.','invalid-operation');
        const target=(await tx.get(changeRef(spaceId,revert))).data();
        if(!target||target.businessId!==bid||target.kind!=='configure')fail('not-found','Alteração não encontrada.','change-not-found');
        if(target.revisionAfter!==revision)fail('failed-precondition','Somente a última alteração pode ser desfeita.','not-latest-change');
        after=target.before;
        // Turning automation back on never reuses an old instant (no backfill).
        if(after?.enabled===true&&canonicalAutomation(before)?.enabled!==true)after={...after,activatedAt:at};
      }else{
        const current=canonicalAutomation(before)||{enabled:false,activatedAt:null};
        const acc=await resolveAccount(tx,{space,spaceId,accountId:intent.account,homeSpaceId:intent.accountHome});
        // A new activation instant whenever automation turns on: events that
        // happened while it was off (or before it existed) are never imported.
        const activatedAt=intent.enabled?(current.enabled?current.activatedAt||at:at):current.activatedAt||null;
        after={enabled:intent.enabled,linkedBusinessId:bid,linkedSalesSpaceId:spaceId,activatedAt,
          defaultIncomeFinancialAccountId:acc.id,defaultIncomeFinancialAccountHomeSpaceId:acc.home,
          autoIncome:{sales:intent.sales,customerPayments:intent.customerPayments,onlineOrders:intent.onlineOrders},
          expensesManual:true,configuredBy:uid,configuredAt:at,automationVersion:1};
      }
      const result={status:'confirmed',operationId,businessId:bid,spaceId,revision:revision+1,automation:canonicalAutomation(after)};
      tx.set(changeRef(spaceId,operationId),{operationId,kind:revert?'revert':'configure',businessId:bid,spaceId,actorUid:uid,
        requestHash,before,after,revisionBefore:revision,revisionAfter:revision+1,createdAt:at,result});
      tx.update(spaceRef(spaceId),{automation:after===null?FieldValue.delete():after,automationRevision:revision+1,automationLastOperationId:revert?FieldValue.delete():operationId,updatedAt:FieldValue.serverTimestamp()});
      return result;
    });
  }

  async function read(request){
    return db.runTransaction(async tx=>{
      const {bid,spaceId,space}=await authorize(tx,request);
      return {businessId:bid,spaceId,revision:Number.isSafeInteger(space.automationRevision)?space.automationRevision:0,
        automation:canonicalAutomation(space.automation),type:space.type||null};
    });
  }
  return {configure,read,assertLinkable,canonicalAutomation};
}
module.exports={financialSpaceAutomationService,accountAllowsSpace};

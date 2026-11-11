'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {validId}=require('./workspace-reset-policy');

const fail=(code,message)=>{throw new HttpsError(code,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const generation=value=>value?.workspaceGeneration??0;
const active=value=>value?.ativo!==false&&value?.active!==false&&!value?.deletedAt;
const phoneOf=value=>{
 let digits=String(value||'').replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(digits.startsWith('0')&&(digits.length===11||digits.length===12))digits=digits.slice(1);
 return digits.length===10||digits.length===11?'55'+digits:digits;
};
const registeredPhone=row=>phoneOf(row?.telefone||row?.normalizedPhone||row?.telefoneNormalizado);
const belongs=(row,c)=>row&&(!row.businessId||row.businessId===c.bid)&&generation(row)===generation(c.business);
const explicitSpaces=row=>[...new Set([...(Array.isArray(row?.customerSpaceIds)?row.customerSpaceIds:[]),
 ...(row?.spaceId&&row.financialSpaceId&&row.spaceId!==row.financialSpaceId?[]:[row?.spaceId||row?.financialSpaceId])
].filter(id=>typeof id==='string'&&id))];
const unrestricted=c=>c.owner||c.member?.spaceAccess==='all';
const canSeeSource=(c,row)=>c.has('customers.view')&&(unrestricted(c)||explicitSpaces(row).some(id=>c.member?.allowedSpaceIds?.includes(id)));

async function findPhone({tx,root,c,phone,rows}){
 const key=root.collection('customerPhoneKeys').doc(digest(phone));
 const known=(await tx.get(key)).data();
 if(known?.clientId&&generation(known)===generation(c.business)){
  const match=await tx.get(root.collection('clients').doc(known.clientId));
  if(belongs(match.data(),c)&&registeredPhone(match.data())===phone)return {key,matches:[match]};
 }
 const matches=(await rows()).filter(doc=>belongs(doc.data(),c)&&registeredPhone(doc.data())===phone);
 return {key,matches};
}

function directoryRows(tx,root){
 let result;
 return ()=>result??=(async()=>{
  // Legacy records can have only a formatted phone. Check the actual directory
  // without reading balances or financial history, before claiming a new key.
  const rows=await tx.get(root.collection('clients')
    .select('businessId','workspaceGeneration','telefone','normalizedPhone','telefoneNormalizado','active','ativo','deletedAt').limit(3001));
  if(rows.size>3000)fail('failed-precondition','O diretório exige conferência administrativa antes de cadastrar com segurança.');
  return rows.docs;
 })();
}

const keyValue=(c,id)=>({clientId:id,businessId:c.bid,workspaceGeneration:generation(c.business)});
function signal(tx,root,c,revision){
 tx.set(root.collection('syncMetadata').doc('last-sync'),{
  businessId:c.bid,workspaceGeneration:generation(c.business),revision,updatedAt:new Date().toISOString(),
  publisher:'operational_server',sourceSessionId:revision,sourceOperationId:revision,
  ownerId:c.uid,actorUid:c.uid,sourceUid:c.uid,changedCollections:['clients'],collectionVersions:{clients:revision},
 },{merge:true});
}
function profile(input){
 const fields=['nome','apelido','telefone','telefone2','email','endereco','cidade','estado','complemento','documento','observacoes'];
 const result=Object.fromEntries(fields.map(key=>{
  const value=input?.[key]??'';
  if(typeof value!=='string'||value.length>(key==='observacoes'?4000:320))fail('invalid-argument','Revise os dados do cliente.');
  return [key,value.trim()];
 }));
 if(!result.nome)fail('invalid-argument','Informe o nome do cliente.');
 result.marketingConsent=input?.marketingConsent===true||input?.marketingConsent==='true';
 return result;
}
async function knownRelation(tx,root,c,clientId,spaceId){
 const checks=[['sales','clienteId'],['sales','clientId'],['customerSubscriptions','clientId']];
 const groups=await Promise.all(checks.map(([collection,field])=>tx.get(root.collection(collection).where(field,'==',clientId)
   .select('spaceId','financialSpaceId','businessId','workspaceGeneration','active','ativo','deletedAt','status','saleStatus','desfeita','cancelledAt'))));
 return groups.some((group,index)=>group.docs.some(doc=>{
  const row=doc.data();
  const invalidSale=index<2&&(row.desfeita||row.cancelledAt||
   /^(cancelad[oa]|cancelled|canceled|desfeit[oa]|venda_desfeita|estornad[oa]|refunded)$/.test(String(row.status||row.saleStatus||'').toLowerCase()));
  return belongs(row,c)&&active(row)&&!invalidSale&&explicitSpaces(row).includes(spaceId);
 }));
}

async function manageCustomerDirectory({db,tx,c,request}){
 const {action,activeSpaceId}=request;
 const spaceId=validId(activeSpaceId,'Espaço');
 if(action!=='create'&&action!=='link')fail('invalid-argument','Ação de cadastro inválida.');
 if(action==='create'&&!c.has('customers.create')||action==='link'&&(!c.has('customers.edit')||!c.has('customers.view')))
  fail('permission-denied','Seu perfil não pode realizar esta ação de cadastro.');
 const checkSpace=async id=>{
  const space=await c.space(validId(id,'Espaço'));
  if(space.status==='inactive'||space.capabilities&&!(space.capabilities.sales||space.capabilities.products))
   fail('permission-denied','Selecione um espaço operacional autorizado.');
 };
 await checkSpace(spaceId);
 const root=db.doc('businesses/'+c.bid),rows=directoryRows(tx,root);
 const supplied=action==='create'?profile(request.customer):null;
 const phone=phoneOf(supplied?.telefone??request.phone);
 if((action==='link'||supplied?.telefone)&&!/^55[1-9]\d\d{8,9}$/.test(phone))
  fail('invalid-argument','Informe um WhatsApp válido com DDD.');
 if(action==='link'&&request.confirmed!==true)fail('failed-precondition','Confirme o vínculo com este espaço.');
 const spaces=action==='create'?request.spaceIds:[spaceId];
 if(!Array.isArray(spaces)||spaces.length<1||spaces.length>50||new Set(spaces).size!==spaces.length||!spaces.includes(spaceId))
  fail('invalid-argument','Mantenha o espaço ativo selecionado e confira os demais espaços.');
 for(const id of spaces)if(id!==spaceId)await checkSpace(id);
 const id=validId(request.customerId,'Cliente'),ref=root.collection('clients').doc(id);
 const proposedHash=supplied&&digest(JSON.stringify([supplied,spaceId,spaces.slice().sort()]));
 if(action==='create'){
  const prior=(await tx.get(ref)).data();
  if(prior){
   if(belongs(prior,c)&&prior.customerRegistrationUid===c.uid&&prior.customerRegistrationHash===proposedHash)
    return {status:'created',clientId:id,spaceIds:explicitSpaces(prior).filter(space=>unrestricted(c)||c.member?.allowedSpaceIds?.includes(space))};
   fail('already-exists','Este identificador já pertence a outro cadastro.');
  }
 }
 const lookup=phone?await findPhone({tx,root,c,phone,rows}):null;
 if(lookup?.matches.length>1)return {status:'duplicate-review'};
 if(lookup?.matches.length){
  const match=lookup.matches[0],existing=(await tx.get(match.ref)).data();
  if(!active(existing)||!c.has('customers.view'))return {status:'duplicate-private'};
  const linked=explicitSpaces(existing).includes(spaceId)||await knownRelation(tx,root,c,match.id,spaceId);
  if(!linked&&!canSeeSource(c,existing))return {status:'duplicate-private'};
  const allowedSpaces=()=>explicitSpaces(existing).filter(space=>unrestricted(c)||c.member?.allowedSpaceIds?.includes(space));
  if(action==='create')return linked
   ?{status:'already-linked',clientId:match.id,spaceIds:[...new Set([...allowedSpaces(),spaceId])]}
   :{status:'duplicate',...(c.has('customers.edit')?{clientId:match.id,canLink:true}:{})};
  if(match.id!==id)fail('failed-precondition','O cadastro associado ao WhatsApp mudou. Confira novamente.');
  if(linked)return {status:'already-linked',clientId:id,spaceIds:[...new Set([...allowedSpaces(),spaceId])]};
  const next=[...new Set([...(Array.isArray(existing.customerSpaceIds)?existing.customerSpaceIds:[]),spaceId])];
  tx.update(match.ref,{customerSpaceIds:next});
  signal(tx,root,c,'customer-link:'+id+':'+spaceId);
  return {status:'linked',clientId:id,spaceIds:[...new Set([...allowedSpaces(),spaceId])]};
 }
 if(action==='link')fail('failed-precondition','O cadastro associado ao WhatsApp mudou. Confira novamente.');
 const limit=c.business.limits?.clients;
 if(Number.isFinite(limit)&&(await rows()).filter(row=>belongs(row.data(),c)&&active(row.data())).length>=limit)
  fail('resource-exhausted','O plano atingiu o limite de clientes.');
 const now=new Date().toISOString();
 const record={...supplied,id,businessId:c.bid,workspaceGeneration:generation(c.business),spaceId,
  customerSpaceIds:spaces,normalizedPhone:phone,telefoneNormalizado:supplied.telefone.replace(/\D/g,''),
  nomeNormalizado:supplied.nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),
  ativo:true,active:true,saldo:0,financialVersion:0,totalComprado:0,quantidadeVendas:0,ultimaCompra:null,
  etiquetas:[],promessaPagamento:null,origemCadastro:'app',portalRefToken:randomUUID(),
  marketingConsentAt:supplied.marketingConsent?now:null,marketingConsentSource:supplied.marketingConsent?'manual':null,
  criadoEm:now,atualizadoEm:now,createdAt:now,updatedAt:now,operationId:id,actorUid:c.uid,
  customerRegistrationUid:c.uid,customerRegistrationHash:proposedHash,
 };
 tx.create(ref,record);
 if(lookup)tx.set(lookup.key,keyValue(c,id));
 signal(tx,root,c,'customer-create:'+id);
 return {status:'created',clientId:id,spaceIds:spaces,created:{...supplied,id,businessId:c.bid,workspaceGeneration:generation(c.business),spaceId,customerSpaceIds:spaces,ativo:true,saldo:0,financialVersion:0}};
}

async function validateCustomerDirectoryWrites({db,tx,c,writes,plan,old}){
 const root=db.doc('businesses/'+c.bid),rows=directoryRows(tx,root),claims=new Map();
 for(const write of writes.filter(row=>row.entityType==='clients')){
  const ref=root.collection('clients').doc(write.entityId);
  const before=await old(ref),patch=plan.get(ref.path)?.data;
  if(!patch)continue;
  if(['customerSpaceIds','customerRegistrationUid','customerRegistrationHash'].some(field=>
    Object.hasOwn(write.data,field)&&JSON.stringify(write.data[field])!==JSON.stringify(before?.[field])))
   fail('permission-denied','Vínculos de cadastro exigem a confirmação no formulário de clientes.');
  const phone=registeredPhone({...before,...patch});
  if(!phone||phone===registeredPhone(before))continue;
  if(claims.has(phone)&&claims.get(phone)!==write.entityId)fail('already-exists','Já existe um cliente com este WhatsApp.');
  claims.set(phone,write.entityId);
  const {key,matches}=await findPhone({tx,root,c,phone,rows});
  if(matches.some(match=>match.id!==write.entityId))fail('already-exists','Já existe um cliente com este WhatsApp.');
  plan.set(key.path,{ref:key,data:keyValue(c,write.entityId)});
 }
}

module.exports={manageCustomerDirectory,validateCustomerDirectoryWrites};

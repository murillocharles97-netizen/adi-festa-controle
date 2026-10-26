'use strict';
// Explicit owner approval of preserved customer dependencies. Never a generic queue replay.
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {validId}=require('./workspace-reset-policy');
const CUSTOMER_RECOVERY_ENABLED=false;
const fail=message=>{throw new HttpsError('failed-precondition',message);};
const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(value));
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const name=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const phone=value=>String(value||'').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
const email=value=>String(value||'').trim().toLowerCase();
const metadata=['nome','apelido','telefone','normalizedPhone','telefone2','email','endereco','cidade','estado','complemento','documento','observacoes','marketingConsent','marketingConsentAt','marketingConsentSource','marketingConsentRevokedAt','origemCadastro','portalRefToken','etiquetas','promessaPagamento','criadoEm'];
function dependencies(original,businessId,uid,sale,generation){
 const sources=original.clientDependencies;if(sources===undefined)return[];
 if(!Array.isArray(sources)||sources.length>20)fail('Dependências de clientes inválidas.');
 const ids=new Set(),operations=new Set();
 return sources.map(source=>{
  if(!source||Object.keys(source).some(k=>k!=='packet'))fail('Conteúdo auxiliar de cadastro não suportado.');
  const p=source?.packet,w=p?.payload?.writes;
  if(!p||p.businessId!==businessId||p.userId!==uid||(p.workspaceGeneration??0)!==generation||p.status!=='error'||p.lastErrorCode!=='permission-denied'||!Array.isArray(w)||w.length!==1||w[0].entityType!=='clients'||w[0].operation!=='create')fail('A dependência precisa do cadastro original negado, da mesma conta e empresa.');
  const operationId=validId(p.operationId,'Operação do cliente'),clientId=validId(w[0].entityId,'Cliente'),data=w[0].data;
  if(ids.has(clientId)||operations.has(operationId)||operationId===original.packet.operationId)fail('Dependências repetidas ou conflitantes.');ids.add(clientId);operations.add(operationId);
  if(!data||data.id&&data.id!==clientId||data.businessId&&data.businessId!==businessId||data.actorUid&&data.actorUid!==uid||data.workspaceGeneration!==undefined&&data.workspaceGeneration!==generation||data.spaceId&&data.spaceId!==sale.spaceId||!String(data.nome||'').trim())fail('Cadastro original de outra origem ou incompleto.');
  for(const key of ['saldo','financialVersion','openBalance','legacyBalance','legacyBalanceRemaining','totalComprado','quantidadeVendas'])if(data[key]!==undefined&&data[key]!==0)fail('Aprovar cadastro não pode criar saldo ou histórico comercial.');
  return{packet:p,data,clientId,operationId,payloadHash:hash(p.payload),related:clientId===String(sale.clienteId||sale.clientId||sale.customerId||'')};
 });
}
function paidClientPlan(v){
 const clientId=String(v.sale.clienteId||v.sale.clientId||v.sale.customerId||'');if(!clientId)return null;
 if(!CUSTOMER_RECOVERY_ENABLED)fail('Recuperação de vendas com dependência de cliente temporariamente pausada. Os originais e recibos permanecem preservados.');
 if(['clienteId','clientId','customerId'].some(k=>v.sale[k]&&String(v.sale[k])!==clientId))fail('Identificadores de cliente divergentes.');
 const dep=v.clientDependencies?.find(d=>d.clientId===clientId);if(!dep)fail('Falta o pacote original do cadastro deste cliente. Envie a dependência para análise; nenhum efeito será aplicado.');
 const writes=v.packet.payload.writes.filter(w=>w.entityType==='clients');
 if(writes.length!==1||writes[0].entityId!==clientId||writes[0].operation!=='update'||!writes[0].before)fail('A projeção original do cliente precisa de revisão técnica.');
 const w=writes[0],before=w.before,after={...before,...w.data};
 const allowed=new Set(['totalComprado','quantidadeVendas','ultimaCompra','atualizadoEm','updatedAt','updatedByUid','ownerId','businessId','workspaceGeneration','workspaceWriteId','operationId','idempotencyKey','version','schemaVersion','action','entityType','saldo','financialVersion']);
 for(const k of Object.keys(w.data))if(canonical(w.data[k])!==canonical(before[k]??null)&&!allowed.has(k))fail('A venda contém edição cadastral auxiliar. Não será ignorada na recuperação.');
 if(Math.round((Number(after.totalComprado)-Number(before.totalComprado||0))*100)!==Math.round(v.total*100)||Number(after.quantidadeVendas)-Number(before.quantidadeVendas||0)!==1||Number(after.saldo||0)!==Number(before.saldo||0)||Number(after.financialVersion||0)!==Number(before.financialVersion||0))fail('A projeção do cliente não corresponde exclusivamente à venda à vista.');
 return{clientId,dependency:dep};
}
async function prepareApproval({db,tx,c,v,reviewRef,clientOperationId,FieldValue}){
 if(!CUSTOMER_RECOVERY_ENABLED)fail('Aprovação de cadastros retidos temporariamente pausada. Nenhum registro será apagado ou reprocessado.');
 if(!c.owner)fail('Somente o proprietário pode aprovar a dependência.');
 const dep=v.clientDependencies?.find(d=>d.operationId===(clientOperationId||v.clientDependencies.find(x=>x.related)?.operationId));
 if(!dep)fail('Cadastro original não encontrado neste pacote.');
 const root=db.doc('businesses/'+c.businessId),clientRef=root.collection('clients').doc(dep.clientId),opRef=root.collection('saleRecoveryOperations').doc(dep.operationId),markerRef=root.collection('processedOperations').doc(dep.operationId),auditRef=reviewRef.collection('dependencies').doc(dep.operationId);
 const [client,op,marker,audit,member,profile]=await Promise.all([tx.get(clientRef),tx.get(opRef),tx.get(markerRef),tx.get(auditRef),tx.get(root.collection('members').doc(v.sale.actorUid)),tx.get(db.doc('users/'+v.sale.actorUid))]);
 const actor=member.data();if(actor?.status!=='active'||profile.data()?.active!==true||actor.role!=='owner'&&actor.spaceAccess!=='all'&&!actor.allowedSpaceIds?.includes(v.spaceId))fail('O vínculo original do cadastro não está ativo neste espaço.');
 if(op.exists||marker.exists||client.exists){
  const o=op.data(),m=marker.data();
  if(client.exists&&client.data().customerRecoveryHash===dep.payloadHash&&client.data().businessId===c.businessId&&o?.kind==='client_dependency'&&o.status==='client_confirmed'&&o.clientId===dep.clientId&&o.actorUid===v.sale.actorUid&&o.payloadHash===dep.payloadHash&&o.businessId===c.businessId&&o.spaceId===v.spaceId&&o.workspaceGeneration===(c.business.workspaceGeneration??0)&&m?.customerRecoveryHash===dep.payloadHash&&m.operationId===dep.operationId&&m.businessId===c.businessId&&m.status==='processed')return{clientId:dep.clientId,operationId:dep.operationId,idempotent:true,commit(){}};
  fail('O cliente ou a operação já existe com outra origem. Não será criado cadastro duplicado ou sobrescrito.');
 }
 // Conservative, bounded comparison. Similarity is never an automatic merge.
 const existing=await tx.get(root.collection('clients').limit(1001));if(existing.size>1000)fail('Muitos clientes para conferir duplicidade com segurança. Solicite análise específica.');
 const p=phone(dep.data.normalizedPhone||dep.data.telefone),e=email(dep.data.email),n=name(dep.data.nome);
 const duplicate=existing.docs.find(s=>{const d=s.data();return !d.deletedAt&&d.active!==false&&d.ativo!==false&&((p&&p===phone(d.normalizedPhone||d.telefone))||(e&&e===email(d.email))||(n&&n===name(d.nome)));});
 if(duplicate)throw new HttpsError('failed-precondition','Existe cliente semelhante com outro identificador. O responsável precisa comparar antes de aprovar; nenhum cadastro foi criado.',{reason:'customer-possible-duplicate',candidateId:duplicate.id});
 if(audit.exists)fail('Já existe evidência de aprovação sem confirmação canônica. Revisão técnica necessária.');
 const at=FieldValue.serverTimestamp(),generation=c.business.workspaceGeneration??0,base=Object.fromEntries(metadata.filter(k=>dep.data[k]!==undefined).map(k=>[k,dep.data[k]]));
 const receipt={kind:'client_dependency',status:'client_confirmed',clientId:dep.clientId,operationId:dep.operationId,businessId:c.businessId,spaceId:v.spaceId,actorUid:v.sale.actorUid,workspaceGeneration:generation,payloadHash:dep.payloadHash,originSaleId:v.saleId,contentHash:v.contentHash,resolvedByUid:c.uid,resolvedAt:at};
 return{clientId:dep.clientId,operationId:dep.operationId,idempotent:false,commit(){
  tx.create(clientRef,{...base,id:dep.clientId,operationId:dep.operationId,businessId:c.businessId,workspaceGeneration:generation,ownerId:v.sale.actorUid,actorUid:v.sale.actorUid,ativo:true,active:true,saldo:0,financialVersion:0,totalComprado:0,quantidadeVendas:0,ultimaCompra:null,updatedAt:at,recoveredFromReview:true,recoveredByUid:c.uid,customerRecoveryHash:dep.payloadHash});
  tx.create(opRef,receipt);tx.create(markerRef,{...receipt,id:dep.operationId,idempotencyKey:dep.operationId,status:'processed',eventKind:'customer_dependency_recovery',ownerId:c.uid,customerRecoveryHash:dep.payloadHash,processedAt:at});
  tx.create(auditRef,{...receipt,action:'approve_client',commercialEffectsApplied:false,originalPacketHash:hash(dep.packet)});
  const revision='server:customer-recovery:'+dep.operationId;
  tx.set(root.collection('syncMetadata').doc('last-sync'),{businessId:c.businessId,workspaceGeneration:generation,publisher:'operational_server',sourceUid:c.uid,actorUid:c.uid,sourceOperationId:dep.operationId,sourceDeviceId:FieldValue.delete(),sourceSessionId:revision,revision,updatedAt:at,changedCollections:['clients'],collectionVersions:{clients:revision}},{merge:true});
 }};
}
module.exports={dependencies,paidClientPlan,prepareApproval,hash,CUSTOMER_RECOVERY_ENABLED};

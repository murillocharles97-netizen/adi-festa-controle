import {auth,db} from './firebase-config.js?v=42';
import {collection,doc,onSnapshot,serverTimestamp,setDoc} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {maskPhone,normalizeBrazilianPhone,phoneIndexId} from '../catalog-portal.js';
import {listenerClosed,listenerOpened,recordFirestoreOperation} from './usage-monitor.js?v=42';

const subscriptions=new Map(),now=()=>new Date().toISOString();
const ACTIVE_VISIT_STATUSES=new Set(['recebendo','pedidos_encerrados','separacao','deslocamento']);
const businessId=()=>window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.profile?.businessId||'';
const validPublicToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(value);
const versioned=(url,updatedAt)=>url&&updatedAt?`${url}${url.includes('?')?'&':'?'}v=${encodeURIComponent(new Date(updatedAt).getTime()||updatedAt)}`:url||'';
const maskedName=name=>{const parts=String(name||'Cliente').trim().split(/\s+/);return parts.length>1?`${parts[0]} ${parts.at(-1).slice(0,1)}.`:parts[0]};

function publicCampaign(c){
  c=window.Campanhas?.normalize?.(c)||c;
  return{id:c.id,nome:c.name||c.nome||'Campanha',descricao:c.description||c.descricao||'',tipo:c.type||c.tipo||'custom',imagem:c.imageUrl||null,icone:c.imageIcon||'megaphone',dataInicio:c.startDate||c.dataInicio||'',dataFim:c.endDate||c.dataFim||'',produtoIds:c.productIds||[],produtoPremioId:c.rewardProductId||'',regras:c.rules||{},participantes:Number(c.participantsCount||0),resgates:Number(c.redemptionsCount||0)};
}

function publicPayload(visit){
  const local=DB.carregar(),context=window.BusinessContext?.get?.()||{},business=context.business||window.FirebaseSession?.business||{},settings=local.config.catalogSettings||{},products=new Map((local.produtos||[]).map(product=>[product.id,product])),campaigns=(local.campanhas||[]).map(c=>window.Campanhas?.normalize?.(c)||c).filter(c=>(window.Campanhas?.status?.(c)||c.status)==='ativa'&&c.ativo!==false&&c.publica!==false&&(c.audience?.type||'all')==='all').map(publicCampaign);
  return{catalogToken:visit.publicToken,documentId:visit.publicToken,schemaVersion:3,visitId:visit.id,businessId:businessId(),businessSlug:business.slug||'',businessName:business.name||local.config.nome||'',publicSettings:{publicName:settings.publicName||business.name||local.config.nome||'Adi Festa',primaryColor:settings.primaryColor||'#31d0ad',contactPhone:settings.contactPhone||settings.whatsapp||business.phone||local.config.telefone||''},publicName:settings.publicName||business.name||local.config.nome||'Adi Festa',primaryColor:settings.primaryColor||'#31d0ad',welcomeText:settings.welcomeText||visit.descricao||'Veja os produtos disponíveis e faça seu pedido.',contactPhone:settings.contactPhone||settings.whatsapp||business.phone||local.config.telefone||'',local:visit.local,nome:visit.nome,data:visit.data,horarioChegada:visit.horarioChegada,horarioLimite:visit.horarioLimite,status:visit.status,active:visit.status==='recebendo',paymentMethods:settings.paymentMethods||['entrega','pix','dinheiro','cartao'],allowCredit:Boolean(settings.allowCredit),items:(visit.catalogItems||[]).filter(i=>i.active!==false).map(i=>{const product=products.get(i.productId),imageUpdatedAt=product?.imageUpdatedAt||i.imageUpdatedAt||null;return{...i,productImage:versioned(product?.imageThumbUrl||product?.imageUrl||product?.imagem||i.productImage||'',imageUpdatedAt),productMainImage:versioned(product?.imageUrl||product?.imagem||i.productMainImage||'',imageUpdatedAt),imageUpdatedAt,reservedStock:0}}),campaigns,updatedAt:serverTimestamp()};
}

function safeOrders(local,visit,client){
  const phone=normalizeBrazilianPhone(client.normalizedPhone||client.telefone);
  return(local.catalogOrders||[]).filter(order=>order.visitId===visit.id&&(order.clientId===client.id||normalizeBrazilianPhone(order.customerPhone)===phone)).map(order=>({id:order.id,publicOrderNumber:order.publicOrderNumber,orderStatus:order.orderStatus,items:(order.items||[]).map(item=>({name:item.name,quantity:Number(item.quantity),subtotal:Number(item.subtotal)})),total:Number(order.total),visitName:visit.nome,visitLocal:visit.local,createdAt:order.createdAt,updatedAt:order.updatedAt})).slice(-30);
}

async function publishPortalData(visit){
  const local=DB.carregar(),campaigns=new Map((local.campanhas||[]).map(c=>[c.id,c])),progressByClient=new Map();
  for(const item of local.progressosCampanha||[]){const clientId=item.clientId||item.clienteId,campaign=campaigns.get(item.campaignId||item.campanhaId);if(!clientId||!campaign||campaign.publica===false)continue;if(!progressByClient.has(clientId))progressByClient.set(clientId,[]);progressByClient.get(clientId).push({...publicCampaign(campaign),campaignId:campaign.id,currentProgress:Number(item.currentProgress??item.progress??item.progresso??0),points:Number(item.points??item.pontos??0),target:Number(item.target??item.threshold??0),rewardsAvailable:Number(item.rewardsAvailable??item.availableRewards??item.recompensasDisponiveis??0),totalEarned:Number(item.totalEarned??item.redeemedRewards??item.resgates??0)+Number(item.availableRewards??0),totalRedeemed:Number(item.totalRedeemed??item.redeemedRewards??item.resgates??0),updatedAt:item.updatedAt||null})}
  const jobs=[],fingerprintKey=`adiFestaPortalFingerprints:${businessId()}:${visit.publicToken}`,fingerprints=(()=>{try{return JSON.parse(localStorage.getItem(fingerprintKey))||{}}catch{return{}}})();
  for(const client of local.clientes||[]){
    if(client.ativo===false)continue;
    const normalizedPhone=normalizeBrazilianPhone(client.normalizedPhone||client.telefone),clientRefToken=client.portalRefToken;
    if(normalizedPhone.length<12||!clientRefToken)continue;
    const indexId=await phoneIndexId(normalizedPhone),index={found:true,clientRefToken,maskedName:maskedName(client.nome),maskedPhone:maskPhone(normalizedPhone),businessId:businessId(),visitId:visit.id,active:true},profile={clientRefToken,businessId:businessId(),visitId:visit.id,displayName:client.nome,maskedPhone:maskPhone(normalizedPhone),location:client.endereco||'',campaigns:progressByClient.get(client.id)||[],orders:safeOrders(local,visit,client),active:true,accessVersion:1},indexFingerprint=JSON.stringify(index),profileFingerprint=JSON.stringify(profile);
    if(fingerprints[`${client.id}:index`]!==indexFingerprint){jobs.push(setDoc(doc(db,'publicCatalogs',visit.publicToken,'phoneIndex',indexId),{...index,updatedAt:serverTimestamp()},{merge:true}).then(()=>{fingerprints[`${client.id}:index`]=indexFingerprint;recordFirestoreOperation('write',{collection:'publicCatalogs/phoneIndex',documents:1})}))}
    if(fingerprints[`${client.id}:profile`]!==profileFingerprint){jobs.push(setDoc(doc(db,'publicCatalogs',visit.publicToken,'portalProfiles',clientRefToken),{...profile,updatedAt:serverTimestamp()},{merge:true}).then(()=>{fingerprints[`${client.id}:profile`]=profileFingerprint;recordFirestoreOperation('write',{collection:'publicCatalogs/portalProfiles',documents:1})}))}
  }
  await Promise.all(jobs);
  localStorage.setItem(fingerprintKey,JSON.stringify(fingerprints));
}

async function publish(visit,{publishProfiles=true}={}){
  if(!auth.currentUser)return;
  const visitToken=visit?.publicToken;
  if(!validPublicToken(visitToken)){
    console.error('[Public catalog publish]',{code:'invalid-token',visitId:visit?.id||null,visitToken,expectedPath:'publicCatalogs/{visitToken}'});
    Utils.toast?.('Não foi possível publicar: token público inválido.',true);
    return;
  }
  try{
    const payload=publicPayload(visit),open=(DB.carregar().catalogOrders||[]).filter(o=>o.visitId===visit.id&&!['cancelado','entregue'].includes(o.orderStatus));
    payload.items=payload.items.map(item=>({...item,reservedStock:open.reduce((sum,o)=>sum+Number(o.items?.find(x=>x.catalogItemId===item.id)?.quantity||0),0)}));
    const reference=doc(db,'publicCatalogs',visitToken);
    if(reference.id!==visitToken)throw Object.assign(new Error('O ID público não corresponde ao token.'),{code:'token-mismatch'});
    await setDoc(reference,payload);recordFirestoreOperation('write',{collection:'publicCatalogs',documents:1});
    console.info('[Public catalog publish]',{code:'published',documentPath:reference.path,documentId:reference.id,urlToken:visitToken,tokenMatchesDocumentId:reference.id===visitToken,itemCount:payload.items.length,active:payload.active});
    if(publishProfiles)await publishPortalData(visit);
    refreshVisitSubscriptions();
  }catch(error){console.error('[Public catalog publish]',{code:error.code||'unknown',message:error.message,documentPath:`publicCatalogs/${visitToken}`,visitId:visit.id});Utils.toast?.('Visita salva; publicação aguardando a nuvem.',true)}
}

function mergeOrders(visit,docs){
  const incoming=docs.map(s=>({id:s.id,...s.data(),visitId:visit.id,businessId:businessId(),updatedAt:s.data().updatedAt?.toDate?.()?.toISOString?.()||s.data().updatedAt||now(),createdAt:s.data().createdAt?.toDate?.()?.toISOString?.()||s.data().createdAt||now()}));let changed=false,newOrders=0;
  DB.alterar(data=>{for(const order of incoming){const index=data.catalogOrders.findIndex(o=>o.id===order.id);if(index<0){data.catalogOrders.push(order);changed=true;newOrders++}else if(!data.catalogOrders[index].convertedSaleId&&new Date(order.updatedAt)>=new Date(data.catalogOrders[index].updatedAt||0)){data.catalogOrders[index]={...data.catalogOrders[index],...order};changed=true}}});
  if(changed)dispatchEvent(new CustomEvent('catalog-orders-updated',{detail:{visitId:visit.id}}));
  if(newOrders)Utils.toast?.(`${newOrders===1?'Novo pedido recebido':`${newOrders} novos pedidos recebidos`} pelo catálogo.`);
}

function mergeRedemptionRequests(visit,docs){
  const incoming=docs.map(s=>({id:s.id,...s.data(),visitId:visit.id,type:'campaign_redemption_request',tipo:'solicitacao_resgate',createdAt:s.data().createdAt?.toDate?.()?.toISOString?.()||s.data().createdAt||now()}));
  DB.alterar(data=>{for(const request of incoming){const client=data.clientes.find(item=>item.portalRefToken===request.clientRefToken);if(client)request.clientId=request.clienteId=client.id;const index=data.recompensas.findIndex(item=>item.id===request.id);if(index<0)data.recompensas.push(request);else data.recompensas[index]={...data.recompensas[index],...request}}});
}

function subscribeVisit(visit){
  if(!visit?.publicToken||subscriptions.has(visit.publicToken))return;
  let firstOrders=true,firstRewards=true;
  listenerOpened('publicCatalogOrders');
  const orderUnsub=onSnapshot(collection(db,'publicCatalogs',visit.publicToken,'orders'),snap=>{recordFirestoreOperation('listen',{collection:'publicCatalogOrders',documents:firstOrders?snap.size:snap.docChanges().length,source:firstOrders?'initial':'realtime'});firstOrders=false;mergeOrders(visit,snap.docs)},error=>{recordFirestoreOperation('listen',{collection:'publicCatalogOrders',error});console.error('[Catalog orders listener]',error)});
  listenerOpened('publicCatalogRedemptions');
  const rewardUnsub=onSnapshot(collection(db,'publicCatalogs',visit.publicToken,'redemptionRequests'),snap=>{recordFirestoreOperation('listen',{collection:'publicCatalogRedemptions',documents:firstRewards?snap.size:snap.docChanges().length,source:firstRewards?'initial':'realtime'});firstRewards=false;mergeRedemptionRequests(visit,snap.docs)},error=>{recordFirestoreOperation('listen',{collection:'publicCatalogRedemptions',error});console.error('[Catalog rewards listener]',error)});
  subscriptions.set(visit.publicToken,()=>{orderUnsub();rewardUnsub();listenerClosed('publicCatalogOrders');listenerClosed('publicCatalogRedemptions')});
}

function stopAllSubscriptions(){for(const stop of subscriptions.values())stop();subscriptions.clear()}
function refreshVisitSubscriptions(){
  if(!auth.currentUser)return;
  const desired=(DB.carregar().visitas||[]).filter(visit=>visit.publicToken&&ACTIVE_VISIT_STATUSES.has(visit.status)).sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,3),tokens=new Set(desired.map(visit=>visit.publicToken));
  for(const[token,stop]of subscriptions)if(!tokens.has(token)){stop();subscriptions.delete(token)}
  desired.forEach(subscribeVisit);
}
function bindAll(){if(!auth.currentUser)return;refreshVisitSubscriptions()}
addEventListener('catalog-publish-request',event=>publish(event.detail.visit).finally(refreshVisitSubscriptions));
addEventListener('catalog-orders-updated',event=>{const visit=DB.carregar().visitas.find(v=>v.id===event.detail.visitId);if(visit)publish(visit,{publishProfiles:false})});
addEventListener('catalog-order-status-request',event=>{const order=event.detail.order,visit=DB.carregar().visitas.find(v=>v.id===order.visitId);if(!visit?.publicToken)return;setDoc(doc(db,'publicCatalogs',visit.publicToken,'orders',order.id),{orderStatus:order.orderStatus,confirmedAt:order.confirmedAt||null,preparingAt:order.preparingAt||null,dispatchedAt:order.dispatchedAt||null,deliveredAt:order.deliveredAt||null,cancelledAt:order.cancelledAt||null,convertedSaleId:order.convertedSaleId||null,clientId:order.clientId||null,clientNameSnapshot:order.clientNameSnapshot||null,linkedAt:order.linkedAt||null,keptAsGuest:Boolean(order.keptAsGuest),updatedAt:serverTimestamp()},{merge:true}).then(()=>recordFirestoreOperation('write',{collection:'publicCatalogOrders',documents:1})).catch(error=>console.error('[Catalog order status]',error))});
addEventListener('catalog-redemption-status-request',event=>{const detail=event.detail,visit=DB.carregar().visitas.find(item=>item.id===detail.visitId);if(!visit?.publicToken)return;setDoc(doc(db,'publicCatalogs',visit.publicToken,'redemptionRequests',detail.requestId),{status:detail.status,rewardId:detail.rewardId||null,processedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true}).then(()=>recordFirestoreOperation('write',{collection:'publicCatalogRedemptions',documents:1})).catch(error=>console.error('[Catalog reward status]',error))});
addEventListener('firebase-auth-ready',bindAll);
addEventListener('firebase-sync-status',event=>{if(event.detail?.authReady&&event.detail?.details?.authenticated===false)stopAllSubscriptions()});
addEventListener('cloud-data-updated',()=>setTimeout(bindAll,250));

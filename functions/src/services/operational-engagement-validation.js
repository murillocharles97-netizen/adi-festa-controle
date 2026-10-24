'use strict';
const domain=require('../shared/engagement-domain');
const {HttpsError}=require('firebase-functions/v2/https');
const fail=m=>{throw new HttpsError('failed-precondition',m);};
const canonical=x=>JSON.stringify((function sort(v){
 if(v?.toDate)return v.toDate().toISOString();
 if(v&&typeof v==='object'&&!Array.isArray(v)&&Number.isFinite(v._seconds??v.seconds)&&Number.isFinite(v._nanoseconds??v.nanoseconds))return new Date((v._seconds??v.seconds)*1000+(v._nanoseconds??v.nanoseconds)/1000000).toISOString();
 return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
})(x));
const coreEvents=['id','campaignId','clientId','sourceType','sourceId','transition','status','delta','benefit','expiresAt','reversedEventId','reversesConfirmationId','confirmsEventId','expiresEventId'];
const projections=['id','campaignId','clientId','pendingProgress','confirmedProgress','pendingPoints','availablePoints','availableRewards','redeemedRewards','cycleRemainder','benefitDebt'];
const values=(v,fields)=>Object.fromEntries(fields.map(k=>[k,v?.[k]??null]));
const subscriptionFields=['id','clientId','productId','variantId','spaceId','status','startedAt','expiresAt','durationValue','durationUnit','contractedPrice','renewalCount','lastRenewedAt','createdFromSaleId','lastSaleId','reminders','renewalMessage','label'];
async function validateEngagement({db,tx,c,item,writes,plan,old,effective}){
 const relevant=writes.filter(w=>['campaigns','campaignProgress','campaignEvents','campaignRedemptions','customerSubscriptions','customerSubscriptionEvents'].includes(w.entityType));
 if(!relevant.length)return{redemption:null};
 const ref=(col,id)=>db.doc(`businesses/${c.bid}/${col}/${id}`);
 const collection=col=>ref(col,'__none__').parent;
 const planned=(col,id)=>plan.get(ref(col,id).path)?.data;
 const load=async(col,field,id)=>{const q=field?collection(col).where(field,'==',id):collection(col);const s=await tx.get(q.limit(301));if(s.size>300)fail('Histórico de campanha/renovação excede o limite seguro; use revisão individual.');return s.docs.map(d=>({id:d.id,...d.data()}));};
 const saleWrite=writes.find(w=>w.entityType==='sales'&&(w.operation==='create'||w.data.active===false||w.data.deletedAt)),sale=saleWrite?await effective('sales',saleWrite.entityId):null;
 const paymentWrite=writes.find(w=>w.entityType==='payments'&&w.operation==='create');
 const clients=new Set(relevant.map(w=>w.data.clientId||w.before?.clientId).filter(Boolean));if(sale?.clienteId)clients.add(sale.clienteId);
 const data={campanhas:[],clientes:[],produtos:[],variacoesProdutos:[],eventosCampanha:[],progressosCampanha:[],resgatesCampanha:[],vendas:[],alocacoesPagamento:[],segmentosClientes:[],customerSubscriptions:[],customerSubscriptionEvents:[],movimentacoesEstoque:[]};
 const campaignIds=new Set(relevant.map(w=>w.data.campaignId||w.before?.campaignId).filter(Boolean));
 for(const id of campaignIds){const value=await old('campaigns',id);if(!value)fail('Campanha original não confirmada.');if(value.spaceId)await c.space(value.spaceId);data.campanhas.push({id,...value});}
 for(const w of relevant.filter(w=>w.entityType==='campaigns')){
  if(!c.has('reports.view'))throw new HttpsError('permission-denied','Gerenciar campanha exige a autorização existente de relatórios.');
  const before=await old('campaigns',w.entityId),value=await effective('campaigns',w.entityId);
  if(before&&w.before&&canonical(values(before,['status','active','updatedAt']))!==canonical(values(w.before,['status','active','updatedAt'])))fail('A campanha mudou em outra sessão. Atualize antes de salvar.');
  if(value.spaceId)await c.space(value.spaceId);
  const normalized=domain(data,{businessId:c.bid,uid:c.uid}).campaigns.normalizeCampaign(value);
  if(!['internal','trial','professional','premium'].includes(c.business.subscription?.planId)&&!(normalized.type==='quantity_discount'&&normalized.eligibility.audienceType==='all'))throw new HttpsError('permission-denied','Campanha não incluída neste plano.');
  if(!['buy_get','points','quantity_discount','nth_product','combo'].includes(normalized.type)||!['active','paused','ended','scheduled'].includes(normalized.status))fail('Configuração de campanha inválida.');
  const ids=new Set([...(normalized.qualification.productIds||[]),...normalized.rule.requiredItems.map(i=>i.productId),...normalized.rewards.map(r=>r.productId)].filter(Boolean));
  for(const id of ids){const p=await old('products',id);if(!p||p.businessId!==c.bid||value.spaceId&&!require('../shared/online-store').allows(p,value.spaceId)||!c.owner&&c.member?.spaceAccess!=='all'&&p.spaceAccessMode!=='all_spaces'&&!(p.allowedSpaceIds||[]).some(s=>c.member?.allowedSpaceIds?.includes(s)))fail('Produto da campanha fora do escopo autorizado.');}
  for(const reward of normalized.rewards)if(reward.variantId){const v=await old('productVariants',reward.variantId);if(!v||v.parentProductId!==reward.productId)fail('Variação da recompensa não pertence ao produto.');}
 }
 // Each projection/event must be justified by a domain transition, never by
 // trusting a client-supplied financial event or arbitrary progress counter.
 for(const id of clients){const value=await old('clients',id);if(!value)fail('Cliente da campanha/renovação ausente.');data.clientes.push({id,...value});for(const [col,key]of [['campaignEvents','eventosCampanha'],['campaignProgress','progressosCampanha'],['campaignRedemptions','resgatesCampanha']])data[key].push(...await load(col,'clientId',id));}
 for(const w of relevant.filter(w=>w.entityType==='customerSubscriptions')){const value=await old('customerSubscriptions',w.entityId);if(value){await c.space(value.spaceId);if(sale&&value.spaceId!==sale.spaceId)fail('A renovação deve permanecer no espaço da vigência original.');data.customerSubscriptions.push({id:w.entityId,...value});if(w.before&&canonical(values(value,subscriptionFields))!==canonical(values(w.before,subscriptionFields)))fail('A vigência mudou em outra sessão. Refaça a renovação.');}}
 const productIds=new Set([...(sale?.itens||[]).map(i=>i.produtoId),...data.campanhas.flatMap(v=>(v.rewards||[]).map(r=>r.productId))].filter(Boolean));
 for(const id of productIds){const p=await old('products',id);if(p)data.produtos.push({id,...p});}
 const variantIds=new Set([...(sale?.itens||[]).map(i=>i.variantId),...data.campanhas.flatMap(v=>(v.rewards||[]).map(r=>r.variantId))].filter(Boolean));for(const id of variantIds){const v=await old('productVariants',id);if(v)data.variacoesProdutos.push({id,...v});}
 const subscriptionEvent=writes.find(w=>w.entityType==='customerSubscriptionEvents'),at=subscriptionEvent?.data.createdAt||sale?.data||sale?.createdAt||item.createdAtLocal||new Date().toISOString();
 const engine=domain(data,{businessId:c.bid,uid:c.uid,uuid:()=>subscriptionEvent?.data.sourceId||item.operationId,at});
 let redemption=null;
 if(sale){if(saleWrite.operation==='create'){engine.campaigns.applySale(data,structuredClone(sale));engine.subscriptions.applySaleInData(data,structuredClone(sale));}else{const original=await old('sales',saleWrite.entityId);engine.campaigns.reverseSale(data,original);engine.subscriptions.reverseSaleInData(data,original);}}
 if(paymentWrite){const payment=await effective('payments',paymentWrite.entityId);data.alocacoesPagamento=writes.filter(w=>w.entityType==='paymentAllocations').map(w=>w.data);for(const a of data.alocacoesPagamento){const s=await effective('sales',a.saleId);if(s)data.vendas.push({id:a.saleId,...s});}engine.campaigns.confirmSettledSales(data,payment,data.alocacoesPagamento);}
 const redeemWrite=writes.find(w=>w.entityType==='campaignRedemptions');
 if(redeemWrite){if(!c.has('sales.create'))throw new HttpsError('permission-denied','Resgate exige autorização operacional de venda.');redemption=engine.campaigns.redeem(data,redeemWrite.data.campaignId,redeemWrite.data.clientId,redeemWrite.data.rewardId,{operationId:redeemWrite.data.operationId,businessId:c.bid,at});}
 if(!sale&&!paymentWrite&&!redeemWrite&&relevant.some(w=>w.entityType==='campaignEvents'))engine.campaigns.expirePoints(data,at);
 if(!sale&&subscriptionEvent){
  const e=subscriptionEvent.data;if(e.sourceType!=='manual')fail('Evento de renovação exige a venda correspondente.');
  const w=writes.find(w=>w.entityType==='customerSubscriptions'&&w.entityId===e.subscriptionId);if(!w||!c.has('sales.create'))fail('Alteração de vigência sem autorização/evento correspondente.');const target=await effective('customerSubscriptions',w.entityId);await c.space(target.spaceId);engine.subscriptions.changeStatus(w.entityId,target.status,e.note||'');
 }
 for(const w of relevant){
  const patch=planned(w.entityType,w.entityId);if(!patch||w.entityType==='campaigns')continue;
  if(w.entityType==='campaignEvents'){const expected=data.eventosCampanha.find(e=>e.id===w.entityId);if(!expected||canonical(values(patch,coreEvents))!==canonical(values(expected,coreEvents)))fail('Evento de campanha não corresponde à operação canônica.');}
  if(w.entityType==='campaignProgress'){const expected=data.progressosCampanha.find(e=>e.id===w.entityId);const current=await effective('campaignProgress',w.entityId);if(!expected||canonical(values(current,projections))!==canonical(values(expected,projections)))fail('Projeção de campanha divergente; atualize antes de reenviar.');}
  if(w.entityType==='campaignRedemptions'){if(!redemption||canonical(values(patch,['id','operationId','campaignId','clientId','rewardId','rewardSnapshot','stockMovementId','status']))!==canonical(values(redemption,['id','operationId','campaignId','clientId','rewardId','rewardSnapshot','stockMovementId','status'])))fail('Resgate divergente da recompensa canônica.');}
  if(w.entityType==='customerSubscriptions'){const expected=data.customerSubscriptions.find(s=>s.id===w.entityId),current=await effective('customerSubscriptions',w.entityId);if(expected){if(canonical(values(current,subscriptionFields))!==canonical(values(expected,subscriptionFields)))fail('Vigência divergente da venda/decisão autorizada.');}else if(!sale||saleWrite.operation==='create'||current.active!==false||!current.deletedAt)fail('Encerramento de vigência sem reversão canônica.');}
  if(w.entityType==='customerSubscriptionEvents'){const expected=data.customerSubscriptionEvents.find(s=>s.id===w.entityId);if(!expected||canonical(values(patch,['id','subscriptionId','clientId','productId','variantId','spaceId','transition','sourceType','sourceId','note']))!==canonical(values(expected,['id','subscriptionId','clientId','productId','variantId','spaceId','transition','sourceType','sourceId','note']))||['previous','next'].some(k=>canonical(values(patch[k],subscriptionFields))!==canonical(values(expected[k],subscriptionFields))))fail('Evento de renovação não corresponde à transição autorizada.');}
 }
 // Reject a standalone forged subscription/progress even when no event is sent.
 if(relevant.some(w=>w.entityType==='customerSubscriptions')&&!sale&&!subscriptionEvent)fail('Vigência exige evento de criação/alteração autorizado.');
 if(relevant.some(w=>w.entityType==='campaignProgress')&&!sale&&!paymentWrite&&!redeemWrite&&!relevant.some(w=>w.entityType==='campaignEvents'))fail('Progresso exige evento comercial correspondente.');
 return{redemption};
}
module.exports={validateEngagement};

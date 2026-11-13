'use strict';
const {HttpsError}=require('firebase-functions/v2/https'),{Timestamp,FieldPath}=require('firebase-admin/firestore'),{createHash}=require('node:crypto');
const P=require('../shared/permission-policy'),Privacy=require('../shared/operational-privacy-policy'),{assertOperationalSaleAccess,accessHash}=require('./operational-sale-access');
const valid=v=>typeof v==='string'&&/^[-a-zA-Z0-9_]{1,128}$/.test(v),gen=x=>x?.workspaceGeneration??0;
const permission={clients:'customers.view',sales:'sales.create',payments:'customers.receiveDebt',stockMovements:'inventory.view',catalogOrders:'sales.viewAll',campaigns:'sales.create',activityEvents:'sales.create',settings:null};
const dailyCollections=new Set(['sales','payments','activityEvents','stockMovements']),closedOrders=new Set(['entregue','cancelado','expirado','delivered','cancelled','expired']);
const checksum=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validOperation=v=>{try{require('../shared/operational-id').operationalId(v);return true;}catch{return false;}};
function operationalReadService(db,{clock=()=>new Date()}={}){
 async function context(tx,request){
  const uid=request.auth?.uid,bid=request.data?.businessId;if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta.');if(!valid(bid))throw new HttpsError('invalid-argument','Empresa inválida.');
  const root=db.doc('businesses/'+bid),[b,u,m,s]=await Promise.all([tx.get(root),tx.get(db.doc('users/'+uid)),tx.get(root.collection('members').doc(uid)),tx.get(root.collection('settings').doc('default'))]),business=b.data(),user=u.data(),member=m.data()||(!m.exists&&business?.ownerId===uid&&['owner','admin'].includes(user?.role)&&business.legacyAccessDisabled!==true?{role:'owner',status:'active',spaceAccess:'all',permissions:{}}:null);
  if(!business?.active||user?.active!==true||user.businessId!==bid||member?.status!=='active')throw new HttpsError('permission-denied','Vínculo empresarial ativo obrigatório.');
  if(gen(business)!==(request.data?.workspaceGeneration??0)||business.workspaceReset&&business.workspaceReset.status!=='COMPLETED')throw new HttpsError('failed-precondition','O ambiente mudou. Reabra a consulta; seus dados foram preservados.');
  const owner=member.role==='owner'&&business.ownerId===uid;if(member.role==='owner'&&!owner)throw new HttpsError('permission-denied','Vínculo de proprietário não confirmado.');
  const settings=s.data()||{},window=P.dayWindow(clock(),business.timezone||settings.timezone||'America/Sao_Paulo'),has=k=>owner||P.has(member,k);
  let ids=[];if(owner||member.spaceAccess==='all'){const a=await tx.get(db.collection('financialSpaces').where('businessId','==',bid)),b=await tx.get(db.collection('financialSpaces').where('linkedBusinessId','==',bid));ids=[...new Set([...a.docs,...b.docs].map(d=>d.id))];}else ids=[...(member.allowedSpaceIds||[])];
  if(ids.length>50)throw new HttpsError('resource-exhausted','Selecione um espaço para consultar.');
  const spaces=[];for(const id of ids){if(!valid(id))continue;const snap=await tx.get(db.doc('financialSpaces/'+id)),d=snap.data(),bindings=[d?.businessId,d?.linkedBusinessId].filter(Boolean);if(d&&d.active!==false&&(!d.status||d.status==='active')&&bindings.length&&bindings.every(x=>x===bid))spaces.push({id,...d});}
  const selected=request.data?.spaceId;if(selected&&!['all','all_spaces'].includes(selected)&&!spaces.some(s=>s.id===selected))throw new HttpsError('permission-denied','Espaço não autorizado.');
  const selectedIds=selected&&!['all','all_spaces'].includes(selected)?[selected]:spaces.map(s=>s.id);
  const spaceSnapshots=await Promise.all(spaces.map(v=>tx.get(db.doc('financialSpaces/'+v.id))));
  return{uid,bid,root,business,user,member,owner,settings,window,spaces,ids:selectedIds,has,scope:checksum([bid,uid,gen(business),accessHash(member),window.day,selectedIds]),fresh:[b,u,m,s,...spaceSnapshots]};
 }
 const scoped=(v,c)=>v&&(!v.businessId||v.businessId===c.bid)&&gen(v)===gen(c.business)&&(!(v.spaceId||v.financialSpaceId)||c.ids.includes(v.spaceId||v.financialSpaceId))&&(!v.spaceId||!v.financialSpaceId||v.spaceId===v.financialSpaceId);
 async function customerLinkProofs(tx,c,docs){
  const refs=docs.filter(doc=>Array.isArray(doc.data()?.customerSpaceIds)&&doc.data().customerSpaceIds.length)
   .map(doc=>c.root.collection('customerDirectoryLinks').doc(doc.id));
  const proofs=refs.length?await tx.getAll(...refs):[];
  return new Map(proofs.flatMap(doc=>{
   const v=doc.data();
   return v?.clientId===doc.id&&v.businessId===c.bid&&gen(v)===gen(c.business)&&Array.isArray(v.spaceIds)
    ?[[doc.id,v.spaceIds.filter(id=>c.spaces.some(space=>space.id===id))]]:[];
  }));
 }
 const customerScoped=(v,c,links)=>scoped(v,c)||v&&(!v.businessId||v.businessId===c.bid)&&gen(v)===gen(c.business)&&
  v.active!==false&&v.ativo!==false&&!v.deletedAt&&links?.some(id=>c.ids.includes(id));
 const project=(col,v,c,links)=>{
  if(col!=='clients')return Privacy.sanitize(col,v);
  const directoryOnly=!scoped(v,c);
  const output=directoryOnly?Privacy.pick(v,['id','businessId','workspaceGeneration','nome','telefone','active','ativo']):Privacy.sanitize(col,v);
  if(links?.length)output.customerSpaceIds=links;
  output.customerDirectoryOnly=directoryOnly;
  return output;
 };
 const current=(v,c,field='data')=>P.dayKey(v[field]||v.createdAt,c.window.zone)===c.window.day;
 const currentOrder=(v,c)=>P.dayKey(v.deliveredAt||v.updatedAt||v.data||v.createdAt,c.window.zone)===c.window.day;
 function allowed(c,col){if(!Object.hasOwn(permission,col))throw new HttpsError('permission-denied','Este conjunto não possui leitor operacional.');const key=permission[col];if(key&&!c.has(key)&&!(col==='sales'&&c.has('sales.viewAll'))&&!(col==='activityEvents'&&c.has('customers.receiveDebt')))throw new HttpsError('permission-denied',P.MESSAGE);}
 const envelope=(c,body)=>({businessId:c.bid,uid:c.uid,workspaceGeneration:gen(c.business),readPolicyVersion:1,serverNow:clock().toISOString(),window:c.window,scopeHash:c.scope,source:'server',...body});
 async function run(request,fn){let saved;const value=await db.runTransaction(async tx=>{const c=await context(tx,request);saved=c;return fn(tx,c);});
  const latest=await db.getAll(...saved.fresh.map(s=>s.ref));if(latest.some((s,i)=>JSON.stringify(s.data())!==JSON.stringify(saved.fresh[i].data()))||P.dayKey(clock(),saved.window.zone)!==saved.window.day)throw new HttpsError('aborted','A sessão, as permissões ou o dia mudaram. Consulte novamente.');return value;
 }
 async function read(request){return run(request,async(tx,c)=>{
  const d=request.data||{},col=d.collection,mode=d.mode||'page';
  if(Privacy.restricted(c.member)){
   const capability=col==='stockMovements'?'inventory':['sales','payments','activityEvents','catalogOrders'].includes(col)||['customer_context','sale_presence','last_payment','cases','own_confirmation'].includes(mode)?'sales':null;
   if(capability){c.ids=c.ids.filter(id=>c.spaces.some(s=>s.id===id&&s.capabilities?.[capability]===true));c.scope=checksum([c.scope,capability,c.ids]);}
  }
  if(['from','to','date','timezone','orders','filters'].some(k=>Object.hasOwn(d,k)))throw new HttpsError('invalid-argument','O período e os filtros deste leitor são definidos pelo servidor.');
  if(mode==='sale_capacity'){
   if(!c.has('sales.create'))throw new HttpsError('permission-denied',P.MESSAGE);
   const access=require('./subscription-service').computeAccess(c.business.subscription||{}),rawLimit=c.business.limits?.monthlySales??access.limits?.monthlySales;
   if(rawLimit===null||rawLimit===undefined||access.unlimited)return envelope(c,{canCreate:access.canMutate===true,limited:false});
   const limit=Number(rawLimit);if(!Number.isSafeInteger(limit)||limit<0)throw new HttpsError('failed-precondition','Limite de vendas precisa ser conferido pelo proprietário.');
   // Preserve the existing UTC calendar-month plan semantics. Only an opaque
   // operational decision is returned, never the store's historical count.
   const now=clock(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));let count=0;
   for(const timestamp of [false,true]){const lo=timestamp?Timestamp.fromDate(from):from.toISOString(),hi=timestamp?Timestamp.fromDate(to):to.toISOString(),result=await c.root.collection('sales').where('data','>=',lo).where('data','<',hi).count().get();count+=result.data().count;}
   return envelope(c,{canCreate:access.canMutate===true&&count<limit,limited:true});
  }
  if(mode==='customer_context')return customerContext(tx,c,d);
  if(mode==='sale_presence'){
   if(!valid(d.id)||!c.has('sales.create')&&!c.has('sales.cancel')&&!c.has('customers.receiveDebt'))throw new HttpsError('permission-denied','Identificador e acesso operacional obrigatórios.');
   const s=(await tx.get(c.root.collection('sales').doc(d.id))).data();if(!s)return envelope(c,{record:null});if(!scoped(s,c)||!s.spaceId)throw new HttpsError('permission-denied','Venda fora do espaço autorizado.');
   return envelope(c,{record:Privacy.pick({...s,id:d.id},['id','businessId','spaceId','workspaceGeneration','operationId','status','active','ativo','deletedAt','cancelledAt','cancelOperationId','financialAppliedAt','financialReversalEventId'])});
  }
  if(mode==='last_payment'){
   if(!valid(d.customerId)||!c.has('customers.receiveDebt')||!c.has('customers.view'))throw new HttpsError('permission-denied','Cliente e permissão de recebimento obrigatórios.');const client=(await tx.get(c.root.collection('clients').doc(d.customerId))).data();if(!scoped(client,c))throw new HttpsError('permission-denied','Cliente fora do espaço autorizado.');
   const rows=await tx.get(c.root.collection('payments').where('clienteId','==',d.customerId).limit(301));if(rows.size>300)throw new HttpsError('resource-exhausted','Consulte o recebimento pelo identificador original com o gestor.');
   const payment=rows.docs.map(s=>({id:s.id,...s.data()})).filter(p=>scoped(p,c)&&current(p,c)&&p.spaceId&&p.status==='applied'&&p.applicationStatus==='applied').sort((a,b)=>new Date(b.data||b.createdAt)-new Date(a.data||a.createdAt))[0];
   return envelope(c,{record:payment?Privacy.sanitize('payments',payment):null});
  }
  if(mode==='cases'){const rows=await tx.get(c.root.collection('operationalReadGrants').where('targetUid','==',c.uid).limit(100));return envelope(c,{items:rows.docs.map(s=>({id:s.id,...s.data()})).filter(g=>g.status==='active'&&g.expiresAt.toMillis()>clock().getTime()&&g.targetAccessHash===accessHash(c.member)&&c.ids.includes(g.spaceId)).map(g=>({...Privacy.pick(g,['id','saleId','spaceId','purpose']),expiresAt:g.expiresAt.toDate().toISOString()})),complete:true});}
  if(mode==='own_confirmation'){
   if(!c.has('sales.create')||!valid(d.id)||!validOperation(d.operationId))throw new HttpsError('permission-denied','Comprovante original obrigatório.');
   const sale=(await tx.get(c.root.collection('sales').doc(d.id))).data(),marker=(await tx.get(c.root.collection('processedOperations').doc(d.operationId))).data();if(!sale&&!marker)return envelope(c,{record:null});
   if(!scoped(sale,c)||!sale.spaceId||sale.actorUid!==c.uid||sale.operationId!==d.operationId||marker?.status!=='processed'||(marker.actorUid||marker.ownerId)!==c.uid||marker.businessId!==c.bid||gen(marker)!==gen(c.business))throw new HttpsError('permission-denied','O comprovante não pertence à operação e à identidade autenticadas.');
   const record={...sale,id:d.id};
   // A queue acknowledgement must still work after midnight or a change of
   // grants. It is not authorization to read the original monetary record.
   const acknowledgement=['id','businessId','workspaceGeneration','spaceId','operationId','financialAppliedAt','financialOperationId','paymentIntentId','onlineOrderId'];
   return envelope(c,{record:Privacy.restricted(c.member)&&!P.visiblePerformanceRecord(c.member,sale,clock(),c.window.zone)
    ?Privacy.pick(record,acknowledgement):Privacy.sanitize('sales',record),confirmed:true});
  }
  if(col==='processedOperations'&&mode==='get'){if(!validOperation(d.id))throw new HttpsError('invalid-argument','Operação inválida.');const m=(await tx.get(c.root.collection(col).doc(d.id))).data();if(!m)return envelope(c,{record:null});if(m.businessId!==c.bid||gen(m)!==gen(c.business)||(m.actorUid||m.ownerId)!==c.uid)throw new HttpsError('permission-denied','Recibo de outra identidade.');return envelope(c,{record:Privacy.pick({id:d.id,...m},['id','businessId','workspaceGeneration','status','eventKind','processedAt','authorizationVersion','requestHash','checksum','saleId'])});}
  allowed(c,col);if(['sales','payments','activityEvents'].includes(col)&&!c.has('performance.daily')&&!(col==='sales'&&mode==='get'&&d.grantId))throw new HttpsError('permission-denied','A consulta do dia não está autorizada.');
  if(mode==='get'){
   if(!valid(d.id))throw new HttpsError('invalid-argument','Registro inválido.');const doc=await tx.get(c.root.collection(col).doc(d.id)),v=doc.data();if(!v)return envelope(c,{record:null});const links=col==='clients'?(await customerLinkProofs(tx,c,[doc])).get(doc.id):undefined;if(!(col==='clients'?customerScoped(v,c,links):scoped(v,c)))throw new HttpsError('permission-denied','Registro fora do espaço autorizado.');
   if(Privacy.restricted(c.member)&&(dailyCollections.has(col)||col==='catalogOrders')&&!v.spaceId)throw new HttpsError('permission-denied','Registro sem vínculo canônico de espaço exige atendimento do proprietário.');
   if(col==='settings'&&d.id==='operation')return envelope(c,{record:Privacy.pick({id:d.id,...v},['id','businessId','workspaceGeneration','operationMode','creditMode','operationOnboardingCompleted','modules','schemaVersion','migrationVersion'])});
   if(col==='sales')await assertOperationalSaleAccess(tx,db,c,{id:d.id,...v},{purpose:d.purpose||'consult',grantId:d.grantId,clock});
   else if(dailyCollections.has(col)&&!current(v,c,col==='activityEvents'?'createdAt':'data'))throw new HttpsError('permission-denied','Este leitor permite somente o dia atual.');
   if(col==='catalogOrders'&&closedOrders.has(v.orderStatus)&&!currentOrder(v,c))throw new HttpsError('permission-denied','Pedido concluído de outro dia exige acesso histórico.');
   return envelope(c,{record:project(col,{...v,id:d.id},c,links)});
  }
  if(mode!=='page')throw new HttpsError('invalid-argument','Consulta operacional inválida.');
  if(col==='settings')return envelope(c,{items:[Privacy.sanitize(col,{id:'default',...c.settings})],complete:true,next:null});
  const max=Math.min(200,Math.max(1,Number(d.limit)||100)),cursor=d.cursor,temporal=dailyCollections.has(col),kind=cursor?.kind||'string',group=Number(cursor?.group||0),groups=temporal?Array.from({length:Math.max(1,Math.ceil(c.ids.length/30))},(_,i)=>c.ids.slice(i*30,(i+1)*30)):[null];
  if(cursor&&(cursor.scope!==c.scope||cursor.collection!==col)||!['string','timestamp'].includes(kind)||!Number.isInteger(group)||group<0||group>=groups.length)throw new HttpsError('aborted','A página não corresponde ao acesso atual.');
  let q=c.root.collection(col),field=col==='activityEvents'?'createdAt':'data';
  if(temporal){const cast=v=>kind==='string'?v:Timestamp.fromDate(new Date(v));if(!groups[group].length)return envelope(c,{items:[],complete:true,next:null});q=q.where('spaceId','in',groups[group]).where(field,'>=',cast(c.window.from)).where(field,'<',cast(c.window.to)).orderBy(field).orderBy(FieldPath.documentId());}
  else q=q.orderBy(FieldPath.documentId());
  if(cursor?.id){if(!valid(cursor.id))throw new HttpsError('invalid-argument','Página inválida.');if(temporal){const at=new Date(cursor.at);if(!Number.isFinite(at.getTime())||at<new Date(c.window.from)||at>=new Date(c.window.to))throw new HttpsError('invalid-argument','Data da página inválida.');q=q.startAfter(kind==='string'?cursor.at:Timestamp.fromDate(at),cursor.id);}else q=q.startAfter(cursor.id);}
  const rows=await tx.get(q.limit(max)),items=[],proofs=col==='clients'?await customerLinkProofs(tx,c,rows.docs):null;
  for(const doc of rows.docs){const v={id:doc.id,...doc.data()};const links=proofs?.get(doc.id);if(!(col==='clients'?customerScoped(v,c,links):scoped(v,c)))continue;if(temporal&&!current(v,c,field))continue;if(col==='catalogOrders'&&closedOrders.has(v.orderStatus)&&!currentOrder(v,c))continue;if(col==='campaigns'&&(v.active===false||v.ativo===false||v.status&&!['active','ativa','scheduled','agendada'].includes(v.status)))continue;if(col==='activityEvents'&&v.type!=='sale'&&v.actorUid!==c.uid)continue;const clean=project(col,col==='clients'?{...v,id:doc.id}:v,c,links);if(clean)items.push(clean);}
  const last=rows.docs.at(-1);let next=rows.size===max?{scope:c.scope,collection:col,kind,group,id:last.id,...(temporal?{at:(last.data()[field]?.toDate?.()||new Date(last.data()[field])).toISOString()}:{} )}:temporal&&kind==='string'?{scope:c.scope,collection:col,kind:'timestamp',group}:temporal&&group+1<groups.length?{scope:c.scope,collection:col,kind:'string',group:group+1}:null;
  return envelope(c,{items,next,complete:!next});
 });}
 async function customerContext(tx,c,d){
  if(!c.has('customers.view')||!valid(d.customerId)||!['checkout','payment'].includes(d.purpose))throw new HttpsError('permission-denied','Cliente e finalidade autorizados obrigatórios.');
  if(!c.has(d.purpose==='payment'?'customers.receiveDebt':'sales.create'))throw new HttpsError('permission-denied',P.MESSAGE);
  const doc=await tx.get(c.root.collection('clients').doc(d.customerId)),client=doc.data();
  const origin=scoped(client,c);
  const links=d.purpose==='checkout'?(await customerLinkProofs(tx,c,[doc])).get(doc.id):undefined;
  const linkedCheckout=!origin&&d.purpose==='checkout'&&links?.includes(d.spaceId)&&
   c.ids.includes(d.spaceId)&&c.spaces.some(space=>space.id===d.spaceId&&space.capabilities?.sales===true)&&customerScoped(client,c,links);
  if(!origin&&!linkedCheckout)throw new HttpsError('permission-denied','Cliente indisponível no espaço autorizado.');
  const selectedClient={...client,id:doc.id};
  const result={client:d.purpose==='checkout'?project('clients',selectedClient,c,links):Privacy.sanitize('clients',selectedClient),sales:[],campaignProgress:[],campaignEvents:[],customerSubscriptions:[]};
  const benefitsQuery=col=>{
   const q=c.root.collection(col).where('clientId','==',doc.id);
   return (linkedCheckout?q.where('spaceId','==',d.spaceId):q).limit(301);
  };
  if(d.purpose==='payment'){
   const sales=await tx.get(c.root.collection('sales').where('clienteId','==',d.customerId).limit(351));if(sales.size>350)throw new HttpsError('resource-exhausted','Histórico de Fiado exige atendimento individual do gestor.');
   const open=sales.docs.map(s=>({id:s.id,...s.data()})).filter(s=>(s.formaPagamento==='fiado'||s.status==='fiado')&&s.active!==false&&s.ativo!==false&&!s.deletedAt&&!s.desfeita&&Number(s.creditRemainingAmount??s.valorFinal)>0);
   if(open.some(s=>!scoped(s,c)||!s.spaceId))throw new HttpsError('failed-precondition','Há obrigações em espaço não autorizado ou sem vínculo canônico. Solicite ao gestor o atendimento deste recebimento.',{reason:'customer-debt-scope-review'});
   result.sales=open.map(v=>({...Privacy.pick(v,[...Privacy.scopeFields,'clienteId','formaPagamento','creditOriginalAmount','creditPaidAmount','creditRemainingAmount','creditSettled','creditSettledAt']),creditOriginalAmount:v.creditOriginalAmount??v.valorFinal,creditRemainingAmount:v.creditRemainingAmount??v.valorFinal,operationalProjection:'open_debt'}));
   if(result.client.legacyBalanceRemaining===undefined){const tracked=open.reduce((n,s)=>n+Number(s.creditRemainingAmount??s.valorFinal),0);result.client.legacyBalanceRemaining=Math.max(0,-Number(client.saldo||0)-tracked);result.client.legacyBalance=client.legacyBalance??result.client.legacyBalanceRemaining;}
  }
  // Only the selected customer's CURRENT benefit state is required at checkout;
  // historical revenue, redemption lists and purchase summaries are not returned.
  for(const [col,key]of [['campaignProgress','campaignProgress'],['customerSubscriptions','customerSubscriptions']]){const rows=await tx.get(benefitsQuery(col));if(rows.size>300)throw new HttpsError('resource-exhausted','Vínculo operacional excede o limite seguro.');result[key]=rows.docs.map(s=>({id:s.id,...s.data()})).filter(v=>scoped(v,c)&&v.active!==false&&!v.deletedAt).map(v=>Privacy.pick(v,col==='campaignProgress'?[...Privacy.scopeFields,'campaignId','clientId','pendingProgress','confirmedProgress','pendingPoints','availablePoints','availableRewards','redeemedRewards','cycleRemainder','benefitDebt','ledgerBaseline']:[...Privacy.scopeFields,'clientId','productId','variantId','startedAt','expiresAt','durationValue','durationUnit','contractedPrice','renewalCount','lastRenewedAt','createdFromSaleId','lastSaleId','reminders','renewalMessage','label']));}
  const events=await tx.get(benefitsQuery('campaignEvents'));if(events.size>300)throw new HttpsError('resource-exhausted','Benefícios precisam de revisão do gestor.');
  const allEvents=events.docs.map(s=>({id:s.id,...s.data()})),confirmed=new Set(allEvents.filter(e=>e.transition==='confirmed'||e.transition==='reversed').map(e=>e.confirmsEventId||e.reversedEventId));
  result.campaignEvents=allEvents.filter(e=>e.status==='pending'&&e.transition==='earned'&&!confirmed.has(e.id)&&scoped(e,c)).map(e=>({...Privacy.pick(e,[...Privacy.scopeFields,'campaignId','clientId','sourceType','sourceId','transition','expiresAt','saleId']),delta:Privacy.pick(e.delta||{},['progress','points','rewards'])}));
  for(const p of result.campaignProgress){const pending=result.campaignEvents.filter(e=>e.campaignId===p.campaignId);p.ledgerBaseline={pendingProgress:Math.max(0,Number(p.pendingProgress||0)-pending.reduce((n,e)=>n+Number(e.delta.progress||0),0)),pendingPoints:Math.max(0,Number(p.pendingPoints||0)-pending.reduce((n,e)=>n+Number(e.delta.points||0),0)),confirmedProgress:Number(p.confirmedProgress||0),availablePoints:Number(p.availablePoints||0),redeemedRewards:Number(p.redeemedRewards||0)};p.operationalProjection='current_benefit';}
  return envelope(c,result);
 }
 async function authorize(request){return db.runTransaction(async tx=>{const c=await context(tx,request),d=request.data||{};if(!c.owner)throw new HttpsError('permission-denied','Somente o proprietário pode autorizar atendimento histórico pontual.');if(!valid(d.targetUid)||!valid(d.saleId)||!valid(d.requestId)||!['consult','cancel','exchange'].includes(d.purpose)||String(d.reason||'').trim().length<8)throw new HttpsError('invalid-argument','Informe funcionário, venda, finalidade e motivo.');
  const target=(await tx.get(c.root.collection('members').doc(d.targetUid))).data(),sale=(await tx.get(c.root.collection('sales').doc(d.saleId))).data();if(target?.status!=='active'||!sale||sale.businessId!==c.bid||gen(sale)!==gen(c.business)||!c.ids.includes(sale.spaceId)||target.spaceAccess!=='all'&&!target.allowedSpaceIds?.includes(sale.spaceId))throw new HttpsError('permission-denied','Funcionário ou venda fora dos espaços autorizados.');
  if(d.purpose==='cancel'&&!P.has(target,'sales.cancel')||d.purpose==='exchange'&&(!P.has(target,'sales.create')||!P.has(target,'sales.cancel')))throw new HttpsError('permission-denied','O atendimento não concede a permissão comercial que falta ao funcionário.');
  if(!P.has(target,'sales.create')&&!P.has(target,'sales.viewAll'))throw new HttpsError('permission-denied','O funcionário precisa de acesso operacional a vendas antes da autorização pontual.');
  const id=checksum([c.bid,gen(c.business),c.uid,d.targetUid,d.saleId,d.purpose,d.requestId]),ref=c.root.collection('operationalReadGrants').doc(id),old=await tx.get(ref);if(old.exists)return{grantId:id,expiresAt:old.data().expiresAt.toDate().toISOString(),idempotent:true};
  const data={businessId:c.bid,workspaceGeneration:gen(c.business),targetUid:d.targetUid,saleId:d.saleId,spaceId:sale.spaceId,purpose:d.purpose,targetAccessHash:accessHash(target),issuedBy:c.uid,status:'active',reason:String(d.reason).trim().slice(0,400),createdAt:Timestamp.fromDate(clock()),expiresAt:Timestamp.fromMillis(clock().getTime()+15*60000)};tx.create(ref,data);return{grantId:id,expiresAt:data.expiresAt.toDate().toISOString(),idempotent:false};});}
 return{read,authorize};
}
module.exports={operationalReadService};

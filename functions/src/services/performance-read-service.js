'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const {FieldPath,Timestamp}=require('firebase-admin/firestore');
const {permissionService}=require('./permission-service');
const PAGE_SIZE=250;
const text=v=>String(v??'').slice(0,200);
const numeric=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
function sanitizeSale(id,s,financial,permissions){
  const out={id,businessId:s.businessId||null,spaceId:s.spaceId||s.financialSpaceId||null,
    data:s.data?.toDate?s.data.toDate().toISOString():s.data,
    valorFinal:numeric(s.valorFinal??s.valorTotal),status:text(s.status||s.saleStatus||s.tipo),active:s.active!==false&&s.ativo!==false,
    deleted:s.deleted===true||Boolean(s.deletedAt)||s.desfeita===true,formaPagamento:text(s.formaPagamento),paymentIntentId:s.paymentIntentId?text(s.paymentIntentId):null,
    paymentMetadata:{provider:text(s.paymentMetadata?.provider||s.provider)},
    itens:(s.itens||s.items||[]).map(i=>({produtoId:text(i.produtoId||i.productId),nome:text(i.nome||i.productNameSnapshot),quantidade:numeric(i.quantidade??i.quantity),
      categoryNameSnapshot:text(i.categoryNameSnapshot||i.categoria),subtotalFinal:numeric(i.subtotalFinal??i.valorTotal??Number(i.quantidade??i.quantity)*Number(i.precoFinalUnitario??i.precoUnitario??i.unitPriceSnapshot))}))};
  if(permissions.cost)out.custoTotal=numeric(financial?.custoTotal??s.custoTotal);
  const historicalCost=numeric(financial?.custoTotal??s.custoTotal);
  if(permissions.profit)out.lucro=numeric(financial?.lucro??(financial?.custoTotal!=null&&historicalCost!==null?Number(out.valorFinal)-historicalCost:s.lucro??(historicalCost!==null?Number(out.valorFinal)-historicalCost:NaN)));
  if(permissions.cost||permissions.profit)out.costResolution=text(financial?.costResolution||s.costResolution);
  return out;
}
function performanceReadService(db){
  async function page(request){
    const input=request.data||{},bid=input.businessId;
    if(!/^[-a-zA-Z0-9_]{3,128}$/.test(bid||''))throw new HttpsError('invalid-argument','Empresa inválida.');
    const context=await permissionService(db).authenticatedContext(request,bid,{ownerOnly:false});
    const member=context.member||context.profile,has=key=>member.role==='owner'||member.permissions?.[key]===true||member.permissions?.includes?.(key);
    if(!has('reports.view'))throw new HttpsError('permission-denied','Seu perfil não pode consultar Desempenho.');
    if(context.business.workspaceReset&&context.business.workspaceReset.status!=='COMPLETED')throw new HttpsError('failed-precondition','A empresa está em restauração.');
    if((input.workspaceGeneration??0)!==(context.business.workspaceGeneration??0))throw new HttpsError('failed-precondition','Reabra a VECONI para atualizar o ambiente.');
    const from=new Date(input.from),to=new Date(input.to);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to||to-from>733*86400000)throw new HttpsError('invalid-argument','Período inválido.');
    const unrestricted=member.role==='owner'||member.spaceAccess==='all',allowed=Array.isArray(member.allowedSpaceIds)?member.allowedSpaceIds.map(String):[],selected=input.spaceId&&input.spaceId!=='all'?String(input.spaceId):null;
    if(selected&&(!/^[-a-zA-Z0-9_]{1,128}$/.test(selected)||!unrestricted&&!allowed.includes(selected)))throw new HttpsError('permission-denied','Espaço não autorizado.');
    const spaceIds=selected?[selected]:unrestricted?null:allowed;
    if(spaceIds&&(!spaceIds.length||spaceIds.length>30))throw new HttpsError('failed-precondition','Selecione um espaço autorizado para analisar.');
    const field=spaceIds&&input.cursor?.field==='financialSpaceId'?'financialSpaceId':'spaceId';
    const kind=input.cursor?.kind==='timestamp'?'timestamp':'string',convert=v=>kind==='timestamp'?Timestamp.fromDate(v):v.toISOString();
    let query=db.collection(`businesses/${bid}/sales`).where('data','>=',convert(from)).where('data','<',convert(to));
    if(spaceIds)query=query.where(field,'in',spaceIds);
    query=query.orderBy('data').orderBy(FieldPath.documentId());
    const cursor=input.cursor;
    if(cursor?.id){
      const at=new Date(cursor.at);
      if(!/^[-a-zA-Z0-9_]{1,160}$/.test(cursor.id)||!Number.isFinite(at.getTime())||at<from||at>=to)throw new HttpsError('invalid-argument','Cursor inválido.');
      query=query.startAfter(kind==='string'?cursor.at:convert(at),cursor.id);
    }
    const permissions={cost:has('cost.view'),profit:has('profit.view')};
    const fields=['businessId','spaceId','financialSpaceId','data','valorFinal','valorTotal','status','saleStatus','tipo','active','ativo','deleted','deletedAt','desfeita','formaPagamento','paymentIntentId','paymentMetadata.provider','provider',
      'itens','items'];
    // Admin queries are projected and the response is allowlisted; no customer PII,
    // payment secrets, receipt text, product images or item costs leave this endpoint.
    if(permissions.cost)fields.push('custoTotal');if(permissions.profit)fields.push('lucro','custoTotal');
    if(permissions.cost||permissions.profit)fields.push('costResolution');
    const rows=await query.select(...fields).limit(PAGE_SIZE).get();
    // The alias pass only supplies records without a primary spaceId. Never
    // leak a different primary space or duplicate costs/rows for modern sales.
    const visible=rows.docs.filter(r=>field!=='financialSpaceId'||!r.data().spaceId);
    const refs=(permissions.cost||permissions.profit)?visible.map(r=>db.doc(`businesses/${bid}/saleFinancials/${r.id}`)):[];
    const financials=refs.length?await db.getAll(...refs):[];
    // Recheck identity/permissions after IO; never serve a snapshot from a retired generation.
    const [latest,latestMember]=await Promise.all([context.businessRef.get(),db.doc(`businesses/${bid}/members/${context.uid}`).get()]);
    if(latest.data()?.active!==true||(latest.data()?.workspaceGeneration??0)!==(context.business.workspaceGeneration??0)||latest.data()?.workspaceReset&&latest.data().workspaceReset.status!=='COMPLETED'||JSON.stringify(latestMember.data()||null)!==JSON.stringify(context.member||null))throw new HttpsError('aborted','Seu acesso ou os dados mudaram. Atualize a análise.');
    const last=rows.docs.at(-1),lastDate=last?.data()?.data;
    const next=rows.size===PAGE_SIZE?{kind,field,id:last.id,at:lastDate?.toDate?lastDate.toDate().toISOString():lastDate}:kind==='string'?{kind:'timestamp',field}:spaceIds&&field==='spaceId'?{kind:'string',field:'financialSpaceId'}:null;
    return{businessId:bid,workspaceGeneration:context.business.workspaceGeneration??0,permissions,rows:visible.map((r,i)=>sanitizeSale(r.id,r.data(),financials[i]?.data(),permissions)),next,complete:!next,asOf:new Date().toISOString(),pageSize:PAGE_SIZE};
  }
  return{page};
}
module.exports={performanceReadService,sanitizeSale,PAGE_SIZE};

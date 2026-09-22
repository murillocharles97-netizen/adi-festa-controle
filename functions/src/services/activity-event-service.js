'use strict';

const SOURCE_SPECS=Object.freeze({
  sales:{prefix:'sale',type:'sale'},
  payments:{prefix:'payment',type:'payment'},
  balanceAdjustments:{prefix:'balance',type:'balance'},
  stockMovements:{prefix:'stock',type:'stock'},
  campaignEvents:{prefix:'campaign',type:'campaign'},
  customerSubscriptionEvents:{prefix:'renewal',type:'renewal'},
  catalogOrders:{prefix:'order',type:'order'},
});
const INVALID_SALE_STATUSES=new Set(['cancelado','cancelada','cancelled','canceled','desfeito','desfeita','venda_desfeita','estornado','estornada','refunded']);

const first=(data,...keys)=>keys.map(key=>data?.[key]).find(value=>value!==undefined&&value!==null&&value!=='');
const text=(value,max=240)=>String(value??'').trim().slice(0,max);
const numberOrNull=value=>Number.isFinite(Number(value))?Number(value):null;
const dateValue=(data,type)=>first(data,...(type==='order'?['updatedAt','createdAt','data']:['createdAt','data','criadoEm','updatedAt']));
const actor=(data)=>({
  actorUid:text(first(data,'actorUid','createdByUid','userId','ownerId'),128)||null,
  actorNameSnapshot:text(first(data,'actorNameSnapshot','actorName','createdByName','userName'),120)||null,
  actorRoleSnapshot:text(first(data,'actorRoleSnapshot','actorRole','createdByRole','role'),80)||null,
});
const eventIdFor=(sourceCollection,sourceDocumentId)=>{
  const spec=SOURCE_SPECS[sourceCollection];
  if(!spec)throw Object.assign(Error(`Unsupported activity source: ${sourceCollection}`),{code:'unsupported-activity-source'});
  const id=text(sourceDocumentId,500);
  if(!id||id.includes('/'))throw Object.assign(Error('Invalid activity source id.'),{code:'invalid-activity-source-id'});
  return `${spec.prefix}:${id}`;
};
function timestamp(value,Timestamp){
  if(value&&typeof value.toMillis==='function')return value;
  const parsed=value instanceof Date?value:new Date(value||0);
  return Number.isNaN(parsed.getTime())?Timestamp.now():Timestamp.fromDate(parsed);
}
function sourceStatus(data,type){
  const raw=text(first(data,'applicationStatus','orderStatus','status','transition','tipo'),80).toLowerCase();
  if(type==='sale'&&INVALID_SALE_STATUSES.has(raw))return 'cancelled';
  if(['cancelado','cancelada','cancelled','canceled','reversed','revertido','expired','estornado','estornada'].includes(raw))return raw==='expired'?'expired':'cancelled';
  if(['pending','pendente','recebido','separando','deslocamento','processing','syncing'].includes(raw))return 'pending';
  return 'confirmed';
}
function summary(data,type){
  const common={
    customerId:text(first(data,'clienteId','clientId','customerId'),160)||null,
    customerName:text(first(data,'clienteNome','clientName','customerName'),160)||null,
    amount:numberOrNull(first(data,'valorFinal','valorTotal','valor','total','amount')),
    paymentMethod:text(first(data,'formaPagamento','paymentMethod','metodoPagamento'),80)||null,
  };
  if(type==='stock')return{
    ...common,
    productId:text(first(data,'produtoId','productId'),160)||null,
    productName:text(first(data,'produtoNome','productName'),160)||null,
    variantName:text(data.variantName,160)||null,
    quantity:numberOrNull(first(data,'quantidade','quantity')),
    note:text(first(data,'observacao','note','motivo'),240)||null,
  };
  if(type==='campaign')return{
    ...common,
    campaignId:text(data.campaignId,160)||null,
    campaignName:text(first(data,'campaignName','nomeCampanha'),160)||null,
    transition:text(first(data,'transition','status'),80)||null,
  };
  if(type==='renewal')return{
    ...common,
    subscriptionId:text(data.subscriptionId,160)||null,
    productId:text(data.productId,160)||null,
    productName:text(first(data,'productName')||data.next?.label||data.previous?.label,160)||null,
    transition:text(data.transition,80)||null,
  };
  if(type==='order')return{
    ...common,
    publicOrderNumber:text(data.publicOrderNumber,80)||null,
    orderStatus:text(first(data,'orderStatus','status'),80)||null,
  };
  if(type==='balance')return{
    ...common,
    balanceBefore:numberOrNull(first(data,'saldoAnterior','balanceBefore')),
    balanceAfter:numberOrNull(first(data,'saldoNovo','balanceAfter')),
    reason:text(first(data,'motivo','reason','observacao'),240)||null,
  };
  return common;
}
function buildActivityEvent({businessId,sourceCollection,sourceDocumentId,data,sourceDeleted=false,Timestamp}){
  const spec=SOURCE_SPECS[sourceCollection];
  if(!spec||!data)return null;
  if(sourceCollection==='stockMovements'&&['saida_venda','venda_desfeita'].includes(String(data.tipo||'')))return null;
  const eventId=eventIdFor(sourceCollection,sourceDocumentId),operationId=text(first(data,'operationId','idempotencyKey'),500)||null;
  return{
    id:eventId,eventId,businessId:text(businessId,160),type:spec.type,
    subtype:text(first(data,'subtype','subtipo','transition','tipo','orderStatus','status'),100)||null,
    entityId:text(sourceDocumentId,500),operationId,
    ...actor(data),spaceId:text(first(data,'spaceId','financialSpaceId'),160)||null,
    createdAt:timestamp(dateValue(data,spec.type),Timestamp),
    sourceUpdatedAt:timestamp(first(data,'updatedAt',dateValue(data,spec.type)),Timestamp),
    status:sourceDeleted?'source_deleted':sourceStatus(data,spec.type),sourceDeleted:Boolean(sourceDeleted),
    sourceCollection,sourceDocumentId:text(sourceDocumentId,500),
    summary:summary(data,spec.type),schemaVersion:1,
  };
}

function activityEventService(db,{FieldValue,Timestamp}){
  const eventRef=(businessId,eventId)=>db.doc(`businesses/${businessId}/activityEvents/${eventId}`);
  async function project({businessId,sourceCollection,sourceDocumentId,before,after}){
    const afterExists=Boolean(after?.exists),snapshot=afterExists?after:before,data=snapshot?.data?.();
    const value=buildActivityEvent({businessId,sourceCollection,sourceDocumentId,data,sourceDeleted:!afterExists,Timestamp});
    if(!value)return{skipped:true};
    await eventRef(businessId,value.eventId).set({...value,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return{eventId:value.eventId,created:true};
  }
  async function reconcileBusiness(businessId,{limit=50}={}){
    const bounded=Math.max(1,Math.min(100,Number(limit)||50)),rows=[];
    for(const sourceCollection of Object.keys(SOURCE_SPECS)){
      const snapshot=await db.collection(`businesses/${businessId}/${sourceCollection}`).orderBy('createdAt','desc').limit(bounded).get();
      for(const doc of snapshot.docs){
        const value=buildActivityEvent({businessId,sourceCollection,sourceDocumentId:doc.id,data:doc.data(),Timestamp});
        if(value)rows.push(value);
      }
    }
    for(let offset=0;offset<rows.length;offset+=400){
      const batch=db.batch();
      rows.slice(offset,offset+400).forEach(value=>batch.set(eventRef(businessId,value.eventId),{...value,updatedAt:FieldValue.serverTimestamp()},{merge:true}));
      await batch.commit();
    }
    return{businessId,sourceLimit:bounded,projected:rows.length,byType:rows.reduce((all,row)=>({...all,[row.type]:(all[row.type]||0)+1}),{})};
  }
  return{project,reconcileBusiness};
}

module.exports={SOURCE_SPECS,eventIdFor,buildActivityEvent,activityEventService};

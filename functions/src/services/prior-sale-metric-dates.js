'use strict';
// Read every affected projection before the trigger starts writing counters.
async function priorSaleMetricDates(tx,db,businessId,targets,source){
  const dates=new Map();if(source.recordingMode!=='prior_sale')return dates;
  for(const[key,row]of targets){const [global,monthly]=await Promise.all([tx.get(db.doc(`businesses/${businessId}/customerMetrics/${row.clientId}`)),tx.get(db.doc(`businesses/${businessId}/customerMonthlyMetrics/${row.clientId}__${row.month}`))]);dates.set(key,{global:global.data()||{},monthly:monthly.data()||{}});}return dates;
}
function keepNewestPurchase(patch,previous={}){if(!patch.lastPurchaseAt)return patch;return{...patch,lastPurchaseAt:[patch.lastPurchaseAt,previous.lastPurchaseAt].filter(Boolean).sort().at(-1),lastPurchaseAtNeedsRebuild:previous.lastPurchaseAtNeedsRebuild===true};}
module.exports={priorSaleMetricDates,keepNewestPurchase};

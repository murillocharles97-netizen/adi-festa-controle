'use strict';
// Incident identifiers are PRIVATE runtime configuration, never repository data.
// Invalid/missing configuration fails closed. This grants no commercial rights.
function policyFor(c){
 if(!c.owner)return[];let scope;try{scope=JSON.parse(process.env.SALE_MONETARY_ANALYSIS_SCOPE_V1||'null');}catch{return[];}
 const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
 if(!scope||scope.businessId!==c.businessId||scope.ownerUid!==c.uid||!id(scope.businessId)||!id(scope.ownerUid)||!Array.isArray(scope.targets)||scope.targets.length!==2)return[];
 const targets=scope.targets;if(!targets.every(t=>id(t.saleId)&&id(t.operationId)&&id(t.spaceId)&&Number.isSafeInteger(t.reportedAmountCents)&&t.reportedAmountCents>0&&/^fnv1a:[a-f0-9]{8}$/.test(t.expectedDiagnosticChecksum)&&Array.isArray(t.productIds)&&t.productIds.length===2&&t.productIds.every(id)&&Array.isArray(t.movementIds)&&t.movementIds.length===2&&t.movementIds.every(id))||new Set(targets.map(t=>t.operationId)).size!==2||new Set(targets.map(t=>t.saleId)).size!==2)return[];
 return targets.map(t=>({saleId:t.saleId,operationId:t.operationId,spaceId:t.spaceId,reportedAmountCents:t.reportedAmountCents,expectedDiagnosticChecksum:t.expectedDiagnosticChecksum,productIds:[...t.productIds],movementIds:[...t.movementIds]}));
}
// Compatible rollback pauses intake, never removes originals, receipts or fences.
const INTAKE_ENABLED=false;
module.exports={policyFor,INTAKE_ENABLED};

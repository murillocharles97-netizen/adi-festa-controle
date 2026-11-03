'use strict';
const {HttpsError}=require('firebase-functions/v2/https'),P=require('../shared/permission-policy'),Privacy=require('../shared/operational-privacy-policy'),{createHash}=require('node:crypto');
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
const accessHash=m=>createHash('sha256').update(canonical(JSON.parse(Privacy.accessShape(m)))).digest('hex');
async function assertOperationalSaleAccess(tx,db,c,sale,{purpose='consult',grantId=null,operationId=null,allowOwnReceipt=false,clock=()=>new Date()}={}){
 if(!Privacy.restricted(c.member))return;
 const bid=c.bid||c.business.id,uid=c.uid,root=db.doc('businesses/'+bid),generation=c.business.workspaceGeneration??0;
 const settings=(await tx.get(root.collection('settings').doc('default'))).data()||{},zone=c.business.timezone||settings.timezone||'America/Sao_Paulo';
 if(P.has(c.member,'performance.daily')&&P.dayKey(sale.data||sale.createdAt,zone)===P.dayKey(clock(),zone))return;
 // A lost response can still be acknowledged for the exact original actor and
 // operation. This never authorizes another historical sale or a new effect.
 if(allowOwnReceipt&&operationId){const m=(await tx.get(root.collection('processedOperations').doc(operationId))).data();if(m?.status==='processed'&&(m.actorUid||m.ownerId)===uid&&m.businessId===bid&&(m.workspaceGeneration??0)===generation&&(m.saleId||m.originalSaleId)===sale.id)return;}
 if(allowOwnReceipt&&operationId){const e=(await tx.get(root.collection('saleExchanges').doc(operationId))).data();if(e&&e.actorUid===uid&&e.originalSaleId===sale.id&&e.businessId===bid&&e.spaceId===sale.spaceId&&(e.workspaceGeneration??0)===generation)return;}
 if(!grantId||!/^[-a-zA-Z0-9_]{1,128}$/.test(grantId))throw new HttpsError('permission-denied','Venda de outro dia: solicite ao proprietário uma autorização pontual de atendimento.',{reason:'operational-sale-grant-required'});
 const g=(await tx.get(root.collection('operationalReadGrants').doc(grantId))).data();
 if(!g||g.businessId!==bid||g.targetUid!==uid||g.saleId!==sale.id||g.spaceId!==sale.spaceId||g.workspaceGeneration!==generation||g.purpose!==purpose&&!(purpose==='consult'&&['cancel','exchange'].includes(g.purpose))||g.status!=='active'||!Number.isFinite(g.expiresAt?.toMillis?.())||g.expiresAt.toMillis()<=clock().getTime()||g.targetAccessHash!==accessHash(c.member))throw new HttpsError('permission-denied','A autorização pontual expirou ou não corresponde à sessão e à venda.',{reason:'operational-sale-grant-invalid'});
 const [issuer,user]=await Promise.all([tx.get(root.collection('members').doc(g.issuedBy)),tx.get(db.doc('users/'+g.issuedBy))]);
 if(c.business.ownerId!==g.issuedBy||issuer.data()?.role!=='owner'||issuer.data()?.status!=='active'||user.data()?.active!==true||user.data()?.businessId!==bid)throw new HttpsError('permission-denied','O responsável pela autorização não possui vínculo de proprietário ativo.');
}
module.exports={assertOperationalSaleAccess,accessHash};

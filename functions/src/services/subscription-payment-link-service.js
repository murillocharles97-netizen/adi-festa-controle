'use strict';

async function resolveSubscriptionIdFromPayment(db,payment={}){
  const direct=String(payment?.metadata?.preapproval_id||payment?.subscription_id||'').trim();
  if(direct)return direct;
  const externalReference=String(payment?.external_reference||'').trim();
  if(!/^billing_[a-f0-9]{56}$/.test(externalReference))return null;
  const snapshot=await db.collection('subscriptionIndex').where('expectedExternalReference','==',externalReference).limit(2).get();
  if(snapshot.size!==1)return null;
  return snapshot.docs[0].id;
}

module.exports={resolveSubscriptionIdFromPayment};

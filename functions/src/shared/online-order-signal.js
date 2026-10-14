'use strict';
function writeOnlineSignal(tx,root,at,{stock=false}={}){
  const version=at.toDate().toISOString(),names=stock?['catalogOrders','products']:['catalogOrders'];
  tx.set(root.collection('syncMetadata').doc('last-sync'),{businessId:root.id,revision:version,updatedAt:at,changedCollections:names,collectionVersions:Object.fromEntries(names.map(name=>[name,version]))},{merge:true});
}
module.exports={writeOnlineSignal};

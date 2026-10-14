const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../functions/src/shared/legacy-store-cleanup');
const root=require('node:path').join(__dirname,'..'),read=f=>fs.readFileSync(require('node:path').join(root,f),'utf8');
test('cleanup never touches another business, V2, unknown schema or unknown subcollection',()=>{
 const c={businessId:'business-a',schemaVersion:5,catalogType:'universal'};
 assert.equal(P.classify({businessId:'business-b',catalog:c}),'PRESERVE_OTHER_BUSINESS');
 for(const delta of [{schemaVersion:6},{spaceId:'a'},{catalogType:'space_store'}])assert.equal(P.classify({businessId:'business-a',catalog:{...c,...delta}}),'PRESERVE_V2');
 for(const delta of [{storeReference:true},{binding:true}])assert.equal(P.classify({businessId:'business-a',catalog:c,...delta}),'PRESERVE_V2');
 assert.equal(P.classify({businessId:'business-a',catalog:{...c,schemaVersion:3}}),'PRESERVE_UNCLASSIFIED');
 assert.equal(P.classify({businessId:'business-a',catalog:c,subcollections:[{collection:'unknown',count:0}]}),'PRESERVE_UNKNOWN_DEPENDENCY');
});
test('orders and rewards require preservation; only their public configuration can be retired',()=>{
 for(const collection of ['orders','redemptionRequests'])assert.equal(P.classify({businessId:'a',catalog:{businessId:'a',schemaVersion:4},subcollections:[{collection,count:1}]}),'RETIRE_WITH_PROTECTED_RECORDS');
 assert.equal(P.removableProjection('orders'),false);assert.equal(P.removableProjection('redemptionRequests'),false);
 const retired=P.retiredParent({businessId:'a',visitId:'v',schemaVersion:4,items:[{productId:'real'}],secret:'x'});
 assert.deepEqual(retired,{businessId:'a',visitId:'v',schemaVersion:4,catalogType:'retired_legacy_store',legacyStoreRetired:true,active:false,catalogVisible:false,acceptingOrders:false});
 assert.equal(P.classify({businessId:'a',catalog:retired}),'ALREADY_RETIRED');
});
test('exact path allowlist prohibits canonical records and financial writes',()=>{
 const allowed={catalogIds:new Set(['old']),projectionPaths:new Set(['publicCatalogs/old/portalProfiles/p']),visitIds:new Set(['v'])};
 for(const path of ['businesses/a/products/p','businesses/a/sales/s','businesses/a/clients/c','businesses/a/payments/p','businesses/a/onlineStores/s','businesses/b/settings/default','publicCatalogs/old/orders/o','publicCatalogs/new'])assert.equal(P.validateWrite(path,'a',allowed),false,path);
 for(const path of ['businesses/a/settings/default','businesses/a/visits/v','publicCatalogs/old','publicCatalogs/old/portalProfiles/p'])assert.equal(P.validateWrite(path,'a',allowed),true,path);
});
test('catalog route has no global bootstrap or legacy UI fallback',()=>{
 const context={window:{OnlineStoreUI:{render:()=>'<v2>',bind:()=>true}},DB:{alterar:()=>assert.fail('No startup writes')}};
 vm.runInNewContext(read('js/catalogo-admin.js'),context);assert.equal(context.window.CatalogoUI.render(),'<v2>');
 assert.equal(context.window.CatalogoUniversal,undefined);
 assert.doesNotMatch(read('index.html'),/src="\.\/js\/catalog-presentation\.js/);
 const ui=read('js/online-store-ui.js');for(const text of ['Encontramos uma loja antiga','Revisar migração','Continuar no fluxo antigo','migrateModal','data-migrate','OnlineStoreUI.legacy'])assert.ok(!ui.includes(text),text);
 assert.doesNotMatch(read('js/firebase/catalog-bridge.js'),/addEventListener|onSnapshot|setDoc|ensure\(/);
 const service=read('functions/src/services/online-store-service.js');assert.doesNotMatch(service,/legacyCatalogs|pause_legacy|action==='migrate'/);
 assert.match(read('js/catalogo-publico.js'),/schemaVersion>=6&&cached.catalogType==='space_store'/);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=()=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('js/firebase/product-import-fence.js','utf8')).toString('base64'));
const snapshot=data=>({data:()=>data});
const args=transaction=>({transaction,db:{},businessId:'biz',doc:(_db,...parts)=>parts.join('/'),serverTimestamp:()=> 'timestamp'});

test('partial stock/price payload never reads or writes the identity fence',async()=>{
 const {prepareProductImportFence}=await load();
 const transaction={get(){throw Error('Unexpected read');},set(){throw Error('Unexpected write');}};
 const commit=await prepareProductImportFence({...args(transaction),writes:[
  {entityType:'products',operation:'update',entityId:'p',before:{codigo:'SKU',barcode:'123',allowedSpaceIds:['s'],estoque:10},data:{estoque:9,preco:25}},
  {entityType:'productVariants',operation:'update',entityId:'v',before:{sku:'VAR',parentProductId:'p',stock:10},data:{stock:9}}
 ]});commit();
});

test('variant tombstone joins fence without requiring parent in changed fields',async()=>{
 const {prepareProductImportFence}=await load(),reads=[],writes=[];
 const transaction={get:async path=>{reads.push(path);return snapshot(path.endsWith('/v')?{sku:'VAR',parentProductId:'p'}:{revision:1});},set:(...v)=>writes.push(v)};
 const commit=await prepareProductImportFence({...args(transaction),writes:[{entityType:'productVariants',operation:'update',entityId:'v',before:{sku:'VAR',parentProductId:'p'},data:{active:false,deletedAt:'now'}}]});commit();
 assert.equal(writes.length,1);assert.equal(reads.length,2);assert.equal(writes[0][1].revision,2);
});

test('partial identity patch retains current server scope when validating claims',async()=>{
 const {prepareProductImportFence}=await load(),reads=[];
 const transaction={get:async path=>{reads.push(path);
  if(path.endsWith('/products/p'))return snapshot({codigo:'OLD',spaceAccessMode:'single_space',allowedSpaceIds:['current']});
  if(path.endsWith('/products/imported'))return snapshot({codigo:'NEW',spaceAccessMode:'single_space',allowedSpaceIds:['current']});
  if(path.endsWith('catalog-revision'))return snapshot({revision:1});
  return snapshot({productIds:['imported']});
 },set(){throw Error('Conflict must not write');}};
 await assert.rejects(prepareProductImportFence({...args(transaction),writes:[{entityType:'products',operation:'update',entityId:'p',before:{codigo:'OLD',spaceAccessMode:'single_space',allowedSpaceIds:['stale']},data:{codigo:'NEW'}}]}),e=>e.code==='product-identifier-conflict');
 assert.ok(reads.some(p=>p.endsWith('/products/p')));
});

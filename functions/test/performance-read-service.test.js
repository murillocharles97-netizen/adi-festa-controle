const {test}=require('node:test'),assert=require('node:assert/strict');
const {sanitizeSale}=require('../src/services/performance-read-service');
const source={businessId:'a',data:'2026-10-04T15:00:00Z',valorFinal:100,custoTotal:40,lucro:60,clienteNome:'PRIVATE',observacao:'PRIVATE',paymentMetadata:{provider:'mock',secret:'PRIVATE'},itens:[{nome:'P',quantidade:1,custoUnitario:40,imageUrl:'PRIVATE',subtotalFinal:100}]};
test('seller payload excludes every sensitive field, image and customer identifier',()=>{
 const payload=sanitizeSale('id',source,{custoTotal:45,lucro:55},{cost:false,profit:false});
 assert.equal(JSON.stringify(payload).includes('PRIVATE'),false);assert.equal('lucro' in payload,false);assert.equal('custoTotal' in payload,false);assert.equal('custoUnitario' in payload.itens[0],false);
});
test('financial snapshot takes precedence and permission fields are individually gated',()=>{
 const payload=sanitizeSale('id',source,{custoTotal:45,lucro:55},{cost:false,profit:true});
 assert.equal(payload.lucro,55);assert.equal('custoTotal' in payload,false);
 assert.equal(sanitizeSale('id',source,{custoTotal:45},{cost:true,profit:false}).custoTotal,45);
 assert.equal(sanitizeSale('id',source,{custoTotal:45},{cost:false,profit:true}).lucro,55);
});
test('missing costs remain null and zero cost remains a real zero',()=>{
 assert.equal(sanitizeSale('id',{},null,{cost:true,profit:true}).custoTotal,null);
 assert.equal(sanitizeSale('id',{custoTotal:null},null,{cost:true,profit:true}).custoTotal,null);
 assert.equal(sanitizeSale('id',{custoTotal:0,lucro:0},null,{cost:true,profit:true}).custoTotal,0);
 assert.equal(sanitizeSale('id',{custoTotal:0,costResolution:'partial'},null,{cost:true,profit:true}).costResolution,'partial');
});

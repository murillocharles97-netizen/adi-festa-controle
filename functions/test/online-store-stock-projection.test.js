'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {stockChanged,patchAvailability,onlineStoreStockProjection}=require('../src/services/online-store-stock-projection');
const Model=require('../src/shared/online-store');
const store={spaceId:'space-a',presentation:{products:{}}};
const product={id:'product-a',estoqueAtual:3,onlineReservedStock:1,preco:25,custo:123,spaceAccessMode:'selected_spaces',allowedSpaceIds:['space-a']};
const item={productId:'product-a',productType:'simple',active:true,availableQuantity:3,salePrice:25,featured:true,description:'Owner presentation'};
test('net public availability uses the same arithmetic as initial publication, never double subtracts',()=>{
  const p=patchAvailability({...item,reservedStock:1},product,new Map(),store);
  assert.equal(p.availableQuantity,2);assert.equal(p.availableQuantity,Model.product(product).availableQuantity);
  assert.equal(p.reservedStock,undefined);assert.equal(p.custo,undefined);assert.equal(p.description,item.description);assert.equal(p.salePrice,25);
});
test('reservation, cancellation, consumed stock and final release show canonical quantities',()=>{
  const qty=p=>patchAvailability(item,{...product,...p},new Map(),store).availableQuantity;
  assert.equal(qty({onlineReservedStock:0}),3);assert.equal(qty({onlineReservedStock:2}),1);
  assert.equal(qty({estoqueAtual:2,onlineReservedStock:1}),1);assert.equal(qty({estoqueAtual:2,onlineReservedStock:0}),2);
});
test('missing/deleted/out-of-space products stay unavailable without adding items',()=>{
  for(const p of [null,{...product,deleted:true},{...product,allowedSpaceIds:['space-b']}]){
    const next=patchAvailability(item,p,new Map(),store);assert.equal(next.active,false);assert.equal(next.availableQuantity,0);
  }
  assert.equal(patchAvailability({...item,ownerPublished:false},product,new Map(),store).active,false);
  assert.equal(patchAvailability(item,product,new Map(),{...store,presentation:{products:{'product-a':{published:false}}}}).active,true);
});
test('variants only update previously published variants, aggregate availability and preserve public metadata',()=>{
  const publicItem={...item,productType:'variable',variants:[{id:'variant-a',salePrice:30,availableQuantity:3},{id:'variant-b',salePrice:40,availableQuantity:2}]};
  const variants=new Map([['variant-a',{parentProductId:'product-a',stock:3,onlineReservedStock:2,price:99,custo:10}],['variant-b',{parentProductId:'other-parent',stock:100}],['not-published',{parentProductId:'product-a',stock:500}]]);
  const next=patchAvailability(publicItem,product,variants,store);
  assert.equal(next.availableQuantity,1);assert.equal(next.variants.length,2);assert.equal(next.variants[0].salePrice,30);assert.equal(next.variants[0].availableQuantity,1);assert.equal(next.variants[0].custo,undefined);assert.equal(next.variants[1].active,false);
});
test('uncontrolled services stay uncontrolled and invalid canonical quantity aborts projection',()=>{
  assert.equal(patchAvailability(item,{...product,itemKind:'service'},new Map(),store).controlaEstoque,false);
  assert.throws(()=>patchAvailability(item,{...product,estoqueAtual:'invalid'},new Map(),store),/Invalid canonical stock/);
});
test('trigger ignores price/cost/timestamp-only changes and scope ordering; handles stock, scope, deletion and variant parent',()=>{
  assert.equal(stockChanged('product',product,{...product,preco:99,custo:0,updatedAt:'later'}),false);
  assert.equal(stockChanged('product',{...product,allowedSpaceIds:['space-a','space-b']},{...product,allowedSpaceIds:['space-b','space-a']}),false);
  for(const patch of [{onlineReservedStock:2},{estoqueAtual:2},{allowedSpaceIds:['space-b']},{deleted:true},{workspaceGeneration:1}])assert.equal(stockChanged('product',product,{...product,...patch}),true);
  assert.equal(stockChanged('variant',{stock:1,parentProductId:'one'},{stock:1,parentProductId:'two'}),true);
  assert.equal(stockChanged('product',null,product),true);assert.equal(stockChanged('product',product,null),true);
});
test('unrelated events perform zero database reads',async()=>{
  const db={collection(){throw Error('No query allowed');}};
  assert.equal((await onlineStoreStockProjection(db).handle({businessId:'business-a',documentId:product.id,kind:'product',before:product,after:{...product,updatedAt:'later'}})).skipped,'unrelated-change');
});

'use strict';
// "Corrigir SKU/EAN" preview (V239). Fictitious products only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const M=require('../js/product-spreadsheet');
const scope={businessId:'b',spaceId:'store',allSpaces:true,allowedSpaceIds:['store']};
const headers=M.exportColumns.map(c=>c[0]);
const line=data=>M.exportColumns.map(([,k])=>data[k]??null);
const base=(id,data={})=>({id,businessId:'b',nome:'Produto '+id,ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:['store'],...data});
const catalog=(products,variants=[])=>({products,variants});
const run=(rows,products,variants)=>M.previewIdentifiers([headers,...rows.map(line)],catalog(products,variants),scope);

test('SKU, EAN or both; blank cells keep the current code; other columns are ignored',()=>{
 const products=[base('a',{codigo:'ERR',barcode:'789001'}),base('b',{codigo:'B',barcode:'789002'}),base('c',{codigo:'C',barcode:'789003'})];
 const p=run([{id:'a',codigo:'OK',preco:999,estoqueAtual:0},{id:'b',barcode:'789009'},{id:'c',codigo:'C2',barcode:'789010'}],products);
 assert.deepEqual(p.rows.map(r=>r.status),['update','update','update']);
 assert.deepEqual(p.rows[0].next,{codigo:'OK',barcode:'789001'});assert.deepEqual(p.rows[0].before,{codigo:'ERR',barcode:'789001'});
 assert.deepEqual(p.rows[1].changed,['barcode']);assert.deepEqual(p.rows[2].changed,['codigo','barcode']);
 assert.equal(p.rows[0].changes,undefined,'no price/stock change leaks into this mode');
 assert.equal(run([{id:'a',codigo:'ERR',barcode:'789001'}],products).rows[0].status,'unchanged');
});
test('ID is mandatory and must match an authorized product; nothing is created',()=>{
 const products=[base('a',{codigo:'A'}),base('other',{codigo:'O',allowedSpaceIds:['elsewhere']}),base('foreign',{businessId:'x'})];
 const narrow={...scope,allSpaces:false};
 const p=M.previewIdentifiers([headers,line({codigo:'NEW',nome:'Sem ID'}),line({id:'ghost',codigo:'G'}),line({id:'a/b',codigo:'G'}),line({id:'other',codigo:'O2'}),line({id:'foreign',codigo:'F'})],catalog(products),narrow);
 assert.deepEqual(p.rows.map(r=>r.status),Array(5).fill('invalid'));assert.equal(p.counts.creates,0);assert.equal(p.counts.updates,0);
 assert.match(p.rows[0].errors[0],/ID VECONI/);
});
test('duplicated old EAN: no automatic choice, only the ID named changes; warning on the other',()=>{
 const products=[base('a',{barcode:'DUP'}),base('b',{barcode:'DUP'})];
 const p=run([{id:'a',barcode:'NEWA'},{id:'b',barcode:'DUP'}],products);
 assert.equal(p.rows[0].status,'update');assert.equal(p.rows[1].status,'unchanged');
 assert.match(p.rows[1].notes[0],/também está em/);
});
test('conflicts with other, inactive, variation and alternate codes; swaps and repeated rows blocked',()=>{
 const products=[base('t',{codigo:'T',barcode:'TE'}),base('u',{codigo:'U',barcode:'UE',alternateBarcodes:['ALT']}),base('off',{codigo:'OFF',barcode:'OFFE',ativo:false}),base('p',{codigo:'P',barcode:'PE'})];
 const variants=[{id:'v1',parentProductId:'p',sku:'VS',barcode:'VE'}];
 for(const data of [{codigo:'U'},{barcode:'UE'},{barcode:'ALT'},{codigo:'OFF'},{barcode:'OFFE'},{codigo:'VS'},{barcode:'VE'}])
  assert.equal(run([{id:'t',...data}],products,variants).rows[0].conflict,true,JSON.stringify(data));
 assert.equal(run([{id:'off',codigo:'NEWOFF'}],products).rows[0].conflict,true,'inactive product is not corrected');
 const swap=run([{id:'t',codigo:'U'},{id:'u',codigo:'T'}],products);assert.equal(swap.counts.updates,0);
 const same=run([{id:'t',codigo:'Z'},{id:'p',codigo:'Z'}],products);assert.equal(same.counts.updates,0);assert.equal(same.counts.conflicts,2);
 const twice=run([{id:'t',codigo:'Z1'},{id:'t',codigo:'Z2'}],products);assert.equal(twice.counts.updates,0);
});
test('text cells only, no spaces in EAN, header contract',()=>{
 const products=[base('a',{codigo:'A',barcode:'1'})];
 assert.equal(run([{id:'a',barcode:7890}],products).rows[0].status,'invalid');
 assert.equal(run([{id:'a',barcode:'78 90'}],products).rows[0].status,'invalid');
 assert.throws(()=>M.previewIdentifiers([['Nome do produto','Preço de venda'],['A','1']],catalog(products),scope),/ID VECONI/);
 // Exported sheet with only the 3 identifier columns also works.
 assert.equal(M.previewIdentifiers([M.columns.slice(0,3).map(c=>c[0]),['a','A2','1']],catalog(products),scope).rows[0].status,'update');
});
test('normal import keeps refusing code changes but points to the new mode',()=>{
 const p=M.preview([M.columns.map(c=>c[0]),M.columns.map(([,k])=>({id:'a',codigo:'A2'})[k]??null)],[base('a',{codigo:'A',barcode:'1'})],scope,{cost:true,stock:true},'update');
 assert.match(p.rows[0].errors[0],/Corrigir SKU\/EAN/);
});
test('server path and client wiring stay separate from stock and the Sync queue',()=>{
 const server=fs.readFileSync('functions/src/services/product-spreadsheet-service.js','utf8'),fn=server.slice(server.indexOf('async function correctIdentifiers'));
 const body=fn.slice(0,fn.indexOf('return {createProducts'));for(const banned of ['estoque','stockMovements','totalStock',"collection('sales')",'alternateBarcodes:'])assert.ok(!body.includes(banned),banned);
 assert.match(fs.readFileSync('functions/src/index.js','utf8'),/exports\.correctSpreadsheetIdentifiers=onCall/);
 const client=fs.readFileSync('js/firebase/product-spreadsheet-service.js','utf8'),apply=client.slice(client.indexOf('export async function applyIdentifierCorrections'),client.indexOf('const entryNote'));
 assert.match(apply,/correctSpreadsheetIdentifiers/);assert.doesNotMatch(apply,/aplicarLote|Produtos\.salvar|processSyncQueue/);
});

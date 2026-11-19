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

// ---- V239.1: canonical identifiers (Codex NO-GO #2) ----
const ZW='\u200B',BOM='\uFEFF',SHY='\u00AD',NBSP='\u00A0',FW7='\uFF17';
function loadReader(produtos,variacoesProdutos=[]){
 const listeners={},window={DB:{carregar:()=>({produtos,variacoesProdutos}),getBusinessId:()=>'b'},addEventListener(){}};
 const document={addEventListener(t,f){listeners[t]=f;},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},classList:{add(){},remove(){}},setAttribute(){},appendChild(){}}),body:{appendChild(){}},documentElement:{}};
 const ctx={window,document,navigator:{onLine:false},localStorage:{setItem(){},getItem:()=>null},console,setTimeout,clearTimeout,matchMedia:()=>({matches:false})};
 Object.assign(ctx,window);ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/barcode.js','utf8'),ctx);return ctx;
}
const vm=require('node:vm');
test('canonical form: invisible/format chars, NBSP, full-width digits collapse; leading zeros kept',()=>{
 for(const v of [`789${ZW}1`,`${BOM}7891`,`78${SHY}91`,`789${NBSP}1`,'7891 ',`78\u2060\u200D91`])assert.equal(M.canonical('barcode',v),'7891',JSON.stringify(v));
 assert.equal(M.canonical('barcode',`${FW7}891`),'7891');
 assert.equal(M.canonical('barcode','0007891'),'0007891');assert.notEqual(M.canonical('barcode','07891'),M.canonical('barcode','7891'));
 assert.equal(M.canonical('codigo',` A${ZW}B  C `),'AB C');
});
test('reader, cadastro and import share the rule: an invisible variant never resolves to another product',()=>{
 const w=loadReader([{id:'a',nome:'A',barcode:'7891',ativo:true},{id:'b',nome:'B',barcode:`789${ZW}1`,ativo:true}]);
 for(const scan of ['7891',`7891${ZW}`,`${FW7}891`]){const hit=w.BarcodeIndex.find(scan);assert.equal(hit.barcodeConflict,true,'duplicate canonical EAN must be a conflict, never the first product');}
 assert.throws(()=>w.BarcodeIndex.assertAvailable(`789${BOM}1`,'c'),/duplicados/);
 assert.equal(w.normalizeBarcode(`0${ZW}0123`),'00123');
 const one=loadReader([{id:'a',nome:'A',barcode:`789${ZW}1`,ativo:true},{id:'off',nome:'Off',barcode:'7891',ativo:false}]);
 assert.equal(one.BarcodeIndex.find('7891').id,'a','inactive product does not hijack the scan');
 const variant=loadReader([{id:'p',nome:'P',barcode:'111',ativo:true},{id:'q',nome:'Q',barcode:'7891',ativo:true}],[{id:'v',parentProductId:'p',barcode:`789${ZW}1`,displayName:'V',active:true}]);
 assert.equal(variant.BarcodeIndex.find('7891').barcodeConflict,true);
 const src=fs.readFileSync('js/barcode.js','utf8');assert.equal((src.match(/Código duplicado em mais de um produto/g)||[]).length,3,'stock entry, view and search refuse duplicates like the sale');
});
test('correction preview blocks canonical collisions with active, inactive, variation and alternate codes',()=>{
 const products=[base('t',{codigo:'T',barcode:'TE'}),base('u',{codigo:'U',barcode:`789${ZW}1`,alternateBarcodes:[`55${BOM}5`]}),base('off',{codigo:'OFF',barcode:`77${SHY}7`,ativo:false}),base('p',{codigo:'P',barcode:'PE'})];
 const variants=[{id:'v1',parentProductId:'p',sku:`V${ZW}S`,barcode:`66${NBSP}6`}];
 for(const data of [{barcode:'7891'},{barcode:'555'},{barcode:'777'},{barcode:'666'},{codigo:'VS'},{codigo:'U'}])
  assert.equal(run([{id:'t',...data}],products,variants).rows[0].conflict,true,JSON.stringify(data));
 // A NEW code containing invisible characters is refused (must be retyped)...
 const dirty=run([{id:'t',barcode:`123${ZW}4`}],products);assert.equal(dirty.rows[0].status,'invalid');assert.match(dirty.rows[0].errors[0],/invisíveis/);
 // ...but an existing stored code is never rewritten nor blocked when unchanged.
 assert.equal(run([{id:'u',barcode:`789${ZW}1`}],products).rows[0].status,'unchanged');
 // Two rows whose new codes differ only by invisible chars: the dirty one is refused, so nothing collides silently.
 const pair=run([{id:'t',barcode:'4444'},{id:'p',barcode:`44${ZW}44`}],products);assert.equal(pair.rows[1].status,'invalid');
 assert.equal(run([{id:'t',barcode:'00123'},{id:'p',barcode:'123'}],products).counts.updates,2,'leading zeros make different codes');
});
test('normal import matches and de-duplicates by canonical code; owner names outside the scope are redacted',()=>{
 const products=[base('a',{codigo:'A',barcode:`789${ZW}1`})];
 const p=M.preview([M.columns.map(c=>c[0]),M.columns.map(([,k])=>({barcode:'7891',preco:20})[k]??null)],products,scope,{cost:true,stock:true},'update');
 assert.equal(p.rows[0].id,'a');
 const c=M.preview([M.columns.map(c=>c[0]),M.columns.map(([,k])=>({nome:'Novo',barcode:`78${ZW}91`})[k]??null)],[],scope,{cost:true,stock:true},'create_update');
 assert.equal(c.counts.creates,0,'a new product cannot be created with an invisible-character EAN');
 const narrow={...scope,allSpaces:false};
 const owners=M.identifierOwners('barcode','7891','x',{products:[base('hidden',{nome:'Segredo',barcode:'7891',allowedSpaceIds:['elsewhere']})]},p=>M.inScope(p,narrow,true));
 assert.deepEqual(owners,['um produto de outro espaço']);
});

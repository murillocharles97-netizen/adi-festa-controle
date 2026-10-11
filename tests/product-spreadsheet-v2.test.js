const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../js/product-spreadsheet'),Product=require('../functions/src/shared/product-model');
const scope={businessId:'business',spaceId:'store',allSpaces:true,allowedSpaceIds:['store']},permissions={cost:true,stock:true};
const headers=M.columns.map(c=>c[0]),row=data=>M.columns.map(([,key])=>data[key]??null);
const product={id:'existing',nome:'Existente',codigo:'SKU',barcode:'000123',preco:15,custo:0,estoqueAtual:2,businessId:'business',spaceAccessMode:'single_space',allowedSpaceIds:['store']};
const preview=(rows,mode='create_update',products=[product],overrides={})=>M.preview([headers,...rows.map(row)],products,{...scope,...overrides},permissions,mode);
test('creation opt-in, defaults, Brazilian numbers and no source mutation',()=>{
 const source={nome:'blush baked glow - silent moments',codigo:'NOVO',custo:'8,50',preco:'19.90',estoqueAtual:'2,50'},before=JSON.stringify(source);
 assert.equal(preview([source],'update').counts.creates,0);
 const p=preview([source]);assert.equal(p.counts.creates,1);assert.equal(JSON.stringify(source),before);assert.deepEqual(p.rows[0].create,{nome:source.nome,codigo:'NOVO',barcode:'',categoria:'',custo:8.5,preco:19.9,estoqueAtual:2.5});
 const minimal=preview([{nome:'Novo sem códigos'}]);assert.equal(minimal.counts.creates,1);
 const built=Product.build({...minimal.rows[0].create,spaceAccessMode:'single_space',allowedSpaceIds:['store']});
 assert.equal(built.preco,0);assert.equal(built.custo,0);assert.equal(built.estoqueAtual,0);assert.equal(built.schemaVersion,14);assert.equal(built.productType,'simple');assert.equal(built.controlaEstoque,true);
});
test('ID > SKU > EAN; no unsafe fallbacks, name never updates',()=>{
 assert.equal(preview([{id:'existing',preco:20}]).counts.updates,1);
 assert.equal(preview([{codigo:'SKU',preco:20}]).counts.updates,1);
 assert.equal(preview([{barcode:'000123',preco:20}]).counts.updates,1);
 assert.equal(preview([{id:'foreign',codigo:'SKU',nome:'X'}]).counts.conflicts,1);
 assert.equal(preview([{codigo:'missing',barcode:'000123',nome:'X'}]).counts.conflicts,1);
 assert.equal(preview([{nome:'Existente'}]).counts.creates,1);
 assert.equal(preview([{codigo:'SKU',nome:'X'}],'create_update',[product,{...product,id:'dup'}]).counts.conflicts,1);
});
test('all occurrences of duplicate IDs, SKU, EAN and identifier-free lines rejected',()=>{
 for(const rows of [[{nome:'A',codigo:'NEW'},{nome:'B',codigo:'NEW'}],[{nome:'A',barcode:'123'},{nome:'B',barcode:'123'}],[{nome:'A'},{nome:'A'}],[{id:'existing',preco:20},{codigo:'SKU',preco:20}]]){
  const p=preview(rows);assert.equal(p.counts.conflicts,2);assert.equal(p.counts.creates+p.counts.updates,0);
 }
});
test('mandatory name, valid codes, stock/cost validation and explicit space',()=>{
 for(const data of [{codigo:'NEW'},{nome:'A',codigo:12},{nome:'A',barcode:'12 3'},{nome:'A',codigo:'A\nB'},{nome:'A',estoqueAtual:-1},{nome:'A',estoqueAtual:'1.234'},{nome:'A',preco:{invalid:true}}])assert.equal(preview([data]).counts.errors,1,JSON.stringify(data));
 assert.equal(preview([{nome:'A'}],'create_update',[],{spaceId:'all_spaces'}).counts.errors,1);
 const p=M.preview([headers,row({nome:'A',custo:1}),row({nome:'B',estoqueAtual:1})],[],scope,{},'create_update');assert.equal(p.counts.errors,2);
 const alternate=headers.map(h=>h==='Nome do produto'?'Nome':h==='Estoque atual'?'Estoque inicial':h);
 assert.equal(M.preview([alternate,row({nome:'A',estoqueAtual:3})],[],scope,permissions,'create_update').counts.creates,1);
});
test('variant and alternate identifiers remain protected',()=>{
 assert.equal(preview([{codigo:'SKU',nome:'A'}],'create_update',[{...product,identifierReservation:true}]).counts.conflicts,1);
 assert.equal(preview([{codigo:'SKU',nome:'A'}],'create_update',[{...product,ativo:false}]).counts.conflicts,1);
 assert.equal(preview([{id:'existing',preco:20}],'create_update',[{...product,active:false}]).counts.conflicts,1);
});
test('manual save and import share exactly the same canonical defaults',()=>{
 const data={produtos:[]},box={window:null,DB:{carregar:()=>data,alterar:fn=>fn(data)},Utils:{uuid:()=> 'manual'},normalizeBarcode:v=>String(v||'').trim(),BarcodeIndex:{invalidate(){},assertAvailable(){}}};box.window=box;vm.createContext(box);
 vm.runInContext(fs.readFileSync('functions/src/shared/product-model.js','utf8'),box);vm.runInContext(fs.readFileSync('js/produtos.js','utf8'),box);
 const input={nome:'A',codigo:'001',barcode:'',spaceAccessMode:'single_space',allowedSpaceIds:['store'],defaultSpaceId:'store'};
 const manual=box.Produtos.salvar(input),{id,criadoEm,...body}=JSON.parse(JSON.stringify(manual));
 assert.deepEqual(body,Product.build(input,null,{agora:body.atualizadoEm}));
});

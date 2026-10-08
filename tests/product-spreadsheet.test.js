const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../js/product-spreadsheet'),headers=M.columns.map(c=>c[0]);
const scope={businessId:'a',spaceId:'loja',allSpaces:true,allowedSpaceIds:['loja','outro']},permissions={cost:true,stock:true,edit:true};
const products=[{id:'one',businessId:'a',codigo:'001',barcode:'000123',nome:'Produto X',categoria:'Doces',custo:0,preco:15,estoqueAtual:5,spaceAccessMode:'single_space',allowedSpaceIds:['loja']},
 {id:'other',businessId:'a',codigo:'002',nome:'Produto X',preco:10,spaceAccessMode:'single_space',allowedSpaceIds:['outro']},
 {id:'foreign',businessId:'b',nome:'Produto X',codigo:'003'},
 {id:'var',businessId:'a',productType:'variable',nome:'Variável',preco:10,minPrice:10,totalStock:7}];
const row=(patch={})=>M.columns.map(([,k])=>patch[k]??null);
const preview=rows=>M.preview([headers,...rows],products,scope,permissions);
test('ID match and Brazilian/decimal numbers; preview never mutates source and empty cells preserve values',()=>{
 const before=JSON.stringify(products),p=preview([row({id:'one',custo:'8,50',preco:'19.90',nome:'',estoqueAtual:0})]);
 assert.equal(p.counts.updates,1);assert.deepEqual(p.rows[0].changes,{custo:8.5,preco:19.9,estoqueAtual:0});assert.equal(JSON.stringify(products),before);
 assert.equal(M.number('R$ 1.234,50'),1234.5);
 for(const value of ['1.234','NaN',true,'-1','10abc','1e3','1,2.3',Infinity])assert.throws(()=>M.number(value));
});
test('never fallback from foreign/unknown ID, never match name, other space/business excluded',()=>{
 const p=preview([row({id:'other',preco:99}),row({id:'foreign',preco:99}),row({id:'missing',codigo:'001',preco:99}),row({nome:'Produto X',preco:99})]);
 assert.equal(p.counts.notFound,3);assert.equal(p.counts.invalid,1);assert.equal(p.counts.updates,0);
});
test('unique SKU/EAN works; conflicting and ambiguous keys do not',()=>{
 assert.equal(preview([row({codigo:'001',preco:20})]).counts.updates,1);
 assert.equal(preview([row({barcode:'000123',custo:1})]).counts.updates,1);
 assert.equal(preview([row({codigo:'001',barcode:'missing',preco:20})]).counts.invalid,1);
 const p=M.preview([headers,row({codigo:'001',preco:20})],[...products,{...products[0],id:'duplicate'}],scope,permissions);
 assert.equal(p.counts.invalid,1);
});
test('all duplicate target rows blocked, including different match keys',()=>{
 const p=preview([row({id:'one',preco:20}),row({codigo:'001',preco:30})]);
 assert.equal(p.counts.invalid,2);assert.equal(p.counts.updates,0);
 assert.equal(preview([row({id:'missing'}),row({id:'missing'})]).counts.invalid,2);
});
test('all-spaces export of restricted staff excludes inaccessible spaces and deleted records',()=>{
 const limited={...scope,spaceId:'all_spaces',allSpaces:false,allowedSpaceIds:['loja']};
 assert.deepEqual(products.filter(p=>M.inScope(p,limited)).map(p=>p.id),['one','var']);
 assert.equal(M.inScope({...products[0],deleted:true},scope),false);
 assert.equal(M.inScope({...products[0],active:false},scope),false);
});
test('formula/errors, numeric identifiers, protected codes and invalid numeric fields rejected',()=>{
 for(const change of [{id:1},{codigo:1},{id:'one',preco:{invalid:true}},{id:'one',custo:-1},{id:'one',barcode:'different'}])assert.equal(preview([row(change)]).counts.invalid,1);
 assert.throws(()=>M.preview([['ID VECONI'],['one']],products,scope,permissions));
});
test('cost/stock permissions and variable aggregates preserved',()=>{
 for(const field of ['custo','estoqueAtual'])assert.equal(M.preview([headers,row({id:'one',[field]:9})],products,scope,{}).counts.invalid,1);
 assert.equal(preview([row({id:'var',preco:11})]).counts.invalid,1);
 assert.equal(preview([row({id:'var',nome:'Novo nome'})]).counts.updates,1);
 assert.equal(preview([row({id:'var',preco:10,estoqueAtual:7})]).counts.unchanged,1);
});
test('10k row validation is bounded and counts empty vs unchanged rows correctly',()=>{
 const p=preview([[],row({id:'one',preco:15})]);assert.equal(p.counts.total,1);assert.equal(p.counts.unchanged,1);
 assert.throws(()=>preview(Array.from({length:10001},()=>[])));
});
test('actual XLSX worker roundtrip keeps identifiers as text, context, numeric cells; formulas rejected',()=>{
 let result;const X=require('../assets/xlsx-0.20.3.full.min.js');
 const ctx={XLSX:X,importScripts:()=>{},Uint8Array,self:{postMessage:value=>result=value}};
 vm.runInNewContext(fs.readFileSync('js/product-spreadsheet-worker.js','utf8'),ctx);
 const table=[headers,row({id:'one',codigo:'001',barcode:'000123',nome:'=not-a-formula',custo:8.5,preco:19.9,estoqueAtual:5})];
 ctx.self.onmessage({data:{action:'export',table,context:scope}});assert.ok(result.bytes);
 ctx.self.onmessage({data:{action:'import',bytes:result.bytes}});assert.equal(result.table[1][1],'001');assert.equal(result.table[1][2],'000123');assert.equal(result.table[1][5],8.5);assert.equal(result.context[1],'a');
 const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet(table);ws.G2={f:'1+1',t:'n',v:2};X.utils.book_append_sheet(wb,ws,'Produtos');
 ctx.self.onmessage({data:{action:'import',bytes:X.write(wb,{type:'array',bookType:'xlsx'})}});
 assert.equal(result.table[1][6].invalid,true);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const audit=require('../js/integrity.js'),source=fs.readFileSync('js/firebase/sync.js','utf8');
function runtime(){
 const c={window:{IntegrityAudit:audit},Date,Map,Set,WeakSet,JSON,Number,String,Boolean,Object,Math,sanitizeForFirestore:x=>x,activeBusinessId:()=> 'adi-festa',FINANCIAL_AUDIT_NAMES:new Set(['sales','payments','balanceAdjustments']),newestTimestamp:()=>''};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const stableComparable ='),source.indexOf('async function indexedDbInventory()')),c);return c;
}
const base=(id='s')=>({id,operationId:id,valorFinal:14,status:'fiado',data:'2026-09-29T12:00:00.000Z',itens:[]});
test('same function normalizes Timestamp/Date/ISO, missing/undefined, order and runtime metadata',()=>{
 const a={id:'s',data:new Date('2026-09-29T12:00:00Z'),valorFinal:'14',itens:[],cacheMetadata:{seen:1},origin:'local',unused:undefined},b={itens:[],valorFinal:14,data:{toDate:()=>new Date('2026-09-29T12:00:00Z')},id:'s',origin:'remote'};
 assert.equal(audit.compare('sales',a,b).equal,true);
 assert.equal(audit.compare('sales',{...a,valorFinal:15},b).equal,false);
 assert.equal(audit.compare('sales',{...a,extra:null},b).equal,false,'unknown null is not arbitrarily erased');
});
test('arrays retain business order; explicit allowed-space sets are unordered',()=>{
 assert.equal(audit.compare('sales',{...base(),itens:[{id:1},{id:2}]},{...base(),itens:[{id:2},{id:1}]}).equal,false);
 assert.equal(audit.compare('custom',{allowedSpaceIds:['b','a']},{allowedSpaceIds:['a','b']}).equal,true);
});
test('protected financial enrichment is compared, never discarded',()=>{
 const remote={...base(),itens:[{produtoId:'p',quantidade:1}]},fin={custoTotal:4,lucro:10,itemCosts:[{index:0,custoUnitario:4,custoTotal:4,lucro:10}]},local={...remote,custoTotal:4,lucro:10,itens:[{...remote.itens[0],custoUnitario:4,costSnapshot:4,custoTotal:4,lucro:10}]};
 assert.equal(audit.compare('sales',local,remote,{remoteFinancial:fin}).equal,true);
 assert.equal(audit.compare('sales',{...local,custoTotal:99},remote,{remoteFinancial:fin}).equal,false);
 assert.equal(audit.compare('sales',local,remote).equal,false,'missing protected projection cannot hide actual cost');
});
test('client defaults are semantic, nondefault consent and authoritative token conflicts are actionable',()=>{
 const remote={id:'c',saldo:-20},local={...remote,apelido:'',financialVersion:0,marketingConsent:false,portalRefToken:'local-generated'};
 assert.equal(audit.compare('clients',local,remote).equal,true);
 assert.equal(audit.compare('clients',{...local,marketingConsent:true},remote).equal,false);
 assert.deepEqual(audit.compare('clients',local,{...remote,portalRefToken:'server-token'}).fields,['portalRefToken']);
});
test('sparse legacy documents compare against documented memory defaults without masking filled values',()=>{
 const client={id:'c',saldo:-10},product={id:'p',preco:14,estoqueAtual:3};
 assert.equal(audit.compare('clients',{...client,email:'',endereco:'',totalComprado:0,quantidadeVendas:0,ultimaCompra:null},client).equal,true);
 assert.equal(audit.compare('clients',{...client,totalComprado:10},client).equal,false);
 assert.equal(audit.compare('products',{...product,estoque:3,codigo:'',categoria:'',favorito:false,imageUrl:null,imagem:''},product).equal,true);
 assert.equal(audit.compare('products',{...product,estoque:99},product).equal,false);
 assert.equal(audit.compare('products',{...product,imageUrl:'different-image'},product).equal,false);
});
test('remote tombstone absent locally is historical, inactive-only is not deleted',()=>{
 const c=runtime(),result=c.classifyCollectionAudit('sales',[],[{...base(),active:false,deletedAt:'2026-09-29T12:00:00Z'}],[]);
 assert.equal(result.onlyRemote.length,0);assert.equal(result.historicalTombstones.length,1);
 assert.equal(audit.severity({sales:result}).level,'INFORMATIVO');
 assert.equal(c.classifyCollectionAudit('sales',[],[{...base(),active:false}],[]).onlyRemote.length,1);
});
test('real local sale with missing queue is critical',()=>{
 const c=runtime(),result=c.classifyCollectionAudit('sales',[base()],[],[]);
 assert.equal(audit.severity({sales:result}).level,'CRITICO');
});
test('ledger discrepancy is critical; missing already-applied effect is informative',()=>{
 assert.equal(audit.severity({}, {divergent:[{clientId:'real',difference:25}]}).level,'CRITICO');
 const before={effectBackfills:[{clientId:'real',balanceAlreadyApplied:true,difference:0}]},snapshot=JSON.stringify(before);
 assert.equal(audit.severity({},before).level,'INFORMATIVO');assert.equal(JSON.stringify(before),snapshot);
});
test('338 protected sales remain semantically equal without rewriting either side',()=>{
 const c=runtime(),local=[],remote=[],fin=new Map();
 for(let n=0;n<338;n++){const id=String(n);remote.push(base(id));local.push({...base(id),custoTotal:4,lucro:10});fin.set(id,{custoTotal:4,lucro:10});}
 const snapshot=JSON.stringify({local,remote});const result=c.classifyCollectionAudit('sales',local,remote,[],{remoteFinancial:fin});
 assert.equal(result.equal.length,338);assert.equal(result.divergent.length,0);assert.equal(JSON.stringify({local,remote}),snapshot);
});
test('balance contributions preserve zero/absent and attribute only fixture debt',()=>{
 const rows=audit.balanceContributions([{id:'c1',saldo:-36,ativo:true},{id:'c2',saldo:0},{id:'real',saldo:-7866.5}],[{id:'real',saldo:-7866.5},{id:'old',saldo:0,deletedAt:'date'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].clientId,'c1');assert.equal(rows[0].difference,-36);assert.equal(rows[0].remoteBalance,null);
});
test('production has no demo generator or restore entry point',()=>{
 const storage=fs.readFileSync('js/storage.js','utf8');assert.doesNotMatch(storage,/const exemplo=|produtoDemo\(/);assert.match(storage,/const restaurar=\(\)=>\{throw Error/);
});
test('fixture cleanup requires exact content proof, namespace, fresh absence and no business reference/queue',()=>{
 const client={id:'c1',nome:'Mariana Silva',saldo:-36,criadoEm:'2026-09-24T10:34:12.474Z'},hash=()=> 'fnv1a:ef817bd8',data={clientes:[client],produtos:[],vendas:[],messageSequences:[{clientIds:['c1'],status:'active'}]};
 assert.equal(audit.fixtureCleanupPlan(data,{clients:[]},[],hash,'adi-festa').rows.length,1);
 assert.equal(audit.fixtureCleanupPlan(data,{},[],hash,'adi-festa').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan(data,{clients:[client]},[],hash,'adi-festa').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan(data,{clients:[]},[],hash,'other-business').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan({...data,vendas:[{clienteId:'c1'}]},{clients:[]},[],hash,'adi-festa').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan(data,{clients:[]},[{payload:{entityId:'c1'}}],hash,'adi-festa').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan(data,{clients:[]},[],()=> 'changed','adi-festa').rows.length,0);
 assert.equal(audit.fixtureCleanupPlan({...data,clientes:[{...client,nome:'Real customer'}]},{clients:[]},[],hash,'adi-festa').rows.length,0);
 assert.equal(data.messageSequences.length,1,'historical selections untouched');
});
test('cleanup original records and removals share flush, never cloud delete capture',()=>{
 const section=source.slice(source.indexOf('async function cleanupConfirmedLegacyFixtures('),source.indexOf('async function compareLocalAndCloud('));
 assert.match(section,/localFixtureQuarantine\.push/);assert.match(section,/originalAlter\(data/);assert.match(section,/await DB\.flush/);assert.doesNotMatch(section,/queueWrites|DB\.alterar|deleteDoc/);
});
test('preflight prevents even a modified fixture or partial queued write from reaching Firestore',()=>{
 const c={window:{IntegrityAudit:audit,DB:{carregar:()=>({clientes:[{id:'c1',criadoEm:'2026-09-24T10:34:12.474Z',nome:'Mariana Silva',saldo:-360}]})}},SOURCES:{clients:{key:'clientes'}},CLOUD_NAMES:['clients'],activeBusinessId:()=> 'adi-festa',currentUser:{uid:'owner'}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const queuePreflight ='),source.indexOf('const readPullState ='))+'\nthis.preflight=queuePreflight;',c);
 c.window.DB.getWorkspaceGeneration=()=>0;
 const result=c.preflight({businessId:'adi-festa',userId:'owner',operationId:'operation',payload:{writes:[{entityType:'clients',entityId:'c1',operation:'update',data:{saldo:-360}}]}});
 assert.equal(result.ok,false);assert.equal(result.code,'legacy-fixture-upload-blocked');
});

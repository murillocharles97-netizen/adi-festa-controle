const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const crmSource=fs.readFileSync('js/crm.js','utf8');
const uiSource=fs.readFileSync('js/crm-ui.js','utf8');
const storageSource=fs.readFileSync('js/storage.js','utf8');
const backupSource=fs.readFileSync('js/backup.js','utf8');
const syncSource=fs.readFileSync('js/firebase/sync.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

assert.doesNotMatch(crmSource,/getDocs|onSnapshot|collection\(/,'CRM deve calcular indicadores localmente');
assert.match(uiSource,/Registrar contato/);
assert.match(uiSource,/Linha do tempo/);
assert.match(uiSource,/timeline\.slice\(0,10\)/,'perfil deve renderizar somente 10 eventos inicialmente');
assert.match(uiSource,/profile\.timeline\.length>10/,'perfil deve oferecer carregamento incremental');
assert.match(index,/js\/crm\.js/);
assert.match(index,/js\/crm-ui\.js/);
assert.match(index,/css\/crm\.css/);
assert.match(storageSource,/contatosCliente/);
assert.match(backupSource,/contatosCliente/);
assert.match(syncSource,/clientContacts\s*:\s*\{\s*key\s*:\s*["']contatosCliente["']/);
assert.match(rules,/'clientContacts'/);
assert.match(worker,/adi-festa-v64-sync-reconciliation/);

const data={
  clientes:[{id:'c1',nome:'Cliente Teste',telefone:'17999999999',email:'cliente@teste.com',saldo:-25,totalComprado:999,quantidadeVendas:99,ativo:true,criadoEm:'2026-01-01T10:00:00.000Z'}],
  produtos:[{id:'p1',nome:'Cone',categoria:'Doces'},{id:'p2',nome:'Água',categoria:'Bebidas'}],
  vendas:[
    {id:'v1',clienteId:'c1',valorFinal:40,status:'pago',formaPagamento:'pix',data:'2026-01-10T12:00:00.000Z',itens:[{produtoId:'p1',nome:'Cone',quantidade:2,subtotalFinal:40}]},
    {id:'v2',clienteId:'c1',valorFinal:60,status:'fiado',formaPagamento:'fiado',data:'2026-02-10T13:00:00.000Z',itens:[{produtoId:'p1',nome:'Cone',quantidade:1,subtotalFinal:20},{produtoId:'p2',nome:'Água',quantidade:4,subtotalFinal:40}]}
  ],
  pagamentos:[{id:'pg1',clienteId:'c1',valor:20,data:'2026-02-15T14:00:00.000Z'}],
  movimentacoes:[{id:'m1',clienteId:'c1',tipo:'ajuste_saldo',saldoNovo:-25,motivo:'Conferência',data:'2026-02-16T10:00:00.000Z'}],
  messageHistory:[{id:'msg1',clientId:'c1',type:'charge',status:'opened_whatsapp',amountAtSend:25,finalMessage:'Lembrete',openedWhatsAppAt:'2026-02-17T10:00:00.000Z'}],
  catalogOrders:[{id:'o1',clientId:'c1',publicOrderNumber:'123',total:40,orderStatus:'entregue',createdAt:'2026-01-10T11:00:00.000Z'}],
  campanhas:[{id:'ca1',name:'Compre e ganhe'}],
  progressosCampanha:[{id:'pr1',clientId:'c1',campaignId:'ca1',points:20,availableRewards:1,createdAt:'2026-01-10T12:05:00.000Z'}],
  recompensas:[{id:'r1',clientId:'c1',campaignId:'ca1',type:'campaign_redemption',createdAt:'2026-02-18T10:00:00.000Z'}],
  contatosCliente:[]
};
const listeners={};
const context={console,Date,Map,Set,Math,Number,String,Array,Object,JSON,structuredClone,crypto,window:null,DB:{carregar:()=>data,getBusinessId:()=>'biz_test',alterar:fn=>{fn(data);return data}},Utils:{uuid:()=>`id-${Math.random()}`},Mensagens:{latestCharge:()=>({date:'2026-02-17T10:00:00.000Z'})},FirebaseSession:{user:{uid:'u1'}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},addEventListener:(name,callback)=>{listeners[name]=callback},dispatchEvent:event=>listeners[event.type]?.(event)};
context.window=context;
vm.createContext(context);
vm.runInContext(crmSource,context);

const profile=context.CRMCliente.build('c1');
assert.equal(profile.metrics.totalSpent,100);
assert.equal(profile.metrics.purchaseCount,2);
assert.equal(profile.metrics.averageTicket,50);
assert.equal(profile.metrics.largestPurchase,60);
assert.equal(profile.metrics.openBalance,25);
assert.equal(profile.metrics.topProduct,'Água');
assert.equal(profile.metrics.favoriteCategory,'Bebidas');
assert.equal(profile.campaigns.participations,1);
assert.equal(profile.campaigns.redemptions,1);
assert.ok(profile.timeline.some(item=>item.type==='credit_sale'));
assert.ok(profile.timeline.some(item=>item.type==='payment'));
assert.ok(profile.timeline.some(item=>item.type==='charge'));
assert.ok(profile.timeline.some(item=>item.type==='online_order'));

const cached=context.CRMCliente.build('c1');
assert.strictEqual(cached,profile,'perfil deve reutilizar cache quando os dados não mudam');
const contact=context.CRMCliente.registerContact('c1',{tipo:'whatsapp',resumo:'Cliente pediu orçamento.'});
assert.equal(contact.tipo,'whatsapp');
assert.equal(data.contatosCliente.length,1);
const refreshed=context.CRMCliente.build('c1');
assert.notStrictEqual(refreshed,profile,'novo contato deve invalidar cache');
assert.ok(refreshed.timeline.some(item=>item.type==='contact'));
assert.equal(refreshed.metrics.lastContact,contact.data);

console.log('crm.test.js: OK');

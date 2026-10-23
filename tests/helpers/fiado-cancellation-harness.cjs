'use strict';
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<a)throw Error(start);return source.slice(a,b);};
function bridge(x){if(x instanceof Date)return x;if(Array.isArray(x))return Array.from(x,bridge);if(x&&Object.prototype.toString.call(x)==='[object Object]'&&!x._methodName&&typeof x.toDate!=='function')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,bridge(v)]));return x;}
function harness({businessId='qa-fiado',spaceId='qa-space',uid='owner',sdk=null,database=null,sanitize=x=>x}={}){
 let data={config:{},clientes:[{id:'qa-client',businessId,nome:'QA',saldo:-12,financialVersion:12,totalComprado:12,quantidadeVendas:1}],produtos:[{id:'qa-product',businessId,ownerId:uid,nome:'QA',preco:14,estoqueAtual:3,estoque:3,totalStock:3,spaceAccessMode:'single_space',allowedSpaceIds:[spaceId],defaultSpaceId:spaceId,active:true,ativo:true,schemaVersion:3}],variacoesProdutos:[],vendas:[],pagamentos:[],alocacoesPagamento:[],movimentacoes:[],movimentacoesEstoque:[]};
 const origin={uid,businessId,workspaceGeneration:0};
 const c={console,Date,structuredClone,Map,Set,TextEncoder,crypto,Utils:{uuid:crypto.randomUUID},db:database,currentUser:{uid},auth:{currentUser:{uid}},syncSessionGeneration:1,readOnlyMode:false,navigator:{onLine:true},activeBusinessId:()=>businessId,stableLegacyOperationId:p=>p.operationId,queuePreflight:()=>({ok:true}),now:()=>new Date().toISOString(),deviceId:()=> 'qa-device',normalizeText:x=>String(x||'').toLowerCase(),sanitizeForFirestore:x=>sanitize(bridge(x)),IDEMPOTENT_EVENT_NAMES:new Set(['sales','stockMovements','payments','balanceAdjustments']),SOURCES:{clients:{key:'clientes'},products:{key:'produtos'},productVariants:{key:'variacoesProdutos'},sales:{key:'vendas'},stockMovements:{key:'movimentacoesEstoque'},payments:{key:'pagamentos'}},sourceItems:(d,n)=>d[c.SOURCES[n].key]||[],WorkspaceRuntime:{capture:()=>origin},TeamAccess:{has:()=>true,actor:()=>({actorUid:uid,actorRoleSnapshot:'owner'})},SpaceContext:{requireSalesSpace:id=>id||spaceId,stockMovementOrigin:()=>({businessId,spaceId})},Campanhas:{aplicarVendaNoBanco:()=>[],reverterVendaNoBanco(){}},CustomerSubscriptions:{applySaleInData:()=>[]},errorCode:e=>e.code||'unknown'};
 c.DB={getBusinessId:()=>businessId,getWorkspaceGeneration:()=>0,carregar:()=>data,alterar:fn=>{const next=structuredClone(data);fn(next);data=next;return data;},flush:async()=>{}};
 c.Produtos={obter:id=>data.produtos.find(p=>p.id===id)};c.window=c;vm.createContext(c);
 for(const file of ['js/product-variations.js','js/vendas.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c,{filename:file});
 vm.runInContext(section('const roundedMoney =','const readSignalVersions'),c);
 vm.runInContext(section('function changedFields(','function captureChanges('),c);
 vm.runInContext(section('async function confirmSaleUndo(','function cleanCloudItem('),c);
 if(sdk){
  Object.assign(c,{doc:sdk.doc,deleteField:sdk.deleteField,serverTimestamp:sdk.serverTimestamp,increment:sdk.increment,getDocFromServer:sdk.getDocFromServer});
  const vmSdk={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,t=>fn({get:r=>t.get(r),set:(r,d,o)=>t.set(r,bridge(d),o),update:(r,d)=>t.update(r,bridge(d)),delete:r=>t.delete(r)}))};
  c.runTransaction=require('../../js/workspace-writer.js').create({sdk:vmSdk,runtime:()=>c.WorkspaceRuntime}).runTransaction;
  vm.runInContext(fs.readFileSync('js/firebase/product-import-fence.js','utf8').replace('export ',''),c);
  vm.runInContext(section('function enrich(','function archiveQueue('),c);
  vm.runInContext(section('async function commitQueueItem(','async function verifySaleQueueCommit('),c);
 }
 function packet(before,operationId,eventKind){return{operationId,businessId,userId:uid,payloadVersion:4,payload:{eventKind,writes:bridge(c.diffWrites(before,data))}};}
 function sell({status='fiado',formaPagamento=status==='fiado'?'fiado':'dinheiro',id=crypto.randomUUID()}={}){const before=structuredClone(data);const sale=c.Vendas.registrar({id,operationId:crypto.randomUUID(),businessId,spaceId,clienteId:'qa-client',status,formaPagamento,itens:[{produtoId:'qa-product',nome:'QA',quantidade:1,precoOriginal:14,precoFinalUnitario:14}]});return{sale,packet:packet(before,sale.operationId,'sale')};}
 function undo(saleId){const before=structuredClone(data);const removed=c.Vendas.desfazerUltima({saleId});const operationId=data.movimentacoes.find(m=>m.tipo==='venda_desfeita'&&m.vendaId===removed.id).operationId;return{removed,packet:packet(before,operationId,'sale_undo')};}
 return{c,data:()=>data,sell,undo,replace:next=>{data=bridge(next);},commit:p=>c.commitQueueItem(structuredClone(p))};
}
module.exports={harness,section,bridge};

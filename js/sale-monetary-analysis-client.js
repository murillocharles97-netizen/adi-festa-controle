(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SaleMonetaryAnalysisClient=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const KIND='monetary_analysis_v1',canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(JSON.parse(JSON.stringify(value))));
 const same=(a,b)=>canonical(a)===canonical(b),copy=v=>structuredClone(v);
 function validatePacket(p,i,targets){const t=targets.find(t=>t.operationId===p?.operationId);if(!t)return null;
  if(p.businessId!==i.businessId||p.userId!==i.uid||(p.workspaceGeneration??0)!==i.workspaceGeneration||p.status!=='error'||p.lastErrorCode!=='invalid-argument'||p.lastErrorMessage!=='Total não corresponde aos itens.'||p.payloadVersion!==4)throw Error('A evidência local diverge da sessão ou do erro original. Nada foi alterado.');
  const sales=p.payload?.writes?.filter(w=>w.entityType==='sales'&&w.operation==='create');if(sales?.length!==1||sales[0].entityId!==t.saleId||sales[0].data?.operationId!==t.operationId||sales[0].data?.spaceId!==t.spaceId||sales[0].data?.businessId!==i.businessId||sales[0].data?.actorUid!==i.uid)throw Error('Os identificadores ou o espaço do pacote original divergem.');return t;
 }
 async function readSources(w,i,targets,assertCurrent){
  if(w.DB?.getBusinessId?.()!==i.businessId||w.FirebaseSession?.user?.uid!==i.uid||w.DB?.getWorkspaceGeneration?.()!==i.workspaceGeneration||w.DB?.businessCache?.ready?.()!==true)throw Error('A sessão ainda não está pronta para a leitura segura. Seus dados continuam preservados.');
  if(w.DB.businessCache.pending?.())throw Error('Há uma gravação local em andamento. Aguarde e tente enviar somente as evidências novamente.');
  const epoch=await w.DB.localRecords.read('workspace-generation:'+i.businessId);assertCurrent();if((epoch?.workspaceGeneration??0)!==i.workspaceGeneration||epoch?.cleanupPending===true)throw Error('A geração do armazenamento mudou. Nenhum dado antigo foi enviado.');
  const prefix=`business-cache:v156:adiFestaDB_v1:${i.businessId}:${i.uid}:`,ids=new Set(targets.map(t=>t.saleId)),movements=new Set(targets.flatMap(t=>t.movementIds||[])),sources=new Map();
  const signature=scope=>{if(!scope?.startsWith(prefix))return null;const m=scope.slice(prefix.length).match(/^([a-z0-9_-]+)(?::generation:(\d+))?(?::preserved:[a-z0-9-]+)?$/i);return m&&Number(m[2]||0)===i.workspaceGeneration?m[1]:null;};
  const qkey=s=>`adiFesta:${i.businessId}:${i.uid}:${s}${i.workspaceGeneration>0?':generation:'+i.workspaceGeneration:''}:syncQueue`;
  const source=scope=>{if(!sources.has(scope))sources.set(scope,{packets:[],sales:[],movements:[]});return sources.get(scope);};
  await w.DB.localRecords.transaction('readonly',(store,done,fail)=>{let count=0;const request=store.index('scope').openKeyCursor(w.IDBKeyRange.bound(prefix,prefix+'\uffff'));
   request.onerror=()=>fail(Error('Não foi possível ler o armazenamento original. Nada foi apagado.'));
   request.onsuccess=()=>{try{assertCurrent();const cursor=request.result;if(!cursor){done(true);return;}if(++count>100000)throw Error('Limite seguro de leitura excedido.');const s=signature(cursor.key);let key;try{key=JSON.parse(cursor.primaryKey);}catch{cursor.continue();return;}
    if(s&&key[0]===cursor.key&&(key[1]==='sync'&&key[2]===qkey(s)||key[1]==='data'&&(key[2]==='vendas'&&ids.has(key[3])||key[2]==='movimentacoesEstoque'&&movements.has(key[3])))){
     const r=store.get(cursor.primaryKey);r.onerror=()=>fail(Error('Não foi possível ler um registro preservado.'));r.onsuccess=()=>{try{assertCurrent();const row=r.result;if(!row)return;const group=source(row.scope);if(row.area==='sync'){if(row.kind==='item'&&validatePacket(row.value,i,targets))group.packets.push(copy(row.value));else if(row.kind==='value'&&Array.isArray(row.value))for(const p of row.value)if(validatePacket(p,i,targets))group.packets.push(copy(p));}else if(row.kind==='item'){if(row.field==='vendas')group.sales.push(copy(row.value));else group.movements.push(copy(row.value));}}catch(e){fail(e);}};
    }cursor.continue();}catch(e){fail(e);}};
  });
  // Native Storage only. The compatibility getter can stage a lazy migration.
  const native=w.localStorage,np=`adiFesta:${i.businessId}:${i.uid}:`;
  for(let n=0;n<native.length;n++){const key=native.key(n);if(!key?.startsWith(np)||!key.endsWith(':syncQueue'))continue;const scope='business-cache:v156:adiFestaDB_v1:'+key.slice('adiFesta:'.length,-':syncQueue'.length);if(!signature(scope))continue;let p;try{p=JSON.parse(native.getItem(key));}catch{throw Error('Uma cópia da fila está ilegível. Nenhum dado foi alterado.');}if(!Array.isArray(p))throw Error('Uma cópia da fila precisa de revisão.');for(const packet of p)if(validatePacket(packet,i,targets))source(scope).packets.push(copy(packet));}
  assertCurrent();return[...sources.values()];
 }
 async function prepare(sources,identity,targets,cryptoApi,checksum){const result=[];
  for(const t of targets){const found=[];for(const s of sources)for(const p of s.packets||[])if(p.operationId===t.operationId){validatePacket(p,identity,targets);const locals=(s.sales||[]).filter(x=>x.id===t.saleId),moves=(s.movements||[]).filter(x=>x.operationId===t.operationId||x.vendaId===t.saleId);found.push({packet:p,localSale:locals[0]||null,localMovements:moves});}
   if(!found.length){result.push({target:t,missing:true});continue;}
   const base=found[0];for(const other of found.slice(1)){if(!same(base.packet,other.packet))throw Error('Há cópias diferentes de uma operação. Os originais foram preservados; nenhum envio foi iniciado.');if(!base.localSale)base.localSale=other.localSale;else if(other.localSale&&!same(base.localSale,other.localSale))throw Error('Há snapshots diferentes da venda. Solicite conferência sem reprocessar.');if(!base.localMovements.length)base.localMovements=other.localMovements;else if(other.localMovements.length&&!same(base.localMovements,other.localMovements))throw Error('Há movimentos locais divergentes para a mesma venda.');}
   if(typeof checksum==='function'&&t.expectedDiagnosticChecksum&&checksum(base.packet.payload)!==t.expectedDiagnosticChecksum)throw Error('O conteúdo difere do diagnóstico preservado. Nenhum pacote foi substituído.');
   const originalJson=canonical(base);if(new TextEncoder().encode(originalJson).length>500*1024)throw Error('O pacote ultrapassa o limite seguro. Nenhum dado foi alterado.');const digest=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(originalJson)),contentHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   result.push({target:t,missing:false,data:{intakeKind:KIND,schemaVersion:1,confirmation:'ENVIAR_PARA_ANALISE',businessId:identity.businessId,workspaceGeneration:identity.workspaceGeneration,originalJson,contentHash}});
  }return result;
 }
 function verifyReceipt(r,t,i,hash){if(!r||r.kind!==KIND||r.schemaVersion!==1||r.businessId!==i.businessId||r.actorUid!==i.uid||r.saleId!==t.saleId||r.operationId!==t.operationId||r.spaceId!==t.spaceId||r.workspaceGeneration!==i.workspaceGeneration||r.contentHash!==hash||r.status!=='analysis_received'||r.commercialEffectsApplied!==false)throw Error('Não foi possível confirmar o recebimento individual desta evidência.');return r;}
 function create({identity,snapshot,call,cryptoApi=globalThis.crypto,checksum,onProgress=()=>{}}){let flight=null,sealed=null,sealedKey='';
  const assertCurrent=i=>{if(!same(identity(),i))throw Error('A sessão ou o espaço mudou. As evidências e filas originais continuam preservadas.');};
  async function read(i){assertCurrent(i);const response=await call('listSaleRecoveryReviews',{intakeKind:KIND,businessId:i.businessId,workspaceGeneration:i.workspaceGeneration,spaceId:i.spaceId||null}),r=response.data??response;assertCurrent(i);if(r.kind!==KIND||r.schemaVersion!==1||!Array.isArray(r.targets)||!Array.isArray(r.items))throw Error('Consulta de recebimento incompleta.');return r;}
  function send({confirmed=false}={}){if(!confirmed)return Promise.reject(Error('Confirme o envio para análise.'));if(flight)return flight;
   flight=(async()=>{const i=copy(identity());if(!i?.uid||!i.businessId||i.role!=='owner')throw Error('Entre na sessão legítima do gestor desta empresa.');const status=await read(i);if(!status.eligible)throw Error('Não há ocorrências autorizadas para análise nesta sessão/espaço.');const key=canonical(i),results=[];
    const remaining=status.targets.filter(t=>{const r=status.items.find(r=>r.saleId===t.saleId&&r.operationId===t.operationId);if(r){verifyReceipt(r,t,i,r.contentHash);results.push({saleId:t.saleId,status:'already_received',contentHash:r.contentHash});return false;}return true;});
    if(remaining.length&&!status.intakeEnabled)throw Error('Novos envios estão pausados. As evidências recebidas continuam preservadas.');
    if(!sealed||sealedKey!==key){const sources=remaining.length?await snapshot(i,remaining,()=>assertCurrent(i)):[];assertCurrent(i);sealed=await prepare(sources,i,remaining,cryptoApi,checksum);sealedKey=key;assertCurrent(i);}
    for(const entry of sealed.filter(e=>remaining.some(t=>t.operationId===e.target.operationId))){assertCurrent(i);if(entry.missing){results.push({saleId:entry.target.saleId,status:'not_on_this_device'});continue;}
     try{const response=await call('submitSaleRecovery',entry.data),r=response.data??response;assertCurrent(i);verifyReceipt(r,entry.target,i,entry.data.contentHash);const check=await read(i),remote=check.items.find(x=>x.saleId===entry.target.saleId&&x.operationId===entry.target.operationId);verifyReceipt(remote,entry.target,i,entry.data.contentHash);results.push({saleId:entry.target.saleId,status:r.duplicate?'already_received':'received',contentHash:r.contentHash});onProgress(copy(results));}
     catch(error){assertCurrent(i);results.push({saleId:entry.target.saleId,status:'receipt_unconfirmed',errorCode:String(error.code||'unknown').replace(/^functions\//,'')});onProgress(copy(results));}
    }
    assertCurrent(i);return{items:results,received:results.filter(r=>['received','already_received'].includes(r.status)).length,missing:results.filter(r=>r.status==='not_on_this_device').length,unconfirmed:results.filter(r=>r.status==='receipt_unconfirmed').length,commercialEffectsApplied:false};
   })().finally(()=>{flight=null;});return flight;
  }
  return{send,status:async()=>read(copy(identity())),invalidate:()=>{sealed=null;sealedKey='';}};
 }
 return Object.freeze({KIND,canonical,readSources,prepare,verifyReceipt,create});
});

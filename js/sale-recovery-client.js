(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SaleRecoveryClient=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const canonical=value=>{
    const plain=JSON.parse(JSON.stringify(value));
    const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
    return JSON.stringify(sort(plain));
  };
  const held=p=>['permission-denied','sale-recovery-review-required'].includes(p.lastErrorCode)&&(p.payload?.writes||[]).some(w=>w.entityType==='sales'&&w.operation==='create');
  function eligible(packets,identity){
    return packets.filter(p=>held(p)&&p.businessId===identity.businessId&&p.userId===identity.uid&&(p.workspaceGeneration??0)===identity.workspaceGeneration);
  }
  function entries(snapshot){
    const found=new Map(),identity=snapshot.identity;
    const dependencies=new Map();
    for(const source of snapshot.sources||[{packets:snapshot.packets}])for(const p of source.packets||[]){
      const writes=p.payload?.writes||[];
      if(p.businessId!==identity.businessId||p.userId!==identity.uid||(p.workspaceGeneration??0)!==identity.workspaceGeneration||p.status!=='error'||p.lastErrorCode!=='permission-denied'||writes.length!==1||writes[0].entityType!=='clients'||writes[0].operation!=='create')continue;
      const previous=dependencies.get(p.operationId);
      if(previous&&canonical(previous.packet)!==canonical(p))throw Error('Há cópias diferentes de um cadastro retido. Os originais foram preservados; nenhum envio foi iniciado.');
      dependencies.set(p.operationId,{packet:p});
    }
    for(const source of snapshot.sources||[{packets:snapshot.packets,local:snapshot.local}]){
      for(const packet of eligible(source.packets||[],identity)){
        const saleIds=new Set(packet.payload.writes.filter(w=>w.entityType==='sales').map(w=>w.entityId));
        const sale=packet.payload.writes.find(w=>w.entityType==='sales').data;
        const local={vendas:(source.local?.vendas||[]).filter(s=>saleIds.has(s.id)),movimentacoesEstoque:(source.local?.movimentacoesEstoque||[]).filter(m=>m.operationId===packet.operationId||saleIds.has(m.vendaId))};
        const clientId=sale.clienteId||sale.clientId||sale.customerId;
        if(clientId&&[...dependencies.values()].some(d=>d.packet.payload.writes[0].entityId===clientId))
          local.clientDependencies=[...dependencies.values()].filter(d=>!d.packet.payload.writes[0].data?.spaceId||d.packet.payload.writes[0].data.spaceId===sale.spaceId);
        const prior=found.get(packet.operationId);
        if(prior){
          if(canonical(prior.packet)!==canonical(packet))throw Error('Existem cópias diferentes de uma operação preservada. Nenhum envio foi iniciado; os originais continuam intactos.');
          for(const field of ['vendas','movimentacoesEstoque']){
            if(!prior.local[field].length)prior.local[field]=local[field];
            else if(local[field].length&&canonical(prior.local[field])!==canonical(local[field]))throw Error('Existem snapshots diferentes da mesma operação. Os originais continuam preservados para análise.');
          }
        }else found.set(packet.operationId,{packet,local});
      }
    }
    return [...found.values()].sort((a,b)=>String(a.packet.createdAtLocal||a.packet.createdAt||'').localeCompare(String(b.packet.createdAtLocal||b.packet.createdAt||'')));
  }
  async function envelope(packet,local,identity,cryptoApi=globalThis.crypto){
    if(!eligible([packet],identity).length)throw Error('Esta venda não pertence à sessão atual.');
    const sales=packet.payload.writes.filter(w=>w.entityType==='sales');
    if(sales.length!==1)throw Error('A operação precisa de revisão técnica antes do envio.');
    const saleId=sales[0].entityId;
    const originalJson=canonical({packet,localSale:(local.vendas||[]).find(s=>s.id===saleId)||null,localMovements:(local.movimentacoesEstoque||[]).filter(m=>m.operationId===packet.operationId||m.vendaId===saleId),...(local.clientDependencies?.length?{clientDependencies:local.clientDependencies}:{})});
    const bytes=new TextEncoder().encode(originalJson);
    if(bytes.length>500*1024)throw Error('O pacote excede o limite seguro. Seus dados continuam preservados.');
    const hash=await cryptoApi.subtle.digest('SHA-256',bytes),contentHash=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    return{businessId:identity.businessId,workspaceGeneration:identity.workspaceGeneration,originalJson,contentHash};
  }
  const sha=async(value,cryptoApi)=>Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
  async function intakeSummary(prepared,receipts,identity,readReviews,cryptoApi){
    const newClients=new Set(),oldClients=new Set(),expected=new Map();
    const evidence={salesReceived:0,salesAlreadyReceived:0,supplementsReceived:0,supplementsAlreadyReceived:0,customersReceived:0,customersAlreadyReceived:0,verification:'not_requested',missingCustomers:null,customersAwaitingApproval:null,remoteCustomerPackets:null,packets:[]};
    for(const [i,data]of prepared.entries()){
      const original=JSON.parse(data.originalJson),sale=original.packet.payload.writes.find(w=>w.entityType==='sales').data,r=receipts[i],deps=original.clientDependencies||[];
      const kind=r.evidenceOnly===true?(r.duplicate?'supplement_already_received':'supplement_received'):(r.duplicate?'sale_already_received':'sale_received');
      if(kind==='sale_received')evidence.salesReceived++;else evidence.salesAlreadyReceived++;
      if(kind==='supplement_received')evidence.supplementsReceived++;if(kind==='supplement_already_received')evidence.supplementsAlreadyReceived++;
      for(const d of deps){const p=d.packet;(r.duplicate?oldClients:newClients).add(p.operationId);expected.set(p.operationId,{clientId:p.payload.writes[0].entityId,payloadHash:await sha(p.payload,cryptoApi)});}
      evidence.packets.push({saleId:original.packet.payload.writes.find(w=>w.entityType==='sales').entityId,operationId:original.packet.operationId,spaceId:sale.spaceId,clientId:sale.clienteId||sale.clientId||sale.customerId||null,contentHash:r.contentHash,submittedContentHash:data.contentHash,kind,customerOperationIds:deps.map(d=>d.packet.operationId)});
    }
    evidence.customersReceived=newClients.size;evidence.customersAlreadyReceived=[...oldClients].filter(id=>!newClients.has(id)).length;
    if(typeof readReviews!=='function')return evidence;
    try{
      const reviews=await readReviews({identity,packets:evidence.packets}),missing=new Set(),pending=new Set(),remoteCustomers=new Set();
      for(const packet of evidence.packets){
        const matches=reviews.filter(r=>r.saleId===packet.saleId);if(matches.length!==1)throw Error('Revisão não confirmada.');const r=matches[0];
        if(r.businessId!==identity.businessId||r.actorUid!==identity.uid||(r.workspaceGeneration??0)!==identity.workspaceGeneration||r.operationId!==packet.operationId||r.spaceId!==packet.spaceId||r.contentHash!==packet.contentHash)throw Error('Identidade ou hash da revisão divergente.');
        if(packet.kind.startsWith('supplement_')&&r.dependencyEvidenceHash!==packet.submittedContentHash)throw Error('Hash do complemento divergente.');
        for(const op of packet.customerOperationIds){const d=r.clientDependencies?.find(d=>d.operationId===op),want=expected.get(op);if(!d||d.clientId!==want.clientId||d.payloadHash!==want.payloadHash)throw Error('Cadastro não confirmado no complemento.');}
        for(const d of r.clientDependencies||[]){remoteCustomers.add(d.operationId);if(d.status!=='client_confirmed')pending.add(d.operationId);}
        if(r.status==='awaiting_review'&&packet.clientId){
          if(r.customerConfirmation?.clientId!==packet.clientId||!['confirmed','awaiting_approval','awaiting_dependency_evidence'].includes(r.customerConfirmation.state))throw Error('Situação do cliente não confirmada.');
          if(r.customerConfirmation.state==='awaiting_dependency_evidence')missing.add(packet.clientId);
        }else if(!['awaiting_review','already_recreated','recovered','closed_without_effects'].includes(r.status))throw Error('Situação da revisão não confirmada.');
      }
      evidence.verification='verified';evidence.missingCustomers=missing.size;evidence.customersAwaitingApproval=pending.size;evidence.remoteCustomerPackets=remoteCustomers.size;
    }catch{evidence.verification='pending';}
    return evidence;
  }
  function describe(result){
    const e=result.evidence;if(!e)return 'Recebimento dos cadastros ainda não conferido. Consulte a situação; não refaça as vendas.';
    const sales=`Pacotes de vendas: ${e.salesReceived} novos; ${e.salesAlreadyReceived} já recebidos.`;
    if(e.verification!=='verified')return sales+' O recebimento dos cadastros ainda não pôde ser conferido remotamente. Não considere os complementos confirmados; consulte a situação antes de repetir o envio.';
    const text=sales+` Cadastros originais: ${e.customersReceived} recebidos neste envio; ${e.customersAlreadyReceived} já recebidos.`;
    if(e.missingCustomers)return text+` Ainda faltam dados originais de ${e.missingCustomers} cliente(s). A recuperação continua bloqueada; nenhum efeito comercial foi aplicado.`;
    return text+` Conferência remota concluída: ${e.remoteCustomerPackets} cadastro(s) preservado(s); ${e.customersAwaitingApproval} aguardando aprovação do responsável. Isso não recuperou vendas nem iniciou cobranças.`;
  }
  function create({snapshot,call,cryptoApi=globalThis.crypto,onProgress=()=>{},readReviews}){
    let inFlight=null;
    function send(){
      if(inFlight)return inFlight;
      inFlight=(async()=>{
        const initial=await snapshot(),identity=initial.identity,selected=entries(initial);
        if(!selected.length)throw Error('Não há vendas elegíveis para envio nesta conta.');
        if(selected.length>20)throw Error('Há muitas operações. Solicite acompanhamento do responsável. Nenhum dado foi alterado.');
        // Validate/hash every original before the first request. A local conflict
        // cannot result in a partially uploaded set of evidence.
        const prepared=await Promise.all(selected.map(({packet,local})=>envelope(packet,local,identity,cryptoApi)));
        let sent=0;const receipts=[];
        for(const [index,{packet}] of selected.entries()){
          const current=await snapshot();
          if(current.identity.uid!==identity.uid||current.identity.businessId!==identity.businessId||current.identity.workspaceGeneration!==identity.workspaceGeneration)throw Error('A sessão mudou. Seus dados continuam preservados.');
          // The original packet, not the refreshed sale/stock state, is the source.
          const data=prepared[index];
          const result=await call('submitSaleRecovery',data),receipt=result.data??result;
          if(receipt.status==='content_conflict')throw Error('Há dados diferentes para esta venda. Os registros foram preservados para análise.');
          if(!['awaiting_review','already_recreated','recovered','closed_without_effects'].includes(receipt.status)||receipt.operationId!==packet.operationId||receipt.saleId!==undefined&&receipt.saleId!==packet.payload.writes.find(w=>w.entityType==='sales').entityId||
            (receipt.evidenceOnly===true?receipt.receivedContentHash:receipt.contentHash)!==data.contentHash||!receipt.contentHash)throw Error('Não foi possível confirmar o recebimento. Seus dados continuam preservados.');
          receipts.push(receipt);sent++;onProgress({sent,total:selected.length});
        }
        const evidence=await intakeSummary(prepared,receipts,identity,readReviews,cryptoApi),current=await snapshot();
        if(current.identity.uid!==identity.uid||current.identity.businessId!==identity.businessId||current.identity.workspaceGeneration!==identity.workspaceGeneration)throw Error('A sessão mudou. Consulte o recebimento na conta de origem; seus dados permanecem preservados.');
        return{sent,total:selected.length,evidence};
      })().finally(()=>{inFlight=null;});
      return inFlight;
    }
    return{send};
  }
  const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  function unhex(text){if(typeof text!=='string'||!text.length||text.length%2||!/^[a-f0-9]+$/i.test(text))throw Error('Arquivo ou código de proteção inválido.');return Uint8Array.from(text.match(/../g),x=>parseInt(x,16));}
  function noSecrets(value,depth=0){
    if(depth>35)throw Error('O original precisa de revisão técnica.');
    if(!value||typeof value!=='object')return;
    for(const [name,child]of Object.entries(value)){
      if(/^(password|senha|authorization|auth_?token|api_?key|access_?token|refresh_?token|id_?token|secret|credential)$/i.test(name))throw Error('O original contém um campo protegido. Nenhum arquivo foi gerado.');
      noSecrets(child,depth+1);
    }
  }
  async function validateExport(data,cryptoApi=globalThis.crypto){
    if(data?.format!=='veconi-sale-recovery'||data.version!==1||data.purpose!=='authorized-review-only'||!data.identity?.uid||!data.identity?.businessId||!Number.isSafeInteger(data.identity.workspaceGeneration)||!Array.isArray(data.records)||!data.records.length||data.records.length>20)throw Error('Arquivo de recuperação inválido.');
    const seen=new Set(),sales=new Set();
    for(const record of data.records){
      if(typeof record.originalJson!=='string'||new TextEncoder().encode(record.originalJson).length>500*1024)throw Error('Original ausente ou acima do limite seguro.');
      const original=JSON.parse(record.originalJson);noSecrets(original);
      const p=original.packet,writes=p?.payload?.writes||[],s=writes.filter(w=>w.entityType==='sales'&&w.operation==='create');
      if(s.length!==1||!eligible([p],data.identity).length||p.operationId!==record.operationId||s[0].entityId!==record.saleId||s[0].data?.spaceId!==record.spaceId||s[0].data?.businessId!==data.identity.businessId||s[0].data?.actorUid!==data.identity.uid||s[0].data?.operationId!==p.operationId||seen.has(record.operationId)||sales.has(record.saleId))throw Error('Identidade ou seleção dos originais divergente.');
      if(hex(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(record.originalJson)))!==record.contentHash||await sha(p.payload,cryptoApi)!==record.payloadHash)throw Error('Hash do original divergente.');
      seen.add(record.operationId);sales.add(record.saleId);
    }
    return data;
  }
  function selectedExportRows(snapshot,ids){
    const sources=snapshot.sources||[{packets:snapshot.packets,local:snapshot.local}],clients=new Set();
    for(const source of sources)for(const p of eligible(source.packets||[],snapshot.identity))if(ids.has(p.operationId)){
      const sale=p.payload.writes.find(w=>w.entityType==='sales').data;clients.add(sale.clienteId||sale.clientId||sale.customerId);
    }
    return entries({...snapshot,sources:sources.map(source=>({...source,packets:(source.packets||[]).filter(p=>ids.has(p.operationId)||p.payload?.writes?.length===1&&p.payload.writes[0].entityType==='clients'&&p.payload.writes[0].operation==='create'&&clients.has(p.payload.writes[0].entityId))}))});
  }
  function exportCandidates(snapshot){
    const ids=new Set((snapshot.sources||[{packets:snapshot.packets}]).flatMap(s=>eligible(s.packets||[],snapshot.identity).map(p=>p.operationId))),rows=[],blocked=[];
    for(const operationId of ids)try{rows.push(...selectedExportRows(snapshot,new Set([operationId])));}catch(error){blocked.push({operationId,message:error.message});}
    return{rows,blocked};
  }
  async function prepareExport(snapshot,operationIds,cryptoApi=globalThis.crypto){
    if(!cryptoApi?.subtle||!cryptoApi?.getRandomValues)throw Error('Não foi possível proteger o arquivo. Abra a VECONI atualizada em uma conexão segura.');
    if(!Array.isArray(operationIds)||!operationIds.length||operationIds.length>20||new Set(operationIds).size!==operationIds.length)throw Error('Selecione de 1 a 20 vendas diferentes.');
    const selected=new Set(operationIds),rows=selectedExportRows(snapshot,selected);
    if(rows.length!==selected.size)throw Error('Uma venda selecionada não está disponível nesta sessão. Nenhum arquivo foi gerado.');
    const records=[];
    for(const row of rows){
      const sale=row.packet.payload.writes.find(w=>w.entityType==='sales').data,clientId=sale.clienteId||sale.clientId||sale.customerId;
      // Preserve every original write. Export only customer-create dependencies
      // of this selected sale, never unrelated clients from the same namespace.
      const local={...row.local,clientDependencies:(row.local.clientDependencies||[]).filter(d=>d.packet.payload.writes[0].entityId===clientId)};
      const value=await envelope(row.packet,local,snapshot.identity,cryptoApi);
      records.push({operationId:row.packet.operationId,saleId:row.packet.payload.writes.find(w=>w.entityType==='sales').entityId,spaceId:sale.spaceId,payloadHash:await sha(row.packet.payload,cryptoApi),contentHash:value.contentHash,originalJson:value.originalJson});
    }
    const data={format:'veconi-sale-recovery',version:1,purpose:'authorized-review-only',createdAt:new Date().toISOString(),identity:{...snapshot.identity},records};await validateExport(data,cryptoApi);
    const secret=cryptoApi.getRandomValues(new Uint8Array(16)),iv=cryptoApi.getRandomValues(new Uint8Array(12)),key=await cryptoApi.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt']);
    const ciphertext=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(canonical(data)));
    return{file:{format:'veconi-sale-recovery-encrypted',version:1,algorithm:'AES-GCM-128',iv:hex(iv),ciphertext:hex(ciphertext),sha256:hex(await cryptoApi.subtle.digest('SHA-256',ciphertext))},unlockCode:hex(secret),count:records.length};
  }
  async function openExport(file,unlockCode,cryptoApi=globalThis.crypto){
    if(file?.format!=='veconi-sale-recovery-encrypted'||file.version!==1||file.algorithm!=='AES-GCM-128'||typeof file.ciphertext!=='string'||file.ciphertext.length>24*1024*1024)throw Error('Arquivo de recuperação inválido.');
    const encrypted=unhex(file.ciphertext),iv=unhex(file.iv),secret=unhex(String(unlockCode||'').replace(/[\s-]/g,''));
    if(iv.length!==12||secret.length!==16||hex(await cryptoApi.subtle.digest('SHA-256',encrypted))!==file.sha256)throw Error('Arquivo ou código de proteção inválido.');
    let plain;try{const key=await cryptoApi.subtle.importKey('raw',secret,'AES-GCM',false,['decrypt']);plain=await cryptoApi.subtle.decrypt({name:'AES-GCM',iv},key,encrypted);}catch{throw Error('Código incorreto ou arquivo alterado.');}
    return validateExport(JSON.parse(new TextDecoder().decode(plain)),cryptoApi);
  }
  return Object.freeze({canonical,held,eligible,envelope,entries,create,describe,exportCandidates,prepareExport,openExport,validateExport});
});

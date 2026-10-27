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
  return Object.freeze({canonical,held,eligible,envelope,entries,create,describe});
});

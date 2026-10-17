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
  async function envelope(packet,local,identity,cryptoApi=globalThis.crypto){
    if(!eligible([packet],identity).length)throw Error('Esta venda não pertence à sessão atual.');
    const sales=packet.payload.writes.filter(w=>w.entityType==='sales');
    if(sales.length!==1)throw Error('A operação precisa de revisão técnica antes do envio.');
    const saleId=sales[0].entityId;
    const originalJson=canonical({packet,localSale:(local.vendas||[]).find(s=>s.id===saleId)||null,localMovements:(local.movimentacoesEstoque||[]).filter(m=>m.operationId===packet.operationId||m.vendaId===saleId)});
    const bytes=new TextEncoder().encode(originalJson);
    if(bytes.length>500*1024)throw Error('O pacote excede o limite seguro. Seus dados continuam preservados.');
    const hash=await cryptoApi.subtle.digest('SHA-256',bytes),contentHash=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    return{businessId:identity.businessId,workspaceGeneration:identity.workspaceGeneration,originalJson,contentHash};
  }
  function create({snapshot,call,cryptoApi=globalThis.crypto,onProgress=()=>{}}){
    let inFlight=null;
    function send(){
      if(inFlight)return inFlight;
      inFlight=(async()=>{
        const initial=await snapshot(),identity=initial.identity,packets=eligible(initial.packets,identity);
        if(!packets.length)throw Error('Não há vendas elegíveis para envio nesta conta.');
        if(packets.length>20)throw Error('Há muitas operações. Solicite acompanhamento do responsável. Nenhum dado foi alterado.');
        let sent=0;
        for(const packet of packets){
          const current=await snapshot();
          if(current.identity.uid!==identity.uid||current.identity.businessId!==identity.businessId||current.identity.workspaceGeneration!==identity.workspaceGeneration)throw Error('A sessão mudou. Seus dados continuam preservados.');
          // The original packet, not the refreshed sale/stock state, is the source.
          const data=await envelope(packet,initial.local,identity,cryptoApi);
          const result=await call('submitSaleRecovery',data),receipt=result.data??result;
          if(receipt.status==='content_conflict')throw Error('Há dados diferentes para esta venda. Os registros foram preservados para análise.');
          if(receipt.status!=='awaiting_review'||receipt.operationId!==packet.operationId||receipt.contentHash!==data.contentHash)throw Error('Não foi possível confirmar o recebimento. Seus dados continuam preservados.');
          sent++;onProgress({sent,total:packets.length});
        }
        return{sent,total:packets.length};
      })().finally(()=>{inFlight=null;});
      return inFlight;
    }
    return{send};
  }
  return Object.freeze({canonical,held,eligible,envelope,create});
});

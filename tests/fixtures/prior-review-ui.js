/* In-memory UI fixture only: no Firebase, network, credentials or production data. */
window.PriorReviewQA=(()=>{
  const businessId='qa-prior-review',uid='qa-review-owner',spaceId='qa-review-space',calls=[];
  let lost=false,record=null,completed=0,release=null,hold=null;
  window.Utils={escapar:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dinheiro:x=>Number(x||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),toast(){}};
  window.BusinessContext={get:()=>({businessId,role:'owner',loading:false,business:{id:businessId,ownerId:uid},userProfile:{uid,businessId,active:true},member:{uid,role:'owner',status:'active'}})};
  window.FirebaseSession={user:{uid},businessId};window.DB={getWorkspaceGeneration:()=>0};
  window.SpaceContext={salesId:()=>spaceId,list:()=>[{id:spaceId,name:'Espaço fictício QA'}]};
  window.CheckoutMobile={closeSummary(){}};window.DesktopSales={closeCart(){}};
  window.FirebaseCallable=async(name,data)=>{
    calls.push({name,data:JSON.parse(JSON.stringify(data))});
    if(name==='previewPriorSale')return{data:{operationId:data.operationId,saleId:data.saleId,inputHash:'qa-visual-only',preview:{sale:{id:data.saleId,clienteNome:'Cliente fictício QA',data:data.intent.occurredAt,paidAt:data.intent.paidAt,formaPagamento:data.intent.paymentMethod,itens:[{nome:'Produto fictício',quantidade:2,subtotalFinal:19.9}],valorFinal:19.9,descontoTotal:.1,priorSale:{reason:data.intent.reason}},stockEffect:'O estoque atual será ajustado uma única vez.',financialEffect:'Fiado integral em aberto; sem recebimento a conciliar.'}}};
    if(name!=='confirmPriorSale')throw Error('Fixture bloqueia outras operações.');
    if(data.action==='status')return{data:record||{confirmed:false}};
    if(hold)await hold;
    record={confirmed:true,sale:{id:data.saleId},receipt:{status:'processed'}};
    if(lost)throw Error('Resposta perdida simulada');
    return{data:record};
  };
  function setup(){
    document.querySelector('[data-prior-entry]').innerHTML=PriorSales.actionMarkup();PriorSales.mount();
    if(!PriorSales.active())document.querySelector('[data-prior-start]').click();
    const reason=document.querySelector('[data-prior-reason]');reason.value='Indisponibilidade fictícia do sistema';reason.dispatchEvent(new Event('input'));
  }
  function open(method='pix'){
    document.querySelector('#modal [data-prior-close]')?.click();
    const draft={itens:[{produtoId:'qa-review-product',quantidade:2,precoFinalUnitario:9.95,precoOriginal:10}],formaPagamento:method,clienteId:'qa-review-client'};
    return PriorSales.submit(draft,()=>{completed++;});
  }
  return{setup,open,calls,lost:value=>{lost=value;},hold:()=>{hold=new Promise(r=>{release=r;});return()=>{release();hold=null;};},completed:()=>completed};
})();

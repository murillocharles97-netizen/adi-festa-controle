(function(){
  'use strict';
  const VARIABLES=Object.freeze(['nome','primeiro_nome','valor_pago','saldo_atual','nome_negocio','data_pagamento','forma_pagamento']);
  const DEFAULTS=Object.freeze([
    Object.freeze({id:'receipt-partial',type:'receipt',receiptKind:'partial',name:'Pagamento parcial',isDefault:true,content:'Olá, {{primeiro_nome}}! Tudo bem?\n\nRecebemos seu pagamento de {{valor_pago}} na {{nome_negocio}}.\n\nSeu saldo em aberto agora é de {{saldo_atual}}.\n\nMuito obrigado! 😊'}),
    Object.freeze({id:'receipt-total',type:'receipt',receiptKind:'total',name:'Pagamento total',isDefault:true,content:'Olá, {{primeiro_nome}}!\n\nRecebemos seu pagamento de {{valor_pago}} na {{nome_negocio}}.\n\nSeu saldo está quitado! Muito obrigado pela confiança. 😊'}),
  ]);
  const money=value=>Utils.dinheiro(value),code=(name,message)=>Object.assign(Error(message),{code:name});
  function scope(){return JSON.stringify([window.FirebaseSession?.user?.uid,DB.getBusinessId(),DB.getWorkspaceGeneration?.()??0,window.TeamAccess?.operationalReadScopeKey?.(),window.SpaceContext?.homeId?.(),window.TeamAccess?.captureSession?.()]);}
  function canUse(){return window.TeamAccess?.has?.('customers.receiveDebt')===true&&window.TeamAccess?.has?.('customers.view')===true;}
  function assertSharing(){if(window.AdiFestaBuild?.receiptSharingPaused===true)throw code('receipt-sharing-paused','O compartilhamento de recebimentos está temporariamente pausado. Os pagamentos e recibos foram preservados.');}
  function canManage(){const c=window.BusinessContext?.get?.();return window.TeamAccess?.has?.('settings.manage')===true&&!c?.loading&&!c?.error&&c?.access?.canMutate!==false&&c?.access?.readOnly!==true;}
  function assertScope(token){if(token!==scope()||!canUse())throw code('receipt-session-changed','A conta, empresa ou acesso mudou. Abra o recebimento novamente.');}
  function validateText(content){
    const text=String(content||'').trim();if(!text||text.length>4000)throw code('receipt-template-invalid','Digite uma mensagem de até 4.000 caracteres.');
    for(const m of text.matchAll(/{{\s*([^{}]+?)\s*}}/g))if(!VARIABLES.includes(m[1].trim()))throw code('receipt-variable-unknown','Variável não permitida: '+m[1].trim()+'.');
    if(/[{}]/.test(text.replace(/{{\s*([^{}]+?)\s*}}/g,'')))throw code('receipt-variable-invalid','Revise as variáveis da mensagem. Use os botões de inserção.');
    return text;
  }
  function list(source){
    const stored=source===undefined?DB.carregar().config?.receiptMessageTemplates:source;
    const saved=Array.isArray(stored)?stored.filter(t=>t?.type==='receipt'&&t.active!==false&&['partial','total'].includes(t.receiptKind)&&typeof t.id==='string'&&typeof t.name==='string'&&typeof t.content==='string'&&!DEFAULTS.some(base=>base.id===t.id&&base.receiptKind!==t.receiptKind)):[];
    return [...saved,...DEFAULTS.filter(t=>!saved.some(s=>s.id===t.id))].map(t=>({...t}));
  }
  function save(input){
    if(!canManage())throw window.TeamAccess?.failure?.('settings.manage')||code('permission-denied','Somente o gestor autorizado pode alterar modelos da empresa.');
    const session=window.TeamAccess.captureSession();window.TeamAccess.assertSession(session);
    const current=list(),existing=input.id&&current.find(t=>t.id===input.id),kind=input.receiptKind||existing?.receiptKind;
    if(!['partial','total'].includes(kind))throw code('receipt-template-invalid','Escolha pagamento parcial ou total.');
    if(DEFAULTS.some(base=>base.id===existing?.id&&base.receiptKind!==kind))throw code('receipt-template-invalid','O modelo original mantém a situação de pagamento. Crie um novo modelo para outra situação.');
    const name=String(input.name||'').trim();if(!name||name.length>80)throw code('receipt-template-invalid','Informe um nome de até 80 caracteres.');
    const next={id:existing?.id||Utils.uuid(),type:'receipt',receiptKind:kind,name,content:validateText(input.content),isDefault:input.isDefault===true,active:true,updatedAt:new Date().toISOString()};
    const updated=current.map(t=>next.isDefault&&t.receiptKind===kind?{...t,isDefault:false}:t).filter(t=>t.id!==next.id);updated.push(next);
    DB.alterar(data=>{window.TeamAccess.assertSession(session);data.config??={};data.config.receiptMessageTemplates=updated;});
    dispatchEvent(new CustomEvent('message-templates-updated'));return next;
  }
  function restore(id){const original=DEFAULTS.find(t=>t.id===id);if(!original)throw code('receipt-template-invalid','Este modelo não possui um original de fábrica.');return save({...original,isDefault:list().find(t=>t.id===id)?.isDefault===true});}
  function defaultTemplate(kind,source){const templates=list(source).filter(t=>t.receiptKind===kind);return templates.find(t=>t.isDefault)||templates[0];}
  function kind(receipt){return Number(receipt.balance)<0?'partial':'total';}
  function variables(receipt){
    if(receipt?.confirmed!==true||!Number.isFinite(receipt.balance)||!Number.isFinite(receipt.amount)||!receipt.businessName||!receipt.clientName)throw code('receipt-unconfirmed','O recebimento e o saldo precisam de confirmação remota.');
    const date=new Date(receipt.paymentDate);if(Number.isNaN(date.getTime()))throw code('receipt-date-unconfirmed','A data do recebimento ainda não foi confirmada.');
    return{nome:receipt.clientName,primeiro_nome:receipt.clientName.trim().split(/\s+/)[0],valor_pago:money(receipt.amount),saldo_atual:money(Math.max(0,-receipt.balance)),nome_negocio:receipt.businessName,data_pagamento:date.toLocaleDateString('pt-BR'),forma_pagamento:({pix:'PIX',cash:'Dinheiro',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',transfer:'Transferência',other:'Não informada'})[receipt.paymentMethod]||'Não informada'};
  }
  function resolve(content,receipt){const text=validateText(content),values=variables(receipt);return text.replace(/{{\s*([^{}]+?)\s*}}/g,(_,key)=>values[key.trim()]);}
  async function read({paymentId,operationId,clientId}){
    const token=scope(),businessId=DB.getBusinessId(),workspaceGeneration=DB.getWorkspaceGeneration?.()??0;assertScope(token);
    if(!navigator.onLine||typeof window.FirebaseCallable!=='function')throw code('receipt-offline','Não foi possível consultar a confirmação. Conecte-se e consulte novamente; nenhum pagamento será reenviado.');
    const response=await window.FirebaseCallable('getOperationalSyncReceipt',{kind:'payment_confirmation',businessId,workspaceGeneration,paymentId,operationId,clientId});assertScope(token);
    const receipt=response?.data;if(receipt?.confirmed!==true)return{confirmed:false,status:receipt?.status||'awaiting_confirmation'};
    if(receipt.businessId!==businessId||receipt.workspaceGeneration!==workspaceGeneration||receipt.paymentId!==paymentId||receipt.operationId!==operationId||receipt.clientId!==clientId)throw code('receipt-origin-mismatch','A confirmação não corresponde a este recebimento.');
    variables(receipt);return Object.freeze({...receipt});
  }
  window.ReceiptMessages=Object.freeze({VARIABLES,DEFAULTS,scope,assertScope,canUse,canManage,assertSharing,validateText,list,save,restore,defaultTemplate,kind,variables,resolve,read});
})();

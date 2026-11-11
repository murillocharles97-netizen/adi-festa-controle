(function(){
 'use strict';
 const P=window.OperationalPrivacyPolicy,permissions=window.VeconiPermissionPolicy;
 const mapping={clients:'clientes',sales:'vendas',payments:'pagamentos',stockMovements:'movimentacoesEstoque',activityEvents:'activityEvents',campaigns:'campanhas',campaignProgress:'progressosCampanha',campaignEvents:'eventosCampanha',campaignRedemptions:'resgatesCampanha',rewards:'recompensas',customerSubscriptions:'customerSubscriptions',customerSubscriptionEvents:'customerSubscriptionEvents',paymentAllocations:'alocacoesPagamento',catalogOrders:'catalogOrders',customerMetrics:'metricasClientes',customerMonthlyMetrics:'metricasClientesMensais',customerSegments:'segmentosClientes',visits:'visitas',charges:'cobrancas',messageHistory:'messageHistory',messageSequences:'messageSequences',clientContacts:'contatosCliente',saleFinancials:'saleFinancials',stockMovementFinancials:'stockMovementFinancials'};
 const readable=new Set(['clients','sales','payments','stockMovements','activityEvents','settings','campaigns','catalogOrders']);
 let windowProof=null,sequence=0,capacity=null;const cases=new Map(),customerContexts=new Map();
 const context=()=>window.BusinessContext?.get?.()||{},restricted=()=>P.restricted(context().member),handles=col=>restricted()&&P.protectedCollections.includes(col);
 const key=()=>{const c=context();return JSON.stringify([c.businessId,window.FirebaseSession?.user?.uid,P.accessShape(c.member),c.loading,c.error,c.spaceAccess,c.allowedSpaceIds,c.business?.workspaceGeneration??0,window.SpaceContext?.homeId?.(),window.SpaceContext?.salesId?.()]);};
 const allowedRead=col=>!handles(col)||readable.has(col)&&(!['sales','payments','activityEvents'].includes(col)||permissions.has(context().member,'performance.daily'));
 const currentWindow=()=>windowProof?.key===key()&&performance.now()-windowProof.at<3600000?{...windowProof.window,now:new Date(windowProof.serverAt+performance.now()-windowProof.at)}:null;
 const today=v=>{const w=currentWindow();return !!w&&permissions.dayKey(v,w.zone)===permissions.dayKey(w.now,w.zone);};
 const grantFor=(saleId,purpose)=>{const g=cases.get(String(saleId));return g&&g.key===key()&&g.until>performance.now()&&(g.purpose===purpose||purpose==='consult')?g.id:null;};
 async function call(input){
  const c=context(),origin=key(),ticket=sequence,uid=window.FirebaseSession?.user?.uid;
  if(!uid||uid!==c.userProfile?.uid||c.loading||c.error||c.member?.status!=='active')throw Error('Verificando seu acesso. Nenhuma operação foi enviada.');
  if(navigator.onLine===false)throw Object.assign(Error('Conecte-se para consultar os dados autorizados. As operações locais foram preservadas.'),{code:'operational-read-offline'});
  const spaceId=input.purpose==='checkout'||input.purpose==='payment'||input.mode==='sale_capacity'?window.SpaceContext?.salesId?.():window.SpaceContext?.homeId?.();
  const raw=await window.FirebaseCallable('readOperationalWorkspace',{spaceId,...input,businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0}),data=raw.data??raw;
  if(ticket!==sequence||origin!==key())throw Object.assign(Error('A sessão ou o espaço mudou. A resposta antiga foi ignorada.'),{code:'sync-session-retired'});
  if(data.businessId!==c.businessId||data.uid!==uid||data.workspaceGeneration!==(c.business?.workspaceGeneration??0)||data.readPolicyVersion!==1||data.source!=='server'||!data.window?.zone||!data.window?.day)throw Error('A resposta não corresponde ao acesso autorizado.');
  windowProof={key:origin,window:data.window,serverAt:Date.parse(data.serverNow||data.window.from),at:performance.now()};
  return data;
 }
 const get=async(col,id,options={})=>(await call({collection:col,mode:options.operationId?'own_confirmation':options.presence?'sale_presence':'get',id,...options})).record;
 function wrapRepository(col,base){let metadata=null;
  const meta=data=>metadata={source:'server',collection:col,fromCache:false,hasPendingWrites:false,readAt:data.serverNow||new Date().toISOString(),readPolicyVersion:1,projection:true,day:data.window.day};
  const page=async(cursor=null,max=100)=>{const data=await call({collection:col,mode:'page',cursor,limit:max});meta(data);return{items:data.items||[],cursor:data.next||null,hasMore:!!data.next,metadata,documentsRead:(data.items||[]).length};};
  const all=async()=>{let cursor=null,items=[];for(let n=0;n<200;n++){const p=await page(cursor);items.push(...p.items);if(!p.hasMore)return items;cursor=p.cursor;}throw Error('A consulta operacional atingiu o limite seguro. Nenhum cursor foi confirmado.');};
  const readMethods={getLastReadMetadata:()=>metadata,getById:(id)=>get(col,id,{grantId:grantFor(id,'consult')}),getSaleStatusFromServer:id=>get(col,id,{presence:true}),list:all,listAllPaged:all,listRecent:async max=>(await all()).sort((a,b)=>new Date(b.data||b.createdAt)-new Date(a.data||a.createdAt)).slice(0,max||100),listChangedSince:all,listPage:page,listQueryPage:async(o={})=>{
    const origin=key(),orders=o.orders?.length?o.orders:[{field:'nomeNormalizado',direction:'asc'}],fingerprint=JSON.stringify([origin,col,o.filters,orders,o.prefix]),max=Math.min(200,Math.max(1,Number(o.max)||20));
    if(o.cursor&&(o.cursor.operationalQuery!==fingerprint||!Number.isInteger(o.cursor.offset)))throw Error('A consulta foi substituída. Reabra a lista sem limpar os dados.');
    const operators={'==':(a,b)=>a===b,'>=':(a,b)=>a>=b,'<=':(a,b)=>a<=b,'>':(a,b)=>a>b,'<':(a,b)=>a<b,'in':(a,b)=>Array.isArray(b)&&b.includes(a),'array-contains':(a,b)=>Array.isArray(a)&&a.includes(b)};
    let rows=(await all()).filter(r=>(o.includeInactive||r.active!==false&&r.ativo!==false&&!r.deletedAt)&&(o.filters||[]).every(f=>{const operator=operators[f.operator||'=='];if(!operator)throw Error('Filtro operacional não suportado.');return operator(r[f.field],f.value);}));
    if(o.prefix!==undefined)rows=rows.filter(r=>String(r[orders[0].field]??r.nome??'').toLocaleLowerCase().startsWith(String(o.prefix).toLocaleLowerCase()));
    rows.sort((a,b)=>{for(const order of orders){const av=a[order.field]??'',bv=b[order.field]??'',v=av<bv?-1:av>bv?1:0;if(v)return order.direction==='desc'?-v:v;}return String(a.id).localeCompare(String(b.id));});
    const offset=o.cursor?.offset||0,items=rows.slice(offset,offset+max),hasMore=offset+max<rows.length;if(origin!==key())throw Error('A autorização mudou durante a consulta.');return{items,hasMore,cursor:hasMore?{operationalQuery:fingerprint,offset:offset+max}:null,metadata};
  },listWhere:async(field,value,max)=>(await all()).filter(r=>r[field]===value).slice(0,max||100),listWherePaged:async(field,value)=>(await all()).filter(r=>r[field]===value),countFromServer:async()=>(await all()).length};
  const subscribe=(callback,error,max)=>{let stopped=false,busy=false,origin=key(),timer=null;
   const load=async()=>{if(stopped||busy||origin!==key())return;busy=true;try{const items=max?await readMethods.listRecent(max):await all();if(!stopped&&origin===key())callback(items,metadata,{cursor:null,hasMore:false});}catch(e){if(!stopped&&origin===key())error?.(e);}finally{busy=false;}};
   // Hydration emits cloud-data-updated itself. Only the remote invalidation
   // signal, not its local projection, schedules another read.
   const changed=e=>{if(e.type==='cloud-data-updated'&&e.detail?.source!=='remote-signal')return;clearTimeout(timer);timer=setTimeout(load,400);};['cloud-data-updated','online','visibilitychange','operational-remote-invalidation'].forEach(n=>addEventListener(n,changed));void load();return()=>{stopped=true;clearTimeout(timer);['cloud-data-updated','online','visibilitychange','operational-remote-invalidation'].forEach(n=>removeEventListener(n,changed));};
  };
  readMethods.subscribe=(callback,error)=>subscribe(callback,error);readMethods.subscribeRecent=(callback,error,max)=>subscribe(callback,error,max||100);
  readMethods.subscribeById=(id,callback,error)=>subscribe(rows=>callback(rows.find(r=>r.id===id)||null,metadata),error);
  return new Proxy(base,{get(target,name){const original=target[name];if(typeof original!=='function')return original;if(!readMethods[name])return original.bind(target);return(...args)=>{if(handles(col))return readMethods[name](...args);const origin=key();if(['subscribe','subscribeRecent','subscribeById'].includes(name)){const index=name==='subscribeById'?1:0,callback=args[index];args[index]=(...values)=>{if(origin===key())callback(...values);};return original.apply(target,args);}const result=original.apply(target,args);return result?.then?result.then(value=>{if(origin!==key())throw Object.assign(Error('A autorização mudou durante a consulta. O resultado antigo foi descartado.'),{code:'sync-session-retired'});return value;}):result;};}});
 }
 function view(data){
  if(!restricted())return data;const c=context(),out={...data};
  for(const[col,field]of Object.entries(mapping)){if(!Array.isArray(data[field]))continue;out[field]=[];for(const row of data[field]){if(row.businessId&&row.businessId!==c.businessId||row.workspaceGeneration!==undefined&&row.workspaceGeneration!==(c.business?.workspaceGeneration??0))continue;const sid=row.spaceId||row.financialSpaceId;
    const customerLinks=col==='clients'&&Array.isArray(row.customerSpaceIds)?row.customerSpaceIds.filter(id=>c.spaceAccess==='all'||c.allowedSpaceIds?.includes(id)):[];
    if(sid&&c.spaceAccess!=='all'&&!c.allowedSpaceIds?.includes(sid)&&!customerLinks.length)continue;
    if(['sales','payments','activityEvents'].includes(col)&&!permissions.has(c.member,'performance.daily'))continue;
    if(['sales','payments','stockMovements','activityEvents','catalogOrders'].includes(col)&&!today(col==='catalogOrders'?row.deliveredAt||row.updatedAt||row.data||row.createdAt:row.data||row.createdAt)&&!(col==='catalogOrders'&&!['entregue','cancelado','expirado','delivered','cancelled','expired'].includes(row.orderStatus)))continue;
    const clean=P.sanitize(col,row);
    if(clean&&col==='clients'){
     clean.customerSpaceIds=customerLinks;
     if(row.customerDirectoryOnly||sid&&c.spaceAccess!=='all'&&!c.allowedSpaceIds?.includes(sid)){
      for(const field of ['saldo','financialVersion','legacyBalance','legacyBalanceRemaining','campaignFinanceVersion','promessaPagamento'])delete clean[field];
      clean.customerDirectoryOnly=true;
     }
    }
    if(clean)out[field].push(clean);
   }}
  out.movimentacoes=(permissions.has(c.member,'performance.daily')?data.movimentacoes||[]:[]).filter(r=>today(r.data||r.createdAt)&&(!r.businessId||r.businessId===c.businessId)&&(r.workspaceGeneration===undefined||r.workspaceGeneration===(c.business?.workspaceGeneration??0))&&(!(r.spaceId||r.financialSpaceId)||c.spaceAccess==='all'||c.allowedSpaceIds?.includes(r.spaceId||r.financialSpaceId))).map(r=>P.pick(r,[...P.scopeFields,'tipo','clienteId','clienteNome','vendaId','valor']));
  out.config={...data.config};for(const field of ['dashboard','dailySalesGoal','fechamentos','closingHistory','financial','analytics','revenue','salesHistory'])delete out.config[field];
  for(const g of cases.values())if(g.key===key()&&g.until>performance.now()&&g.sale&&!out.vendas.some(s=>s.id===g.sale.id))out.vendas.push(g.sale);
  return out;
 }
 const rememberCustomer=data=>{const pending=new Set(window.SyncFirebase?.pendingBenefitEventIds?.()||[]);customerContexts.set(data.client.id,{key:key(),at:performance.now(),purpose:data.purpose||'checkout',data:structuredClone(data),knownEvents:new Set((window.DB?.carregar?.().eventosCampanha||[]).filter(e=>!pending.has(e.id)).map(e=>e.id))});};
 const customerContext=async(id,purpose='checkout')=>{const data=await call({mode:'customer_context',customerId:id,purpose});data.purpose=purpose;rememberCustomer(data);return data;};
 const paymentPrepared=id=>{const v=customerContexts.get(id);return v?.key===key()&&v.purpose==='payment'&&performance.now()-v.at<120000;};
 const saleCapacityDecision=()=>{if(!restricted())return null;const valid=capacity?.key===key()&&performance.now()-capacity.at<120000;return{ok:valid&&capacity.allowed,reason:valid&&!capacity.allowed?'limit_reached':'operational-capacity-unconfirmed',feature:'sales.create',kind:'operational-read',limit:null,current:null};};
 async function prepareSale(){if(!restricted())return;if(navigator.onLine===false&&saleCapacityDecision()?.ok)return;const d=await call({mode:'sale_capacity'});capacity={key:key(),at:performance.now(),allowed:d.canCreate,limited:d.limited};if(!d.canCreate)throw Error('A assinatura não permite uma nova venda agora. Solicite conferência ao proprietário. O carrinho foi preservado.');}
 const consumeSaleCapacity=()=>{if(restricted()&&capacity?.limited)capacity=null;};
 // The canonical current benefit baseline is a transient projection. Combining
 // it with the old full ledger retained on this device would count past events
 // twice. Only new local events since that read participate in this operation.
 function benefitOperation(raw,clientId,run){
  if(!restricted()||!clientId)return run(raw);const ctx=customerContexts.get(String(clientId));
  if(!ctx||ctx.key!==key()||performance.now()-ctx.at>120000)throw Error('Consulte novamente o cliente para conferir seus benefícios atuais. Nenhuma operação foi enviada.');
  const events=new Map(ctx.data.campaignEvents.map(e=>[e.id,structuredClone(e)]));
  for(const e of raw.eventosCampanha||[])if(e.clientId===clientId&&!ctx.knownEvents.has(e.id))events.set(e.id,structuredClone(e));
  const overlay={...raw,eventosCampanha:[...events.values()],progressosCampanha:structuredClone(ctx.data.campaignProgress),resgatesCampanha:[],recompensas:[]};
  const result=run(overlay);
  raw.eventosCampanha||=[];for(const e of overlay.eventosCampanha)if(!raw.eventosCampanha.some(old=>old.id===e.id))raw.eventosCampanha.push(e);
  raw.progressosCampanha||=[];for(const p of overlay.progressosCampanha){const clean={...p};delete clean.ledgerBaseline;delete clean.operationalProjection;const previous=raw.progressosCampanha.find(old=>old.id===p.id);if(previous)Object.assign(previous,clean);else raw.progressosCampanha.push(clean);}
  return result;
 }
 function debtOperation(raw,clientId,run){
  if(!restricted())return run(raw);const ctx=customerContexts.get(String(clientId));
  if(!paymentPrepared(clientId))throw Error('Consulte novamente as obrigações do cliente. Nenhum pagamento foi enviado.');
  const overlay={...raw,vendas:structuredClone(ctx.data.sales||[]),alocacoesPagamento:[]};
  const result=run(overlay),fields=['creditOriginalAmount','creditPaidAmount','creditRemainingAmount','creditSettled','creditSettledAt'];
  for(const sale of overlay.vendas){const existing=raw.vendas.find(s=>s.id===sale.id);if(existing)for(const field of fields)if(Object.hasOwn(sale,field))existing[field]=sale[field];}
  raw.alocacoesPagamento||=[];for(const allocation of overlay.alocacoesPagamento)if(!raw.alocacoesPagamento.some(a=>a.id===allocation.id))raw.alocacoesPagamento.push(allocation);
  return result;
 }
 async function openCustomer(id){
  const origin=key(),client=(await get('clients',id));if(origin!==key()||!client)return;
  const root=document.querySelector('#modal');root.innerHTML='<div class="modal-bg"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="op-client-title"><header class="modal-head"><h2 id="op-client-title"></h2></header><div class="modal-body viewport-scroll"><p data-op-client-phone></p><p>Saldo atual: <strong data-op-client-balance></strong></p><p>Indicadores de compras anteriores exigem acesso ao histórico de faturamento.</p><button class="btn btn-light" type="button" data-op-client-receipt>Consultar recebimento de hoje</button><p role="status" data-op-client-feedback></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-op-client-close>Fechar</button></footer></section></div>';
  root.querySelector('h2').textContent=client.nome||'Cliente';root.querySelector('[data-op-client-phone]').textContent=client.telefone||'';root.querySelector('[data-op-client-balance]').textContent=client.customerDirectoryOnly?'Consulte no espaço de origem.':Number(client.saldo||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});root.querySelector('[data-op-client-close]').onclick=()=>root.innerHTML='';
  const button=root.querySelector('[data-op-client-receipt]');button.disabled=client.customerDirectoryOnly||!window.TeamAccess?.has?.('customers.receiveDebt');button.onclick=async()=>{button.disabled=true;try{const data=await call({mode:'last_payment',customerId:id});if(origin!==key()||!button.isConnected)return;if(!data.record){root.querySelector('[data-op-client-feedback]').textContent='Nenhum recebimento de hoje foi localizado. Para um comprovante antigo, utilize seu identificador original ou solicite ao proprietário.';return;}const p=data.record;window.ReceiptMessageUI.openExisting(p.id,id,{operationId:p.operationId});}catch(e){if(button.isConnected)root.querySelector('[data-op-client-feedback]').textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}};
 }
 async function openCase(){
  const root=document.querySelector('#modal');root.innerHTML='<div class="modal-bg"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="op-case-title"><header class="modal-head"><h2 id="op-case-title">Atendimento de venda</h2></header><div class="modal-body viewport-scroll"><p>Vendas de outro dia exigem autorização pontual do proprietário. O acesso ao histórico permanece restrito.</p><div data-op-case-list>Consultando autorizações…</div><p role="alert" data-op-case-error></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-op-case-close>Fechar</button></footer></section></div>';root.querySelector('[data-op-case-close]').onclick=()=>root.innerHTML='';
  try{const data=await call({mode:'cases'});if(!root.querySelector('[data-op-case-list]'))return;const list=root.querySelector('[data-op-case-list]');list.textContent=data.items.length?'':'Nenhuma autorização ativa. Peça ao proprietário que abra a venda e autorize o atendimento.';for(const g of data.items){const button=document.createElement('button');button.className='btn btn-light';button.type='button';button.textContent='Venda '+g.saleId.slice(0,8)+' · '+g.purpose;button.onclick=async()=>{button.disabled=true;try{const result=await call({collection:'sales',mode:'get',id:g.saleId,grantId:g.id,purpose:'consult'});cases.set(g.saleId,{id:g.id,purpose:g.purpose,key:key(),sale:result.record,until:performance.now()+Math.max(0,Date.parse(g.expiresAt)-Date.parse(result.serverNow))});window.ActivityCenter?.openOperationalSale?.(result.record,g.id);}catch(e){const feedback=root.querySelector('[data-op-case-error]');if(feedback)feedback.textContent=e.message;if(button.isConnected)button.disabled=false;}};list.append(button);}}catch(e){if(root.querySelector('[data-op-case-error]'))root.querySelector('[data-op-case-error]').textContent=e.message;}
 }
 async function authorize(sale){
  if(context().role!=='owner')throw Error('Somente o proprietário pode autorizar este atendimento.');const origin=key(),root=document.querySelector('#modal'),members=(await window.TeamService.listMembers()).filter(m=>m.status==='active'&&m.role!=='owner');if(origin!==key())return;
  root.innerHTML='<div class="modal-bg"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="op-grant-title"><header class="modal-head"><h2 id="op-grant-title">Autorizar atendimento pontual</h2></header><form><div class="modal-body viewport-scroll"><p>Acesso somente a esta venda por 15 minutos, com auditoria. As permissões comerciais existentes continuam obrigatórias.</p><label class="field">Funcionário<select name="uid" required></select></label><label class="field">Finalidade<select name="purpose"><option value="consult">Consultar esta venda</option><option value="cancel">Cancelar esta venda</option><option value="exchange">Trocar itens desta venda</option></select></label><label class="field">Motivo<textarea name="reason" minlength="8" maxlength="400" required></textarea></label><p role="alert" data-op-grant-error></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-op-grant-close>Voltar</button><button class="btn btn-primary" type="submit">Autorizar atendimento</button></footer></form></section></div>';
  for(const m of members){const option=document.createElement('option');option.value=m.uid||m.id;option.textContent=m.name||'Funcionário';root.querySelector('[name=uid]').append(option);}root.querySelector('[data-op-grant-close]').onclick=()=>root.innerHTML='';const requestId=crypto.randomUUID();let busy=false;
  root.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy||origin!==key())return;busy=true;const button=root.querySelector('[type=submit]');button.disabled=true;const fd=new FormData(e.currentTarget),c=context();try{const result=await window.FirebaseCallable('authorizeOperationalSaleRead',{businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0,saleId:sale.id,targetUid:fd.get('uid'),purpose:fd.get('purpose'),reason:fd.get('reason'),requestId});if(origin!==key())return;root.querySelector('[data-op-grant-error]').textContent='Autorização registrada. O funcionário pode abrir Histórico → Atendimento de venda.';button.textContent='Autorizado';}catch(error){if(origin===key()){root.querySelector('[data-op-grant-error]').textContent=error.message;button.disabled=false;busy=false;}}};
 }
 let lastScope=key();
 const invalidate=()=>{sequence++;windowProof=null;capacity=null;cases.clear();customerContexts.clear();lastScope=key();const root=document.querySelector('#modal');if(root?.querySelector('[data-op-case-list],[data-op-client-balance],[data-op-grant-error]'))root.innerHTML='';};
 ['business-context-changed','veconi-space-context-changed'].forEach(e=>addEventListener(e,()=>{if(lastScope!==key())invalidate();}));addEventListener('firebase-session-cleared',invalidate);
 document.addEventListener('click',e=>{if(e.target.closest('[data-operational-case-open]'))void openCase().catch(error=>window.Utils?.toast?.(error.message,true));});
 window.OperationalReadPolicy=Object.freeze({restricted,handles,allowedRead,key,currentWindow,today,call,get,wrapRepository,view,customerContext,paymentPrepared,benefitOperation,debtOperation,saleCapacityDecision,prepareSale,consumeSaleCapacity,grantFor,openCase,openCustomer,authorize,invalidate});
})();

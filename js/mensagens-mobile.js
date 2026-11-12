(function(){
  'use strict';
  const mq=matchMedia('(max-width:767px)'),$=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const icon=name=>`<i data-lucide="${name}"></i>`,esc=value=>Utils.escapar(String(value??'')),money=Utils.dinheiro;
  const TYPE_LABELS={charge:'Cobrança',campaign:'Campanha',notice:'Aviso',custom:'Mensagem livre',receipt:'Recebimentos'},PENDING_KEY='adiFestaMessagePendingReturn_v1';
  const center={type:'charge',audience:'debt',selected:new Set(),sort:'maior',days:'todos',min:'',max:'',phone:true,initialized:false};
  const SEQUENCE_TYPES=['charge','campaign','notice','custom'];
  let returnShown=false,sequenceStarting=false;
  function client(id){return Clientes.obter(id)}
  function typeLabel(type){return TYPE_LABELS[type]||TYPE_LABELS.custom}
  function close(){document.querySelector('#modal').innerHTML=''}
  function refreshClients(){if(document.querySelector('.message-center-page'))return;window.ClientesMobile?.refresh?.()}
  function setPending(value){try{if(value)sessionStorage.setItem(PENDING_KEY,JSON.stringify(value));else sessionStorage.removeItem(PENDING_KEY)}catch(error){console.error('[WHATSAPP] pending state failed',error)}}
  function getPending(){try{return JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null')}catch{return null}}
  function persistCenter(){return MessageSequence.draft({...center,selected:[...center.selected]}).catch(error=>Utils.toast(MessageSequence.friendly(error),true))}
  async function restoreCenter(){const saved=await MessageSequence.draft();if(!saved){Object.assign(center,{type:'charge',audience:'debt',selected:new Set(),sort:'maior',days:'todos',min:'',max:'',phone:true,initialized:false});return false}Object.assign(center,saved,{selected:new Set(saved.selected||[]),initialized:Boolean(saved.initialized)});if(!['debt','all'].includes(center.audience))center.audience=center.type==='charge'?'debt':'all';if(center.type==='receipt')center.type='charge';return true}
  function templateOptions(type,selected){return Mensagens.templates(type).map(item=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.name)}${item.isDefault?' · padrão':''}</option>`).join('')}
  function variableButtons(){return['nome','primeiro_nome','saldo','ultima_cobranca','nome_negocio','pix','data_atual'].map(name=>`<button type="button" data-message-variable="${name}">{{${name}}}</button>`).join('')}
  function duplicateWarning(clientId,continuation){const c=client(clientId),root=$('#modal');root.innerHTML=`<div class="message-overlay"><section class="message-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="charge-repeat-title"><div class="sheet-handle"></div>${icon('message-circle-warning')}<h3 id="charge-repeat-title">Cliente já cobrado hoje</h3><p>${esc(c.nome)} já possui uma cobrança registrada hoje. Deseja cobrar novamente?</p><div><button class="btn btn-light" data-repeat-cancel>Cancelar</button><button class="btn btn-primary" data-repeat-confirm>Cobrar novamente</button></div></section></div>`;$('[data-repeat-cancel]',root).onclick=close;$('[data-repeat-confirm]',root).onclick=()=>continuation();window.lucide?.createIcons()}
  async function openComposer(clientId,options={}){
    if(options.type==='receipt')return Utils.toast('Abra um recebimento confirmado para preparar a mensagem individual.',true);
    if(options.sequenceId)return MessageSequenceUI.resume({explicit:true});
    console.info('[CHARGE] whatsapp clicked');
    if(!mq.matches)return;
    if(!Mensagens.canSend())return Utils.toast('Seu acesso não permite enviar cobranças.',true);
    let c=client(clientId);const type=options.type||'charge';if(!c)return Utils.toast('Cliente não encontrado',true);
    try{c=await Mensagens.refreshCanonicalClient(clientId)}catch(error){Utils.toast(error.message||'Não foi possível atualizar o cliente.',true);return}
    if(type==='charge'&&Number(c.saldo)>=0)return Utils.toast('Este cliente não possui saldo em aberto para cobrança.',true);
    if(type==='charge'&&Mensagens.wasChargedToday(c)&&!options.allowRepeat)return duplicateWarning(clientId,()=>openComposer(clientId,{...options,allowRepeat:true}));
    const chosen=Mensagens.templates(type).find(item=>item.id===options.templateId)||Mensagens.defaultTemplate(type),base=options.baseMessage??chosen?.content??'',last=Mensagens.latestCharge(c),root=$('#modal'),position=options.sequenceId?`Enviando para ${Number(options.index||0)+1} de ${options.total||1}`:'Cobrança individual';
    root.innerHTML=`<div class="message-overlay"><section class="individual-message-sheet" role="dialog" aria-modal="true" aria-labelledby="message-sheet-title"><div class="sheet-handle"></div><header><div><small>${esc(position)}</small><h2 id="message-sheet-title">${esc(typeLabel(type))}</h2></div><button type="button" data-message-close aria-label="Fechar">${icon('x')}</button></header><div class="message-sheet-scroll"><section class="message-client-summary"><span>${esc(String(c.nome||'?').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase())}</span><div><h3>${esc(c.nome)}</h3><p>${esc(c.telefone)||'Sem telefone'}</p><small>Última cobrança: ${esc(Mensagens.formatLastChargeDate(last?.date))}</small></div>${type==='charge'?`<strong>${money(Math.abs(Number(c.saldo||0)))}<small>em aberto</small></strong>`:''}</section><label class="message-model-field">Modelo<select id="message-template">${templateOptions(type,chosen?.id)}</select></label><div class="message-template-actions"><button type="button" data-template-restore>${icon('rotate-ccw')} Restaurar</button><button type="button" data-template-duplicate>${icon('copy-plus')} Duplicar</button><button type="button" data-template-save>${icon('save')} Salvar novo</button><button type="button" data-template-default>${icon('star')} Usar como padrão</button></div><label class="message-text-field">Mensagem<textarea id="message-text" rows="9" maxlength="4000">${esc(base)}</textarea><span><b id="message-count">${base.length}</b>/4000 caracteres</span></label><div class="message-variables"><small>Inserir variável</small><div>${variableButtons()}</div></div><section class="message-preview"><header>${icon('eye')} Pré-visualização</header><p id="message-preview">${esc(Mensagens.resolve(base,c))}</p></section>${!Mensagens.validPhone(c)?`<p class="message-phone-error">${icon('phone-off')} Cadastre um telefone válido antes de enviar.</p>`:''}</div><footer>${options.sequenceId?`<button class="btn btn-light" type="button" data-sequence-skip>Pular</button><button class="btn btn-light" type="button" data-sequence-end>Encerrar</button>`:''}<button class="btn btn-whatsapp" type="button" id="message-send" ${Mensagens.validPhone(c)?'':'disabled'}>${icon('message-circle')} Enviar no WhatsApp</button></footer></section></div>`;
    const textarea=$('#message-text',root),select=$('#message-template',root),preview=()=>{$('#message-count',root).textContent=textarea.value.length;$('#message-preview',root).textContent=Mensagens.resolve(textarea.value,c)};
    textarea.addEventListener('input',()=>{preview();});select.addEventListener('change',()=>{const item=Mensagens.templates(type).find(entry=>entry.id===select.value);textarea.value=item?.content||'';preview()});
    $$('[data-message-variable]',root).forEach(button=>button.onclick=()=>{const token=`{{${button.dataset.messageVariable}}}`,start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??start;textarea.setRangeText(token,start,end,'end');textarea.focus();preview()});
    $('[data-template-restore]',root).onclick=()=>{const item=Mensagens.restoreTemplate(select.value);textarea.value=item?.content||'';preview();Utils.toast('Modelo restaurado')};
    $('[data-template-duplicate]',root).onclick=()=>{const item=Mensagens.duplicateTemplate(select.value);select.innerHTML=templateOptions(type,item?.id);textarea.value=item?.content||textarea.value;preview();Utils.toast('Modelo duplicado')};
    $('[data-template-save]',root).onclick=()=>{const name=prompt('Nome do novo modelo:');if(!name)return;const item=Mensagens.saveTemplate({name,type,content:textarea.value});select.innerHTML=templateOptions(type,item.id);Utils.toast('Modelo salvo')};
    $('[data-template-default]',root).onclick=()=>{const item=Mensagens.saveTemplate({id:select.value,name:select.options[select.selectedIndex]?.text.replace(' · padrão',''),type,content:textarea.value,isDefault:true});select.innerHTML=templateOptions(type,item.id);Utils.toast('Modelo definido como padrão')};
    $('[data-message-close]',root).onclick=close;
    const operationId=Utils.uuid();let sendInFlight=false,externalOpened=false;
    const executeSend=(layer)=>{if(sendInFlight)return;sendInFlight=true;const sendButton=$('#message-send',root),finalMessage=Mensagens.resolve(textarea.value,c);console.info('[WHATSAPP] charge confirmation accepted');let url;try{console.info('[WHATSAPP] customer validated');if(!client(c.id))throw Error('Cliente não encontrado.');console.info('[WHATSAPP] phone validated');if(!Mensagens.validPhone(c))throw Error('Telefone inválido. Revise o DDD e o número do cliente.');console.info('[WHATSAPP] message generated');if(!finalMessage)throw Error('Digite uma mensagem.');url=Mensagens.whatsappUrl(c,finalMessage);if(!externalOpened){const opened=Mensagens.openWhatsApp(url,{mobile:true});if(!opened.opened)throw Error('O navegador bloqueou a abertura do WhatsApp. Permita pop-ups e tente novamente.');externalOpened=true;if(options.sequenceId)console.info('[SEQUENCE] whatsapp opened')}const record=Mensagens.registerOpened({clientId:c.id,type,source:options.source||'individual',templateId:select.value||null,finalMessage,sequenceId:options.sequenceId||null,operationId});setPending({messageId:record.id,operationId,clientId:c.id,clientName:c.nome,type,finalMessage,url,sequenceId:options.sequenceId||null});close();Utils.toast(type==='charge'?'Abertura do WhatsApp registrada.':'Mensagem preparada.');refreshClients()}catch(error){console.error('[WHATSAPP] send failed',error);sendInFlight=false;layer?.remove();if(sendButton){sendButton.disabled=false;sendButton.textContent=externalOpened?'Concluir registro':'Enviar no WhatsApp'}Utils.toast(error.message||'Não foi possível abrir o WhatsApp.',true)}};
    $('#message-send',root).onclick=()=>{console.info('[WHATSAPP] action clicked');const finalMessage=Mensagens.resolve(textarea.value,c);if(!finalMessage)return Utils.toast('Digite uma mensagem',true);if(!Mensagens.validPhone(c))return Utils.toast('Telefone inválido. Revise o DDD e o número do cliente.',true);if(type!=='charge')return executeSend(null);if(root.querySelector('[data-charge-confirm-layer]'))return;const layer=document.createElement('div');layer.className='message-overlay message-confirm-layer';layer.dataset.chargeConfirmLayer='true';layer.innerHTML=`<section class="message-confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="charge-send-title"><div class="sheet-handle"></div>${icon('message-circle')}<h3 id="charge-send-title">Enviar cobrança?</h3><p>Esta cobrança será registrada como enviada hoje.</p><div><button class="btn btn-light" type="button" data-charge-send-cancel>Cancelar</button><button class="btn btn-primary" type="button" data-charge-send-continue>Continuar para WhatsApp</button></div></section>`;root.append(layer);$('[data-charge-send-cancel]',layer).onclick=()=>layer.remove();$('[data-charge-send-continue]',layer).onclick=()=>executeSend(layer);window.lucide?.createIcons()};
    preview();setTimeout(()=>textarea.focus(),80);window.lucide?.createIcons();
  }
  function centerClients() {
    // The list only decides WHO; the message type is chosen on the next screen.
    const charge = center.audience === 'debt';
    const data = Clientes.viewData?.() || DB.readForView?.() || DB.carregar();
    const candidates = (data.clientes || []).filter(item =>
      item.ativo !== false && item.active !== false && !item.deletedAt && (!charge || Number(item.saldo) < 0));
    const latest = charge ? Mensagens.latestCharges(data) : () => null;
    const lastCharges = new Map();
    const today = new Date().toDateString();
    let chargedToday = 0;
    const list = candidates.filter(item => {
      if (!charge) return true;
      const last = latest(item);
      if (last?.date && new Date(last.date).toDateString() === today) {
        chargedToday++;
        return false;
      }
      lastCharges.set(item.id, last);
      const balance = Math.abs(Number(item.saldo));
      if (center.min !== '' && balance < Number(center.min)) return false;
      if (center.max !== '' && balance > Number(center.max)) return false;
      if (center.days === 'todos') return true;
      if (center.days === 'nunca') return !last;
      return !last || Math.floor((Date.now() - new Date(last.date)) / 86400000) >= Number(center.days);
    });
    const debt = item => Math.abs(Number(item.saldo) || 0);
    list.sort((a, b) => center.sort === 'menor' ? debt(a) - debt(b) :
      center.sort === 'nome' ? String(a.nome).localeCompare(String(b.nome), 'pt-BR') : debt(b) - debt(a));
    const available = list.filter(Mensagens.validPhone);
    return {
      listed: center.phone ? available : list,
      available,
      ids: new Set(available.map(item => item.id)),
      withoutPhone: list.length - available.length,
      chargedToday,
      lastCharges,
    };
  }

  function centerHeader() {
    return `<header class="message-center-header">
      <button type="button" data-message-center-back>${icon('arrow-left')}<span>Voltar para Clientes</span></button>
      <h2 tabindex="-1">Central de mensagens</h2>
      ${window.ReceiptMessages?.canUse?.() || window.ReceiptMessages?.canManage?.() ? `<button type="button" class="message-center-receipts" data-open-receipt-center>${icon('receipt')}<span>Modelos de recibo</span></button>` : ''}
    </header>`;
  }

  function centerTabs() {
    return `<nav class="message-type-chips" aria-label="Tipos de mensagem">
      ${Object.entries(TYPE_LABELS).filter(([key]) => key === 'receipt' || Mensagens.canSend()).map(([key, label]) =>
        `<button type="button" data-message-type="${key}" aria-pressed="${center.type === key}" class="${center.type === key ? 'active' : ''}">${key === 'custom' ? 'Mensagem' : label}</button>`).join('')}
    </nav>`;
  }

  function renderCenter(roster) {
    if (center.type === 'receipt') return renderReceiptCenter();
    const { listed, available, ids, withoutPhone, chargedToday, lastCharges } = roster;
    const charge = center.audience === 'debt';
    if (!center.initialized) {
      center.selected = new Set(ids);
      center.initialized = true;
    } else {
      center.selected = new Set([...center.selected].filter(id => ids.has(id)));
    }
    persistCenter();
    const count = center.selected.size;
    const exclusions = [
      chargedToday ? `${chargedToday} já cobrados hoje` : '',
      withoutPhone ? `${withoutPhone} sem telefone válido` : '',
    ].filter(Boolean).join(' · ');
    return `<section class="message-center-page">
      ${centerHeader()}
      <p class="message-center-audience">${charge ? 'Clientes com saldo em aberto' : 'Todos os clientes ativos'} · tipo e modelo na próxima etapa</p>
      <div class="message-center-kpis" aria-live="polite">
        <article><strong data-center-available-count>${available.length}</strong><span>Disponíveis</span></article>
        <article><strong data-center-selected-count>${count}</strong><span>Selecionados</span></article>
      </div>
      ${exclusions ? `<p class="message-center-note">${exclusions}</p>` : ''}
      <p class="message-center-note" data-center-selected-total></p>
      <div class="message-center-controls">
        <button type="button" data-center-toggle-all ${available.length ? '' : 'disabled'}>${count === available.length && count > 0 ? 'Desmarcar todos' : 'Selecionar todos'}</button>
        <button type="button" data-center-filters>${icon('list-filter')} Filtros</button>
      </div>
      <div class="message-center-list">
        ${listed.map(item => {
          const valid = ids.has(item.id), last = lastCharges.get(item.id);
          const detail = valid ? item.telefone : 'Sem telefone válido';
          const initials = String(item.nome || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
          return `<label class="message-center-client${valid ? '' : ' is-unavailable'}">
            <input type="checkbox" data-center-client="${esc(item.id)}" ${center.selected.has(item.id) ? 'checked' : ''} ${valid ? '' : 'disabled'}>
            <span class="message-check" aria-hidden="true"></span>
            <span class="message-client-avatar" aria-hidden="true">${esc(initials)}</span>
            <span class="message-center-client-copy">
              <b>${esc(item.nome)}</b>
              <small>${esc(detail)}${charge ? ' · ' + esc(Mensagens.formatLastChargeDate(last?.date)) : ''}</small>
            </span>
            ${charge ? `<strong>${money(Math.abs(Number(item.saldo)))}</strong>` : ''}
          </label>`;
        }).join('') || '<div class="message-center-empty"><h3>Nenhum cliente neste filtro</h3><p>Altere os filtros para consultar outros clientes.</p></div>'}
      </div>
      <footer class="message-center-footer">
        <button type="button" class="btn btn-primary" data-center-start ${count ? '' : 'disabled'}>${icon('play')} Iniciar sequência</button>
      </footer>
    </section>`;
  }
  function renderReceiptCenter(){return `<section class="message-center-page">${centerHeader()}${Mensagens.canSend()?`<button type="button" class="message-center-back-selection" data-back-selection>${icon('arrow-left')} Voltar à seleção de clientes</button>`:''}<div class="receipt-model-heading"><h2>Recebimentos</h2>${ReceiptMessages.canManage()?'<button class="btn btn-primary" type="button" data-receipt-new-model>Novo modelo</button>':''}</div><p class="receipt-model-help">Mensagens individuais liberadas somente após o recibo remoto e a conferência do saldo. Abra o recebimento em Clientes ou Fiado para compartilhar. Esta categoria não participa de disparos em massa.</p><div class="receipt-template-list">${ReceiptMessages.list().map(t=>`<article class="receipt-template-card"><h3>${esc(t.name)}</h3><small>${t.receiptKind==='total'?'Saldo quitado':'Saldo em aberto'}${t.isDefault?' · Modelo padrão':''}</small><p>${esc(t.content)}</p>${ReceiptMessages.canManage()?`<button class="btn btn-light" type="button" data-receipt-edit-model="${esc(t.id)}">Editar modelo</button>`:''}</article>`).join('')}</div>${ReceiptMessages.canManage()?'':'<p>Somente o gestor autorizado pode alterar os modelos da empresa.</p>'}</section>`;}
  let clientListScroll = 0;

  async function openCenter(options = {}) {
    if (!Mensagens.canSend() && !window.ReceiptMessages?.canUse() && !window.ReceiptMessages?.canManage())
      return Utils.toast('Seu acesso não permite enviar mensagens.', true);
    const app = $('#app'), page = app.firstElementChild, instance = app.dataset.pageInstance;
    const route = window.Router?.atual?.();
    try {
      if (options.type !== 'receipt' && Mensagens.canSend()) await restoreCenter();
      if (app.firstElementChild !== page || app.dataset.pageInstance !== instance || window.Router?.atual?.() !== route) return;
      if (!page?.classList.contains('message-center-page')) {
        clientListScroll = window.scrollY;
        window.ClientesMobile?.cancelPending?.();
      }
      if (options.type === 'receipt' || !Mensagens.canSend()) center.type = 'receipt';
      else if (Array.isArray(options.clientIds)) {
        // Coming from Campanhas: open with that audience already selected.
        Object.assign(center, { type: SEQUENCE_TYPES.includes(options.type) ? options.type : 'campaign', audience: 'all', days: 'todos', min: '', max: '',
          selected: new Set(options.clientIds.map(String)), initialized: true });
      } else if (center.type === 'receipt') center.type = 'charge';
      refreshCenter();
      $('#title').textContent = 'Mensagens';
      $('#date').textContent = '';
      scrollTo({ top: 0 });
      $('.message-center-header h2', app)?.focus({ preventScroll: true });
      if (center.type !== 'receipt') await MessageSequenceUI.resume({ explicit: true });
    } catch (error) {
      Utils.toast(MessageSequence.friendly(error), true);
    }
  }

  function backToClients() {
    if (center.type !== 'receipt') persistCenter();
    if (window.Router?.atual?.() !== 'clientes') {
      window.Router?.ir?.('clientes');
      return;
    }
    if (!window.AppPageRuntime?.mount?.('clientes')) return;
    const trigger = $('#mobile-message-center, [data-open-receipt-models]');
    trigger?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (trigger?.isConnected) scrollTo({ top: clientListScroll });
    });
  }

  function refreshCenter() {
    const app = $('#app');
    if (!app) return;
    const roster = center.type === 'receipt' ? null : centerClients();
    app.innerHTML = renderCenter(roster);
    bindCenter(roster);
    window.lucide?.createIcons();
  }
  function filterSheet() {
    const root = $('#modal');
    root.innerHTML = `<div class="message-overlay message-center-filter">
      <section class="message-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="center-filters-title">
        <div class="sheet-handle"></div>
        <header><h3 id="center-filters-title">Filtros da Central</h3>
          <button type="button" data-message-close aria-label="Fechar filtros">${icon('x')}</button>
        </header>
        <label>Saldo<select id="center-audience">
          <option value="debt">Com saldo em aberto</option>
          <option value="all">Todos os clientes ativos</option>
        </select></label>
        <label>Ordenação<select id="center-sort">
          <option value="maior">Maior dívida primeiro</option>
          <option value="menor">Menor dívida</option>
          <option value="nome">Nome A–Z</option>
        </select></label>
        ${center.audience === 'debt' ? `
          <label>Última cobrança<select id="center-days">
            <option value="todos">Todos os períodos</option>
            <option value="nunca">Nunca cobrados</option>
            ${[3, 7, 15, 30].map(days => `<option value="${days}">Há pelo menos ${days} dias</option>`).join('')}
          </select></label>
          <div class="message-filter-values">
            <label>Valor mínimo<input id="center-min" inputmode="decimal" value="${esc(center.min)}"></label>
            <label>Valor máximo<input id="center-max" inputmode="decimal" value="${esc(center.max)}"></label>
          </div>` : ''}
        <label class="message-filter-check"><input id="center-phone" type="checkbox" ${center.phone ? 'checked' : ''}> Mostrar apenas clientes com telefone válido</label>
        <button class="btn btn-primary" type="button" data-center-apply>Aplicar filtros</button>
      </section>
    </div>`;
    $('#center-sort', root).value = center.sort;
    $('#center-audience', root).value = center.audience;
    $('#center-audience', root).onchange = event => { if (event.target.value !== center.audience) { center.audience = event.target.value; center.initialized = false; close(); refreshCenter(); filterSheet(); } };
    if ($('#center-days', root)) $('#center-days', root).value = center.days;
    $('[data-message-close]', root).onclick = () => {
      close();
      $('[data-center-filters]')?.focus({ preventScroll: true });
    };
    $('[data-center-apply]', root).onclick = () => {
      const min = ($('#center-min', root)?.value || '').trim().replace(',', '.');
      const max = ($('#center-max', root)?.value || '').trim().replace(',', '.');
      if (center.audience === 'debt') {
        if ([min, max].some(value => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) ||
            min !== '' && max !== '' && Number(min) > Number(max)) {
          Utils.toast('Informe uma faixa de valores válida.', true);
          return;
        }
        center.days = $('#center-days', root).value;
        center.min = min;
        center.max = max;
      }
      center.sort = $('#center-sort', root).value;
      center.phone = $('#center-phone', root).checked;
      close();
      refreshCenter();
      $('[data-center-filters]')?.focus({ preventScroll: true });
    };
    $('#center-sort', root).focus({ preventScroll: true });
    window.lucide?.createIcons();
  }

  function updateCenterSelection(page, { available, ids }) {
    const count = center.selected.size, label = $('[data-center-selected-count]', page);
    label.textContent = count;
    const total = $('[data-center-selected-total]', page);
    if (total) {
      const cents = available.filter(item => center.selected.has(item.id))
        .reduce((sum, item) => sum + Math.max(0, Math.round(-Number(item.saldo) * 100)), 0);
      total.textContent = `Saldo em aberto da seleção: ${money(cents / 100)}`;
    }
    const toggle = $('[data-center-toggle-all]', page);
    toggle.textContent = count === ids.size && count > 0 ? 'Desmarcar todos' : 'Selecionar todos';
    $('[data-center-start]', page).disabled = sequenceStarting || !count;
  }

  function bindCenter(roster) {
    const page = $('.message-center-page');
    const refreshModels = () => { if (page.isConnected) refreshCenter(); };
    $$('[data-receipt-edit-model]', page).forEach(button => {
      button.onclick = () => ReceiptMessageUI.editor(button.dataset.receiptEditModel, { onSaved: refreshModels });
    });
    $('[data-receipt-new-model]', page)?.addEventListener('click', () => ReceiptMessageUI.editor(null, { onSaved: refreshModels }));
    $('[data-open-receipt-center]', page)?.addEventListener('click', () => { center.type = 'receipt'; refreshCenter(); });
    $('[data-back-selection]', page)?.addEventListener('click', () => { center.type = center.audience === 'debt' ? 'charge' : 'campaign'; refreshCenter(); });
    $$('[data-message-type]', page).forEach(button => {
      button.onclick = () => {
        const type = button.dataset.messageType;
        if (type === center.type || type !== 'receipt' && !Mensagens.canSend()) return;
        center.type = type;
        center.initialized = false;
        refreshCenter();
        $(`[data-message-type="${type}"]`)?.focus({ preventScroll: true });
      };
    });
    $('[data-message-center-back]', page).onclick = backToClients;
    if (center.type === 'receipt') return;

    const checkboxes = $$('[data-center-client]', page);
    const applySelection = () => {
      updateCenterSelection(page, roster);
      persistCenter();
    };
    $('[data-center-toggle-all]', page).onclick = () => {
      center.selected = center.selected.size === roster.ids.size ? new Set() : new Set(roster.ids);
      checkboxes.forEach(input => { input.checked = center.selected.has(input.dataset.centerClient); });
      applySelection();
    };
    checkboxes.forEach(input => {
      input.onchange = () => {
        const id = input.dataset.centerClient;
        if (!roster.ids.has(id)) return;
        if (input.checked) center.selected.add(id);
        else center.selected.delete(id);
        applySelection();
      };
    });
    $('[data-center-filters]', page).onclick = filterSheet;
    $('[data-center-start]', page).onclick = startSequence;
    updateCenterSelection(page, roster);
  }

  async function startSequence() {
    if (center.type === 'receipt') return Utils.toast('Recebimentos não podem ser enviados em sequência.', true);
    if (sequenceStarting || !Mensagens.canSend()) return;
    console.info('[SEQUENCE] start clicked');
    const { available } = centerClients();
    const ids = available.map(item => item.id).filter(id => center.selected.has(id));
    console.info(`[SEQUENCE] selected customers = ${ids.length}`);
    if (!ids.length) {
      refreshCenter();
      return Utils.toast('Selecione ao menos um cliente com telefone válido.', true);
    }
    const type = SEQUENCE_TYPES.includes(center.type) && (center.audience === 'debt' || center.type !== 'charge') ? center.type : (center.audience === 'debt' ? 'charge' : 'campaign'), button = $('[data-center-start]'), scope = window.SpaceContext?.viewScope?.();
    sequenceStarting = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparando sequência…';
    }
    try {
      await persistCenter();
      if (button && !button.isConnected || window.SpaceContext?.viewScope?.() !== scope || !Mensagens.canSend()) return;
      const template = MessageSequenceUI.defaultTemplate(type);
      await MessageSequenceUI.start({ type, clientIds: ids, templateId: template?.id, baseMessage: template?.content || '' });
    } catch (error) {
      Utils.toast(MessageSequence.friendly(error), true);
    } finally {
      sequenceStarting = false;
      const currentButton = $('[data-center-start]');
      if (currentButton) {
        currentButton.disabled = !center.selected.size;
        currentButton.innerHTML = `${icon('play')} Iniciar sequência`;
        window.lucide?.createIcons();
      }
    }
  }
  function showReturn(){if($('#modal .receipt-message-dialog'))return;const pending=getPending();if(pending?.sequenceId)return MessageSequenceUI.resume({explicit:true});if($('#modal [data-sequence-layer]'))return;if(!pending||returnShown||document.visibilityState!=='visible')return;returnShown=true;console.info('[SEQUENCE] waiting for next');const root=$('#modal'),c=client(pending.clientId);root.innerHTML=`<div class="message-overlay"><section class="message-return-sheet" role="dialog" aria-modal="true"><div class="message-success-icon">${icon('check')}</div><h2>Mensagem preparada</h2><p>A conversa de <b>${esc(pending.clientName||c?.nome)}</b> foi aberta no WhatsApp.</p><small>O app não consegue confirmar o envio dentro do WhatsApp.</small><button class="btn btn-primary" type="button" data-return-next>${pending.sequenceId?'Marcar enviado e próximo':'Concluir'}</button><button class="btn btn-light" type="button" data-return-reopen>Reabrir mensagem</button><button class="btn btn-light" type="button" data-return-not-sent>Marcar como não enviado</button></section></div>`;$('[data-return-reopen]',root).onclick=()=>{const opened=Mensagens.openWhatsApp(pending.url,{mobile:true});if(!opened.opened)Utils.toast('O navegador bloqueou o WhatsApp.',true)};$('[data-return-next]',root).onclick=()=>{setPending(null);returnShown=false;close();refreshClients()};$('[data-return-not-sent]',root).onclick=()=>{Mensagens.markNotSent(pending.messageId);setPending(null);returnShown=false;close();refreshClients()};window.lucide?.createIcons()}
  window.AppLifecycle?.onResume?.(()=>new Promise(resolve=>setTimeout(()=>{showReturn();resolve()},180)));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(showReturn,180)});addEventListener('focus',()=>setTimeout(showReturn,180));setTimeout(showReturn,0);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#modal .individual-message-sheet'))close()});
  function rememberType(type){if(SEQUENCE_TYPES.includes(type)){center.type=type;persistCenter();}}
  window.MobileMessages={openComposer,openCenter,refreshCenter,showReturn,startSequence,rememberType,formatLastChargeDate:Mensagens.formatLastChargeDate};
})();

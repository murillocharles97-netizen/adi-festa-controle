(() => {
  'use strict';

  const spaceNames = {adi: 'Adi Festa', card: 'Emprestar Cartão'};
  const decisions = {...spaceNames, review: 'Preciso conferir'};
  const brl = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
  const dateFormat = new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'});
  const money = cents => brl.format(cents / 100);
  const date = value => value.split('-').reverse().join('/');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const icon = name => '<i data-lucide="' + name + '" aria-hidden="true"></i>';
  const byId = id => document.getElementById(id);
  const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);
  const balance = (space, due, future, confirmed) => ({space, due, future, confirmed});
  const remote = {accounts: [], cursor: null};
  const state = {filter: 'pending', query: '', accountId: null, recordId: null};
  let confirmation, openingDraft, noticeTimer;
  let busy = false;

  const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  const available = () => remote.accounts;
  const current = () => available().find(account => account.id === state.accountId);
  const initials = name => name.split(' ').slice(0, 2).map(part => part[0]).join('');
  const status = (text, style) => '<span class="status ' + style + '">' + esc(text) + '</span>';
  const evidenceFor = account => new Map(account.records.filter(item => item.evidence).map(item => [item.id, item.evidence]));

  function accountState(account, latest) {
    const outstanding = account.records.filter(item => !item.origin && !spaceNames[latest.get(item.id)?.choice]).length;
    if (!account.loaded) return {text: 'Abrir conferência', style: 'review', outstanding};
    if (account.openingConfirmed) return {text: 'Saldo final confirmado', style: 'ready', outstanding};
    if (account.ready) return {text: 'Pronto para regularização', style: 'ready', outstanding};
    if (account.issue || outstanding || account.serverState === 'origin_pending')
      return {text: 'Origem pendente', style: account.issue ? 'divergent' : 'pending', outstanding};
    return {text: 'Origem confirmada · saldo a validar', style: 'review', outstanding};
  }

  function filtered() {
    return remote.accounts.filter(account => normalize(account.name).includes(normalize(state.query)));
  }

  function select(account) {
    state.accountId = account?.id;
    const latest = account ? evidenceFor(account) : new Map();
    state.recordId = account?.records.find(item => !item.origin && !spaceNames[latest.get(item.id)?.choice])?.id || account?.records[0]?.id;
  }

  function decorate() {
    window.lucide?.createIcons();
  }

  function renderOverview() {
    const metrics = [
      [remote.accounts.length, 'Contas carregadas', 'users'],
      [current()?.records.length || 0, 'Lançamentos na conta', 'list-checks'],
      [current()?.records.filter(item => item.batchEligible).length || 0, 'Candidatos ao lote', 'link-2']
    ];
    byId('overview').innerHTML = metrics.map(([number, label, glyph]) =>
      '<div class="metric"><span class="metric-icon">' + icon(glyph) + '</span><strong>' + number +
      '</strong><span class="metric-label">' + label + '</span></div>').join('');
  }

  function renderList() {
    const rows = filtered();
    if (!rows.some(account => account.id === state.accountId)) select(rows[0]);
    document.querySelectorAll('[data-filter]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
    const lotAction=state.filter==='batch'&&rows.length?'<li class="lot-action"><button type="button" class="btn secondary" data-review-lot>'+icon('clipboard-list')+' Revisar lote inicial</button></li>':'';
    byId('accounts').innerHTML = lotAction + (rows.map(account => {
      const latest = evidenceFor(account);
      const result = accountState(account, latest);
      const amount = money(account.bookBalanceCents);
      const description = !account.loaded ? 'Saldo cadastral' : account.ready ? plural(account.records.length, 'vínculo validado', 'vínculos validados') :
        result.outstanding ? plural(result.outstanding, 'origem a conferir', 'origens a conferir') : 'Origens conferidas';
      return '<li><button type="button" class="account-button" data-account="' + esc(account.id) + '" aria-current="' +
        (state.accountId === account.id) + '"><span class="account-avatar" aria-hidden="true">' + esc(initials(account.name)) +
        '</span><span class="account-copy"><strong>' + esc(account.name) + '</strong><small>' + description +
        '</small></span><span class="account-tail"><b>' + esc(amount) + '</b>' + status(result.text, result.style) +
        '</span></button></li>';
    }).join('') || '<li class="empty">Nenhum cliente encontrado.</li>') +
      (remote.cursor ? '<li><button type="button" class="btn secondary" data-more>Carregar mais</button></li>' : '');
  }

  function renderBalances(account) {
    if (!account.balances.length) return '<p class="balance-note">Saldo cadastral da conta · ' + money(account.bookBalanceCents) + '. A prova por espaço será conferida na revisão.</p>';
    return '<div class="balances">' + account.balances.map(row =>
      '<div class="balance"><h3>' + spaceNames[row.space] + '</h3><strong>' + money(row.due) +
      '</strong><p>' + (row.confirmed ? 'Exigível' : 'Exigível a conferir') + '</p>' +
      (row.future ? '<p>' + money(row.future) + ' em parcelas futuras</p>' : '') + '</div>').join('') +
      '</div><p class="balance-note">Prévia financeira por espaço. Confirmar uma origem registra somente a evidência.</p>';
  }

  function recordForm(item, evidence) {
    const choices = Object.entries(decisions).filter(([choice]) => choice === 'review' || item.destinations.includes(choice)).map(([choice, label]) =>
      '<label class="origin-choice"><input type="radio" name="origin" value="' + choice + '"' +
      (choice === evidence?.choice ? ' checked' : '') + '><span>' + label + '</span></label>').join('');
    return '<form data-confirm="' + esc(item.id) + '">' +
      '<fieldset class="origin-options"><legend>Confirme o espaço</legend><div class="origin-grid">' + choices + '</div></fieldset>' +
      '<label class="note-label">Anotação de conferência <span>Registre a fonte e a data. Evite copiar conversas ou dados pessoais.</span>' +
      '<textarea name="note" maxlength="180" rows="2" placeholder="O que você conferiu?">' + esc(evidence?.note) + '</textarea></label>' +
      '<div class="record-actions"><button type="submit" class="btn primary" disabled>' + icon('check') + ' Salvar confirmação</button>' +
      (evidence ? '<small>Registrada em ' + esc(dateFormat.format(new Date(evidence.at))) + '</small>' : '') + '</div></form>';
  }

  function renderRecord(item, evidence) {
    const origin = item.origin ? (spaceNames[item.origin] || 'Outro espaço registrado') : evidence ? decisions[evidence.choice] : 'Sem espaço confirmado';
    const waiting = !item.origin && !spaceNames[evidence?.choice];
    const description = item.origin ? 'Origem conhecida no histórico' : evidence && spaceNames[evidence.choice] ? 'Confirmação administrativa' : 'Origem a confirmar';
    const message = item.origin ?
      '<p class="record-context">' + icon('lock-keyhole') + ' Origem conhecida <strong>' + esc(origin) + '</strong></p>' :
      '<p class="record-context">' + icon('map-pin') + ' ' + (item.conflict ? 'Divergência no histórico. Registre uma nota para revisão.' :
        item.knownOrigin ? 'Origem registrada em parte da evidência · <strong>' + esc(spaceNames[item.knownOrigin]||'Outro espaço registrado') + '</strong>' :
          isBatchEligible(current(),item,evidence) ? 'Sugestão <strong>Adi Festa</strong> · registro antigo sem espaço' : 'Confira a origem individualmente.') +
      (item.fromInitialLot?' · Lote inicial':'') +
      '</p>' + recordForm(item, evidence);
    return '<details class="record" data-record="' + esc(item.id) + '"' + (state.recordId === item.id ? ' open' : '') +
      '><summary><span class="record-title"><strong>' + esc(item.label) + '</strong><span>' + (item.day ? date(item.day) : 'Data a conferir') +
      ' · ' + description + '</span></span><span class="record-side"><strong>' + (item.cents===null?'Valor a conferir':money(item.cents)) + '</strong><span' +
      (waiting ? ' class="waiting"' : '') + '>' + esc(origin) + '</span></span></summary><div class="record-content">' +
      message + '</div></details>';
  }

  function recordsBySpace(account, latest) {
    const groups = {review: [], adi: [], card: [], other: []};
    for (const item of account.records) {
      const evidence = latest.get(item.id);
      const origin = item.origin || evidence?.choice || 'review';
      groups[origin].push(renderRecord(item, evidence));
    }
    return Object.entries(groups).filter(([, rows]) => rows.length).map(([origin, rows]) =>
      '<section class="record-group"><h4>' + (origin === 'other' ? 'Outro espaço registrado' : spaceNames[origin] || 'Sem origem confirmada') + '</h4>' + rows.join('') + '</section>'
    ).join('');
  }

  function renderDetail() {
    const account = current();
    if (!account) {
      byId('detail').innerHTML = '<p class="empty">Selecione uma conta para ver os lançamentos.</p>';
      return;
    }
    if (!account.loaded) {
      byId('detail').innerHTML = '<p class="empty">Abra a conta para consultar os lançamentos.</p>';
      return;
    }
    const latest = evidenceFor(account);
    const result = accountState(account, latest);
    const canBatch = account.records.some(item => isBatchEligible(account,item,latest.get(item.id)));
    const intro = account.issue || (account.ready ? 'Origens e saldos conferidos para a revisão.' :
      'Confira os lançamentos por espaço antes de revisar a conta.');
    byId('detail').innerHTML =
      '<header class="detail-head"><button type="button" class="mobile-back" data-back>' + icon('arrow-left') +
      ' Voltar às contas</button><div class="detail-identity"><div><h2 tabindex="-1" id="selected-account">' +
      esc(account.name) + '</h2><p>' + esc(intro) + '</p></div>' + status(result.text, result.style) + '</div>' +
      renderBalances(account) +
      (account.openingEnabled&&!account.openingConfirmed?'<button type="button" class="btn primary" data-opening>' +
        icon('calculator') + ' Conferir saldo final</button>':'') +
      '</header><section class="records"><div class="records-heading"><h3>Lançamentos</h3>' +
      (canBatch ? '<button type="button" class="btn secondary" data-batch>' + icon('list-checks') + ' Conferir em lote</button>' : '') +
      '</div><p class="record-count">' +
      plural(account.records.length, 'lançamento', 'lançamentos') + ' · ' +
      (result.outstanding ? plural(result.outstanding, 'origem a conferir', 'origens a conferir') : 'Origens conferidas') +
      '</p><div class="record-stack">' + recordsBySpace(account, latest) +
      '</div></section><footer class="detail-footer"><span>' + (account.ready ? 'Origens e saldos conferidos' : 'Evidências administrativas') +
      '</span><button type="button" class="btn secondary" data-review>' + icon('clipboard-list') + ' Revisar conta</button></footer>';
  }

  function reviewGroup(account, origin, rows) {
    const row = account.balances.find(balance => balance.space === origin);
    const reference = row ? '<p>' + (row.confirmed ? 'Exigível' : 'Exigível a conferir') + ' · ' + money(row.due) +
      (row.future ? ' · Futuras ' + money(row.future) : '') + '</p>' : '';
    return '<section class="review-group"><h3>' + (origin==='other'?'Outro espaço registrado':spaceNames[origin] || 'Preciso conferir') + '</h3>' +
      reference + '<ul>' + rows.join('') + '</ul></section>';
  }

  function showReview() {
    const account = current();
    if (!account) return;
    const latest = evidenceFor(account);
    const groups = Object.fromEntries(Object.keys(spaceNames).concat('review','other').map(key => [key, []]));
    for (const item of account.records) {
      const evidence = latest.get(item.id);
      const origin = item.origin || evidence?.choice || 'review';
      groups[origin].push('<li><strong>' + esc(item.label) + ' · ' + (item.cents===null?'Valor a conferir':money(item.cents)) + '</strong><small>' +
        (item.day?date(item.day):'Data a conferir') + ' · ' + (item.origin ? 'Origem conhecida' : evidence ? 'Confirmação do proprietário' : 'Sem confirmação') +
        '</small>' + (evidence?.note ? '<small>Anotação · ' + esc(evidence.note) + '</small>' : '') + '</li>');
    }
    const result = accountState(account, latest);
    byId('review-content').innerHTML =
      '<header class="review-head"><div><h2 id="review-title">Resumo da revisão</h2><p>' + esc(account.name) + '</p></div>' +
      '<form method="dialog"><button class="close" aria-label="Fechar resumo">' + icon('x') + '</button></form></header>' +
      '<div class="review-body">' + status(result.text, result.style) + '<p>' +
      esc(account.issue || account.reviewIssue || (account.ready ? 'O validador V2 comprovou o saldo e os vínculos desta conta.' :
        result.outstanding ? 'Ainda há lançamentos que precisam de conferência.' :
          'As origens foram conferidas. A conta ainda precisa da validação financeira V2.')) + '</p>' +
      '<div class="review-groups">' + Object.entries(groups).filter(([, rows]) => rows.length).map(([origin, rows]) =>
        reviewGroup(account, origin, rows)).join('') + '</div><p>A aplicação financeira está desabilitada nesta etapa.</p></div>' +
      '<form class="review-footer" method="dialog"><button class="btn secondary">Voltar à conta</button></form>';
    decorate();
    if (!byId('review').open) byId('review').showModal();
  }

  function render() {
    renderOverview();
    renderList();
    renderDetail();
    decorate();
  }

  function notify(message) {
    clearTimeout(noticeTimer);
    byId('notice').textContent = message;
    noticeTimer = setTimeout(() => { byId('notice').textContent = ''; }, 4200);
  }

  function navigate(view) {
    byId('workspace').dataset.view = view;
    if (!matchMedia('(max-width: 759px)').matches) return;
    window.scrollTo(0, 0);
    if (view === 'detail') byId('selected-account')?.focus({preventScroll: true});
    else byId('accounts').querySelector('[aria-current="true"]')?.focus({preventScroll: true});
  }

  function values(form) {
    return {choice: form.querySelector('[name="origin"]:checked')?.value, note: form.elements.note.value.trim()};
  }

  function save(form) {
    const account = current();
    const item = account?.records.find(row => row.id === form.dataset.confirm);
    const {choice, note} = values(form);
    if (!item || item.origin || !Object.hasOwn(decisions, choice) || note.length > 180) return;
    const previous = evidenceFor(account).get(item.id);
    if (previous?.choice === choice && previous.note === note) return;
    run(()=>prepareEvidence(account,'individual',[{recordId:item.id,choice,note}]));
  }

  function isBatchEligible(_account,item,evidence) {
    return item.batchEligible&&!item.origin&&!item.conflict&&!evidence;
  }

  function showDialog(title,account,body,footer) {
    byId('review-content').innerHTML='<header class="review-head"><div><h2 id="review-title">'+esc(title)+
      '</h2><p>'+esc(account.name)+'</p></div><form method="dialog"><button class="close" aria-label="Fechar revisão">'+
      icon('x')+'</button></form></header><div class="review-body">'+body+'</div><footer class="review-footer">'+footer+'</footer>';
    decorate();
    if(!byId('review').open)byId('review').showModal();
  }

  const spaceLabel = (account,id) => spaceNames[Object.keys(account.spaceIds).find(key=>account.spaceIds[key]===id)];
  const displayAmount = cents => (cents/100).toFixed(2).replace('.',',');
  const readCents = value => {
    const parts=String(value).trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
    if(!parts)throw Error('Informe os valores em reais, com até duas casas decimais.');
    const cents=Number(parts[1])*100+Number((parts[2]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(cents))throw Error('Valor inválido.');
    return cents;
  };

  async function showOpening(account) {
    const quote=await call('openingPreview',{clientId:account.id});
    openingDraft=null;
    showDialog('Conferir saldo final',account,
      '<p>Saldo cadastral: <strong>'+money(quote.bookCents)+'</strong>. Adi Festa é o padrão. Ajuste a divisão somente para exceções comprovadas.</p>'+
      '<form id="opening-balances">'+quote.parts.map(part=>
        '<label class="note-label">'+esc(spaceLabel(account,part.spaceId))+' · saldo total, incluindo parcelas'+
        '<input type="text" required inputmode="decimal" data-opening-space="'+esc(part.spaceId)+'" value="'+displayAmount(part.totalCents)+'"></label>'
      ).join('')+'</form>',
      '<button type="submit" form="opening-balances" class="btn primary">Revisar saldo final</button>');
  }

  async function reviewOpening(account,form) {
    const balances=[...form.querySelectorAll('[data-opening-space]')].map(input=>
      ({spaceId:input.dataset.openingSpace,totalCents:readCents(input.value)}));
    const quote=await call('openingPreview',{clientId:account.id,balances});
    openingDraft={clientId:account.id,balances,reviewHash:quote.reviewHash,requestId:crypto.randomUUID()};
    showDialog('Revisar saldo final',account,
      '<p>Total cadastral preservado: <strong>'+money(quote.bookCents)+'</strong>. Os lançamentos anteriores ficam no histórico. As parcelas mantêm seus vencimentos.</p>'+
      '<div class="batch-list">'+quote.parts.map(part=>'<div class="batch-row"><strong>'+esc(spaceLabel(account,part.spaceId))+
        '</strong><span>'+money(part.dueCents)+' exigíveis · '+money(part.futureCents)+' futuros</span></div>').join('')+'</div>'+
      '<label class="note-label"><span><input type="checkbox" data-opening-queue> Conferi a sincronização e os recebimentos pendentes em todos os aparelhos.</span></label>',
      '<button type="button" class="btn secondary" data-opening>Voltar</button>'+
      '<button type="button" class="btn primary" data-opening-confirm disabled>Confirmar saldo final</button>');
  }

  async function confirmOpening(account) {
    const draft=openingDraft;
    if(draft?.clientId!==account?.id||!byId('review').querySelector('[data-opening-queue]')?.checked)return;
    await call('openingConfirm',{...draft,confirmed:true,queueChecked:true});
    await loadAccount(account);
    openingDraft=null;
    byId('review').close();
    render();
    notify('Saldo final confirmado e auditado.');
  }

  async function showLotReview() {
    const lot=await call('reviewLot');
    const captions={origin_pending:'Origem pendente',balance_to_validate:'Origem confirmada · saldo a validar',ready:'Pronto para regularização'};
    const rows=lot.accounts.map(account=>'<div class="batch-row"><span class="batch-copy"><strong>'+esc(account.name)+
      '</strong><small>'+esc(captions[account.state])+'</small></span><strong class="batch-value">'+
      plural(account.confirmedOrigins,'origem','origens')+'</strong>'+
      (account.state==='ready'&&account.routing?.length?'<span class="batch-destination">'+account.routing.map(row=>{
        const space=lot.spaces?.find(item=>item.id===row.spaceId);
        return esc(space?.name||'Espaço verificado')+' · '+money(row.after.dueCents)+' exigíveis'+
          (row.after.futureCents?' · '+money(row.after.futureCents)+' futuros':'');
      }).join('<br>')+'</span>':'')+'</div>');
    showDialog('Resumo do lote inicial',{name:plural(lot.accounts.length,'conta','contas')},
      '<p>Conferência das origens e da prova por conta. A aplicação financeira está desabilitada.</p>'+
      '<div class="batch-list">'+rows.join('')+'</div>',
      '<form method="dialog"><button class="btn secondary">Voltar às contas</button></form>');
  }

  function selectionItem(item,control='') {
    return '<span class="batch-copy"><strong>'+esc(item.label)+'</strong><small>'+
      (item.day?date(item.day):'Data a conferir')+'</small></span><strong class="batch-value">'+
      (item.cents===null?'Valor a conferir':money(item.cents))+'</strong>'+control;
  }

  function showBatch() {
    const account=current(),latest=evidenceFor(account);
    const items=account.records.filter(item=>isBatchEligible(account,item,latest.get(item.id)));
    if(!items.length)return;
    const previous=confirmation?.accountId===account.id&&confirmation.mode==='batch'?
      new Set(confirmation.items.map(item=>item.recordId)):null;
    const rows=items.map(item=>'<label class="batch-row">'+selectionItem(item,
      '<input type="checkbox" data-batch-record value="'+esc(item.id)+'"'+
      (!previous||previous.has(item.id)?' checked':'')+' aria-label="Incluir '+esc(item.label)+'">')+'</label>');
    showDialog('Conferir em lote',account,
      '<p>Sugestão <strong>Adi Festa</strong>. Desmarque as exceções para conferi-las individualmente.</p>'+
      '<div class="batch-list">'+rows.join('')+'</div>',
      '<button type="button" class="btn primary" data-review-batch>Revisar seleção</button>');
  }

  async function prepareEvidence(account,mode,items) {
    if(items.some(item=>!account.records.some(row=>row.id===item.recordId)))throw Error('Confira novamente os lançamentos.');
    const payload={mode,revision:account.revision,items:items.map(({recordId,choice,note})=>
      ({recordId,spaceId:account.spaceIds[choice]??null,note}))};
    const preview=await call('prepare',{clientId:account.id,...payload});
    confirmation={accountId:account.id,mode,items,requestId:crypto.randomUUID(),payload,reviewHash:preview.reviewHash};
    const selected=preview.items.map(item=>{
      const record=account.records.find(row=>row.id===item.recordId);
      return {record:{...record,cents:item.valueCents===null?null:Math.abs(item.valueCents),day:item.date},note:item.note,
        choice:Object.keys(account.spaceIds).find(key=>account.spaceIds[key]===item.spaceId)||'review'};
    });
    const excluded=mode==='batch'?account.records.filter(item=>isBatchEligible(account,item,evidenceFor(account).get(item.id))).length-selected.length:0;
    showDialog('Revisar confirmações',account,
      '<p>'+plural(selected.length,'lançamento selecionado','lançamentos selecionados')+
      (excluded?' · '+plural(excluded,'exceção fora deste lote','exceções fora deste lote'):'')+'</p><div class="batch-list">'+
      selected.map(({record,choice,note})=>'<div class="batch-row">'+selectionItem(record)+
        '<span class="batch-destination">'+esc(decisions[choice])+(note?' · '+esc(note):'')+'</span></div>').join('')+
      '</div><p>O saldo e o caixa permanecem como estão. Esta etapa registra a evidência de origem.</p>',
      (mode==='batch'?'<button type="button" class="btn secondary" data-batch>Editar seleção</button>':'')+
      '<button type="button" class="btn primary" data-confirm-evidence>Confirmar origens</button>');
  }

  async function confirmEvidence() {
    const prepared=confirmation;
    const account=current();
    if(!prepared||account?.id!==prepared.accountId)return;
    await call('confirm',{clientId:account.id,...prepared.payload,confirmed:true,
      requestId:prepared.requestId,reviewHash:prepared.reviewHash});
    await loadAccount(account);
    confirmation=null;
    byId('review').close();
    render();
    notify('Evidência registrada no servidor.');
  }

  const bridge = window.parent === window ? null : window.parent.FiadoCentralEntry;
  const call = (action,body={}) => bridge.request(window,action,body);

  async function pageAccounts(cursor) {
    const page=await call('list',{...(cursor?{cursor}:{}),...(state.filter==='batch'?{lotOnly:true}:{})});
    document.querySelector('[data-filter="batch"]').hidden=!page.approvedLotAvailable;
    if(!cursor)remote.accounts=[];
    remote.accounts.push(...page.accounts.map(row=>({id:row.clientId,name:row.name,bookBalanceCents:row.bookBalanceCents,
      records:[],balances:[],loaded:false})));
    remote.cursor=page.nextCursor;
  }

  async function loadAccount(account) {
    const result=await call('account',{clientId:account.id});
    const [adi,card]=result.spaces.map(space=>space.id);
    const toChoice=id=>id===adi?'adi':id===card?'card':id?'other':null;
    const labels={credit_sale:'Venda Fiado',payment_received:'Recebimento',balance_adjustment:'Ajuste de saldo'};
    account.records=result.records.map(row=>({id:row.id,label:row.installment?'Venda parcelada':row.type==='balance_adjustment'&&row.valueCents<0?'Ajuste que aumentou a dívida':
      row.type==='balance_adjustment'&&row.valueCents>0?'Ajuste que reduziu a dívida':labels[row.type],cents:row.valueCents===null?null:Math.abs(row.valueCents),
      day:row.date,origin:row.classification==='known'?toChoice(row.knownOrigin):null,knownOrigin:toChoice(row.knownOrigin),
      conflict:row.classification==='conflict',destinations:row.destinations.map(toChoice),batchEligible:row.batchEligible,fromInitialLot:row.fromInitialLot,
      evidence:row.decision?{id:row.decision.eventId,choice:toChoice(row.decision.spaceId)||'review',note:row.decision.note,at:row.decision.at}:null}));
    account.loaded=true;
    account.revision=result.revision;
    account.serverState=result.state;
    account.ready=false;
    account.balances=[];
    account.spaceIds={adi,card};
    account.openingEnabled=result.openingEnabled===true;
    account.openingConfirmed=result.openingConfirmed===true;
    account.bookBalanceCents=result.bookBalanceCents;
    account.reviewIssue=null;
    account.issue=account.records.some(item=>item.conflict)?'Há lançamentos com divergência na origem ou na prova. Confira-os individualmente.':null;
  }

  async function evaluateAccount(account) {
    const review=await call('review',{clientId:account.id});
    if(review.revision!==account.revision){
      await loadAccount(account);
      render();
      throw Error('A conta mudou. Confira os lançamentos e abra a revisão novamente.');
    }
    account.ready=review.state==='ready';
    account.serverState=review.state;
    account.reviewIssue=review.reason==='fiado-regularization-origin-cash'?
      'O executor V2 ainda não comprovou uma entrada de caixa única para o recebimento.' : null;
    account.balances=account.ready?review.routing.map(row=>{
      const space=Object.keys(account.spaceIds).find(key=>account.spaceIds[key]===row.spaceId);
      return balance(space,row.after.dueCents,row.after.futureCents,true);
    }):[];
    render();
  }

  async function run(action) {
    if(busy)return;
    busy=true;
    try{await action();}
    catch(error){
      if(byId('central').hidden){
        byId('denied').querySelector('p').textContent=error.message;
        byId('denied').hidden=false;
        decorate();
      }else notify(error.message);
    }finally{busy=false;}
  }

  if (!bridge) {
    byId('denied').hidden = false;
    decorate();
    return;
  }
  byId('exit-central').addEventListener('click',()=>bridge.close(window));
  run(async()=>{
    await pageAccounts();
    select(remote.accounts[0]);
    byId('central').hidden=false;
    render();
  });

  byId('central').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.filter) {
      run(async()=>{
        state.filter=button.dataset.filter;
        await pageAccounts();
        select(filtered()[0]);
        render();
      });
    } else if (button.dataset.account) {
      run(async()=>{
        const account=available().find(account=>account.id===button.dataset.account);
        await loadAccount(account);
        select(account);
        render();
        navigate('detail');
      });
    } else if (button.hasAttribute('data-back')) {
      navigate('list');
    } else if (button.hasAttribute('data-review')) {
      run(async()=>{await evaluateAccount(current());showReview();});
    } else if(button.hasAttribute('data-batch')) {
      showBatch();
    } else if(button.hasAttribute('data-review-batch')) {
      const items=[...byId('review').querySelectorAll('[data-batch-record]:checked')].map(input=>({recordId:input.value,choice:'adi',note:''}));
      if(items.length)run(()=>prepareEvidence(current(),'batch',items));
    } else if(button.hasAttribute('data-confirm-evidence')) {
      run(confirmEvidence);
    } else if(button.hasAttribute('data-opening')) {
      run(()=>showOpening(current()));
    } else if(button.hasAttribute('data-opening-confirm')) {
      run(()=>confirmOpening(current()));
    } else if(button.hasAttribute('data-review-lot')) {
      run(showLotReview);
    } else if(button.hasAttribute('data-more')) {
      run(async()=>{await pageAccounts(remote.cursor);render();});
    }
  });
  byId('review').addEventListener('change',event=>{
    if(event.target.matches('[data-opening-queue]'))
      byId('review').querySelector('[data-opening-confirm]').disabled=!event.target.checked;
    if(event.target.matches('[data-batch-record]'))byId('review').querySelector('[data-review-batch]').disabled=
      !byId('review').querySelector('[data-batch-record]:checked');
  });
  byId('review').addEventListener('submit',event=>{
    if(event.target.id!=='opening-balances')return;
    event.preventDefault();
    run(()=>reviewOpening(current(),event.target));
  });
  byId('review').addEventListener('close',()=>{
    if(!byId('review').open){confirmation=null;openingDraft=null;byId('review-content').replaceChildren();}
  });
  byId('search').addEventListener('input', event => {
    if (busy) return;
    state.query = event.target.value;
    renderList();
    renderDetail();
    decorate();
  });
  byId('detail').addEventListener('input', event => {
    const form = event.target.closest('form[data-confirm]');
    if (!form) return;
    const {choice, note} = values(form);
    const previous = evidenceFor(current()).get(form.dataset.confirm);
    form.querySelector('button[type="submit"]').disabled = !choice || (previous?.choice === choice && previous.note === note);
  });
  byId('detail').addEventListener('submit', event => {
    const form = event.target.closest('form[data-confirm]');
    if (!form) return;
    event.preventDefault();
    save(form);
  });
})();

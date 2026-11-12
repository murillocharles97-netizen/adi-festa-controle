window.Clientes=(()=>{
  const normalizePhone=value=>PhoneUtils.normalizeBrazilianPhone(value);
  const baseView = () => DB.readForView?.() || DB.carregar();
  const listar = () => baseView().clientes;
  const obter = id => listar().find(c => c.id === id);
  let lastView, displayCache, displayEpoch = 0;
  // Presentation only. These balances never authorize a financial write.
  const localListBalances = () => window.Router?.atual?.() === 'clientes' &&
    Boolean(window.SpaceContext?.activeId && window.SpaceContext?.homeSpaces) &&
    window.BusinessContext?.get?.().role === 'owner' &&
    window.TeamAccess?.has?.('customers.view') === true && window.TeamAccess?.has?.('customers.receiveDebt') === true &&
    !window.OperationalReadPolicy?.restricted?.();
  const prepareList = () => { displayEpoch++; displayCache = null; lastView = null; };
  function legacyFiadoClosed() {
    const context = window.BusinessContext?.get?.();
    const marker = context?.business?.fiadoLegacyClosed;
    return context?.businessId === 'adi-festa' && DB.getBusinessId() === context.businessId &&
      marker?.version === 1 && marker.state === 'complete';
  }
  // Closed legacy Fiado: a valid opening is the whole account. The client record
  // holds opening + new operations (written by the server), so the screen shows it
  // directly — no origin review, legacy recount or proof round trip. Only a NEW
  // installment sale or a NEW Fiado sale outside Adi Festa still uses server proof.
  function closedOpeningStatus(client) {
    const opening = client?.fiadoOpeningBalance, adi = 'business_adi-festa';
    if (!legacyFiadoClosed() || opening?.version !== 1 || typeof opening.hash !== 'string' || client.customerDirectoryOnly) return null;
    if (window.InstallmentCredit?.has?.(client.id)) return null;
    const foreign = (baseView().vendas || []).some(s => (s.clienteId || s.clientId) === client.id && s.fiadoOpeningHash === opening.hash &&
      s.formaPagamento === 'fiado' && !s.deletedAt && s.active !== false && (s.spaceId || s.financialSpaceId || adi) !== adi);
    const space = window.SpaceContext?.activeId?.();
    if (foreign || scopedScreen() && space && space !== adi) return null;
    const saldo = Math.round((Number(client.saldo) || 0) * 100) / 100;
    return {saldo, futureCents: 0, status: saldo < 0 ? 'debt' : saldo > 0 ? 'credit' : 'zero', debt: Math.max(0, -saldo), credit: Math.max(0, saldo)};
  }
  function listBalances(data = baseView()) {
    const context = window.SpaceContext, bid = DB.getBusinessId(), generation = DB.getWorkspaceGeneration?.() ?? 0;
    const selected = context?.activeId?.(), closed = legacyFiadoClosed(), minute = Math.floor(Date.now() / 60000);
    const day = displayCache?.minute === minute ? displayCache.day : window.InstallmentPlan.today();
    if (displayCache?.data === data && displayCache.bid === bid && displayCache.generation === generation && displayCache.selected === selected && displayCache.closed === closed && displayCache.day === day) return displayCache;
    const own = row => (!row.businessId || row.businessId === bid) && (row.workspaceGeneration ?? 0) === generation;
    const spaces = context?.homeSpaces?.() || [], known = new Set(spaces.map(s => s.id));
    const qaSpaces = new Set(spaces.filter(s => /^VECONI QA\b/i.test(s.name || '')).map(s => s.id));
    // The approved historical inventory ended at this instant. Later sales keep their own origin.
    const historicalEnd = Date.parse('2026-11-10T13:27:02.114Z');
    const approvedCompany = bid === 'adi-festa', adi = 'business_adi-festa';
    const defaultSpace = approvedCompany ? (known.has(adi) ? adi : null)
      : !context?.scopesCustomers?.() && spaces.length === 1 ? spaces[0].id : null;
    const sales = new Map();
    for (const sale of data.vendas || []) if (own(sale) && sale.formaPagamento === 'fiado' &&
      sale.active !== false && sale.ativo !== false && !sale.deletedAt && !sale.desfeita && !sale.cancelledAt &&
      ['fiado', 'applied'].includes(sale.status || 'fiado')) {
      const id = sale.clienteId || sale.clientId, group = sales.get(id) || [];
      group.push(sale); sales.set(id, group);
    }
    const accounts = new Map();
    for (const client of data.clientes || []) {
      if (!own(client)) continue;
      const book = Math.round(Number(client.saldo || 0) * 100), debt = Math.max(0, -book);
      const parts = new Map(), plans = [], traditional = [];
      const openingHash = closed ? client.fiadoOpeningBalance?.hash : null;
      const cachedSales = sales.get(client.id) || [];
      const clientSales = openingHash ? cachedSales.filter(sale => sale.fiadoOpeningHash === openingHash) : cachedSales;
      const testOrigins = new Set(clientSales.map(s => s.spaceId || s.financialSpaceId).filter(Boolean));
      // Explicit test identities with exclusively QA-space history remain in QA.
      const accountDefault = approvedCompany && /^qa[-_]/i.test(client.id) && testOrigins.size === 1 &&
        qaSpaces.has([...testOrigins][0]) ? [...testOrigins][0] : defaultSpace;
      let unknownCents = 0, calendarUnknown = false;
      const add = (id, due, future) => {
        if (!id || !known.has(id)) { unknownCents += due + future; return; }
        const p = parts.get(id) || {dueCents: 0, futureCents: 0};
        p.dueCents += due; p.futureCents += future; parts.set(id, p);
      };
      const confirmed = window.InstallmentCredit?.confirmedAccount?.(client.id);
      if (confirmed) {
        const due = confirmed.entries.filter(e => e.dueDate <= day).reduce((n,e) => n + e.remainingCents, 0);
        const future = confirmed.entries.filter(e => e.dueDate > day).reduce((n,e) => n + e.remainingCents, 0);
        if (due !== confirmed.dueCents || future !== confirmed.futureCents) {
          accounts.set(client.id, {parts, unknownCents: debt, calendarUnknown: true, bookCents: book}); continue;
        }
        for (const e of confirmed.entries) add(e.spaceId || accountDefault,
          e.dueDate <= day ? e.remainingCents : 0, e.dueDate > day ? e.remainingCents : 0);
        accounts.set(client.id, {parts, unknownCents, calendarUnknown: false, bookCents: book}); continue;
      }
      for (const sale of clientSales) {
        const conflictingSpace = sale.spaceId && sale.financialSpaceId && sale.spaceId !== sale.financialSpaceId;
        const rawSpace = conflictingSpace ? null : sale.spaceId || sale.financialSpaceId || null;
        const date = sale.financialAppliedAt || sale.createdAt || sale.data;
        const historical = !date || Date.parse(date) <= historicalEnd;
        const exceptional = approvedCompany && sale.id === '6b382859-6f5f-4c16-a5dd-c5af33cbb42e';
        const unresolvedSpace = conflictingSpace || rawSpace && (!known.has(rawSpace) || qaSpaces.has(rawSpace));
        const space = exceptional ? (rawSpace === 'ca504a66-0602-434e-bee3-58a274eeb772' ? rawSpace : null)
          : approvedCompany && historical && !unresolvedSpace ? accountDefault : rawSpace;
        if (sale.installmentPlan) {
          try {
            window.InstallmentPlan.assertSale({...sale, status: 'fiado'});
            const paid = window.InstallmentPlan.cents(sale.creditPaidAmount || 0), principal = sale.installmentPlan.totalCents;
            if (paid < 0 || paid > principal || sale.creditOriginalAmount !== undefined && window.InstallmentPlan.cents(sale.creditOriginalAmount) !== principal ||
              sale.creditRemainingAmount !== undefined && window.InstallmentPlan.cents(sale.creditRemainingAmount) !== principal - paid) throw Error('Inconsistent installment balance');
            const rows = window.InstallmentPlan.rows(sale, day);
            plans.push({space, due: rows.filter(r => r.dueDate <= day).reduce((n,r) => n + r.remainingCents, 0),
              future: rows.filter(r => r.dueDate > day).reduce((n,r) => n + r.remainingCents, 0)});
          } catch { calendarUnknown = true; }
        } else if (!(approvedCompany && historical && !unresolvedSpace) && !(defaultSpace && !context?.scopesCustomers?.() && !unresolvedSpace && (!rawSpace || rawSpace === defaultSpace))) {
          try {
            const amount = window.InstallmentPlan.cents(sale.creditOriginalAmount ?? sale.valorFinal ?? sale.valorTotal);
            const paid = window.InstallmentPlan.cents(sale.creditPaidAmount || 0);
            if (paid > amount || sale.creditRemainingAmount !== undefined && window.InstallmentPlan.cents(sale.creditRemainingAmount) !== amount - paid) throw Error('Inconsistent sale');
            traditional.push({space, due: amount - paid, future: 0});
          } catch { calendarUnknown = true; }
        }
      }
      if ((client.hasInstallmentFiado || client.fiadoHistoryVersion === 1 && clientSales.some(s => s.installmentPlan)) && !plans.length) calendarUnknown = true;
      if (!Number.isSafeInteger(book) || calendarUnknown || plans.reduce((n,p) => n + p.due + p.future, 0) > debt) {
        accounts.set(client.id, {parts, unknownCents: debt, calendarUnknown: true, bookCents: book}); continue;
      }
      for (const p of plans) add(p.space, p.due, p.future);
      const scheduled = plans.reduce((n,p) => n + p.due + p.future, 0), rest = debt - scheduled;
      const tracked = traditional.reduce((n,p) => n + p.due, 0);
      if (tracked > rest) unknownCents += rest;
      else {
        for (const p of traditional) add(p.space, p.due, 0);
        add(accountDefault, rest - tracked, 0);
      }
      accounts.set(client.id, {parts, unknownCents, calendarUnknown: false, bookCents: book});
    }
    return displayCache = {data, bid, generation, day, minute, accounts, selected, closed};
  }
  function listSummary() {
    if (!localListBalances()) return null;
    const state = listBalances(); let dueCents = 0, futureCents = 0, debtors = 0, unknown = 0;
    for (const client of baseView().clientes || []) {
      if (client.ativo === false || client.active === false || client.deletedAt) continue;
      const closed = closedOpeningStatus(client);
      if (closed) { if (state.selected === 'business_adi-festa') { dueCents += Math.round(closed.debt * 100); debtors += Number(closed.debt > 0); } continue; }
      const a = state.accounts.get(client.id); if (!a) continue;
      const p = a.parts.get(state.selected);
      if (p) { dueCents += p.dueCents; futureCents += p.futureCents; debtors += Number(p.dueCents > 0); }
      if (a.unknownCents || a.calendarUnknown) unknown++;
    }
    return {dueCents, futureCents, debtors, unknown, partial: unknown > 0};
  }
  function viewData() {
    const data = baseView(), context = window.SpaceContext;
    if (!context?.scopesCustomers?.()) return data;
    const scope = context.viewScope();
    if (lastView?.data !== data || lastView.scope !== scope || lastView.epoch !== displayEpoch) {
      const result = context.contextualData(data, 'clients');
      if (localListBalances()) {
        const state = listBalances(data), included = new Map(result.clientes.map(c => [c.id, c]));
        for (const client of data.clientes || []) {
          const part = state.accounts.get(client.id)?.parts.get(state.selected);
          if (!included.has(client.id) && part && part.dueCents + part.futureCents > 0)
            included.set(client.id, {...client, totalComprado: 0, quantidadeVendas: 0, ultimaCompra: null, promessaPagamento: null});
        }
        result.clientes = [...included.values()];
        result.unassignedCustomers = (result.unassignedCustomers || []).filter(c => !included.has(c.id));
      }
      lastView = {data, scope, epoch: displayEpoch, result};
    }
    return lastView.result;
  }
  const viewClient = id => (viewData().clientes || []).find(c => c.id === id);
  const scopedScreen = () => window.Router?.atual?.() === 'clientes' && window.SpaceContext?.scopesCustomers?.();
  const unknown = reason => ({saldo:NaN,status:'unverified',debt:0,credit:0,reason});
  const spaceAccountMessage = 'O saldo tem origem em outro espaço ou origem não comprovada. Confira o Fiado da empresa antes de cobrar ou receber.';
  function accountBelongsTo(account, spaceId) {
    return Boolean(spaceId && account && account.creditCents === 0 && Array.isArray(account.entries) &&
      account.entries.every(row => row.spaceId === spaceId && Number.isSafeInteger(row.remainingCents) && row.remainingCents > 0) &&
      account.entries.reduce((sum, row) => sum + row.remainingCents, 0) === account.totalCents);
  }
  async function confirmSpaceAccount(id, scope = window.SpaceContext?.viewScope?.()) {
    const context = window.SpaceContext, space = context?.activeId?.();
    if (!space || scope !== context.viewScope() || !viewClient(id)) throw Error('O cliente ou espaço ativo mudou. Abra a conta novamente.');
    const account = await window.InstallmentCredit.refresh(id);
    if (scope !== context.viewScope() || !viewClient(id) || !accountBelongsTo(account, space)) throw Object.assign(Error(spaceAccountMessage), {code:'fiado-space-unverified'});
    return account;
  }
  function listFinancialStatus(client) {
    if (client?.customerDirectoryOnly) return financialStatus(client);
    const closed = closedOpeningStatus(client);
    if (closed) return closed;
    if (localListBalances()) {
      const state = listBalances(), account = state.accounts.get(client?.id), p = account?.parts.get(state.selected);
      if (!account || account.calendarUnknown || (!p || p.dueCents + p.futureCents === 0) && account.unknownCents) return unknown();
      const credit = !scopedScreen() && account.bookCents > 0 ? account.bookCents : 0;
      const saldo = (credit - (p?.dueCents || 0)) / 100;
      return {saldo, futureCents: p?.futureCents || 0, status: saldo < 0 ? 'debt' : saldo > 0 ? 'credit' : 'zero',
        debt: Math.max(0, -saldo), credit: credit / 100, displayOnly: true, partial: account.unknownCents > 0};
    }
    return financialStatus(client);
  }
  function financialStatus(client, scoped = scopedScreen()) {
    if (client?.customerDirectoryOnly) return unknown('O saldo precisa ser consultado no espaço de origem.');
    if (scoped && (window.TeamAccess?.has?.('customers.receiveDebt') === false || window.OperationalReadPolicy?.restricted?.()))
      return unknown('Seu perfil não pode consultar o Fiado neste espaço.');
    const account = (window.InstallmentCredit?.confirmedAccount || window.InstallmentCredit?.account)?.(client?.id);
    const closed = !account && closedOpeningStatus(client);
    if (closed) return closed;
    if (scoped) {
      if (account && !accountBelongsTo(account, window.SpaceContext?.activeId?.())) return unknown(spaceAccountMessage);
      if (!account && (Number(client?.saldo) !== 0 || window.InstallmentCredit?.has?.(client?.id))) return unknown();
    }
    if (!account && window.InstallmentCredit?.has?.(client?.id)) return unknown();
    const saldo = account ? (account.creditCents - account.dueCents) / 100 : Math.round((Number(client?.saldo) || 0) * 100) / 100;
    return {saldo, futureCents:account?.futureCents || 0, status:saldo<0?'debt':saldo>0?'credit':'zero', debt:Math.abs(Math.min(0,saldo)),credit:Math.max(0,saldo)};
  }
  function originalAccountAction() {
    return window.Fiados?.canOpenOriginal?.()
      ? '<button type="button" class="btn btn-light" data-open-original-fiado>Consultar conta original do Fiado</button>' : '';
  }
  function unassignedMarkup() {
    const rows = viewData().unassignedCustomers || [];
    if (!rows.length) return scopedScreen() && !(viewData().clientes || []).length
      ? '<p class="muted">Nenhum vínculo de cliente foi confirmado neste espaço com os dados disponíveis. O cadastro da empresa continua acessível na seleção de clientes em Vendas.</p>' : '';
    const mayReceive=window.Fiados?.canOpenOriginal?.();
    return `<details class="card space-unassigned-customers"><summary>${rows.length} cliente(s) sem espaço confirmado</summary><p>Cadastros preservados no diretório da empresa. Uma venda ou renovação com espaço identificado permite encontrá-los aqui.</p><ul>${rows.map(client => {
      const receive=mayReceive&&Number(client.saldo)<0?` <button type="button" class="btn btn-light" data-receive-unassigned="${Utils.escapar(client.id)}">Receber</button>`:'';
      return `<li>${Utils.escapar(client.nome)}${receive}</li>`;
    }).join('')}</ul></details>`;
  }
  const allowed=key=>window.TeamAccess?window.TeamAccess.has(key)===true:!window.FirebaseSession?.user;
  const assertPermission=key=>{if(!allowed(key))throw Object.assign(Error(window.VeconiPermissionPolicy?.MESSAGE||'Você não tem permissão para realizar esta ação. Solicite ao gestor que habilite esta função em Equipe → Permissões.'),{code:'customer-edit-permission-required',permission:key});};
  const canEdit=()=>allowed('customers.edit'),canCreate=()=>allowed('customers.create');
  const assertCanEdit=()=>assertPermission('customers.edit'),assertCanCreate=()=>{assertPermission('customers.create');window.TeamAccess?.assertCustomerProtocol?.();};
  const assertCanSave=id=>id?assertCanEdit():assertCanCreate();
  const salvar=d=>{assertCanSave(d.id);if(d.id&&!obter(d.id))throw Error('Cliente não encontrado nesta sessão. Nenhum cadastro foi criado.');if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateClient(),'criar novos clientes');let salvo;DB.alterar(db=>{
    assertCanSave(d.id);
    const atual=db.clientes.find(c=>c.id===d.id),agora=new Date().toISOString(),telefone=d.telefone||'',normalizedPhone=normalizePhone(telefone),duplicado=db.clientes.find(c=>c.id!==d.id&&normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone);
    if(duplicado)throw Error(`Este WhatsApp já pertence a ${duplicado.nome}.`);
    const consent=d.marketingConsent===true||d.marketingConsent==='true',previousConsent=atual?.marketingConsent===true;const campos={nome:d.nome.trim(),apelido:d.apelido||'',telefone,normalizedPhone,telefone2:d.telefone2||'',email:d.email||'',endereco:d.endereco||'',cidade:d.cidade||atual?.cidade||'',estado:d.estado||atual?.estado||'',complemento:d.complemento||'',documento:d.documento||'',observacoes:d.observacoes||'',marketingConsent:consent,marketingConsentAt:consent?(atual?.marketingConsentAt||agora):null,marketingConsentSource:consent?(d.marketingConsentSource||atual?.marketingConsentSource||'manual'):null,marketingConsentRevokedAt:previousConsent&&!consent?agora:(atual?.marketingConsentRevokedAt||null),origemCadastro:d.origemCadastro||atual?.origemCadastro||'app',portalRefToken:d.portalRefToken||atual?.portalRefToken||Utils.uuid(),ativo:d.ativo!==false,atualizadoEm:agora};
    if(atual){if(!atual.portalRefToken&&!d.portalRefToken)delete campos.portalRefToken;delete campos.ativo;Object.assign(atual,campos);salvo=atual}else{salvo={id:Utils.uuid(),...campos,totalComprado:0,quantidadeVendas:0,saldo:0,financialVersion:0,ultimaCompra:null,etiquetas:[],promessaPagamento:null,criadoEm:agora};db.clientes.push(salvo)}
  });return salvo};
  const setActive=(id,enabled)=>{assertPermission('customers.archive');if(typeof enabled!=='boolean')throw Error('Estado de cliente inválido.');return DB.alterar(db=>{assertPermission('customers.archive');const cliente=db.clientes.find(c=>c.id===id);if(!cliente)throw Error('Cliente não encontrado.');Object.assign(cliente,{ativo:enabled,active:enabled,atualizadoEm:new Date().toISOString()});if(enabled&&cliente.deletedAt)cliente.deletedAt=null})};
  const excluir=id=>setActive(id,false);
  const importar=(registros,opcoes={possuiSaldo:true})=>{assertCanCreate();assertCanEdit();if(window.FirebaseSession?.user&&opcoes.possuiSaldo&&registros.some(c=>Number(c.saldo||0)!==0))throw Object.assign(Error('A importação com saldos exige a conferência financeira autorizada. Nenhum cadastro ou saldo foi alterado.'),{code:'authorized-financial-import-required'});return DB.alterar(db=>registros.forEach(registro=>{
    assertCanCreate();assertCanEdit();
    const normalizedPhone=normalizePhone(registro.telefone),nome=String(registro.nome).trim().toLowerCase(),existente=db.clientes.find(c=>(normalizedPhone&&normalizePhone(c.normalizedPhone||c.telefone)===normalizedPhone)||String(c.nome).trim().toLowerCase()===nome),agora=new Date().toISOString();
    if(existente){existente.nome=registro.nome;if(registro.telefone){existente.telefone=registro.telefone;existente.normalizedPhone=normalizedPhone}if(registro.observacoes)existente.observacoes=registro.observacoes;if(opcoes.possuiSaldo)existente.saldo=Number(registro.saldo||0);existente.portalRefToken||=Utils.uuid();existente.atualizadoEm=agora}
    else db.clientes.push({...registro,id:registro.id||Utils.uuid(),portalRefToken:registro.portalRefToken||Utils.uuid(),normalizedPhone,saldo:Number(registro.saldo||0),atualizadoEm:registro.atualizadoEm||agora});
  }))};
  const ajustarSaldo=(clienteId,saldoNovo,motivo)=>{if(window.TeamAccess&&!window.TeamAccess.has('customers.adjustBalance'))throw Error('Você não tem permissão para ajustar saldos.');let movimento;const operationId=Utils.uuid();DB.alterar(db=>{const cliente=db.clientes.find(c=>c.id===clienteId);if(!cliente)throw Error('Cliente não encontrado');const saldoAnterior=Number(cliente.saldo||0),financialVersionAnterior=Math.max(0,Number(cliente.financialVersion||0));cliente.saldo=Number(saldoNovo);cliente.financialVersion=financialVersionAnterior+1;cliente.atualizadoEm=new Date().toISOString();movimento={id:operationId,operationId,clienteId,clienteNome:cliente.nome,tipo:'ajuste_saldo',saldoAnterior,saldoNovo:cliente.saldo,expectedFinancialVersion:financialVersionAnterior,financialVersionAfter:cliente.financialVersion,motivo:motivo||'',data:cliente.atualizadoEm,...(window.TeamAccess?.actor?.()||{})};db.movimentacoes.push(movimento)});return movimento};
  let refreshScheduled = false;
  for (const name of ['financial-state-updated','cloud-data-updated','veconi-space-context-changed','veconi-spaces-ready','business-context-changed','firebase-session-cleared'])
    window.addEventListener(name, () => {
      prepareList();
      // The mounted app handles route/space changes, and the pager coalesces cloud updates.
      if (window.AppPageRuntime) return;
      if (!localListBalances() || refreshScheduled || !document.querySelector('#app .clients-page')) return;
      refreshScheduled = true;
      queueMicrotask(() => { refreshScheduled = false; if (localListBalances() && document.querySelector('#app .clients-page')) window.ClientesPage?.refresh?.(); });
    });
  return{listar,obter,viewData,viewClient,scopedScreen,confirmSpaceAccount,accountBelongsTo,unassignedMarkup,originalAccountAction,legacyFiadoClosed,salvar,excluir,setActive,importar,ajustarSaldo,normalizePhone,financialStatus,listFinancialStatus,localListBalances,prepareList,listSummary,canEdit,canCreate,assertCanEdit,assertCanCreate,assertCanSave};
})();

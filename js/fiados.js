window.Fiados = (() => {
  const listar = () => DB.carregar().clientes.filter(client => client.ativo &&
    (window.InstallmentCredit?.account(client.id)?.dueCents ?? Math.max(0,-Number(client.saldo)*100)) > 0);

  const money = (value) => Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

  function paymentContext(client) {
    return window.FinancialConcurrency?.context?.(client) || {
      expectedBalance: Number(client?.saldo || 0),
      expectedFinancialVersion: Math.max(0, Number(client?.financialVersion || 0)),
    };
  }

  function createPayment(clienteId, valor, observacao, options = {}) {
    assertCanReceive();
    if(window.OperationalReadPolicy?.restricted?.()&&!window.OperationalReadPolicy.paymentPrepared(clienteId))throw Error('Conecte-se para conferir as obrigações autorizadas antes de confirmar o recebimento. Nenhum pagamento foi gravado.');
    let pagamento;
    const operationId = String(options.operationId || Utils.uuid()),
      paymentMode = options.paymentMode === "total" ? "total" : "partial";
    const existing = DB.carregar().pagamentos.find((entry) => String(entry.operationId || entry.id) === operationId);
    if (existing) {
      if(existing.fiadoSchedule&&(String(existing.clienteId)!==String(clienteId)||Number(existing.requestedAmount)!==Number(valor)||existing.paymentMethod!==options.paymentMethod||existing.fiadoSchedule.advance!==(options.allowAdvance===true)))throw Error('Identificador já pertence a outro recebimento. Consulte o original.');
      if (options.spaceId && String(existing.spaceId || "") !== String(options.spaceId))
        throw Error("Este recebimento já pertence a outro espaço.");
      if(options.saleId && (existing.installmentSaleId!==options.saleId||Number(existing.requestedAmount)!==Number(valor)||existing.paymentMethod!==options.paymentMethod||String(existing.clienteId)!==String(clienteId)))throw Error('Identificador já utilizado para outro recebimento.');
      window.SyncFirebase?.assertPaymentTracked?.(existing);
      return existing;
    }
    window.SyncFirebase?.assertCustomerPaymentReview?.(clienteId);
    if(options.receiptRoute)window.SyncFirebase.assertFiadoReceiptQueueClear(clienteId);
    const spaceId = window.SpaceContext?.requireSalesSpace?.(options.spaceId || "") || null;
    if (!spaceId && typeof document !== "undefined") throw Error("Selecione o espaço deste recebimento.");
    const before = DB.carregar(),
      nextData = typeof structuredClone === "function" ? structuredClone(before) : JSON.parse(JSON.stringify(before));
    ((db) => {
      const client = db.clientes.find((entry) => entry.id === clienteId);
      if (!client) throw new Error("Cliente não encontrado");
      if(options.receiptRoute&&(
        options.receiptRoute.scopedReceiptVersion!==1&&Math.round(Number(client.saldo)*100)!==options.receiptRoute.bookBalanceCents||
        (client.financialVersion??0)!==options.receiptRoute.financialVersion))
        throw Error('O saldo local mudou ou ainda não foi sincronizado. Confira a conta antes de confirmar.');
      const scheduled=client.fiadoHistoryVersion===1||client.hasInstallmentFiado||
        (db.vendas||[]).some(s=>s.clienteId===clienteId&&s.installmentPlan&&!s.deletedAt&&s.active!==false&&!s.desfeita&&!s.cancelledAt);
      if(scheduled&&options.saleId)throw Error('Utilize o recebimento agregado do Fiado, sem escolher parcelas.');
      const account=options.receiptRoute?.scopedReceiptVersion===1?
        assertScopedAccount(options.receiptRoute,spaceId):scheduled?window.InstallmentCredit.assertAccount(client,options.fiadoAccount):null;
      if(account&&account.asOf!==window.InstallmentPlan.today())throw Error('O dia comercial mudou. Confira o saldo exigível novamente.');
      if(account&&!['pix','cash'].includes(options.paymentMethod))throw Error('Utilize Pix externo ou dinheiro.');
      // Archived pre-migration receipts of an opened client never block (same rule as the queue check).
      const archivedReceipt=p=>window.SyncFirebase?.archivedFiadoRecord?.(clienteId,p,p.createdAt||p.data)===true;
      if(account&&(db.pagamentos||[]).some(p=>p.clienteId===clienteId&&!p.financialAppliedAt&&!['applied','cancelled','superseded'].includes(p.status)&&!archivedReceipt(p)))throw Error('Existe recebimento pendente neste cliente. Consulte a operação original antes de registrar outra.');
      const target=options.saleId?(db.vendas||[]).find(s=>s.id===options.saleId):null;
      if(options.saleId&&(!target?.installmentPlan||target.clienteId!==clienteId||target.deletedAt||target.active===false||target.desfeita||target.spaceId!==spaceId||target.businessId!==DB.getBusinessId()||!['pix','cash'].includes(options.paymentMethod)))throw Error('Venda parcelada, cliente, espaço ou meio de recebimento inválido.');
      if(target&&Math.abs(Number(valor)*100-Math.round(Number(valor)*100))>0.00001)throw Error('Informe o recebimento em centavos.');
      if(target&&(db.pagamentos||[]).some(p=>p.installmentSaleId===target.id&&!p.financialAppliedAt&&!['cancelled','superseded'].includes(p.status)))throw Error('Há um recebimento desta venda aguardando confirmação. Consulte o registro existente antes de receber novamente.');
      if(target&&(!Number.isFinite(Number(valor))||Number(valor)<=0||Math.round(Number(valor)*100)>Math.round(Number(target.creditRemainingAmount)*100)))throw Error('Valor excede o saldo desta venda.');
      const debt = account ? (options.allowAdvance?account.totalCents:account.dueCents)/100 : Math.abs(Math.min(0, Number(client.saldo || 0)));
      const requested = Number(valor);
      const received = options.allowCredit
        ? requested
        : paymentMode === "total"
          ? debt
          : Math.min(requested, debt);
      if(account&&requested>debt)throw Error("Valor excede o saldo autorizado para este recebimento.");
      const scheduleRows=account?window.FiadoAccount.allocate(account,window.InstallmentPlan.cents(received),{advance:options.allowAdvance===true}):null;
      if (!received || received <= 0) throw new Error("Informe um valor válido");

      const previousBalance = Number(client.saldo || 0);
      const expected = paymentContext(client);
      if (options.confirmedConflictId) {
        const conflict = db.pagamentos.find(
          (entry) => String(entry.id) === String(options.confirmedConflictId),
        );
        if (!conflict || conflict.status !== "conflict")
          throw new Error("Este conflito já foi resolvido ou não está disponível.");
        if (String(conflict.clienteId || conflict.clientId) !== String(clienteId))
          throw new Error("O conflito pertence a outro cliente.");
        conflict.status = "confirmed";
        conflict.applicationStatus = "superseded_by_confirmation";
        conflict.resolvedAt = new Date().toISOString();
        conflict.resolutionOperationId = operationId;
      }
      client.saldo = Number((previousBalance + received).toFixed(2));
      client.financialVersion = expected.expectedFinancialVersion + 1;
      const at = new Date().toISOString(), actor = window.TeamAccess?.actor?.() || {};
      client.atualizadoEm = at;
      pagamento = {
        id: operationId,
        operationId,
        idempotencyKey: operationId,
        syncPipelineVersion: 2,
        businessId: DB.getBusinessId?.() || null,
        spaceId,
        financialSpaceId: spaceId,
        schemaVersion: 3,
        ...actor,
        clienteId,
        clientId: clienteId,
        clienteNome: client.nome,
        tipo: "pagamento",
        valor: received,
        requestedAmount: requested,
        effectiveAmount: received,
        paymentMode:account?'partial':paymentMode,
        ...(account?{fiadoSchedule:{version:account.version,asOf:account.asOf,advance:options.allowAdvance===true,rows:scheduleRows}}:{}),
        paymentMethod: String(options.paymentMethod || "other"),
        ...(target?{installmentSaleId:target.id}:{}),
        saldoAnterior: previousBalance,
        saldoNovo: client.saldo,
        expectedBalance: expected.expectedBalance,
        expectedFinancialVersion: expected.expectedFinancialVersion,
        financialVersionAfter: client.financialVersion,
        financialStateDependent: true,
        financialOperationClass: "state_dependent",
        status: "pending_sync",
        applicationStatus: "pending",
        sourceDeviceId: window.SyncFirebase?.deviceId?.() || null,
        confirmedConflictId: options.confirmedConflictId || null,
        confirmationReason: options.confirmedConflictId
          ? "merchant_confirmed_second_real_payment"
          : null,
        adjustedFromPaymentId: options.adjustedFromPaymentId || null,
        data: at,
        createdAt: at,
        observacao: observacao || "",
        allocations: [],
        campaignConfirmations: [],
        legacyAmount: 0,
        allocatedAmount: 0,
      };

      if (account?.version!==2&&options.receiptRoute?.scopedReceiptVersion!==1&&client.legacyBalanceRemaining === undefined) {
        const trackedDebt = (db.vendas || []).filter((sale) =>
          String(sale.clienteId || sale.clientId) === String(clienteId) &&
          sale.formaPagamento === "fiado" &&
          ["fiado", "applied"].includes(sale.status || "fiado") &&
          sale.active !== false && !sale.deletedAt && !sale.cancelledAt &&
          sale.desfeita !== true,
        ).reduce((sum, sale) => sum + Math.max(0, Number(
          sale.creditRemainingAmount ?? sale.creditOriginalAmount ?? sale.valorFinal ?? sale.valorTotal ?? 0,
        )), 0);
        client.legacyBalance = Number(Math.max(0, debt - trackedDebt).toFixed(2));
        client.legacyBalanceRemaining = client.legacyBalance;
        client.campaignFinanceVersion = 2;
      }
      pagamento.legacyAmount = account ? scheduleRows.filter(r=>!r.saleId).reduce((n,r)=>n+r.amountCents,0)/100 : target ? 0 : Math.min(received, Math.max(0, Number(client.legacyBalanceRemaining || 0)));
      if(account?.version!==2&&options.receiptRoute?.scopedReceiptVersion!==1)
        client.legacyBalanceRemaining = Number(Math.max(0, Number(client.legacyBalanceRemaining || 0) - pagamento.legacyAmount).toFixed(2));
      const allocatable = Number((received - pagamento.legacyAmount).toFixed(2));

      if (allocatable > 0 && window.CampaignEngineV2) {
        const allocate=data=>account?window.FiadoAccount.applyAllocations(data,clienteId,scheduleRows,pagamento.id,at):CampaignEngineV2.allocatePayment(data, clienteId, allocatable, pagamento.id, at, {businessId: pagamento.businessId, saleId:target?.id});
        const allocations=window.OperationalReadPolicy?.restricted?.()?window.OperationalReadPolicy.debtOperation(db,clienteId,allocate):allocate(db);
        pagamento.allocations = allocations.map((allocation) => ({
          saleId: allocation.saleId,
          amount: allocation.amount,
          settledSale: allocation.settledSale,
        }));
        pagamento.allocatedAmount = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
        const confirm=data=>CampaignEngineV2.confirmSettledSales(data,pagamento,allocations);
        pagamento.campaignConfirmations = (window.OperationalReadPolicy?.restricted?.()?window.OperationalReadPolicy.benefitOperation(db,clienteId,confirm):confirm(db)).map((event) => ({
          eventId: event.id,
          campaignId: event.campaignId,
          saleId: event.saleId,
          pointsConfirmed: Number(event.delta?.points || 0),
          progressConfirmed: Number(event.delta?.progress || 0),
        }));
      }
      if((account||options.receiptRoute)&&window.InstallmentPlan.cents(pagamento.allocatedAmount)!==window.InstallmentPlan.cents(allocatable))
        throw Error('As vendas a quitar precisam estar sincronizadas. Nenhum recebimento foi registrado.');

      if(target&&Math.round(pagamento.allocatedAmount*100)!==Math.round(received*100))throw Error('O recebimento não foi alocado integralmente à venda.');
      db.pagamentos.push(pagamento);
      db.movimentacoes.push({ ...pagamento });
    })(nextData);
    if (window.SyncFirebase?.createPaymentOperation)
      window.SyncFirebase.createPaymentOperation(before, nextData, pagamento, options.receiptRoute?{
        version:1,mode:options.receiptRoute.mode,spaceId:options.receiptRoute.spaceId,quoteHash:options.receiptRoute.quoteHash,
        ...(options.receiptRoute.scopedReceiptVersion===1?{scopedReceiptVersion:1}:{})
      }:undefined);
    else if (typeof document !== "undefined")
      throw Error("O pipeline de recebimentos não está pronto. Nenhum pagamento foi salvo.");
    else DB.alterar((db) => {
      for (const key of Object.keys(db)) delete db[key];
      Object.assign(db, nextData);
    });
    return pagamento;
  }

  function receber(clienteId, valor, observacao, options = {}) {
    return createPayment(clienteId, valor, observacao, options);
  }

  function assertCanReceive() {
    if(window.AdiFestaBuild?.receiptCreationPaused===true)throw Object.assign(Error('Novos recebimentos estão temporariamente pausados. Os registros existentes e a sincronização foram preservados.'),{code:'payment-creation-paused'});
    const access=window.TeamAccess;
    if(access?.assert)access.assert('customers.receiveDebt');
    else if(access&&!access.has('customers.receiveDebt'))throw window.VeconiPermissionPolicy?.denied('customers.receiveDebt')||Error('Você não tem permissão para receber pagamentos de fiado.');
    access?.assertSession?.(access.captureSession());
  }

  function canOpenOriginal(routed=false) {
    const c = window.BusinessContext?.get?.(), uid = window.FirebaseSession?.user?.uid;
    return Boolean(!window.Clientes?.legacyFiadoClosed?.() && uid && c?.role === 'owner' && c.business?.ownerId === uid &&
      c.businessId === DB.getBusinessId() && (routed ? window.Router?.atual?.()==='clientes' : window.Clientes?.scopedScreen?.()) &&
      window.TeamAccess?.has?.('customers.view') && window.TeamAccess.has('customers.receiveDebt') &&
      !window.OperationalReadPolicy?.restricted?.());
  }

  function assertOriginal(clientId, origin, routed=false) {
    const client = (DB.carregar().clientes || []).find(row => row.id === clientId);
    if (!canOpenOriginal(routed) || origin !== window.SpaceContext?.viewScope?.() || !client ||
      (client.businessId && client.businessId !== DB.getBusinessId()) ||
      (client.workspaceGeneration ?? 0) !== (DB.getWorkspaceGeneration?.() ?? 0) ||
      client.deletedAt || client.active === false || client.ativo === false)
      throw Error('A conta original exige o proprietário ativo da empresa. Abra a consulta novamente.');
    return client;
  }

  function originalOrigins(clientId, account) {
    const rows = account?.entries || (DB.carregar().vendas || []).filter(sale => sale.clienteId === clientId &&
      sale.formaPagamento === 'fiado' && !sale.deletedAt && !sale.desfeita && !sale.cancelledAt &&
      sale.active !== false && sale.creditSettled !== true && window.SpaceEngine.isValidSale(sale) &&
      Number(sale.creditRemainingAmount ?? sale.valorFinal) > 0);
    const ids = rows.map(row => window.SpaceContext.recordSpace(row));
    return { known: [...new Set(ids.filter(Boolean))], unassigned: ids.some(id => !id) };
  }

  const mixedOriginalMessage = 'Há dívida aberta comprovada em mais de um espaço. A consulta está disponível, mas este fluxo não distribui um pagamento entre negócios.';

  function openOriginalDirectory() {
    if (!canOpenOriginal()) return;
    const root = document.querySelector('#modal'), scope = window.SpaceContext.viewScope();
    if (!root) return;
    const rows = window.Clientes.listar().filter(client => client.ativo !== false && client.active !== false && !client.deletedAt &&
      (!client.businessId || client.businessId === DB.getBusinessId()) && Number(client.saldo) < 0)
      .sort((a,b) => String(a.nome).localeCompare(String(b.nome),'pt-BR'));
    root.innerHTML = `<div class="modal-bg"><section class="modal-box" role="dialog" aria-modal="true" aria-labelledby="fiado-original-title"><header class="modal-head"><h2 id="fiado-original-title">Consultar conta original do Fiado</h2></header><form><div class="modal-body"><p>Consulte um cliente da empresa, inclusive quando a origem de parte da dívida ainda não estiver registrada.</p><label class="field">Cliente<select name="clientId" required><option value="">Selecione o cliente</option>${rows.map(client => `<option value="${esc(client.id)}">${esc(client.nome)}</option>`).join('')}</select></label></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-close-original>Cancelar</button><button type="submit" class="btn btn-primary" ${rows.length?'':'disabled'}>Consultar</button></footer></form></section></div>`;
    const form = root.querySelector('form');
    root.querySelector('[data-close-original]').onclick = () => window.Modais?.fechar?.();
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (button.disabled) return;
      const id = String(form.elements.clientId.value || '');
      if (!rows.some(client => client.id === id)) return;
      button.disabled = true;
      try { await openReceive(id,{originalScope:scope, sourceForm:form, onRecorded:(p,c)=>window.ReceiptMessageUI?.open?.(p,c)}); }
      finally { if (form.isConnected) button.disabled = false; }
    };
  }

  const routeMessages = {
    access_unavailable:'Seu perfil ou a situação da empresa não permite receber este Fiado.',
    space_unavailable:'O espaço do recebimento está indisponível.',
    account_unavailable:'Este cadastro não está disponível para recebimento.',
    pending_payment:'Há um recebimento pendente ou em conflito. Confira a operação original antes de receber novamente.',
    mixed_origins:'Há dívida aberta em mais de um espaço. Este formulário não pode distribuir o recebimento entre negócios.',
    other_space:'A dívida está em outro espaço. Selecione o espaço de origem para receber.',
    origin_unverified:'A origem financeira não pôde ser confirmada com este acesso. Peça ao proprietário para conferir a conta.',
    history_review:'O histórico financeiro precisa de revisão antes de receber. Nenhum recebimento foi registrado.',
    no_debt:'Este cliente não possui dívida em aberto.'
  };
  let receiptRouteRequest=0;

  function assertRouteScope(scope,session) {
    window.TeamAccess.assertSession(session);
    if(window.Router?.atual?.()!=='clientes'||window.SpaceContext.viewScope()!==scope)
      throw Error('O espaço ou a tela mudou. Abra o recebimento novamente.');
  }

  function assertScopedAccount(route,spaceId){
    const account=route.scopedAccount;
    if(route.mode!=='space'||route.spaceId!==spaceId||!account||account.clientId!==route.clientId||
      account.scopedReceiptVersion!==1||
      ![1,2].includes(account.version)||account.financialVersion!==route.financialVersion||account.creditCents!==0||
      account.asOf!==route.asOf||account.dueCents!==route.dueCents||account.futureCents!==route.futureCents||
      account.totalCents!==route.totalCents||account.totalCents!==account.dueCents+account.futureCents||
      !Array.isArray(account.entries)||!account.entries.length||account.entries.some(row=>row.spaceId!==spaceId))
      throw Error(routeMessages.history_review);
    return account;
  }

  async function readReceiptRoute(clientId,scope,session) {
    assertRouteScope(scope,session);
    if(!window.SyncFirebase?.assertFiadoReceiptQueueClear||navigator.onLine===false||typeof window.FirebaseCallable!=='function')
      throw Error('Conecte-se e aguarde a fila local carregar para conferir o recebimento.');
    window.SyncFirebase.assertFiadoReceiptQueueClear(clientId);
    const businessId=DB.getBusinessId(),workspaceGeneration=DB.getWorkspaceGeneration?.()??0;
    const spaceId=window.SpaceContext.requireSalesSpace();
    const reply=await window.FirebaseCallable('getOperationalSyncReceipt',{
      kind:'fiado_receipt_route',businessId,workspaceGeneration,clientId,spaceId,scopedReceiptVersion:1
    });
    assertRouteScope(scope,session);
    window.SyncFirebase.assertFiadoReceiptQueueClear(clientId);
    const route=reply.data??reply;
    if(route?.receiptRouteVersion!==1||route.businessId!==businessId||route.workspaceGeneration!==workspaceGeneration||
      route.clientId!==clientId||route.spaceId!==spaceId)
      throw Error('O servidor não confirmou a conta para este espaço. Tente novamente após sincronizar.');
    if(route.mode==='blocked')throw Error(routeMessages[route.reason]||routeMessages.history_review);
    if(!['space','original'].includes(route.mode)||!/^[a-f0-9]{64}$/.test(route.quoteHash||'')||
      !Number.isSafeInteger(route.financialVersion)||
      (route.scopedReceiptVersion!==1&&!Number.isSafeInteger(route.bookBalanceCents)))
      throw Error(routeMessages.history_review);
    if(route.scopedReceiptVersion===1)assertScopedAccount(route,spaceId);
    return route;
  }

  async function openCardReceive(clientId,{onRecorded}={}) {
    const request=++receiptRouteRequest;
    try{
      assertCanReceive();
      const scope=window.SpaceContext.viewScope(),session=window.TeamAccess.captureSession();
      const receiptRoute=await readReceiptRoute(clientId,scope,session);
      if(request!==receiptRouteRequest)return;
      return await openReceive(clientId,{onRecorded,receiptRoute,
        routeCurrent:()=>request===receiptRouteRequest,
        scoped:receiptRoute.mode==='space',originalScope:receiptRoute.mode==='original'?scope:undefined});
    }catch(error){
      if(request!==receiptRouteRequest)return;
      const code=String(error.code||'').replace(/^functions\//,'');
      const message=code==='unavailable'||code==='deadline-exceeded'?'Não foi possível conferir o saldo. Verifique a conexão e tente novamente.':
        code==='permission-denied'?'Seu perfil não permite receber neste espaço ou nesta conta.':error.message;
      Utils.toast(message,true);
    }
  }

  function receiptAttempt(clientId, {spaceScope, originalScope, receiptRoute} = {}) {
    assertCanReceive();const session=window.TeamAccess?.captureSession?.(),operationId=Utils.uuid();let flight=null,payment=null,inputKey='';
    const basis = originalScope ? paymentContext(assertOriginal(clientId, originalScope, !!receiptRoute)) : null;
    return {operationId,confirm(value,note,options={}){
      if(flight)return flight;
      flight=(async()=>{
        assertCanReceive();window.TeamAccess?.assertSession?.(session);
        const key=JSON.stringify([Number(value),String(note||''),options.paymentMode,options.paymentMethod,options.spaceId,options.saleId,options.allowAdvance]);
        if(payment&&key!==inputKey)throw Object.assign(Error('Este recebimento já foi preparado com os dados anteriores. Confira a sincronização antes de registrar outro valor.'),{code:'payment-already-prepared'});
        if(!payment){
          const scheduled=window.InstallmentCredit?.has(clientId);
          if(receiptRoute){
            const scope=originalScope||spaceScope;
            const current=await readReceiptRoute(clientId,scope,session);
            if(current.mode!==receiptRoute.mode||current.quoteHash!==receiptRoute.quoteHash)
              throw Error('O saldo ou a origem mudou. Reabra a conta antes de confirmar.');
            await window.SyncFirebase.assertFiadoReceiptWriter(current.businessId,current.workspaceGeneration,current.scopedReceiptVersion);
            assertRouteScope(scope,session);
            if(originalScope&&scheduled)throw Error(routeMessages.history_review);
          }
          if(originalScope){
            assertOriginal(clientId, originalScope, !!receiptRoute);
            if (!options.spaceId || options.saleId) throw Error('Selecione explicitamente o caixa do recebimento original.');
            window.SpaceContext.requireSalesSpace(options.spaceId);
            const proof = receiptRoute ? null : await originalProof(clientId, scheduled);
            const current = paymentContext(assertOriginal(clientId, originalScope, !!receiptRoute));
            if (current.expectedFinancialVersion !== basis.expectedFinancialVersion || current.expectedBalance !== basis.expectedBalance)
              throw Error('O saldo mudou desde a consulta. Reabra a conta antes de confirmar.');
            if (!receiptRoute && originalOrigins(clientId, proof).known.length > 1) throw Error(mixedOriginalMessage);
            if (scheduled) options={...options,fiadoAccount:proof};
          }else if(spaceScope){
            const active=window.SpaceContext.requireSalesSpace();
            const proof=receiptRoute?.scopedReceiptVersion===1?assertScopedAccount(receiptRoute,active):
              await window.Clientes.confirmSpaceAccount(clientId,spaceScope);
            if(options.spaceId!==active)throw Error('O recebimento precisa pertencer ao espaço ativo.');
            if(scheduled)options={...options,fiadoAccount:proof};
          }else if(scheduled)options={...options,fiadoAccount:await window.InstallmentCredit.refresh(clientId)};
          window.TeamAccess?.assertSession?.(session);
          if(receiptRoute)assertRouteScope(originalScope||spaceScope,session);
          payment=receber(clientId,value,note,{...options,operationId,receiptRoute});inputKey=key;
        }
        else window.SyncFirebase?.assertPaymentTracked?.(payment);
        try{await DB.flush?.();}catch{throw Object.assign(Error('O recebimento já foi preparado, mas a gravação ainda não foi confirmada. Mantenha esta janela e tente confirmar novamente; não registre outro pagamento.'),{code:'payment-confirmation-pending'});}
        window.TeamAccess?.assertSession?.(session);
        const current=(DB.carregar().pagamentos||[]).find(p=>String(p.operationId||p.id)===operationId)||payment;
        if(['conflict','error','cancelled'].includes(current.status))throw Object.assign(Error('O recebimento foi preservado, mas ainda exige conferência na Sincronização. Não registre um segundo pagamento.'),{code:'payment-review-required'});
        return current;
      })().finally(()=>flight=null);return flight;
    }};
  }

  async function originalProof(clientId, scheduled) {
    if (scheduled) return window.InstallmentCredit.refresh(clientId);
    // Traditional Fiado already validates the balance and allocations at commit.
    // An incomplete legacy proof must not replace that V228 flow with a new contract.
    if (navigator.onLine === false || !window.FirebaseCallable) return null;
    try { return await window.InstallmentCredit.refresh(clientId); }
    catch (error) {
      const code = String(error.code || '').replace(/^functions\//,'');
      if (['unauthenticated','permission-denied','permission-session-retired','permission-session-invalid'].includes(code)) throw error;
      return null;
    }
  }

  async function openReceive(clientId,{onRecorded,saleId,scoped=false,originalScope,sourceForm,receiptRoute,routeCurrent}={}) {
    const spaceScope=scoped?window.SpaceContext.viewScope():null;
    if(window.OperationalReadPolicy?.restricted?.()){try{await window.SyncFirebase.prepareOperationalCustomer(clientId,'payment');}catch(error){Utils.toast(error.message,true);return;}}
    let attempt;try{if(originalScope)assertOriginal(clientId,originalScope,!!receiptRoute);attempt=receiptAttempt(clientId,{spaceScope,originalScope,receiptRoute});}catch(error){Utils.toast(error.message,true);return;}
    const client=(DB.carregar().clientes||[]).find(c=>c.id===clientId);if(!client)return Utils.toast('Cliente não encontrado.',true);
    const target=saleId?(DB.carregar().vendas||[]).find(s=>s.id===saleId&&s.clienteId===clientId):null;
    if(saleId&&!target?.installmentPlan)return Utils.toast('Venda parcelada não disponível. Atualize os dados.',true);
    let account=null, original=null, selectedSpace='';
    if(originalScope){
      try {
        const scheduled = window.InstallmentCredit?.has(clientId);
        if(receiptRoute&&scheduled)throw Error(routeMessages.history_review);
        const proof = receiptRoute ? null : await originalProof(clientId, scheduled);
        assertOriginal(clientId,originalScope,!!receiptRoute);
        if (sourceForm && !sourceForm.isConnected) return;
        original = receiptRoute ? {known:receiptRoute.origins,unassigned:receiptRoute.hasUnknown} : originalOrigins(clientId,proof);
        if (scheduled) account=proof;
      }catch(error){return Utils.toast(error.message,true);}
    }else if(spaceScope || window.InstallmentCredit?.has(clientId)){try{
      if(spaceScope){selectedSpace=window.SpaceContext.requireSalesSpace();if(target&&target.spaceId!==selectedSpace)throw Error('A parcela não pertence ao espaço ativo.');}
      account=receiptRoute?.scopedReceiptVersion===1?assertScopedAccount(receiptRoute,selectedSpace):
        spaceScope?await window.Clientes.confirmSpaceAccount(clientId,spaceScope):await window.InstallmentCredit.refresh(clientId);
    }catch(e){return Utils.toast(e.message,true);}}
    if(routeCurrent&&!routeCurrent())return;
    if(receiptRoute){
      const local=paymentContext(client);
      if(receiptRoute.scopedReceiptVersion!==1&&Math.round(local.expectedBalance*100)!==receiptRoute.bookBalanceCents||
        local.expectedFinancialVersion!==receiptRoute.financialVersion||
        account&&(account.asOf!==receiptRoute.asOf||account.financialVersion!==receiptRoute.financialVersion||
          account.dueCents!==receiptRoute.dueCents||account.futureCents!==receiptRoute.futureCents||account.totalCents!==receiptRoute.totalCents))
        return Utils.toast('O saldo mudou ou ainda não foi sincronizado. Atualize a conta antes de receber.',true);
    }
    const due=account?account.dueCents/100:target?Number(target.creditRemainingAmount):Math.abs(Math.min(0,Number(client.saldo||0)));if(!due&&!account?.futureCents)return Utils.toast('Este cliente não possui dívida em aberto.',true);
    const root=document.querySelector('#modal');if(!root)return;
    const hasFuture=Boolean(account?.futureCents), mixed=original?.known.length>1;
    const originalNote = original ? `<p>Conta da empresa, sem filtro pelo espaço ativo. A seleção abaixo informa em qual caixa o valor entrou. As origens registradas da dívida permanecem iguais.</p>${original.unassigned?'<p>Parte da dívida tem origem de espaço a conferir.</p>':''}${original.known.length?`<p>Origens registradas: ${original.known.map(id=>esc(window.SpaceContext.homeSpaces().find(space=>space.id===id)?.name || 'Espaço indisponível')).join(', ')}.</p>`:''}${mixed?`<p role="status">${esc(mixedOriginalMessage)}</p>`:''}` : '';
    root.innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="receive-payment-title"><header class="modal-head"><h2 id="receive-payment-title">${original?"Conta original do Fiado":"Receber pagamento"}</h2><button type="button" class="icon-btn" data-receive-close aria-label="Fechar">×</button></header><form><div class="modal-body viewport-scroll">${originalNote}<p><b>${esc(client.nome)}</b> · Saldo atual: ${money(due)}</p><div class="payment-kind"><label><input type="radio" name="kind" value="total" checked> <span data-receive-total-label>${hasFuture?'Quitar valor exigível':'Pagamento total'}</span></label><label><input type="radio" name="kind" value="partial"> Parcial</label></div><label class="field">Valor recebido<input name="valor" type="number" inputmode="decimal" min="0.01" max="${due}" step="0.01" value="${due.toFixed(2)}" required></label>${account?`<p>Exigível agora: ${money(account.dueCents/100)} · Futuras: ${money(account.futureCents/100)} · Total ainda devido: ${money(account.totalCents/100)}</p><label style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="advance" style="width:18px;height:18px;min-height:18px;flex:none"> Antecipar parcelas futuras (sem desconto)</label>`:''}${selectedSpace?`<input type="hidden" name="paymentSpaceId" value="${esc(selectedSpace)}"><p>Espaço do recebimento: ${esc(window.SpaceContext.selectionLabel())}</p>`:spaceField({explicit:!!original})}<label class="field">Forma de pagamento<select name="paymentMethod"><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="credit_card">Cartão de crédito</option><option value="debit_card">Cartão de débito</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label><label class="field">Observação<textarea name="observacao"></textarea></label>${hasFuture?'<p>Valor a receber: <b data-receive-amount></b></p>':''}<p>${hasFuture?'Exigível após receber':'Saldo após receber'}: <b data-receive-after>${money(0)}</b></p>${hasFuture?'<p>Parcelas futuras após receber: <b data-receive-future></b></p>':''}<p data-receive-feedback role="alert" aria-live="assertive" tabindex="-1"></p><button type="button" class="btn btn-light" data-receive-restore hidden>Reabrir para restaurar acesso</button></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-receive-close>Cancelar</button><button type="submit" class="btn btn-primary" data-receive-confirm ${mixed?"disabled":""}>Confirmar recebimento</button></footer></form></section></div>`;
    const form=root.querySelector('form'),button=form.querySelector('[data-receive-confirm]'),feedback=form.querySelector('[data-receive-feedback]'),restore=form.querySelector('[data-receive-restore]'),value=form.elements.valor,dialog=root.querySelector('[role=dialog]');let busy=false;dialog.classList.add('receipt-payment-dialog');
    if(account){[...form.elements.paymentMethod.options].forEach(o=>{if(!["pix","cash"].includes(o.value))o.remove();});form.elements.advance.onchange=()=>{value.max=(form.elements.advance.checked?account.totalCents:account.dueCents)/100;if(form.querySelector('[name=kind][value=total]').checked||Number(value.value)>Number(value.max))value.value=Number(value.max).toFixed(2);update();};}
    if(target){[...form.elements.paymentMethod.options].forEach(o=>{if(!['pix','cash'].includes(o.value))o.remove();});const space=form.querySelector('[name=paymentSpaceId]');if(space){space.value=target.spaceId;space.disabled=true;}}
    window.Modais?.layout?.(dialog);const close=()=>{if(!busy&&root.contains(form))window.Modais?.fechar?.();};root.querySelectorAll('[data-receive-close]').forEach(b=>b.onclick=close);
    restore.onclick=()=>{if(!busy&&root.contains(form))location.reload();};
    const update=()=>{
      const amount=Number(value.value||0);
      form.querySelector('[data-receive-after]').textContent=money(Math.max(0,(hasFuture?due:Number(value.max))-amount));
      if(hasFuture){
        const advance=form.elements.advance.checked;
        form.querySelector('[data-receive-total-label]').textContent=advance?'Quitar dívida total':'Quitar valor exigível';
        form.querySelector('[data-receive-amount]').textContent=money(amount);
        const futureCents=account.futureCents-(advance?Math.max(0,Math.round(amount*100)-account.dueCents):0);
        form.querySelector('[data-receive-future]').textContent=money(Math.max(0,futureCents)/100);
      }
    };
    update();value.oninput=()=>{form.querySelector('[name=kind][value="'+(Math.round(Number(value.value)*100)===Math.round(Number(value.max)*100)?'total':'partial')+'"]').checked=true;update();};form.querySelectorAll('[name=kind]').forEach(r=>r.onchange=()=>{if(r.checked&&r.value==='total')value.value=Number(value.max).toFixed(2);update();});
    dialog.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const list=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea')].filter(x=>!x.hidden),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||mixed)return;busy=true;button.disabled=true;button.textContent='Confirmando registro…';feedback.textContent='';restore.hidden=true;
      try{const data=new FormData(form),amount=Number(data.get('valor')),payment=await attempt.confirm(amount,String(data.get('observacao')||''),{saleId,allowAdvance:data.get('advance')==='on',paymentMode:account?'partial':target?'partial':Math.round(amount*100)===Math.round(due*100)?'total':'partial',paymentMethod:String(data.get('paymentMethod')||'other'),spaceId:target?.spaceId||String(data.get('paymentSpaceId')||'')});
        if(!form.isConnected||!root.contains(form))return;
        if(onRecorded)onRecorded(payment,client);else{window.Modais?.fechar?.();Utils.toast(payment.financialAppliedAt?'Recebimento confirmado na nuvem.':'Recebimento salvo neste aparelho. Aguardando confirmação na nuvem.');}
      }catch(error){if(form.isConnected&&root.contains(form)){feedback.textContent=error.message;feedback.focus();restore.hidden=!['permission-session-invalid','permission-session-retired','permission-access-error'].includes(error.code);}}
      finally{busy=false;if(form.isConnected){button.disabled=false;button.textContent='Confirmar recebimento';}}
    };
    value.focus();return {operationId:attempt.operationId};
  }

  function spaceField({explicit=false}={}) {
    const spaces=window.SpaceContext?.salesSpaces?.()||[],selected=explicit?null:window.SpaceContext?.salesId?.();
    return `<div class="field"><label>Espaço do recebimento</label><select name="paymentSpaceId" required>${explicit?'<option value="" selected>Selecione onde o valor entrou</option>':''}${spaces.map(space=>`<option value="${esc(space.id)}"${space.id===selected?' selected':''}>${esc(space.name)}</option>`).join('')}</select><small>O recebimento pertence a este espaço. A dívida do cliente não muda de espaço.</small></div>`;
  }

  function confirmarConflito(conflictId) {
    const data = DB.carregar(),
      conflict = data.pagamentos.find(
        (entry) => String(entry.id) === String(conflictId),
      );
    if (!conflict || conflict.status !== "conflict")
      throw new Error("Este conflito já foi resolvido.");
    return createPayment(
      conflict.clienteId || conflict.clientId,
      Number(conflict.valor || conflict.amount),
      `${conflict.observacao || "Pagamento"} · confirmado após mudança de saldo`,
      {
        allowCredit: true,
        confirmedConflictId: conflict.id,
        paymentMode: "partial",
        spaceId: conflict.spaceId || "",
      },
    );
  }

  function cancelarConflito(conflictId) {
    const resolutionOperationId = `payment-conflict-cancel:${conflictId}`;
    let cancelled;
    DB.alterar((db) => {
      const conflict = db.pagamentos.find(
        (entry) => String(entry.id) === String(conflictId),
      );
      if (!conflict) throw new Error("Conflito de pagamento não encontrado.");
      if (conflict.status === "cancelled") {
        cancelled = conflict;
        return;
      }
      if (conflict.status !== "conflict")
        throw new Error("Este conflito já foi resolvido.");
      conflict.status = "cancelled";
      conflict.applicationStatus = "not_applied";
      conflict.cancelledAt = new Date().toISOString();
      conflict.resolutionOperationId = resolutionOperationId;
      const movement = db.movimentacoes.find(
        (entry) => String(entry.id) === String(conflictId),
      );
      if (movement) Object.assign(movement, {
        status: "cancelled",
        applicationStatus: "not_applied",
        cancelledAt: conflict.cancelledAt,
        resolutionOperationId,
      });
      cancelled = conflict;
    });
    return cancelled;
  }

  function showConflict(detail = {}) {
    const root = document.querySelector("#modal");
    if (!root || !detail.paymentId) return;
    const resultingBalance = Number.isFinite(Number(detail.resultingBalance))
        ? Number(detail.resultingBalance)
        : Number(detail.actualBalance || 0) + Number(detail.amount || 0),
      creditCreated = Number.isFinite(Number(detail.creditCreated))
        ? Number(detail.creditCreated)
        : Math.max(0, resultingBalance);
    root.innerHTML = `<div class="modal-bg financial-conflict-bg"><section class="modal-box financial-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="financial-conflict-title"><header class="modal-head"><div><small>Pagamento não aplicado</small><h3 id="financial-conflict-title">O saldo mudou em outro dispositivo</h3></div></header><div class="modal-body"><p>Você tentou registrar <b>${money(detail.amount)}</b> para <b>${esc(detail.clientName || "este cliente")}</b>, mas o resultado criaria crédito ou repetiria uma quitação.</p><div class="financial-conflict-comparison"><span><small>Saldo que você visualizou</small><b>${money(detail.expectedBalance)}</b></span><span><small>Saldo atual</small><b>${money(detail.actualBalance)}</b></span><span><small>Pagamento solicitado</small><b>${money(detail.amount)}</b></span><span><small>Saldo que ficaria</small><b>${money(resultingBalance)}</b></span><span><small>Crédito que seria criado</small><b>${money(creditCreated)}</b></span></div><p class="financial-conflict-note">Esse saldo mudou em outro dispositivo. Confirme somente se o cliente realmente fez outro pagamento. Vendas e campanhas não foram alteradas.</p></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-cancel-payment-conflict>Cancelar operação</button><button type="button" class="btn btn-primary" data-confirm-payment-conflict>Registrar mesmo assim</button></footer></section></div>`;
    const cancel = root.querySelector("[data-cancel-payment-conflict]"),
      confirm = root.querySelector("[data-confirm-payment-conflict]"),
      lock = () => {
        cancel.disabled = true;
        confirm.disabled = true;
      };
    cancel.onclick = async () => {
      lock();
      try {
        cancelarConflito(detail.paymentId);
        root.innerHTML = "";
        await window.SyncFirebase?.processSyncQueue?.({ force: true });
        Utils.toast("Pagamento conflitante cancelado. O saldo não foi alterado.");
        dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        cancel.disabled = confirm.disabled = false;
        Utils.toast(error.message, true);
      }
    };
    confirm.onclick = async () => {
      lock();
      try {
        confirmarConflito(detail.paymentId);
        root.innerHTML = "";
        await window.SyncFirebase?.processSyncQueue?.({ force: true });
        Utils.toast("Segundo pagamento enviado para confirmação.");
        dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        cancel.disabled = confirm.disabled = false;
        Utils.toast(error.message, true);
      }
    };
    window.lucide?.createIcons();
  }

  function showAdjustment(detail = {}) {
    const root = document.querySelector("#modal");
    if (!root || !detail.paymentId) return;
    const client = DB.carregar().clientes.find(
        (entry) => String(entry.id) === String(detail.clientId),
      ),
      currentDebt = Math.abs(Math.min(0, Number(client?.saldo || 0))),
      effectiveAmount = currentDebt || Number(detail.effectiveAmount || 0);
    root.innerHTML = `<div class="modal-bg financial-conflict-bg"><section class="modal-box financial-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="financial-adjustment-title"><header class="modal-head"><div><small>Saldo atualizado</small><h3 id="financial-adjustment-title">Confirme o novo valor da quitação</h3></div></header><div class="modal-body"><p>O saldo de <b>${esc(detail.clientName || client?.nome || "este cliente")}</b> mudou enquanto o pagamento era sincronizado.</p><div class="financial-conflict-comparison"><span><small>Saldo que você visualizou</small><b>${money(detail.expectedBalance)}</b></span><span><small>Saldo atual</small><b>${money(detail.actualBalance)}</b></span><span><small>Valor solicitado</small><b>${money(detail.requestedAmount)}</b></span><span><small>Novo valor para quitar</small><b>${money(effectiveAmount)}</b></span></div><p class="financial-conflict-note">Nenhum pagamento foi duplicado. Ao confirmar, a distribuição do fiado e as campanhas serão recalculadas sobre o saldo atual.</p></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-cancel-payment-adjustment>Cancelar</button><button type="button" class="btn btn-primary" data-confirm-payment-adjustment>Confirmar ${money(effectiveAmount)}</button></footer></section></div>`;
    const cancel = root.querySelector("[data-cancel-payment-adjustment]"),
      confirm = root.querySelector("[data-confirm-payment-adjustment]"),
      lock = () => {
        cancel.disabled = true;
        confirm.disabled = true;
      };
    cancel.onclick = () => {
      lock();
      window.SyncFirebase?.resolveLocalPaymentAdjustment?.(
        detail.paymentId,
        "cancelled",
      );
      root.innerHTML = "";
      Utils.toast("Quitação cancelada. O saldo não foi alterado.");
      dispatchEvent(new HashChangeEvent("hashchange"));
    };
    confirm.onclick = async () => {
      lock();
      try {
        const latestClient = DB.carregar().clientes.find(
            (entry) => String(entry.id) === String(detail.clientId),
          ),
          latestDebt = Math.abs(
            Math.min(0, Number(latestClient?.saldo || 0)),
          );
        if (!latestDebt)
          throw new Error(
            "O saldo já foi quitado. Atualize a tela antes de registrar outro pagamento.",
          );
        const adjusted = createPayment(
          detail.clientId,
          latestDebt,
          "Quitação confirmada após atualização do saldo",
          {
            paymentMode: "total",
            adjustedFromPaymentId: detail.paymentId,
            spaceId: DB.carregar().pagamentos.find((entry) => String(entry.id) === String(detail.paymentId))?.spaceId || "",
          },
        );
        window.SyncFirebase?.resolveLocalPaymentAdjustment?.(
          detail.paymentId,
          "superseded",
          adjusted.id,
        );
        root.innerHTML = "";
        await window.SyncFirebase?.processSyncQueue?.({ force: true });
        Utils.toast(`Quitação de ${money(latestDebt)} enviada com o saldo atualizado.`);
        dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (error) {
        cancel.disabled = confirm.disabled = false;
        Utils.toast(error.message, true);
      }
    };
    window.lucide?.createIcons();
  }

  window.addEventListener?.("financial-payment-conflict", (event) =>
    showConflict(event.detail),
  );
  window.addEventListener?.("financial-payment-adjustment-required", (event) =>
    showAdjustment(event.detail),
  );
  window.addEventListener?.("financial-payment-adjusted", (event) =>
    Utils.toast(
      `Saldo atualizado: pagamento de ${money(event.detail?.effectiveAmount)} aplicado com segurança.`,
    ),
  );

  return {
    spaceField, assertCanReceive, receiptAttempt, openReceive, openCardReceive, canOpenOriginal, openOriginalDirectory,
    listar,
    receber,
    confirmarConflito,
    cancelarConflito,
    showConflict,
    showAdjustment,
  };
})();

window.Fiados = (() => {
  const listar = () => DB.carregar().clientes.filter((client) => client.ativo && Number(client.saldo) < 0);

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
    let pagamento;
    const operationId = String(options.operationId || Utils.uuid()),
      paymentMode = options.paymentMode === "total" ? "total" : "partial";
    const existing = DB.carregar().pagamentos.find((entry) => String(entry.operationId || entry.id) === operationId);
    if (existing) {
      if (options.spaceId && String(existing.spaceId || "") !== String(options.spaceId))
        throw Error("Este recebimento já pertence a outro espaço.");
      window.SyncFirebase?.assertPaymentTracked?.(existing);
      return existing;
    }
    const spaceId = window.SpaceContext?.requireSalesSpace?.(options.spaceId || "") || null;
    if (!spaceId && typeof document !== "undefined") throw Error("Selecione o espaço deste recebimento.");
    const before = DB.carregar(),
      nextData = typeof structuredClone === "function" ? structuredClone(before) : JSON.parse(JSON.stringify(before));
    ((db) => {
      const client = db.clientes.find((entry) => entry.id === clienteId);
      if (!client) throw new Error("Cliente não encontrado");
      const debt = Math.abs(Math.min(0, Number(client.saldo || 0)));
      const requested = Number(valor);
      const received = options.allowCredit
        ? requested
        : paymentMode === "total"
          ? debt
          : Math.min(requested, debt);
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
        paymentMode,
        paymentMethod: String(options.paymentMethod || "other"),
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

      if (client.legacyBalanceRemaining === undefined) {
        const trackedDebt = (db.vendas || []).filter((sale) =>
          String(sale.clienteId || sale.clientId) === String(clienteId) &&
          sale.status === "fiado" &&
          sale.desfeita !== true,
        ).reduce((sum, sale) => sum + Math.max(0, Number(
          sale.creditRemainingAmount ?? sale.creditOriginalAmount ?? sale.valorFinal ?? sale.valorTotal ?? 0,
        )), 0);
        client.legacyBalance = Number(Math.max(0, debt - trackedDebt).toFixed(2));
        client.legacyBalanceRemaining = client.legacyBalance;
        client.campaignFinanceVersion = 2;
      }
      pagamento.legacyAmount = Math.min(received, Math.max(0, Number(client.legacyBalanceRemaining || 0)));
      client.legacyBalanceRemaining = Number(Math.max(0, Number(client.legacyBalanceRemaining || 0) - pagamento.legacyAmount).toFixed(2));
      const allocatable = Number((received - pagamento.legacyAmount).toFixed(2));

      if (allocatable > 0 && window.CampaignEngineV2) {
        const allocations = CampaignEngineV2.allocatePayment(db, clienteId, allocatable, pagamento.id, at, {
          businessId: pagamento.businessId,
        });
        pagamento.allocations = allocations.map((allocation) => ({
          saleId: allocation.saleId,
          amount: allocation.amount,
          settledSale: allocation.settledSale,
        }));
        pagamento.allocatedAmount = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
        pagamento.campaignConfirmations = CampaignEngineV2.confirmSettledSales(db, pagamento, allocations).map((event) => ({
          eventId: event.id,
          campaignId: event.campaignId,
          saleId: event.saleId,
          pointsConfirmed: Number(event.delta?.points || 0),
          progressConfirmed: Number(event.delta?.progress || 0),
        }));
      }

      db.pagamentos.push(pagamento);
      db.movimentacoes.push({ ...pagamento });
    })(nextData);
    if (window.SyncFirebase?.createPaymentOperation)
      window.SyncFirebase.createPaymentOperation(before, nextData, pagamento);
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

  function receiptAttempt(clientId) {
    assertCanReceive();const session=window.TeamAccess?.captureSession?.(),operationId=Utils.uuid();let flight=null,payment=null,inputKey='';
    return {operationId,confirm(value,note,options={}){
      if(flight)return flight;
      flight=(async()=>{
        assertCanReceive();window.TeamAccess?.assertSession?.(session);
        const key=JSON.stringify([Number(value),String(note||''),options.paymentMode,options.paymentMethod,options.spaceId]);
        if(payment&&key!==inputKey)throw Object.assign(Error('Este recebimento já foi preparado com os dados anteriores. Confira a sincronização antes de registrar outro valor.'),{code:'payment-already-prepared'});
        if(!payment){payment=receber(clientId,value,note,{...options,operationId});inputKey=key;}
        else window.SyncFirebase?.assertPaymentTracked?.(payment);
        try{await DB.flush?.();}catch{throw Object.assign(Error('O recebimento já foi preparado, mas a gravação ainda não foi confirmada. Mantenha esta janela e tente confirmar novamente; não registre outro pagamento.'),{code:'payment-confirmation-pending'});}
        window.TeamAccess?.assertSession?.(session);
        const current=(DB.carregar().pagamentos||[]).find(p=>String(p.operationId||p.id)===operationId)||payment;
        if(['conflict','error','cancelled'].includes(current.status))throw Object.assign(Error('O recebimento foi preservado, mas ainda exige conferência na Sincronização. Não registre um segundo pagamento.'),{code:'payment-review-required'});
        return current;
      })().finally(()=>flight=null);return flight;
    }};
  }

  function openReceive(clientId,{onRecorded}={}) {
    let attempt;try{attempt=receiptAttempt(clientId);}catch(error){Utils.toast(error.message,true);return;}
    const client=(DB.carregar().clientes||[]).find(c=>c.id===clientId);if(!client)return Utils.toast('Cliente não encontrado.',true);
    const due=Math.abs(Math.min(0,Number(client.saldo||0)));if(!due)return Utils.toast('Este cliente não possui dívida em aberto.',true);
    const root=document.querySelector('#modal');if(!root)return;
    root.innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="receive-payment-title"><header class="modal-head"><h2 id="receive-payment-title">Receber pagamento</h2><button type="button" class="icon-btn" data-receive-close aria-label="Fechar">×</button></header><form><div class="modal-body viewport-scroll"><p><b>${esc(client.nome)}</b> · Saldo atual: ${money(due)}</p><div class="payment-kind"><label><input type="radio" name="kind" value="total" checked> Pagamento total</label><label><input type="radio" name="kind" value="partial"> Parcial</label></div><label class="field">Valor recebido<input name="valor" type="number" inputmode="decimal" min="0.01" max="${due}" step="0.01" value="${due.toFixed(2)}" required></label>${spaceField()}<label class="field">Forma de pagamento<select name="paymentMethod"><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="credit_card">Cartão de crédito</option><option value="debit_card">Cartão de débito</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label><label class="field">Observação<textarea name="observacao"></textarea></label><p>Saldo após receber: <b data-receive-after>${money(0)}</b></p><p data-receive-feedback role="alert" aria-live="assertive" tabindex="-1"></p><button type="button" class="btn btn-light" data-receive-restore hidden>Reabrir para restaurar acesso</button></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-receive-close>Cancelar</button><button type="submit" class="btn btn-primary" data-receive-confirm>Confirmar recebimento</button></footer></form></section></div>`;
    const form=root.querySelector('form'),button=form.querySelector('[data-receive-confirm]'),feedback=form.querySelector('[data-receive-feedback]'),restore=form.querySelector('[data-receive-restore]'),value=form.elements.valor,dialog=root.querySelector('[role=dialog]');let busy=false;dialog.classList.add('receipt-payment-dialog');
    window.Modais?.layout?.(dialog);const close=()=>{if(!busy&&root.contains(form))window.Modais?.fechar?.();};root.querySelectorAll('[data-receive-close]').forEach(b=>b.onclick=close);
    restore.onclick=()=>{if(!busy&&root.contains(form))location.reload();};
    const update=()=>form.querySelector('[data-receive-after]').textContent=money(Math.max(0,due-Number(value.value||0)));value.oninput=()=>{form.querySelector('[name=kind][value="'+(Math.round(Number(value.value)*100)===Math.round(due*100)?'total':'partial')+'"]').checked=true;update();};form.querySelectorAll('[name=kind]').forEach(r=>r.onchange=()=>{if(r.checked&&r.value==='total')value.value=due.toFixed(2);update();});
    dialog.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const list=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea')].filter(x=>!x.hidden),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;button.disabled=true;button.textContent='Confirmando registro…';feedback.textContent='';restore.hidden=true;
      try{const data=new FormData(form),amount=Number(data.get('valor')),payment=await attempt.confirm(amount,String(data.get('observacao')||''),{paymentMode:Math.round(amount*100)===Math.round(due*100)?'total':'partial',paymentMethod:String(data.get('paymentMethod')||'other'),spaceId:String(data.get('paymentSpaceId')||'')});
        if(!form.isConnected||!root.contains(form))return;
        if(onRecorded)onRecorded(payment,client);else{window.Modais?.fechar?.();Utils.toast(payment.financialAppliedAt?'Recebimento confirmado na nuvem.':'Recebimento salvo neste aparelho. Aguardando confirmação na nuvem.');}
      }catch(error){if(form.isConnected&&root.contains(form)){feedback.textContent=error.message;feedback.focus();restore.hidden=!['permission-session-invalid','permission-session-retired','permission-access-error'].includes(error.code);}}
      finally{busy=false;if(form.isConnected){button.disabled=false;button.textContent='Confirmar recebimento';}}
    };
    value.focus();return {operationId:attempt.operationId};
  }

  function spaceField() {
    const spaces=window.SpaceContext?.salesSpaces?.()||[],selected=window.SpaceContext?.salesId?.();
    return `<div class="field"><label>Espaço do recebimento</label><select name="paymentSpaceId" required>${spaces.map(space=>`<option value="${esc(space.id)}"${space.id===selected?' selected':''}>${esc(space.name)}</option>`).join('')}</select><small>O recebimento pertence a este espaço. A dívida do cliente não muda de espaço.</small></div>`;
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
    spaceField, assertCanReceive, receiptAttempt, openReceive,
    listar,
    receber,
    confirmarConflito,
    cancelarConflito,
    showConflict,
    showAdjustment,
  };
})();

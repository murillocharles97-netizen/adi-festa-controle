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
    let pagamento;
    const operationId = String(options.operationId || Utils.uuid()),
      paymentMode = options.paymentMode === "total" ? "total" : "partial";
    DB.alterar((db) => {
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
      const at = new Date().toISOString();
      client.atualizadoEm = at;
      pagamento = {
        id: operationId,
        operationId,
        businessId: DB.getBusinessId?.() || null,
        schemaVersion: 3,
        clienteId,
        clientId: clienteId,
        clienteNome: client.nome,
        tipo: "pagamento",
        valor: received,
        requestedAmount: requested,
        effectiveAmount: received,
        paymentMode,
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
    });
    return pagamento;
  }

  function receber(clienteId, valor, observacao, options = {}) {
    return createPayment(clienteId, valor, observacao, options);
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
    listar,
    receber,
    confirmarConflito,
    cancelarConflito,
    showConflict,
    showAdjustment,
  };
})();

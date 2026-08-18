window.Fiados = (() => {
  const listar = () => DB.carregar().clientes.filter((client) => client.ativo && Number(client.saldo) < 0);

  function receber(clienteId, valor, observacao) {
    let pagamento;
    const operationId = Utils.uuid();
    DB.alterar((db) => {
      const client = db.clientes.find((entry) => entry.id === clienteId);
      if (!client) throw new Error("Cliente não encontrado");
      const debt = Math.abs(Math.min(0, Number(client.saldo || 0)));
      const received = Math.min(Number(valor), debt);
      if (!received || received <= 0) throw new Error("Informe um valor válido");

      const previousBalance = Number(client.saldo || 0);
      client.saldo = Number((previousBalance + received).toFixed(2));
      const at = new Date().toISOString();
      client.atualizadoEm = at;
      pagamento = {
        id: operationId,
        operationId,
        businessId: DB.getBusinessId?.() || null,
        schemaVersion: 2,
        clienteId,
        clientId: clienteId,
        clienteNome: client.nome,
        tipo: "pagamento",
        valor: received,
        saldoAnterior: previousBalance,
        saldoNovo: client.saldo,
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

  return { listar, receber };
})();

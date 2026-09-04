window.Vendas = (() => {
  const listar = () => DB.carregar().vendas;
  const estoqueInsuficiente = (itens) =>
    itens
      .map((i) => {
        const p = Produtos.obter(i.produtoId),
          v = i.variantId ? ProductVariations?.get(i.variantId) : null,
          q = Number(i.quantidade || 0),
          stock = Number(v?.stock ?? p?.estoqueAtual ?? 0),
          allow = Boolean(v?.allowNegativeStock || p?.semControleEstoque);
        return p && !allow && stock < q
          ? { produto: p, variacao: v, quantidade: q, falta: q - stock }
          : null;
      })
      .filter(Boolean);
  const registrar = (d) => {
    const operationId = d.operationId || Utils.uuid(),
      existente = DB.carregar().vendas.find(
        (v) => v.operationId === operationId,
      );
    if (existente) return existente;
    const currentData = DB.carregar(),
      hasRecurringItem = (d.itens || []).some((item) => item.productType === "recurring" || item.recurringActivation || currentData.produtos.some((product) => product.id === item.produtoId && product.productType === "recurring"));
    if (hasRecurringItem && !d.clienteId)
      throw Error("Venda com renovação exige um cliente selecionado.");
    if (window.PlanLimitService)
      PlanLimitService.assert(
        PlanLimitService.canCreateSale(),
        "registrar novas vendas",
      );
    let criada;
    DB.alterar((db) => {
      const cliente = db.clientes.find((c) => c.id === d.clienteId),
        data = new Date().toISOString();
      const itensComCampanha =
        window.Campanhas?.aplicarBeneficios?.(d.itens, d.clienteId, {
          manualAdjustment: Boolean(d.ajusteManual),
          selectedCampaignIds: d.appliedCampaignIds || [],
          status: d.status,
        }) || d.itens;
      const itens = itensComCampanha.map((i) => {
        const produto = db.produtos.find((p) => p.id === i.produtoId),
          variacao = i.variantId
            ? (db.variacoesProdutos || []).find((v) => v.id === i.variantId)
            : null,
          quantidade = Number(i.quantidade),
          precoOriginal = Number(
            i.precoOriginal ??
              i.precoUnitario ??
              variacao?.price ??
              produto?.preco,
          ),
          precoFinalUnitario = Number(i.precoFinalUnitario ?? precoOriginal),
          custoUnitario = Number(
            i.custoUnitario ?? variacao?.cost ?? produto?.custo ?? 0,
          ),
          subtotalOriginal = quantidade * precoOriginal,
          subtotalFinal = quantidade * precoFinalUnitario,
          custoTotal = quantidade * custoUnitario;
        return {
          produtoId: i.produtoId,
          productId: i.produtoId,
          variantId: variacao?.id || null,
          nome:
            i.nome ||
            [produto?.nome, variacao?.displayName].filter(Boolean).join(" — "),
          productNameSnapshot:
            i.productNameSnapshot || produto?.nome || i.nome || "Produto",
          variantNameSnapshot:
            i.variantNameSnapshot || variacao?.displayName || null,
          attributesSnapshot:
            i.attributesSnapshot ||
            structuredClone(variacao?.attributeValues || {}),
          sku: i.sku || variacao?.sku || produto?.codigo || "",
          barcode: i.barcode || variacao?.barcode || produto?.barcode || "",
          productImage:
            i.productImage ||
            i.imageThumbUrl ||
            window.getProductDisplayImage?.(produto, variacao)?.url ||
            variacao?.imageUrl ||
            produto?.imageThumbUrl ||
            produto?.imageUrl ||
            produto?.imagem ||
            "",
          productMainImage:
            i.productMainImage ||
            i.imageUrl ||
            window.getProductDisplayImage?.(produto, variacao, {
              preferMain: true,
            })?.url ||
            produto?.imageUrl ||
            produto?.imagem ||
            "",
          imageUpdatedAt: i.imageUpdatedAt || produto?.imageUpdatedAt || null,
          categoryId:
            i.categoryId || i.categoriaId || produto?.categoryId || produto?.categoriaId || null,
          categoryNameSnapshot:
            i.categoryNameSnapshot || i.categoria || produto?.categoria || "Sem categoria",
          quantidade,
          quantity: quantidade,
          precoOriginal,
          precoFinalUnitario,
          custoUnitario,
          subtotalOriginal,
          subtotalFinal,
          custoTotal,
          lucro: subtotalFinal - custoTotal,
          precoUnitario: precoFinalUnitario,
          unitPriceSnapshot: precoFinalUnitario,
          costSnapshot: custoUnitario,
          campaignDiscounts: i.campaignDiscounts || [],
          productType: i.productType || produto?.productType || "simple",
          recurringActivation: i.recurringActivation ? structuredClone(i.recurringActivation) : null,
        };
      });
      const subtotalOriginal = itens.reduce(
          (s, i) => s + i.subtotalOriginal,
          0,
        ),
        valorFinal = itens.reduce((s, i) => s + i.subtotalFinal, 0),
        descontoTotal = subtotalOriginal - valorFinal,
        custoTotal = itens.reduce((s, i) => s + i.custoTotal, 0),
        lucro = valorFinal - custoTotal,
        saldoAnterior = cliente ? Number(cliente.saldo || 0) : 0,
        financialVersionAnterior = cliente
          ? Math.max(0, Number(cliente.financialVersion || 0))
          : 0,
        saldoAtual =
          d.status === "fiado" ? saldoAnterior - valorFinal : saldoAnterior;
      if (cliente && d.status === "fiado" && cliente.legacyBalance === undefined) {
        cliente.legacyBalance = Math.abs(Math.min(0, saldoAnterior));
        cliente.legacyBalanceRemaining = cliente.legacyBalance;
        cliente.campaignFinanceVersion = 2;
      }
      criada = {
        id: Utils.uuid(),
        operationId,
        clienteId: d.clienteId || null,
        clientId: d.clienteId || null,
        customerId: d.clienteId || null,
        businessId: DB.getBusinessId?.() || null,
        clienteNome: cliente?.nome || "Venda avulsa",
        itens,
        subtotalOriginal,
        descontoTotal,
        valorFinal,
        valorTotal: valorFinal,
        custoTotal,
        lucro,
        status: d.status,
        formaPagamento:
          d.formaPagamento ||
          window.CheckoutPaymentMethod ||
          (d.status === "fiado" ? "fiado" : "pago"),
        data,
        createdAt: data,
        observacao: d.observacao || "",
        saldoAnterior,
        saldoAtual,
        financialVersionAnterior,
        ajusteManual: Boolean(d.ajusteManual),
        descontoTipo: d.descontoTipo || null,
        campaignEngineVersion: 2,
        appliedCampaignIds: [...new Set(d.appliedCampaignIds || [])],
        ...(d.status === "fiado"
          ? {
              creditOriginalAmount: valorFinal,
              creditPaidAmount: 0,
              creditRemainingAmount: valorFinal,
              creditSettled: false,
              creditSettledAt: null,
            }
          : {}),
      };
      db.vendas.push(criada);
      itens.forEach((i) => {
        const p = db.produtos.find((x) => x.id === i.produtoId);
        if (!p) return;
        if (p.semControleEstoque || p.controlaEstoque === false) return;
        if (i.variantId) {
          const v = (db.variacoesProdutos || []).find(
            (x) => x.id === i.variantId,
          );
          if (!v) return;
          const anterior = Number(v.stock || 0),
            novo = anterior - Number(i.quantidade);
          if (novo < 0 && !v.allowNegativeStock)
            throw Error(
              `Estoque insuficiente para ${p.nome} — ${v.displayName}.`,
            );
          v.stock = novo;
          v.updatedAt = data;
          db.movimentacoesEstoque.push({
            id: Utils.uuid(),
            operationId,
            produtoId: p.id,
            parentProductId: p.id,
            variantId: v.id,
            produtoNome: p.nome,
            variantName: v.displayName,
            tipo: "saida_venda",
            vendaId: criada.id,
            quantidade: -Number(i.quantidade),
            estoqueAnterior: anterior,
            estoqueNovo: novo,
            observacao: `Venda para ${criada.clienteNome}`,
            data,
          });
          ProductVariations.recomputeInData(db, p.id);
          return;
        }
        const anterior = Number(p.estoqueAtual || 0),
          novo = anterior - Number(i.quantidade);
        p.estoqueAtual = novo;
        p.estoque = novo;
        p.atualizadoEm = data;
        db.movimentacoesEstoque.push({
          id: Utils.uuid(),
          operationId,
          produtoId: p.id,
          produtoNome: p.nome,
          tipo: "saida_venda",
          vendaId: criada.id,
          quantidade: -Number(i.quantidade),
          estoqueAnterior: anterior,
          estoqueNovo: novo,
          observacao: `Venda para ${criada.clienteNome}`,
          data,
        });
      });
      if (cliente) {
        cliente.totalComprado = Number(cliente.totalComprado || 0) + valorFinal;
        cliente.quantidadeVendas = Number(cliente.quantidadeVendas || 0) + 1;
        cliente.ultimaCompra = criada.data;
        if (d.status === "fiado") {
          cliente.saldo = saldoAtual;
          cliente.financialVersion = financialVersionAnterior + 1;
        }
        cliente.atualizadoEm = criada.data;
      }
      db.movimentacoes.push({
        id: Utils.uuid(),
        clienteId: d.clienteId || null,
        clienteNome: criada.clienteNome,
        tipo: "venda",
        vendaId: criada.id,
        valor: valorFinal,
        status: d.status,
        data: criada.data,
      });
      if (descontoTotal !== 0)
        db.movimentacoes.push({
          id: Utils.uuid(),
          clienteId: d.clienteId || null,
          clienteNome: criada.clienteNome,
          tipo: "desconto",
          vendaId: criada.id,
          valor: descontoTotal,
          data: criada.data,
        });
      if (d.ajusteManual)
        db.movimentacoes.push({
          id: Utils.uuid(),
          clienteId: d.clienteId || null,
          clienteNome: criada.clienteNome,
          tipo: "ajuste_valor_venda",
          vendaId: criada.id,
          subtotalOriginal,
          valorFinal,
          data: criada.data,
        });
      criada.subscriptionUpdates =
        window.CustomerSubscriptions?.applySaleInData?.(db, criada) || [];
      criada.campaignUpdates =
        window.Campanhas?.aplicarVendaNoBanco(db, criada) || [];
    });
    window.FinancialSpaceService?.recordSale?.(criada).catch((error) =>
      console.warn("[Financeiro] venda aguardando projeção", { saleId: criada?.id, code: error?.code || "unknown" }),
    );
    return criada;
  };
  const ultima = () => {
    const vendas = listar();
    return vendas[vendas.length - 1] || null;
  };
  const podeDesfazer = () => {
    const v = ultima();
    return Boolean(
      v && Date.now() - new Date(v.data).getTime() <= 5 * 60 * 1000,
    );
  };
  const desfazerUltima = (options = {}) => {
    let removida;
    const operationId = Utils.uuid();
    DB.alterar((db) => {
      const venda = db.vendas[db.vendas.length - 1];
      if (!venda) throw Error("Nenhuma venda para desfazer");
      if (Date.now() - new Date(venda.data).getTime() > 5 * 60 * 1000)
        throw Error("O prazo de 5 minutos para desfazer terminou");
      if (!options.administrativeResolution)
        window.Campanhas?.validarReversaoVendaNoBanco?.(db, venda);
      removida = { ...venda };
      db.vendas.pop();
      const agora = new Date().toISOString();
      venda.itens.forEach((i) => {
        const p = db.produtos.find((x) => x.id === i.produtoId);
        if (!p) return;
        if (p.semControleEstoque || p.controlaEstoque === false) return;
        if (i.variantId) {
          const v = (db.variacoesProdutos || []).find(
            (x) => x.id === i.variantId,
          );
          if (!v) return;
          const anterior = Number(v.stock || 0),
            novo = anterior + Number(i.quantidade);
          v.stock = novo;
          v.updatedAt = agora;
          db.movimentacoesEstoque.push({
            id: Utils.uuid(),
            operationId,
            produtoId: p.id,
            parentProductId: p.id,
            variantId: v.id,
            produtoNome: p.nome,
            variantName: v.displayName,
            tipo: "venda_desfeita",
            vendaId: venda.id,
            quantidade: Number(i.quantidade),
            estoqueAnterior: anterior,
            estoqueNovo: novo,
            observacao: "Estoque da variação restaurado ao desfazer venda",
            data: agora,
          });
          ProductVariations.recomputeInData(db, p.id);
          return;
        }
        const anterior = Number(p.estoqueAtual || 0),
          novo = anterior + Number(i.quantidade);
        p.estoqueAtual = novo;
        p.estoque = novo;
        p.atualizadoEm = agora;
        db.movimentacoesEstoque.push({
          id: Utils.uuid(),
          operationId,
          produtoId: p.id,
          produtoNome: p.nome,
          tipo: "venda_desfeita",
          vendaId: venda.id,
          quantidade: Number(i.quantidade),
          estoqueAnterior: anterior,
          estoqueNovo: novo,
          observacao: "Estoque restaurado ao desfazer venda",
          data: agora,
        });
      });
      const cliente = db.clientes.find((c) => c.id === venda.clienteId);
      if (cliente) {
        if (venda.status === "fiado") {
          cliente.saldo = Number(venda.saldoAnterior || 0);
          cliente.financialVersion =
            Math.max(0, Number(cliente.financialVersion || 0)) + 1;
        }
        cliente.totalComprado = Math.max(
          0,
          Number(cliente.totalComprado || 0) -
            Number(venda.valorFinal ?? venda.valorTotal),
        );
        cliente.quantidadeVendas = Math.max(
          0,
          Number(cliente.quantidadeVendas || 0) - 1,
        );
        const anteriores = db.vendas.filter((v) =>
          window.CustomerMetricsService
            ? CustomerMetricsService.saleClientId(v) === cliente.id &&
              CustomerMetricsService.isValidSale(v, {
                businessId: DB.getBusinessId?.() || "",
              })
            : v.clienteId === cliente.id,
        );
        cliente.ultimaCompra = anteriores.length
          ? anteriores[anteriores.length - 1].data
          : null;
        cliente.atualizadoEm = agora;
      }
      db.movimentacoes = db.movimentacoes.filter((m) => m.vendaId !== venda.id);
      db.movimentacoes.push({
        id: operationId,
        operationId,
        clienteId: venda.clienteId,
        clienteNome: venda.clienteNome,
        tipo: "venda_desfeita",
        vendaId: venda.id,
        valor: Number(venda.valorFinal ?? venda.valorTotal),
        data: agora,
      });
      const campaignReversal = window.Campanhas?.reverterVendaNoBanco(db, venda, options);
      window.CustomerSubscriptions?.reverseSaleInData?.(db, venda);
      if (campaignReversal?.administrativeResolution) {
        db.movimentacoes.push({
          id: `${operationId}:campaign-resolution`,
          operationId,
          clienteId: venda.clienteId,
          clienteNome: venda.clienteNome,
          tipo: "ajuste_administrativo_campanha",
          vendaId: venda.id,
          motivo: options.administrativeResolution.reason,
          conflitos: campaignReversal.administrativeResolution.conflicts,
          data: agora,
        });
      }
    });
    window.FinancialSpaceService?.reverseSale?.(removida).catch((error) =>
      console.warn("[Financeiro] estorno aguardando projeção", { saleId: removida?.id, code: error?.code || "unknown" }),
    );
    return removida;
  };
  return {
    listar,
    registrar,
    ultima,
    podeDesfazer,
    desfazerUltima,
    estoqueInsuficiente,
  };
})();

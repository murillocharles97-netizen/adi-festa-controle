(function () {
  "use strict";
  const state = { period: "7d" };
  const DAY = 86400000;
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const esc = (value) =>
    window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const money = (value) => value===null?'Não disponível':
    window.Utils?.dinheiro?.(Number(value || 0)) ??
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const number = (value) => Number(value || 0);
  const INVALID_SALE_STATUSES = new Set([
    "cancelado",
    "cancelada",
    "cancelled",
    "canceled",
    "desfeito",
    "desfeita",
    "venda_desfeita",
    "estornado",
    "estornada",
    "refunded",
  ]);
  const normalizedStatus = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const isValidSale = (sale) =>
    Boolean(
      sale &&
        sale.ativo !== false &&
        sale.active !== false &&
        sale.desfeita !== true &&
        !sale.deletedAt &&
        !INVALID_SALE_STATUSES.has(
          normalizedStatus(sale.status || sale.saleStatus || sale.tipo),
        ),
    );
  const saleValue = (sale) => number(sale.valorFinal ?? sale.valorTotal);
  const saleDebt = (sale) =>
    normalizedStatus(sale?.status) !== "fiado" || sale?.creditSettled === true
      ? 0
      : Math.max(
          0,
          number(
            sale.creditRemainingAmount ??
              sale.creditOriginalAmount ??
              sale.valorFinal ??
              sale.valorTotal,
          ),
        );
  const recordSpaceId = (record) =>
    String(record?.spaceId || record?.financialSpaceId || "").trim();
  const startOfDay = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const endOfDay = (value) => {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  };
  const validDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const within = (value, start, end) => {
    const date = validDate(value);
    return date && date >= start && date <= end;
  };
  const percent = (current, previous) =>
    previous
      ? ((current - previous) / Math.abs(previous)) * 100
      : current
        ? 100
        : 0;
  const dayKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  function range(period = state.period, now = new Date()) {
    const end = endOfDay(now),
      start = startOfDay(now);
    let days = 1;
    if (period === "7d") days = 7;
    if (period === "30d") days = 30;
    if (period === "month") {
      start.setDate(1);
      days = Math.max(1, Math.round((end - start) / DAY) + 1);
    } else start.setDate(start.getDate() - (days - 1));
    const duration = end - start + 1,
      previousEnd = new Date(start.getTime() - 1),
      previousStart = new Date(previousEnd.getTime() - duration + 1);
    return {
      start,
      end,
      previousStart,
      previousEnd,
      days,
      label:
        period === "today"
          ? "Hoje"
          : period === "7d"
            ? "Últimos 7 dias"
            : period === "30d"
              ? "Últimos 30 dias"
              : "Mês atual",
    };
  }
  function aggregate(sourceDb, period = state.period) {
    if ((window.PerformanceAccess?.restricted() || window.TeamAccess?.requiresDailyDashboard?.())) {
      const value=window.PerformanceAccess?.state?.() || {ready:false};
      return {restricted:true,ready:value.ready,daily:value.ready?value.value:null};
    }
    const contextualDb =
        window.SpaceContext?.contextualData?.(sourceDb || {}, "home") ||
        sourceDb ||
        {},
      allSpacesId = window.SpaceContext?.ALL_SPACES || "all_spaces",
      selectionId = contextualDb.spaceSelectionId || allSpacesId,
      isAllSpaces = selectionId === allSpacesId,
      belongsToSelection = (record) =>
        isAllSpaces || recordSpaceId(record) === selectionId,
      db = isAllSpaces
        ? contextualDb
        : {
            ...contextualDb,
            campanhas: (contextualDb.campanhas || []).filter(
              belongsToSelection,
            ),
            progressosCampanha: (
              contextualDb.progressosCampanha || []
            ).filter(belongsToSelection),
            recompensas: (contextualDb.recompensas || []).filter(
              belongsToSelection,
            ),
          },
      selected = range(period),
      sales = (db.vendas || []).filter(isValidSale),
      payments = db.pagamentos || [],
      clients = (db.clientes || []).filter(
        (client) =>
          client.ativo !== false && client.active !== false && !client.deletedAt,
      ),
      products = (db.produtos || []).filter(
        (product) => product.ativo !== false,
      );
    const current = sales.filter((sale) =>
        within(sale.data || sale.createdAt, selected.start, selected.end),
      ),
      previous = sales.filter((sale) =>
        within(
          sale.data || sale.createdAt,
          selected.previousStart,
          selected.previousEnd,
        ),
      ),
      today = sales.filter((sale) =>
        window.Utils.hoje(sale.data || sale.createdAt),
      ),
      todayPayments = payments.filter((payment) =>
        window.Utils.hoje(payment.data || payment.createdAt),
      );
    const exchangeRows=window.ExchangeEconomics?.forData?.(db)||[],
      adjustment=(start,end)=>window.ExchangeEconomics?.total?.(db,{start,end})||0,
      exchangeAdjustment=adjustment(selected.start,selected.end),
      exchangesToday=exchangeRows.filter(row=>window.Utils.hoje(row.createdAt)),
      revenue = current.reduce((sum, sale) => sum + saleValue(sale), 0)+exchangeAdjustment,
      previousRevenue = previous.reduce(
        (sum, sale) => sum + saleValue(sale),
        0,
      )+adjustment(selected.previousStart,selected.previousEnd),
      todayRevenue = today.reduce((sum, sale) => sum + saleValue(sale), 0)+exchangesToday.reduce((sum,row)=>sum+row.differenceCents,0)/100,
      exchangeProjectionPending=Boolean(window.ExchangeEconomics)&&window.ExchangeEconomics.state?.().ready!==true,
      todayProfit = exchangesToday.length||exchangeProjectionPending?null:today.reduce((sum, sale) => sum + number(sale.lucro), 0),
      receivedToday = todayPayments.reduce(
        (sum, payment) => sum + number(payment.valor),
        0,
      ),
      // V240: one space uses the canonical per-space receivable (confirmed
      // regularizations included; future installments kept apart). The
      // Fiado-sales sum remains only as a fallback for profiles without proof.
      receivable = isAllSpaces ? null : window.Clientes?.spaceReceivable?.(selectionId) || null,
      openBalance = isAllSpaces
        ? clients.reduce(
            (sum, client) =>
              sum + Math.abs(Math.min(0, number(client.saldo))),
            0,
          )
        : receivable
          ? receivable.dueCents / 100
          : sales.reduce((sum, sale) => sum + saleDebt(sale), 0),
      receivableFuture = receivable ? receivable.futureCents / 100 : 0,
      receivablePending = Boolean(receivable?.partial),
      creditEnabled = window.OperationMode?.enabled?.("creditSales") === true;
    const dayMap = new Map(),
      productMap = new Map();
    current.forEach((sale) => {
      const key = dayKey(sale.data || sale.createdAt),
        day = dayMap.get(key) || {
          date: startOfDay(sale.data || sale.createdAt),
          value: 0,
          count: 0,
        };
      day.value += saleValue(sale);
      day.count++;
      dayMap.set(key, day);
      (sale.itens || []).forEach((item) => {
        const id = item.produtoId || item.nome,
          row = productMap.get(id) || {
            name: item.nome || "Produto",
            quantity: 0,
            value: 0,
          };
        row.quantity += number(item.quantidade);
        row.value += number(
          item.subtotalFinal ??
            item.valorTotal ??
            item.quantidade * item.precoFinalUnitario,
        );
        productMap.set(id, row);
      });
    });
    for(const row of exchangeRows.filter(row=>within(row.createdAt,selected.start,selected.end))){
      const key=dayKey(row.createdAt),day=dayMap.get(key)||{date:startOfDay(row.createdAt),value:0,count:0};
      day.value+=row.differenceCents/100;dayMap.set(key,day);
    }
    const daily = [];
    for (
      let cursor = new Date(selected.start);
      cursor <= selected.end;
      cursor = new Date(cursor.getTime() + DAY)
    ) {
      const key = dayKey(cursor),
        row = dayMap.get(key);
      daily.push(row || { date: new Date(cursor), value: 0, count: 0 });
    }
    const best = daily.reduce(
        (winner, row) => (row.value > winner.value ? row : winner),
        { date: null, value: 0, count: 0 },
      ),
      topProducts = [...productMap.values()]
        .sort((a, b) => b.quantity - a.quantity || b.value - a.value)
        .slice(0, 5);
    const scopedClientMetrics = isAllSpaces
      ? null
      : sales.reduce((map, sale) => {
          const id = String(sale.clienteId || sale.clientId || "");
          if (!id) return map;
          const saleAt = validDate(sale.data || sale.createdAt),
            currentClient = map.get(id) || { count: 0, value: 0, last: null };
          currentClient.count++;
          currentClient.value += saleValue(sale);
          if (
            saleAt &&
            (!currentClient.last || saleAt.getTime() > currentClient.last.getTime())
          )
            currentClient.last = saleAt;
          map.set(id, currentClient);
          return map;
        }, new Map());
    const out = products.filter(
        (product) => window.getProductStockStatus?.(product) === "esgotado",
      ),
      low = products.filter(
        (product) => window.getProductStockStatus?.(product) === "baixo",
      ),
      inactive = clients.filter((client) => {
        const date = isAllSpaces
          ? validDate(client.ultimaCompra)
          : scopedClientMetrics?.get(String(client.id))?.last || null;
        return date && Date.now() - date.getTime() > 30 * DAY;
      }),
      newClients = clients.filter((client) =>
        within(
          client.criadoEm || client.createdAt,
          selected.start,
          selected.end,
        ),
      ),
      vip = clients.filter(
        (client) => {
          const metrics = scopedClientMetrics?.get(String(client.id));
          return isAllSpaces
            ? number(client.totalComprado) >= 1000 ||
                number(client.quantidadeVendas) >= 10
            : number(metrics?.value) >= 1000 || number(metrics?.count) >= 10;
        },
      );
    const activeCampaigns = (db.campanhas || []).filter(
        (campaign) => window.Campanhas?.status?.(campaign) === "ativa",
      ),
      endingCampaigns = activeCampaigns.filter((campaign) => {
        const endDate = validDate(campaign.endDate || campaign.dataFim);
        return (
          endDate && endDate >= new Date() && endDate - new Date() <= 7 * DAY
        );
      }),
      pendingOrders = (db.catalogOrders || []).filter(
        (order) =>
          window.OnlineOrderModel?.isV2(order) && !["entregue", "cancelado", "expirado"].includes(
            order.orderStatus || order.status,
          ),
      ),
      campaignMetrics = isAllSpaces
        ? window.Campanhas?.metricas?.() || {
            active: 0,
            participants: 0,
            redemptions: 0,
            conversion: 0,
          }
        : (() => {
            const participants = new Set(
                (db.progressosCampanha || [])
                  .map((item) => item.clientId || item.clienteId)
                  .filter(Boolean),
              ).size,
              redemptions = (db.recompensas || []).length;
            return {
              active: activeCampaigns.length,
              participants,
              redemptions,
              conversion: participants ? (redemptions / participants) * 100 : 0,
            };
          })(),
      goal = number(
        window.SpaceContext?.goalFor?.(db.config || {}, selectionId) ??
          db.config?.dashboard?.dailySalesGoal ??
          db.config?.dailySalesGoal,
      );
    return {
      db,
      selected,
      sales,
      current,
      previous,
      today,
      clients,
      products,
      revenue,
      exchangeAdjustment,
      exchangeCount:exchangeRows.filter(row=>within(row.createdAt,selected.start,selected.end)).length,
      previousRevenue,
      revenueGrowth: percent(revenue, previousRevenue),
      todayRevenue,
      todayProfit,
      exchangeProjectionPending,
      receivedToday,
      openBalance,
      receivable,
      receivableFuture,
      receivablePending,
      creditEnabled,
      daily,
      best,
      topProducts,
      out,
      low,
      inactive,
      newClients,
      vip,
      campaignMetrics,
      activeCampaigns,
      endingCampaigns,
      pendingOrders,
      goal,
      goalPercent: goal > 0 ? (todayRevenue / goal) * 100 : 0,
      selectionId,
      isAllSpaces,
      unassignedLegacySales: number(db.unassignedLegacySales),
      ticket: current.length ? revenue / current.length : 0,
      averageDaily: daily.length ? revenue / daily.length : 0,
      baseRevenue: isAllSpaces
        ? clients.reduce(
            (sum, client) => sum + number(client.totalComprado),
            0,
          )
        : sales.reduce((sum, sale) => sum + saleValue(sale), 0),
    };
  }
  function trend(value, label = "vs período anterior") {
    const positive = value >= 0;
    return `<span class="desktop-kpi-trend ${positive ? "positive" : "negative"}">${icon(positive ? "trending-up" : "trending-down")} ${positive ? "+" : "−"}${Math.abs(value).toFixed(1).replace(".", ",")}%</span><small>${label}</small>`;
  }
  // Estados que não são valores confirmados ganham ícone e contorno próprios (não só cor).
  const REVIEW_VALUES = new Set(["Em revisão", "A conferir"]);
  function kpi(
    title,
    value,
    subtitle,
    ico,
    comparison = null,
    tone = "default",
    options = {},
  ) {
    const review = REVIEW_VALUES.has(String(value)),
      rank = options.primary ? "is-primary" : "is-secondary";
    return `<article class="desktop-kpi ${tone} ${rank}${review ? " is-review" : ""}" data-kpi="${esc(options.key || "")}" style="--vf-i:${number(options.order)}"><span class="desktop-kpi-icon">${icon(ico)}</span><div><small>${esc(title)}</small><strong>${review ? icon("clock-3") : ""}${esc(value)}</strong><em>${esc(subtitle)}</em></div>${comparison === null ? "" : `<span class="desktop-kpi-compare">${trend(comparison)}</span>`}</article>`;
  }
  const dayLabel = (date) =>
    date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  // Só apresentação: os valores diários chegam prontos de aggregate().
  function chart(rows) {
    const VF = window.VeconiFluxo || {},
      width = 720,
      height = 232,
      padX = 18,
      padTop = 14,
      padBottom = 12,
      empty = !rows.length || rows.every((row) => !row.value && !row.count),
      rawMax = Math.max(...rows.map((row) => row.value), 0),
      rawMin = Math.min(...rows.map((row) => row.value), 0),
      nice = (value) => (VF.niceMax ? VF.niceMax(value) : Math.max(value, 1)),
      top = nice(rawMax),
      bottom = rawMin < 0 ? -nice(-rawMin) : 0,
      span = top - bottom || 1,
      y = (value) =>
        height - padBottom - ((value - bottom) / span) * (height - padTop - padBottom),
      baseY = y(0),
      step = rows.length > 1 ? (width - padX * 2) / (rows.length - 1) : 0,
      points = rows.map((row, index) => ({
        x: rows.length > 1 ? padX + step * index : width / 2,
        y: y(row.value),
        ...row,
      })),
      path = VF.monotonePath
        ? VF.monotonePath(points)
        : points
            .map(
              (point, index) =>
                `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
            )
            .join(" "),
      area = `${path} L ${(points.at(-1)?.x ?? padX).toFixed(1)} ${baseY.toFixed(1)} L ${(points[0]?.x ?? padX).toFixed(1)} ${baseY.toFixed(1)} Z`,
      ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => bottom + span * part),
      compact = (value) =>
        VF.compactMoney ? VF.compactMoney(value) : money(value),
      labelEvery = Math.max(1, Math.ceil(rows.length / 7)),
      total = rows.reduce((sum, row) => sum + row.value, 0),
      canSell = window.TeamAccess?.canRoute?.("vender") ?? true;
    const grid = ticks
      .map((tick) => `M ${padX} ${y(tick).toFixed(1)} H ${width - padX}`)
      .join(" ");
    const marks = empty
      ? ""
      : `<path class="chart-area" d="${area}"/><path class="chart-line" pathLength="1" d="${path}"/><line class="chart-guide" data-chart-guide x1="0" x2="0" y1="${padTop}" y2="${baseY.toFixed(1)}"/>${points
          .map(
            (point, index) =>
              `<circle class="chart-point${point.value ? "" : " is-zero"}" data-chart-point cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" tabindex="${index === points.length - 1 ? 0 : -1}" role="img" aria-label="${esc(`${point.date.toLocaleDateString("pt-BR")}: ${money(point.value)}, ${point.count} venda(s)`)}" data-value="${esc(money(point.value))}" data-label="${esc(`${point.date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} · ${point.count} venda(s)`)}" style="--vf-i:${index}"><title>${point.date.toLocaleDateString("pt-BR")}: ${money(point.value)}</title></circle>`,
          )
          .join("")}`;
    const emptyState = `<div class="vf-chart-empty" data-chart-empty role="status"><span class="vf-chart-empty-mark">${icon("chart-spline")}</span><b>Nenhuma venda confirmada neste período</b><small>Quando houver vendas, a evolução de cada dia aparece aqui.</small>${canSell ? `<button type="button" class="vf-chart-empty-action" data-go="vender">${icon("shopping-bag")}Registrar venda</button>` : ""}</div>`;
    return `<div class="desktop-sales-chart${empty ? " is-empty" : ""}" data-vf-chart><div class="vf-chart-scale" aria-hidden="true">${empty ? "" : ticks.map((tick) => `<span style="top:${((y(tick) / height) * 100).toFixed(2)}%">${esc(compact(tick))}</span>`).join("")}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(empty ? "Evolução das vendas: nenhuma venda no período" : `Evolução das vendas: ${money(total)} no período`)}"><defs><linearGradient id="desktopChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="vf-fill-start"/><stop offset="1" class="vf-fill-end"/></linearGradient></defs><path class="chart-grid" d="${grid}"/><path class="chart-baseline" d="M ${padX} ${baseY.toFixed(1)} H ${width - padX}"/>${marks}</svg><div class="desktop-chart-axis" aria-hidden="true">${points.map((point, index) => index % labelEvery === 0 || index === points.length - 1 ? `<span style="left:${((point.x / width) * 100).toFixed(2)}%">${dayLabel(point.date)}</span>` : "").join("")}</div>${empty ? emptyState : '<div class="vf-chart-tooltip" data-chart-tooltip role="status" hidden></div>'}</div>`;
  }
  function panelHeader(title, action = "", route = "") {
    return `<header class="desktop-panel-head"><h3>${esc(title)}</h3>${action ? `<button type="button" ${route ? `data-go="${route}"` : ""}>${esc(action)} ${icon("chevron-right")}</button>` : ""}</header>`;
  }
  function topProducts(view) {
    return `<section class="desktop-panel desktop-top-products">${panelHeader("Top produtos", "Ver todos", "relatorios")}<div>${view.topProducts.map((product, index) => `<article><span>${index + 1}</span><b title="${esc(product.name)}">${esc(product.name)}</b><small>${product.quantity} un.</small><strong>${money(product.value)}</strong></article>`).join("") || '<p class="desktop-empty">Nenhuma venda no período.</p>'}</div></section>`;
  }
  function recentSales(view) {
    return `<section class="desktop-panel desktop-recent-sales">${panelHeader("Vendas recentes", "Ver todas", "historico")}<div class="desktop-table"><div class="desktop-table-head"><span>Data</span><span>Cliente</span><span>Status</span><span>Valor</span></div>${
      [...view.sales]
        .sort(
          (a, b) =>
            new Date(b.data || b.createdAt) - new Date(a.data || a.createdAt),
        )
        .slice(0, 5)
        .map(
          (sale) =>
            `<article><time>${new Date(sale.data || sale.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><b>${esc(sale.clienteNome || "Venda avulsa")}</b><span class="desktop-status ${sale.status === "pago" ? "paid" : "debt"}">${esc(sale.status || "pago")}</span><strong>${money(saleValue(sale))}</strong></article>`,
        )
        .join("") || '<p class="desktop-empty">Nenhuma venda registrada.</p>'
    }</div></section>`;
  }
  function alerts(view) {
    const rows = [
      view.out.length && [
        "triangle-alert",
        `${view.out.length} produto(s) esgotado(s)`,
        "Reposição urgente",
        "produtos",
        "danger",
      ],
      view.low.length && [
        "package-open",
        `${view.low.length} produto(s) abaixo do mínimo`,
        "Verifique o estoque",
        "produtos",
        "warning",
      ],
      view.inactive.length && [
        "user-round-x",
        `${view.inactive.length} cliente(s) inativo(s)`,
        "Sem comprar há mais de 30 dias",
        "crm",
        "info",
      ],
      view.endingCampaigns.length && [
        "calendar-clock",
        `${view.endingCampaigns.length} campanha(s) terminando`,
        "Nos próximos 7 dias",
        "campanhas",
        "violet",
      ],
      view.pendingOrders.length && [
        "clipboard-list",
        `${view.pendingOrders.length} pedido(s) aguardando`,
        "Acompanhe os pedidos online",
        "pedidos",
        "info",
      ],
    ].filter(Boolean);
    return `<section class="desktop-panel desktop-alerts">${panelHeader("Alertas inteligentes")}<div>${rows.map(([ico, title, copy, route, tone]) => `<button type="button" data-go="${route}" class="${tone}">${icon(ico)}<span><b>${esc(title)}</b><small>${esc(copy)}</small></span>${icon("chevron-right")}</button>`).join("") || '<p class="desktop-empty">Tudo tranquilo por enquanto.</p>'}</div></section>`;
  }
  function crmSummary(view) {
    const inCampaign = new Set(
      (view.db.progressosCampanha || [])
        .map((item) => item.clientId || item.clienteId)
        .filter(Boolean),
    ).size;
    return `<section class="desktop-panel desktop-crm-summary">${panelHeader("Resumo CRM", "Abrir CRM", "crm")}<div>${[
      ["Clientes ativos", view.clients.length, "users"],
      ["Clientes inativos", view.inactive.length, "user-round-x"],
      ["Clientes novos", view.newClients.length, "user-plus"],
      ["Clientes VIP", view.vip.length, "crown"],
      ["Em campanhas", inCampaign, "megaphone"],
      ["Aniversários próximos", "—", "cake"],
    ]
      .map(
        ([label, value, ico]) =>
          `<article>${icon(ico)}<span><b>${esc(value)}</b><small>${esc(label)}</small></span></article>`,
      )
      .join("")}</div></section>`;
  }
  function campaignSummary(view) {
    const metrics = view.campaignMetrics;
    return `<section class="desktop-panel desktop-campaign-summary">${panelHeader("Campanhas e fidelidade", "Gerenciar campanhas", "campanhas")}<div>${[
      ["Campanhas ativas", metrics.active, "megaphone"],
      ["Participantes", metrics.participants, "users"],
      [
        "Conversão",
        `${number(metrics.conversion).toFixed(1).replace(".", ",")}%`,
        "chart-no-axes-combined",
      ],
      ["Resgates", metrics.redemptions, "gift"],
      ["Receita gerada", "—", "circle-dollar-sign"],
    ]
      .map(
        ([label, value, ico]) =>
          `<article>${icon(ico)}<span><b>${esc(value)}</b><small>${esc(label)}</small></span></article>`,
      )
      .join("")}</div></section>`;
  }
  function quickActions() {
    return `<section class="desktop-panel desktop-quick-actions">${panelHeader("Ações rápidas")}<div>${[
      ["vender", "shopping-bag", "Nova venda", "Registrar uma venda"],
      [
        "fiados",
        "banknote-arrow-down",
        "Receber pagamento",
        "Baixar fiado ou receber",
      ],
      ["clientes", "user-plus", "Novo cliente", "Cadastrar cliente"],
      ["produtos", "package-plus", "Novo produto", "Cadastrar produto"],
      ["campanhas", "megaphone", "Criar campanha", "Fidelizar clientes"],
      ["crm", "contact-round", "Ver CRM", "Análises e segmentos"],
      ["historico", "history", "Ver histórico", "Vendas e ajustes"],
    ]
      .filter(([route]) => window.TeamAccess?.canRoute?.(route) ?? true)
      .map(
        ([route, ico, title, copy]) =>
          `<button type="button" data-go="${route}">${icon(ico)}<span><b>${title}</b><small>${copy}</small></span></button>`,
      )
      .join("")}</div></section>`;
  }
  function legacyNotice(view) {
    const count = view.unassignedLegacySales;
    const exchangeNote=window.ExchangeEconomics?`<p class="space-data-notice" data-state="${(s=>s.mode==='unavailable'||s.mode==='historical'||!s.ready&&s.error?'warning':s.ready?'ok':'pending')(window.ExchangeEconomics.state())}" role="status">${esc(window.ExchangeEconomics.statusMessage())}${view.exchangeCount?` Ajustes no período: ${money(view.exchangeAdjustment)}. Custos e lucro das trocas em revisão.`:''}</p>`:'';
    const legacy = count ? `<aside class="space-data-notice" data-state="info" role="status">${icon("history")}<span><b>${count} venda${count === 1 ? " antiga" : "s antigas"} sem espaço</b><small>${view.isAllSpaces ? (count === 1 ? "Ela continua nesta visão agregada." : "Elas continuam nesta visão agregada.") : count === 1 ? "Ela ficou fora desta visão para não ser atribuída ao espaço errado." : "Elas ficaram fora desta visão para não serem atribuídas ao espaço errado."}</small></span></aside>` : "";
    // Avisos nunca somem: ficam agrupados logo abaixo do cabeçalho.
    return exchangeNote || legacy ? `<section class="vf-notices" aria-label="Avisos do painel">${exchangeNote}${legacy}</section>` : "";
  }
  function goalCard(view) {
    const label = view.isAllSpaces
        ? "Meta geral diária"
        : `Meta diária · ${window.SpaceContext?.selectionLabel?.("home") || "Espaço"}`,
      description = view.isAllSpaces
        ? "Configurada de forma independente das metas dos espaços."
        : "Somente as vendas deste espaço entram no progresso.";
    if (!view.goal)
      return `<button class="desktop-space-goal is-empty" type="button" data-home-goal><span class="desktop-space-goal-icon">${icon("target")}</span><span class="desktop-space-goal-copy"><b>${esc(label)}</b><small>${esc(description)}</small></span><strong>Configurar ${icon("chevron-right")}</strong></button>`;
    const progress = Math.min(100, Math.max(0, view.goalPercent)),
      reached = view.goalPercent >= 100,
      remaining = Math.max(0, view.goal - view.todayRevenue);
    return `<section class="desktop-space-goal ${reached ? "is-reached" : ""}"><span class="desktop-space-goal-icon">${icon(reached ? "circle-check-big" : "target")}</span><div class="desktop-space-goal-copy"><b>${esc(label)}</b><small>${esc(reached ? "Meta do dia atingida." : `Faltam ${money(remaining)} para a meta de hoje.`)}</small></div><div class="desktop-space-goal-values"><span><strong>${money(view.todayRevenue)}</strong> de ${money(view.goal)}</span><div role="progressbar" aria-label="Progresso da meta diária" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="--space-goal-progress:${progress}%"></i></div></div><em>${view.goalPercent.toFixed(0)}%</em><button type="button" data-home-goal aria-label="Editar meta diária">Editar ${icon("chevron-right")}</button></section>`;
  }
  // Cabeçalho universal (sem imagem de segmento): saudação, resumo real do dia,
  // seletor de espaço e meta no mesmo bloco, sobre o fluxo gráfico da marca.
  function hero(view, contextBar) {
    const VF = window.VeconiFluxo,
      latest = view.today.reduce((last, sale) => {
        const date = validDate(sale.data || sale.createdAt);
        return date && (!last || date > last) ? date : last;
      }, null),
      count = view.today.length,
      summary = count
        ? `${count} venda${count === 1 ? "" : "s"} hoje${latest ? `, a última às ${latest.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}.`
        : "Nenhuma venda registrada hoje até agora.";
    return `<header class="vf-hero" data-vf-hero>${VF?.flowArt?.("hero") || ""}<div class="vf-hero-copy"><h2>${esc(VF?.greeting?.() || "Olá")}</h2><p>${esc(summary)}</p></div><div class="vf-hero-context">${contextBar}</div><div class="vf-hero-goal">${goalCard(view)}</div></header>`;
  }
  // Mesmas origens e fórmulas de antes; ícones e descrições tornam o papel de cada linha legível sem depender de cor.
  function financePanel(view) {
    const received = (view.db.pagamentos || [])
      .filter((payment) => within(payment.data || payment.createdAt, view.selected.start, view.selected.end))
      .reduce((sum, payment) => sum + number(payment.valor), 0);
    return `<section class="desktop-panel desktop-finance">${panelHeader("Painel financeiro")}<div><span class="is-in"><i class="vf-fin-icon">${icon("arrow-down-left")}</i><small>Recebido no período</small><b class="positive">${money(received)}</b><em>Pagamentos registrados</em></span><span class="is-due${view.receivablePending ? " is-review" : ""}"><i class="vf-fin-icon">${icon("hourglass")}</i><small>A receber</small><b class="negative">${view.receivablePending ? "A conferir" : money(view.openBalance)}</b><em>${view.receivablePending ? "Contas a conferir no servidor" : "Ainda não pago pelos clientes"}</em></span><span class="is-out"><i class="vf-fin-icon">${icon("circle-minus")}</i><small>Despesas</small><b class="is-pending">Não incluídas</b><em>Fora deste cálculo</em></span><span class="forecast${view.receivablePending ? " is-review" : ""}"><i class="vf-fin-icon">${icon("equal")}</i><small>Saldo previsto</small><b>${view.receivablePending ? "A conferir" : money(view.revenue - view.openBalance)}</b><em>Vendas do período − total a receber</em></span></div></section>`;
  }
  function receivableHint(view) {
    if (view.receivablePending) return `${view.receivable.unknown} conta(s) a conferir no servidor`;
    if (view.receivableFuture > 0) return `exigível · ${money(view.receivableFuture)} em parcelas futuras`;
    return view.receivable ? "exigível confirmado" : "saldo de clientes";
  }
  const hydrated = new Map();
  // Ask the server for the accounts this space cannot prove locally (e.g. a
  // confirmed balance regularization). Throttled; a failure keeps "a conferir".
  function hydrateReceivable(view) {
    const ids = view?.receivable?.unknownIds || [];
    if (!ids.length || !window.InstallmentCredit?.refresh || navigator.onLine === false) return;
    const now = Date.now();
    for (const id of ids.slice(0, 25)) {
      if (now - (hydrated.get(id) || 0) < 60000) continue;
      hydrated.set(id, now);
      window.InstallmentCredit.refresh(id).catch(() => {});
    }
  }
  function render() {
    if ((window.PerformanceAccess?.restricted() || window.TeamAccess?.requiresDailyDashboard?.())) return window.PerformanceAccess?.render?.() || '<section role="status">Não foi possível carregar os indicadores. Reabra o aplicativo sem limpar os dados.</section>';
    window.AppBootDiagnostics?.count?.("dashboardRenderCount");
    const renderStartedAt = window.performance?.now?.() ?? Date.now(),
      view = aggregate(DB.carregar()),
      receivableTitle = view.creditEnabled ? "A receber" : "Receita da base",
      receivableValue = view.creditEnabled
        ? view.openBalance
        : view.baseRevenue,
      canViewProfit = window.TeamAccess?.has ? window.TeamAccess.has("profit.view") : true,
      canViewFinancial = window.TeamAccess?.has ? window.TeamAccess.has("financial.view") : true,
      canViewReports = window.TeamAccess?.has ? window.TeamAccess.has("reports.view") : true;
    window.AppBootDiagnostics?.phase?.("dashboard data aggregated", {
      durationMs: Math.round((window.performance?.now?.() ?? Date.now()) - renderStartedAt),
      clients: view.clients.length,
      sales: view.sales.length,
      products: view.products.length,
    });
    const contextBar = window.SpaceContext?.renderBar?.("home") || "";
    const kpis = [
      kpi("Vendas hoje", money(view.todayRevenue), `${view.today.length} venda(s)`, "shopping-cart", null, "default", { primary: true, key: "sales", order: 0 }),
      canViewFinancial ? kpi("Recebido hoje", money(view.receivedToday), "pagamentos recebidos", "circle-dollar-sign", null, "default", { primary: true, key: "received", order: 1 }) : "",
      canViewFinancial ? kpi(receivableTitle, view.creditEnabled && view.receivablePending ? "A conferir" : money(receivableValue), view.creditEnabled ? receivableHint(view) : "histórico da base", view.creditEnabled ? "hand-coins" : "chart-line", null, view.creditEnabled ? "danger" : "default", { primary: true, key: "receivable", order: 2 }) : "",
      canViewProfit ? kpi("Lucro estimado", view.todayProfit===null?"Em revisão":money(view.todayProfit), view.todayProfit===null?(view.exchangeProjectionPending?"Ajustes de troca não confirmados":"Custos das trocas em revisão"):"hoje", "trending-up", null, "default", { primary: true, key: "profit", order: 3 }) : "",
      kpi("Clientes ativos", view.clients.length, "cadastrados", "users", null, "default", { key: "clients", order: 4 }),
      kpi("Produtos cadastrados", view.products.length, "itens ativos", "package", null, "default", { key: "products", order: 5 }),
    ].join("");
    return `<section class="desktop-dashboard vf-home" data-desktop-dashboard>${hero(view, contextBar)}${legacyNotice(view)}<section class="desktop-kpis" aria-label="Indicadores de hoje">${kpis}</section><section class="desktop-performance-grid"><article class="desktop-panel desktop-sales-performance">${panelHeader("Desempenho de vendas")}<label class="vf-period">Período<select id="desktop-dashboard-period"><option value="today">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="month">Mês atual</option></select></label><div class="desktop-performance-value"><strong>${money(view.revenue)}</strong>${trend(view.revenueGrowth)}</div><div class="desktop-chart-layout">${chart(view.daily)}<aside><span><small>Média diária</small><b>${money(view.averageDaily)}</b></span><span><small>Melhor dia</small><b>${view.best.date ? view.best.date.toLocaleDateString("pt-BR") : "—"}</b><em>${money(view.best.value)}</em></span><span><small>Ticket médio</small><b>${money(view.ticket)}</b></span><span><small>Crescimento</small><b>${view.revenueGrowth.toFixed(1).replace(".", ",")}%</b></span></aside></div></article>${canViewFinancial?financePanel(view):''}</section>${quickActions()}<section class="desktop-command-grid">${recentSales(view)}${topProducts(view)}${alerts(view)}${canViewReports?crmSummary(view):''}</section>${canViewReports?campaignSummary(view):''}</section>`;
  }
  function bind() {
    if ((window.PerformanceAccess?.restricted() || window.TeamAccess?.requiresDailyDashboard?.())) { window.PerformanceAccess?.bind?.(); return; }
    const root = document.querySelector("[data-desktop-dashboard]");
    if (!root) return;
    void window.ExchangeEconomics?.refresh?.();
    document
      .querySelector("#app")
      ?.setAttribute("data-dashboard-visual", "desktop-v2");
    const select = root.querySelector("#desktop-dashboard-period");
    select.value = state.period;
    select.onchange = (event) => {
      state.period = event.target.value;
      document.querySelector("#app").innerHTML = render();
      bind();
    };
    root
      .querySelectorAll("[data-go]")
      .forEach(
        (button) =>
          (button.onclick = () => window.Router?.ir?.(button.dataset.go)),
      );
    window.SpaceContext?.bind?.(root);
    window.VeconiFluxo?.bindChart?.(root);
    try { hydrateReceivable(aggregate(DB.carregar())); } catch { /* indicador permanece a conferir */ }
    window.lucide?.createIcons();
  }
  window.addEventListener?.('business-context-changed',()=>{
    state.period='7d';
    if(!(window.PerformanceAccess?.restricted() || window.TeamAccess?.requiresDailyDashboard?.()) && !window.MobileHome?.isMobile?.() && document.querySelector('[data-daily-performance], [data-desktop-dashboard]')) {
      const app=document.querySelector('#app'); if(app){app.innerHTML=render();bind();}
    }
  });
  window.DesktopDashboard = { render, bind, aggregate, state };
  let receivableRerender=false;
  window.addEventListener?.('fiado-account-updated',()=>{
    if(receivableRerender||!document.querySelector('[data-desktop-dashboard]'))return;receivableRerender=true;
    setTimeout(()=>{receivableRerender=false;window.Clientes?.prepareList?.();const app=document.querySelector('#app');if(app&&document.querySelector('[data-desktop-dashboard]')){app.innerHTML=render();bind();}},250);
  });
  window.addEventListener?.('sale-exchange-metrics-updated',()=>{
    if(!document.querySelector('[data-desktop-dashboard]'))return;
    const app=document.querySelector('#app');if(app){app.innerHTML=render();bind();}
  });
})();

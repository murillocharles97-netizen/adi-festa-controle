(function () {
  "use strict";
  const state = { period: "7d" };
  const DAY = 86400000;
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const esc = (value) =>
    window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const money = (value) =>
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
      validClientIds = isAllSpaces
        ? null
        : new Set(
            sales
              .map((sale) => sale.clienteId || sale.clientId)
              .filter(Boolean)
              .map(String),
          ),
      clients = (db.clientes || []).filter(
        (client) =>
          client.ativo !== false &&
          (isAllSpaces || validClientIds.has(String(client.id))),
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
    const revenue = current.reduce((sum, sale) => sum + saleValue(sale), 0),
      previousRevenue = previous.reduce(
        (sum, sale) => sum + saleValue(sale),
        0,
      ),
      todayRevenue = today.reduce((sum, sale) => sum + saleValue(sale), 0),
      todayProfit = today.reduce((sum, sale) => sum + number(sale.lucro), 0),
      receivedToday = todayPayments.reduce(
        (sum, payment) => sum + number(payment.valor),
        0,
      ),
      openBalance = isAllSpaces
        ? clients.reduce(
            (sum, client) =>
              sum + Math.abs(Math.min(0, number(client.saldo))),
            0,
          )
        : sales.reduce((sum, sale) => sum + saleDebt(sale), 0),
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
          !["entregue", "cancelado"].includes(
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
      previousRevenue,
      revenueGrowth: percent(revenue, previousRevenue),
      todayRevenue,
      todayProfit,
      receivedToday,
      openBalance,
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
    return `<span class="desktop-kpi-trend ${positive ? "positive" : "negative"}">${icon(positive ? "trending-up" : "trending-down")} ${Math.abs(value).toFixed(1).replace(".", ",")}%</span><small>${label}</small>`;
  }
  function kpi(
    title,
    value,
    subtitle,
    ico,
    comparison = null,
    tone = "default",
  ) {
    return `<article class="desktop-kpi ${tone}"><span class="desktop-kpi-icon">${icon(ico)}</span><div><small>${esc(title)}</small><strong>${esc(value)}</strong><em>${esc(subtitle)}</em></div>${comparison === null ? '<span class="desktop-kpi-static">—</span>' : `<span class="desktop-kpi-compare">${trend(comparison)}</span>`}</article>`;
  }
  function chart(rows) {
    const width = 720,
      height = 220,
      pad = 22,
      max = Math.max(...rows.map((row) => row.value), 1),
      step = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0,
      points = rows.map((row, index) => ({
        x: pad + step * index,
        y: height - pad - (row.value / max) * (height - pad * 2),
        ...row,
      })),
      path = points
        .map(
          (point, index) =>
            `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
        )
        .join(" "),
      area = `${path} L ${points.at(-1)?.x || pad} ${height - pad} L ${pad} ${height - pad} Z`,
      labelEvery = Math.max(1, Math.ceil(rows.length / 7));
    return `<div class="desktop-sales-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução das vendas"><defs><linearGradient id="desktopChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#31d0ad" stop-opacity=".3"/><stop offset="1" stop-color="#31d0ad" stop-opacity=".02"/></linearGradient></defs><path class="chart-grid" d="M ${pad} ${height * 0.25} H ${width - pad} M ${pad} ${height * 0.5} H ${width - pad} M ${pad} ${height * 0.75} H ${width - pad}"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${point.date.toLocaleDateString("pt-BR")}: ${money(point.value)}</title></circle>${index % labelEvery === 0 || index === points.length - 1 ? `<text x="${point.x}" y="${height - 3}" text-anchor="middle">${point.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>` : ""}`).join("")}</svg></div>`;
  }
  function panelHeader(title, action = "", route = "") {
    return `<header class="desktop-panel-head"><h3>${esc(title)}</h3>${action ? `<button type="button" ${route ? `data-go="${route}"` : ""}>${esc(action)} ${icon("chevron-right")}</button>` : ""}</header>`;
  }
  function topProducts(view) {
    return `<section class="desktop-panel desktop-top-products">${panelHeader("Top produtos", "Ver todos", "relatorios")}<div>${view.topProducts.map((product, index) => `<article><span>${index + 1}</span><b>${esc(product.name)}</b><small>${product.quantity} un.</small><strong>${money(product.value)}</strong></article>`).join("") || '<p class="desktop-empty">Nenhuma venda no período.</p>'}</div></section>`;
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
    if (!count) return "";
    return `<aside class="space-data-notice" role="status">${icon("history")}<span><b>${count} venda${count === 1 ? " antiga" : "s antigas"} sem espaço</b><small>${view.isAllSpaces ? (count === 1 ? "Ela continua nesta visão agregada." : "Elas continuam nesta visão agregada.") : count === 1 ? "Ela ficou fora desta visão para não ser atribuída ao espaço errado." : "Elas ficaram fora desta visão para não serem atribuídas ao espaço errado."}</small></span></aside>`;
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
      reached = view.goalPercent >= 100;
    return `<section class="desktop-space-goal ${reached ? "is-reached" : ""}"><span class="desktop-space-goal-icon">${icon(reached ? "circle-check-big" : "target")}</span><div class="desktop-space-goal-copy"><b>${esc(label)}</b><small>${esc(description)}</small></div><div class="desktop-space-goal-values"><span><strong>${money(view.todayRevenue)}</strong> de ${money(view.goal)}</span><div role="progressbar" aria-label="Progresso da meta diária" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="--space-goal-progress:${progress}%"></i></div></div><em>${view.goalPercent.toFixed(0)}%</em><button type="button" data-home-goal>Editar ${icon("chevron-right")}</button></section>`;
  }
  function render() {
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
    return `<section class="desktop-dashboard" data-desktop-dashboard>${contextBar}${legacyNotice(view)}${goalCard(view)}<section class="desktop-kpis">${kpi("Vendas hoje", money(view.todayRevenue), `${view.today.length} venda(s)`, "shopping-cart", null)}${canViewFinancial?kpi("Recebido hoje", money(view.receivedToday), "pagamentos recebidos", "circle-dollar-sign", null):''}${kpi("Clientes ativos", view.clients.length, "cadastrados", "users", null)}${kpi("Produtos cadastrados", view.products.length, "itens ativos", "package", null)}${canViewProfit?kpi("Lucro estimado", money(view.todayProfit), "hoje", "trending-up", null):''}${canViewFinancial?kpi(receivableTitle, money(receivableValue), view.creditEnabled ? "saldo de clientes" : "histórico da base", view.creditEnabled ? "hand-coins" : "chart-line", null, view.creditEnabled ? "danger" : "default"):''}</section><section class="desktop-performance-grid"><article class="desktop-panel desktop-sales-performance">${panelHeader("Desempenho de vendas")}<label>Período<select id="desktop-dashboard-period"><option value="today">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="month">Mês atual</option></select></label><div class="desktop-performance-value"><strong>${money(view.revenue)}</strong>${trend(view.revenueGrowth)}</div><div class="desktop-chart-layout">${chart(view.daily)}<aside><span><small>Média diária</small><b>${money(view.averageDaily)}</b></span><span><small>Melhor dia</small><b>${view.best.date ? view.best.date.toLocaleDateString("pt-BR") : "—"}</b><em>${money(view.best.value)}</em></span><span><small>Ticket médio</small><b>${money(view.ticket)}</b></span><span><small>Crescimento</small><b>${view.revenueGrowth.toFixed(1).replace(".", ",")}%</b></span></aside></div></article>${canViewFinancial?`<section class="desktop-panel desktop-finance">${panelHeader("Painel financeiro")}<div><span><small>Recebido no período</small><b class="positive">${money((view.db.pagamentos || []).filter((payment) => within(payment.data || payment.createdAt, view.selected.start, view.selected.end)).reduce((sum, payment) => sum + number(payment.valor), 0))}</b></span><span><small>A receber</small><b class="negative">${money(view.openBalance)}</b></span><span><small>Despesas</small><b>${money(0)} <em>placeholder</em></b></span><span class="forecast"><small>Saldo previsto</small><b>${money(view.revenue - view.openBalance)}</b></span></div></section>`:''}${topProducts(view)}</section>${quickActions()}<section class="desktop-command-grid">${recentSales(view)}${alerts(view)}${canViewReports?crmSummary(view):''}</section>${canViewReports?campaignSummary(view):''}</section>`;
  }
  function bind() {
    const root = document.querySelector("[data-desktop-dashboard]");
    if (!root) return;
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
    window.lucide?.createIcons();
  }
  window.DesktopDashboard = { render, bind, aggregate, state };
})();

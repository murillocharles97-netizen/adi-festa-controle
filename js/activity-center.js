(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) =>
    window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const money = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const PAGE_SIZE = 20,
    SOURCE_LIMIT = 240;
  const state = {
    query: "",
    quick: "todos",
    sort: "recentes",
    page: 1,
    filters: {
      start: "",
      end: "",
      min: "",
      max: "",
      status: "todos",
      types: [],
    },
  };
  const TYPE_META = {
    sale: { label: "Venda", icon: "shopping-cart", tone: "green" },
    payment: { label: "Pagamento", icon: "wallet-cards", tone: "green" },
    balance: {
      label: "Ajuste de saldo",
      icon: "arrow-up-down",
      tone: "orange",
    },
    stock: { label: "Estoque", icon: "package", tone: "blue" },
    campaign: { label: "Campanha", icon: "megaphone", tone: "purple" },
    renewal: { label: "Renovação", icon: "calendar-sync", tone: "purple" },
    order: { label: "Pedido", icon: "clipboard-list", tone: "blue" },
    system: { label: "Sistema", icon: "settings-2", tone: "slate" },
  };
  const at = (value) => {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  };
  const recent = (list) =>
    [...(list || [])]
      .sort(
        (a, b) =>
          at(b.data || b.createdAt || b.updatedAt) -
          at(a.data || a.createdAt || a.updatedAt),
      )
      .slice(0, SOURCE_LIMIT);
  const clientName = (db, id, fallback = "") =>
    fallback ||
    db.clientes?.find((item) => String(item.id) === String(id))?.nome ||
    "";
  const productName = (db, id, fallback = "") =>
    fallback ||
    db.produtos?.find((item) => String(item.id) === String(id))?.nome ||
    "";
  const campaignName = (db, id) =>
    db.campanhas?.find((item) => String(item.id) === String(id))?.nome ||
    "Campanha";
  const valueOf = (item) =>
    Number(
      item.value ??
        item.raw?.valor ??
        item.raw?.total ??
        item.raw?.valorFinal ??
        item.raw?.valorTotal ??
        0,
    );
  function movementEvent(db, item) {
    const type = String(item.tipo || "");
    if (["desconto", "ajuste_valor_venda"].includes(type)) return null;
    if (type === "venda")
      return {
        id: `movement:${item.id}`,
        type: "sale",
        date: item.data,
        title: `Venda para ${item.clienteNome || "cliente avulso"}`,
        subtitle:
          item.status === "fiado"
            ? "Venda registrada no fiado"
            : "Venda concluída",
        value: item.valor,
        status: item.status === "fiado" ? "Pendente" : "Concluída",
        statusTone: item.status === "fiado" ? "warning" : "success",
        resource: "sale",
        resourceId: item.vendaId,
        clientId: item.clienteId,
        search: `${item.clienteNome || ""} ${item.vendaId || ""}`,
        raw: item,
      };
    if (type === "pagamento")
      return {
        id: `movement:${item.id}`,
        type: "payment",
        date: item.data || item.createdAt,
        title: `Pagamento recebido de ${item.clienteNome || "cliente"}`,
        subtitle: item.observacao || "Saldo atualizado",
        value: item.valor,
        status: "Concluído",
        statusTone: "success",
        resource: "client",
        resourceId: item.clienteId,
        clientId: item.clienteId,
        search: item.clienteNome || "",
        raw: item,
      };
    if (type === "ajuste_saldo")
      return {
        id: `movement:${item.id}`,
        type: "balance",
        date: item.data,
        title: "Ajuste de saldo realizado",
        subtitle: `${item.clienteNome || "Cliente"}${item.motivo ? ` · ${item.motivo}` : ""}`,
        value: Number(item.saldoNovo) - Number(item.saldoAnterior),
        status:
          Number(item.saldoNovo) - Number(item.saldoAnterior) < 0
            ? "Débito"
            : "Ajustado",
        statusTone:
          Number(item.saldoNovo) - Number(item.saldoAnterior) < 0
            ? "danger"
            : "success",
        resource: "client",
        resourceId: item.clienteId,
        clientId: item.clienteId,
        search: `${item.clienteNome || ""} ${item.motivo || ""}`,
        raw: item,
      };
    if (type === "venda_desfeita")
      return {
        id: `movement:${item.id}`,
        type: "sale",
        date: item.data,
        title: "Venda cancelada",
        subtitle: item.clienteNome || "Venda avulsa",
        value: -Math.abs(Number(item.valor || 0)),
        status: "Cancelada",
        statusTone: "danger",
        resource: "sale",
        resourceId: item.vendaId,
        clientId: item.clienteId,
        search: item.clienteNome || "",
        raw: item,
      };
    if (type === "ajuste_administrativo_campanha")
      return {
        id: `movement:${item.id}`,
        type: "campaign",
        date: item.data,
        title: "Ajuste administrativo de campanha",
        subtitle: item.motivo || "Resolução registrada",
        status: "Resolvido",
        statusTone: "warning",
        resource: "campaign",
        resourceId: item.campaignId,
        clientId: item.clienteId,
        search: `${item.clienteNome || ""} ${item.motivo || ""}`,
        raw: item,
      };
    return null;
  }
  function stockEvent(db, item) {
    if (["saida_venda", "venda_desfeita"].includes(item.tipo)) return null;
    const labels = {
        entrada: "Entrada de estoque",
        ajuste: "Estoque ajustado",
        saida_resgate_campanha: "Resgate retirado do estoque",
        entrada_manual: "Entrada de estoque",
        ajuste_manual: "Estoque ajustado",
      },
      title =
        labels[item.tipo] ||
        String(item.tipo || "Movimentação de estoque").replaceAll("_", " "),
      name = productName(db, item.produtoId, item.produtoNome);
    return {
      id: `stock:${item.id}`,
      type: "stock",
      date: item.data || item.createdAt,
      title,
      subtitle: `${name || "Produto"}${item.variantName ? ` · ${item.variantName}` : ""}`,
      value: null,
      status: `${Number(item.quantidade || 0) > 0 ? "+" : ""}${Number(item.quantidade || 0)} un.`,
      statusTone: Number(item.quantidade || 0) < 0 ? "warning" : "info",
      resource: "product",
      resourceId: item.produtoId,
      search: `${name} ${item.variantName || ""} ${item.observacao || ""}`,
      raw: item,
    };
  }
  function campaignEvent(db, item) {
    const labels = {
        earned: "Benefício acumulado",
        confirmed: "Benefício confirmado",
        redeemed: "Recompensa resgatada",
        reversed: "Benefício revertido",
        expired: "Benefício expirado",
      },
      transition = String(item.transition || item.status || "atualizado"),
      name = campaignName(db, item.campaignId),
      client = clientName(db, item.clientId);
    return {
      id: `campaign:${item.id}`,
      type: "campaign",
      date: item.createdAt,
      title: labels[transition] || "Campanha atualizada",
      subtitle: `${name}${client ? ` · ${client}` : ""}`,
      status:
        transition === "reversed"
          ? "Revertido"
          : transition === "redeemed"
            ? "Resgatado"
            : transition === "expired"
              ? "Expirado"
              : "Registrado",
      statusTone: ["reversed", "expired"].includes(transition)
        ? "danger"
        : transition === "redeemed"
          ? "success"
          : "info",
      resource: "campaign",
      resourceId: item.campaignId,
      clientId: item.clientId,
      search: `${name} ${client} ${transition}`,
      raw: item,
    };
  }
  function renewalEvent(db, item) {
    const labels = {
        activation: "Renovação ativada",
        renewal: "Renovação registrada",
        price_changed: "Preço da renovação alterado",
        plan_changed: "Plano da renovação alterado",
        paused: "Renovação pausada",
        cancelled: "Renovação cancelada",
        expired: "Renovação expirada",
        reactivated: "Renovação reativada",
        sale_reversed: "Renovação revertida",
      },
      client = clientName(db, item.clientId),
      product = productName(
        db,
        item.productId,
        item.next?.label || item.previous?.label || "",
      );
    return {
      id: `renewal:${item.id}`,
      type: "renewal",
      date: item.createdAt,
      title: labels[item.transition] || "Renovação atualizada",
      subtitle:
        [client, product].filter(Boolean).join(" · ") || "Registro recorrente",
      status: ["cancelled", "expired", "sale_reversed"].includes(
        item.transition,
      )
        ? "Encerrada"
        : "Atualizada",
      statusTone: ["cancelled", "expired", "sale_reversed"].includes(
        item.transition,
      )
        ? "danger"
        : "success",
      resource: "client",
      resourceId: item.clientId,
      clientId: item.clientId,
      search: `${client} ${product} ${item.transition || ""}`,
      raw: item,
    };
  }
  function orderEvent(item) {
    const labels = {
        recebido: "Pedido recebido",
        confirmado: "Pedido confirmado",
        separando: "Pedido em preparo",
        deslocamento: "Pedido em deslocamento",
        entregue: "Pedido entregue",
        cancelado: "Pedido cancelado",
      },
      status = item.orderStatus || "recebido";
    return {
      id: `order:${item.id}`,
      type: "order",
      date: item.updatedAt || item.createdAt,
      title: labels[status] || "Pedido atualizado",
      subtitle: `#${item.publicOrderNumber || String(item.id || "").slice(0, 8)} · ${item.customerName || "Cliente"}`,
      value: item.total,
      status:
        status === "cancelado"
          ? "Cancelado"
          : status === "entregue"
            ? "Concluído"
            : "Em andamento",
      statusTone:
        status === "cancelado"
          ? "danger"
          : status === "entregue"
            ? "success"
            : "info",
      resource: "order",
      resourceId: item.id,
      clientId: item.clientId,
      search: `${item.publicOrderNumber || ""} ${item.customerName || ""} ${item.customerPhone || ""}`,
      raw: item,
    };
  }
  function events() {
    const db = window.DB?.carregar?.() || {},
      merged = [
        ...recent(db.movimentacoes).map((item) => movementEvent(db, item)),
        ...recent(db.movimentacoesEstoque).map((item) => stockEvent(db, item)),
        ...recent(db.eventosCampanha).map((item) => campaignEvent(db, item)),
        ...recent(db.customerSubscriptionEvents).map((item) =>
          renewalEvent(db, item),
        ),
        ...recent(db.catalogOrders)
          .filter((item) => !item.deletedAt)
          .map(orderEvent),
      ].filter(Boolean),
      seen = new Set();
    return merged
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => at(b.date) - at(a.date));
  }
  function matches(item) {
    const query = state.query.trim().toLowerCase(),
      f = state.filters,
      value = Math.abs(valueOf(item));
    if (state.quick !== "todos" && item.type !== state.quick) return false;
    if (f.types.length && !f.types.includes(item.type)) return false;
    if (f.status !== "todos" && item.statusTone !== f.status) return false;
    if (f.start && at(item.date) < new Date(`${f.start}T00:00:00`))
      return false;
    if (f.end && at(item.date) > new Date(`${f.end}T23:59:59.999`))
      return false;
    if (f.min !== "" && value < Number(f.min)) return false;
    if (f.max !== "" && value > Number(f.max)) return false;
    return (
      !query ||
      `${item.title} ${item.subtitle} ${item.search || ""} ${item.status || ""}`
        .toLowerCase()
        .includes(query)
    );
  }
  function filtered() {
    const list = events().filter(matches);
    return state.sort === "antigos" ? list.reverse() : list;
  }
  function dayLabel(value) {
    const date = at(value),
      today = new Date(),
      yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key(date) === key(today)) return "Hoje";
    if (key(date) === key(yesterday)) return "Ontem";
    return date.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  }
  const when = (value) =>
    at(value).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  function card(item) {
    const meta = TYPE_META[item.type] || TYPE_META.system,
      value =
        item.value !== null && item.value !== undefined
          ? `<strong class="activity-value ${Number(item.value) < 0 ? "negative" : ""}">${money(item.value)}</strong>`
          : "";
    return `<button class="activity-card tone-${meta.tone}" type="button" data-activity-id="${esc(item.id)}"><span class="activity-icon">${icon(meta.icon)}</span><span class="activity-copy"><em>${esc(meta.label)}</em><b>${esc(item.title)}</b><small>${esc(item.subtitle || "")}</small></span><span class="activity-end"><time>${when(item.date)}</time>${value}<i class="activity-status ${esc(item.statusTone || "info")}">${esc(item.status || "")}</i></span>${icon("chevron-right")}</button>`;
  }
  function groups(list) {
    const map = new Map();
    list.forEach((item) => {
      const label = dayLabel(item.date);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(item);
    });
    return [...map]
      .map(
        ([label, items]) =>
          `<section class="activity-day"><h2>${esc(label)}</h2><div>${items.map(card).join("")}</div></section>`,
      )
      .join("");
  }
  const activeFilterCount = () =>
    Object.entries(state.filters).reduce(
      (sum, [key, value]) =>
        sum +
        (key === "types"
          ? value.length
          : Number(value !== "" && value !== "todos")),
      0,
    );
  function render() {
    const list = filtered(),
      shown = list.slice(0, state.page * PAGE_SIZE),
      count = activeFilterCount();
    return `<section class="activity-page" data-activity-root><header class="activity-heading"><h1>Histórico</h1><p>Acompanhe vendas, ajustes e ações do sistema.</p></header><div class="activity-search-row"><label>${icon("search")}<input id="activity-search" value="${esc(state.query)}" placeholder="Buscar ação, cliente, produto..." autocomplete="off">${state.query ? `<button type="button" data-history-clear aria-label="Limpar busca">${icon("x")}</button>` : ""}</label><button type="button" data-history-filters>${icon("sliders-horizontal")}<span>Filtrar</span>${count ? `<b>${count}</b>` : ""}</button></div><div class="activity-chips">${[
      ["todos", "Todos"],
      ["sale", "Vendas"],
      ["payment", "Pagamentos"],
      ["balance", "Ajustes"],
      ["stock", "Estoque"],
      ["campaign", "Campanhas"],
      ["renewal", "Renovações"],
      ["order", "Pedidos"],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" class="${state.quick === key ? "active" : ""}" data-history-quick="${key}">${label}</button>`,
      )
      .join(
        "",
      )}</div><div class="activity-sort"><span>${list.length} ${list.length === 1 ? "ação" : "ações"}</span><label>Ordenar por <select id="activity-sort"><option value="recentes" ${state.sort === "recentes" ? "selected" : ""}>Mais recentes</option><option value="antigos" ${state.sort === "antigos" ? "selected" : ""}>Mais antigos</option></select></label></div><div class="activity-list">${shown.length ? groups(shown) : `<div class="activity-empty">${icon("history")}<h2>Nenhuma atividade encontrada</h2><p>Tente mudar a busca ou os filtros. O histórico só mostra registros reais já sincronizados.</p></div>`}</div>${shown.length < list.length ? `<button class="activity-load-more" type="button" data-history-more>Carregar mais ${Math.min(PAGE_SIZE, list.length - shown.length)} ações</button>` : ""}</section>`;
  }
  function rerender() {
    const root = $("[data-activity-root]");
    if (!root) return;
    root.outerHTML = render();
    bind();
    window.lucide?.createIcons();
  }
  function openFilters() {
    const root = $("#modal"),
      f = state.filters;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal activity-filter-modal" role="dialog" aria-modal="true"><header class="modal-head"><div><h3>Filtros avançados</h3><small>Combine período, tipo, status e valor.</small></div><button class="icon-btn mobile-icon-button" data-activity-close aria-label="Fechar">${icon("x")}</button></header><form id="activity-filter-form"><div class="modal-body"><fieldset><legend>Período</legend><div class="activity-filter-grid"><label>De<input type="date" name="start" value="${esc(f.start)}"></label><label>Até<input type="date" name="end" value="${esc(f.end)}"></label></div></fieldset><fieldset><legend>Tipos de atividade</legend><div class="activity-check-grid">${Object.entries(
      TYPE_META,
    )
      .filter(([key]) => key !== "system")
      .map(
        ([key, meta]) =>
          `<label class="mobile-check"><input type="checkbox" name="types" value="${key}" ${f.types.includes(key) ? "checked" : ""}><span>${icon(meta.icon)}</span>${esc(meta.label)}</label>`,
      )
      .join(
        "",
      )}</div></fieldset><fieldset><legend>Status</legend><select name="status"><option value="todos">Todos os status</option><option value="success" ${f.status === "success" ? "selected" : ""}>Concluídos</option><option value="warning" ${f.status === "warning" ? "selected" : ""}>Pendentes</option><option value="danger" ${f.status === "danger" ? "selected" : ""}>Cancelados ou encerrados</option><option value="info" ${f.status === "info" ? "selected" : ""}>Em andamento</option></select></fieldset><fieldset><legend>Faixa de valor</legend><div class="activity-filter-grid"><label>Mínimo<input type="number" inputmode="decimal" min="0" step="0.01" name="min" value="${esc(f.min)}" placeholder="R$ 0,00"></label><label>Máximo<input type="number" inputmode="decimal" min="0" step="0.01" name="max" value="${esc(f.max)}" placeholder="Sem limite"></label></div></fieldset></div><footer class="modal-foot"><button class="btn btn-light mobile-button" type="button" data-activity-clear>Limpar</button><button class="btn btn-primary mobile-button primary">Aplicar filtros</button></footer></form></section></div>`;
    $$("[data-activity-close]", root).forEach(
      (button) => (button.onclick = () => (root.innerHTML = "")),
    );
    $("[data-activity-clear]", root).onclick = () => {
      state.filters = {
        start: "",
        end: "",
        min: "",
        max: "",
        status: "todos",
        types: [],
      };
      root.innerHTML = "";
      state.page = 1;
      rerender();
    };
    $("#activity-filter-form", root).onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.filters = {
        start: data.get("start") || "",
        end: data.get("end") || "",
        min: data.get("min") || "",
        max: data.get("max") || "",
        status: data.get("status") || "todos",
        types: data.getAll("types"),
      };
      root.innerHTML = "";
      state.page = 1;
      rerender();
    };
    window.lucide?.createIcons();
  }
  function saleDetail(item, db) {
    const sale = db.vendas?.find(
      (entry) => String(entry.id) === String(item.resourceId),
    );
    if (!sale)
      return `<div class="activity-detail-empty">${icon("circle-alert")}<p>Esta venda foi cancelada ou não está mais disponível. O evento permanece no histórico.</p></div>`;
    const canCancel =
        window.Vendas?.ultima?.()?.id === sale.id &&
        window.Vendas?.podeDesfazer?.(),
      items = sale.itens || [];
    return `<section class="activity-sale-summary"><div><span>Cliente</span><b>${esc(sale.clienteNome || "Venda avulsa")}</b></div><div><span>Pagamento</span><b>${esc(sale.formaPagamento || sale.status || "Não informado")}</b></div><div><span>Data</span><b>${at(sale.data).toLocaleString("pt-BR")}</b></div></section><ul class="activity-sale-items">${items.map((entry) => `<li><span>${Number(entry.quantidade || 0)}× ${esc(entry.nome || entry.produtoNome || "Produto")}${entry.variantName ? ` <small>${esc(entry.variantName)}</small>` : ""}</span><b>${money(Number(entry.precoFinalUnitario ?? entry.precoUnitario ?? 0) * Number(entry.quantidade || 0))}</b></li>`).join("")}</ul>${sale.descontoTotal ? `<p class="activity-detail-line"><span>Desconto</span><b>− ${money(sale.descontoTotal)}</b></p>` : ""}<p class="activity-detail-total"><span>Total</span><b>${money(sale.valorFinal ?? sale.valorTotal)}</b></p>${sale.observacao ? `<p class="activity-detail-note"><b>Observação</b><br>${esc(sale.observacao)}</p>` : ""}<div class="activity-detail-actions"><button class="btn btn-primary mobile-button primary" type="button" data-history-receipt="${esc(sale.id)}">${icon("receipt-text")} Ver ou reenviar recibo</button><button class="btn btn-light mobile-button danger" type="button" data-history-cancel-sale="${esc(sale.id)}" ${canCancel ? "" : "disabled"}>${icon("undo-2")} Desfazer venda</button></div><small class="activity-cancel-note">${canCancel ? "Disponível por 5 minutos para a venda mais recente. Estoque, saldo, campanha e renovação serão revertidos pelo fluxo seguro." : "O cancelamento seguro só fica disponível para a venda mais recente durante 5 minutos."}</small>`;
  }
  function genericDetail(item) {
    const rows = Object.entries(item.raw || {})
      .filter(
        ([key, value]) =>
          ["string", "number"].includes(typeof value) &&
          !["id", "operationId", "businessId"].includes(key),
      )
      .slice(0, 10);
    return `<dl class="activity-detail-fields">${rows.map(([key, value]) => `<div><dt>${esc(key.replaceAll("_", " "))}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><button class="btn btn-primary mobile-button primary" type="button" data-history-resource="${esc(item.resource || "")}" data-history-resource-id="${esc(item.resourceId || "")}">${icon("arrow-up-right")} Abrir ${esc(TYPE_META[item.type]?.label?.toLowerCase() || "recurso")}</button>`;
  }
  function openDetail(id) {
    const item = events().find((entry) => entry.id === id);
    if (!item) return;
    const meta = TYPE_META[item.type] || TYPE_META.system,
      db = window.DB?.carregar?.() || {},
      root = $("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal activity-detail-modal" role="dialog" aria-modal="true"><header class="modal-head"><div class="activity-detail-title tone-${meta.tone}"><span>${icon(meta.icon)}</span><div><small>${esc(meta.label)} · ${at(item.date).toLocaleString("pt-BR")}</small><h3>${esc(item.title)}</h3></div></div><button class="icon-btn mobile-icon-button" data-activity-close aria-label="Fechar">${icon("x")}</button></header><div class="modal-body">${item.type === "sale" ? saleDetail(item, db) : genericDetail(item)}</div></section></div>`;
    root.querySelector("[data-activity-close]").onclick = () =>
      (root.innerHTML = "");
    root
      .querySelector("[data-history-receipt]")
      ?.addEventListener("click", (event) => {
        const sale = db.vendas?.find(
            (entry) => entry.id === event.currentTarget.dataset.historyReceipt,
          ),
          client = db.clientes?.find(
            (entry) => entry.id === (sale?.clienteId || sale?.clientId),
          );
        if (sale) window.Recibos?.mostrar?.(sale, client);
      });
    root
      .querySelector("[data-history-cancel-sale]")
      ?.addEventListener("click", (event) =>
        window.requestSafeSaleUndo?.(
          event.currentTarget.dataset.historyCancelSale,
        ),
      );
    root
      .querySelector("[data-history-resource]")
      ?.addEventListener("click", (event) => {
        const route = {
          client: "clientes",
          product: "produtos",
          campaign: "campanhas",
          order: "pedidos",
          renewal: "clientes",
        }[event.currentTarget.dataset.historyResource];
        root.innerHTML = "";
        if (route) window.Router?.ir?.(route);
      });
    window.lucide?.createIcons();
  }
  function bind() {
    const root = $("[data-activity-root]");
    if (!root) return;
    let timer;
    $("#activity-search", root)?.addEventListener("input", (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = event.target.value;
        state.page = 1;
        rerender();
      }, 180);
    });
    $("[data-history-clear]", root)?.addEventListener("click", () => {
      state.query = "";
      state.page = 1;
      rerender();
    });
    $("[data-history-filters]", root)?.addEventListener("click", openFilters);
    $$("[data-history-quick]", root).forEach(
      (button) =>
        (button.onclick = () => {
          state.quick = button.dataset.historyQuick;
          state.page = 1;
          rerender();
        }),
    );
    $("#activity-sort", root)?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.page = 1;
      rerender();
    });
    $("[data-history-more]", root)?.addEventListener("click", () => {
      state.page++;
      rerender();
    });
    $$("[data-activity-id]", root).forEach(
      (button) =>
        (button.onclick = () => openDetail(button.dataset.activityId)),
    );
  }
  window.ActivityCenter = { render, bind, events, state };
})();

// Fictitious data and stubbed services for tests/renovacoes.fixture.html (visual QA only).
// ?state=empty | offline | restricted | limit | many
(() => {
  const state = new URLSearchParams(location.search).get("state") || "default";
  const day = 86400000, base = new Date(); base.setHours(15, 0, 0, 0);
  const at = (offset) => new Date(base.getTime() + offset * day).toISOString();
  const names = ["Joana Conceição", "Marcos Lima", "Bia Souza", "Carlos Prado", "Ana Ribeiro", "Rafael Nunes", "Lúcia Martins", "Pedro Alves", "Sônia Reis", "Maria Aparecida de Souza Nascimento", "Tiago", "Helena Duarte"];
  const plans = [["Plano Mensal Pilates", 180, 1, "months"], ["Academia 3x semana", 99.9, 1, "months"], ["IPTV Família", 39.9, 30, "days"], ["Mensalidade Inglês", 250, 1, "months"], ["Corte + barba (pacote)", 120, 4, "weeks"]];
  const clients = names.map((nome, index) => ({ id: `c${index}`, nome, telefone: index === 10 ? "" : `(11) 9${String(8000 + index * 37).padStart(4, "0")}-${String(1000 + index * 91).slice(0, 4)}` }));
  const offsets = [0, 0, 2, 5, 7, 18, 26, -2, -9, 1, 3, -40];
  let subscriptions = state === "empty" ? [] : offsets.map((offset, index) => {
    const [label, price, value, unit] = plans[index % plans.length];
    return { id: `s${index}`, clientId: `c${index}`, productId: "p", label, status: index === 6 ? "paused" : "active", expiresAt: at(offset), contractedPrice: price, durationValue: value, durationUnit: unit,
      lastRenewedAt: [5, 3].includes(index) ? at(-3 - index) : null, updatedAt: at(-20) };
  });
  if (state === "many" || state === "limit") subscriptions = Array.from({ length: 120 }, (_, index) => ({ id: `m${index}`, clientId: `c${index % 12}`, productId: "p", label: plans[index % 5][0], status: "active", expiresAt: at(index % 20), contractedPrice: plans[index % 5][1], durationValue: 1, durationUnit: "months" }));
  const data = { customerSubscriptions: state === "offline" ? subscriptions : [], customerSubscriptionEvents: [], produtos: [{ id: "p", nome: "Plano" }], clientes: clients };
  const toast = (text) => window.Utils?.toast?.(text);
  Object.assign(window, {
    DB: { carregar: () => data, alterar: (mutator) => mutator(data), getBusinessId: () => "fixture" },
    Clientes: { obter: (id) => clients.find((item) => item.id === id) || null },
    Produtos: { obter: (id) => data.produtos.find((item) => item.id === id) || null },
    ProductVariations: { get: () => null, displayName: () => "" },
    TeamAccess: { canRoute: () => true, has: () => true },
    Mensagens: { canSend: () => true },
    MobileMessages: { openCenter: (options) => toast(`Central: ${options.type} · ${options.clientIds.length} cliente(s)`) },
    Router: { ir: (route) => toast(`Ir para ${route}`) },
    OperationalReadPolicy: { restricted: () => state === "restricted" },
    SyncFirebase: state === "offline" ? null : {
      async queryCustomerSubscriptions(options) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const rows = subscriptions.filter((item) => item.status === options.status &&
            (!options.from || new Date(item.expiresAt) >= new Date(options.from)) && (!options.to || new Date(item.expiresAt) <= new Date(options.to)))
          .sort((a, b) => (new Date(a.expiresAt) - new Date(b.expiresAt)) * (options.direction === "desc" ? -1 : 1));
        const start = Number(options.cursor || 0), max = state === "limit" ? 5 : options.limit, items = rows.slice(start, start + max);
        data.customerSubscriptions = [...new Map([...data.customerSubscriptions, ...items].map((item) => [item.id, item])).values()];
        return { items, cursor: String(start + items.length), hasMore: start + items.length < rows.length };
      },
    },
  });
  Object.assign(window, {
    Checkout: { prepareRenewal: (id) => (toast(`Checkout.prepareRenewal(${id})`), true) },
    CRMClienteUI: { open: (id) => toast(`Perfil ${id}`), renewalWhatsApp: (item) => toast(`WhatsApp da vigência ${item.id}`) },
  });
})();
// ?select=1 selects the current filter after load; ?filter=<key> opens another indicator (screenshots).
addEventListener("load", () => setTimeout(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("filter")) document.querySelector(`[data-renewals-filter="${params.get("filter")}"]`)?.click();
  if (params.get("select")) document.querySelector('[data-renewals-select-all="on"]')?.click();
}, 1800));

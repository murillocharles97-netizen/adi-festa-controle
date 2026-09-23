(function () {
  "use strict";

  const PERMISSIONS = Object.freeze([
    "sales.create", "sales.cancel", "sales.viewAll",
    "customers.view", "customers.edit", "customers.receiveDebt", "customers.adjustBalance",
    "products.view", "products.edit", "inventory.view", "inventory.adjust",
    "financial.view", "reports.view", "profit.view", "cost.view",
    "team.view", "team.manage", "settings.manage", "billing.manage", "spaces.manage",
  ]);
  const PRESETS = Object.freeze({
    owner: Object.freeze(Object.fromEntries(PERMISSIONS.map((key) => [key, true]))),
    manager: Object.freeze({
      "sales.create": true, "sales.cancel": true, "sales.viewAll": true,
      "customers.view": true, "customers.edit": true, "customers.receiveDebt": true,
      "customers.adjustBalance": true, "products.view": true, "products.edit": true,
      "inventory.view": true, "inventory.adjust": true, "reports.view": true, "team.view": true,
    }),
    seller: Object.freeze({
      "sales.create": true, "customers.view": true, "products.view": true, "inventory.view": true,
    }),
    stock: Object.freeze({ "products.view": true, "inventory.view": true, "inventory.adjust": true }),
  });
  const ROLE_LABELS = Object.freeze({ owner: "Proprietário", manager: "Gerente", seller: "Vendedor / Caixa", stock: "Estoque" });
  const ROUTE_PERMISSIONS = Object.freeze({
    vender: "sales.create", clientes: "customers.view", fiados: "customers.receiveDebt", crm: "reports.view",
    cobrancas: "customers.receiveDebt", produtos: "products.view", campanhas: "reports.view",
    financeiro: "financial.view", catalogo: "products.edit", pedidos: "sales.viewAll",
    historico: "sales.create", relatorios: "reports.view", equipe: "team.view", configuracoes: "settings.manage",
    planos: "billing.manage", cupons: "platform.admin",
  });
  const normalizeRole = (role) => ({ admin: "manager", cashier: "seller", viewer: "seller" })[String(role || "").toLowerCase()] || String(role || "seller").toLowerCase();
  function permissionsFor(role, input = {}) {
    const normalized = normalizeRole(role), preset = PRESETS[normalized] || PRESETS.seller,
      source = input && typeof input === "object" && !Array.isArray(input)
        ? input
        : Object.fromEntries((Array.isArray(input) ? input : []).map((key) => [key, true]));
    return Object.fromEntries(PERMISSIONS.map((key) => [key, Boolean(source[key] ?? preset[key])]));
  }
  const current = () => window.BusinessContext?.get?.() || {};
  function has(permission) {
    if (permission === "platform.admin") return current().role === "platform_admin";
    return current().role === "owner" || current().permissions?.includes?.("*") || current().permissions?.includes?.(permission);
  }
  const canRoute = (route) => !ROUTE_PERMISSIONS[route] || has(ROUTE_PERMISSIONS[route]);
  function deniedMarkup() {
    return `<section class="access-denied" role="alert"><i data-lucide="shield-x"></i><h2>Você não tem acesso a esta área.</h2><p>Peça ao proprietário para revisar seu cargo e suas permissões.</p><button class="btn btn-primary" type="button" data-go="inicio">Voltar ao início</button></section>`;
  }
  function syncNavigation() {
    document.querySelectorAll("[data-route],[data-mobile-route]").forEach((node) => {
      const route = node.dataset.route || node.dataset.mobileRoute || "", allowed = canRoute(route);
      node.hidden = !allowed;
      node.setAttribute("aria-hidden", String(!allowed));
      if (!allowed) node.setAttribute("tabindex", "-1"); else node.removeAttribute("tabindex");
    });
    document.querySelectorAll("[data-permission]").forEach((node) => {
      const allowed = has(node.dataset.permission);
      node.hidden = !allowed;
      node.setAttribute("aria-hidden", String(!allowed));
    });
    document.documentElement.dataset.teamRole = current().role || "unknown";
    document.documentElement.dataset.canViewCost = String(has("cost.view"));
    document.documentElement.dataset.canViewProfit = String(has("profit.view"));
    document.documentElement.dataset.canEditProducts = String(has("products.edit"));
    document.documentElement.dataset.canAdjustInventory = String(has("inventory.adjust"));
    document.documentElement.dataset.canEditCustomers = String(has("customers.edit"));
    document.documentElement.dataset.canAdjustBalance = String(has("customers.adjustBalance"));
  }
  function actor() {
    const session = window.FirebaseSession || {}, context = current();
    return { actorUid: session.user?.uid || context.userProfile?.uid || null, actorNameSnapshot: session.profile?.name || context.member?.name || null, actorRoleSnapshot: context.role || session.profile?.role || null };
  }
  function sanitizePrivateCache(data) {
    if (!data || typeof data !== "object") return data;
    if (!has("cost.view")) {
      (data.produtos || []).forEach((item) => { delete item.custo; delete item.cost; });
      (data.variacoesProdutos || []).forEach((item) => { delete item.cost; delete item.custo; });
      (data.movimentacoesEstoque || []).forEach((item) => { delete item.custoUnitario; delete item.costUnit; });
      (data.vendas || []).forEach((sale) => {
        delete sale.custoTotal;
        (sale.itens || []).forEach((item) => {
          delete item.custoUnitario; delete item.custoTotal; delete item.costSnapshot;
        });
      });
    }
    if (!has("profit.view")) {
      (data.vendas || []).forEach((sale) => {
        delete sale.lucro;
        (sale.itens || []).forEach((item) => { delete item.lucro; });
      });
    }
    if (!has("financial.view")) {
      for (const key of ["financialEntries", "financialAccounts", "creditCards", "paymentReceivables"])
        delete data[key];
    }
    return data;
  }
  window.TeamAccess = Object.freeze({
    PERMISSIONS, PRESETS, ROLE_LABELS, ROUTE_PERMISSIONS, normalizeRole,
    permissionsFor, has, canRoute, deniedMarkup, syncNavigation, sanitizePrivateCache, actor,
  });
  addEventListener("business-context-changed", () => queueMicrotask(syncNavigation));
  addEventListener("firebase-auth-ready", () => queueMicrotask(syncNavigation));
})();

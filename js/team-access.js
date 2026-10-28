(function () {
  "use strict";

  const PERMISSIONS = Object.freeze([
    "sales.create", "sales.cancel", "sales.viewAll",
    "customers.view", "customers.create", "customers.edit", "customers.archive", "customers.receiveDebt", "customers.adjustBalance",
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
  function permissionsFor(role, input) {
    return window.VeconiPermissionPolicy.effective({role:normalizeRole(role),permissions:input===undefined?PRESETS[normalizeRole(role)]||{}:input});
  }
  const current = () => window.BusinessContext?.get?.() || {};
  function has(permission) {
    if (permission === "platform.admin") return current().role === "platform_admin";
    const c = current();
    if (c.loading || c.error || c.userProfile?.active === false || c.member?.status && c.member.status !== 'active') return false;
    // Keep persisted legacy permission arrays/signatures unchanged. Split
    // aliases are derived only at authorization time, not in the cache key.
    if(c.role!=='owner'&&c.member&&window.VeconiPermissionPolicy)return window.VeconiPermissionPolicy.has(c.member,permission);
    return c.role === "owner" || c.permissions?.includes?.("*") || c.permissions?.includes?.(permission);
  }
  const assert = permission => { if (!has(permission)) throw window.VeconiPermissionPolicy.denied(permission); };
  const captureSession = () => {
    const c=current();
    return JSON.stringify([c.businessId,c.userProfile?.uid,window.FirebaseSession?.user?.uid,c.role,c.member?.status,c.member?.permissionsVersion,c.member?.permissions,c.permissions,c.spaceAccess,c.allowedSpaceIds,c.access?.canMutate,window.DB?.getWorkspaceGeneration?.()]);
  };
  function assertSession(token) {
    if(token!==captureSession())throw Object.assign(Error('Seu acesso ou sessão mudou. Os dados desta operação não foram gravados. Confira as permissões e tente novamente.'),{code:'permission-session-retired'});
    const c=current();
    if(c.loading||c.error||c.access?.canMutate===false||c.userProfile?.active===false||c.member?.status&&c.member.status!=='active')throw window.VeconiPermissionPolicy.denied('active-session');
  }
  function assertCustomerProtocol() {
    // Legacy editors use an already-supported path; new create-only grants need
    // a server handshake for THIS principal/workspace, also before offline work.
    if(!has('customers.edit')&&window.SyncFirebase?.getPermissionProtocol?.().permissionsVersion!==2)
      throw Object.assign(Error('Conecte-se e confirme a sincronização para usar o cadastro de clientes com este acesso. O formulário foi preservado.'),{code:'permission-protocol-unconfirmed'});
  }
  function assertWriteScope(write,writes=[]) {
    const c=current(),d=write.data||{},before=write.before||{};
    if([d.businessId,before.businessId].some(id=>id&&id!==c.businessId)||d.workspaceGeneration!==undefined&&d.workspaceGeneration!==(window.DB?.getWorkspaceGeneration?.()??0))throw window.VeconiPermissionPolicy.denied('business-space');
    const sid=d.spaceId||before.spaceId;
    if(sid&&window.BusinessContext?.canAccessSpace?.(sid)===false)throw window.VeconiPermissionPolicy.denied('business-space');
    if(c.role==='owner'||c.spaceAccess==='all')return;
    if(['products','productVariants'].includes(write.entityType)){
      const entity={...before,...d},parentId=entity.parentProductId;
      const parent=write.entityType==='products'?entity:
        (window.DB?.carregar?.().produtos||[]).find(p=>p.id===parentId)||writes.find(w=>w.entityType==='products'&&w.entityId===parentId)?.data;
      const ids=parent?.allowedSpaceIds||[],allowed=c.allowedSpaceIds||[];
      if(!parent||!allowed.length||parent.spaceAccessMode!=='all_spaces'&&!ids.some(id=>allowed.includes(id)))throw window.VeconiPermissionPolicy.denied('business-space');
      const assigning=write.entityType==='products'&&(write.operation==='create'||['spaceAccessMode','allowedSpaceIds','defaultSpaceId'].some(key=>Object.hasOwn(d,key)&&JSON.stringify(d[key])!==JSON.stringify(before[key])));
      if(assigning&&(parent.spaceAccessMode==='all_spaces'||!ids.length||ids.some(id=>!allowed.includes(id))))throw window.VeconiPermissionPolicy.denied('spaces.manage');
    }
  }
  const canRoute = (route) => !ROUTE_PERMISSIONS[route] || has(ROUTE_PERMISSIONS[route]);
  const ACTION_PERMISSIONS = Object.freeze({
    '#new-client,#empty-new-client,#quick-new-client,[data-primary-action="new-client"]':'customers.create',
    '[data-edit-client],[data-mobile-edit],[data-client-action="edit"],[data-client-action="contact"],[data-client-action="promise"],[data-client-action="charge"]':'customers.edit',
    '[data-delete-client],[data-mobile-delete],[data-client-action="delete"]':'customers.archive',
    '[data-receive-client]':'customers.receiveDebt', '[data-adjust-client]':'customers.adjustBalance',
    '#import-csv':'customers.create customers.edit',
    '[data-product-new],[data-product-edit],[data-product-delete]':'products.edit',
    '[data-product-entry],[data-product-adjust],[data-stock-entry],[data-stock-adjust]':'inventory.adjust',
    '[data-team-add],[data-team-edit]':'team.manage'
  });
  function actionPermission(node) {
    const explicit=node.closest?.('[data-permission-action]')?.dataset.permissionAction;
    if(explicit)return explicit;
    return Object.entries(ACTION_PERMISSIONS).find(([selector])=>node.closest?.(selector))?.[1];
  }
  function protectActions() {
    if(!window.document?.documentElement)return;
    for(const [selector,key] of Object.entries(ACTION_PERMISSIONS))document.querySelectorAll(selector).forEach(node=>{
      const allowed=key.split(' ').every(has);node.setAttribute('aria-disabled',String(!allowed));
      if(!allowed){node.setAttribute('title',window.VeconiPermissionPolicy.MESSAGE);node.setAttribute('aria-description',window.VeconiPermissionPolicy.MESSAGE);}
      else if(node.getAttribute('title')===window.VeconiPermissionPolicy.MESSAGE){node.removeAttribute('title');node.removeAttribute('aria-description');}
    });
  }
  // Reading the operational ledger of an authorized space is not permission
  // to manage other sales, financial projections, costs or staff. viewAll is
  // retained for administrative screens; the store dashboard is not personal.
  const canReadOperationalSales = () => has('sales.create') || has('sales.viewAll');
  const operationalReadScopeKey = () => {
    const c=current();
    return JSON.stringify(['store-sales-v2',c.businessId||'',c.userProfile?.uid||window.FirebaseSession?.user?.uid||'',c.role||'',c.permissionSignature||[...(c.permissions||[])].sort().join('|'),c.spaceAccess||'selected',[...(c.allowedSpaceIds||[])].sort()]);
  };
  function deniedMarkup() {
    return `<section class="access-denied" role="alert"><i data-lucide="shield-x"></i><h2>Você não tem acesso a esta área.</h2><p>Peça ao proprietário para revisar seu cargo e suas permissões.</p><button class="btn btn-primary" type="button" data-go="inicio">Voltar ao início</button></section>`;
  }
  function syncNavigation() {
    if(!window.document?.documentElement)return;
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
    document.documentElement.dataset.canCreateCustomers = String(has("customers.create"));
    document.documentElement.dataset.canArchiveCustomers = String(has("customers.archive"));
    document.documentElement.dataset.canAdjustBalance = String(has("customers.adjustBalance"));
    if(window.VeconiPermissionPolicy)protectActions();
  }
  function actor() {
    const session = window.FirebaseSession || {}, context = current();
    return { actorUid: session.user?.uid || context.userProfile?.uid || null, actorNameSnapshot: session.profile?.name || context.member?.name || null, actorRoleSnapshot: context.role || session.profile?.role || null };
  }
  function sanitizePrivateCache(data) {
    if (!data || typeof data !== "object") return data;
    if(current().role!=='owner'&&Array.isArray(data.catalogOrders))data.catalogOrders=data.catalogOrders.filter(o=>has('sales.viewAll')&&o.spaceId&&window.BusinessContext?.canAccessSpace?.(o.spaceId));
    if (!has("cost.view")) {
      delete data.productFinancials; delete data.variantFinancials; delete data.stockMovementFinancials;
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
    if(!has('cost.view')&&!has('profit.view'))delete data.saleFinancials;
    if (!has("financial.view")) {
      for (const key of ["financialEntries", "financialAccounts", "creditCards", "paymentReceivables"])
        delete data[key];
    }
    return data;
  }
  window.TeamAccess = Object.freeze({
    PERMISSIONS, PRESETS, ROLE_LABELS, ROUTE_PERMISSIONS, normalizeRole,
    permissionsFor, has, assert, captureSession, assertSession, assertCustomerProtocol, assertWriteScope, ACTION_PERMISSIONS, protectActions, canRoute, canReadOperationalSales, operationalReadScopeKey, deniedMarkup, syncNavigation, sanitizePrivateCache, actor,
  });
  addEventListener("business-context-changed", () => queueMicrotask(syncNavigation));
  addEventListener("firebase-auth-ready", () => queueMicrotask(syncNavigation));
  document.addEventListener?.('click',event=>{
    const permission=actionPermission(event.target);
    if(permission&&!permission.split(' ').every(has)){
      event.preventDefault();event.stopImmediatePropagation();
      window.Utils?.toast?.(window.VeconiPermissionPolicy.MESSAGE,true);
    }
  },true);
  if(typeof MutationObserver==='function')new MutationObserver(()=>protectActions()).observe(document.documentElement,{childList:true,subtree:true});
})();

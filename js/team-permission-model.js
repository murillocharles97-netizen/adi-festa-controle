/* Permission editor: explicit grants only; this module never changes session access. */
(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('../functions/src/shared/permission-policy') : root.VeconiPermissionPolicy);
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.TeamPermissionModel = model;
})(typeof window !== "undefined" ? window : globalThis, function (Policy) {
  "use strict";
  const KEYS = Object.freeze([
    "sales.create", "sales.cancel", "sales.viewAll", "customers.view", "customers.create", "customers.edit", "customers.archive",
    "customers.receiveDebt", "customers.adjustBalance", "products.view", "products.edit",
    "inventory.view", "inventory.adjust", "financial.view", "reports.view", "profit.view",
    "performance.daily", "performance.history", "cost.view", "team.view", "team.manage", "settings.manage", "billing.manage", "spaces.manage"
  ]);
  const DEPENDENCIES = Object.freeze({
    "performance.history": ["performance.daily"], "sales.cancel": ["sales.create"], "customers.edit": ["customers.view"],
    "customers.create": ["customers.view"], "customers.archive": ["customers.view"],
    "customers.receiveDebt": ["customers.view"], "customers.adjustBalance": ["customers.view"],
    "products.edit": ["products.view"], "inventory.view": ["products.view"],
    "inventory.adjust": ["products.view", "inventory.view"], "team.manage": ["team.view"]
  });
  function explicit(member = {}) {
    const policy = Policy || globalThis.VeconiPermissionPolicy;
    if (!policy) throw Error("A política de permissões ainda não foi carregada.");
    return policy.effective(member);
  }
  function snapshot(member) {
    return JSON.parse(JSON.stringify(Object.fromEntries(["role", "status", "spaceAccess", "allowedSpaceIds", "permissions", "permissionsVersion"]
      .filter(key => Object.prototype.hasOwnProperty.call(member, key)).map(key => [key, member[key]]))));
  }
  function preset(name) {
    const enabled = name === "manager" ? ["sales.create", "sales.cancel", "sales.viewAll", "performance.daily", "performance.history", "customers.view",
      "customers.create", "customers.edit", "products.view", "products.edit", "inventory.view", "inventory.adjust", "reports.view"] :
      ["sales.create", "performance.daily", "customers.view", "products.view", "inventory.view"];
    return Object.fromEntries(KEYS.map(key => [key, enabled.includes(key)]));
  }
  function issues(values) {
    return Object.entries(DEPENDENCIES).filter(([key, parents]) => values[key] && parents.some(parent => !values[parent]))
      .map(([key, parents]) => ({ key, missing: parents.filter(parent => !values[parent]) }));
  }
  function change(values, key, enabled) {
    if (!KEYS.includes(key)) throw new Error("Permissão desconhecida.");
    const next = { ...values }, removed = [];
    if (enabled && (DEPENDENCIES[key] || []).some(parent => !next[parent])) {
      return { values: next, blocked: true, missing: DEPENDENCIES[key].filter(parent => !next[parent]), removed };
    }
    next[key] = enabled === true;
    if (!enabled) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const [child, parents] of Object.entries(DEPENDENCIES)) {
          if (next[child] && parents.some(parent => parent === key || removed.includes(parent))) {
            next[child] = false; removed.push(child); changed = true;
          }
        }
      }
    }
    return { values: next, blocked: false, removed };
  }
  function difference(before, after) {
    return { added: KEYS.filter(key => !before[key] && after[key]), removed: KEYS.filter(key => before[key] && !after[key]) };
  }
  function spaceOptions(available = [], originalIds = [], businessId) {
    const options = available.filter(space => [space.businessId, space.linkedBusinessId]
      .every(id => !id || id === businessId)).map(space => ({ id: space.id, name: space.name }));
    for (const id of originalIds) if (!options.some(space => space.id === id)) options.push({ id, name: `Espaço indisponível (${id}) — vínculo preservado` });
    return options;
  }
  function serialize(original, draft) {
    if (original.role === "owner") throw new Error("O acesso do proprietário é protegido.");
    if (!["seller", "manager", "stock"].includes(draft.role)) throw new Error("Cargo inválido.");
    if (issues(draft.permissions).length) throw new Error("Revise as dependências de permissões antes de salvar.");
    const ids = [...new Set(draft.allowedSpaceIds || [])].sort();
    if (draft.spaceAccess !== "all" && (draft.spaceAccess !== "selected" || !ids.length)) throw new Error("Selecione ao menos um espaço.");
    return { role: draft.role, spaceAccess: draft.spaceAccess, allowedSpaceIds: draft.spaceAccess === "all" ? [] : ids,
      permissionsVersion: 3, permissions: Object.fromEntries(KEYS.map(key => [key, draft.permissions[key] === true])), expectedAccess: snapshot(original) };
  }
  return Object.freeze({ KEYS, DEPENDENCIES, explicit, snapshot, preset, issues, change, difference, spaceOptions, serialize });
});

/* Permission editor: explicit grants only; this module never changes session access. */
(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.TeamPermissionModel = model;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const KEYS = Object.freeze([
    "sales.create", "sales.cancel", "sales.viewAll", "customers.view", "customers.create", "customers.edit", "customers.archive",
    "customers.receiveDebt", "customers.adjustBalance", "products.view", "products.edit",
    "inventory.view", "inventory.adjust", "financial.view", "reports.view", "profit.view",
    "cost.view", "team.view", "team.manage", "settings.manage", "billing.manage", "spaces.manage"
  ]);
  const DEPENDENCIES = Object.freeze({
    "sales.cancel": ["sales.create"], "customers.edit": ["customers.view"],
    "customers.create": ["customers.view"], "customers.archive": ["customers.view"],
    "customers.receiveDebt": ["customers.view"], "customers.adjustBalance": ["customers.view"],
    "products.edit": ["products.view"], "inventory.view": ["products.view"],
    "inventory.adjust": ["products.view", "inventory.view"], "team.manage": ["team.view"]
  });
  function explicit(member = {}) {
    const source = !Array.isArray(member.permissions) && member.permissions || {};
    return Object.fromEntries(KEYS.map(key => [key, member.role === "owner" ||
      (['customers.create','customers.archive'].includes(key) && Number(member.permissionsVersion || 1) < 2 &&
       !(Array.isArray(source) ? source.includes(key) : Object.hasOwn(source, key))
        ? (Array.isArray(source) ? source.includes('customers.edit') : source['customers.edit'] === true)
        : (Array.isArray(source) ? source.includes(key) : source[key] === true))]));
  }
  function snapshot(member) {
    return JSON.parse(JSON.stringify(Object.fromEntries(["role", "status", "spaceAccess", "allowedSpaceIds", "permissions", "permissionsVersion"]
      .filter(key => Object.prototype.hasOwnProperty.call(member, key)).map(key => [key, member[key]]))));
  }
  function preset(name) {
    const enabled = name === "manager" ? ["sales.create", "sales.cancel", "sales.viewAll", "customers.view",
      "customers.create", "customers.edit", "products.view", "products.edit", "inventory.view", "inventory.adjust", "reports.view"] :
      ["sales.create", "customers.view", "products.view", "inventory.view"];
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
      permissionsVersion: 2, permissions: Object.fromEntries(KEYS.map(key => [key, draft.permissions[key] === true])), expectedAccess: snapshot(original) };
  }
  return Object.freeze({ KEYS, DEPENDENCIES, explicit, snapshot, preset, issues, change, difference, spaceOptions, serialize });
});

/* Public, pure authorization vocabulary. No credentials or business data. */
(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.VeconiPermissionPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 2;
  const LEGACY_KEYS = Object.freeze(['sales.create','sales.cancel','sales.viewAll',
    'customers.view','customers.edit','customers.receiveDebt','customers.adjustBalance',
    'products.view','products.edit','inventory.view','inventory.adjust','financial.view',
    'reports.view','profit.view','cost.view','team.view','team.manage','settings.manage','billing.manage','spaces.manage']);
  const KEYS = Object.freeze([...LEGACY_KEYS, 'customers.create', 'customers.archive']);
  const MESSAGE = 'Você não tem permissão para realizar esta ação. Solicite ao gestor que habilite esta função em Equipe → Permissões.';
  // V202-V209 server grants were boolean map entries, never array indexes.
  // Keep unsupported legacy arrays as evidence, not newly-authorized grants.
  const source = member => !Array.isArray(member?.permissions) && member?.permissions || {};
  function has(member, key) {
    if (!KEYS.includes(key)) return false;
    if (member?.role === 'owner') return true;
    const grants = source(member);
    // Only split duties ALREADY explicitly authorized by legacy customers.edit.
    // Explicit false always wins, and V2 has no inheritance or role defaults.
    if (['customers.create','customers.archive'].includes(key) && !Object.hasOwn(grants, key) && Number(member?.permissionsVersion || 1) < VERSION)
      return Object.hasOwn(grants,'customers.edit') && grants['customers.edit'] === true;
    return Object.hasOwn(grants,key) && grants[key] === true;
  }
  const effective = member => Object.fromEntries(KEYS.map(key => [key, has(member, key)]));
  const customerPermission = write => write.operation === 'create' ? 'customers.create'
    : ['active','ativo','deletedAt'].some(key => Object.hasOwn(write.data || {}, key) &&
      JSON.stringify(write.data[key]) !== JSON.stringify(write.before?.[key])) ? 'customers.archive' : 'customers.edit';
  function denied(permission) { return Object.assign(new Error(MESSAGE), {code:'permission-required', permission}); }
  return Object.freeze({VERSION, LEGACY_KEYS, KEYS, MESSAGE, has, effective, customerPermission, denied});
});

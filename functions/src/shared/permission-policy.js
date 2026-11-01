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
  const KEYS = Object.freeze([...LEGACY_KEYS, 'customers.create', 'customers.archive', 'performance.daily', 'performance.history']);
  const MESSAGE = 'Você não tem permissão para realizar esta ação. Solicite ao gestor que habilite esta função em Equipe → Permissões.';
  // V202-V209 server grants were boolean map entries, never array indexes.
  // Keep unsupported legacy arrays as evidence, not newly-authorized grants.
  const source = member => !Array.isArray(member?.permissions) && member?.permissions || {};
  function has(member, key) {
    if (!KEYS.includes(key)) return false;
    if (member?.role === 'owner') return true;
    const grants = source(member);
    if(key==='performance.history' && Number(member?.permissionsVersion||1)>=3 && grants['performance.daily']!==true)return false;
    // V224 preserves existing authorized views until the manager explicitly saves V3.
    // An explicit false always wins; V3 never inherits from sales.create.
    if (['performance.daily','performance.history'].includes(key) && !Object.hasOwn(grants,key) && Number(member?.permissionsVersion || 1) < 3)
      return grants['sales.create'] === true || grants['sales.viewAll'] === true || grants['reports.view'] === true;
    // Only split duties ALREADY explicitly authorized by legacy customers.edit.
    // Explicit false always wins, and V2 has no inheritance or role defaults.
    if (['customers.create','customers.archive'].includes(key) && !Object.hasOwn(grants, key) && Number(member?.permissionsVersion || 1) < VERSION)
      return Object.hasOwn(grants,'customers.edit') && grants['customers.edit'] === true;
    return Object.hasOwn(grants,key) && grants[key] === true;
  }
  const timestamp = value => value?.toDate ? value.toDate() : value?.seconds !== undefined ? new Date(value.seconds * 1000) : new Date(value);
  const dayKey = (value,zone='America/Sao_Paulo') => {
    const date=timestamp(value); if(!Number.isFinite(date.getTime())) return null;
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  function dayWindow(at=new Date(),zone='America/Sao_Paulo') {
    const key=dayKey(at,zone),next=new Date(Date.parse(key+'T12:00:00Z')+86400000).toISOString().slice(0,10);
    const midnight=k=>{const target=Date.parse(k+'T00:00:00Z');let v=target;
      for(let i=0;i<5;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v)).map(x=>[x.type,x.value]));v+=target-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);}
      return new Date(v).toISOString();};
    return {day:key,zone,from:midnight(key),to:midnight(next)};
  }
  const visiblePerformanceRecord = (member,record,at=new Date(),zone='America/Sao_Paulo',field='data') => has(member,'performance.history') || has(member,'performance.daily') && dayKey(record?.[field]||record?.createdAt,zone)===dayKey(at,zone);
  const effective = member => Object.fromEntries(KEYS.map(key => [key, has(member, key)]));
  const customerPermission = write => write.operation === 'create' ? 'customers.create'
    : ['active','ativo','deletedAt'].some(key => Object.hasOwn(write.data || {}, key) &&
      JSON.stringify(write.data[key]) !== JSON.stringify(write.before?.[key])) ? 'customers.archive' : 'customers.edit';
  function denied(permission) { return Object.assign(new Error(MESSAGE), {code:'permission-required', permission}); }
  return Object.freeze({VERSION, LEGACY_KEYS, KEYS, MESSAGE, has, effective, customerPermission, denied, dayKey, dayWindow, visiblePerformanceRecord});
});

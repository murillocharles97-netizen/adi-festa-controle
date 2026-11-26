// Fase 4 — saldo por cliente e Espaço publicado pelo servidor (customerSpaceAccounts).
// Fonte de EXIBIÇÃO: cards, totais, Cobranças e Dashboard leem daqui em vez de pedir a
// conta de cada cliente ao servidor. Recebimentos e cobranças continuam com a
// revalidação no servidor. Um leitor (js/firebase/customer-accounts-reader.js) alimenta
// esta loja; sem leitor, nada muda nas telas.
window.CustomerSpaceAccounts = (() => {
  'use strict';
  const NONE = 'sem-espaco';
  let scope = null, live = false, rows = new Map(); // clientId -> Map(spaceKey -> row)
  const keyOf = s => JSON.stringify(['veconi:space-accounts', s.uid, s.businessId, s.generation, s.grants, s.complete, s.spaces]);
  const allowed = row => row.businessId === scope.businessId && (row.workspaceGeneration ?? 0) === scope.generation &&
    Number.isSafeInteger(row.debtCents) && (scope.complete || scope.spaces.includes(row.spaceId));
  const persist = () => {
    if (!scope) return;
    try { localStorage.setItem(keyOf(scope), JSON.stringify([...rows.values()].flatMap(m => [...m.values()]))); } catch { /* optional offline copy */ }
  };
  const notify = clientIds => { try { window.dispatchEvent(new CustomEvent('customer-accounts-updated', {detail: {clientIds: [...clientIds]}})); } catch { /* no window */ } };
  function put(row) {
    if (!allowed(row)) return null;
    const clientId = String(row.clientId || ''), space = row.spaceId || NONE;
    if (!clientId) return null;
    const map = rows.get(clientId) || new Map(); map.set(space, row); rows.set(clientId, map);
    return clientId;
  }
  // A new session, company, generation or Space access starts empty, then the offline copy
  // of this same scope (marked as not live) until the server snapshot arrives.
  function reset(next) {
    const changed = new Set(rows.keys());
    scope = next ? {uid: next.uid, businessId: next.businessId, generation: next.generation ?? 0,
      complete: Boolean(next.complete), grants: next.grants || '', spaces: [...new Set((next.spaces || []).filter(Boolean))].sort()} : null;
    rows = new Map(); live = false;
    if (scope) try { for (const row of JSON.parse(localStorage.getItem(keyOf(scope)) || '[]')) { const id = put(row); if (id) changed.add(id); } } catch { /* corrupt copy is ignored */ }
    notify(changed);
  }
  function apply(businessId, changes, {fromServer = true, replaceSpaces} = {}) {
    if (!scope || businessId !== scope.businessId) return;
    const changed = new Set();
    if (replaceSpaces !== undefined) {
      const present = new Set(changes.map(change => change.id));
      for (const [clientId, map] of rows) {
        for (const [space, row] of map) {
          if ((replaceSpaces === null || replaceSpaces.includes(space)) && !present.has(row.__id)) {
            map.delete(space); changed.add(clientId);
          }
        }
        if (!map.size) rows.delete(clientId);
      }
    }
    for (const change of changes) {
      const data = change.data || {}, clientId = String(data.clientId || String(change.id).split('__')[0]);
      if (change.type === 'removed') {
        const map = rows.get(clientId); if (!map) continue;
        for (const [space, row] of map) if (row.__id === change.id) map.delete(space);
        if (!map.size) rows.delete(clientId); changed.add(clientId); continue;
      }
      const id = put({...data, __id: change.id}); if (id) changed.add(id);
    }
    const readinessChanged = live !== fromServer;
    live = fromServer;
    if (live) persist();
    if (changed.size || readinessChanged) notify(changed);
  }
  // Balance of one customer by Space, in cents (> 0 owes, < 0 credit). `complete` means this
  // viewer sees every Space and the part without Space (the owner), so the sum can be checked
  // against the registered balance.
  function forClient(clientId) {
    if (!scope) return null;
    const map = rows.get(String(clientId)); if (!map?.size) return null;
    const spaces = {}; let unattributedCents = 0;
    for (const [space, row] of map) { if (space === NONE) unattributedCents += row.debtCents; else if (row.debtCents) spaces[space] = row.debtCents; }
    const totalCents = Object.values(spaces).reduce((n, v) => n + v, 0) + unattributedCents;
    return {spaces, unattributedCents, totalCents, complete: scope.complete, live};
  }
  return {reset, apply, forClient, ready: () => Boolean(scope) && live, scope: () => scope ? {...scope} : null, NONE};
})();

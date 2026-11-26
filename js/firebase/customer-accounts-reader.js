// Fase 4 — mantém CustomerSpaceAccounts atualizado com o saldo por cliente e Espaço que o
// servidor publica. O proprietário escuta a empresa inteira (inclusive a parte sem Espaço);
// os demais, os Espaços que acessam, em grupos de até 30, como as Rules exigem.
// Somente leitura; independe da fila de sincronização.
import {db} from './firebase-config.js';
import {collection, onSnapshot, query, where} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let current = '', stops = [];
function stop() { for (const unsubscribe of stops.splice(0)) try { unsubscribe(); } catch { /* already closed */ } current = ''; }
function allowed() {
  const has = window.TeamAccess?.has;
  return typeof has === 'function' && (has('financial.view') || has('customers.receiveDebt') || has('customers.adjustBalance'));
}
function start() {
  const store = window.CustomerSpaceAccounts, context = window.BusinessContext?.get?.(), uid = window.FirebaseSession?.user?.uid;
  const businessId = context?.businessId, generation = window.DB?.getWorkspaceGeneration?.() ?? 0;
  if (!store || !uid || !businessId || context.loading || !allowed()) { stop(); store?.reset(null); return; }
  const owner = context.role === 'owner';
  const visible = context.spaceAccess === 'all' ? (window.SpaceContext?.homeSpaces?.() || []).map(space => space.id) : context.allowedSpaceIds || [];
  const spaces = [...new Set(visible.filter(Boolean))].sort();
  if (!owner && !spaces.length) { stop(); store.reset(null); return; }
  const grants = context.permissionSignature || '';
  const next = JSON.stringify([uid, businessId, generation, context.role, grants, owner, spaces]);
  if (next === current) return;
  stop(); current = next;
  store.reset({uid, businessId, generation, complete: owner, grants, spaces});
  const base = collection(db, 'businesses', businessId, 'customerSpaceAccounts');
  const groups = owner ? [null] : Array.from({length: Math.ceil(spaces.length / 30)}, (_, i) => spaces.slice(i * 30, i * 30 + 30));
  const confirmed = new Set();
  for (const [index, group] of groups.entries()) {
    const generationFilter = where('workspaceGeneration', '==', generation);
    const q = group ? query(base, where('spaceId', 'in', group), generationFilter) : query(base, generationFilter);
    stops.push(onSnapshot(q, {includeMetadataChanges: true}, snapshot => {
      if (current !== next || snapshot.metadata.hasPendingWrites) return;
      const fromCache = snapshot.metadata.fromCache;
      const replace = !fromCache && !confirmed.has(index);
      if (fromCache) confirmed.delete(index); else confirmed.add(index);
      const changes = replace ? snapshot.docs.map(doc => ({type: 'added', id: doc.id, data: doc.data()}))
        : snapshot.docChanges().map(change => ({type: change.type, id: change.doc.id, data: change.doc.data()}));
      store.apply(businessId, changes, {fromServer: confirmed.size === groups.length, replaceSpaces: replace ? group : undefined});
    }, () => {
      if (current === next) { stop(); store.reset(null); }
    }));
  }
}
for (const name of ['firebase-auth-ready', 'business-context-changed', 'veconi-spaces-ready']) window.addEventListener(name, () => start());
window.addEventListener('firebase-session-cleared', () => { stop(); window.CustomerSpaceAccounts?.reset(null); });
start();

'use strict';
// Fictitious homologation data for the LOCAL Firebase Emulator only (project demo-veconi-homolog).
// Test-only credentials: these accounts exist only inside the emulator. Never reuse real data.
const PASSWORD = 'Homolog-Veconi-2026!';
const USERS = {
  owner: { email: 'dono@homolog.test', name: 'Dono Homologação', business: 'multi', role: 'owner' },
  seller: { email: 'vendedora@homolog.test', name: 'Vendedora Homologação', business: 'multi', role: 'seller', spaces: ['centro'] },
  single: { email: 'loja-unica@homolog.test', name: 'Dono Loja Única', business: 'single', role: 'owner' },
};
const BUSINESSES = {
  multi: { id: 'homolog-multi', name: 'Loja Fictícia (2 espaços)', spaces: { centro: 'Loja Centro', bairro: 'Loja Bairro' } },
  single: { id: 'homolog-unica', name: 'Loja Fictícia (1 espaço)', spaces: { loja: 'Loja Única' } },
};
const now = () => new Date().toISOString();
const space = (businessId, key) => `${businessId}-${key}`;

function documents(uids) {
  const writes = [], at = now();
  for (const [key, b] of Object.entries(BUSINESSES)) {
    const owner = uids[key === 'multi' ? 'owner' : 'single'];
    writes.push([`businesses/${b.id}`, { id: b.id, name: b.name, ownerId: owner, active: true, workspaceGeneration: 0,
      legacyAccessDisabled: false, sensitiveDataVersion: 1, subscription: { planId: 'internal', status: 'active' } }]);
    writes.push([`businesses/${b.id}/settings/default`, { id: 'default', nome: b.name, businessId: b.id,
      operation: { operationMode: 'physical_store', creditMode: 'enabled', operationOnboardingCompleted: true,
        modules: { inventory: true, crm: true, creditSales: true } } }]);
    for (const [spaceKey, name] of Object.entries(b.spaces))
      writes.push([`financialSpaces/${space(b.id, spaceKey)}`, { id: space(b.id, spaceKey), name, type: 'business', operationalType: 'unit',
        businessId: b.id, linkedBusinessId: b.id, ownerUid: owner, active: true, status: 'active',
        capabilities: { sales: true, products: true, inventory: true, finance: true } }]);
  }
  for (const [key, u] of Object.entries(USERS)) {
    const bid = BUSINESSES[u.business].id;
    writes.push([`users/${uids[key]}`, { uid: uids[key], name: u.name, email: u.email, businessId: bid, active: true,
      role: u.role === 'owner' ? 'owner' : 'cashier', tutorialVersionSeen: 999, permissions: {} }]);
    if (u.role !== 'owner') writes.push([`businesses/${bid}/members/${uids[key]}`, { uid: uids[key], role: u.role, status: 'active',
      spaceAccess: 'selected', allowedSpaceIds: u.spaces.map((s) => space(bid, s)), permissionsVersion: 2,
      permissions: { 'sales.create': true, 'customers.view': true, 'customers.create': true, 'products.view': true, 'inventory.view': true } }]);
  }
  const product = (bid, id, fields) => [`businesses/${bid}/products/${id}`, { id, businessId: bid, ativo: true, active: true, custo: 0,
    itemKind: 'product', productType: 'simple', spaceAccessMode: 'all_spaces', allowedSpaceIds: [], defaultSpaceId: null,
    schemaVersion: 14, createdAt: at, updatedAt: at, atualizadoEm: at, ...fields }];
  for (const b of Object.values(BUSINESSES)) {
    writes.push(
      // Legacy: stock control disabled ONLY by controlaEstoque:false (no semControleEstoque).
      product(b.id, 'legado-sem-controle', { nome: 'Legado sem controle de estoque', preco: 10, estoqueAtual: 3, estoque: 3, controlaEstoque: false }),
      product(b.id, 'controlado', { nome: 'Produto com estoque', preco: 15, estoqueAtual: 10, estoque: 10, semControleEstoque: false, controlaEstoque: true }),
      product(b.id, 'servico', { nome: 'Serviço avulso', preco: 25, itemKind: 'service', estoqueAtual: 0, semControleEstoque: true, controlaEstoque: false }),
      product(b.id, 'recorrente', { nome: 'Plano mensal (sem estoque)', preco: 25.9, productType: 'recurring', durationValue: 1, durationUnit: 'months',
        renewalLabel: 'Plano mensal', renewalReminders: [7, 1, 0], estoqueAtual: 0, semControleEstoque: true, controlaEstoque: false }),
      product(b.id, 'recorrente-licencas', { nome: 'Plano com licenças (estoque 5)', preco: 40, productType: 'recurring', durationValue: 1, durationUnit: 'months',
        renewalLabel: 'Licença mensal', renewalReminders: [7, 1, 0], estoqueAtual: 5, estoque: 5, semControleEstoque: false, controlaEstoque: true }),
    );
    const client = (id, nome, telefone) => [`businesses/${b.id}/clients/${id}`, { id, businessId: b.id, nome, nomeNormalizado: nome.toLowerCase(),
      telefone, saldo: 0, financialVersion: 1, ativo: true, active: true, customerSpaceIds: Object.keys(b.spaces).map((s) => space(b.id, s)),
      spaceId: space(b.id, Object.keys(b.spaces)[0]), createdAt: at, updatedAt: at }];
    writes.push(client('cliente-ana', 'Ana Fictícia', '11900000001'), client('cliente-bruno', 'Bruno Fictício', '11900000002'));
  }
  return writes;
}

async function seed(admin) {
  const uids = {};
  for (const [key, u] of Object.entries(USERS)) {
    let user;
    try { user = await admin.auth().getUserByEmail(u.email); }
    catch { user = await admin.auth().createUser({ email: u.email, password: PASSWORD, emailVerified: true, displayName: u.name }); }
    uids[key] = user.uid;
  }
  const writes = documents(uids), db = admin.firestore();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [key, value] of writes.slice(i, i + 400)) batch.set(db.doc(key), value);
    await batch.commit();
  }
  return { users: Object.fromEntries(Object.entries(USERS).map(([key, u]) => [key, u.email])), documents: writes.length };
}

module.exports = { seed, PASSWORD, USERS, BUSINESSES };

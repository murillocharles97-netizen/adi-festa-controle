'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../js/team-permission-model.js');

const clone = value => JSON.parse(JSON.stringify(value));
const enabled = values => Object.keys(values).filter(key => values[key] === true).sort();
const grants = (...keys) => Object.fromEntries(Model.KEYS.map(key => [key, keys.includes(key)]));
const original = overrides => ({
  uid: 'qa-seller', name: 'Funcionário QA', email: 'qa@example.test', role: 'seller', status: 'active',
  spaceAccess: 'selected', allowedSpaceIds: ['qa-a'], permissions: { 'sales.create': true }, ...overrides,
});
const draft = overrides => ({ role: 'seller', spaceAccess: 'selected', allowedSpaceIds: ['qa-a'],
  permissions: grants('sales.create', 'customers.view', 'products.view', 'inventory.view'), ...overrides });

test('contrato contém exatamente os 20 grants atuais, sem novas permissões fictícias', () => {
  assert.equal(Model.KEYS.length, 20);
  assert.equal(new Set(Model.KEYS).size, 20);
  assert.equal(Object.isFrozen(Model.KEYS), true);
  assert.deepEqual(Model.KEYS.filter(key => /discount|price|goals|online|personal|customers.create|products.create/.test(key)), []);
});

test('membro sparse mantém somente grants explícitos sem completar preset do cargo', () => {
  const member = original({ role: 'manager', permissions: { 'sales.create': true, 'products.edit': false } });
  const before = clone(member), values = Model.explicit(member);
  assert.deepEqual(enabled(values), ['sales.create']);
  assert.equal(values['products.edit'], false);
  assert.equal(values['reports.view'], false);
  assert.equal(values['team.view'], false);
  assert.deepEqual(member, before);
});

test('ausência de mapa não transforma gerente ou vendedor em preset', () => {
  for (const role of ['seller', 'manager', 'stock']) {
    assert.deepEqual(enabled(Model.explicit({ role })), []);
    assert.deepEqual(enabled(Model.explicit({ role, permissions: null })), []);
  }
});

test('array legado usa apenas as chaves presentes, sem promover entradas falsas ou desconhecidas', () => {
  const member = original({ permissions: ['sales.create', 'products.view', false, 'financial.view:false', 'root'] });
  assert.deepEqual(enabled(Model.explicit(member)), ['products.view', 'sales.create']);
  assert.equal(Model.explicit(member)['financial.view'], false);
  assert.equal(Object.hasOwn(Model.explicit(member), 'root'), false);
});

test('boolean false e valores truthy não booleanos não concedem acesso', () => {
  assert.deepEqual(enabled(Model.explicit(original({ permissions: {
    'sales.create': false, 'sales.cancel': 'true', 'financial.view': 1,
    'reports.view': 'false', 'customers.view': true,
  } }))), ['customers.view']);
});

test('owner mantém todos os grants efetivos mesmo com mapa vazio ou false explícito', () => {
  const member = original({ role: 'owner', permissions: { 'financial.view': false, 'team.manage': false } });
  assert.deepEqual(enabled(Model.explicit(member)), [...Model.KEYS].sort());
  assert.equal(member.permissions['financial.view'], false);
  assert.throws(() => Model.serialize(member, draft()), /proprietário.*protegido/);
});

test('snapshot preserva ausência, false e formato raw sem incluir dados pessoais', () => {
  const member = { uid: 'qa', name: 'QA', email: 'qa@example.test', role: 'stock', permissions: { 'products.edit': false } };
  const snapshot = Model.snapshot(member);
  assert.deepEqual(snapshot, { role: 'stock', permissions: { 'products.edit': false } });
  for (const key of ['status', 'spaceAccess', 'allowedSpaceIds', 'uid', 'name', 'email']) assert.equal(Object.hasOwn(snapshot, key), false);
  snapshot.permissions['products.edit'] = true;
  assert.equal(member.permissions['products.edit'], false);
});

test('snapshot retém array original e campos de acesso sem normalização destrutiva', () => {
  const member = original({ permissions: ['sales.create', 'products.view'], allowedSpaceIds: ['qa-b', 'qa-a', 'qa-b'] });
  const snapshot = Model.snapshot(member);
  assert.deepEqual(snapshot.permissions, ['sales.create', 'products.view']);
  assert.deepEqual(snapshot.allowedSpaceIds, ['qa-b', 'qa-a', 'qa-b']);
  assert.equal(snapshot.status, 'active');
  assert.notEqual(snapshot.allowedSpaceIds, member.allowedSpaceIds);
});

test('presets explícitos de caixa e gerente não incluem direitos sensíveis ou administrativos', () => {
  const denied = ['financial.view', 'cost.view', 'profit.view', 'team.view', 'team.manage', 'settings.manage',
    'billing.manage', 'spaces.manage', 'customers.receiveDebt', 'customers.adjustBalance'];
  for (const role of ['seller', 'manager']) {
    const values = Model.preset(role);
    for (const key of denied) assert.equal(values[key], false, `${role}: ${key}`);
    assert.equal(values['sales.create'], true);
    assert.deepEqual(Model.issues(values), []);
  }
  assert.equal(Model.preset('manager')['sales.cancel'], true);
  assert.equal(Model.preset('seller')['sales.cancel'], false);
});

test('obter ou editar um preset não modifica o preset seguinte ou o membro existente', () => {
  const member = original(), before = clone(member), first = Model.preset('seller');
  first['financial.view'] = true;
  first['products.view'] = false;
  assert.equal(Model.preset('seller')['financial.view'], false);
  assert.equal(Model.preset('seller')['products.view'], true);
  assert.deepEqual(member, before);
});

test('Personalizado não é uma role persistível e não altera cargo stock', () => {
  assert.throws(() => Model.serialize(original(), draft({ role: 'custom' })), /Cargo inválido/);
  assert.throws(() => Model.serialize(original(), draft({ role: 'personalizado' })), /Cargo inválido/);
  const member = original({ role: 'stock', permissions: { 'products.view': true, 'inventory.view': true, 'inventory.adjust': true } });
  const payload = Model.serialize(member, draft({ role: 'stock', permissions: Model.explicit(member) }));
  assert.equal(payload.role, 'stock');
  assert.equal(payload.permissions['inventory.adjust'], true);
  assert.equal(payload.permissions['sales.create'], false);
});

test('habilitar dependente sem pai é bloqueado e não concede grant implicitamente', () => {
  const values = grants('sales.create'), before = clone(values);
  const result = Model.change(values, 'inventory.adjust', true);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.missing, ['products.view', 'inventory.view']);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.values, before);
  assert.deepEqual(values, before);
});

test('habilitar dependente com pais ligados muda somente a chave pedida', () => {
  const values = grants('products.view', 'inventory.view'), before = clone(values);
  const result = Model.change(values, 'inventory.adjust', true);
  assert.equal(result.blocked, false);
  assert.deepEqual(Model.difference(before, result.values), { added: ['inventory.adjust'], removed: [] });
  assert.deepEqual(values, before);
});

test('desligar pai remove somente seus descendentes, inclusive dependência transitiva', () => {
  const values = grants('products.view', 'products.edit', 'inventory.view', 'inventory.adjust', 'customers.view', 'customers.edit');
  const before = clone(values), result = Model.change(values, 'products.view', false);
  assert.equal(result.blocked, false);
  assert.deepEqual([...result.removed].sort(), ['inventory.adjust', 'inventory.view', 'products.edit']);
  assert.deepEqual(enabled(result.values), ['customers.edit', 'customers.view']);
  assert.deepEqual(values, before);
});

test('cascata não normaliza combinação legada incoerente de outro ramo', () => {
  const values = grants('products.view', 'inventory.view', 'inventory.adjust', 'customers.edit');
  const result = Model.change(values, 'products.view', false);
  assert.equal(result.values['customers.edit'], true);
  assert.equal(result.values['customers.view'], false);
  assert.deepEqual(Model.issues(result.values), [{ key: 'customers.edit', missing: ['customers.view'] }]);
  assert.equal(result.removed.includes('customers.edit'), false);
});

test('desligar criação de venda desliga cancelamento sem revogar consulta administrativa', () => {
  const result = Model.change(grants('sales.create', 'sales.cancel', 'sales.viewAll'), 'sales.create', false);
  assert.equal(result.values['sales.create'], false);
  assert.equal(result.values['sales.cancel'], false);
  assert.equal(result.values['sales.viewAll'], true);
  assert.deepEqual(result.removed, ['sales.cancel']);
});

test('dependências de equipe não concedem gestão ao selecionar consulta', () => {
  const blocked = Model.change(grants(), 'team.manage', true);
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.missing, ['team.view']);
  const viewing = Model.change(grants(), 'team.view', true);
  assert.equal(viewing.values['team.manage'], false);
  const removing = Model.change(grants('team.view', 'team.manage'), 'team.view', false);
  assert.equal(removing.values['team.manage'], false);
});

test('chave desconhecida é recusada no editor e ignorada nos mapas serializados', () => {
  assert.throws(() => Model.change(grants(), 'platform.admin', true), /desconhecida/);
  const payload = Model.serialize(original(), draft({ permissions: { ...grants('sales.create'), root: true, 'financial.create': true } }));
  assert.deepEqual(Object.keys(payload.permissions), [...Model.KEYS]);
  assert.equal(Object.hasOwn(payload.permissions, 'root'), false);
  assert.equal(Object.hasOwn(payload.permissions, 'financial.create'), false);
});

test('serialize rejeita dependências inválidas em vez de conceder pai no salvamento', () => {
  const value = draft({ permissions: grants('customers.edit') }), before = clone(value);
  assert.throws(() => Model.serialize(original(), value), /dependências/);
  assert.deepEqual(value, before);
});

test('espaços específicos exigem seleção e modo inválido não vira acesso a todos', () => {
  for (const value of [draft({ allowedSpaceIds: [] }), draft({ spaceAccess: 'invalid' }), draft({ spaceAccess: '' })]) {
    assert.throws(() => Model.serialize(original(), value), /ao menos um espaço/);
  }
});

test('seleção específica é deduplicada sem mutação e all não carrega IDs residuais', () => {
  const value = draft({ allowedSpaceIds: ['qa-b', 'qa-a', 'qa-b'] }), before = clone(value);
  const selected = Model.serialize(original(), value);
  assert.deepEqual(selected.allowedSpaceIds, ['qa-a', 'qa-b']);
  assert.equal(selected.spaceAccess, 'selected');
  assert.deepEqual(value, before);
  const all = Model.serialize(original(), draft({ spaceAccess: 'all', allowedSpaceIds: ['qa-a'] }));
  assert.deepEqual(all.allowedSpaceIds, []);
});

test('serialize envia só acesso e expectedAccess raw, não perfil, status ou identidade pessoal', () => {
  const member = original({ permissions: { 'sales.create': true, 'financial.view': false }, allowedSpaceIds: ['qa-b', 'qa-a'] });
  const value = { ...draft(), name: 'Não enviar', email: 'nao-enviar@example.test', uid: 'nao-enviar', status: 'disabled', rolePreset: 'custom' };
  const beforeMember = clone(member), beforeDraft = clone(value), payload = Model.serialize(member, value);
  assert.deepEqual(Object.keys(payload).sort(), ['allowedSpaceIds', 'expectedAccess', 'permissions', 'role', 'spaceAccess']);
  assert.deepEqual(payload.expectedAccess, {
    role: 'seller', status: 'active', spaceAccess: 'selected', allowedSpaceIds: ['qa-b', 'qa-a'],
    permissions: { 'sales.create': true, 'financial.view': false },
  });
  assert.deepEqual(member, beforeMember);
  assert.deepEqual(value, beforeDraft);
  payload.expectedAccess.permissions['sales.create'] = false;
  assert.equal(member.permissions['sales.create'], true);
});

test('serialize mantém ausência do snapshot original em expectedAccess', () => {
  const member = { role: 'stock', permissions: ['products.view'] };
  const payload = Model.serialize(member, draft({ role: 'stock', permissions: grants('products.view') }));
  assert.deepEqual(payload.expectedAccess, member);
  for (const key of ['status', 'spaceAccess', 'allowedSpaceIds']) assert.equal(Object.hasOwn(payload.expectedAccess, key), false);
});

test('difference só considera grants canônicos e não modifica os argumentos', () => {
  const before = { ...grants('sales.create'), root: false }, after = { ...grants('products.view'), root: true };
  const savedBefore = clone(before), savedAfter = clone(after);
  assert.deepEqual(Model.difference(before, after), { added: ['products.view'], removed: ['sales.create'] });
  assert.deepEqual(before, savedBefore);
  assert.deepEqual(after, savedAfter);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../js/team-permission-model.js');
const read = path => fs.readFileSync(path, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function serviceRuntime({ members = [], invites = [], granted = true } = {}) {
  const queries = [];
  const sandbox = {
    console, Date, auth: { currentUser: { uid: 'qa-owner' } }, db: {},
    BusinessContext: { get: () => ({ businessId: 'qa-business', role: 'owner' }) },
    TeamAccess: { has: () => granted }, FirebaseSession: { businessId: 'qa-business' },
    addEventListener() {}, normalizeFirestoreData: value => value,
    collection: (_db, ...parts) => ({ path: parts.join('/') }),
    doc: (_db, ...parts) => ({ path: parts.join('/') }),
    orderBy: field => ({ orderBy: field }),
    query: (reference, ...constraints) => ({ ...reference, constraints }),
    onSnapshot: () => () => {},
    getDocs: async reference => {
      queries.push(reference);
      const rows = reference.path.endsWith('/members') ? members : invites;
      return { docs: rows.map(row => ({ id: row.id, data: () => row.data })) };
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const source = read('js/firebase/team-service.js')
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, '')
    .replace(/^export\s*\{[^}]+\};?\s*$/gm, '');
  vm.runInContext(source, sandbox);
  return { service: sandbox.TeamService, queries };
}

test('listMembers usa ID documental como UID e ID, nunca aliases inline divergentes', async () => {
  const r = serviceRuntime({ members: [
    { id: 'auth-uid-original', data: { id: 'inline-id-incorreto', uid: 'outro-uid', name: 'QA', role: 'seller', status: 'active' } },
    { id: 'membro-legado-sem-uid', data: { name: 'Legado', role: 'stock', status: 'active' } },
  ] });
  const result = plain(await r.service.listMembers());
  assert.deepEqual(result.map(member => [member.id, member.uid]), [
    ['auth-uid-original', 'auth-uid-original'], ['membro-legado-sem-uid', 'membro-legado-sem-uid'],
  ]);
  assert.equal(r.queries[0].path, 'businesses/qa-business/members');
  assert.deepEqual(plain(r.queries[0].constraints), [{ orderBy: 'name' }]);
});

test('listMembers preserva mapa raw, false explícito e formato legado sem completar presets', async () => {
  const r = serviceRuntime({ members: [
    { id: 'sparse', data: { role: 'manager', permissions: { 'sales.create': true, 'cost.view': false } } },
    { id: 'array', data: { role: 'seller', permissions: ['products.view'] } },
    { id: 'missing', data: { role: 'stock' } },
  ] });
  const result = plain(await r.service.listMembers());
  assert.deepEqual(result[0].permissions, { 'sales.create': true, 'cost.view': false });
  assert.deepEqual(result[1].permissions, ['products.view']);
  assert.equal(Object.hasOwn(result[2], 'permissions'), false);
});

test('convites também confiam no ID documental e mantêm filtro de pendente não expirado', async () => {
  const r = serviceRuntime({ invites: [
    { id: 'convite-real', data: { id: 'alias-adulterado', status: 'pending', expiresAt: '2100-01-01T00:00:00.000Z', name: 'QA' } },
    { id: 'convite-expirado', data: { status: 'pending', expiresAt: '2000-01-01T00:00:00.000Z' } },
    { id: 'convite-consumido', data: { status: 'accepted', expiresAt: '2100-01-01T00:00:00.000Z' } },
  ] });
  const result = plain(await r.service.listInvites());
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'convite-real');
  assert.equal(r.queries[0].path, 'businesses/qa-business/teamInvites');
});

test('serviço continua negando consulta de equipe e convites sem team.view', async () => {
  const r = serviceRuntime({ granted: false });
  await assert.rejects(r.service.listMembers(), /acesso à equipe/);
  await assert.rejects(r.service.listInvites(), /acesso à equipe/);
  assert.equal(r.queries.length, 0);
});

function pageRuntime({ manageable = true } = {}) {
  const context = { businessId: 'qa-business', role: 'owner' };
  const sandbox = {
    console, queueMicrotask, addEventListener() {},
    document: { querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} } },
    BusinessContext: { get: () => context }, FirebaseSession: { user: { uid: 'qa-owner' } },
    Utils: { escapar: esc }, TeamPermissionModel: Model,
    TeamAccess: { has: key => key === 'team.view' || key === 'team.manage' && manageable,
      ROLE_LABELS: { owner: 'Proprietário', seller: 'Vendedor / Caixa', stock: 'Estoque' },
      deniedMarkup: () => '<p>Sem acesso</p>' },
    SpaceContext: { list: () => [{ id: 'qa-a', name: 'QA A' }], homeSpaces: () => [{ id: 'qa-a', name: 'QA A' }] },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/team-page.js'), sandbox);
  sandbox.TeamPage.state.businessId = context.businessId;
  return sandbox;
}

test('TeamPage.render usa id legado sem uid em data-team-edit em vez de undefined', () => {
  const r = pageRuntime();
  r.TeamPage.state.members = [{ id: 'documental-legado', name: 'Funcionário QA', email: 'qa@example.test', role: 'seller', status: 'active', allowedSpaceIds: ['qa-a'] }];
  const markup = r.TeamPage.render();
  assert.match(markup, /data-team-edit="documental-legado"/);
  assert.doesNotMatch(markup, /data-team-edit="(?:undefined|null|)"/);
});

test('TeamPage mantém UID canônico do serviço e continua protegendo controles administrativos', () => {
  const r = pageRuntime({ manageable: false });
  r.TeamPage.state.members = [{ id: 'qa-member', uid: 'qa-member', name: 'QA', role: 'seller', status: 'active' }];
  const markup = r.TeamPage.render();
  assert.match(markup, /QA/);
  assert.doesNotMatch(markup, /data-team-edit=|data-team-add/);
});

test('ação de editar membro resolve o mesmo identificador de fallback usado pelo card', () => {
  const source = read('js/team-page.js');
  assert.match(source, /const memberUid\s*=\s*item\s*=>\s*item\?\.uid\s*\|\|\s*item\?\.id/);
  assert.match(source, /state\.members\.find\(\(item\)\s*=>\s*memberUid\(item\)\s*===\s*button\.dataset\.teamEdit\)/);
});

test('spaceOptions preserva IDs originais desconhecidos com aviso de vínculo preservado', () => {
  assert.equal(typeof Model.spaceOptions, 'function');
  const options = Model.spaceOptions([{ id: 'qa-a', name: 'QA A', businessId: 'qa-business' }], ['qa-a', 'qa-desconhecido'], 'qa-business');
  assert.deepEqual(options.map(space => space.id), ['qa-a', 'qa-desconhecido']);
  assert.equal(options[0].name, 'QA A');
  assert.match(options[1].name, /indisponível.*qa-desconhecido.*vínculo preservado/i);
});

test('spaceOptions elimina opções de empresas estrangeiras e vínculos de empresa contraditórios', () => {
  const available = [
    { id: 'qa-a', name: 'QA A', businessId: 'qa-business', linkedBusinessId: 'qa-business' },
    { id: 'qa-linked', name: 'QA linked', linkedBusinessId: 'qa-business' },
    { id: 'context-only', name: 'Contexto já filtrado' },
    { id: 'foreign-business', name: 'Outra empresa', businessId: 'foreign' },
    { id: 'foreign-linked', name: 'Outro vínculo', linkedBusinessId: 'foreign' },
    { id: 'contradictory', name: 'Vínculo contraditório', businessId: 'qa-business', linkedBusinessId: 'foreign' },
  ];
  const result = Model.spaceOptions(available, [], 'qa-business');
  assert.deepEqual(result.map(space => space.id), ['qa-a', 'qa-linked', 'context-only']);
});

test('spaceOptions não muta opções, grants ou lista original e não duplica desconhecidos', () => {
  const available = [{ id: 'qa-a', name: 'QA A', businessId: 'qa-business', privateField: 'não copiar' }];
  const originalIds = ['qa-a', 'qa-a', 'unknown', 'unknown'];
  const before = plain({ available, originalIds });
  const result = Model.spaceOptions(available, originalIds, 'qa-business');
  assert.deepEqual(result.map(space => space.id), ['qa-a', 'unknown']);
  assert.deepEqual({ available, originalIds }, before);
  assert.equal(Object.hasOwn(result[0], 'privateField'), false);
  result[0].name = 'Nome da opção alterado';
  assert.equal(available[0].name, 'QA A');
});

test('formulário de espaços existente e novo editor usam o mesmo helper por empresa', () => {
  const page = read('js/team-page.js'), editor = read('js/team-permission-editor.js');
  const fields = page.slice(page.indexOf('function spacesFields('), page.indexOf('function permissionFields('));
  assert.match(fields, /TeamPermissionModel\.spaceOptions\(/);
  assert.match(fields, /item\.allowedSpaceIds\s*\|\|\s*\[\]/);
  assert.match(fields, /BusinessContext\?\.get\?\.\(\)\.businessId/);
  assert.match(editor, /M\.spaceOptions\([^;]+original\.allowedSpaceIds[^;]+context\(\)\.businessId\)/);
});
